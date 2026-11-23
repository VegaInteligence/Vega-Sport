// E2E — the competitions page: one header for leagues and cups, a loading skeleton of the page's
// own shape, an immediate first display, and the current and next matchday together.
// Written before the code, from the product review of 23 Nov 2026.
//
// Failure modes and expected outcomes:
//  H1 League (Ligue 1) and featured cup (Champions League): the page title is « Compétitions à la une ».
//  H2 Neither has a « ← … » line between the row of competitions and the edition's header: the
//     competition's card follows the row directly, the same for both (desktop and phone).
//  S1 While the page loads (every API response delayed), the competition skeleton is shown and the
//     Vega logo loader never is (desktop and phone).
//  S2 Its shape: desktop, a table of at least 18 rows with three cards to its right; phone (≤ 1050 px),
//     one column (the cards under the table) and no sideways scroll.
//  F1 No saved choice, browser in French, the visitor-country answer held back 6 s: the page is ready
//     with Ligue 1 less than 2 s after that request started (it no longer waits for it).
//  F2 When the answer (« ES ») arrives, the content stays Ligue 1 (never swapped), and the country is
//     kept in localStorage (`statarena.visitor-country.v1`).
//  F3 Next visit, same browser, country unknown this time: the kept country chooses LaLiga at once.
//  F4 A saved choice (Champions League) opens it and the visitor's country is not asked.
//  M1 Ligue 1, view Matchs: the selected matchday and the next one, each under its own heading, the
//     second being the select's next option; both list matches. The API names the rounds of played
//     matches only, so the next matchday (the earliest unlabelled fixtures, each club once) is an
//     option of its own; the unlabelled rest (« Journée non renseignée ») is never the second block.
//  M2 The arrow moves one matchday: the select's next option, and the second block follows it.
//  M3 On the last matchday, one block only.
//  M4 No API read when moving between matchdays (the calendar is in memory).
//  M5 Phone: the second block's heading is visible; no sideways scroll.
//  M6 Champions League, view Matchs: its round and the next one, the same way.
//  M7 The matchday names answer after the fixtures (held back 1.5 s here, as on a real network): the
//     Matchs view never lists the calendar as « Journée non renseignée » meanwhile. It stays in its
//     loading state (the page is not ready) and then shows the named matchdays at once.
//  X1 No page error in the console during the run (failed loads of remote images excluded).
//
// Run (local front whose API origin is <api>, or one whose API reads must be redirected to <api>):
//   node tests/e2e/competition-page.e2e.mjs <base url> <api base> <evidence dir>
// e.g. node tests/e2e/competition-page.e2e.mjs http://127.0.0.1:3013 http://127.0.0.1:8765 /tmp/competition-e2e
// Data: season 2026/2027 with Ligue 1 (l_3FJFUl) and the Champions League (l_0bfbkO).
// It writes evidence.json (setup, inputs, expected, actual, console) and screenshots into the
// evidence dir; exit code 1 when any check fails.
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const [base = "http://127.0.0.1:3000", api = base, out = path.join(os.tmpdir(), "competition-e2e")] = process.argv.slice(2);
await mkdir(out, { recursive: true });
const require = createRequire(import.meta.url);
const { chromium, devices } = require(process.env.PLAYWRIGHT_CORE || "playwright");

const LEAGUE = "l_3FJFUl", CUP = "l_0bfbkO", LALIGA = "l_0ErfuF", SEASON = "2026/2027";
const COUNTRY_KEY = "statarena.visitor-country.v1", CHOICE_KEY = "statarena.preferred-competition.v1";
const results = [], consoleLog = [];
const check = (id, expected, actual, ok) => {
  results.push({ id, expected, actual, ok: Boolean(ok) });
  console.log(ok ? "PASS" : "FAIL", id, "—", JSON.stringify(actual));
};
const address = (query = {}) => `${base}/competitions/?${new URLSearchParams({ season: SEASON, ...query })}`;
const browser = await chromium.launch();

// API reads go to <api>, optionally after a delay; the site's own routes are left alone.
async function context(kind, { delay = 0, storage = null, country, matchdayDelay = 0 } = {}) {
  const ctx = await browser.newContext(kind === "phone"
    ? { locale: "fr-FR", ...devices["iPhone 14"] }
    : { locale: "fr-FR", viewport: { width: 1440, height: 900 } });
  const apiOrigin = new URL(api).origin, baseOrigin = new URL(base).origin;
  await ctx.route((url) => url.origin !== baseOrigin && /^\/(api|data)\//.test(url.pathname), async (route) => {
    const url = new URL(route.request().url());
    if (delay) await new Promise((r) => setTimeout(r, delay));
    try {
      const response = await fetch(apiOrigin + url.pathname + url.search);
      await route.fulfill({ status: response.status, contentType: response.headers.get("content-type") || "application/json", body: Buffer.from(await response.arrayBuffer()), headers: { "access-control-allow-origin": "*", "access-control-expose-headers": "*" } });
    } catch { await route.abort().catch(() => {}); }
  });
  await ctx.route(/va\.vercel-scripts\.com|_vercel\/(insights|speed-insights)/, (route) => route.abort());
  // The matchday names alone, later than the rest; the read itself is served by the route above.
  if (matchdayDelay) await ctx.route((url) => url.pathname === "/api/matchdays", async (route) => {
    await new Promise((r) => setTimeout(r, matchdayDelay));
    await route.fallback().catch(() => {});
  });
  ctx.countryRequests = [];
  if (country) await ctx.route("**/api/visitor-country", async (route) => {
    ctx.countryRequests.push(Date.now());
    await new Promise((r) => setTimeout(r, country.delay || 0));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ country: country.value ?? null }) }).catch(() => {});
  });
  if (storage) await ctx.addInitScript((entries) => { for (const [k, v] of Object.entries(entries)) try { localStorage.setItem(k, v); } catch {} }, storage);
  return ctx;
}
async function open(ctx, url, tag) {
  const page = await ctx.newPage();
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && consoleLog.push(`[${tag}] ${m.text()}`));
  page.on("pageerror", (e) => consoleLog.push(`[${tag}] pageerror ${e.message}`));
  await page.goto(url, { waitUntil: "commit", timeout: 120000 });
  return page;
}
const ready = (page, timeout = 60000) => page.waitForFunction(() => document.querySelector("#main")?.getAttribute("data-page-ready") === "true" && !document.querySelector("#main [data-page-loading]"), null, { timeout, polling: 50 });
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const shot = (page, name, fullPage = false) => page.screenshot({ path: path.join(out, `${name}.png`), fullPage });
const selectedSpotlight = (page) => page.locator('.league-spotlight-item[aria-pressed="true"] strong').first().textContent().catch(() => null);

// Warm the dev server's routes so timings measure the page, not compilation.
{
  const ctx = await context("desktop", { country: { value: null } });
  const page = await open(ctx, address({ id: LEAGUE }), "warm");
  await ready(page, 120000).catch(() => {});
  await ctx.close();
}

// H1 · H2 — one header.
for (const kind of ["desktop", "phone"]) {
  const ctx = await context(kind, { country: { value: null } });
  for (const [name, id] of [["league", LEAGUE], ["cup", CUP]]) {
    const page = await open(ctx, address({ id }), kind);
    await ready(page);
    const state = await page.evaluate(() => {
      const spotlight = document.querySelector(".league-spotlight");
      return {
        title: document.querySelector("#main h1")?.textContent.trim(),
        returnLine: document.querySelectorAll("#main .cup-return").length,
        afterRow: spotlight?.nextElementSibling?.className || null,
        edition: document.querySelector(".edition-head .edition-name")?.textContent.trim(),
      };
    });
    if (kind === "desktop") check(`H1 title (${name})`, "Compétitions à la une", state.title, state.title === "Compétitions à la une");
    check(`H2 no return line, card after the row (${name}, ${kind})`, { returnLine: 0, afterRow: "competition-detail-layout…" }, state,
      state.returnLine === 0 && /^competition-detail-layout/.test(state.afterRow || "") && Boolean(state.edition));
    await shot(page, `header-${name}-${kind}`);
    await page.close();
  }
  await ctx.close();
}

// S1 · S2 — the skeleton while loading.
for (const kind of ["desktop", "phone"]) {
  const ctx = await context(kind, { delay: 900, country: { value: null } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => consoleLog.push(`[${kind} skeleton] pageerror ${e.message}`));
  await page.addInitScript(() => {
    window.__seen = { logo: 0, skeleton: 0, shape: null, frames: 0 };
    const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0; };
    const visibleIn = (el) => { for (let n = el; n && n !== document.documentElement; n = n.parentElement) if (!visible(n)) return false; return true; };
    const tick = () => {
      window.__seen.frames++;
      if ([...document.querySelectorAll("[data-page-loader]")].some(visibleIn)) window.__seen.logo++;
      const skeleton = [...document.querySelectorAll(".competition-skeleton")].find(visibleIn);
      if (skeleton) {
        window.__seen.skeleton++;
        if (!window.__seen.shape) {
          const table = skeleton.querySelector(".competition-skeleton-table"), cards = [...skeleton.querySelectorAll(".competition-skeleton-card")];
          const t = table?.getBoundingClientRect(), c = cards[0]?.getBoundingClientRect();
          window.__seen.shape = { rows: table?.querySelectorAll(".competition-skeleton-row").length || 0, cards: cards.length, cardsBeside: Boolean(t && c && c.left >= t.right - 1), cardsBelow: Boolean(t && c && c.top >= t.bottom - 1), overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
        }
      }
      if (document.querySelector("#main")?.getAttribute("data-page-ready") === "true" && !document.querySelector("#main [data-page-loading]")) return;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.goto(address({ id: LEAGUE }), { waitUntil: "commit", timeout: 120000 });
  await page.waitForTimeout(1200);
  await shot(page, `loading-${kind}`);
  await ready(page, 90000);
  const seen = await page.evaluate(() => window.__seen);
  check(`S1 skeleton, never the logo (${kind})`, { logo: 0, skeleton: "> 0" }, seen, seen.logo === 0 && seen.skeleton > 0);
  const shape = seen.shape || {};
  check(`S2 skeleton shape (${kind})`, kind === "desktop" ? "≥ 18 rows, 3 cards beside" : "≥ 18 rows, 3 cards below, no overflow", shape,
    shape.rows >= 18 && shape.cards === 3 && (kind === "desktop" ? shape.cardsBeside : shape.cardsBelow && shape.overflow <= 0));
  await ctx.close();
}

// F1 · F2 · F3 · F4 — the first display does not wait for the visitor's country.
{
  const ctx = await context("desktop", { country: { value: "ES", delay: 6000 } });
  const page = await open(ctx, address(), "first visit");
  await page.waitForFunction(() => document.querySelector("#main")?.getAttribute("data-page-ready") === "true", null, { timeout: 60000, polling: 50 });
  const readyAt = Date.now();
  const started = ctx.countryRequests[0];
  const first = { edition: await page.locator(".edition-head .edition-name").first().textContent().catch(() => null), afterRequestMs: started ? readyAt - started : null };
  check("F1 ready with Ligue 1 < 2 s after the country request", { edition: "Ligue 1", afterRequestMs: "< 2000" }, first,
    first.edition === "Ligue 1" && first.afterRequestMs !== null && first.afterRequestMs < 2000);
  await page.waitForTimeout(Math.max(0, started + 6000 - Date.now()) + 1500);
  const later = { edition: await page.locator(".edition-head .edition-name").first().textContent().catch(() => null), selected: await selectedSpotlight(page), kept: await page.evaluate((k) => localStorage.getItem(k), COUNTRY_KEY) };
  check("F2 never swapped, country kept", { edition: "Ligue 1", kept: "ES" }, later, later.edition === "Ligue 1" && later.selected === "Ligue 1" && later.kept === "ES");
  await page.close();
  await ctx.unroute("**/api/visitor-country");
  await ctx.route("**/api/visitor-country", (route) => route.fulfill({ status: 200, contentType: "application/json", body: '{"country":null}' }));
  const next = await open(ctx, address(), "next visit");
  await next.locator('.league-spotlight-item[aria-pressed="true"]').first().waitFor({ timeout: 60000 }).catch(() => {});
  const chosen = await selectedSpotlight(next);
  check("F3 next visit: the kept country chooses LaLiga", "LaLiga", chosen, chosen === "LaLiga");
  await next.close();
  await ctx.close();
}
{
  const ctx = await context("desktop", { storage: { [CHOICE_KEY]: CUP }, country: { value: "ES" } });
  const page = await open(ctx, address(), "saved choice");
  await ready(page);
  const state = { selected: await selectedSpotlight(page), countryRequests: ctx.countryRequests.length };
  check("F4 a saved choice opens at once, country not asked", { selected: "Champions League", countryRequests: 0 }, state, state.selected === "Champions League" && state.countryRequests === 0);
  await ctx.close();
}

// M1 … M6 — the matchday and the next one.
async function matchdays(page) {
  return page.evaluate(() => {
    const select = document.querySelector("#matchday-choice");
    const options = [...(select?.options || [])].map((o) => o.textContent.trim());
    const next = document.querySelectorAll(".matchday-schedule .matchday-next");
    const nextHeading = next[0]?.querySelector("h3, h4");
    return {
      index: select?.selectedIndex ?? -1, options: options.length,
      current: options[select?.selectedIndex ?? -1] || null,
      // The unlabelled rest of the calendar is never shown as « the next matchday ».
      expectedNext: [options[(select?.selectedIndex ?? -1) + 1]].find((label) => label && label !== "Journée non renseignée") || null,
      nextBlocks: next.length, nextHeading: nextHeading?.textContent.trim() || null,
      nextHeadingVisible: Boolean(nextHeading && nextHeading.getBoundingClientRect().height > 0 && getComputedStyle(nextHeading).display !== "none"),
      currentRows: document.querySelectorAll(".matchday-schedule > .match-row, .matchday-schedule .matchday-current .match-row").length,
      nextRows: next[0]?.querySelectorAll(".match-row").length || 0,
    };
  });
}
{
  const ctx = await context("desktop", { country: { value: null } });
  const page = await open(ctx, address({ id: LEAGUE, view: "matchs" }), "matchs");
  await ready(page);
  await page.locator("#matchday-choice").waitFor({ timeout: 60000 });
  let s = await matchdays(page);
  check("M1 the matchday and the next one", { nextBlocks: 1, nextHeading: s.expectedNext }, s,
    s.nextBlocks === 1 && s.expectedNext && s.nextHeading === s.expectedNext && s.currentRows > 0 && s.nextRows > 0);
  await shot(page, "matchs-league-desktop", true);
  const reads = [];
  page.on("request", (r) => /\/api\//.test(new URL(r.url()).pathname) && !/visitor-country|assets/.test(r.url()) && reads.push(r.url()));
  const before = s.index;
  await page.getByRole("button", { name: "Journée suivante" }).click();
  await page.waitForTimeout(300);
  s = await matchdays(page);
  check("M2 the arrow moves one matchday", { index: before + 1, nextHeading: s.expectedNext }, s,
    s.index === before + 1 && (s.expectedNext ? s.nextHeading === s.expectedNext : s.nextBlocks === 0));
  await page.locator("#matchday-choice").selectOption({ index: s.options - 1 });
  await page.waitForTimeout(300);
  s = await matchdays(page);
  check("M3 last matchday: one block", { nextBlocks: 0 }, s, s.index === s.options - 1 && s.nextBlocks === 0);
  check("M4 no API read between matchdays", [], reads, reads.length === 0);
  await page.close();
  await ctx.close();
}
{
  const ctx = await context("phone", { country: { value: null } });
  const page = await open(ctx, address({ id: LEAGUE, view: "matchs" }), "matchs phone");
  await ready(page);
  await page.locator("#matchday-choice").waitFor({ timeout: 60000 });
  const s = await matchdays(page);
  const sideways = await overflow(page);
  check("M5 phone: second heading shown, no sideways scroll", { nextHeadingVisible: true, overflow: 0 }, { ...s, overflow: sideways }, s.nextBlocks === 1 && s.nextHeadingVisible && sideways <= 0);
  await shot(page, "matchs-league-phone", true);
  await page.close();
  await ctx.close();
}
{
  const ctx = await context("desktop", { country: { value: null } });
  const page = await open(ctx, address({ id: CUP, view: "matchs" }), "matchs cup");
  await ready(page);
  await page.locator("#matchday-choice").waitFor({ timeout: 60000 });
  const s = await matchdays(page);
  check("M6 cup: its round and the next one", { nextBlocks: s.expectedNext ? 1 : 0, nextHeading: s.expectedNext }, s,
    s.options > 1 && (s.expectedNext ? s.nextBlocks === 1 && s.nextHeading === s.expectedNext && s.nextRows > 0 : s.nextBlocks === 0));
  await shot(page, "matchs-cup-desktop", true);
  await page.close();
  await ctx.close();
}
{
  const ctx = await context("desktop", { country: { value: null }, matchdayDelay: 1500 });
  const page = await open(ctx, address({ id: LEAGUE, view: "matchs" }), "matchs late names");
  // Sampled from the first paint until the named matchdays are there.
  const seen = { samples: 0, unnamedOnly: 0, unnamedNote: 0, readyWhileUnnamed: 0, loadingWhileWaiting: 0 };
  let s = null;
  for (const start = Date.now(); Date.now() - start < 30000; ) {
    const now = await page.evaluate(() => {
      const select = document.querySelector("#matchday-choice");
      const options = [...(select?.options || [])].map((o) => o.textContent.trim());
      const main = document.querySelector("#main");
      return {
        options,
        note: /n’est pas précisée|Recherche des journées en cours/.test(document.querySelector(".matchday-schedule")?.textContent || ""),
        ready: main?.getAttribute("data-page-ready") === "true" && !main.querySelector("[data-page-loading]"),
        loading: Boolean(main?.querySelector("[data-page-loading]")),
      };
    }).catch(() => null);
    if (now) {
      seen.samples++;
      const unnamed = now.options.length === 1 && now.options[0] === "Journée non renseignée";
      if (unnamed) seen.unnamedOnly++;
      if (now.note) seen.unnamedNote++;
      if (unnamed && now.ready) seen.readyWhileUnnamed++;
      if (!now.options.length && now.loading) seen.loadingWhileWaiting++;
      if (now.options.length > 1) break;
    }
    await page.waitForTimeout(50);
  }
  await ready(page).catch(() => {});
  s = await matchdays(page);
  check("M7 matchday names answered late: never « Journée non renseignée » meanwhile", { unnamedOnly: 0, unnamedNote: 0, readyWhileUnnamed: 0, nextBlocks: 1 }, { ...seen, options: s.options, current: s.current, nextBlocks: s.nextBlocks },
    seen.unnamedOnly === 0 && seen.unnamedNote === 0 && seen.readyWhileUnnamed === 0 && seen.loadingWhileWaiting > 0 && s.options > 1 && s.nextBlocks === 1);
  await shot(page, "matchs-league-late-names", true);
  await page.close();
  await ctx.close();
}

check("X1 no page error", [], consoleLog, consoleLog.length === 0);
await browser.close();
const failed = results.filter((r) => !r.ok);
await writeFile(path.join(out, "evidence.json"), JSON.stringify({
  ranAt: new Date().toISOString(), base, api, inputs: { league: LEAGUE, cup: CUP, laliga: LALIGA, season: SEASON },
  rerun: `node tests/e2e/competition-page.e2e.mjs ${base} ${api} ${out}`,
  results, console: consoleLog, passed: results.length - failed.length, total: results.length,
}, null, 2));
console.log(`${results.length - failed.length}/${results.length} passed · evidence in ${out}`);
process.exit(failed.length ? 1 : 0);
