import pg from "pg";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { measuring, record, timeSync, observeVersion } from "./metrics.js";
let pool, storage;
export const configured = () =>
  Boolean(process.env.NEON_DATABASE_URL && process.env.NEON_STORAGE_ENDPOINT);
export function database() {
  if (!process.env.NEON_DATABASE_URL) throw new Error("Neon is not configured");
  const url = new URL(process.env.NEON_DATABASE_URL);
  url.searchParams.set("sslmode", "verify-full");
  if (pool) return pool;
  pool = new pg.Pool({
    connectionString: url.href,
    max: 3,
    allowExitOnIdle: true,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 10000,
    maxLifetimeSeconds: 300,
    application_name: "statarena-runtime",
    query_timeout: 15000,
  });
  pool.on("error", (e) => console.error("Neon idle connection error", e.code));
  return pool;
}
export async function query(sql, values = []) {
  if (!measuring()) return (await database().query(sql, values)).rows;
  const poolStart = performance.now();
  let client;
  record("sql_count");
  try {
    client = await database().connect();
    record("pool_wait_ms", performance.now() - poolStart);
    const start = performance.now();
    let result;
    try {
      result = await client.query(sql, values);
    } finally {
      record("sql_ms", performance.now() - start);
    }
    record("sql_rows", result.rows.length);
    for (const row of result.rows) {
      const { body, ...metadata } = row;
      record(
        "sql_metadata_bytes_estimate",
        Buffer.byteLength(JSON.stringify(metadata)),
      );
      if (Buffer.isBuffer(body)) record("sql_body_bytes", body.length);
      // Do not stringify jsonb bodies merely to measure them.
      else if (body !== undefined && body !== null) record("sql_json_rows");
    }
    return result.rows;
  } catch (error) {
    if (!client) record("pool_wait_ms", performance.now() - poolStart);
    record("sql_errors");
    throw error;
  } finally {
    client?.release();
  }
}
export const canonical = (params = {}) =>
  JSON.stringify(
    Object.fromEntries(
      Object.entries(params).sort(([a], [b]) => a.localeCompare(b)),
    ),
  );
// Byte-bounded LRU with coalescing; failed loads are never retained.
export function cache(limit, { name = "local" } = {}) {
  const entries = new Map(),
    pending = new Map();
  let bytes = 0;
  async function load(key, loader, ttl = 30000) {
    const old = entries.get(key);
    if (old && old.until > Date.now()) {
      record(`cache_${name}_hit`);
      entries.delete(key);
      entries.set(key, old);
      return old.value;
    }
    if (old) {
      record(`cache_${name}_expired`);
      bytes -= old.size;
      entries.delete(key);
    }
    if (pending.has(key)) {
      record(`cache_${name}_coalesced`);
      return pending.get(key);
    }
    record(`cache_${name}_miss`);
    const promise = (async () => {
      const value = await loader();
      const size = timeSync("cache_size_ms", () =>
        Buffer.isBuffer(value)
          ? value.length
          : value?.body && Buffer.isBuffer(value.body)
            ? value.body.length + 512
            : Buffer.byteLength(JSON.stringify(value) ?? "null"),
      );
      // Inadmissible entries must not evict useful retained content.
      if (size > limit) {
        record(`cache_${name}_rejected`);
        return value;
      }
      while (entries.size && bytes + size > limit) {
        const first = entries.keys().next().value;
        bytes -= entries.get(first).size;
        entries.delete(first);
        record(`cache_${name}_evicted`);
      }
      entries.set(key, { value, size, until: Date.now() + ttl });
      bytes += size;
      return value;
    })();
    pending.set(key, promise);
    try {
      return await promise;
    } finally {
      pending.delete(key);
    }
  }
  // In-flight loads still coalesce; completed stale metadata can be refreshed.
  load.delete = (key) => {
    const old = entries.get(key);
    if (!old) return;
    bytes -= old.size;
    entries.delete(key);
    record(`cache_${name}_invalidated`);
  };
  return load;
}
const metadata = cache(24 * 1024 * 1024, { name: "metadata" }),
  bodies = cache(64 * 1024 * 1024, { name: "body" });
export async function objectMeta(path, { fresh = false } = {}) {
  if (
    !/^(raw|computed|sources)\/[A-Za-z0-9_./-]+$/.test(path) ||
    path.split("/").some((p) => p.startsWith("."))
  )
    throw new Error("Invalid data path");
  if (fresh) metadata.delete(path);
  const meta = await metadata(
    path,
    async () =>
      (
        await query(
          "SELECT path,size,encode(sha256,'hex') AS sha256,etag,content_type,body IS NOT NULL AS inline FROM statarena.objects WHERE path=$1",
          [path],
        )
      )[0] || null,
  );
  if (meta) observeVersion(meta.sha256);
  return meta;
}
export async function objectBody(meta) {
  return bodies(
    meta.sha256,
    async () => {
      let body;
      if (meta.inline) {
        const row = (
          await query(
            "SELECT body FROM statarena.objects WHERE path=$1 AND sha256=decode($2,'hex') AND body IS NOT NULL",
            [meta.path, meta.sha256],
          )
        )[0];
        if (!row) {
          const error = new Error("Neon object version changed");
          error.code = "ESTALE";
          throw error;
        }
        body = row.body;
      } else {
        storage ||= new S3Client({
          endpoint: process.env.NEON_STORAGE_ENDPOINT,
          region: process.env.NEON_STORAGE_REGION || "us-east-2",
          forcePathStyle: true,
          credentials: {
            accessKeyId: process.env.NEON_STORAGE_ACCESS_KEY_ID,
            secretAccessKey: process.env.NEON_STORAGE_SECRET_ACCESS_KEY,
          },
          requestChecksumCalculation: "WHEN_REQUIRED",
          responseChecksumValidation: "WHEN_REQUIRED",
          maxAttempts: 3,
        });
        const objectStart = performance.now();
        try {
          const result = await storage.send(
            new GetObjectCommand({
              Bucket: process.env.NEON_STORAGE_BUCKET || "statarena-data",
              Key: "data/" + meta.path,
            }),
            { abortSignal: AbortSignal.timeout(20000) },
          );
          body = Buffer.from(await result.Body.transformToByteArray());
          record("object_bytes", body.length);
        } catch (error) {
          record("object_errors");
          throw error;
        } finally {
          record("object_ms", performance.now() - objectStart);
        }
      }
      if (
        body.length !== Number(meta.size) ||
        timeSync("integrity_ms", () =>
          createHash("sha256").update(body).digest("hex"),
        ) !== meta.sha256
      )
        throw new Error("Neon object integrity failure");
      return body;
    },
    15 * 60 * 1000,
  );
}
