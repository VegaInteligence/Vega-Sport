import pg from "pg";
import { readFileSync } from "node:fs";
import { databaseConnectionOptions } from "./database-connection.js";
import { measuring, record } from "./metrics.js";
export { cache } from "./cache.js";

let pool;
const awsMode = () =>
  process.env.STATARENA_PRO_API === "1" ||
  process.env.STATARENA_DATA_PROVIDER?.toLowerCase() === "aws" ||
  Boolean(process.env.DATABASE_URL);
const sourceUrl = () =>
  awsMode() ? process.env.DATABASE_URL : process.env.NEON_DATABASE_URL;
export const dataProvider = () =>
  process.env.STATARENA_DATA_PROVIDER ||
  (process.env.DATABASE_URL ? "AWS" : "Neon");
export const configured = () => Boolean(sourceUrl());
export const canonical = (params = {}) =>
  JSON.stringify(
    Object.fromEntries(
      Object.entries(params).sort(([a], [b]) => a.localeCompare(b)),
    ),
  );

export function database() {
  if (pool) return pool;
  if (!sourceUrl())
    throw new Error("The application database is not configured");
  const url = new URL(sourceUrl());
  if (!["postgres:", "postgresql:"].includes(url.protocol))
    throw new Error("Invalid PostgreSQL configuration");
  const localTest =
    process.env.STATARENA_TEST_DATABASE === "1" &&
    ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  if (awsMode() && !localTest && !url.hostname.endsWith(".rds.amazonaws.com"))
    throw new Error("AWS mode requires the RDS database endpoint");
  const maximum = Number(process.env.DATABASE_POOL_MAX || 1);
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > 8)
    throw new Error("Invalid database pool limit");
  // Startup options apply before a connection is leased. No asynchronous SET race.
  url.searchParams.set(
    "options",
    "-c default_transaction_read_only=on -c statement_timeout=8000 -c lock_timeout=1000 -c idle_in_transaction_session_timeout=5000",
  );
  let options;
  if (localTest && url.searchParams.get("sslmode") === "disable") {
    url.searchParams.delete("sslmode");
    options = { connectionString: url.href, ssl: false };
  } else {
    let ca =
      process.env.DATABASE_CA_PEM || process.env.STATARENA_DATABASE_CA_PEM;
    if (!ca && url.hostname.endsWith(".rds.amazonaws.com"))
      ca = readFileSync(
        new URL("../certs/rds-us-east-2.pem", import.meta.url),
        "utf8",
      );
    options = databaseConnectionOptions(url.href, ca);
  }
  pool = new pg.Pool({
    ...options,
    max: maximum,
    allowExitOnIdle: true,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10000,
    maxLifetimeSeconds: 300,
    query_timeout: 10000,
    application_name: "statarena-api",
  });
  pool.on("error", (error) =>
    console.error("Database idle connection error", error.code || error.name),
  );
  return pool;
}

export async function query(sql, values = []) {
  const sampled = measuring(),
    started = performance.now();
  if (sampled) record("sql_count");
  let client;
  try {
    client = await database().connect();
    if (sampled) record("pool_wait_ms", performance.now() - started);
    const start = performance.now();
    let result;
    try {
      result = await client.query(sql, values);
    } finally {
      if (sampled) record("sql_ms", performance.now() - start);
    }
    if (sampled) {
      record("sql_rows", result.rows.length);
      for (const row of result.rows) {
        if (Buffer.isBuffer(row.body))
          record("sql_body_bytes", row.body.length);
        else if (row.body !== undefined && row.body !== null)
          record("sql_json_rows");
      }
    }
    return result.rows;
  } catch (error) {
    if (sampled) record("sql_errors");
    throw error;
  } finally {
    client?.release();
  }
}

export async function closeDatabase() {
  const current = pool;
  pool = undefined;
  if (current) await current.end();
}
