// The client of Neon's API that deletes a user (src/neon.mjs). Failure modes:
// FAILURE_MODES.md, section 9 (X3, X5, X6). No network: the fetch is injected.
// The endpoint is the one Neon documents (DELETE …/projects/{p}/branches/{b}/auth/users/{id});
// it was not called for real (no Neon project exists yet).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createNeonUsers, neonFromEnv } from "../src/neon.mjs";

const settings = { apiKey: "napi_test_key_0123456789", projectId: "proud-sun-123456", branchId: "br-cool-dew-a1b2c3" };
function recorder(status) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    if (status instanceof Error) throw status;
    return new Response(status === 204 ? null : "{}", { status });
  };
  return { calls, fetch };
}

test("the user is deleted with one authenticated DELETE on Neon's documented path", async () => {
  const r = recorder(200);
  const out = await createNeonUsers({ ...settings, fetch: r.fetch }).deleteUser("0b9e7a52-5c1e-4c8e-9a52-2f7f0c8f5d11");
  assert.deepEqual(out, { ok: true, status: 200 });
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0].url, "https://console.neon.tech/api/v2/projects/proud-sun-123456/branches/br-cool-dew-a1b2c3/auth/users/0b9e7a52-5c1e-4c8e-9a52-2f7f0c8f5d11");
  assert.equal(r.calls[0].init.method, "DELETE");
  assert.equal(r.calls[0].init.headers.authorization, `Bearer ${settings.apiKey}`);
  assert.equal(r.calls[0].init.redirect, "error");
  assert.ok(r.calls[0].init.signal);
});

test("X6: 204 and 404 are success; the user is gone", async () => {
  for (const status of [204, 404]) assert.deepEqual(await createNeonUsers({ ...settings, fetch: recorder(status).fetch }).deleteUser("u1"), { ok: true, status });
});

test("X5: failures say whether a retry can help", async () => {
  for (const [status, retry] of [[503, true], [500, true], [502, true], [423, true], [429, true], [401, false], [403, false], [400, false], [409, false]])
    assert.deepEqual(await createNeonUsers({ ...settings, fetch: recorder(status).fetch }).deleteUser("u1"), { ok: false, status, retry }, String(status));
  assert.deepEqual(await createNeonUsers({ ...settings, fetch: recorder(new TypeError("fetch failed")).fetch }).deleteUser("u1"), { ok: false, status: 0, retry: true });
  const slow = (url, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason)));
  assert.deepEqual(await createNeonUsers({ ...settings, fetch: slow, timeoutMs: 20 }).deleteUser("u1"), { ok: false, status: 0, retry: true });
});

test("an id that is not an account id is never put in the path", async () => {
  const r = recorder(200);
  for (const id of ["../projects", "a/b", "", "x".repeat(65)]) await assert.rejects(createNeonUsers({ ...settings, fetch: r.fetch }).deleteUser(id));
  assert.equal(r.calls.length, 0);
});

test("X3: no API key, project or branch configured: no client at all", () => {
  assert.equal(neonFromEnv({}), null);
  assert.equal(neonFromEnv({ VEGA_NEON_API_KEY: settings.apiKey, VEGA_NEON_PROJECT_ID: settings.projectId }), null);
  assert.equal(neonFromEnv({ VEGA_NEON_API_KEY: "", VEGA_NEON_PROJECT_ID: settings.projectId, VEGA_NEON_BRANCH_ID: settings.branchId }), null);
  assert.ok(neonFromEnv({ VEGA_NEON_API_KEY: settings.apiKey, VEGA_NEON_PROJECT_ID: settings.projectId, VEGA_NEON_BRANCH_ID: settings.branchId }));
  for (const bad of [{ projectId: "a/b" }, { branchId: "../x" }]) assert.throws(() => createNeonUsers({ ...settings, ...bad, fetch: recorder(200).fetch }));
});
