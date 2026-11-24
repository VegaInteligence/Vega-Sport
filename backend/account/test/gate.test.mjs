// The gate: the decision taken on every request before the shared cache.
// Failure modes pinned here: backend/account/FAILURE_MODES.md, section 2 (G1 to G16).
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createKeyring, signPass } from "../src/pass.mjs";
import { ACCESS_RULES } from "../src/access-rules.mjs";
import { compileRules, decide, minimumLevel, normalisePath } from "../src/gate.mjs";

const NOW = 1_795_000_000;
const ring = createKeyring({ current: "k1", keys: { k1: randomBytes(32) } });
const rules = compileRules([
  { prefix: "/api/plus", level: 2 },
  { prefix: "/api/plus/pro-only", level: 3 },
  { prefix: "/api/read/player-advanced", level: 2 },
]);
const pass = (level, at = NOW) => signPass({ accountId: "acc_1", level, now: at }, ring);
/** `held`: the value of the X-Vega-Pass header; undefined, no header. */
const ask = (path, held, method = "GET", headers = {}) =>
  decide({ method, path, headers: { ...(held === undefined ? {} : { "x-vega-pass": held }), ...headers } }, { rules, keyring: ring, now: NOW });
const body = (decision) => JSON.parse(decision.body);

test("G1: a public read without a pass goes through as today", () => {
  assert.deepEqual(ask("/api/read/home"), { action: "forward", level: 0, minimum: 0 });
});

test("G2: a public read with a stale or forged pass goes through as a visitor", () => {
  assert.deepEqual(ask("/api/read/home", pass(2, NOW - 3600)), { action: "forward", level: 0, minimum: 0 });
  assert.deepEqual(ask("/api/read/home", "a.b.c"), { action: "forward", level: 0, minimum: 0 });
  assert.deepEqual(ask("/api/read/home", pass(3)), { action: "forward", level: 3, minimum: 0 });
});

test("G3: a reserved read without a pass is refused before the origin, and says what it needs", () => {
  const refused = ask("/api/plus/match-analysis");
  assert.equal(refused.action, "respond");
  assert.equal(refused.status, 401);
  assert.deepEqual(body(refused), { ok: false, available: false, error: { code: "PASS_REQUIRED", message: "Connexion requise.", retry: false, minimumLevel: 2 } });
});

test("G4: an expired pass on a reserved read asks the site to renew it", () => {
  const refused = ask("/api/plus/match-analysis", pass(2, NOW - 3600));
  assert.equal(refused.status, 401);
  assert.equal(body(refused).error.code, "PASS_EXPIRED");
  assert.equal(body(refused).error.retry, true);
});

test("G5: any other invalid pass is refused without saying why", () => {
  const other = createKeyring({ current: "k1", keys: { k1: randomBytes(32) } });
  const forged = signPass({ accountId: "acc_1", level: 3, now: NOW }, other);
  for (const held of [forged, "a.b.c", "x".repeat(2000), "Bearer"]) {
    const refused = ask("/api/plus/match-analysis", held);
    assert.equal(refused.status, 401);
    assert.deepEqual(body(refused).error, { code: "PASS_INVALID", message: "Connexion requise.", retry: false, minimumLevel: 2 });
  }
});

test("G6: a level below the minimum is refused with the level that opens the read", () => {
  const refused = ask("/api/plus/match-analysis", pass(1));
  assert.equal(refused.status, 403);
  assert.deepEqual(body(refused).error, { code: "LEVEL_REQUIRED", message: "Offre insuffisante.", retry: false, minimumLevel: 2, level: 1 });
  assert.equal(body(ask("/api/plus/pro-only/search", pass(2))).error.minimumLevel, 3);
});

test("G7: a higher level holds the rights of the levels below", () => {
  assert.deepEqual(ask("/api/plus/match-analysis", pass(2)), { action: "forward", level: 2, minimum: 2 });
  assert.deepEqual(ask("/api/plus/match-analysis", pass(3)), { action: "forward", level: 3, minimum: 2 });
  assert.deepEqual(ask("/api/plus/pro-only/search", pass(3)), { action: "forward", level: 3, minimum: 3 });
});

test("G9: no spelling of a reserved path is treated as public", () => {
  for (const path of ["/api/plus/", "/api/plus", "/api//plus/x", "/api/plus//x", "/API/plus/x", "/api/Plus/x", "/api/%70lus/x", "/api/pl%75s/x", "/api/./plus/x", "/api/x/../plus/y", "/api/plus/x/"]) {
    const decision = ask(path);
    assert.ok(decision.action === "respond" && [400, 401].includes(decision.status), `${path} -> ${JSON.stringify(decision)}`);
  }
  for (const path of ["/api/%2e%2e/plus", "/api/plus%2fx", "/api/plus%5cx", "/api/plus%00", "/api/%zz", "api/plus", "/api/plus\\x", "/api/plus?x"]) {
    const decision = ask(path);
    assert.equal(decision.status, 400, path);
    assert.equal(body(decision).error.code, "INVALID_PATH");
  }
  assert.equal(normalisePath("/api/read/home"), "/api/read/home");
  assert.equal(normalisePath("/api/read/home/"), "/api/read/home");
  assert.equal(normalisePath("/"), "/");
});

test("G11: the longest matching prefix decides, on whole segments only", () => {
  assert.equal(minimumLevel("/api/plus/pro-only", rules), 3);
  assert.equal(minimumLevel("/api/plus/pro-only/x/y", rules), 3);
  assert.equal(minimumLevel("/api/plus/pro-only-not", rules), 2);
  assert.equal(minimumLevel("/api/plusx", rules), 0);
  assert.equal(minimumLevel("/api/read/player-advanced", rules), 2);
  assert.equal(minimumLevel("/api/read/player-advanced-x", rules), 0);
  assert.equal(minimumLevel("/api/read/player", rules), 0);
  assert.equal(minimumLevel("/api/read/players", rules), 0);
});

test("G12: the header holds exactly one token; anything else is no pass", () => {
  const token = pass(2);
  for (const held of ["", " ", `${token} ${token}`, `${token}, ${token}`, `${token},`, 12, null, ["a", "b"]])
    assert.equal(body(ask("/api/plus/x", held)).error.code, "PASS_REQUIRED", String(held).slice(0, 20));
  assert.equal(ask("/api/plus/x", ` ${token} `).action, "forward"); // surrounding blanks are not part of it
  // The pass is read from its own header only: Authorization belongs to the CDN's signature to the origin.
  assert.equal(decide({ method: "GET", path: "/api/plus/x", headers: { authorization: `Bearer ${token}` } }, { rules, keyring: ring, now: NOW }).status, 401);
});

test("G13: a preflight is answered by the gate, for any path and without a pass", () => {
  for (const path of ["/api/plus/x", "/api/read/home"]) {
    const answer = ask(path, undefined, "OPTIONS", { "access-control-request-method": "GET" });
    assert.equal(answer.action, "respond");
    assert.equal(answer.status, 204);
    assert.equal(answer.body, "");
    assert.match(answer.headers["access-control-allow-headers"], /(^|, )X-Vega-Pass(,|$)/);
    assert.equal(answer.headers["access-control-max-age"], "7200");
  }
});

test("G14, G15: every refusal is kept by no cache and can be read by the site", () => {
  const transport = readFileSync(new URL("../../../infra/aws/transport.mjs", import.meta.url), "utf8");
  const origin = /"access-control-allow-origin": "([^"]+)"/.exec(transport)[1];
  const exposed = /"access-control-expose-headers":\s*"([^"]+)"/.exec(transport)[1].split(", ");
  for (const decision of [ask("/api/plus/x"), ask("/api/plus/x", pass(1)), ask("/api/%zz"), ask("/api/plus/x", undefined, "OPTIONS")]) {
    assert.equal(decision.headers["cache-control"], "no-store");
    assert.equal(decision.headers["access-control-allow-origin"], origin);
    for (const name of exposed) assert.ok(decision.headers["access-control-expose-headers"].split(", ").includes(name), name);
    if (decision.body) assert.equal(decision.headers["content-type"], "application/json; charset=utf-8");
  }
});

test("G16: the level check applies to every method but a preflight", () => {
  for (const method of ["HEAD", "POST", "PUT", "DELETE", "PATCH"]) {
    assert.equal(ask("/api/plus/x", undefined, method).status, 401, method);
    assert.equal(ask("/api/plus/x", pass(2), method).action, "forward", method);
    assert.equal(ask("/api/read/home", undefined, method).action, "forward", method);
  }
});

test("G10: the table of rules is checked when it is compiled", () => {
  assert.throws(() => compileRules([{ prefix: "/api/a", level: 2 }, { prefix: "/api/a", level: 3 }]), /twice/);
  assert.throws(() => compileRules([{ prefix: "/api/a/", level: 2 }, { prefix: "/api/a", level: 2 }]), /prefix/);
  for (const level of [0, 1, 4, "2", null]) assert.throws(() => compileRules([{ prefix: "/api/a", level }]), /level/);
  for (const prefix of ["api/a", "/", "", "/api/A", "/api/a b", "/api/a/../b", "/api//a", "/api/%61", null])
    assert.throws(() => compileRules([{ prefix, level: 2 }]), /prefix/, String(prefix));
  assert.throws(() => compileRules("nope"));
  assert.deepEqual(compileRules([]), []);
});

test("the shipped table compiles, and reserves nothing until an offer opens", () => {
  const shipped = compileRules(ACCESS_RULES);
  assert.deepEqual(shipped, []);
  assert.equal(minimumLevel("/api/read/home", shipped), 0);
});

test("the gate never throws on what a client can send", () => {
  for (const request of [{}, { method: "GET" }, { method: "GET", path: null }, { method: 7, path: "/x", headers: null }, { method: "GET", path: "/api/plus/x", headers: { "x-vega-pass": 12 } }]) {
    const decision = decide(request, { rules, keyring: ring, now: NOW });
    assert.equal(decision.action, "respond");
    assert.ok([400, 401].includes(decision.status));
  }
});
