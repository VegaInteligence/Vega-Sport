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
import { createHandler } from "../src/handler.mjs";

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
  assert.deepEqual(Object.keys(health).sort(), ["conditional", "db", "ms", "path", "queries", "request", "status"]);
  assert.deepEqual([health.request, health.path, health.status, health.queries, health.conditional], ["read", "/api/health", 200, 1, false]);
  assert.equal(typeof health.ms, "number");
  assert.equal(typeof health.db, "number");
  assert.deepEqual([unknown.path, unknown.status, unknown.conditional], ["/api/unknown", 404, true]);
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
  const entry = readFileSync(new URL("../../../infra/aws/api-index.mjs", import.meta.url), "utf8");
  assert.match(entry, /createHandler\(\{[^}]*\blog: console\.log\b[^}]*\}\)/s);
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
