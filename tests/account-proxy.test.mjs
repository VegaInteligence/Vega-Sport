// The same-origin relay of the account API (VI-38, site side): app/api/account/[[...path]]/route.js through
// dashboard/frontend/src/server/account-proxy.js. Written before that module, from docs/COMPTES_SITE.md section 2:
//  P1 only the five routes, exact paths; P2 405 with Allow; P3 no query string; P4 writes need same-origin
//  (Sec-Fetch-Site, else Origin) and a JSON content type, checked before the session; P5 no session → 401, Neon
//  unreachable → 503; P6 the JWT only in X-Vega-Session upstream, never back, the browser's cookies and origin not
//  forwarded; P7 no-store on every answer; P8 upstream down, slow or not JSON → 502 ACCOUNT_UNREACHABLE; P9 status,
//  JSON body, If-Match and Content-Disposition passed through; P10 over 4 MiB → 413. W2 sync off → 503.
import test from "node:test";
import assert from "node:assert/strict";
import {
  ACCOUNT_ROUTES,
  MAX_BODY,
  handleAccountRequest,
} from "../dashboard/frontend/src/server/account-proxy.js";

const SITE = "https://vegasport.vercel.app";
const UPSTREAM = "https://abc.lambda-url.us-east-2.on.aws";
const JWT = "eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJhIn0.c2ln";

function setup({ token = { token: JWT }, answer, features = { auth: true, sync: true } } = {}) {
  const calls = [];
  const tokens = [];
  const deps = {
    features,
    upstream: UPSTREAM,
    timeoutMs: 50,
    getToken: async () => (tokens.push(1), token),
    fetch: async (url, init) => {
      calls.push({ url, ...init, headers: Object.fromEntries(new Headers(init.headers)) });
      if (answer) return answer(url, init);
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json; charset=utf-8" } });
    },
  };
  return { deps, calls, tokens };
}
const segmentsOf = (path) => path.replace(/^\/api\/account\/?/, "").split("/").filter((s, i, all) => !(s === "" && all.length === 1));
function request(method, path, { headers = {}, body } = {}) {
  return new Request(`${SITE}${path}`, { method, headers, body });
}
const sameOrigin = { "sec-fetch-site": "same-origin", origin: SITE, "content-type": "application/json" };
async function call(method, path, opts = {}, setupOptions = {}) {
  const s = setup(setupOptions);
  const url = new URL(`${SITE}${path}`);
  const segments = url.pathname === "/api/account" ? [] : url.pathname.slice("/api/account/".length).split("/");
  const response = await handleAccountRequest(request(method, path, opts), { segments, ...s.deps });
  const text = await response.text();
  return { ...s, response, status: response.status, body: text ? JSON.parse(text) : null };
}

test("the five routes, exactly", () => {
  assert.deepEqual(ACCOUNT_ROUTES, {
    session: ["POST"],
    preferences: ["GET", "PUT"],
    export: ["GET"],
    "": ["DELETE"],
  });
  assert.equal(MAX_BODY, 4 * 1024 * 1024);
  assert.ok(segmentsOf);
});

test("P1 another path is not relayed", async () => {
  for (const path of ["/api/account/preferences/x", "/api/account//session", "/api/account/SESSION", "/api/account/merge", "/api/account/session/"]) {
    const out = await call("GET", path, { headers: sameOrigin });
    assert.equal(out.status, 404, path);
    assert.equal(out.body.error.code, "NOT_FOUND");
    assert.equal(out.calls.length, 0);
    assert.equal(out.tokens.length, 0);
  }
});

test("P2 another method: 405 with Allow", async () => {
  const out = await call("POST", "/api/account/preferences", { headers: sameOrigin, body: "{}" });
  assert.equal(out.status, 405);
  assert.equal(out.response.headers.get("allow"), "GET, PUT");
  assert.equal(out.calls.length, 0);
  assert.equal((await call("GET", "/api/account", {})).status, 405);
});

test("P3 a query string is refused", async () => {
  const out = await call("GET", "/api/account/preferences?x=1");
  assert.equal(out.status, 400);
  assert.equal(out.body.error.code, "INVALID_REQUEST");
  assert.equal(out.calls.length, 0);
});

test("P4 writes from another site are refused before the session is read", async () => {
  const cases = [
    [{ "sec-fetch-site": "cross-site", origin: "https://evil.example", "content-type": "application/json" }, 403],
    [{ "sec-fetch-site": "same-site", origin: "https://x.vegasport.vercel.app", "content-type": "application/json" }, 403],
    [{ origin: "https://evil.example", "content-type": "application/json" }, 403],
    [{ origin: "null", "content-type": "application/json" }, 403],
    [{ "content-type": "application/json" }, 403], // neither header: refused
    [{ "sec-fetch-site": "same-origin", origin: SITE, "content-type": "text/plain" }, 415],
    [{ "sec-fetch-site": "same-origin", origin: SITE }, 415],
    [{ "sec-fetch-site": "same-origin", origin: SITE, "content-type": "application/x-www-form-urlencoded" }, 415],
  ];
  for (const [method, path] of [["POST", "/api/account/session"], ["PUT", "/api/account/preferences"], ["DELETE", "/api/account"]])
    for (const [headers, status] of cases) {
      const out = await call(method, path, { headers, body: method === "DELETE" ? undefined : "{}" });
      assert.equal(out.status, status, `${method} ${path} ${JSON.stringify(headers)}`);
      assert.equal(out.body.error.code, status === 403 ? "ORIGIN_REFUSED" : "UNSUPPORTED_MEDIA_TYPE");
      assert.equal(out.tokens.length, 0);
      assert.equal(out.calls.length, 0);
    }
  // Same origin by Origin alone (a browser without Fetch Metadata), with a charset.
  const ok = await call("POST", "/api/account/session", { headers: { origin: SITE, "content-type": "application/json; charset=utf-8" }, body: "{}" });
  assert.equal(ok.status, 200);
  // The site's own origin is the one the browser addressed (Host, or X-Forwarded-Host behind Vercel's proxy), even
  // when the server sees another URL (`next start` gives http://localhost:<port>).
  const s = setup();
  const behind = await handleAccountRequest(
    new Request("http://localhost:3100/api/account/session", { method: "POST", headers: { host: "127.0.0.1:3100", origin: "http://127.0.0.1:3100", "content-type": "application/json" }, body: "{}" }),
    s.deps,
  );
  assert.equal(behind.status, 200);
  const forwarded = await handleAccountRequest(
    new Request("http://localhost:3100/api/account/session", { method: "POST", headers: { host: "localhost:3100", "x-forwarded-host": "vegasport.vercel.app", "x-forwarded-proto": "https", origin: SITE, "content-type": "application/json" }, body: "{}" }),
    s.deps,
  );
  assert.equal(forwarded.status, 200);
  const spoofed = await handleAccountRequest(
    new Request("http://localhost:3100/api/account/session", { method: "POST", headers: { host: "127.0.0.1:3100", origin: "http://127.0.0.1:3101", "content-type": "application/json" }, body: "{}" }),
    s.deps,
  );
  assert.equal(spoofed.status, 403);
  // A read needs neither (a same-origin GET may carry no Origin).
  assert.equal((await call("GET", "/api/account/preferences")).status, 200);
});

test("P5 no session: 401; Neon out of reach: 503", async () => {
  const none = await call("GET", "/api/account/preferences", {}, { token: { error: "missing" } });
  assert.equal(none.status, 401);
  assert.equal(none.body.error.code, "SESSION_REQUIRED");
  assert.equal(none.calls.length, 0);
  const down = await call("GET", "/api/account/preferences", {}, { token: { error: "unavailable" } });
  assert.equal(down.status, 503);
  assert.equal(down.body.error.code, "AUTH_UNAVAILABLE");
  assert.equal(down.body.error.retry, true);
  const thrown = await call("GET", "/api/account/preferences", {}, { token: Promise.reject(new Error("boom")) });
  assert.equal(thrown.status, 503);
});

test("P6 the JWT goes upstream in X-Vega-Session only; the browser's cookies and origin do not", async () => {
  const out = await call("PUT", "/api/account/preferences", {
    headers: { ...sameOrigin, cookie: "__Secure-neon-auth.session_token=secret", "if-match": "3", authorization: "Bearer x", "x-forwarded-for": "203.0.113.9" },
    body: JSON.stringify({ v: 1 }),
  });
  assert.equal(out.status, 200);
  const [upstream] = out.calls;
  assert.equal(upstream.url, `${UPSTREAM}/account/preferences`);
  assert.equal(upstream.method, "PUT");
  assert.equal(upstream.headers["x-vega-session"], JWT);
  assert.equal(upstream.headers["if-match"], "3");
  assert.equal(upstream.headers["content-type"], "application/json");
  for (const name of ["cookie", "origin", "authorization", "x-forwarded-for", "sec-fetch-site"]) assert.equal(upstream.headers[name], undefined, name);
  assert.equal(upstream.body, JSON.stringify({ v: 1 }));
  assert.equal(upstream.redirect, "error");
  assert.equal(upstream.cache, "no-store");
  for (const [name, value] of out.response.headers) assert.ok(!value.includes(JWT), name);
  // The other routes map to their path without /api.
  assert.equal((await call("POST", "/api/account/session", { headers: sameOrigin, body: "{}" })).calls[0].url, `${UPSTREAM}/account/session`);
  assert.equal((await call("POST", "/api/account/session", { headers: sameOrigin, body: "{}" })).calls[0].body, undefined);
  assert.equal((await call("GET", "/api/account/export")).calls[0].url, `${UPSTREAM}/account/export`);
  assert.equal((await call("DELETE", "/api/account", { headers: sameOrigin })).calls[0].url, `${UPSTREAM}/account`);
  // An If-Match that is not a revision is not forwarded.
  const odd = await call("PUT", "/api/account/preferences", { headers: { ...sameOrigin, "if-match": "*" }, body: "{}" });
  assert.equal(odd.status, 400);
  assert.equal(odd.calls.length, 0);
});

test("P7 every answer says no-store", async () => {
  for (const out of [
    await call("GET", "/api/account/nope"),
    await call("GET", "/api/account/preferences"),
    await call("GET", "/api/account/preferences", {}, { token: { error: "missing" } }),
    await call("GET", "/api/account/preferences", {}, { features: { auth: true, sync: false } }),
  ]) {
    assert.equal(out.response.headers.get("cache-control"), "no-store");
    assert.equal(out.response.headers.get("x-content-type-options"), "nosniff");
    assert.match(out.response.headers.get("content-type"), /^application\/json/);
  }
});

test("P8 the account API down, slow or not JSON: 502 ACCOUNT_UNREACHABLE", async () => {
  const thrown = await call("GET", "/api/account/preferences", {}, { answer: () => Promise.reject(new TypeError("fetch failed")) });
  assert.equal(thrown.status, 502);
  assert.equal(thrown.body.error.code, "ACCOUNT_UNREACHABLE");
  assert.equal(thrown.body.error.retry, true);
  const slow = await call("GET", "/api/account/preferences", {}, {
    answer: (url, init) => new Promise((resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason))),
  });
  assert.equal(slow.status, 502);
  const html = await call("GET", "/api/account/preferences", {}, { answer: () => new Response("<html>oops</html>", { status: 500, headers: { "content-type": "text/html" } }) });
  assert.equal(html.status, 502);
  assert.ok(!JSON.stringify(html.body).includes("oops"));
});

test("P9 status, JSON body and the export's disposition pass through", async () => {
  const stale = { ok: false, revision: 7, error: { code: "STALE", message: "Les préférences ont changé depuis cette version.", retry: false } };
  const out = await call("PUT", "/api/account/preferences", { headers: { ...sameOrigin, "if-match": "6" }, body: "{}" }, {
    answer: () => new Response(JSON.stringify(stale), { status: 409, headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "x", "set-cookie": "a=b" } }),
  });
  assert.equal(out.status, 409);
  assert.deepEqual(out.body, stale);
  assert.equal(out.response.headers.get("access-control-allow-origin"), null);
  assert.equal(out.response.headers.get("set-cookie"), null);
  const exported = await call("GET", "/api/account/export", {}, {
    answer: () => new Response(JSON.stringify({ format: "vega-account-export" }), { status: 200, headers: { "content-type": "application/json", "content-disposition": 'attachment; filename="vega-account-export.json"' } }),
  });
  assert.equal(exported.response.headers.get("content-disposition"), 'attachment; filename="vega-account-export.json"');
  for (const [status, code] of [[503, "DELETION_UNAVAILABLE"], [409, "SUBSCRIPTION_ACTIVE"], [410, "ACCOUNT_ERASED"]]) {
    const erase = await call("DELETE", "/api/account", { headers: sameOrigin }, {
      answer: () => new Response(JSON.stringify({ ok: false, error: { code, message: "m", retry: false } }), { status, headers: { "content-type": "application/json" } }),
    });
    assert.equal(erase.status, status);
    assert.equal(erase.body.error.code, code);
  }
});

test("P10 a body over 4 MiB is refused before anything", async () => {
  const out = await call("PUT", "/api/account/preferences", { headers: sameOrigin, body: "x".repeat(MAX_BODY + 1) });
  assert.equal(out.status, 413);
  assert.equal(out.body.error.code, "BODY_TOO_LARGE");
  assert.equal(out.calls.length, 0);
});

test("W1 W2 the switch: off → 404, sync off → 503 SYNC_UNAVAILABLE, nothing called", async () => {
  const off = await call("GET", "/api/account/preferences", {}, { features: { auth: false, sync: false } });
  assert.equal(off.status, 404);
  assert.equal(off.tokens.length, 0);
  const noSync = await call("POST", "/api/account/session", { headers: sameOrigin, body: "{}" }, { features: { auth: true, sync: false } });
  assert.equal(noSync.status, 503);
  assert.equal(noSync.body.error.code, "SYNC_UNAVAILABLE");
  assert.equal(noSync.tokens.length, 0);
  assert.equal(noSync.calls.length, 0);
});
