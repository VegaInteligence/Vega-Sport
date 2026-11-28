// Shared setup of the contract tests: a seeded local database (test/seed.py), read
// through the production read role. Test files run one at a time (package.json).
import { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createReader } from "../src/db.mjs";
import { createHandler } from "../src/handler.mjs";
import { entityTags } from "../src/http.mjs";
import { routeFamily } from "../src/route-family.mjs";
import { DB_BUDGET_MS, readTiming } from "../../../infra/aws/smoke-public-reads.mjs";

const DSN = process.env.VEGA_V2_API_NODE_TEST_DSN;
export const skip = !DSN && "requires VEGA_V2_API_NODE_TEST_DSN (local vega_v2_api_node_test)";
export const context = {};

before(() => {
  if (skip) return;
  const target = new URL(DSN);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) || target.pathname !== "/vega_v2_api_node_test")
    throw new Error("dedicated local API test DB required");
  const seed = spawnSync("python3", [fileURLToPath(new URL("./seed.py", import.meta.url)), DSN], { encoding: "utf8" });
  assert.equal(seed.status, 0, seed.stderr);
  // The production read role: api schema only.
  context.reader = createReader(DSN, { role: "vega_read" });
  // The home page reads "now": Saturday 6 September 2025, 14:00 in Paris (seed week).
  context.now = Date.parse("2025-09-06T12:00:00Z");
  // Strict (FAILURE_MODES_OPTIMISATIONS.md GH137A-k): a route of the manifest that reads an api relation it does not
  // declare fails the test that asked it.
  context.handle = createHandler({ read: context.reader.read, mediaBase: "https://media.test/", clock: () => context.now, versions: { strict: true } });
});
after(() => context.reader?.end());

// A tag read from the data versions (GH137A): every 200 that carries one is asked again with it, on a handler of its own
// (nothing kept from the first request), and must be a 304 with the same tag and freshness, in one statement.
// league-history's own tag (GH137: league-history-v2-<resource>-<digest>) has the same shape and is not one.
const VERSIONED = /^W\/"(?!league-history-)[a-z][a-z-]*-v2-[a-f0-9]{16}-[a-f0-9]{64}"$/;
/** GH137A-v (RFC 9110 § 13.1.2, RFC 9111 § 4.3.4): a 304 to a request that names tags carries one of them. */
export function heldTag(requestHeaders, response) {
  if (response.status !== 304) return;
  const name = Object.keys(requestHeaders).find((key) => key.toLowerCase() === "if-none-match");
  const held = entityTags(name ? requestHeaders[name] : null);
  if (!held || held.any) return;
  const sent = (response.headers.get("etag") || "").replace(/^W\//, "");
  assert.ok(held.tags.includes(sent), `a 304 whose tag ${response.headers.get("etag")} the request did not hold (${requestHeaders[name]})`);
}
async function revalidated(path, headers, first) {
  const statements = [];
  const handle = createHandler({
    read: (sql, ...rest) => (statements.push(sql), context.reader.read(sql, ...rest)), mediaBase: "https://media.test/", clock: () => context.now,
    versions: { strict: true },
  });
  const asked = { ...headers, "if-none-match": first.headers.get("etag") };
  const again = await handle(new Request("https://api.test" + path, { headers: asked }));
  heldTag(asked, again);
  assert.equal(again.status, 304, `${path}: its own tag, asked again, gave ${again.status}`);
  assert.equal(again.headers.get("etag"), first.headers.get("etag"), `${path}: the 304's tag`);
  assert.equal(again.headers.get("cache-control"), first.headers.get("cache-control"), `${path}: the 304's freshness`);
  assert.equal(statements.length, 1, `${path}: the 304 ran ${statements.length} statements`);
  assert.match(statements[0], /api\.data_version\(/, `${path}: the 304's statement is the version`);
}

/** A handler of its own on the test base whose statements are recorded (GH141): `ask(path, headers, method)` gives the
 * status, tag, freshness, Server-Timing, body (null for a 304 or a HEAD) and the statements the request ran. */
export function counting() {
  const statements = [];
  const handle = createHandler({
    read: (sql, ...rest) => (statements.push(sql), context.reader.read(sql, ...rest)), mediaBase: "https://media.test/", clock: () => context.now,
    versions: { strict: true },
  });
  return async (path, headers = {}, method = "GET") => {
    statements.length = 0;
    const response = await handle(new Request("https://api.test" + path, { headers, method }));
    heldTag(headers, response);
    const text = response.status === 304 || method === "HEAD" ? "" : await response.text();
    return {
      status: response.status, etag: response.headers.get("etag"), cache: response.headers.get("cache-control"),
      timing: response.headers.get("server-timing"), body: text ? JSON.parse(text) : null, statements: [...statements],
    };
  };
}

export async function get(path, headers = {}) {
  const response = await context.handle(new Request("https://api.test" + path, { headers }));
  heldTag(headers, response);
  const text = response.status === 304 ? "" : await response.text();
  const conditional = Object.keys(headers).some((name) => name.toLowerCase() === "if-none-match");
  const scenarios = process.env.VEGA_PUBLIC_READ_COVERAGE;
  if (scenarios && !conditional) {
    const timing = readTiming(response.headers.get("server-timing"));
    appendFileSync(scenarios, JSON.stringify({
      path, family: routeFamily(new URL(path, "https://api.test").pathname), status: response.status,
      bytes: Buffer.byteLength(text), ...timing,
    }) + "\n");
    if (response.status === 200) {
      assert.ok(timing, `${path}: Server-Timing missing`);
      assert.ok(timing.dbMs <= DB_BUDGET_MS, `${path}: SQL budget of ${DB_BUDGET_MS} ms, measured ${timing.dbMs} ms`);
    }
  }
  if (response.status === 200 && VERSIONED.test(response.headers.get("etag") || "") && !conditional) await revalidated(path, headers, response);
  return { response, body: text ? JSON.parse(text) : null };
}
