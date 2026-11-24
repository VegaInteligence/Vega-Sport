// The pass: a short-lived signed token carrying an account id and a level.
// Failure modes pinned here: backend/account/FAILURE_MODES.md, section 1 (P1 to P13).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { MAX_LIFETIME, createKeyring, signPass, verifyPass } from "../src/pass.mjs";

const NOW = 1_795_000_000;
const k1 = randomBytes(32),
  k2 = randomBytes(32);
const ring = createKeyring({ current: "k2", keys: { k1, k2 } });
const b64 = (value) => Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");
/** A token built by hand, as an attacker or a faulty issuer would. */
const forge = (header, payload, key = k2, alg = "sha256") => {
  const body = `${b64(header)}.${b64(payload)}`;
  return `${body}.${key ? createHmac(alg, key).update(body).digest("base64url") : ""}`;
};
const good = { alg: "HS256", typ: "JWT", kid: "k2" };
const claims = (extra = {}) => ({ sub: "acc_1", lvl: 2, iat: NOW, exp: NOW + 600, ...extra });
const reason = (token, at = NOW) => {
  const result = verifyPass(token, ring, at);
  assert.equal(result.ok, false);
  return result.reason;
};

test("a signed pass verifies and gives back the account, the level and the expiry, nothing else", () => {
  const token = signPass({ accountId: "acc_1", level: 2, now: NOW }, ring);
  assert.deepEqual(verifyPass(token, ring, NOW + 599), { ok: true, accountId: "acc_1", level: 2, expiresAt: NOW + 600 });
  const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url"));
  assert.deepEqual(Object.keys(payload).sort(), ["exp", "iat", "lvl", "sub"]); // P13
});

test("P1: a payload altered after signing is refused", () => {
  const [header, , signature] = signPass({ accountId: "acc_1", level: 1, now: NOW }, ring).split(".");
  assert.equal(reason(`${header}.${b64(claims({ lvl: 3 }))}.${signature}`), "signature");
});

test("P2: a pass signed with a key the verifier does not hold is refused", () => {
  assert.equal(reason(forge({ ...good, kid: "k9" }, claims(), randomBytes(32))), "key");
  assert.equal(reason(forge(good, claims(), randomBytes(32))), "signature");
});

test("P3: the algorithm is fixed by the verifier, never read from the token", () => {
  assert.equal(reason(forge({ ...good, alg: "none" }, claims())), "header");
  assert.equal(reason(forge({ ...good, alg: "none" }, claims(), null)), "format"); // no signature at all: not a token
  assert.equal(reason(forge({ ...good, alg: "HS512" }, claims(), k2, "sha512")), "header");
  assert.equal(reason(forge({ ...good, alg: "RS256" }, claims())), "header");
  assert.equal(reason(forge({ typ: "JWT", kid: "k2" }, claims())), "header");
  assert.equal(reason(forge({ ...good, kid: 7 }, claims())), "header");
});

test("P4: an expired pass is refused, the expiry second included", () => {
  const token = signPass({ accountId: "acc_1", level: 2, now: NOW }, ring);
  assert.equal(verifyPass(token, ring, NOW + 599).ok, true);
  assert.equal(reason(token, NOW + 600), "expired");
  assert.equal(reason(token, NOW + 86_400), "expired");
});

test("P5: a pass issued in the future beyond the tolerated clock difference is refused", () => {
  const token = signPass({ accountId: "acc_1", level: 2, now: NOW + 61 }, ring);
  assert.equal(reason(token, NOW), "not-yet");
  assert.equal(verifyPass(signPass({ accountId: "acc_1", level: 2, now: NOW + 60 }, ring), ring, NOW).ok, true);
});

test("P6: a pass that lives longer than the maximum is refused even when correctly signed", () => {
  assert.equal(reason(forge(good, claims({ exp: NOW + MAX_LIFETIME + 1 }))), "lifetime");
  assert.equal(reason(forge(good, claims({ exp: NOW }))), "lifetime");
  assert.throws(() => signPass({ accountId: "acc_1", level: 2, now: NOW, lifetime: MAX_LIFETIME + 1 }, ring));
  assert.throws(() => signPass({ accountId: "acc_1", level: 2, now: NOW, lifetime: 0 }, ring));
});

test("P7: only levels 1 to 3 are carried; a visitor holds no pass", () => {
  for (const level of [0, 4, "3", 2.5, null, undefined, -1]) {
    assert.throws(() => signPass({ accountId: "acc_1", level, now: NOW }, ring), `level ${level}`);
    assert.equal(reason(forge(good, claims({ lvl: level }))), "claims", `level ${level}`);
  }
  for (const level of [1, 2, 3]) assert.equal(verifyPass(signPass({ accountId: "acc_1", level, now: NOW }, ring), ring, NOW).level, level);
});

test("P8: the account id is required and has one shape", () => {
  for (const accountId of ["", " ", "a b", "é", "x".repeat(65), null, undefined, 12, "a.b", "a/b"]) {
    assert.throws(() => signPass({ accountId, level: 1, now: NOW }, ring), `id ${accountId}`);
    assert.equal(reason(forge(good, claims({ sub: accountId }))), "claims", `id ${accountId}`);
  }
  const uuid = "0f3c9a52-7b1e-4c7a-9d4e-2a6b8c1d5e90";
  assert.equal(verifyPass(signPass({ accountId: uuid, level: 1, now: NOW }, ring), ring, NOW).accountId, uuid);
});

test("P9: anything that is not a well-formed token is refused before a signature is computed", () => {
  const token = signPass({ accountId: "acc_1", level: 2, now: NOW }, ring);
  const [header, payload, signature] = token.split(".");
  for (const bad of [undefined, null, 12, "", "a.b", "a.b.c.d", `${header}.${payload}`, `${header}..${signature}`, `${header}.${payload}.sig+nature=`, `${header}.${b64("[1,2]")}.${signature}`, `${header}.${b64("not json")}.${signature}`, `${b64("null")}.${payload}.${signature}`, token + "A".repeat(1024)])
    assert.equal(reason(bad), "format", String(bad).slice(0, 40));
});

test("P10: after a rotation the older key still verifies, and signing uses the current one", () => {
  const older = forge({ ...good, kid: "k1" }, claims(), k1);
  assert.equal(verifyPass(older, ring, NOW).ok, true);
  const header = JSON.parse(Buffer.from(signPass({ accountId: "acc_1", level: 1, now: NOW }, ring).split(".")[0], "base64url"));
  assert.deepEqual(header, good);
  const rotated = createKeyring({ current: "k2", keys: { k2 } });
  assert.equal(verifyPass(older, rotated, NOW).reason, "key");
});

test("P11: a keyring refuses a short key, an unknown current key and odd key names", () => {
  assert.throws(() => createKeyring({ current: "k1", keys: { k1: randomBytes(31) } }));
  assert.throws(() => createKeyring({ current: "k3", keys: { k1 } }));
  assert.throws(() => createKeyring({ current: "k 1", keys: { "k 1": k1 } }));
  assert.throws(() => createKeyring({ current: "k1", keys: {} }));
  assert.throws(() => createKeyring({ current: "k1", keys: { k1: "too-short" } }));
  // A key may be given as base64url text (the form it has in a parameter store).
  const text = createKeyring({ current: "k1", keys: { k1: k1.toString("base64url") } });
  assert.equal(verifyPass(forge({ ...good, kid: "k1" }, claims(), k1), text, NOW).ok, true);
});

test("P12: a signature of the wrong length is refused without throwing", () => {
  const [header, payload, signature] = signPass({ accountId: "acc_1", level: 2, now: NOW }, ring).split(".");
  assert.equal(reason(`${header}.${payload}.${signature.slice(0, 10)}`), "signature");
  assert.equal(reason(`${header}.${payload}.${signature}AAAA`), "signature");
});

test("the clock is whole seconds; a verifier given milliseconds refuses to run", () => {
  const token = signPass({ accountId: "acc_1", level: 2, now: NOW }, ring);
  assert.throws(() => verifyPass(token, ring, NOW * 1000));
  assert.throws(() => verifyPass(token, ring, NOW + 0.5));
  assert.throws(() => signPass({ accountId: "acc_1", level: 2, now: Date.now() }, ring));
});
