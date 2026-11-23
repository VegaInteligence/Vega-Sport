// The site's server reads of the API carry the edge key that takes them out of the
// distribution's per-address limit (infra/aws/waf.yaml, VI-35); nothing else does.
//
// Failure modes, and what is expected:
// - no key configured (today) -> no header at all: the reads are as before;
// - a malformed key (short, odd characters) -> no header: the web ACL would not match it,
//   and a half-set secret must not be sent around;
// - a key configured -> the home's initial reads and the report's reads send it;
// - the site's /api proxy, which forwards a visitor's request -> never sends it (it would
//   lend the exemption to any visitor);
// - the key reaching the browser -> it is read from VEGA_API_EDGE_KEY (no NEXT_PUBLIC_
//   prefix, never compiled into a page) and only modules under src/server import it.
import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const KEY = "k".repeat(16) + "_-" + "0123456789abcdef";
const HEADER = "x-vega-edge-key";
const site = new URL("../dashboard/frontend/", import.meta.url).pathname;

function withEnv(values, run) {
  const prior = Object.fromEntries(Object.keys(values).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(values)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  return Promise.resolve(run()).finally(() => {
    for (const [k, v] of Object.entries(prior)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  });
}

const sent = (options) => new Headers(options?.headers || {}).get(HEADER);

test("the header follows the key, and only a well-formed one", async () => {
  const { edgeKeyHeaders } = await import("../dashboard/frontend/src/server/api-edge-key.js");
  assert.deepEqual(edgeKeyHeaders({}), {});
  assert.deepEqual(edgeKeyHeaders({ VEGA_API_EDGE_KEY: "" }), {});
  assert.deepEqual(edgeKeyHeaders({ VEGA_API_EDGE_KEY: "short" }), {});
  assert.deepEqual(edgeKeyHeaders({ VEGA_API_EDGE_KEY: KEY + " " }), {});
  assert.deepEqual(edgeKeyHeaders({ VEGA_API_EDGE_KEY: "é".repeat(40) }), {});
  assert.deepEqual(edgeKeyHeaders({ VEGA_API_EDGE_KEY: KEY }), { "X-Vega-Edge-Key": KEY });
});

async function homeReads() {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), key: sent(options) });
    return Response.json({ storage: "other", seasons: [] });
  };
  try {
    const { prepareHomeBootstrap } = await import("../dashboard/frontend/src/server/home-bootstrap.js");
    await prepareHomeBootstrap(new URLSearchParams(), null);
  } finally {
    globalThis.fetch = original;
  }
  return calls;
}

test("the home's initial reads send no key while none is set", async () => {
  await withEnv({ VEGA_API_EDGE_KEY: undefined }, async () => {
    const calls = await homeReads();
    assert.ok(calls.length >= 1);
    for (const c of calls) assert.equal(c.key, null);
  });
});

test("the home's initial reads send the key once it is set", async () => {
  await withEnv({ VEGA_API_EDGE_KEY: KEY }, async () => {
    const calls = await homeReads();
    assert.ok(calls.length >= 1);
    for (const c of calls) assert.equal(c.key, KEY);
  });
});

test("the report's reads send the key once it is set, none before", async () => {
  const { apiGet } = await import("../dashboard/frontend/src/server/report-data.js");
  for (const [value, expected] of [[undefined, null], ["short", null], [KEY, KEY]]) {
    await withEnv({ VEGA_API_EDGE_KEY: value }, async () => {
      let seen;
      await apiGet("/api/status", {}, {
        fetchImpl: async (url, options) => {
          seen = options;
          return Response.json({});
        },
      });
      assert.equal(sent(seen), expected);
      assert.equal(new Headers(seen.headers).get("accept"), "application/json");
    });
  }
});

test("the site's proxy never lends the key to a visitor's request", async () => {
  const original = globalThis.fetch;
  let seen;
  globalThis.fetch = async (url, options) => {
    seen = options;
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    await withEnv({ VEGA_API_EDGE_KEY: KEY, NEXT_PUBLIC_API_ORIGIN: undefined, ORION_API_ORIGIN: "http://127.0.0.1:9" }, async () => {
      const { proxy } = await import("../dashboard/frontend/src/server/bun-proxy.js");
      await proxy(new Request("https://site.test/api/status", { headers: { [HEADER]: "forged" } }));
    });
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(sent(seen), null);
});

async function sources(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await sources(path)));
    else if (/\.(m?js|jsx)$/.test(entry.name)) out.push(path);
  }
  return out;
}

test("the key stays on the server", async () => {
  const files = [...(await sources(join(site, "src"))), ...(await sources(join(site, "app")))];
  const importers = [];
  for (const file of files) {
    const text = await readFile(file, "utf8");
    assert.doesNotMatch(text, /NEXT_PUBLIC_[A-Z_]*EDGE/, file);
    if (/api-edge-key\.js/.test(text)) importers.push(file.slice(site.length));
    if (/VEGA_API_EDGE_KEY/.test(text)) assert.equal(file.slice(site.length), "src/server/api-edge-key.js");
  }
  assert.deepEqual(importers.sort(), ["src/server/home-bootstrap.js", "src/server/report-data.js"]);
});
