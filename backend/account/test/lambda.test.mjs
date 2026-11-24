// The two Lambda entries (lambda/front-index.mjs, lambda/store-index.mjs) load offline, with
// no AWS SDK installed and no configuration, and answer predictably (FAILURE_MODES.md H15, D1):
// what a packaging check can run before an upload. Each runs in a child process with an empty
// environment, as a new copy of the function would start.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
function run(script) {
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], { cwd: root, env: { PATH: process.env.PATH, LAMBDA_TASK_ROOT: root }, encoding: "utf8" });
  return JSON.parse(out.trim().split("\n").pop());
}

test("the front's entry loads without configuration and answers 503 NOT_CONFIGURED", () => {
  const out = run(`import { handler } from './lambda/front-index.mjs';
const res = await handler({ version: '2.0', rawPath: '/account/session', rawQueryString: '', headers: {}, requestContext: { http: { method: 'POST' } } });
console.log(JSON.stringify(res));`);
  assert.equal(out.statusCode, 503);
  assert.equal(JSON.parse(out.body).error.code, "NOT_CONFIGURED");
  assert.equal(out.headers["cache-control"], "no-store");
});

test("the store's entry loads without a database and refuses every command", () => {
  const out = run(`import { handler } from './lambda/store-index.mjs';
console.log(JSON.stringify(await handler({ command: 'session', accountId: 'a1' })));`);
  assert.deepEqual(out, { ok: false, code: "NOT_CONFIGURED", message: "V2_ACCOUNT_DATABASE_URL is not set" });
});
