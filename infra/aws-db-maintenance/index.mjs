// Temporary, IAM-invoked database maintenance worker. There is no HTTP endpoint.
// Every statement is packaged in the reviewed, content-addressed release: an
// invocation cannot supply SQL, credentials, an endpoint, or a different role.
import pg from "../../dashboard/node_modules/pg/lib/index.js";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { refreshArchiveProjection } from "../../dashboard/scripts/archive_projection.mjs";

const root = process.env.LAMBDA_TASK_ROOT || new URL(".", import.meta.url).pathname;
export const maintenanceManifest = JSON.parse(readFileSync(`${root}/operations.json`, "utf8"));
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export async function handler(event, context) {
  return runMaintenance(event, context);
}

// The alternate credential entrypoints pass policy internally. It is never
// accepted from an invocation or written to process.env.
export async function runMaintenance(event, context, policy = {}) {
  const manifest = maintenanceManifest;
  const started = performance.now();
  if (!event || Object.keys(event).some((key) => !["operation", "operationHash", "values"].includes(key)))
    throw new Error("Unexpected maintenance request fields");
  const operation = manifest.operations[event.operation];
  if (!operation || event.operationHash !== digest(operation))
    throw new Error("Unknown operation or release hash mismatch");
  const target = policy.target ?? process.env.DATABASE_TARGET;
  if (!operation.targets.includes(target)) throw new Error("Operation is not allowed on this target");
  const write = operation.mode === "write";
  if (write && !(policy.allowWrites ?? (process.env.ALLOW_WRITES === "true"))) throw new Error("This worker is read-only");
  if (operation.repeat && (!write || operation.migration || operation.repeat !== "progress.complete"))
    throw new Error("Only checkpointed migration batches may repeat");
  const maintenanceKind = operation.kind;
  const vacuumTables = new Set(["statarena_app.appearances", "statarena_app.player_season_rollups",
    "statarena_app.catalog_records", "statarena_app.support_records", "statarena_app.detail_records"]);
  if (maintenanceKind && (!["archive-refresh", "vacuum-analyze"].includes(maintenanceKind) ||
      !write || operation.migration || operation.repeat || operation.sql))
    throw new Error("Invalid fixed maintenance operation");
  const values = event.values ?? operation.values ?? [];
  if (!Array.isArray(values) || values.length !== operation.parameters || JSON.stringify(values).length > 100000)
    throw new Error("Invalid operation parameters");
  if (maintenanceKind === "archive-refresh" && (values.length !== 1 || typeof values[0] !== "string" || !/^\d{4}(?:\/\d{4})?$/.test(values[0])))
    throw new Error("Invalid archive season");
  if (maintenanceKind === "vacuum-analyze" && (values.length || !vacuumTables.has(operation.table)))
    throw new Error("Invalid vacuum target");
  const config = policy.config ?? JSON.parse(process.env.DATABASE_CONFIG || "{}");
  if (config.host !== (policy.expectedHost ?? process.env.EXPECTED_DATABASE_HOST) || config.database !== "statarena_prod" ||
      !["statarena_runtime", "statarena_ingest", "statarena_admin"].includes(config.username))
    throw new Error("Unexpected configured database identity");
  const client = new pg.Client({
    host: config.host, port: Number(config.port || 5432), database: config.database,
    user: config.username, password: config.password,
    ssl: { ca: readFileSync(`${root}/rds-ca.pem`, "utf8"), rejectUnauthorized: true },
    application_name: `vega-refactor-${target}`,
    connectionTimeoutMillis: 8000,
    options: "-c statement_timeout=120000 -c lock_timeout=2000 -c idle_in_transaction_session_timeout=150000",
  });
  if (policy.expiresAt) {
    // A hard release expiry also bounds already running work. This applies to
    // archive refresh/VACUUM as well as checkpoint loops, without changing the
    // ordinary stage worker. Cleanup remains possible after a timeout.
    const deadline = Math.min(started + 45000,
      started + policy.expiresAt - Date.now() - 1000,
      started + (context?.getRemainingTimeInMillis?.() ?? 150000) - 5000);
    const rawQuery = client.query.bind(client);
    const operationLimit = maintenanceKind === "archive-refresh" ? 44000
      : maintenanceKind === "vacuum-analyze" ? 40000 : Math.min(operation.timeoutMs || 20000,45000);
    client.query = async (statement, parameters) => {
      const request = typeof statement === "string" ? {text:statement,values:parameters} : {...statement};
      if (request.text === "ROLLBACK" || request.text === "SELECT pg_advisory_unlock(97813003)")
        return rawQuery({...request,query_timeout:1000});
      const remaining = () => {
        const value = Math.floor(Math.min(deadline-performance.now(),policy.expiresAt-Date.now()-1000));
        if (value < 1) throw Object.assign(new Error("Transient operation deadline exhausted"),{code:"TRANSIENT_DEADLINE"});
        return value;
      };
      const budget = Math.min(remaining(),operationLimit,request.query_timeout || Infinity);
      // The fixed setter is separate from reviewed SQL and bind values. It
      // prevents a helper's larger local timeout from extending this release.
      await rawQuery({text:"SELECT set_config('statement_timeout',$1,false)",values:[`${budget}ms`],query_timeout:budget});
      return rawQuery({...request,query_timeout:Math.min(budget,remaining())});
    };
  }
  let connected = false;
  let iterations = 0;
  let sessionLease = false;
  try {
    await client.connect();
    connected = true;
    const connectionMs = performance.now() - started;
    if (policy.identity) {
      const actual = (await client.query("SELECT current_user AS role,current_database() AS database")).rows[0];
      if (actual?.role !== policy.identity.role || actual?.database !== policy.identity.database)
        throw Object.assign(new Error("Unexpected transient database identity"),{code:"TRANSIENT_IDENTITY"});
    }
    if (maintenanceKind === "archive-refresh") {
      if (config.username !== "statarena_ingest") throw new Error("Archive refresh requires the existing ingestion owner");
      const queryStarted = performance.now();
      const receipt = await refreshArchiveProjection(client, values[0], {maintenance:true});
      return {ok:true,operation:event.operation,operationHash:event.operationHash,target,
        connectionMs:Math.round(connectionMs),queryMs:Math.round(performance.now()-queryStarted),
        totalMs:Math.round(performance.now()-started),iterations:1,rows:[receipt]};
    }
    if (maintenanceKind === "vacuum-analyze") {
      if (config.username !== "statarena_ingest") throw new Error("Vacuum requires the existing ingestion owner");
      const lease = await client.query("SELECT pg_try_advisory_lock(97813003) AS acquired");
      sessionLease = Boolean(lease.rows[0]?.acquired);
      if (!sessionLease) throw new Error("Publisher lease is busy");
      const owned = await client.query("SELECT relowner=current_user::regrole AND relkind='r' AS owned FROM pg_class WHERE oid=$1::regclass",[operation.table]);
      if (!owned.rows[0]?.owned) throw new Error("Vacuum target is not owned by this worker");
      await client.query("SELECT set_config('statement_timeout','40000',false)");
      const queryStarted = performance.now();
      // VACUUM cannot run inside a transaction. This fixed allowlist never uses
      // FULL, changes table ownership, or removes committed business rows.
      await client.query(`VACUUM (ANALYZE) ${operation.table}`);
      return {ok:true,operation:event.operation,operationHash:event.operationHash,target,
        connectionMs:Math.round(connectionMs),queryMs:Math.round(performance.now()-queryStarted),
        totalMs:Math.round(performance.now()-started),iterations:1,rows:[{table:operation.table,maintenance:"VACUUM (ANALYZE)"}]};
    }
    let rows, results, queryMs = 0;
    do {
      const remainingMs = Math.min(
        // Keep the response inside the AWS client's 60-second read window.
        // A longer invocation can be retried while the original is still
        // running; checkpoints remain safe, but the duplicate wastes work.
        45000 - (performance.now() - started),
        (context?.getRemainingTimeInMillis?.() ?? 150000) - 10000,
      );
      if (remainingMs < 5000) break;
      await client.query(write ? "BEGIN" : "BEGIN READ ONLY");
      await client.query("SELECT set_config('statement_timeout',$1,true)",
        [String(Math.floor(Math.min(remainingMs, operation.timeoutMs || 20000)))]);
      if (operation.migration) {
        const { version, digest: expectedDigest } = operation.migration;
        if (!write || !/^\d{3}_[a-z0-9_]+\.sql$/.test(version) ||
            createHash("sha256").update(operation.sql).digest("hex") !== expectedDigest)
          throw new Error("Invalid migration manifest");
        const lease = await client.query("SELECT pg_try_advisory_xact_lock(97813003) AS acquired");
        if (!lease.rows[0]?.acquired) throw new Error("Publisher lease is busy");
        const previous = await client.query("SELECT digest FROM statarena_app.worker_schema WHERE version=$1", [version]);
        if (previous.rows.length) {
          if (previous.rows[0].digest !== expectedDigest) throw new Error("Applied migration digest differs");
          await client.query("COMMIT");
          return { ok: true, operation: event.operation, operationHash: event.operationHash, target,
            alreadyApplied: true, migration: operation.migration,
            totalMs: Math.round(performance.now() - started), rows: [] };
        }
      }
      const queryStarted = performance.now();
      const response = await client.query(operation.sql, values);
      queryMs += performance.now() - queryStarted;
      // Each bounded batch commits independently. If a later batch fails, its
      // predecessors remain resumable through database-owned checkpoints.
      results = Array.isArray(response) ? response : [response];
      rows = results.flatMap((result) => result.rows || []);
      if (rows.length > (operation.maxRows || 1000) || Buffer.byteLength(JSON.stringify(rows)) > 4000000)
        throw new Error("Operation result exceeds its reviewed bound");
      if (operation.repeat && typeof rows[0]?.progress?.complete !== "boolean")
        throw new Error("Checkpointed operation omitted its completion state");
      if (operation.migration)
        await client.query("INSERT INTO statarena_app.worker_schema(version,digest) VALUES($1,$2)",
          [operation.migration.version, operation.migration.digest]);
      await client.query("COMMIT");
      iterations += 1;
    } while (operation.repeat && !rows[0].progress.complete && iterations < 256 && performance.now() - started < 35000);
    if (!iterations) throw new Error("No time budget remains for a bounded operation");
    return { ok: true, operation: event.operation, operationHash: event.operationHash, target,
      connectionMs: Math.round(connectionMs), queryMs: Math.round(queryMs),
      totalMs: Math.round(performance.now() - started),
      iterations, results: results.map(({ command, rowCount }) => ({ command, rowCount })), rows };
  } catch (error) {
    if (connected) await client.query("ROLLBACK").catch(() => {});
    // Do not log connection strings, bind values, rows, or credentials.
    return { ok: false, operation: event.operation, target,
      code: error.code || error.name, ...(!policy.redactErrors && {message:String(error.message).slice(0, 500)}),
      committedIterations: iterations, totalMs: Math.round(performance.now() - started) };
  } finally {
    if (connected && sessionLease) await client.query("SELECT pg_advisory_unlock(97813003)").catch(() => {});
    try {
      if (policy.config) await client.end().catch(() => {});
      else if (connected) await client.end();
    }
    finally {
      if (policy.config) {
        client.password = undefined;
        if (client.connectionParameters) client.connectionParameters.password = undefined;
      }
    }
  }
}
