// E2E — the preference effects outside the home (#69, the owner's twelve, numbered as he has them; the home's 1, 2
// and 5 are in tests/e2e/home-country.e2e.mjs). The rule: favourites, then the country, then importance; a URL
// value or a filter the visitor chose beats every preference. The preferences are seeded in the browser stores as
// the site writes them (orion.preferences.v1, statarena.research.v1).
//
// Failure modes and expected outcomes:
//  P4  Competitions, a favourite club and no saved competition: the page opens on the detected country's league →
//      it opens on the favourite club's league (a French club, detected GB: Ligue 1, not the Premier League).
//  P11 Competitions, homeCountry and no favourite: the detected country wins → homeCountry's league (FRA, detected
//      GB: Ligue 1); homeCountry « none » is no country: the detected one (Premier League).
//  P4s A saved competition is overridden by a preference → the saved one opens.
//  P9  Matches: the league filter does not start on the first followed league, or overrides the URL's, or comes
//      back after the visitor cleared it → it starts on it (control and address); a URL league stays; cleared, it
//      stays cleared after a reload in the same visit.
//  P10 Players: the league filter starts on a league with several followed → only with exactly one followed.
//  P12 Power Ranking (clubs): the table does not open at the visitor's country → scrolled to its first club (the
//      row in view; the country taken is the one whose first club stands lowest, so a scroll is needed), nothing
//      else changed; without a country, the page stays at the top.
//  X   No page error, no hydration warning.
// Not covered here (the recorded replay has no answer for them: 404 in its misses.txt; covered by unit / render
// tests): 3 (matches lists), 6 (Ballon d'Or ranking), 7 (search), 8 (nations), 12 clubs directory (clubs read).
//
//   node tests/e2e/preferences.e2e.mjs <base url> <evidence dir> [api origin]
// Same local setup as home-country.e2e.mjs (VEGA_NOW for the clocks, VEGA_IMAGES for the replay's images).
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const [base = "http://127.0.0.1:3000", out = path.join(os.tmpdir(), "vi-preferences-e2e"), api = "https://dngp6kh9jx2bl.cloudfront.net"] = process.argv.slice(2);
const NOW = process.env.VEGA_NOW || null;
await mkdir(out, { recursive: true });
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || "playwright");
const results = [], consoleLog = [], inputs = {};
const check = (id, expected, actual, ok) => {
  results.push({ id, expected, actual, ok: Boolean(ok) });
  console.log(ok ? "PASS" : "FAIL", id, "—", String(JSON.stringify(actual ?? null)).slice(0, 400));
};
const manifest = await (await fetch(api + "/api/dashboard/manifest")).json();
const frenchClub = Object.entries(manifest.clubCountries || {}).find(([, c]) => c === "FRA")?.[0];
inputs.frenchClub = frenchClub;

const browser = await chromium.launch();
async function visit(pathname, { preferences = {}, favourites = [], session = null, visitorCountry = null, saved = null, tag, keep = null } = {}) {
  const context =
    keep ||
    (await browser.newContext({ locale: "fr-FR", timezoneId: "Europe/Paris", colorScheme: "dark", deviceScaleFactor: 2, viewport: { width: 1440, height: 1000 } }));
  if (!keep) {
    if (NOW) await context.clock.setFixedTime(new Date(NOW));
    if (process.env.VEGA_IMAGES)
      await context.route("https://dngp6kh9jx2bl.cloudfront.net/**", async (route) => {
        const u = new URL(route.request().url());
        const r = await fetch(process.env.VEGA_IMAGES + u.pathname + u.search).catch(() => null);
        if (!r) return route.abort();
        return route.fulfill({ status: r.status, contentType: r.headers.get("content-type") || undefined, body: Buffer.from(await r.arrayBuffer()) });
      });
    const research = { version: 1, activeList: "main", lists: [{ id: "main", name: "Ma sélection", entries: favourites }] };
    await context.addInitScript(({ preferences, research, visitorCountry, saved }) => {
      if (sessionStorage.getItem("__seeded")) return;
      sessionStorage.setItem("__seeded", "1");
      localStorage.setItem("orion.preferences.v1", JSON.stringify({ focus: "europe", favoriteLeagueIds: [], onboardingComplete: true, homeCountry: "", ...preferences }));
      localStorage.setItem("statarena.research.v1", JSON.stringify(research));
      if (visitorCountry) localStorage.setItem("statarena.visitor-country.v1", visitorCountry);
      if (saved) localStorage.setItem("statarena.preferred-competition.v1", saved);
    }, { preferences, research, visitorCountry, saved });
  }
  const page = await context.newPage();
  page.on("console", (m) => {
    const text = m.text();
    if ((m.type() === "error" && !/Failed to load resource|vercel-scripts|HTTP 404/.test(text)) || /hydrat/i.test(text)) consoleLog.push(`[${tag}] ${m.type()} ${text}`);
  });
  page.on("pageerror", (e) => consoleLog.push(`[${tag}] pageerror ${e.message}`));
  await page.goto(base + pathname, { waitUntil: "load", timeout: 180000 });
  await page.waitForTimeout(4000);
  return { context, page };
}
const shot = (page, name, selector) =>
  (selector ? page.locator(selector).first().screenshot({ path: path.join(out, `${name}.png`) }) : page.screenshot({ path: path.join(out, `${name}.png`) })).catch(() => {});
// § 80: the competition the page opens on is its title (the row of cards gave way to the bar).
const spotlight = (page) => page.locator(".edition-head--page h1.edition-name").first().textContent({ timeout: 30000 }).then((t) => t.trim()).catch(() => null);

// ---------- P4 / P11: the competition the page opens on ----------
{
  let v = await visit("/competitions", { favourites: [{ kind: "clubs", id: frenchClub, name: "Club" }], visitorCountry: "GB", tag: "P4" });
  let name = await spotlight(v.page);
  check("P4 a French favourite club, detected GB, nothing saved → Ligue 1", "Ligue 1", name, name === "Ligue 1");
  await shot(v.page, "04-competitions-favori", ".edition-head--page");
  await v.context.close();
  v = await visit("/competitions", { visitorCountry: "GB", tag: "P4-none" });
  name = await spotlight(v.page);
  check("P4 without favourite nor country, detected GB → Premier League (as before)", "Premier League", name, name === "Premier League");
  await shot(v.page, "04-competitions-sans-favori", ".edition-head--page");
  await v.context.close();
  v = await visit("/competitions", { preferences: { homeCountry: "FRA" }, visitorCountry: "GB", tag: "P11" });
  name = await spotlight(v.page);
  check("P11 homeCountry FRA, detected GB → Ligue 1", "Ligue 1", name, name === "Ligue 1");
  await shot(v.page, "11-competitions-pays", ".edition-head--page");
  await v.context.close();
  v = await visit("/competitions", { preferences: { homeCountry: "none" }, visitorCountry: "GB", tag: "P11-none" });
  name = await spotlight(v.page);
  check("P11 « Aucun pays », detected GB → Premier League", "Premier League", name, name === "Premier League");
  await v.context.close();
  v = await visit("/competitions", { favourites: [{ kind: "clubs", id: frenchClub, name: "Club" }], preferences: { homeCountry: "FRA" }, saved: "l_0ErfuF", visitorCountry: "GB", tag: "P4s" });
  name = await spotlight(v.page).then(async (x) => x ?? (await v.page.locator("h1, h2").allTextContents()).join(" | "));
  check("P4s a saved competition wins over the preferences", "LaLiga (saved)", name, name === "LaLiga");
  await v.context.close();
}

// ---------- P9: the matches page's league filter ----------
{
  const followed = ["l_4WFCIZ", "l_3FJFUl"];
  let v = await visit("/matchs", { preferences: { favoriteLeagueIds: followed }, tag: "P9" });
  const state = async (page) => ({ control: await page.locator("#league-filter").getAttribute("data-value").then((value) => value === "europe" ? "all" : value).catch(() => null), url: new URL(page.url()).searchParams.get("league") });
  let s = await state(v.page);
  check("P9 the league filter starts on the first followed league", { control: "l_4WFCIZ", url: "l_4WFCIZ" }, s, s.control === "l_4WFCIZ" && s.url === "l_4WFCIZ");
  await shot(v.page, "09-matchs-ligue-suivie", ".filter-panel");
  // Cleared: stays cleared for the visit, after a reload.
  await v.page.locator("#league-filter").click();
  const picker = v.page.locator(".settings-picker-panel");
  await picker.getByRole("button", { name: "Toutes", exact: true }).click();
  await picker.getByRole("button", { name: "Appliquer", exact: true }).click();
  await v.page.waitForTimeout(800);
  await v.page.goto(base + "/matchs", { waitUntil: "load" });
  await v.page.waitForTimeout(4000);
  s = await state(v.page);
  check("P9 cleared, it stays cleared in the same visit", { control: "all", url: null }, s, s.control === "all" && !s.url);
  await v.context.close();
  v = await visit("/matchs?league=l_0ErfuF", { preferences: { favoriteLeagueIds: followed }, tag: "P9-url" });
  s = await state(v.page);
  check("P9 a URL league beats the preference", { control: "l_0ErfuF", url: "l_0ErfuF" }, s, s.control === "l_0ErfuF" && s.url === "l_0ErfuF");
  await v.context.close();
  v = await visit("/matchs", { tag: "P9-none" });
  s = await state(v.page);
  check("P9 no followed league: as before", { control: "all", url: null }, s, s.control === "all" && !s.url);
  await shot(v.page, "09-matchs-sans-ligue-suivie", ".filter-panel");
  await v.context.close();
}

// ---------- P10: the players' league filter ----------
{
  const state = async (page) => page.locator("#league-filter").getAttribute("data-value").then((value) => value === "europe" ? "all" : value).catch(() => null);
  let v = await visit("/joueurs", { preferences: { favoriteLeagueIds: ["l_3FJFUl"] }, tag: "P10" });
  let s = await state(v.page);
  check("P10 one followed league: the players' filter starts on it", "l_3FJFUl", s, s === "l_3FJFUl");
  await shot(v.page, "10-joueurs-ligue-suivie", ".filter-panel");
  await v.context.close();
  v = await visit("/joueurs", { preferences: { favoriteLeagueIds: ["l_3FJFUl", "l_4WFCIZ"] }, tag: "P10-two" });
  s = await state(v.page);
  check("P10 two followed leagues: no preselection", "all", s, s === "all");
  await shot(v.page, "10-joueurs-sans-ligue-unique", ".filter-panel");
  await v.context.close();
}

// ---------- P12: the Power Ranking at the visitor's country ----------
{
  const rows = (await (await fetch(api + "/api/rankings/power?kind=clubs&season=" + encodeURIComponent(manifest.defaultSeason) + "&limit=200")).json()).rows || [];
  // The country whose first club stands lowest in the table: opening at it needs a scroll.
  const firsts = new Map();
  for (const r of rows) if (/^[A-Z]{3}$/.test(r.country || "") && !firsts.has(r.country)) firsts.set(r.country, r);
  const target = [...firsts.values()].sort((a, b) => b.rank - a.rank)[0];
  const code = target?.country;
  inputs.powerTarget = target && [target.teamId, target.name, target.rank, target.country];
  const inView = (page, id) =>
    page.evaluate((id) => {
      const row = document.querySelector(`tr[data-team-id="${id}"]`);
      if (!row) return null;
      const r = row.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: innerHeight, scrollY: Math.round(scrollY) };
    }, id);
  let v = await visit("/power-ranking?tab=clubs", { preferences: { homeCountry: code }, tag: "P12" });
  let s = await inView(v.page, target?.teamId);
  check(`P12 homeCountry ${code}: the table opens at its first club`, { row: inputs.powerTarget, inView: true, scrolled: true }, s,
    s && s.top >= 0 && s.bottom <= s.height && s.scrollY > 0);
  await v.page.screenshot({ path: path.join(out, "12-power-ranking-pays.png") });
  await v.context.close();
  v = await visit("/power-ranking?tab=clubs", { tag: "P12-none" });
  s = await inView(v.page, target?.teamId);
  check("P12 without a country: the page stays at the top", { scrollY: 0 }, s, s && s.scrollY === 0);
  await v.page.screenshot({ path: path.join(out, "12-power-ranking-sans-pays.png") });
  await v.context.close();
}

check("X no page error, no hydration warning", [], consoleLog, consoleLog.length === 0);
await browser.close();
const failed = results.filter((r) => r.ok === false);
await writeFile(path.join(out, "evidence.json"), JSON.stringify({
  ranAt: new Date().toISOString(), base, api, now: NOW,
  rerun: `${NOW ? `VEGA_NOW=${NOW} ` : ""}${process.env.VEGA_IMAGES ? `VEGA_IMAGES=${process.env.VEGA_IMAGES} ` : ""}node tests/e2e/preferences.e2e.mjs ${base} ${out} ${api}`,
  notCovered: { 3: "matches lists: /api/fixtures?…status=upcoming|played 404 in the replay", 6: "Ballon d'Or: /api/rankings/power?kind=players 404", 7: "search: /api/search not recorded", 8: "nations: /api/nations 404", "12 clubs": "/api/read/clubs 404" },
  inputs, results, console: consoleLog,
  summary: { passed: results.filter((r) => r.ok === true).length, failed: failed.length },
}, null, 2));
console.log(`${results.filter((r) => r.ok === true).length} passed, ${failed.length} failed — ${out}/evidence.json`);
process.exit(failed.length ? 1 : 0);
