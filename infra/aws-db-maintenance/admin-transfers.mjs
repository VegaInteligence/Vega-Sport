// A separate, expiring IAM-only entrypoint for the two existing admin-owned
// transfer tables. A reviewed preflight is an input to a later explicit write;
// this handler never turns a new observation into automatic authorization.
import pg from "../../dashboard/node_modules/pg/lib/index.js";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  PRODUCTION_HOST, PRODUCTION_DATABASE, transientWindow, transientConfig,
  validateTransientEvent, clearTransientCredential,
} from "./transient-policy.mjs";

const root = process.env.LAMBDA_TASK_ROOT || new URL(".", import.meta.url).pathname;
const manifest = JSON.parse(readFileSync(`${root}/operations.json`, "utf8"));
const definitions = {
  "transfer-owner-preflight": { sql: "SELECT statarena_app.legacy_transfer_preflight($1) AS receipt", mode: "read" },
  "transfer-authorize": { sql: "SELECT statarena_app.legacy_transfer_authorize($1::text[]) AS receipt", mode: "write" },
  "transfer-archive": { sql: "SELECT statarena_app.legacy_transfer_archive($1::jsonb) AS receipt", mode: "write" },
  "transfer-rollback": { sql: "SELECT statarena_app.legacy_transfer_rollback($1::jsonb) AS receipt", mode: "write" },
};
const owners = ["statarena_admin", "statarena_ingest"];
const tables = ["neon_delta_documents", "neon_delta_queue"];
const blockers = ["foreign_keys", "triggers", "rules", "inheritance", "policies", "row_security",
  "publications", "extension_membership", "external_dependencies", "function_text_references"];
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const object = value => value && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const canonical = value => JSON.stringify(value, function (key, item) {
  return object(item) ? Object.fromEntries(Object.keys(item).sort().map(name => [name, item[name]])) : item;
});

function preflight(value, archived = false, allowBlockers = false) {
  if (!exactKeys(value, ["format", "database", "owner", "schema", "schema_owner", "tables"]) ||
      value.format !== "vega.legacy-transfer.v1" || value.database !== PRODUCTION_DATABASE ||
      value.owner !== "statarena_admin" || value.schema_owner !== "statarena_admin" ||
      value.schema !== (archived ? "statarena_legacy_transfer" : "statarena") || !exactKeys(value.tables, tables))
    throw new Error("An exact admin-owned transfer preflight is required");
  for (const table of Object.values(value.tables)) {
    if (!exactKeys(table, ["oid", "rows", "owner", "acl", "catalog_md5", "blockers"]) ||
        table.owner !== "statarena_admin" || typeof table.oid !== "string" || !/^[1-9]\d{0,9}$/.test(table.oid) ||
        typeof table.rows !== "string" || !/^\d{1,20}$/.test(table.rows) ||
        !(table.acl === null || typeof table.acl === "string") ||
        typeof table.catalog_md5 !== "string" || !/^[a-f0-9]{32}$/.test(table.catalog_md5) ||
        !exactKeys(table.blockers, blockers) || Object.values(table.blockers).some(count =>
          !Number.isSafeInteger(count) || count < 0 || (!allowBlockers && count !== 0)))
      throw new Error("The complete reviewed transfer identities, counts and catalogue are required");
  }
  return value;
}

function archivalReceipt(value) {
  if (!exactKeys(value, ["format", "owner", "status", "before", "after"]) ||
      value.format !== "vega.legacy-transfer.receipt.v1" || value.owner !== "statarena_admin" ||
      !["archived", "restored"].includes(value.status))
    throw new Error("The exact admin-owned archival receipt is required");
  preflight(value.before);
  preflight(value.after, true);
  if (canonical(value.after) !== canonical({...value.before, schema: "statarena_legacy_transfer"}))
    throw new Error("The archival receipt changed its reviewed table evidence");
  return value;
}

function parameters(name, value) {
  if (!Array.isArray(value) || value.length !== 1 || Buffer.byteLength(JSON.stringify(value)) > 100000)
    throw new Error("Invalid transfer operation parameters");
  if (name === "transfer-owner-preflight") {
    if (typeof value[0] !== "boolean") throw new Error("Transfer preflight requires a boolean archive selector");
  } else if (name === "transfer-authorize") {
    if (canonical(value[0]) !== canonical(owners)) throw new Error("Only the two existing reviewed owners may be authorized");
  } else {
    let receipt = value[0];
    if (typeof receipt === "string") {
      try { receipt = JSON.parse(receipt); } catch { throw new Error("Invalid transfer receipt JSON"); }
    }
    if (name === "transfer-archive") preflight(receipt);
    else archivalReceipt(receipt);
    return [receipt];
  }
  return value;
}

function validateOperations() {
  const operations = Object.entries(manifest.operations || {});
  if (!operations.length || operations.some(([name, operation]) => {
    const expected = Object.hasOwn(definitions, name) ? definitions[name] : undefined;
    return !expected || !object(operation) || operation.sql !== expected.sql || operation.mode !== expected.mode ||
      operation.parameters !== 1 || operation.maxRows !== 1 || operation.timeoutMs !== 20000 ||
      canonical(operation.targets) !== '["prod"]' || Object.keys(operation).some(key =>
        !["sql", "parameters", "mode", "targets", "timeoutMs", "maxRows", "values"].includes(key));
  })) throw new Error("The admin transfer release must contain only its four fixed operations");
  for (const [name, operation] of operations) {
    if (Object.hasOwn(operation, "values")) parameters(name, operation.values);
  }
}

function verifyResult(name, values, rows) {
  if (rows.length !== 1 || !exactKeys(rows[0], ["receipt"]) || Buffer.byteLength(JSON.stringify(rows)) > 16000)
    throw new Error("Unexpected transfer receipt size or shape");
  const receipt = rows[0].receipt;
  if (name === "transfer-owner-preflight") preflight(receipt, values[0], true);
  else if (name === "transfer-authorize") {
    if (!exactKeys(receipt, ["schema", "authorized_by", "owners"]) || receipt.schema !== "statarena_legacy_transfer" ||
        receipt.authorized_by !== "statarena_admin" || canonical(receipt.owners) !== canonical(owners))
      throw new Error("Unexpected transfer authorization receipt");
  } else {
    archivalReceipt(receipt);
    const original = name === "transfer-archive" ? values[0] : values[0].before;
    const expectedStatus = name === "transfer-archive" ? "archived" : "restored";
    if (receipt.status !== expectedStatus || canonical(receipt.before) !== canonical(original))
      throw new Error("Transfer receipt differs from the explicitly reviewed input");
  }
}

export async function handler(event, context) {
  let client, config, connected = false;
  const started = performance.now();
  try {
    validateTransientEvent(event);
    const expiresAt = transientWindow(manifest, "vega.transient-admin-transfers.v1");
    validateOperations();
    const operation = Object.hasOwn(manifest.operations, event.operation) ? manifest.operations[event.operation] : undefined;
    if (!operation || event.operationHash !== digest(operation)) throw new Error("Unknown transfer operation or release hash mismatch");
    const write = operation.mode === "write";
    if (write && process.env.ALLOW_WRITES !== "true") throw new Error("This transfer worker is read-only");
    const values = parameters(event.operation, event.values ?? operation.values);
    config = transientConfig("statarena_admin");
    config.password = event.password;
    const deadline = Math.min(started + 44000, performance.now() + expiresAt - Date.now(),
      performance.now() + (context?.getRemainingTimeInMillis?.() ?? 46000) - 1000);
    const remaining = () => {
      const budget = Math.floor(deadline - performance.now());
      if (budget <= 0) throw Object.assign(new Error("No time remains for the reviewed transfer operation"), {code: "ADMIN_TRANSFER_DEADLINE"});
      return budget;
    };
    client = new pg.Client({
      host: PRODUCTION_HOST, port: 5432, database: PRODUCTION_DATABASE, user: "statarena_admin", password: config.password,
      ssl: {ca: readFileSync(`${root}/rds-ca.pem`, "utf8"), rejectUnauthorized: true},
      application_name: "vega-refactor-admin-transfers",
      connectionTimeoutMillis: Math.min(8000, remaining()),
      options: "-c statement_timeout=20000 -c lock_timeout=2000 -c idle_in_transaction_session_timeout=30000",
    });
    const rawQuery = (text, values) => client.query({text, values, query_timeout: remaining()});
    const query = async (text, values) => {
      await rawQuery("SELECT set_config('statement_timeout',$1,true)", [String(Math.min(20000, remaining()))]);
      return rawQuery(text, values);
    };
    try {
      await client.connect();
      connected = true;
      await rawQuery(write ? "BEGIN" : "BEGIN READ ONLY");
      const identity = await query("SELECT current_user AS role,current_database() AS database,pg_try_advisory_xact_lock(97813003) AS lease");
      if (identity.rows[0]?.role !== "statarena_admin" || identity.rows[0]?.database !== PRODUCTION_DATABASE)
        throw Object.assign(new Error("Unexpected transfer identity"), {code: "ADMIN_TRANSFER_IDENTITY"});
      if (!identity.rows[0]?.lease) {
        await rawQuery("SAVEPOINT transfer_lease");
        try {
          // lock_timeout bounds the one wait to two seconds. A failed wait
          // aborts only this savepoint, restored before blocker inspection.
          await query("SELECT pg_advisory_xact_lock(97813003)");
          await rawQuery("RELEASE SAVEPOINT transfer_lease");
        } catch (error) {
          if (error.code !== "55P03") throw error;
          await rawQuery("ROLLBACK TO SAVEPOINT transfer_lease");
          await rawQuery("RELEASE SAVEPOINT transfer_lease");
          const blocked = await query(`SELECT a.pid,a.application_name,a.state,a.wait_event_type,a.wait_event,
            extract(epoch FROM now()-a.xact_start)::bigint AS transaction_seconds,
            extract(epoch FROM now()-a.query_start)::bigint AS query_seconds
            FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid
            WHERE l.locktype='advisory' AND l.classid=0 AND l.objid=97813003 AND l.objsubid=1 AND l.granted`);
          await rawQuery("ROLLBACK");
          return {ok: false, operation: event.operation, target: "prod", code: "ADMIN_TRANSFER_LEASE_BUSY", blockers: blocked.rows};
        }
      }
      // Values are bound as values; 026 rechecks the complete receipt under
      // table locks, then moves exactly the existing owner batch atomically.
      const response = await query(operation.sql, values);
      const rows = (Array.isArray(response) ? response : [response]).flatMap(result => result.rows || []);
      verifyResult(event.operation, values, rows);
      await rawQuery("COMMIT");
      return {ok: true, operation: event.operation, operationHash: event.operationHash, target: "prod",
        totalMs: Math.round(performance.now() - started), rows};
    } catch (error) {
      if (connected) await client.query({text: "ROLLBACK", query_timeout: 1000}).catch(() => {});
      // The event, driver error text, SQL values and credentials are never
      // logged or returned. Stable codes suffice for the operator to diagnose.
      const code = /^[A-Z0-9_]{1,40}$/.test(error.code || "") ? error.code : "ADMIN_TRANSFER_FAILED";
      return {ok: false, operation: event.operation, target: "prod", code,
        totalMs: Math.round(performance.now() - started)};
    }
  } finally {
    if (client) {
      await client.end().catch(() => {});
      client.password = undefined;
      if (client.connectionParameters) client.connectionParameters.password = undefined;
    }
    clearTransientCredential(event, config);
  }
}
