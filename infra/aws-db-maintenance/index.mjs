// Temporary, IAM-invoked database maintenance worker. There is no HTTP endpoint.
// Every statement is packaged in the reviewed, content-addressed release: an
// invocation cannot supply SQL, credentials, an endpoint, or a different role.
import pg from "../../dashboard/node_modules/pg/lib/index.js";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const root = process.env.LAMBDA_TASK_ROOT || new URL(".", import.meta.url).pathname;
const manifest = JSON.parse(readFileSync(`${root}/operations.json`, "utf8"));
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export async function handler(event, context) {
  const started = performance.now();
  if (!event || Object.keys(event).some((key) => !["operation", "operationHash", "values"].includes(key)))
    throw new Error("Unexpected maintenance request fields");
  const operation = manifest.operations[event.operation];
  if (!operation || event.operationHash !== digest(operation))
    throw new Error("Unknown operation or release hash mismatch");
  const target = process.env.DATABASE_TARGET;
  if (!operation.targets.includes(target)) throw new Error("Operation is not allowed on this target");
  const write = operation.mode === "write";
  if (write && process.env.ALLOW_WRITES !== "true") throw new Error("This worker is read-only");
  if (operation.repeat && (!write || operation.migration || operation.repeat !== "progress.complete"))
    throw new Error("Only checkpointed migration batches may repeat");
  const values = event.values ?? operation.values ?? [];
  if (!Array.isArray(values) || values.length !== operation.parameters || JSON.stringify(values).length > 100000)
    throw new Error("Invalid operation parameters");
  const config = JSON.parse(process.env.DATABASE_CONFIG || "{}");
  if (config.host !== process.env.EXPECTED_DATABASE_HOST || config.database !== "statarena_prod" ||
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
  let connected = false;
  let iterations = 0;
  try {
    await client.connect();
    connected = true;
    const connectionMs = performance.now() - started;
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
      code: error.code || error.name, message: String(error.message).slice(0, 500),
      committedIterations: iterations, totalMs: Math.round(performance.now() - started) };
  } finally {
    if (connected) await client.end();
  }
}
