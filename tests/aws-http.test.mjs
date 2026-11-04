import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(
  new URL("../dashboard/package.json", import.meta.url),
);
const pg = require("pg");
const { S3Client } = require("@aws-sdk/client-s3");
const originalQuery = pg.Pool.prototype.query;
const originalSend = S3Client.prototype.send;
const files = new Map();
let objectReads = 0;

process.env.NEON_DATABASE_URL = "postgresql://reader:test@localhost/statarena";
process.env.NEON_STORAGE_ENDPOINT = "https://s3.us-east-2.amazonaws.com";
process.env.NEON_STORAGE_BUCKET = "statarena-test";
process.env.NEON_STORAGE_ACCESS_KEY_ID = "test";
process.env.NEON_STORAGE_SECRET_ACCESS_KEY = "test";
process.env.STATARENA_EXTERNAL_STORAGE = "1";
process.env.STATARENA_CLOUDFRONT_URL = "https://d123.cloudfront.net";

pg.Pool.prototype.query = async function (sql, values) {
  if (sql.startsWith("SELECT path,size")) {
    const row = files.get(values[0]);
    return { rows: row ? [{ ...row.meta }] : [] };
  }
  throw new Error("Unexpected SQL: " + sql);
};
S3Client.prototype.send = async function (command) {
  objectReads++;
  const key = command.input.Key.replace(/^data\//, "");
  const row = files.get(key);
  if (!row) throw Object.assign(new Error("missing"), { name: "NoSuchKey" });
  return { Body: { transformToByteArray: async () => row.bytes } };
};
const { publicFile } = await import("../dashboard/backend/services/files.js");
const makeFile = (path, content, inline = true) => {
  const bytes = Buffer.from(content);
  files.set(path, {
    bytes,
    meta: {
      path,
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      etag: "ignored",
      content_type: "application/json",
      inline,
    },
  });
};
test.after(() => {
  pg.Pool.prototype.query = originalQuery;
  S3Client.prototype.send = originalSend;
});

test("content-addressed assets redirect to CloudFront without reading S3", async () => {
  const path = "raw/neon/assets/" + "a".repeat(64) + ".png";
  makeFile(path, "test asset");
  const out = await publicFile(
    path,
    new Request("https://site.test/api/assets?url=x"),
    { mutableAlias: true },
  );
  assert.equal(out.status, 307);
  assert.equal(
    out.headers.get("location"),
    `https://d123.cloudfront.net/data/${path}`,
  );
  assert.equal(out.headers.get("cache-control"), "private, no-store");
  assert.equal(objectReads, 0);
});

test("mutable files stay in the application and read the external bucket", async () => {
  const path = "raw/index.json";
  makeFile(path, '{"version":1}');
  const out = await publicFile(
    path,
    new Request("https://site.test/data/raw/index.json"),
  );
  assert.equal(out.status, 200);
  assert.equal(await out.text(), '{"version":1}');
  assert.equal(objectReads, 1);
});

test("HEAD and conditional GET keep existing behavior", async () => {
  const path = "raw/neon/assets/" + "b".repeat(64) + ".png";
  makeFile(path, "different asset");
  const head = await publicFile(
    path,
    new Request("https://site.test/data/file", { method: "HEAD" }),
  );
  assert.equal(head.status, 200);
  assert.equal(
    head.headers.get("content-length"),
    String(Buffer.byteLength("different asset")),
  );
  const notModified = await publicFile(
    path,
    new Request("https://site.test/data/file", {
      headers: { "If-None-Match": head.headers.get("etag") },
    }),
  );
  assert.equal(notModified.status, 304);
  assert.equal(objectReads, 1);
});
