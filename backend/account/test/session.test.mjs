// Verification of the Neon session (src/session.mjs). Failure modes: FAILURE_MODES.md,
// section 4 (N1 to N17). No network: the key set is served by an injected fetcher.
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createHmac } from "node:crypto";
import { createSessionVerifier, jwksFetcher, JWKS_MAX_AGE, JWKS_COOLDOWN, JWKS_STALE_LIMIT } from "../src/session.mjs";
import { AUTH_URL, AUTH_ORIGIN, JWKS_URL, NOW, makeKey, token, jwksServer } from "./support.mjs";

function setup({ keys = [makeKey("k1")], served } = {}) {
  let now = NOW;
  const server = jwksServer(() => served ?? keys);
  const verifier = createSessionVerifier({ authUrl: AUTH_URL, fetchJwks: server.fetch, clock: () => now });
  return { keys, server, verifier, at: (t) => (now = t), get now() { return now; } };
}
const b64 = (v) => Buffer.from(JSON.stringify(v)).toString("base64url");

test("a valid Neon token gives its account id and expiry, nothing else (N16)", async () => {
  const { keys, verifier } = setup();
  const out = await verifier.verify(token(keys[0]));
  assert.deepEqual(out, { ok: true, accountId: "acc-1", expiresAt: NOW + 890 });
  assert.equal(verifier.jwksUrl, JWKS_URL);
  assert.equal(verifier.origin, AUTH_ORIGIN);
});

test("N1: no token, or an empty one", async () => {
  const { verifier, server } = setup();
  for (const value of [undefined, null, ""]) assert.deepEqual(await verifier.verify(value), { ok: false, reason: "missing" });
  assert.equal(server.calls, 0);
});

test("N2: not a compact JWS, or too long, refused before any key is looked up", async () => {
  const { keys, verifier, server } = setup();
  const good = token(keys[0]);
  for (const bad of ["abc", "a.b", "a.b.c.d", `Bearer ${good}`, `${good}, ${good}`, `${good}=`, "x".repeat(9000), `${good.split(".")[0]}.!!!.${good.split(".")[2]}`, 42, {}])
    assert.deepEqual(await verifier.verify(bad), { ok: false, reason: "format" }, String(bad).slice(0, 40));
  const long = token(keys[0], { pad: "x".repeat(8200) });
  assert.deepEqual(await verifier.verify(long), { ok: false, reason: "format" });
  assert.equal(server.calls, 0);
});

test("N3: another algorithm announced in the header is refused", async () => {
  const { keys, verifier } = setup();
  const [, payload] = token(keys[0]).split(".");
  const none = `${b64({ alg: "none", kid: "k1" })}.${payload}.`;
  assert.deepEqual(await verifier.verify(none), { ok: false, reason: "format" }); // empty signature segment
  for (const alg of ["none", "HS256", "RS256", "ES256", "Ed25519", "eddsa"]) {
    const header = b64({ alg, typ: "JWT", kid: "k1" });
    // HS256 signed with the published key as the secret: the classic confusion.
    const sig = createHmac("sha256", JSON.stringify(keys[0].jwk)).update(`${header}.${payload}`).digest("base64url");
    assert.deepEqual(await verifier.verify(`${header}.${payload}.${sig}`), { ok: false, reason: "header" }, alg);
  }
});

test("N4: a header without kid is refused, the key is never guessed", async () => {
  const { keys, verifier } = setup();
  assert.deepEqual(await verifier.verify(token(keys[0], {}, { kid: null })), { ok: false, reason: "header" });
  assert.deepEqual(await verifier.verify(token(keys[0], {}, { kid: 7 })), { ok: false, reason: "header" });
});

test("N5: a key Neon does not publish, or a signature that is not the key's", async () => {
  const { keys, verifier, server } = setup();
  const stranger = makeKey("other");
  assert.deepEqual(await verifier.verify(token(stranger)), { ok: false, reason: "key" });
  const impostor = { ...makeKey("k1") }; // same kid as Neon's, another private key
  assert.deepEqual(await verifier.verify(token(impostor)), { ok: false, reason: "signature" });
  assert.ok(server.calls >= 1);
  assert.deepEqual(await verifier.verify(token(keys[0])), { ok: true, accountId: "acc-1", expiresAt: NOW + 890 });
});

test("N6: a payload altered after signing", async () => {
  const { keys, verifier } = setup();
  const [h, , s] = token(keys[0]).split(".");
  const altered = b64({ sub: "acc-2", iss: AUTH_ORIGIN, aud: AUTH_ORIGIN, iat: NOW - 10, exp: NOW + 890 });
  assert.deepEqual(await verifier.verify(`${h}.${altered}.${s}`), { ok: false, reason: "signature" });
});

test("N7: issuer and audience are exactly the auth origin", async () => {
  const { keys, verifier } = setup();
  for (const claims of [
    { iss: "https://ep-other.neonauth.us-east-2.aws.neon.tech" },
    { iss: AUTH_URL },
    { iss: `${AUTH_ORIGIN}/` },
    { aud: "https://vegasport.vercel.app" },
    { aud: [`${AUTH_ORIGIN}/`] },
    { iss: null },
    { aud: null },
  ])
    assert.deepEqual(await verifier.verify(token(keys[0], claims)), { ok: false, reason: "claims" }, JSON.stringify(claims));
  assert.equal((await verifier.verify(token(keys[0], { aud: ["https://x.example", AUTH_ORIGIN] }))).ok, true);
});

test("N8: an expired token, with 60 s of tolerated clock difference", async () => {
  const { keys, verifier, at } = setup();
  const t = token(keys[0], { iat: NOW - 900, exp: NOW });
  assert.equal((await verifier.verify(t)).ok, true); // within the 60 s
  at(NOW + 61);
  assert.deepEqual(await verifier.verify(t), { ok: false, reason: "expired" });
});

test("N9: a token issued in the future beyond 60 s", async () => {
  const { keys, verifier } = setup();
  assert.equal((await verifier.verify(token(keys[0], { iat: NOW + 50, exp: NOW + 900 }))).ok, true);
  assert.deepEqual(await verifier.verify(token(keys[0], { iat: NOW + 120, exp: NOW + 1000 })), { ok: false, reason: "not-yet" });
  assert.deepEqual(await verifier.verify(token(keys[0], { nbf: NOW + 120 })), { ok: false, reason: "not-yet" });
});

test("N10: sub, exp and iat are required, sub has the shape of an account id", async () => {
  const { keys, verifier } = setup();
  for (const claims of [{ sub: null }, { exp: null }, { iat: null }, { sub: "" }, { sub: "a b" }, { sub: "x".repeat(65) }, { sub: 12 }, { sub: "ü" }])
    assert.deepEqual(await verifier.verify(token(keys[0], claims)), { ok: false, reason: "claims" }, JSON.stringify(claims));
  const uuid = "0b9e7a52-5c1e-4c8e-9a52-2f7f0c8f5d11";
  assert.equal((await verifier.verify(token(keys[0], { sub: uuid }))).accountId, uuid);
});

test("N11: a rotated key is fetched at once, never pinned", async () => {
  const old = makeKey("k1"),
    next = makeKey("k2");
  let served = [old];
  let now = NOW;
  const server = jwksServer(() => served);
  const verifier = createSessionVerifier({ authUrl: AUTH_URL, fetchJwks: server.fetch, clock: () => now });
  assert.equal((await verifier.verify(token(old))).ok, true);
  assert.equal(server.calls, 1);
  assert.equal((await verifier.verify(token(old))).ok, true);
  assert.equal(server.calls, 1); // cached
  served = [old, next];
  now += JWKS_COOLDOWN; // the last fetch was 30 s ago
  assert.equal((await verifier.verify(token(next))).ok, true);
  assert.equal(server.calls, 2);
});

test("N12: unknown kids cause at most one fetch per 30 s, shared by concurrent requests", async () => {
  const { keys, verifier, server, at } = setup();
  assert.equal((await verifier.verify(token(keys[0]))).ok, true);
  assert.equal(server.calls, 1);
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) => verifier.verify(token(makeKey(`r${i}`)))));
  assert.ok(results.every((r) => r.reason === "key"));
  assert.equal(server.calls, 1); // the first fetch was just now: none within the 30 s
  at(NOW + JWKS_COOLDOWN);
  await Promise.all(Array.from({ length: 5 }, (_, i) => verifier.verify(token(makeKey(`s${i}`)))));
  assert.equal(server.calls, 2); // one shared fetch
});

test("N13: a key removed from Neon's set is refused once the set is older than 10 minutes", async () => {
  const k1 = makeKey("k1"),
    k2 = makeKey("k2");
  let served = [k1, k2];
  let now = NOW;
  const server = jwksServer(() => served);
  const verifier = createSessionVerifier({ authUrl: AUTH_URL, fetchJwks: server.fetch, clock: () => now });
  assert.equal((await verifier.verify(token(k2))).ok, true);
  served = [k1];
  now = NOW + JWKS_MAX_AGE - 1;
  assert.equal((await verifier.verify(token(k2, { iat: now - 10, exp: now + 800 }))).ok, true); // still within the set's age
  now = NOW + JWKS_MAX_AGE;
  assert.deepEqual(await verifier.verify(token(k2, { iat: now - 10, exp: now + 800 })), { ok: false, reason: "key" });
  assert.equal((await verifier.verify(token(k1, { iat: now - 10, exp: now + 800 }))).ok, true);
});

test("N14: Neon's key set cannot be fetched: unavailable, or the stale set within one hour", async () => {
  const { keys, verifier, server, at } = setup();
  server.fail = true;
  assert.deepEqual(await verifier.verify(token(keys[0])), { ok: false, reason: "unavailable" });
  server.fail = false;
  at(NOW + JWKS_COOLDOWN);
  const fresh = (t) => token(keys[0], { iat: t - 10, exp: t + 800 });
  assert.equal((await verifier.verify(fresh(NOW + JWKS_COOLDOWN))).ok, true);
  const fetchedAt = NOW + JWKS_COOLDOWN;
  server.fail = true;
  at(fetchedAt + JWKS_MAX_AGE + 5); // stale, the refetch fails: the stale set is used
  assert.equal((await verifier.verify(fresh(fetchedAt + JWKS_MAX_AGE + 5))).ok, true);
  at(fetchedAt + JWKS_STALE_LIMIT + 1); // beyond one hour: no longer
  assert.deepEqual(await verifier.verify(fresh(fetchedAt + JWKS_STALE_LIMIT + 1)), { ok: false, reason: "unavailable" });
  server.fail = false;
  at(fetchedAt + JWKS_STALE_LIMIT + 1 + JWKS_COOLDOWN);
  assert.equal((await verifier.verify(fresh(fetchedAt + JWKS_STALE_LIMIT + 1 + JWKS_COOLDOWN))).ok, true);
});

test("N14: the default fetcher refuses what is not a 200 JSON key set under 64 KiB, and times out", async () => {
  const respond = (body, init = {}) => async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });
  const good = { keys: [makeKey("k1").jwk] };
  assert.deepEqual(await jwksFetcher(respond(good))(JWKS_URL), good);
  for (const [label, impl] of [
    ["status", respond(good, { status: 500 })],
    ["not json", respond("<html>")],
    ["no keys", respond({ items: [] })],
    ["keys not a list", respond({ keys: {} })],
    ["too large", respond({ keys: [], pad: "x".repeat(70 * 1024) })],
    ["network", async () => { throw new TypeError("fetch failed"); }],
  ])
    await assert.rejects(jwksFetcher(impl)(JWKS_URL), Error, label);
  let signal;
  const slow = (url, init) => { signal = init.signal; return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason))); };
  await assert.rejects(jwksFetcher(slow, { timeoutMs: 20 })(JWKS_URL));
  assert.equal(signal.aborted, true);
  let redirect;
  await jwksFetcher(async (url, init) => { redirect = init.redirect; return respond(good)(); })(JWKS_URL);
  assert.equal(redirect, "error");
});

test("N15: keys that are not Ed25519 signing keys are ignored, the others used", async () => {
  const good = makeKey("good");
  const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({ format: "jwk" });
  const p256 = generateKeyPairSync("ec", { namedCurve: "P-256" }).publicKey.export({ format: "jwk" });
  const enc = makeKey("enc"),
    other = makeKey("alg"),
    nokid = makeKey("nokid");
  const served = [
    { ...rsa, kid: "rsa" },
    { ...p256, kid: "p256" },
    { ...enc.jwk, use: "enc" },
    { ...other.jwk, alg: "ES256" },
    { ...nokid.jwk, kid: undefined },
    good.jwk,
  ];
  const { verifier } = setup({ served });
  assert.equal((await verifier.verify(token(good))).ok, true);
  for (const k of [enc, other]) assert.deepEqual(await verifier.verify(token(k)), { ok: false, reason: "key" }, k.kid);
});

test("N17: the auth URL must be https, without query or fragment", () => {
  for (const authUrl of ["http://ep.neonauth.tech/auth", "https://ep.neonauth.tech/auth?x=1", "https://ep.neonauth.tech/auth#f", "not a url", "", undefined])
    assert.throws(() => createSessionVerifier({ authUrl, fetchJwks: async () => ({ keys: [] }) }), Error, String(authUrl));
  // A trailing slash on the auth URL does not double the one of the key set's path.
  assert.equal(createSessionVerifier({ authUrl: `${AUTH_URL}/`, fetchJwks: async () => ({ keys: [] }) }).jwksUrl, JWKS_URL);
});
