import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import {
  cloudFrontObjectUrl,
  immutableFile,
} from "../dashboard/backend/services/cdn.js";
import { databaseConnectionOptions } from "../dashboard/backend/services/database-connection.js";

const hash = "a".repeat(64);
const valid = [
  `raw/neon/assets/${hash}.png`,
  `computed/dashboard/items-${hash}.json.gz`,
  `sources/images/${hash}.jpeg`,
];
const invalid = [
  "raw/index.json",
  `raw/.private/${hash}.png`,
  `raw/../${hash}.png`,
  `other/${hash}.json`,
  `raw/neon/${hash}.txt`,
];

test("CloudFront accepts the same immutable files as the application", () => {
  const source = readFileSync(
    new URL("../dashboard/scripts/cloudfront-public-files.js", import.meta.url),
    "utf8",
  );
  const handler = runInNewContext(source + "\nhandler");
  for (const path of valid) {
    assert.equal(immutableFile(path), true);
    const request = { uri: "/data/" + path, method: "GET" };
    assert.equal(handler({ request }), request);
    assert.equal(
      cloudFrontObjectUrl(path, "https://d123.cloudfront.net"),
      `https://d123.cloudfront.net/data/${path}`,
    );
  }
  for (const path of invalid) {
    assert.equal(immutableFile(path), false);
    assert.equal(
      handler({ request: { uri: "/data/" + path, method: "GET" } }).statusCode,
      403,
    );
    assert.throws(() =>
      cloudFrontObjectUrl(path, "https://d123.cloudfront.net"),
    );
  }
  assert.equal(
    handler({ request: { uri: "/data/" + valid[0], method: "PUT" } })
      .statusCode,
    403,
  );
  assert.throws(() =>
    cloudFrontObjectUrl(valid[0], "http://d123.cloudfront.net"),
  );
  assert.throws(() =>
    cloudFrontObjectUrl(valid[0], "https://d123.cloudfront.net/prefix"),
  );
});

test("RDS connections keep hostname verification and use the provided CA", () => {
  const result = databaseConnectionOptions(
    "postgresql://reader:secret@db.example.com/statarena?sslmode=require",
    "CA\\nCERT",
  );
  assert.equal(
    new URL(result.connectionString).searchParams.has("sslmode"),
    false,
  );
  assert.deepEqual(result.ssl, { ca: "CA\nCERT", rejectUnauthorized: true });
  const neon = databaseConnectionOptions(
    "postgresql://reader:secret@db.example.com/statarena?sslmode=require",
  );
  assert.equal(
    new URL(neon.connectionString).searchParams.get("sslmode"),
    "verify-full",
  );
});
