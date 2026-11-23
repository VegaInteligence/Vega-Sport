// The site's security headers (next.config.mjs) and where the browser's CSP reports go
// (app/api/csp-report). Written before the headers and the route.
//
// Failure modes, and what is expected:
//  H1 A header missing on a kind of route (pages, app/api/*, /_next/static, public files):
//     one rule, source "/:path*", without has/missing, carries every header.
//  H2 A blocking policy sent by mistake: no Content-Security-Policy header, only
//     Content-Security-Policy-Report-Only, until the observation period has ended.
//  H3 HSTS without includeSubDomains (or preloaded without a decision): two years,
//     includeSubDomains, never preload.
//  H4 Framing: X-Frame-Options DENY, and frame-ancestors 'none' in the policy.
//  H5 Permissions-Policy turns off what the site never uses; geolocation only for the
//     official stadium map that asks for it (stadium-plans.js, allowGeolocation).
//  C1 A directive that allows everything: no "*", no bare scheme (https:, http:, wss:).
//  C2 A needed origin forgotten: the API's distribution (NEXT_PUBLIC_API_ORIGIN and
//     API_ORIGIN) for reads and images, the live WebSocket (AppSync Events), the map
//     (MapLibre on unpkg, OpenFreeMap tiles, its blob: worker), each embedded stadium plan.
//     Vercel's own scripts (analytics, speed insights) are same-origin: 'self'.
//  C3 'unsafe-eval' in production (React only needs it in development).
//  C4 Vercel's toolbar and comments on previews: allowed on a preview build only.
//  C5 Reports with nowhere to go: report-uri and report-to name /api/csp-report, and
//     Reporting-Endpoints declares it.
//  R1 A report is written to the logs as one bounded line (path without its query).
//  R2 A body over the size limit is refused (413) without being read whole.
//  R3 Not a report (wrong type: 415; not JSON: 400).
//  R4 A burst of reports: the logs take at most the window's quota, the rest are counted
//     and answered 204 all the same (no retry loop from the browser).
import { test } from "node:test";
import assert from "node:assert/strict";

const API = "https://dngp6kh9jx2bl.cloudfront.net";
const { securityHeaders, contentSecurityPolicy } = await import(
  "../dashboard/frontend/security-headers.mjs"
);
const { allStadiumPlans } = await import("../dashboard/frontend/src/services/stadium-plans.js");

const parse = (policy) =>
  Object.fromEntries(
    policy
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [name, ...values] = part.split(/\s+/);
        return [name, values];
      }),
  );
const byKey = (headers) => Object.fromEntries(headers.map(({ key, value }) => [key, value]));
const production = () =>
  byKey(securityHeaders({ NODE_ENV: "production", NEXT_PUBLIC_API_ORIGIN: API }));

test("H1 one rule carries every header on every path", async () => {
  process.env.NEXT_PUBLIC_API_ORIGIN = API;
  const { default: config } = await import("../dashboard/frontend/next.config.mjs");
  const rules = await config.headers();
  const all = rules.filter((rule) => rule.source === "/:path*");
  assert.equal(all.length, 1);
  assert.equal(all[0].has, undefined);
  assert.equal(all[0].missing, undefined);
  for (const key of [
    "Strict-Transport-Security",
    "X-Content-Type-Options",
    "Referrer-Policy",
    "X-Frame-Options",
    "Permissions-Policy",
    "Content-Security-Policy-Report-Only",
    "Reporting-Endpoints",
  ])
    assert.ok(byKey(all[0].headers)[key], `${key} missing`);
  // No later rule overrides them for a narrower path.
  for (const rule of rules.filter((r) => r !== all[0]))
    for (const { key } of rule.headers)
      assert.ok(!(key in byKey(all[0].headers)), `${rule.source} overrides ${key}`);
});

test("H2 the policy only observes", () => {
  const headers = production();
  assert.equal(headers["Content-Security-Policy"], undefined);
  assert.ok(headers["Content-Security-Policy-Report-Only"]);
});

test("H3 HSTS: two years, subdomains, no preload", () => {
  assert.equal(production()["Strict-Transport-Security"], "max-age=63072000; includeSubDomains");
});

test("H4 no framing by another site", () => {
  const headers = production();
  assert.equal(headers["X-Frame-Options"], "DENY");
  assert.deepEqual(parse(headers["Content-Security-Policy-Report-Only"])["frame-ancestors"], ["'none'"]);
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
  assert.equal(headers["Referrer-Policy"], "strict-origin-when-cross-origin");
});

test("H5 permissions: off, geolocation for the map that asks for it only", () => {
  const policy = production()["Permissions-Policy"];
  for (const feature of ["camera", "microphone", "payment", "usb", "browsing-topics"])
    assert.match(policy, new RegExp(`(^|, )${feature}=\\(\\)`));
  const asking = [
    ...new Set(
      allStadiumPlans()
        .filter((plan) => plan.allowGeolocation)
        .map((plan) => new URL(plan.url).origin),
    ),
  ];
  assert.ok(asking.length >= 1);
  assert.match(policy, new RegExp(`(^|, )geolocation=\\(${asking.map((o) => `"${o}"`).join(" ")}\\)`));
});

test("C1 no directive allows everything", () => {
  const csp = parse(production()["Content-Security-Policy-Report-Only"]);
  for (const [name, values] of Object.entries(csp))
    for (const value of values) {
      assert.notEqual(value, "*", `${name} allows *`);
      if (/^[a-z]+:$/.test(value))
        assert.ok(["data:", "blob:"].includes(value), `${name} allows the scheme ${value}`);
      assert.doesNotMatch(value, /^(https?|wss?):\/\/\*$/, `${name} allows ${value}`);
    }
  assert.deepEqual(csp["default-src"], ["'self'"]);
  assert.deepEqual(csp["object-src"], ["'none'"]);
  assert.deepEqual(csp["base-uri"], ["'self'"]);
  assert.deepEqual(csp["form-action"], ["'self'"]);
});

test("C2 every origin the site needs is allowed", () => {
  const csp = parse(
    contentSecurityPolicy({ NODE_ENV: "production", NEXT_PUBLIC_API_ORIGIN: "http://127.0.0.1:8765" }),
  );
  for (const origin of [API, "http://127.0.0.1:8765"]) {
    assert.ok(csp["connect-src"].includes(origin), `connect-src ${origin}`);
    assert.ok(csp["img-src"].includes(origin), `img-src ${origin}`);
  }
  for (const value of ["'self'", "data:", "blob:"]) assert.ok(csp["img-src"].includes(value));
  assert.ok(csp["connect-src"].includes("'self'"));
  assert.ok(csp["connect-src"].some((v) => /^wss:\/\/\*\.appsync-realtime-api\.[a-z0-9-]+\.amazonaws\.com$/.test(v)));
  assert.ok(csp["connect-src"].includes("https://tiles.openfreemap.org"));
  assert.ok(csp["script-src"].includes("https://unpkg.com/maplibre-gl@5.6.2/"));
  assert.ok(csp["style-src"].includes("https://unpkg.com/maplibre-gl@5.6.2/"));
  assert.ok(csp["worker-src"].includes("blob:"));
  assert.ok(csp["script-src"].includes("'self'"));
  const embedded = [
    ...new Set(
      allStadiumPlans()
        .filter((plan) => plan.embedded && !plan.imageUrl)
        .map((plan) => new URL(plan.url).origin),
    ),
  ];
  assert.ok(embedded.length >= 1);
  assert.deepEqual([...csp["frame-src"]].sort(), embedded.sort());
});

test("C3 no eval in production, only in development", () => {
  assert.doesNotMatch(production()["Content-Security-Policy-Report-Only"], /unsafe-eval/);
  assert.match(contentSecurityPolicy({ NODE_ENV: "development" }), /'unsafe-eval'/);
});

test("C4 Vercel's toolbar on previews only", () => {
  const preview = parse(
    contentSecurityPolicy({ NODE_ENV: "production", VERCEL_ENV: "preview", NEXT_PUBLIC_API_ORIGIN: API }),
  );
  for (const name of ["script-src", "connect-src", "frame-src", "img-src", "style-src", "font-src"])
    assert.ok(preview[name].includes("https://vercel.live"), `${name} on a preview`);
  assert.doesNotMatch(
    contentSecurityPolicy({ NODE_ENV: "production", VERCEL_ENV: "production", NEXT_PUBLIC_API_ORIGIN: API }),
    /vercel\.live/,
  );
});

test("C5 reports go to the site's own endpoint", () => {
  const headers = production();
  const csp = parse(headers["Content-Security-Policy-Report-Only"]);
  assert.deepEqual(csp["report-uri"], ["/api/csp-report"]);
  assert.deepEqual(csp["report-to"], ["csp"]);
  assert.equal(headers["Reporting-Endpoints"], 'csp="/api/csp-report"');
});

// The route, called as Next calls it.
const route = await import("../dashboard/frontend/app/api/csp-report/route.js").catch(() => ({}));
const post = (body, type = "application/csp-report", extra = {}) =>
  route.POST(
    new Request("https://site.test/api/csp-report", {
      method: "POST",
      headers: { "Content-Type": type, ...extra },
      body,
    }),
  );
function capture(fn) {
  const lines = [];
  const original = console.warn;
  console.warn = (...args) => lines.push(args.join(" "));
  return Promise.resolve(fn()).then(
    (result) => ((console.warn = original), { result, lines }),
    (error) => {
      console.warn = original;
      throw error;
    },
  );
}
const legacy = (uri = "https://evil.example/x.js?token=1") =>
  JSON.stringify({
    "csp-report": {
      "document-uri": "https://site.test/joueurs?id=p_abc123&secret=1",
      "violated-directive": "script-src-elem",
      "effective-directive": "script-src-elem",
      "blocked-uri": uri,
      "source-file": "https://site.test/_next/static/chunks/a.js",
      "line-number": 3,
      disposition: "report",
    },
  });

test("R1 a report becomes one bounded log line", async () => {
  route.__resetForTests?.();
  const { result, lines } = await capture(() => post(legacy("https://evil.example/" + "a".repeat(5000))));
  assert.equal(result.status, 204);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^\[csp\] /);
  const entry = JSON.parse(lines[0].slice(6));
  assert.equal(entry.directive, "script-src-elem");
  assert.equal(entry.page, "/joueurs");
  assert.ok(lines[0].length < 1200);
  // The Reporting API's batch form too.
  const batch = JSON.stringify([
    { type: "csp-violation", url: "https://site.test/?q=1", body: { effectiveDirective: "img-src", blockedURL: "data", documentURL: "https://site.test/?q=1", disposition: "report" } },
  ]);
  const second = await capture(() => post(batch, "application/reports+json"));
  assert.equal(second.result.status, 204);
  assert.equal(JSON.parse(second.lines[0].slice(6)).directive, "img-src");
});

test("R2 an oversized body is refused", async () => {
  route.__resetForTests?.();
  const { result, lines } = await capture(() => post("x".repeat(70_000)));
  assert.equal(result.status, 413);
  assert.equal(lines.length, 0);
  const declared = await post("{}", "application/csp-report", { "Content-Length": "999999" });
  assert.equal(declared.status, 413);
});

test("R3 what is not a report is refused", async () => {
  route.__resetForTests?.();
  assert.equal((await post(legacy(), "text/plain")).status, 415);
  assert.equal((await post("{not json", "application/csp-report")).status, 400);
  assert.equal(route.GET, undefined);
});

test("R4 a burst fills the window's quota, no more", async () => {
  route.__resetForTests?.();
  const { result, lines } = await capture(async () => {
    let last;
    for (let i = 0; i < 200; i++) last = await post(legacy());
    return last;
  });
  assert.equal(result.status, 204);
  assert.ok(lines.length >= 1 && lines.length <= route.LOG_QUOTA + 1, `${lines.length} lines`);
});
