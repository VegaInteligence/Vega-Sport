// E2E — the home's « À l'affiche » and « Chez vous » (VI-48, #69), built on the current home (the separate mock-up
// was rejected on 23 Nov 2026: same page, same components, two additions).
//
// Failure modes and expected outcomes (the API's answers are read by this script, then compared with the page):
//  A1 « À l'affiche » keeps the block's place and layout, fed by the API's `billboard`: the big card is the most
//     important match not finished (served `weight`), the rows the next most important in kickoff order; a finished
//     row shows its score where the others show their kickoff. Eyebrow « À l’affiche ».
//  A2 The API serves no `billboard` (older publication or backend) → the block stays, chosen from `highlights` as
//     before VI-48 (checked with the test double's switch; not run against an API without it).
//  F1 France (x-vercel-ip-country FR, no choice): a « Chez vous » strip under the results strip, its button « France »
//     with its flag, the cells = /api/read/home-local?country=FRA's matches in the API's order, grouped by day with the
//     day's label, a finished match with its score, a coming one with its Paris kickoff.
//  F2 The strip is drawn by the server already (first HTML), not only after the browser's reads.
//  B1 Brazil (BR): the same with BRA's matches and « Brésil ».
//  T1 « Course au titre » opens on the visitor's country's league when it is among the tables (GB → ENG → Premier
//     League; FR → Ligue 1); Brazil, absent from the tables, keeps the default (Ligue 1).
//  M1 The country menu lists the manifest's countries and « Ne rien afficher »; choosing Brésil while detected in
//     France shows Brazil, and still after a reload (orion.preferences.v1 homeCountry and the home cookie).
//  N1 « Ne rien afficher »: the strip leaves, and stays away after a reload (no home-local read by the browser).
//  U1 A country without competition (JP → JPN) or no country (XX) → no strip, nothing else changes.
//  P1 Phone 393 × 852: no sideways page scroll; the strip scrolls inside itself as the results strip.
//  X1 No page error and no console error during the run (failed remote loads excluded).
//
// Run against the site and the API it reads (the API origin defaults to the public one):
//   node tests/e2e/home-local.e2e.mjs <base url> <evidence dir> [api origin]
// (VEGA_IMAGES=<replay origin>: a local run serves the public image copies from a recorded replay.)
// Before the backend of VI-48 is deployed, the API is the test double tests/e2e/support/home-v2-overlay.mjs in front of
// the real API (or a recorded replay of it), and the clock is fixed in the three places: VEGA_NOW=<ISO> for this
// script (the browser's clock), the double's third argument, and the site's server (NODE_OPTIONS="--require
// tests/e2e/support/clock.cjs" VEGA_NOW=<ISO>). It writes evidence.json (setup, inputs, expected, actual, console)
// and the screenshots into the evidence dir; exit code 1 when a check fails.
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { europeFocusIds } from "../../dashboard/shared/competition-scope.js";

const [base = "http://127.0.0.1:3000", out = path.join(os.tmpdir(), "vi-48-e2e"), api = "https://dngp6kh9jx2bl.cloudfront.net"] = process.argv.slice(2);
const NOW = process.env.VEGA_NOW || null;
await mkdir(out, { recursive: true });
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || "playwright");

const results = [], consoleLog = [], inputs = {};
const check = (id, expected, actual, ok) => {
  results.push({ id, expected, actual, ok: Boolean(ok) });
  console.log(ok ? "PASS" : "FAIL", id, "—", String(JSON.stringify(actual ?? null)).slice(0, 400));
};
const notRun = (id, why) => {
  results.push({ id, ok: null, notRun: why });
  console.log("NOT RUN", id, "—", why);
};
const getJson = async (p) => {
  const r = await fetch(api + p, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`${r.status} ${p}`);
  return r.json();
};
const query = (values) => new URLSearchParams(Object.entries(values).sort(([a], [b]) => a.localeCompare(b))).toString();

// What the API serves, read as the site reads it.
const manifest = await getJson("/api/dashboard/manifest");
const season = manifest.defaultSeason,
  generation = manifest.publicationVersion;
const homePath = `/api/read/home?${query({ generation, leagues: [...europeFocusIds(manifest)].sort().join(","), season })}`;
const localRead = async (country) => (await getJson(`/api/read/home-local?${query({ country, generation, season })}`)).data;
const home = (await getJson(homePath)).data;
inputs.manifest = { season, generation, homeLocal: manifest.capabilities?.compactReads?.["home-local"] ?? null };
inputs.homePath = homePath;

// The expected « À l'affiche » for a visitor without favourites, from the served weights.
const heaviest = (a, b) => (b.weight ?? 0) - (a.weight ?? 0) || a.time - b.time || a.fixture.id.localeCompare(b.fixture.id);
const byKickoff = (a, b) => a.day.localeCompare(b.day) || a.time - b.time || a.fixture.id.localeCompare(b.fixture.id);
function expectedBillboard(billboard, now) {
  const big = [...billboard].sort(heaviest);
  const lead = big.find((m) => m.fixture.status !== "finished");
  if (!lead) return null;
  let five = big.slice(0, 5);
  if (!five.includes(lead)) five = [...five.slice(0, 4), lead];
  return { lead, rows: five.filter((m) => m !== lead).sort(byKickoff), now };
}
function expectedHighlights(highlights, now) {
  const big = highlights.filter((m) => m.time >= now).sort(heaviest).slice(0, 5);
  return big.length ? { lead: big[0], rows: big.slice(1) } : null;
}
const paris = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" });
const dayLabel = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const shortDay = (day) => dayLabel.format(new Date(day + "T12:00:00Z"));
const idOf = (href) => new URL(href, base).searchParams.get("id");

const browser = await chromium.launch();
async function newContext({ country, phone = false } = {}) {
  const context = await browser.newContext({
    locale: "fr-FR", timezoneId: "Europe/Paris", colorScheme: "dark", deviceScaleFactor: 2,
    viewport: phone ? { width: 393, height: 852 } : { width: 1440, height: 1000 },
    isMobile: phone, hasTouch: phone,
    extraHTTPHeaders: country ? { "x-vercel-ip-country": country } : {},
  });
  if (NOW) await context.clock.setFixedTime(new Date(NOW));
  // Local runs on a recorded replay: the public API's image copies come from the replay (VEGA_IMAGES=<its origin>).
  if (process.env.VEGA_IMAGES)
    await context.route(`${new URL(api.startsWith("http://127.0.0.1") ? "https://dngp6kh9jx2bl.cloudfront.net" : api).origin}/**`, async (route) => {
      const u = new URL(route.request().url());
      const r = await fetch(process.env.VEGA_IMAGES + u.pathname + u.search).catch(() => null);
      if (!r) return route.abort();
      return route.fulfill({ status: r.status, contentType: r.headers.get("content-type") || undefined, body: Buffer.from(await r.arrayBuffer()), headers: { "access-control-allow-origin": "*" } });
    });
  return context;
}
async function open(context, tag) {
  const page = await context.newPage();
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource|vercel-scripts/.test(m.text()) && consoleLog.push(`[${tag}] ${m.text()}`));
  page.on("pageerror", (e) => consoleLog.push(`[${tag}] pageerror ${e.message}`));
  const reads = [];
  page.on("request", (r) => /\/api\/read\/home-local/.test(r.url()) && reads.push(r.url()));
  const response = await page.goto(base + "/", { waitUntil: "domcontentloaded", timeout: 120000 });
  const html = await response.text();
  await page.locator(".home-next").waitFor({ timeout: 60000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  return { page, html, reads };
}
async function settle(page) {
  // Lazy crests: walk the page once, then back to the top.
  await page.evaluate(async () => {
    for (let y = 0; y < document.documentElement.scrollHeight; y += 600) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 100));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(600);
}
const shot = (page, name, options = {}) => page.screenshot({ path: path.join(out, `${name}.png`), fullPage: true, ...options });
const strip = (page) =>
  page.locator(".home-local").evaluateAll((sections) =>
    sections.map((s) => ({
      kicker: s.querySelector(".home-kicker")?.textContent,
      button: s.querySelector(".home-local-country span:not(.national-flag)")?.textContent,
      flag: [...(s.querySelector(".home-local-country .national-flag")?.classList || [])].find((c) => c.startsWith("fi-")),
      days: [...s.querySelectorAll(".home-ticker-day")].map((d) => d.textContent),
      cells: [...s.querySelectorAll(".home-tick")].map((t) => ({
        id: t.querySelector(".home-tick-top")?.getAttribute("href"),
        state: t.querySelector(".home-tick-top span:last-child")?.textContent,
        teams: [...t.querySelectorAll(".home-tick-team")].map((x) => [x.querySelector(":scope > span:not(.crest)")?.textContent, x.querySelector("b")?.textContent ?? null]),
      })),
    })),
  );
function expectedStrip(data) {
  const days = [];
  for (const m of data.matches) if (days.at(-1) !== m.day) days.push(m.day);
  return {
    days: days.map(shortDay),
    cells: data.matches.map((m) => {
      const x = m.fixture, done = x.status === "finished", live = x.status === "in_play";
      const scored = Number.isInteger(x.score_home) && Number.isInteger(x.score_away);
      return {
        id: x.id,
        state: done ? "Terminé" : live ? "En cours" : paris.format(m.time),
        teams: [[x.home_team.name, (done || live) && scored ? String(x.score_home) : null], [x.away_team.name, (done || live) && scored ? String(x.score_away) : null]],
      };
    }),
  };
}
const sameStrip = (shown, data) => {
  const want = expectedStrip(data);
  const got = { days: shown.days, cells: shown.cells.map((c) => ({ ...c, id: idOf(c.id) })) };
  return { ok: JSON.stringify(got) === JSON.stringify(want), want, got };
};
// The tab's name, without the crest's initials while its image loads.
const titleTab = (page) =>
  page.locator('.home-race .home-tabs button[aria-pressed="true"]').evaluate((b) => b.childNodes[b.childNodes.length - 1]?.textContent?.trim()).catch(() => null);
async function nextBlock(page) {
  return page.locator(".home-next").evaluate((card) => ({
    kicker: card.querySelector(".home-kicker")?.textContent,
    title: card.querySelector("h2")?.textContent,
    lead: [...card.querySelectorAll(".home-next-main .home-next-team strong")].map((s) => s.textContent),
    rows: [...card.querySelectorAll(".home-next-list a")].map((a) => ({ href: a.getAttribute("href"), time: a.querySelector(".home-next-time b")?.textContent })),
  }));
}
const nowMs = NOW ? Date.parse(NOW) : Date.now();

// ---------- France: the strip, the server's first HTML, « À l'affiche », the title race ----------
const fra = await localRead("FRA");
inputs.FRA = { matches: fra.matches.length, competitions: fra.competitions.map((c) => c.id), window: fra.window };
let context = await newContext({ country: "FR" });
let { page, html } = await open(context, "fr");
await page.locator(".home-local .home-tick").first().waitFor({ timeout: 30000 }).catch(() => {});
await settle(page);
let [shown] = await strip(page);
let cmp = shown ? sameStrip(shown, fra) : { ok: false };
check("F1 France: the strip = home-local FRA", { button: "France", flag: "fi-fr", cells: fra.matches.length }, shown && { kicker: shown.kicker, button: shown.button, flag: shown.flag, cells: shown.cells.length, firstDiff: cmp.ok ? null : { want: cmp.want?.cells?.[0], got: cmp.got?.cells?.[0] } },
  shown && /chez vous/i.test(shown.kicker) && shown.button === "France" && shown.flag === "fi-fr" && fra.matches.length > 0 && cmp.ok);
check("F2 the strip is in the server's first HTML", "class home-local and France in the document", { strip: html.includes('class="home-local"'), france: html.includes("France") }, html.includes('class="home-local"'));
check("T1 France: the title race opens on Ligue 1", "Ligue 1", await titleTab(page), (await titleTab(page)) === "Ligue 1");
if (Array.isArray(home.billboard)) {
  const want = expectedBillboard(home.billboard, nowMs);
  const got = await nextBlock(page);
  const rowsOk = want && JSON.stringify(got.rows.map((r) => idOf(r.href))) === JSON.stringify(want.rows.map((m) => m.fixture.id));
  const timesOk = want && got.rows.every((r, i) => {
    const x = want.rows[i]?.fixture;
    if (!x) return false;
    return x.status === "finished" ? r.time === `${x.score_home} – ${x.score_away}` : r.time === paris.format(want.rows[i].time);
  });
  check("A1 « À l'affiche » = billboard by served weight", want && { lead: [want.lead.fixture.home_team.name, want.lead.fixture.away_team.name], rows: want.rows.map((m) => m.fixture.id) },
    { kicker: got.kicker, title: got.title, lead: got.lead, rows: got.rows.map((r) => [idOf(r.href), r.time]) },
    want && /affiche/i.test(got.kicker) && got.lead.join("|") === [want.lead.fixture.home_team.name, want.lead.fixture.away_team.name].join("|") && rowsOk && timesOk);
  inputs.billboard = { count: home.billboard.length, finishedInFive: want ? [want.lead, ...want.rows].filter((m) => m.fixture.status === "finished").length : 0 };
} else notRun("A1 « À l'affiche » = billboard", "the API serves no billboard");
await shot(page, "desktop-france");
await page.close();
await context.close();

// ---------- England: GB → ENG, the title race on the Premier League ----------
context = await newContext({ country: "GB" });
({ page } = await open(context, "gb"));
await page.locator(".home-local .home-tick").first().waitFor({ timeout: 30000 }).catch(() => {});
[shown] = await strip(page);
const tab = await titleTab(page);
check("T1 GB → ENG: the strip says Angleterre, the title race opens on the Premier League", { button: "Angleterre", tab: "Premier League" }, { button: shown?.button, tab }, shown?.button === "Angleterre" && tab === "Premier League");
await page.close();
await context.close();

// ---------- Brazil: the strip, the default title race, the menu, the manual choice, « Ne rien afficher » ----------
const bra = await localRead("BRA");
inputs.BRA = { matches: bra.matches.length, competitions: bra.competitions.map((c) => c.id), window: bra.window };
context = await newContext({ country: "BR" });
({ page } = await open(context, "br"));
await page.locator(".home-local .home-tick").first().waitFor({ timeout: 30000 }).catch(() => {});
await settle(page);
[shown] = await strip(page);
cmp = shown ? sameStrip(shown, bra) : { ok: false };
check("B1 Brazil: the strip = home-local BRA", { button: "Brésil", flag: "fi-br", cells: bra.matches.length }, shown && { button: shown.button, flag: shown.flag, cells: shown.cells.length, firstDiff: cmp.ok ? null : { want: cmp.want?.cells?.[0], got: cmp.got?.cells?.[0] } },
  shown && shown.button === "Brésil" && shown.flag === "fi-br" && bra.matches.length > 0 && cmp.ok);
check("T1 Brazil (not among the tables): the title race keeps Ligue 1", "Ligue 1", await titleTab(page), (await titleTab(page)) === "Ligue 1");
await shot(page, "desktop-bresil");
if (await page.locator(".home-local").count()) await page.locator(".home-local").screenshot({ path: path.join(out, "chez-vous-bresil.png") });
await page.locator(".home-next").screenshot({ path: path.join(out, "a-l-affiche.png") });
await page.close();
await context.close();

context = await newContext({ country: "FR" });
({ page } = await open(context, "menu"));
await settle(page);
await page.locator(".home-local-country").click({ timeout: 30000 });
const menu = page.getByRole("menu", { name: "Pays" });
await menu.waitFor({ timeout: 10000 });
const items = await menu.getByRole("menuitemradio").allTextContents();
const manifestCountries = new Set((manifest.competitions || []).map((c) => c.country));
check("M1 the menu: the manifest's countries, France checked, « Ne rien afficher » last",
  { includes: ["France", "Brésil", "Angleterre"], last: "Ne rien afficher", noPseudo: ["International", "Europe"] },
  { count: items.length, first: items.slice(0, 3), last: items.at(-1), checked: await menu.locator('[aria-checked="true"]').textContent() },
  ["France", "Brésil", "Angleterre"].every((n) => items.includes(n)) && items.at(-1) === "Ne rien afficher" && !items.includes("International") && !items.includes("Europe") &&
    (await menu.locator('[aria-checked="true"]').textContent()) === "France" && manifestCountries.has("BRA"));
{
  const box = await page.locator(".home-local").boundingBox(), panel = await menu.boundingBox();
  await page.screenshot({ path: path.join(out, "menu-pays.png"), clip: { x: Math.max(0, box.x - 16), y: Math.max(0, box.y - 16), width: Math.max(panel.x + panel.width, box.x + 560) - box.x + 32, height: panel.y + panel.height - box.y + 32 } });
}
await menu.getByRole("menuitemradio", { name: "Brésil" }).click();
await page.locator('.home-local-country[aria-label="Pays : Brésil"]').waitFor({ timeout: 30000 }).catch(() => {});
const afterChoice = (await strip(page))[0];
const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("orion.preferences.v1") || "{}").homeCountry);
await page.reload({ waitUntil: "domcontentloaded" });
await page.locator(".home-next").waitFor({ timeout: 60000 });
await page.locator(".home-local .home-tick").first().waitFor({ timeout: 30000 }).catch(() => {});
const afterReload = (await strip(page))[0];
const cookie = (await context.cookies()).find((c) => c.name === "vega.home.v1");
const cookieCountry = cookie ? JSON.parse(decodeURIComponent(cookie.value)).state?.preferences?.homeCountry : null;
check("M1 a manual choice beats the detected country, after a reload too", { stored: "BRA", cookie: "BRA", button: "Brésil" },
  { afterChoice: afterChoice?.button, stored, cookie: cookieCountry, afterReload: afterReload?.button, sameAsApi: afterReload ? sameStrip(afterReload, bra).ok : false },
  afterChoice?.button === "Brésil" && stored === "BRA" && cookieCountry === "BRA" && afterReload?.button === "Brésil" && sameStrip(afterReload, bra).ok);
await page.locator(".home-local-country").click();
await page.getByRole("menu", { name: "Pays" }).getByRole("menuitemradio", { name: "Ne rien afficher" }).click();
await page.locator(".home-local").waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
const goneNow = await page.locator(".home-local").count();
const reads = [];
page.on("request", (r) => /\/api\/read\/home-local/.test(r.url()) && reads.push(r.url()));
await page.reload({ waitUntil: "domcontentloaded" });
await page.locator(".home-next").waitFor({ timeout: 60000 });
await page.waitForLoadState("networkidle").catch(() => {});
check("N1 « Ne rien afficher »: no strip, after a reload too, no read", { strip: 0, reads: 0 }, { now: goneNow, afterReload: await page.locator(".home-local").count(), reads: reads.length },
  goneNow === 0 && (await page.locator(".home-local").count()) === 0 && reads.length === 0);
await page.close();
await context.close();

// ---------- No country, or one without competition ----------
for (const [iso, code] of [["JP", "JPN"], ["XX", null]]) {
  const data = code ? await localRead(code) : null;
  context = await newContext({ country: iso });
  ({ page } = await open(context, iso));
  await page.waitForTimeout(800);
  const count = await page.locator(".home-local").count();
  check(`U1 ${iso}: no strip`, { strip: 0, apiMatches: data ? 0 : "no read" }, { strip: count, apiMatches: data ? data.matches.length : "no read", competitions: data?.competitions?.length ?? null },
    count === 0 && (!data || (data.matches.length === 0 && data.competitions.length === 0)));
  await page.close();
  await context.close();
}

// ---------- The billboard's fallback (needs the test double's switch) ----------
const switchUrl = `${api}/__overlay/billboard`;
const hasSwitch = await fetch(switchUrl).then((r) => r.ok).catch(() => false);
if (hasSwitch) {
  await fetch(`${switchUrl}?on=0`);
  try {
    const without = (await getJson(homePath)).data;
    context = await newContext({ country: "FR" });
    ({ page } = await open(context, "fallback"));
    const want = expectedHighlights(without.highlights || [], nowMs);
    const got = await nextBlock(page);
    check("A2 without billboard: the block stays, chosen from highlights", want && { lead: [want.lead.fixture.home_team.name, want.lead.fixture.away_team.name], rows: want.rows.map((m) => m.fixture.id).sort() },
      { billboardServed: Object.hasOwn(without, "billboard"), kicker: got.kicker, title: got.title, lead: got.lead, rows: got.rows.map((r) => idOf(r.href)).sort() },
      !Object.hasOwn(without, "billboard") && want && /affiche/i.test(got.kicker) && /prochains/.test(got.title) &&
        got.lead.join("|") === [want.lead.fixture.home_team.name, want.lead.fixture.away_team.name].join("|") &&
        JSON.stringify(got.rows.map((r) => idOf(r.href)).sort()) === JSON.stringify(want.rows.map((m) => m.fixture.id).sort()));
    await page.close();
    await context.close();
  } finally {
    await fetch(`${switchUrl}?on=1`);
  }
} else notRun("A2 without billboard", "the API has no test-double switch (the deployed API always serves the key)");

// ---------- Phone ----------
context = await newContext({ country: "BR", phone: true });
({ page } = await open(context, "phone"));
await page.locator(".home-local .home-tick").first().waitFor({ timeout: 30000 }).catch(() => {});
await settle(page);
const phone = await page.evaluate(() => {
  const s = document.querySelector(".home-local .home-ticker"), head = document.querySelector(".home-local-head")?.getBoundingClientRect();
  return {
    pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    stripScrolls: s ? s.scrollWidth > s.clientWidth : false,
    headInside: head ? head.left >= 0 && head.right <= window.innerWidth : false,
  };
});
check("P1 phone: no sideways page scroll, the strip scrolls in itself", { pageOverflow: 0, stripScrolls: true, headInside: true }, phone, phone.pageOverflow <= 0 && phone.stripScrolls && phone.headInside);
await shot(page, "phone-bresil");
await page.close();
await context.close();

check("X1 no page or console error", [], consoleLog, consoleLog.length === 0);
await browser.close();
const failed = results.filter((r) => r.ok === false);
await writeFile(path.join(out, "evidence.json"), JSON.stringify({
  ranAt: new Date().toISOString(), base, api, now: NOW,
  rerun: `${NOW ? `VEGA_NOW=${NOW} ` : ""}${process.env.VEGA_IMAGES ? `VEGA_IMAGES=${process.env.VEGA_IMAGES} ` : ""}node tests/e2e/home-local.e2e.mjs ${base} ${out} ${api}`,
  inputs, results, console: consoleLog,
  summary: { passed: results.filter((r) => r.ok === true).length, failed: failed.length, notRun: results.filter((r) => r.ok === null).length },
}, null, 2));
console.log(`${results.filter((r) => r.ok === true).length} passed, ${failed.length} failed, ${results.filter((r) => r.ok === null).length} not run — ${out}/evidence.json`);
process.exit(failed.length ? 1 : 0);
