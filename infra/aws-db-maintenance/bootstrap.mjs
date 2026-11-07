// One-time database bootstrap. Unlike the ordinary SQL worker, this separate
// handler never stores an administrator password in deployment configuration.
// An IAM-authorized operator supplies it only in the synchronous invocation.
import pg from "../../dashboard/node_modules/pg/lib/index.js";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const root = process.env.LAMBDA_TASK_ROOT || new URL(".", import.meta.url).pathname;
const manifest = JSON.parse(readFileSync(`${root}/operations.json`, "utf8"));
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const allowed = new Set(["bootstrap-consolidation"]);
const host = "statarena-postgres.clcy2iqyajbl.us-east-2.rds.amazonaws.com";

export async function handler(event) {
  if (!event || Object.keys(event).some((key) => !["operation", "operationHash", "password"].includes(key)))
    throw new Error("Unexpected bootstrap request fields");
  const operation = manifest.operations[event.operation];
  if (!allowed.has(event.operation) || !operation || event.operationHash !== digest(operation) ||
      operation.mode !== "write" || operation.parameters !== 0 ||
      Object.keys(manifest.operations).some((name) => !allowed.has(name)))
    throw new Error("Unknown bootstrap operation or release hash mismatch");
  if (process.env.DATABASE_TARGET !== "prod" || process.env.ALLOW_WRITES !== "true" ||
      process.env.EXPECTED_DATABASE_HOST !== host || !operation.targets.includes("prod"))
    throw new Error("Unexpected bootstrap deployment target");
  const config = JSON.parse(process.env.DATABASE_CONFIG || "{}");
  if (config.host !== host || config.database !== "statarena_prod" ||
      config.username !== "statarena_admin" || Object.hasOwn(config, "password"))
    throw new Error("Bootstrap configuration must contain no password");
  if (typeof event.password !== "string" || event.password.length < 1 || event.password.length > 4096)
    throw new Error("A transient bootstrap credential is required");
  const client = new pg.Client({
    host, port: 5432, database: "statarena_prod", user: "statarena_admin",
    password: event.password,
    ssl: { ca: readFileSync(`${root}/rds-ca.pem`, "utf8"), rejectUnauthorized: true },
    application_name: "vega-refactor-bootstrap",
    connectionTimeoutMillis: 8000,
    options: "-c statement_timeout=20000 -c lock_timeout=2000 -c idle_in_transaction_session_timeout=30000",
  });
  let connected = false;
  try {
    await client.connect();
    connected = true;
    await client.query("BEGIN");
    const identity = await client.query("SELECT current_user AS role,current_database() AS database,pg_try_advisory_xact_lock(97813003) AS lease");
    if (identity.rows[0]?.role !== "statarena_admin" || identity.rows[0]?.database !== "statarena_prod")
      throw Object.assign(new Error("Unexpected bootstrap identity"), {code:"BOOTSTRAP_IDENTITY"});
    if (!identity.rows[0]?.lease) {
      // Queue behind a short healthy publication instead of racing its lease.
      // The fixed connection lock_timeout bounds this wait to two seconds.
      // A timed-out statement aborts its subtransaction; restore the savepoint
      // before reading safe blocker metadata and rolling back the outer work.
      await client.query("SAVEPOINT bootstrap_lease");
      try {
        await client.query("SELECT pg_advisory_xact_lock(97813003)");
        await client.query("RELEASE SAVEPOINT bootstrap_lease");
      } catch (error) {
        if (error.code !== "55P03") throw error;
        await client.query("ROLLBACK TO SAVEPOINT bootstrap_lease");
        await client.query("RELEASE SAVEPOINT bootstrap_lease");
        const blockers = await client.query(`SELECT a.pid,a.application_name,a.state,a.wait_event_type,a.wait_event,
          extract(epoch FROM now()-a.xact_start)::bigint AS transaction_seconds,
          extract(epoch FROM now()-a.query_start)::bigint AS query_seconds
          FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid
          WHERE l.locktype='advisory' AND l.classid=0 AND l.objid=97813003 AND l.objsubid=1 AND l.granted`);
        await client.query("ROLLBACK");
        return {ok:false,operation:event.operation,target:"prod",code:"BOOTSTRAP_LEASE_BUSY",blockers:blockers.rows};
      }
    }
    const response = await client.query(operation.sql);
    const results = Array.isArray(response) ? response : [response];
    const rows = results.flatMap((value) => value.rows || []);
    if (rows.length > 10 || Buffer.byteLength(JSON.stringify(rows)) > 16000)
      throw new Error("Unexpected bootstrap receipt size");
    await client.query("COMMIT");
    return { ok: true, operation: event.operation, operationHash: event.operationHash, target: "prod", rows };
  } catch (error) {
    if (connected) await client.query("ROLLBACK").catch(() => {});
    // No event, connection configuration, SQL input or credential is logged.
    return { ok: false, operation: event.operation, target: "prod", code: error.code || error.name };
  } finally {
    await client.end().catch(() => {});
    // The credential exists only in this invocation and its database client.
    event.password = undefined;
    client.password = undefined;
    if (client.connectionParameters) client.connectionParameters.password = undefined;
  }
}
