// What the distribution is told about an answer, and what the function logs of a request.
//
// Failure modes these tests pin (incident of 20 November 2026, VI-33: the base refused
// the function's connections, every refusal was shown as a 503):
// - the distribution was forbidden to answer with what it held when the function failed
//   (`stale-if-error=0` added to every answer, the home's 24 hours included);
// - `must-revalidate` forbids a shared cache the same thing, whatever else is said;
// - an error, a personal answer or an answer never to be kept must stay as they are;
// - nothing said which reads reach the function, or how many only ask "unchanged?".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { adapt } from "../../../infra/aws/transport.mjs";
import { createReader } from "../src/db.mjs";
import { createHandler } from "../src/handler.mjs";
import { gate, standIn, until } from "./pg-stand-in.mjs";

const LINE_KEYS = ["conditional", "connect", "db", "dbOpens", "dbReopens", "ms", "path", "queries", "reconnect", "request", "route", "status"];

const event = (path = "/api/x", headers = {}) => ({
  version: "2.0",
  rawPath: path,
  rawQueryString: "",
  headers,
  requestContext: { http: { method: "GET" } },
});
const answering = (cacheControl, status = 200) =>
  adapt(async () => new Response(status === 304 ? null : "{}", { status, headers: cacheControl === null ? {} : { "Cache-Control": cacheControl } }));
const cacheControl = async (value, status) => (await answering(value, status)(event())).headers["cache-control"];
const directives = (value) => value.split(",").map((part) => part.trim());

test("a public answer may be served from the distribution's copy for a day when the function fails", async () => {
  const value = await cacheControl("public, max-age=0, s-maxage=15, must-revalidate");
  assert.deepEqual(directives(value), ["public", "max-age=0", "s-maxage=15", "stale-if-error=86400"]);
});

test("an answer that says how long it may be served on an error keeps its own word, once", async () => {
  const home = "public, max-age=0, s-maxage=60, stale-while-revalidate=300, stale-if-error=86400";
  assert.equal(await cacheControl(home), home);
  const short = "public, max-age=0, s-maxage=60, stale-if-error=600";
  assert.equal(await cacheControl(short), short);
});

test("an answer kept for good, and an unchanged one, carry the same permission", async () => {
  assert.deepEqual(directives(await cacheControl("public, max-age=31536000, s-maxage=31536000, immutable")), [
    "public",
    "max-age=31536000",
    "s-maxage=31536000",
    "immutable",
    "stale-if-error=86400",
  ]);
  assert.match(await cacheControl("public, max-age=0, s-maxage=15, must-revalidate", 304), /^public, max-age=0, s-maxage=15, stale-if-error=86400$/);
});

test("an error, a personal answer and an answer without a word on caching are never kept for later", async () => {
  assert.equal(await cacheControl("no-store", 503), "no-store");
  assert.equal(await cacheControl(null), "no-store");
  // One visitor's answer: the browser revalidates it, no shared cache holds it.
  assert.equal(await cacheControl("private, max-age=0, must-revalidate"), "private, max-age=0, must-revalidate");
});

test("each request leaves one line: its path without its question, its status, its times, whether it only asked \"unchanged?\"", async () => {
  const lines = [];
  const handle = createHandler({
    read: async () => [{ revision: "7", ready: true }],
    log: (line) => lines.push(line),
  });
  const first = await handle(new Request("https://api.test/api/health"));
  assert.equal(first.status, 200);
  await handle(new Request("https://api.test/api/unknown?player=p_secret", { headers: { "If-None-Match": 'W/"x"' } }));
  assert.equal(lines.length, 2);
  const [health, unknown] = lines.map((line) => JSON.parse(line));
  // GH204 (FAILURE_MODES_OPTIMISATIONS.md): its route too, `other` for a path no route serves; GH140: whether it opened
  // the copy's connection (a read without a pool opens none).
  assert.deepEqual(Object.keys(health).sort(), LINE_KEYS);
  assert.deepEqual([health.request, health.path, health.route, health.status, health.queries, health.conditional], ["read", "/api/health", "health", 200, 1, false]);
  assert.deepEqual([health.connect, health.reconnect, health.dbOpens, health.dbReopens], [false, false, 0, 0]);
  assert.equal(typeof health.ms, "number");
  assert.equal(typeof health.db, "number");
  assert.deepEqual([unknown.path, unknown.route, unknown.status, unknown.conditional], ["/api/unknown", "other", 404, true]);
  assert.ok(!lines[1].includes("p_secret"));
});

test("only the function logs: a handler made without a log writes nothing (scripts read its answers on stdout)", async () => {
  const written = [];
  const original = console.log;
  console.log = (...args) => written.push(args);
  try {
    const handle = createHandler({ read: async () => [{ revision: "7", ready: true }] });
    assert.equal((await handle(new Request("https://api.test/api/health"))).status, 200);
  } finally {
    console.log = original;
  }
  assert.deepEqual(written, []);
  // The function's line goes to stdout as a JSON line of its own (GH204: no runtime prefix, for alerts.yaml's rule).
  const entry = readFileSync(new URL("../../../infra/aws/api-index.mjs", import.meta.url), "utf8");
  assert.match(entry, /createHandler\(\{[^}]*\blog: \(line\) => process\.stdout\.write\(line \+ "\\n"\)[^}]*\}\)/s);
});

test("a log that fails takes no answer with it", async () => {
  const handle = createHandler({
    read: async () => [{ revision: "7", ready: true }],
    log: () => {
      throw new Error("log unavailable");
    },
  });
  assert.equal((await handle(new Request("https://api.test/api/health"))).status, 200);
});

// GH140 (FAILURE_MODES_OPTIMISATIONS.md, written before these tests): the reader of api-index.mjs (one connection) on
// pg-pool's own pool over a stand-in for pg's client (pg-stand-in.mjs), the line of each request.
const HEALTHY = [{ revision: "7", ready: true }];
function copy(t, answer) {
  const { Pool, base } = standIn(answer);
  const reader = createReader("postgresql://vega_reader:s3cret@db.internal:5432/vega_v2", { Pool, max: 1, role: "vega_read", idleSessionMs: 120_000 });
  t.after(() => void reader.end().catch(() => {}));
  return { reader, base };
}
const opening = (line) => [line.status, line.queries, line.connect, line.reconnect, line.dbOpens, line.dbReopens];

test("GH140-a–c, f, l: each line says whether its request opened the copy's connection, for the request that asked", async (t) => {
  const held = gate();
  let asked = 0;
  const refused = Object.assign(new Error("canceling statement due to statement timeout"), { severity: "ERROR", code: "57014" });
  const { reader, base } = copy(t, () => (asked++ === 0 ? held.then(() => refused) : HEALTHY));
  const lines = [];
  const handle = createHandler({ read: reader.read, log: (line) => lines.push(line) });
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args);
  try {
    // A asks first and holds the one connection; B waits for it. The base refuses A's statement: A's connection is
    // dropped, and B's is opened inside A's callback, in A's async context.
    const a = handle(new Request("https://api.test/api/health"));
    const b = handle(new Request("https://api.test/api/health"));
    await until(() => base.sent.length === 1);
    held.open();
    assert.deepEqual([(await a).status, (await b).status], [503, 200]);
  } finally {
    console.error = original;
  }
  // The refusal's own line, as before (alerts.yaml counts it); the request line says none of it.
  assert.deepEqual(errors, [["read failed", "57014", "/api/health"]]);
  const [la, lb] = lines.map((line) => JSON.parse(line));
  assert.deepEqual(opening(la), [503, 1, true, false, 1, 0], "f: A opened the copy's first connection");
  assert.deepEqual(opening(lb), [200, 1, true, true, 1, 1], "f: B's connection is B's");
  // b: the next request reuses B's connection; c: a request without a statement opens none.
  assert.equal((await handle(new Request("https://api.test/api/health"))).status, 200);
  assert.equal((await handle(new Request("https://api.test/api/status"))).status, 200);
  const [warm, none] = lines.slice(2).map((line) => JSON.parse(line));
  assert.deepEqual(opening(warm), [200, 1, false, false, 0, 0], "b");
  assert.deepEqual(opening(none), [200, 0, false, false, 0, 0], "c");
  assert.deepEqual(base.clients.length, 2);
  // l: the line's keys, booleans and integers only; nothing of the statement, its values, the error or the connection.
  for (const line of lines) {
    const parsed = JSON.parse(line);
    assert.deepEqual(Object.keys(parsed).sort(), LINE_KEYS);
    for (const key of ["connect", "reconnect"]) assert.equal(typeof parsed[key], "boolean", key);
    for (const key of ["dbOpens", "dbReopens"]) assert.ok(Number.isInteger(parsed[key]), key);
    for (const leak of ["SELECT", "publication", "canceling", "57014", "s3cret", "vega_reader", "db.internal", "vega_v2", "role"])
      assert.ok(!line.includes(leak), `${leak} in ${line}`);
  }
});

test("GH140-k: a log that throws, the counts wired, takes no answer with it; without a log no count is asked", async (t) => {
  const { reader } = copy(t, () => HEALTHY);
  const handle = createHandler({
    read: reader.read,
    log: () => {
      throw new Error("log unavailable");
    },
  });
  const response = await handle(new Request("https://api.test/api/health"));
  assert.deepEqual([response.status, await response.json()], [200, { source: "AWS", status: "ok", revision: "7", release: null }]);
  // Without a log, each statement reaches the reader as its route sent it; with one, it carries its request's count.
  const seen = [];
  const answer = async (...args) => (seen.push(args), HEALTHY);
  await createHandler({ read: answer })(new Request("https://api.test/api/health"));
  await createHandler({ read: answer, log: () => {} })(new Request("https://api.test/api/health"));
  assert.deepEqual(seen.map((args) => args.length), [1, 3]);
  assert.equal(typeof seen[1][2].opened, "function");
});
