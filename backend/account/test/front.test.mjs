// The front's HTTP behaviour (src/front.mjs) with Function URL events. Failure modes:
// FAILURE_MODES.md, section 8 (H1 to H16). No base: the store is a recorder behind the real
// seam (src/store-client.mjs), which answers what a test gives it; the whole path through the
// real store is test/account-api.e2e.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createFront, createFrontFromEnv } from "../src/front.mjs";
import { createSessionVerifier } from "../src/session.mjs";
import { createKeyring, verifyPass } from "../src/pass.mjs";
import { createStoreClient, localInvoker } from "../src/store-client.mjs";
import { AUTH_URL, SITE, NOW, makeKey, token, jwksServer, event, contract } from "./support.mjs";

const PASS_KEY = Buffer.alloc(32, 7);
function setup({ answer = () => ({ ok: true, value: null }), neon = null, throwing = false } = {}) {
  const key = makeKey("k1");
  const jwks = jwksServer(() => [key]);
  const calls = [],
    lines = [];
  const store = createStoreClient(localInvoker(async (command) => {
    calls.push(command);
    if (throwing) throw new Error("password authentication failed for user vega_v2_account");
    return answer(command);
  }));
  const keyring = createKeyring({ current: "k1", keys: { k1: PASS_KEY } });
  const handler = createFront({
    verifier: createSessionVerifier({ authUrl: AUTH_URL, fetchJwks: jwks.fetch, clock: () => NOW }),
    origins: [SITE, "http://localhost:3000"],
    keyring,
    store,
    neon,
    clock: () => NOW,
    log: (line) => lines.push(line),
  });
  const auth = (claims) => ({ "X-Vega-Session": token(key, claims), Origin: SITE });
  return { handler, calls, lines, keyring, key, auth, jwks };
}
const json = (out) => JSON.parse(out.body);
function plain(out) {
  assert.equal(out.headers["cache-control"], "no-store");
  return out;
}

test("H1: an event that is not a Function URL 2.0 event", async () => {
  const { handler, calls } = setup();
  for (const bad of [null, {}, { version: "1.0", rawPath: "/account/session", requestContext: { http: { method: "POST" } } }, { version: "2.0", requestContext: { http: { method: "GET" } } }]) {
    const out = plain(await handler(bad));
    assert.equal(out.statusCode, 400);
    assert.equal(json(out).error.code, "INVALID_REQUEST");
  }
  assert.equal(calls.length, 0);
});

test("H2: a path no route claims is 404; exact paths only", async () => {
  const { handler, auth, calls } = setup();
  for (const path of ["/account/", "/accounts", "/account/preferences/", "/account//session", "/ACCOUNT/session", "/account/preferences%2Fmerge", "/account/./session", "/account/preferences/merge", "/api/read/x", "/"]) {
    const out = plain(await handler(event("GET", path, { headers: auth() })));
    assert.equal(out.statusCode, 404, path);
    assert.equal(json(out).error.code, "NOT_FOUND");
  }
  assert.equal(calls.length, 0);
});

test("H3: a known path with another method is 405 with Allow", async () => {
  const { handler, auth } = setup();
  for (const [method, path, allow] of [
    ["GET", "/account/session", "POST, OPTIONS"],
    ["POST", "/account/preferences", "GET, PUT, OPTIONS"],
    ["HEAD", "/account/preferences", "GET, PUT, OPTIONS"],
    ["POST", "/account/export", "GET, OPTIONS"],
    ["GET", "/account", "DELETE, OPTIONS"],
  ]) {
    const out = plain(await handler(event(method, path, { headers: auth() })));
    assert.equal(out.statusCode, 405, `${method} ${path}`);
    assert.equal(out.headers.allow, allow);
    assert.equal(json(out).error.code, "METHOD_NOT_ALLOWED");
  }
});

test("H4: a query string is refused", async () => {
  const { handler, auth, calls } = setup();
  const out = plain(await handler(event("GET", "/account/preferences", { headers: auth(), query: "x=1" })));
  assert.equal(out.statusCode, 400);
  assert.equal(json(out).error.code, "INVALID_REQUEST");
  assert.equal(calls.length, 0);
});

test("H5: session failures: 401 with a code, 503 when Neon's keys are out of reach; the store is not called", async () => {
  const { handler, key, calls, lines, jwks } = setup();
  const cases = [
    [{}, 401, "SESSION_REQUIRED"],
    [{ "X-Vega-Session": "" }, 401, "SESSION_REQUIRED"],
    [{ "X-Vega-Session": "abc" }, 401, "SESSION_INVALID"],
    [{ "X-Vega-Session": token(key, { iat: NOW - 1000, exp: NOW - 100 }) }, 401, "SESSION_EXPIRED"],
    [{ "X-Vega-Session": token(makeKey("k1")) }, 401, "SESSION_INVALID"],
    [{ Authorization: `Bearer ${token(key)}` }, 401, "SESSION_REQUIRED"],
  ];
  const bodies = [];
  for (const [headers, status, code] of cases) {
    const out = plain(await handler(event("GET", "/account/preferences", { headers: { Origin: SITE, ...headers } })));
    bodies.push(out.body);
    assert.equal(out.statusCode, status, code);
    assert.equal(json(out).error.code, code);
    assert.equal(json(out).ok, false);
  }
  assert.ok(lines.some((l) => /signature/.test(l)), "the reason is logged");
  assert.ok(!bodies.some((b) => /signature/.test(b)), "the reason is not told");
  // Neon's key set unreachable and no key known: 503, never a 401 that would sign the person out.
  const cold = setup();
  cold.jwks.fail = true;
  const out = plain(await cold.handler(event("GET", "/account/preferences", { headers: cold.auth() })));
  assert.equal(out.statusCode, 503);
  assert.equal(out.headers["retry-after"], "5");
  assert.equal(json(out).error.code, "AUTH_UNAVAILABLE");
  assert.equal(json(out).error.retry, true);
  assert.equal(calls.length + cold.calls.length, 0);
  assert.equal(jwks.calls, 1);
});

test("H6, H7: PUT needs JSON under 4 MiB, checked after the session", async () => {
  const { handler, auth, calls } = setup();
  const put = (headers, body, base64) => handler(event("PUT", "/account/preferences", { headers, body, base64 }));
  let out = await put({ Origin: SITE, "Content-Type": "application/json" }, JSON.stringify(contract()));
  assert.equal(out.statusCode, 401); // the session first
  for (const type of [undefined, "text/plain", "application/x-www-form-urlencoded", "application/jsonp"]) {
    out = plain(await put({ ...auth(), ...(type && { "Content-Type": type }) }, JSON.stringify(contract())));
    assert.equal(out.statusCode, 415, String(type));
    assert.equal(json(out).error.code, "UNSUPPORTED_MEDIA_TYPE");
  }
  out = plain(await put({ ...auth(), "Content-Type": "application/json" }, "x".repeat(4 * 1024 * 1024 + 1)));
  assert.equal(out.statusCode, 413);
  assert.equal(json(out).error.code, "BODY_TOO_LARGE");
  out = plain(await put({ ...auth(), "Content-Type": "application/json" }, "x".repeat(3500 * 1024), true)); // 3.4 MiB, 4.6 MiB once base64
  assert.notEqual(out.statusCode, 413); // the bound is on the decoded body
  for (const body of ["{", "", "ÿ"]) {
    out = plain(await put({ ...auth(), "Content-Type": "application/json" }, body));
    assert.equal(out.statusCode, 400);
    assert.equal(json(out).error.code, "INVALID_JSON");
  }
  out = plain(await put({ ...auth(), "Content-Type": "application/json" }, Buffer.from([0x7b, 0xff, 0x7d]).toString("latin1"), false));
  assert.equal(out.statusCode, 400);
  out = await handler(event("PUT", "/account/preferences", { headers: { ...auth(), "Content-Type": "application/json" }, body: Buffer.from([0x7b, 0xff, 0x7d]), base64: true }));
  assert.equal(json(out).error.code, "INVALID_JSON"); // not UTF-8
  assert.equal(calls.length, 0);
});

test("H8: a refused document is 400, 422 or 413, the store not called", async () => {
  const { handler, auth, calls } = setup();
  const send = (body) => handler(event("PUT", "/account/preferences", { headers: { ...auth(), "Content-Type": "application/json; charset=utf-8" }, body: typeof body === "string" ? body : JSON.stringify(body) }));
  for (const [body, status, code] of [
    [[contract()], 400, "CONTRACT_INVALID"],
    ["null", 400, "CONTRACT_INVALID"],
    ['"x"', 400, "CONTRACT_INVALID"],
    [{ ...contract(), v: 2 }, 422, "CONTRACT_VERSION"],
    [{ ...contract(), v: "1" }, 422, "CONTRACT_VERSION"],
    [{ v: 1, pad: "x".repeat(2 * 1024 * 1024) }, 413, "CONTRACT_LIMIT"],
    ['{"v":1,"name":"a\\u0000b"}', 400, "CONTRACT_INVALID"],
    ['{"v":1,"name":"\\ud800"}', 400, "CONTRACT_INVALID"],
  ]) {
    const out = plain(await send(body));
    assert.equal(out.statusCode, status, code);
    assert.equal(json(out).error.code, code);
  }
  assert.equal(calls.length, 0);
});

test("PUT and GET: the document goes to the store as sent; the answers are the store's", async () => {
  const { handler, auth, calls } = setup({ answer: (c) => ({ ok: true, value: c.command === "putPreferences" ? { revision: 4 } : { contract: contract(), revision: 4 } }) });
  const body = JSON.stringify({ ...contract(), unknown: { kept: [null, ""] } });
  let out = plain(await handler(event("PUT", "/account/preferences", { headers: { ...auth({ sub: "acc-p" }), "Content-Type": "application/json" }, body })));
  assert.equal(out.statusCode, 200);
  assert.deepEqual(json(out), { revision: 4 });
  assert.deepEqual(calls[0], { command: "putPreferences", accountId: "acc-p", preferences: JSON.parse(body) });
  out = plain(await handler(event("GET", "/account/preferences", { headers: auth({ sub: "acc-p" }) })));
  assert.deepEqual(json(out), { contract: contract(), revision: 4 });
});

test("H17: If-Match carries a revision to the store; anything else is 400; STALE is 409 with the revision", async () => {
  const { handler, auth, calls } = setup({ answer: (c) => (c.ifMatch === 3 ? { ok: true, value: { revision: 4 } } : { ok: false, code: "STALE", message: "stale", revision: 5 }) });
  const put = (ifMatch) => handler(event("PUT", "/account/preferences", { headers: { ...auth(), "Content-Type": "application/json", "If-Match": ifMatch }, body: JSON.stringify(contract()) }));
  for (const bad of ["*", "abc", "0", "-1", "1.5", "3, 4", 'W/"3"', ""]) {
    const out = plain(await put(bad));
    assert.equal(out.statusCode, 400, bad);
    assert.equal(json(out).error.code, "INVALID_REQUEST");
  }
  assert.equal(calls.length, 0);
  for (const good of ["3", '"3"']) assert.deepEqual(json(plain(await put(good))), { revision: 4 }, good);
  assert.equal(calls[0].ifMatch, 3);
  const out = plain(await put("2"));
  assert.equal(out.statusCode, 409);
  assert.deepEqual(json(out), { ok: false, revision: 5, error: { code: "STALE", message: json(out).error.message, retry: false } });
  // Without the header the field is not sent: the last write wins.
  await handler(event("PUT", "/account/preferences", { headers: { ...auth(), "Content-Type": "application/json" }, body: JSON.stringify(contract()) }));
  assert.equal(Object.hasOwn(calls.at(-1), "ifMatch"), false);
});

test("H9: CORS answers only the listed origins; another origin is refused before the session", async () => {
  const { handler, auth, calls } = setup({ answer: () => ({ ok: true, value: null }) });
  let out = plain(await handler(event("GET", "/account/preferences", { headers: auth() })));
  assert.equal(out.statusCode, 200);
  assert.equal(out.headers["access-control-allow-origin"], SITE);
  assert.match(out.headers.vary, /Origin/);
  assert.equal(out.headers["access-control-allow-credentials"], undefined);
  for (const origin of ["https://evil.example", "https://vegasport.vercel.app.evil.example", "null", "https://VEGASPORT.vercel.app", `${SITE}/`]) {
    out = plain(await handler(event("GET", "/account/preferences", { headers: { ...auth(), Origin: origin } })));
    assert.equal(out.statusCode, 403, origin);
    assert.equal(json(out).error.code, "ORIGIN_REFUSED");
    assert.equal(out.headers["access-control-allow-origin"], undefined);
  }
  // No Origin (a script, a server): served, without CORS headers; the token is its proof.
  const { Origin, ...noOrigin } = auth();
  out = plain(await handler(event("GET", "/account/preferences", { headers: noOrigin })));
  assert.equal(out.statusCode, 200);
  assert.equal(out.headers["access-control-allow-origin"], undefined);
  assert.equal(json(out), null);
  assert.equal(calls.length, 2);
  assert.ok(Origin);
});

test("H10: a preflight from an allowed origin, without session, never reaches the store", async () => {
  const { handler, calls } = setup();
  for (const path of ["/account/session", "/account/preferences", "/account/export", "/account"]) {
    const out = plain(await handler(event("OPTIONS", path, { headers: { Origin: "http://localhost:3000", "Access-Control-Request-Method": "PUT", "Access-Control-Request-Headers": "x-vega-session, content-type" } })));
    assert.equal(out.statusCode, 204, path);
    assert.equal(out.body, "");
    assert.equal(out.headers["access-control-allow-origin"], "http://localhost:3000");
    assert.equal(out.headers["access-control-allow-methods"], "GET, PUT, POST, DELETE");
    assert.equal(out.headers["access-control-allow-headers"], "X-Vega-Session, Content-Type");
    assert.equal(out.headers["access-control-max-age"], "600");
    assert.match(out.headers.vary, /Origin/);
  }
  for (const headers of [{ Origin: "https://evil.example" }, {}]) {
    const out = plain(await handler(event("OPTIONS", "/account/preferences", { headers })));
    assert.equal(out.statusCode, 403);
    assert.equal(out.headers["access-control-allow-origin"], undefined);
  }
  assert.equal(plain(await handler(event("OPTIONS", "/elsewhere", { headers: { Origin: SITE } }))).statusCode, 404);
  assert.equal(calls.length, 0);
});

test("H11, H12: every answer is no-store, JSON and nosniff", async () => {
  const { handler, auth } = setup({ answer: (c) => (c.command === "session" ? { ok: true, value: { created: true, level: 1 } } : { ok: true, value: null }) });
  for (const [method, path] of [["POST", "/account/session"], ["GET", "/account/preferences"], ["GET", "/nothing"], ["GET", "/account/session"]]) {
    const out = plain(await handler(event(method, path, { headers: auth() })));
    assert.equal(out.headers["content-type"], "application/json; charset=utf-8");
    assert.equal(out.headers["x-content-type-options"], "nosniff");
    assert.equal(out.isBase64Encoded, false);
  }
});

test("session: the pass carries the account's level, signed for 600 s", async () => {
  const { handler, auth, calls, keyring } = setup({ answer: () => ({ ok: true, value: { created: true, level: 2 } }) });
  const out = plain(await handler(event("POST", "/account/session", { headers: auth({ sub: "acc-7" }) })));
  assert.equal(out.statusCode, 200);
  const body = json(out);
  assert.deepEqual(Object.keys(body).sort(), ["accountId", "created", "level", "pass", "passExpiresAt"]);
  assert.equal(body.accountId, "acc-7");
  assert.equal(body.level, 2);
  assert.equal(body.passExpiresAt, NOW + 600);
  assert.deepEqual(verifyPass(body.pass, keyring, NOW), { ok: true, accountId: "acc-7", level: 2, expiresAt: NOW + 600 });
  assert.deepEqual(calls, [{ command: "session", accountId: "acc-7" }]);
});

test("H13: a failing store is 503 STORE_UNAVAILABLE without detail; a code fault is 500", async () => {
  const { handler, auth, lines } = setup({ throwing: true });
  const out = plain(await handler(event("GET", "/account/preferences", { headers: auth() })));
  assert.equal(out.statusCode, 503);
  assert.equal(json(out).error.code, "STORE_UNAVAILABLE");
  assert.equal(out.headers["retry-after"], "5");
  assert.ok(!out.body.includes("password"));
  const odd = setup({ answer: () => ({ ok: false, code: "SOMETHING_NEW", message: "select * from" }) });
  const out2 = plain(await odd.handler(event("GET", "/account/preferences", { headers: odd.auth() })));
  assert.equal(out2.statusCode, 500);
  assert.equal(json(out2).error.code, "INTERNAL");
  assert.ok(!out2.body.includes("select"));
  assert.ok(lines.length > 0);
});

test("H14: the log line holds no token, no account id, no IP, no body", async () => {
  const { handler, auth, lines } = setup({ answer: () => ({ ok: true, value: { revision: 1 } }) });
  const headers = { ...auth({ sub: "secret-account-id" }), "Content-Type": "application/json" };
  await handler(event("PUT", "/account/preferences", { headers, body: JSON.stringify(contract({ lists: [{ id: "main", name: "Nom très personnel", entries: [] }] })) }));
  await handler(event("GET", "/account/preferences", { headers: { ...headers, "X-Vega-Session": "bad.token.here" } }));
  assert.equal(lines.length, 2);
  for (const line of lines) {
    const parsed = JSON.parse(line);
    assert.ok(parsed.route && parsed.status && typeof parsed.ms === "number", line);
    for (const secret of ["secret-account-id", headers["X-Vega-Session"].slice(0, 30), "203.0.113.9", "personnel", "bad.token.here"]) assert.ok(!line.includes(secret), `${secret} in ${line}`);
  }
});

test("H15: without its configuration the front answers 503 NOT_CONFIGURED to everything", async () => {
  const lines = [];
  const good = {
    VEGA_NEON_AUTH_URL: AUTH_URL,
    VEGA_SITE_ORIGINS: `${SITE},http://localhost:3000`,
    VEGA_PASS_KEYS: `k1:${PASS_KEY.toString("base64url")}`,
    VEGA_PASS_KEY_CURRENT: "k1",
    VEGA_ACCOUNT_STORE_FUNCTION: "vega-v2-account-store",
  };
  const deps = { invoke: async () => JSON.stringify({ ok: true, value: null }), fetchJwks: async () => ({ keys: [] }), log: (l) => lines.push(l) };
  for (const [label, env] of [
    ["empty", {}],
    ["no auth url", { ...good, VEGA_NEON_AUTH_URL: "" }],
    ["star origin", { ...good, VEGA_SITE_ORIGINS: "*" }],
    ["http origin", { ...good, VEGA_SITE_ORIGINS: "http://vegasport.vercel.app" }],
    ["origin with path", { ...good, VEGA_SITE_ORIGINS: `${SITE}/x` }],
    ["short pass key", { ...good, VEGA_PASS_KEYS: `k1:${Buffer.alloc(16).toString("base64url")}` }],
    ["current key not held", { ...good, VEGA_PASS_KEY_CURRENT: "k2" }],
    ["no store", { ...good, VEGA_ACCOUNT_STORE_FUNCTION: "" }],
  ]) {
    const handler = createFrontFromEnv(env, deps);
    for (const [method, path] of [["OPTIONS", "/account/session"], ["POST", "/account/session"], ["GET", "/nothing"]]) {
      const out = plain(await handler(event(method, path, { headers: { Origin: SITE } })));
      assert.equal(out.statusCode, 503, `${label} ${method} ${path}`);
      assert.equal(json(out).error.code, "NOT_CONFIGURED");
    }
  }
  assert.ok(lines.some((l) => /VEGA_NEON_AUTH_URL/.test(l)));
  assert.ok(!lines.some((l) => l.includes(PASS_KEY.toString("base64url"))));
  // Configured: served. The Neon API key is optional (deletion then fails closed, X3).
  const handler = createFrontFromEnv(good, deps);
  assert.equal((await handler(event("OPTIONS", "/account/session", { headers: { Origin: SITE } }))).statusCode, 204);
});

test("H16: an erased account gets 410 on every route but DELETE", async () => {
  const neon = { deleteUser: async () => ({ ok: true }) };
  const { handler, auth } = setup({ neon, answer: (c) => (c.command === "erase" ? { ok: true, value: { erased: false } } : { ok: false, code: "ACCOUNT_ERASED", message: "erased" }) });
  for (const [method, path, body] of [["POST", "/account/session"], ["GET", "/account/preferences"], ["PUT", "/account/preferences", contract()], ["GET", "/account/export"]]) {
    const out = plain(await handler(event(method, path, { headers: { ...auth(), "Content-Type": "application/json" }, ...(body && { body: JSON.stringify(body) }) })));
    assert.equal(out.statusCode, 410, `${method} ${path}`);
    assert.equal(json(out).error.code, "ACCOUNT_ERASED");
  }
  assert.equal((await handler(event("DELETE", "/account", { headers: auth() }))).statusCode, 200);
});

test("X3: without a Neon API key, deletion fails closed and the store is not asked to erase", async () => {
  const { handler, auth, calls } = setup({ neon: null });
  const out = plain(await handler(event("DELETE", "/account", { headers: auth() })));
  assert.equal(out.statusCode, 503);
  assert.equal(json(out).error.code, "DELETION_UNAVAILABLE");
  assert.equal(json(out).error.retry, false);
  assert.equal(calls.length, 0);
});

test("X4, X5, X6: AWS first then Neon; a Neon failure is reported with erased: true and can be retried", async () => {
  const order = [];
  let neonAnswer = { ok: false, status: 503, retry: true };
  const neon = { deleteUser: async (id) => { order.push(`neon:${id}`); return neonAnswer; } };
  const { handler, auth } = setup({ neon, answer: (c) => { order.push(`store:${c.command}`); return { ok: true, value: { erased: true } }; } });
  let out = plain(await handler(event("DELETE", "/account", { headers: auth({ sub: "acc-del" }) })));
  assert.deepEqual(order, ["store:erase", "neon:acc-del"]);
  assert.equal(out.statusCode, 502);
  assert.deepEqual(json(out), { ok: false, erased: true, error: { code: "IDENTITY_DELETE_FAILED", message: json(out).error.message, retry: true } });
  neonAnswer = { ok: false, status: 401, retry: false };
  out = await handler(event("DELETE", "/account", { headers: auth({ sub: "acc-del" }) }));
  assert.equal(json(out).error.retry, false);
  neonAnswer = { ok: true, status: 404 };
  out = plain(await handler(event("DELETE", "/account", { headers: auth({ sub: "acc-del" }) })));
  assert.equal(out.statusCode, 200);
  assert.deepEqual(json(out), { erased: true, identityDeleted: true });
});

test("X7: a live subscription is 409 and Neon is not called", async () => {
  let called = false;
  const neon = { deleteUser: async () => { called = true; return { ok: true }; } };
  const { handler, auth } = setup({ neon, answer: () => ({ ok: false, code: "SUBSCRIPTION_ACTIVE", message: "live" }) });
  const out = plain(await handler(event("DELETE", "/account", { headers: auth() })));
  assert.equal(out.statusCode, 409);
  assert.equal(json(out).error.code, "SUBSCRIPTION_ACTIVE");
  assert.equal(called, false);
});
