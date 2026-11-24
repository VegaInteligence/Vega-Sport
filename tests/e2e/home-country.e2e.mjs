// E2E — the visitor's country inside the home's existing cards (VI-48, #69). The « Chez vous » strip was rejected on
// 24 Nov 2026 (« il faut intégrer la localisation dans les cards actuelles, pas rajouter des cards »): the page keeps
// main's blocks in main's places, and the country changes what « À l'affiche » and the results strip show, under the
// priority fixed in code (dashboard/frontend/src/services/home-priority.js, HOME_PRIORITY = "location").
//
// Failure modes and expected outcomes (the API's answers are read by this script, the expected cards recomputed here
// from them, independently of the site's code, then compared with the page):
//  S1 A strip, band or section of its own comes back → no .home-local element, no « Chez vous » on the page, the
//     results strip directly followed by the bento grid (main's order).
//  F1 France (x-vercel-ip-country FR, no choice): « À l'affiche » = the rule of the doc ("location"): the favourites
//     (none here), then up to 2 places to the country's most important matches (the billboard's local ones and
//     home-local FRA's inside `billboardWindow`), at least one to the big matches, the rest to the big matches by
//     served weight; the big card = the most important not finished among the picked; the rows by day, then time.
//  F2 The server's HTML (JavaScript off) already shows the same five, so the browser's first render does not reorder
//     them (no flash) and no hydration warning is logged.
//  B1 Brazil (BR): the same with home-local BRA (its league is outside the default Top 7 focus, which is no choice of
//     the visitor's: its matches enter).
//  N1 No country (XX): « À l'affiche » = the billboard by served weight, as before the country (the card the most
//     important not finished).
//  T1 The results strip, each day: the national teams first, then the visitor's country's results, then the others
//     by editorial weight (matchWeight), 8 a day, the 4 latest days. Checked for FR, BR, GB (the week's results are
//     from the visitor's leagues: with no local result the order is the one of before).
//  R1 « Course au titre » opens on the country's league when it is among the tables (FR → Ligue 1, GB → Premier
//     League), else the default (BR → Ligue 1).
//  M1 The preferences panel's « Votre pays » line: choosing Brésil while detected in France changes « À l'affiche »
//     to Brazil's five without a reload, the card never blank meanwhile; « Aucun pays » gives the no-country five;
//     the menu's last item is « Aucun pays » and the button then says « Pays : Aucun pays »; Escape closes the menu,
//     not the panel.
//  P1 Phone 390 × 844 (Brazil): the same five, no sideways page scroll.
//  A2 The API serves no `billboard` (older publication or backend) → the block stays, chosen from `highlights` as
//     before VI-48 (with the test double's switch only).
//  X1 No page error, no console error, no hydration warning during the run (failed remote loads excluded).
//
// Run against the site and the API it reads (the API origin defaults to the public one):
//   node tests/e2e/home-country.e2e.mjs <base url> <evidence dir> [api origin]
// (VEGA_IMAGES=<replay origin>: a local run serves the public image copies from a recorded replay.) Before the
// backend of VI-48 is deployed, the API is the test double tests/e2e/support/home-v2-overlay.mjs in front of the real
// API (or a recorded replay of it), and the clock is fixed in three places: VEGA_NOW=<ISO> for this script (the
// browser's clock), the double's, and the site's server (NODE_OPTIONS="--require tests/e2e/support/clock.cjs"
// VEGA_NOW=<ISO>). It writes evidence.json (setup, inputs, expected, actual, console) and the screenshots into the
// evidence dir; exit code 1 when a check fails.
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { europeFocusIds } from "../../dashboard/shared/competition-scope.js";
// The existing editorial weight and day of a result (not what this run checks: the country's place among them).
import { matchDay, matchWeight } from "../../dashboard/frontend/src/services/home-insights.js";

const [base = "http://127.0.0.1:3000", out = path.join(os.tmpdir(), "vi-48-country-e2e"), api = "https://dngp6kh9jx2bl.cloudfront.net"] = process.argv.slice(2);
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
const nowMs = NOW ? Date.parse(NOW) : Date.now();

// ---------- What the API serves, read as the site reads it ----------
const manifest = await getJson("/api/dashboard/manifest");
const season = manifest.defaultSeason,
  generation = manifest.publicationVersion;
const homePath = `/api/read/home?${query({ generation, leagues: [...europeFocusIds(manifest)].sort().join(","), season })}`;
const home = (await getJson(homePath)).data;
const localRead = async (country) => (await getJson(`/api/read/home-local?${query({ country, generation, season })}`)).data;
inputs.manifest = { season, generation, homeLocal: manifest.capabilities?.compactReads?.["home-local"] ?? null };
inputs.homePath = homePath;
inputs.billboardWindow = home.billboardWindow ?? null;
inputs.billboard = (home.billboard || []).map((m) => [m.fixture.id, m.day, m.weight, m.fixture.status, m.fixture.league?.id]);

// ---------- The rule, written again here from the doc (no import of the site's choice) ----------
const LOCAL_PLACES = 2, BIG_KEPT = 1, PLACES = 5;
const heaviest = (a, b) => (b.weight ?? 0) - (a.weight ?? 0) || a.time - b.time || a.fixture.id.localeCompare(b.fixture.id);
const byDay = (a, b) => a.day.localeCompare(b.day) || a.time - b.time || a.fixture.id.localeCompare(b.fixture.id);
const done = (m) => m.fixture.status === "finished";
const countryLeagues = (code, local) =>
  new Set([...(manifest.competitions || []), ...(home.competitions || []), ...(local?.competitions || [])].filter((c) => c?.country === code).map((c) => c.id));
/** « À l'affiche » for a visitor without favourites nor chosen leagues, "location". */
function expectedFive(code, local) {
  const billboard = home.billboard || [];
  let locals = [], bigs = [...billboard];
  if (code && local) {
    const leagues = countryLeagues(code, local), w = home.billboardWindow;
    const seen = new Set();
    for (const m of [...billboard.filter((x) => leagues.has(x.fixture.league?.id)),
      ...(w ? (local.matches || []).filter((x) => x.day >= w.start && x.day <= w.end && leagues.has(x.fixture.league?.id)) : [])])
      if (!seen.has(m.fixture.id)) seen.add(m.fixture.id), locals.push(m);
    bigs = billboard.filter((x) => !seen.has(x.fixture.id));
  }
  locals.sort(heaviest);
  bigs.sort(heaviest);
  let nLocal = Math.min(LOCAL_PLACES, locals.length, bigs.length ? PLACES - BIG_KEPT : PLACES);
  const nBig = Math.min(bigs.length, PLACES - nLocal);
  nLocal = Math.min(locals.length, PLACES - nBig);
  let picked = [...locals.slice(0, nLocal), ...bigs.slice(0, nBig)];
  let lead = [...picked].sort(heaviest).find((m) => !done(m));
  if (!lead) {
    lead = [...locals, ...bigs].sort(heaviest).find((m) => !done(m) && !picked.includes(m));
    if (!lead) return null;
    const bigPicks = picked.filter((m) => !locals.includes(m));
    const outPick = [...(bigPicks.length ? bigPicks : picked)].sort(heaviest).at(-1);
    picked = [...picked.filter((m) => m !== outPick), lead];
  }
  return { lead: lead.fixture.id, rows: picked.filter((m) => m !== lead).sort(byDay).map((m) => m.fixture.id), local: locals.slice(0, nLocal).map((m) => m.fixture.id) };
}
/** The results strip: nations first (API order), then the country's results, then by matchWeight; 8 a day, 4 days. */
function expectedTicker(code) {
  const ranks = new Map(home.ranks || []), leagues = code ? countryLeagues(code, null) : new Set();
  const days = new Map();
  const day = (k) => days.get(k) || days.set(k, { day: k, nations: [], clubs: [] }).get(k);
  for (const m of home.internationals || []) day(m.date).nations.push(m);
  for (const m of home.results || []) day(matchDay(m)).clubs.push(m);
  return [...days.values()].sort((a, b) => (a.day < b.day ? 1 : -1)).slice(0, 4).map((d) => {
    const clubs = [...d.clubs].sort((a, b) => Number(leagues.has(b.leagueId)) - Number(leagues.has(a.leagueId)) || matchWeight(b, ranks) - matchWeight(a, ranks));
    return [...d.nations.map(() => "nation"), ...clubs.map((m) => m.id)].slice(0, 8);
  });
}

const idOf = (href) => (href ? new URL(href, base).searchParams.get("id") : null);
const browser = await chromium.launch();
async function newContext({ country, phone = false, js = true } = {}) {
  const context = await browser.newContext({
    locale: "fr-FR", timezoneId: "Europe/Paris", colorScheme: "dark", deviceScaleFactor: 2, javaScriptEnabled: js,
    viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
    isMobile: phone, hasTouch: phone,
    extraHTTPHeaders: country ? { "x-vercel-ip-country": country } : {},
  });
  if (NOW && js) await context.clock.setFixedTime(new Date(NOW));
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
  page.on("console", (m) => {
    const text = m.text();
    if ((m.type() === "error" && !/Failed to load resource|vercel-scripts/.test(text)) || /hydrat/i.test(text)) consoleLog.push(`[${tag}] ${m.type()} ${text}`);
  });
  page.on("pageerror", (e) => consoleLog.push(`[${tag}] pageerror ${e.message}`));
  await page.goto(base + "/", { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.locator(".home-next").waitFor({ timeout: 60000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  return page;
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
const shot = (page, name) => page.screenshot({ path: path.join(out, `${name}.png`), fullPage: true });
const card = (page) =>
  page.locator(".home-next").evaluate((c) => ({
    kicker: c.querySelector(".home-kicker")?.textContent,
    lead: c.querySelector(".home-next-main")?.getAttribute("href"),
    rows: [...c.querySelectorAll(".home-next-list a")].map((a) => a.getAttribute("href")),
  })).then((c) => ({ kicker: c.kicker, lead: idOf(c.lead), rows: c.rows.map(idOf) }));
const sameCard = (got, want) => Boolean(want) && got.lead === want.lead && JSON.stringify(got.rows) === JSON.stringify(want.rows);
const ticker = (page) =>
  page.evaluate(() => {
    const nav = document.querySelector(".home-ticker");
    if (!nav) return null;
    const days = [];
    for (const el of nav.children) {
      if (el.classList.contains("home-ticker-day")) days.push([]);
      else if (el.classList.contains("home-tick")) {
        const a = el.querySelector("a.home-tick-top");
        days.at(-1)?.push(a ? new URL(a.getAttribute("href"), location.href).searchParams.get("id") : "nation");
      }
    }
    return days;
  });
const structure = (page) =>
  page.evaluate(() => ({
    strip: document.querySelectorAll(".home-local").length,
    chezVous: /chez vous/i.test(document.querySelector("main")?.innerText || document.body.innerText),
    afterTicker: document.querySelector(".home-ticker")?.nextElementSibling?.className || null,
  }));
const titleTab = (page) =>
  page.locator('.home-race .home-tabs button[aria-pressed="true"]').evaluate((b) => b.childNodes[b.childNodes.length - 1]?.textContent?.trim()).catch(() => null);

// ---------- One visitor per country: the card, the server's HTML, the ticker, the title race ----------
const locals = { FRA: await localRead("FRA"), BRA: await localRead("BRA") };
for (const [code, data] of Object.entries(locals)) inputs[code] = { window: data.window, competitions: data.competitions.map((c) => c.id), matches: data.matches.map((m) => [m.fixture.id, m.day, m.weight, m.fixture.status]) };
const visitors = [
  { iso: "FR", code: "FRA", tab: "Ligue 1", shots: ["bureau-france", "a-l-affiche-france"] },
  { iso: "BR", code: "BRA", tab: "Ligue 1", shots: ["bureau-bresil", "a-l-affiche-bresil"] },
  { iso: "XX", code: null, tab: "Ligue 1", shots: ["bureau-sans-pays"] },
  { iso: "GB", code: "ENG", tab: "Premier League", shots: [] },
];
const expected = {};
for (const v of visitors) {
  const local = v.code ? locals[v.code] || (await localRead(v.code)) : null;
  const want = expectedFive(v.code, local);
  expected[v.iso] = { five: want, ticker: expectedTicker(v.code) };
  // F2: the server's HTML, JavaScript off.
  let context = await newContext({ country: v.iso, js: false });
  let page = await context.newPage();
  await page.goto(base + "/", { waitUntil: "domcontentloaded", timeout: 120000 });
  const server = await page.locator(".home-next").count() ? await card(page) : null;
  await context.close();
  context = await newContext({ country: v.iso });
  page = await open(context, v.iso);
  await settle(page);
  const got = await card(page);
  const s = await structure(page);
  check(`S1 ${v.iso}: no strip, main's blocks in main's order`, { strip: 0, chezVous: false, afterTicker: "home-bento" }, s, s.strip === 0 && !s.chezVous && s.afterTicker === "home-bento");
  if (v.code === "FRA" || v.code === "BRA" || !v.code)
    check(`${v.code ? (v.code === "FRA" ? "F1" : "B1") : "N1"} ${v.iso}: « À l'affiche » = the rule recomputed from the API`, want, got, /affiche/i.test(got.kicker || "") && sameCard(got, want));
  check(`F2 ${v.iso}: the server's HTML shows the same five`, want, server, server && sameCard(server, want));
  const tick = await ticker(page);
  check(`T1 ${v.iso}: the results strip's order`, expected[v.iso].ticker, tick, JSON.stringify(tick) === JSON.stringify(expected[v.iso].ticker));
  const tab = await titleTab(page);
  check(`R1 ${v.iso}: the title race opens on ${v.tab}`, v.tab, tab, tab === v.tab);
  if (v.shots[0]) await shot(page, v.shots[0]);
  if (v.shots[1]) await page.locator(".home-next").screenshot({ path: path.join(out, `${v.shots[1]}.png`) });
  await page.close();
  await context.close();
}
inputs.expected = expected;
// The rule must have something to show: France and Brazil each get local places here.
check("F1/B1 the data exercise the rule (local places taken for FR and BR)", { FRA: ">0", BRA: ">0" },
  { FRA: expected.FR.five?.local, BRA: expected.BR.five?.local }, expected.FR.five?.local.length > 0 && expected.BR.five?.local.length > 0);

// ---------- M1: the preferences panel's country line ----------
await (async () => {
  const context = await newContext({ country: "FR" });
  const page = await open(context, "menu");
  await page.evaluate(() => (window.__noReload = true));
  await page.locator("#home-competition-filter").click();
  const dialog = page.locator("dialog[open]");
  await dialog.waitFor({ timeout: 10000 });
  const line = dialog.locator(".home-preferences-country"), control = line.locator("#home-country-filter");
  const before = { heading: await line.locator("h3").textContent(), label: await control.getAttribute("aria-label") };
  await page.waitForTimeout(300);
  await dialog.screenshot({ path: path.join(out, "preferences-pays.png") });
  await control.click();
  const menu = dialog.getByRole("menu", { name: "Pays" });
  await menu.waitFor({ timeout: 10000 });
  const items = await menu.getByRole("menuitemradio").allTextContents();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  const afterEscape = { menu: await menu.count(), dialog: await page.locator("dialog[open]").count() };
  // Brésil: the card follows without a reload, never blank meanwhile.
  await control.click();
  await page.evaluate(() => {
    window.__blank = 0;
    window.__watch = setInterval(() => { if (!document.querySelector(".home-next .home-next-main")) window.__blank++; }, 25);
  });
  await menu.getByRole("menuitemradio", { name: "Brésil", exact: true }).click();
  const wantBr = expected.BR.five;
  await page.waitForFunction((lead) => new URL(document.querySelector(".home-next-main")?.getAttribute("href") || "/", location.href).searchParams.get("id") === lead, wantBr?.lead, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(800);
  const brazil = await card(page);
  const blank = await page.evaluate(() => (clearInterval(window.__watch), window.__blank));
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("orion.preferences.v1") || "{}").homeCountry);
  check("M1 Brésil chosen in the panel: Brazil's five, no reload, never blank", { five: wantBr, blank: 0, stored: "BRA", noReload: true },
    { five: brazil, blank, stored, noReload: await page.evaluate(() => window.__noReload === true), label: await control.getAttribute("aria-label") },
    sameCard(brazil, wantBr) && blank === 0 && stored === "BRA" && (await page.evaluate(() => window.__noReload === true)) && (await control.getAttribute("aria-label")) === "Pays : Brésil");
  // Aucun pays: the five of no country.
  await control.click();
  await menu.getByRole("menuitemradio", { name: "Aucun pays" }).click();
  const wantNone = expected.XX.five;
  await page.waitForTimeout(1200);
  const none = await card(page);
  check("M1 « Aucun pays »: the no-country five, the button says so",
    { heading: "Votre pays", before: "Pays : France", last: "Aucun pays", afterEscape: { menu: 0, dialog: 1 }, five: wantNone, label: "Pays : Aucun pays" },
    { ...before, last: items.at(-1), count: items.length, afterEscape, five: none, label: await control.getAttribute("aria-label"), stored: await page.evaluate(() => JSON.parse(localStorage.getItem("orion.preferences.v1") || "{}").homeCountry) },
    before.heading === "Votre pays" && before.label === "Pays : France" && items.at(-1) === "Aucun pays" && !items.includes("Ne rien afficher") &&
      afterEscape.menu === 0 && afterEscape.dialog === 1 && sameCard(none, wantNone) && (await control.getAttribute("aria-label")) === "Pays : Aucun pays" &&
      (await page.evaluate(() => window.__noReload === true)));
  await page.close();
  await context.close();
})().catch((error) => check("M1 the preferences panel's country line", "the panel's line", String(error.message).split("\n")[0], false));

// ---------- P1: phone ----------
{
  const context = await newContext({ country: "BR", phone: true });
  const page = await open(context, "phone");
  await settle(page);
  const got = await card(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const s = await structure(page);
  check("P1 phone 390, Brazil: the same five, no sideways scroll, no strip", { five: expected.BR.five, overflow: 0, strip: 0 }, { five: got, overflow, ...s },
    sameCard(got, expected.BR.five) && overflow <= 0 && s.strip === 0 && s.afterTicker === "home-bento");
  await shot(page, "telephone-bresil");
  await page.close();
  await context.close();
}

// ---------- A2: the billboard's fallback (needs the test double's switch) ----------
const switchUrl = `${api}/__overlay/billboard`;
if (await fetch(switchUrl).then((r) => r.ok).catch(() => false)) {
  await fetch(`${switchUrl}?on=0`);
  try {
    const without = (await getJson(homePath)).data;
    const context = await newContext({ country: "FR" });
    const page = await open(context, "fallback");
    const big = (without.highlights || []).filter((m) => m.time >= nowMs).sort(heaviest).slice(0, 5);
    const want = big.length ? { lead: big[0].fixture.id, rows: big.slice(1).map((m) => m.fixture.id).sort() } : null;
    const got = await card(page);
    check("A2 without billboard: the block stays, chosen from highlights", want, { billboardServed: Object.hasOwn(without, "billboard"), ...got, rows: [...got.rows].sort() },
      !Object.hasOwn(without, "billboard") && want && got.lead === want.lead && JSON.stringify([...got.rows].sort()) === JSON.stringify(want.rows));
    await page.close();
    await context.close();
  } finally {
    await fetch(`${switchUrl}?on=1`);
  }
} else notRun("A2 without billboard", "the API has no test-double switch (the deployed API always serves the key)");
notRun("Scope chosen by the visitor (a league filter without the country's league)", "covered by tests/home-priority.test.mjs P4; the recorded replay has no home read for such a scope");

check("X1 no page error, console error or hydration warning", [], consoleLog, consoleLog.length === 0);
await browser.close();
const failed = results.filter((r) => r.ok === false);
await writeFile(path.join(out, "evidence.json"), JSON.stringify({
  ranAt: new Date().toISOString(), base, api, now: NOW,
  rerun: `${NOW ? `VEGA_NOW=${NOW} ` : ""}${process.env.VEGA_IMAGES ? `VEGA_IMAGES=${process.env.VEGA_IMAGES} ` : ""}node tests/e2e/home-country.e2e.mjs ${base} ${out} ${api}`,
  inputs, results, console: consoleLog,
  summary: { passed: results.filter((r) => r.ok === true).length, failed: failed.length, notRun: results.filter((r) => r.ok === null).length },
}, null, 2));
console.log(`${results.filter((r) => r.ok === true).length} passed, ${failed.length} failed, ${results.filter((r) => r.ok === null).length} not run — ${out}/evidence.json`);
process.exit(failed.length ? 1 : 0);
