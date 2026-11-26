// E2E — from one player's page to another before the first one's reads answer (FAILURE_MODES_OPTIMISATIONS.md GH129-j,
// written before the change). The deterministic base of tests/e2e/support/reads-dataset.py, served by the real read API
// with every read of player A (p_aaaab1, in its path or its query) held 4 s:
//
//   node tests/e2e/support/read-api-server.mjs <dsn> <port> --delay 120 --slow 'p_aaaab1=4000' --log <file>
//   node tests/e2e/player-navigation.e2e.mjs <site base url> <API origin> <evidence dir>
//
// At 1365 × 900 and 390 × 844: open A's page; once A's reads that need only his id have started, go to B's page
// (p_aaaab4) the way the site's links do (the history's pushState, which the router follows); then:
// N1 none of A's id-only reads answers after the navigation: each is cancelled (net::ERR_ABORTED), its slot free ·
// N2 B's id-only reads are each asked once and answered · N3 B's heading, no page error.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

const [base, api, out] = process.argv.slice(2);
if (!base || !api || !out) throw new Error("usage: node tests/e2e/player-navigation.e2e.mjs <site base url> <API origin> <evidence dir>");
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_CORE || "playwright");
const apiOrigin = new URL(api).origin;
const A = "p_aaaab1", B = "p_aaaab4";
// The reads of the default view that need only the player's id (GH129.1).
const idOnly = (r, id) =>
  r.path === `/api/players/${id}` || r.path === `/api/players/${id}/injuries` ||
  ["/api/player-honours", "/api/player-market-values"].includes(r.path) && r.query.id === id ||
  r.path === "/api/rankings/power/player" && r.query.player === id || r.path === "/api/scouting/routes" && r.query.player === id;
await mkdir(out, { recursive: true });
const results = [], failures = [];
const step = (what) => console.log(`${new Date().toISOString().slice(11, 19)} ${what}`);
const check = (name, fn) => {
  try {
    fn();
    return { name, ok: true };
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
    return { name, ok: false, error: error.message.slice(0, 500) };
  }
};

const browser = await chromium.launch();
for (const [size, width, height] of [["desktop", 1365, 900], ["mobile", 390, 844]]) {
  const context = await browser.newContext({ viewport: { width, height }, locale: "fr-FR", timezoneId: "Europe/Paris" });
  await context.addInitScript(() => localStorage.setItem("vega.consent.v1", JSON.stringify({ measurement: false, at: Date.now() })));
  const page = await context.newPage();
  const errors = [], reads = [];
  page.on("pageerror", (error) => errors.push(String(error).slice(0, 300)));
  const started = Date.now();
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin !== apiOrigin || !url.pathname.startsWith("/api/")) return;
    reads.push({ request, path: url.pathname, query: Object.fromEntries(url.searchParams), start: Date.now() - started, end: null, status: null });
  });
  page.on("response", (response) => {
    const read = reads.find((r) => r.request === response.request());
    if (read && read.end === null) Object.assign(read, { end: Date.now() - started, status: response.status() });
  });
  page.on("requestfailed", (request) => {
    const read = reads.find((r) => r.request === request);
    if (read && read.end === null) Object.assign(read, { end: Date.now() - started, status: `failed ${request.failure()?.errorText}` });
  });
  step(`${size}: open A`);
  await page.goto(`${base}/joueurs?id=${A}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  for (let waited = 0; reads.filter((r) => idOnly(r, A)).length < 5; waited += 50) {
    if (waited > 20_000) throw new Error(`${size}: A's reads never started (${reads.map((r) => r.path).join(", ")})`);
    await page.waitForTimeout(50);
  }
  await page.waitForTimeout(300);
  const left = Date.now() - started;
  step(`${size}: to B at ${left} ms`);
  await page.evaluate((id) => window.history.pushState(null, "", `/joueurs?id=${id}`), B);
  await page.getByText("Cristiano Test", { exact: false }).first().waitFor({ timeout: 30_000 });
  // Quiet: no read pending for 2 s, A's held ones answered or cancelled (they would answer at about 4 s).
  for (let quiet = 0, waited = 0; quiet < 2000 || Date.now() - started < left + 4_500; waited += 250) {
    if (waited > 60_000) throw new Error(`${size}: never quiet`);
    const before = reads.length;
    await page.waitForTimeout(250);
    quiet = !reads.some((r) => r.end === null) && reads.length === before ? quiet + 250 : 0;
  }
  const shot = join(out, `navigation-${size}.png`);
  await page.screenshot({ path: shot, fullPage: false });
  const record = reads.map(({ request, ...r }) => r);
  const aReads = record.filter((r) => idOnly(r, A));
  const bReads = record.filter((r) => idOnly(r, B));
  const checks = [
    check(`N1 ${size}: none of A's id-only reads answers after leaving A`, () => {
      const answered = aReads.filter((r) => typeof r.status === "number" && r.end > left);
      assert.deepEqual(answered.map((r) => `${r.path} ${r.status} at ${r.end} ms`), []);
      assert.ok(aReads.every((r) => String(r.status).includes("ERR_ABORTED") || r.end <= left), JSON.stringify(aReads.map((r) => [r.path, r.status])));
    }),
    check(`N2 ${size}: B's id-only reads asked once each and answered`, () => {
      const keys = bReads.map((r) => `${r.path}?${new URLSearchParams(r.query)}`);
      assert.equal(new Set(keys).size, keys.length, keys.join(" "));
      assert.ok(bReads.length >= 5, keys.join(" "));
      assert.ok(bReads.every((r) => typeof r.status === "number"), JSON.stringify(bReads.map((r) => [r.path, r.status])));
    }),
    check(`N3 ${size}: B's page, no page error`, () => assert.deepEqual(errors, [])),
  ];
  results.push({ size, left, reads: record, a: aReads, b: bReads, errors, checks, shot });
  await context.close();
}
await browser.close();
await writeFile(join(out, "player-navigation.json"), JSON.stringify({
  command: `node tests/e2e/player-navigation.e2e.mjs ${base} ${api} ${out}`, site: base, api, at: new Date().toISOString(), results, failures,
}, null, 1));
for (const r of results)
  console.log(`${r.size}: left A at ${r.left} ms; A ${JSON.stringify(r.a.map((x) => [x.path, x.status]))}; B ${r.b.length} reads`);
for (const f of failures) console.log(`FAILED ${f}`);
console.log(failures.length ? `${failures.length} check(s) failed` : "all checks passed");
process.exit(failures.length ? 1 : 0);
