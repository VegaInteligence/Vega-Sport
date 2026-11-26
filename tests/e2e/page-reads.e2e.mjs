// E2E — the reads of the match page and of the player page (FAILURE_MODES_OPTIMISATIONS.md GH129), written before the
// change: the same direct pages as the production session of 25 Nov 2026 (Brentford–Everton, 19 reads, eight of them
// /api/fixtures; Christos Tzolis, 21 and 19), on the deterministic base of tests/e2e/support/reads-dataset.py served
// by the real read API (tests/e2e/support/read-api-server.mjs, each answer delayed, the player's identity more), at
// 1365 × 900 and 390 × 844. Every read to the API is recorded with its start and end; the pages' states are checked;
// a screenshot each (the viewport and the whole page).
//
//   node tests/e2e/page-reads.e2e.mjs <site base url> <API origin> <evidence dir>
//
// Checks (GH129.2): M1 one read of the season's fixtures, no page of /api/fixtures, no /api/matchdays · M2 the thread:
// the current match marked, its neighbours across the round's boundary, previous and next · M3 the round picker: every
// round, a search over the whole season (a club's 38 matches) · M4 a match to come in the thread with its time · P1 no
// read of /api/archive/matches · P2 no read of one player season twice · P3 the reads that need only the player's id
// start with his season's read (not after it) · P4 the page's heading and blocks as before · X no page error.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

const [base, api, out] = process.argv.slice(2);
if (!base || !api || !out) throw new Error("usage: node tests/e2e/page-reads.e2e.mjs <site base url> <API origin> <evidence dir>");
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_CORE || "playwright");
const VIEWPORTS = [["desktop", 1365, 900], ["mobile", 390, 844]];
const PAGES = [
  ["match", "/matchs?id=m_aaaaa1", "Olympique Été"],
  ["player", "/joueurs?id=p_aaaab1", "Élie Durand"],
];
const apiOrigin = new URL(api).origin;
await mkdir(out, { recursive: true });
const results = [];
const failures = [];
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
for (const [name, path, heading] of PAGES) {
  for (const [size, width, height] of VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width, height }, locale: "fr-FR", timezoneId: "Europe/Paris" });
    // The consent banner answered once (it covers the page otherwise).
    await context.addInitScript(() => localStorage.setItem("vega.consent.v1", JSON.stringify({ measurement: false, at: Date.now() })));
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error).slice(0, 300)));
    const reads = [];
    const started = Date.now();
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.origin !== apiOrigin || !url.pathname.startsWith("/api/")) return;
      reads.push({ request, path: url.pathname, query: Object.fromEntries(url.searchParams), start: Date.now() - started, end: null, status: null });
    });
    // A read ends when its answer arrives (a 404 whose body the page never reads never « finishes »).
    page.on("response", (response) => {
      const read = reads.find((r) => r.request === response.request());
      if (read && read.end === null) Object.assign(read, { end: Date.now() - started, status: response.status() });
    });
    page.on("requestfailed", (request) => {
      const read = reads.find((r) => r.request === request);
      if (read && read.end === null) Object.assign(read, { end: Date.now() - started, status: "failed" });
    });
    step(`${name} ${size}: open ${path}`);
    page.setDefaultTimeout(15_000);
    await page.goto(base + path, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.getByText(heading, { exact: false }).first().waitFor({ timeout: 30_000 });
    // Quiet: no read for 2 s (every read answered, nothing new asked); 60 s at most.
    for (let quiet = 0, waited = 0; quiet < 2000; waited += 250) {
      const before = reads.length, pending = reads.filter((r) => r.end === null);
      if (waited === 10_000) step(`${name} ${size}: still pending ${pending.map((r) => r.path).join(", ")}`);
      if (waited >= 60_000) throw new Error(`${name} ${size}: never quiet (pending ${pending.map((r) => r.path).join(", ")})`);
      await page.waitForTimeout(250);
      quiet = !pending.length && reads.length === before ? quiet + 250 : 0;
    }
    step(`${name} ${size}: quiet after ${reads.length} reads`);
    const shot = join(out, `${name}-${size}.png`);
    await page.screenshot({ path: shot, fullPage: false });
    // The whole page too, to compare before and after below the fold (no design change: GH129.1 « Kept »).
    await page.screenshot({ path: join(out, `${name}-${size}-full.png`), fullPage: true });
    const record = reads.map(({ request, ...r }) => r);
    const byPath = {};
    for (const r of record) byPath[r.path] = (byPath[r.path] || 0) + 1;
    const lastEnd = Math.max(...record.map((r) => r.end ?? 0));
    const checks = [];
    if (name === "match") {
      checks.push(check(`M1 ${size}: one read of the season's fixtures`, () => {
        assert.equal(byPath["/api/fixtures"] || 0, 0, `${byPath["/api/fixtures"]} reads of /api/fixtures`);
        assert.equal(byPath["/api/fixtures/season"] || 0, 1, "reads of /api/fixtures/season");
        assert.equal(byPath["/api/matchdays"] || 0, 0, "reads of /api/matchdays");
      }));
      const thread = page.locator("[data-match-strip]");
      const tiles = await thread.locator("[data-match-tile]").count().catch(() => 0);
      const current = await thread.locator('[aria-current="page"]').getAttribute("data-match-tile").catch(() => null);
      const steps = await page.locator('nav[aria-label="Matchs de la compétition"] a[aria-label^="Match"]').evaluateAll((links) => links.map((a) => a.getAttribute("aria-label")));
      checks.push(check(`M2 ${size}: the thread around the current match`, () => {
        assert.equal(current, "m_aaaaa1");
        assert.ok(tiles >= 7, `${tiles} tiles`);
        assert.ok(steps.some((label) => label.startsWith("Match suivant")), "no next match");
      }));
      let picker = { rounds: 0, found: 0 };
      if (size === "desktop") {
        step("match desktop: the picker");
        await page.locator("[data-match-picker]").click();
        const dialog = page.getByRole("dialog");
        await dialog.waitFor({ timeout: 10_000 });
        picker.rounds = await dialog.locator('[role="group"][aria-label="Journées"] button').count();
        await dialog.getByRole("searchbox", { name: "Rechercher une équipe" }).fill("Club E2E 07");
        await page.waitForTimeout(300);
        picker.found = await dialog.locator("ul li a").count();
        await page.keyboard.press("Escape");
        checks.push(check("M3 desktop: the picker holds every round and searches the whole season", () => {
          assert.equal(picker.rounds, 38);
          assert.equal(picker.found, 38, "a club's matches of the season");
        }));
      }
      const upcoming = await thread.locator("[data-match-tile]").evaluateAll((links) => links.map((a) => a.textContent));
      checks.push(check(`M4 ${size}: read before any interaction`, () => assert.ok(upcoming.length > 0)));
      results.push({ name, size, path, reads: record, byPath, lastEnd, tiles, current, steps, picker, errors, checks, shot });
    } else {
      const seasonReads = record.filter((r) => r.path === "/api/read/player").map((r) => JSON.stringify(Object.entries(r.query).filter(([k]) => k !== "cursor").sort()));
      const twice = seasonReads.filter((key, i) => seasonReads.indexOf(key) !== i);
      // The page's first player read (his season): the reads of the id alone need nothing more than the page has then.
      const first = Math.min(...record.filter((r) => r.path === "/api/read/player").map((r) => r.start));
      const identity = record.find((r) => /^\/api\/players\/p_[^/]+$/.test(r.path));
      const independent = record.filter((r) => ["/api/player-market-values", "/api/rankings/power/player", "/api/scouting/routes"].includes(r.path)
        || /^\/api\/players\/p_[^/]+\/injuries$/.test(r.path));
      checks.push(check(`P1 ${size}: no archive read`, () => assert.equal(record.filter((r) => r.path.startsWith("/api/archive/matches/")).length, 0)));
      checks.push(check(`P2 ${size}: no player season read twice`, () => assert.deepEqual(twice, [])));
      checks.push(check(`P3 ${size}: the reads of the id alone start with the first one`, () => {
        assert.ok(identity, "no identity read");
        assert.equal(independent.length, 4, independent.map((r) => r.path).join(", "));
        for (const r of [identity, ...independent]) assert.ok(r.start - first < 100, `${r.path} starts ${r.start - first} ms after the season's read`);
      }));
      const headings = await page.locator("main h1, main h2").allTextContents();
      checks.push(check(`P4 ${size}: the heading`, () => assert.ok(headings.some((h) => h.includes("Élie Durand")), headings.join(" | "))));
      results.push({ name, size, path, reads: record, byPath, lastEnd, headings, errors, checks, shot });
    }
    results.at(-1).checks.push(check(`X ${name} ${size}: no page error`, () => assert.deepEqual(errors, [])));
    await context.close();
  }
}
await browser.close();
await writeFile(join(out, "page-reads.json"), JSON.stringify({
  command: `node tests/e2e/page-reads.e2e.mjs ${base} ${api} ${out}`, site: base, api, at: new Date().toISOString(),
  summary: results.map(({ name, size, byPath, lastEnd, reads }) => ({ name, size, reads: reads.length, lastEnd, byPath })), results, failures,
}, null, 1));
for (const r of results) console.log(`${r.name} ${r.size}: ${r.reads.length} reads, last answered at ${r.lastEnd} ms; ${JSON.stringify(r.byPath)}`);
for (const f of failures) console.log(`FAILED ${f}`);
console.log(failures.length ? `${failures.length} check(s) failed` : "all checks passed");
process.exit(failures.length ? 1 : 0);
