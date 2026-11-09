// Shared setup of the contract tests: a seeded local database (test/seed.py), read
// through the production read role. Test files run one at a time (package.json).
import { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createReader } from "../src/db.mjs";
import { createHandler } from "../src/handler.mjs";

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
  context.handle = createHandler({ read: context.reader.read });
});
after(() => context.reader?.end());

export async function get(path, headers = {}) {
  const response = await context.handle(new Request("https://api.test" + path, { headers }));
  const text = response.status === 304 ? "" : await response.text();
  return { response, body: text ? JSON.parse(text) : null };
}
