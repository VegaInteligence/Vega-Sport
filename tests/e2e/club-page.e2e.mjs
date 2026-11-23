// E2E — the club page: one inset for its cards and a width cap, the identity before the figures,
// fewer clicks (« Tous les matchs » from the overview, the season in the club sheet). Written before
// the implementation, against the real page (Paris Saint-Germain) and the nation page that shares its
// cards (France), on a desktop (1440×900), a wide screen (1920×1080) and a phone (iPhone 14).
//
// Failure modes and expected outcomes:
//  I1 (inset) On each of the eight tabs, every card's content starts 16 px inside the card's own edge,
//     like the key-figure cells and the identity column. Today the cards are flush with their border.
//  I2 (inset) The overview's last block (« Le club en bref ») follows the same 16 px.
//  I3 (nation) The nation page's cards, the same component, follow the same 16 px.
//  W1 (width) At 1920 px the club page is at most 1600 px wide, centred (equal margins ± 2 px).
//  W2 (width) The same for the nation page, which shares the club page's columns.
//  P1 (phone) No sideways scroll on the overview and the matches tab; a card's text starts no
//     further than 18 px from the screen's edge (the page gutter, no inset added on top of it).
//  L1 (progressive) While the league's reads (the club's ranking) are held, the page is revealed:
//     the club's name in the h1, its crest, the back link, and « Derniers matchs » with its rows.
//  L2 (no provisional rank) While they are held, the identity column prints no rank (« 1er », « 5e »),
//     no index, and the key figures are not shown.
//  L3 (no jump) When the reads are released the figures appear and the h1 has not moved (± 2 px).
//  L4 (parallel) The European comparison is read beside the league's reads, as before: it is
//     requested while they are held (the figures wait for it, so it must not start late).
//  R1 (figures once) With every answer delayed and the European reads slower still, the key
//     figures appear once, already against the default reference (Europe): the KPI row's text
//     and the profile's reference line never change after they first appear (no « 1er / 18 »
//     turning into « 5e / 31 »).
//  R2 (no shift) From the moment the tabs appear to the end of the load, they do not move (± 1 px):
//     no status line is inserted above them while the reference is read.
//  F1 (clicks) The overview's « Derniers matchs » card has a « Tous les matchs » action that opens
//     « Matchs et tendances » (tab selected, clubView=matches in the address).
//  S1 (season) The identity column has a « Saison » selector, set to the page's season, listing the
//     published seasons.
//  S2 (season) Choosing another season keeps the visitor on the club: the address keeps the club's
//     id and names the season, the page names the club, and the clubs directory does not appear.
//  X1 No page error in the console.
//
// Run (local front against the API it proxies, or the public site):
//   node tests/e2e/club-page.e2e.mjs <base url> <evidence dir> [api origin]
// e.g. node tests/e2e/club-page.e2e.mjs http://127.0.0.1:3011 /tmp/club-e2e http://127.0.0.1:8765
// Images asked from the CDN are served from the API origin given. It writes evidence.json (setup,
// inputs, expected, actual, console) and screenshots into the evidence dir; exit code 1 on a failure.
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const [base = "http://127.0.0.1:3000", out = path.join(os.tmpdir(), "club-page-e2e"), api = "http://127.0.0.1:8765"] = process.argv.slice(2);
const club = { id: "t_41iFW3", name: "Paris Saint-Germain" }, nation = "t_2ysHaw", season = "2026/2027", other = "2025/2026";
const CDN = "https://dngp6kh9jx2bl.cloudfront.net/**";
await mkdir(out, { recursive: true });
const require = createRequire(import.meta.url);
const { chromium, devices } = require(process.env.PLAYWRIGHT_CORE || "playwright");

const results = [], consoleLog = [];
const check = (id, expected, actual, ok) => {
  results.push({ id, expected, actual, ok: Boolean(ok) });
  console.log(ok ? "PASS" : "FAIL", id, "—", JSON.stringify(actual));
};
const browser = await chromium.launch();
async function context(options, hold = null) {
  const ctx = await browser.newContext({ locale: "fr-FR", ...options });
  await ctx.route(CDN, async (route) => {
    const u = new URL(route.request().url());
    try {
      const r = await fetch(api + u.pathname + u.search);
      await route.fulfill({ status: r.status, body: Buffer.from(await r.arrayBuffer()), headers: { "content-type": r.headers.get("content-type") || "application/octet-stream", "access-control-allow-origin": "*" } });
    } catch {
      await route.abort().catch(() => {});
    }
  });
  await ctx.route(/va\.vercel-scripts\.com/, (route) => route.abort());
  if (hold) await ctx.route(`${api}/**`, async (route) => {
    const u = new URL(route.request().url());
    hold.requests.push({ t: Date.now(), path: u.pathname, held: hold.match(u) && !hold.released });
    if (hold.match(u) && !hold.released) await hold.gate;
    await route.continue().catch(() => {});
  });
  return ctx;
}
const clubUrl = (query = {}) => `${base}/clubs/?${new URLSearchParams({ season, id: club.id, ...query })}`;
async function open(ctx, url, tag) {
  const page = await ctx.newPage();
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && consoleLog.push(`[${tag}] ${m.text()}`));
  page.on("pageerror", (e) => consoleLog.push(`[${tag}] pageerror ${e.message}`));
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
  return page;
}
const settled = (page) => page.waitForFunction(() => document.querySelector("#main")?.getAttribute("data-page-ready") === "true" && !document.querySelector("#main [data-page-loading]"), null, { timeout: 60000 }).catch(() => {});
const shot = (page, name, fullPage = true) => page.screenshot({ path: path.join(out, `${name}.png`), fullPage });
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
// Every card under `root`: a bordered section whose first child holds its title (h2/h3), or a
// similar-club article. The inset is where its title (else its first child) starts, from the card's left edge.
const insets = (page, root) =>
  page.evaluate((root) => {
    const scope = document.querySelector(root);
    if (!scope) return [];
    const cards = [...scope.querySelectorAll("section, article")].filter((el) => el.tagName === "ARTICLE" || el.firstElementChild?.querySelector(":scope h2, :scope h3") || /^H[23]$/.test(el.firstElementChild?.tagName || ""));
    // A card draws a line (its top border); a tab's own heading block (« Stats avancées ») does not.
    return cards
      .filter((el) => el.getBoundingClientRect().width > 0 && parseFloat(getComputedStyle(el).borderTopWidth) > 0)
      .map((el) => {
        const title = el.querySelector("h2, h3, strong"), start = el.querySelector("h2, h3") || el.firstElementChild;
        return { title: (title?.textContent || "").trim().slice(0, 40), inset: Math.round(start.getBoundingClientRect().left - el.getBoundingClientRect().left) };
      });
  }, root);
const allSixteen = (list) => list.length > 0 && list.every((c) => Math.abs(c.inset - 16) <= 1);
async function scrollThrough(page) {
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 500) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
    }
  });
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.scrollTo(0, 0));
}
const TABS = ["Vue d’ensemble", "Statistiques", "Stats avancées", "Style de jeu", "Matchs et tendances", "Effectif", "Comparaison", "Clubs similaires"];
const tab = (page, name) => page.getByRole("tab", { name, exact: true }).first();
async function openTab(page, name) {
  await tab(page, name).click();
  await page.waitForTimeout(400);
  await page.waitForFunction(() => !document.querySelector("#club-profile-panel [aria-busy='true'], #club-profile-panel [role=status] .skeleton-line"), null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(800);
}

// ---------------------------------------------------------------- desktop: inset and clicks
const desktop = await context({ viewport: { width: 1440, height: 900 } });
let page = await open(desktop, clubUrl(), "desktop");
await page.getByRole("heading", { level: 1, name: club.name }).waitFor({ timeout: 60000 });
await settled(page);
await tab(page, "Statistiques").waitFor({ timeout: 60000 });
const reference = await page.evaluate(() => {
  const cell = document.querySelector("#club-profile-panel [class*=kpis] > div");
  const kpi = cell ? Math.round(cell.querySelector("span").getBoundingClientRect().left - cell.getBoundingClientRect().left) : null;
  const rail = document.querySelector('aside[aria-label="Identité du club"]');
  const section = rail?.querySelectorAll(":scope > div")[1];
  const railInset = section ? Math.round(section.firstElementChild.getBoundingClientRect().left - section.getBoundingClientRect().left) : null;
  return { kpi, rail: railInset };
});
const perTab = {};
for (const name of TABS) {
  if (name !== TABS[0]) await openTab(page, name);
  else await scrollThrough(page);
  perTab[name] = await insets(page, "#club-profile-panel");
  await shot(page, `desktop-tab-${TABS.indexOf(name)}`);
  if (name === TABS[0]) {
    const info = await page.evaluate(() => [...document.querySelectorAll("#club-profile-panel .club-overview-info .card")].map((el) => {
      const head = el.querySelector(".card-header") || el.firstElementChild;
      return { title: el.querySelector("h2")?.textContent.trim(), inset: Math.round(head.querySelector("h2").getBoundingClientRect().left - el.getBoundingClientRect().left) };
    }));
    check("I2 « Le club en bref » at 16 px", "every card 16 px", info, allSixteen(info));
  }
}
const offenders = Object.fromEntries(Object.entries(perTab).map(([name, list]) => [name, list.filter((c) => Math.abs(c.inset - 16) > 1)]).filter(([, list]) => list.length));
check("I1 every card of the eight tabs at 16 px, like the figures and the column", { kpi: 16, rail: 16, cards: 16 }, { reference, cards: Object.values(perTab).flat().length, offenders },
  reference.kpi === 16 && reference.rail === 16 && Object.values(perTab).every((list) => list.length) && !Object.keys(offenders).length);

// F1: back to the overview, then its « Tous les matchs ».
await openTab(page, "Vue d’ensemble");
const lastCard = page.locator("#club-profile-panel section").filter({ has: page.getByRole("heading", { name: /^Derniers matchs/ }) }).first();
const action = lastCard.getByRole("button", { name: /Tous les matchs/ }).or(lastCard.getByRole("link", { name: /Tous les matchs/ }));
const actions = await action.count();
if (actions) {
  await action.first().click();
  await page.waitForTimeout(800);
}
const matchesSelected = await tab(page, "Matchs et tendances").getAttribute("aria-selected");
const allMatches = await page.getByRole("heading", { name: /^Tous les matchs/ }).count();
check("F1 « Tous les matchs » from the overview opens the matches tab", { action: 1, selected: "true", clubView: "matches", heading: true },
  { action: actions, selected: matchesSelected, clubView: new URL(page.url()).searchParams.get("clubView"), heading: allMatches > 0 },
  actions === 1 && matchesSelected === "true" && new URL(page.url()).searchParams.get("clubView") === "matches" && allMatches > 0);

// S1, S2: the season in the club sheet.
await page.goto(clubUrl(), { waitUntil: "domcontentloaded" });
await page.getByRole("heading", { level: 1, name: club.name }).waitFor({ timeout: 60000 });
await settled(page);
const rail = page.locator('aside[aria-label="Identité du club"]');
const select = rail.getByRole("combobox", { name: "Saison" });
const selects = await select.count();
const seasonState = selects ? await select.first().evaluate((el) => ({ value: el.value, options: [...el.options].map((o) => o.value) })) : null;
check("S1 a « Saison » selector in the club sheet", { value: season, includes: other }, seasonState, selects === 1 && seasonState.value === season && seasonState.options.includes(other));
await shot(page, "desktop-overview", false);
if (selects) {
  await select.first().selectOption(other);
  await page.waitForTimeout(500);
  await page.waitForFunction(() => document.querySelector("#main")?.getAttribute("data-page-ready") === "true", null, { timeout: 60000 }).catch(() => {});
  await page.waitForFunction((name) => document.querySelector("#main")?.textContent.includes(name), club.name, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(1500);
}
const after = new URL(page.url()).searchParams;
const kept = { id: after.get("id"), season: after.get("season"), named: await page.evaluate((name) => document.querySelector("#main")?.textContent.includes(name), club.name), directory: await page.getByRole("searchbox", { name: "Rechercher un club" }).count() };
check("S2 another season keeps the visitor on the club", { id: club.id, season: other, named: true, directory: 0 }, kept, selects === 1 && kept.id === club.id && kept.season === other && kept.named && kept.directory === 0);
await shot(page, "desktop-other-season", false);
await page.close();

// I3: the nation page.
page = await open(desktop, `${base}/nations/?${new URLSearchParams({ season, id: nation })}`, "desktop");
await page.locator("#main h2").first().waitFor({ timeout: 60000 });
await settled(page);
await scrollThrough(page);
const nationCards = await insets(page, "#main [role=tabpanel], #main");
const nationMain = nationCards.filter((c) => c.title);
check("I3 the nation page's cards at 16 px", "every card 16 px", nationMain, allSixteen(nationMain));
await shot(page, "desktop-nation");
await page.close();
await desktop.close();

// ---------------------------------------------------------------- 1920: width cap
const wide = await context({ viewport: { width: 1920, height: 1080 } });
const capOf = (page) => page.evaluate(() => {
  const rail = document.querySelector("main aside");
  const layout = rail?.parentElement;
  if (!layout) return null;
  const r = layout.getBoundingClientRect(), width = document.documentElement.clientWidth;
  return { width: Math.round(r.width), left: Math.round(r.left), right: Math.round(width - r.right) };
});
page = await open(wide, clubUrl(), "wide");
await page.getByRole("heading", { level: 1, name: club.name }).waitFor({ timeout: 60000 });
await settled(page);
const clubCap = await capOf(page);
check("W1 club page ≤ 1600 px, centred, at 1920", { width: "≤ 1600", margins: "equal" }, clubCap, clubCap && clubCap.width <= 1600 && Math.abs(clubCap.left - clubCap.right) <= 2);
await shot(page, "wide-club", false);
await page.close();
page = await open(wide, `${base}/nations/?${new URLSearchParams({ season, id: nation })}`, "wide");
await page.locator("main aside").first().waitFor({ timeout: 60000 });
await settled(page);
const nationCap = await capOf(page);
check("W2 nation page ≤ 1600 px, centred, at 1920", { width: "≤ 1600", margins: "equal" }, nationCap, nationCap && nationCap.width <= 1600 && Math.abs(nationCap.left - nationCap.right) <= 2);
await shot(page, "wide-nation", false);
await page.close();
await wide.close();

// ---------------------------------------------------------------- phone
const phone = await context({ ...devices["iPhone 14"] });
page = await open(phone, clubUrl(), "phone");
await page.getByRole("heading", { level: 1, name: club.name }).waitFor({ timeout: 60000 });
await settled(page);
await scrollThrough(page);
const phoneEdges = async () => page.evaluate(() => [...document.querySelectorAll("#club-profile-panel section h3")].map((h) => Math.round(h.getBoundingClientRect().left)).filter((x) => x > 0));
const overviewOverflow = await overflow(page), overviewEdges = await phoneEdges();
await shot(page, "phone-overview");
await openTab(page, "Matchs et tendances");
const matchesOverflow = await overflow(page), matchesEdges = await phoneEdges();
await shot(page, "phone-matches");
const edges = [...overviewEdges, ...matchesEdges];
check("P1 phone: no sideways scroll, cards at the page gutter", { overflow: 0, maxEdge: "≤ 18" }, { overviewOverflow, matchesOverflow, maxEdge: Math.max(...edges), cards: edges.length },
  overviewOverflow <= 0 && matchesOverflow <= 0 && edges.length > 0 && Math.max(...edges) <= 18);
await page.close();
await phone.close();

// ---------------------------------------------------------------- progressive loading
let release;
const hold = {
  requests: [],
  released: false,
  gate: new Promise((resolve) => (release = resolve)),
  // The club's ranking: the league's matches and its clubs.
  match: (u) => u.pathname === "/api/read/league" || u.pathname === "/api/read/clubs",
};
const held = await context({ viewport: { width: 1440, height: 900 } }, hold);
page = await open(held, clubUrl(), "held");
const t0 = Date.now();
await page.waitForFunction(() => document.querySelector("#main")?.getAttribute("data-page-ready") === "true", null, { timeout: 30000 }).catch(() => {});
// Before the reveal's 10 s deadline: revealed by the identity, not by the timeout.
const readyAt = Date.now() - t0;
await page.waitForTimeout(800);
const early = await page.evaluate(() => {
  const main = document.querySelector("#main");
  const h1 = main?.querySelector("h1");
  const rail = main?.querySelector("aside") || main?.querySelector("[class*=club-skeleton-aside]");
  const heading = [...(main?.querySelectorAll("h3") || [])].find((h) => h.textContent.trim().startsWith("Derniers matchs"));
  const card = heading?.closest("section");
  return {
    ready: main?.getAttribute("data-page-ready") === "true",
    h1: h1?.textContent.trim() || "",
    h1Box: h1 ? (({ left, top }) => ({ left: Math.round(left), top: Math.round(top + window.scrollY) }))(h1.getBoundingClientRect()) : null,
    crest: Boolean(rail?.querySelector("[data-media-state], img")),
    back: [...(main?.querySelectorAll("a") || [])].some((a) => a.textContent.includes("Tous les clubs")),
    lastMatches: card ? (card.textContent.match(/\d+–\d+/g) || []).length : 0,
    railText: rail?.textContent || "",
    figures: main?.textContent.includes("Points / match") || false,
  };
});
const europeWhileHeld = hold.requests.filter((r) => r.path.startsWith("/api/clubs/europe")).length;
await shot(page, "held-identity", false);
check("L1 identity and last matches revealed while the ranking loads", { ready: true, readyAt: "< 8000 ms", h1: club.name, crest: true, back: true, lastMatches: "≥ 1" },
  { ready: early.ready, readyAt, h1: early.h1, crest: early.crest, back: early.back, lastMatches: early.lastMatches },
  early.ready && readyAt < 8000 && early.h1 === club.name && early.crest && early.back && early.lastMatches >= 1);
const ranks = early.railText.match(/\b\d+(er|e)\b/g) || [];
check("L2 no provisional rank, index or figure", { ranks: [], figures: false }, { ranks, figures: early.figures }, early.ready && !ranks.length && !early.figures);
check("L4 the European comparison is read beside the league's reads", "≥ 1 request while they are held", europeWhileHeld, early.ready && europeWhileHeld >= 1);
hold.released = true;
release();
await page.getByText("Points / match").first().waitFor({ timeout: 60000 }).catch(() => {});
await page.waitForTimeout(500);
const late = await page.evaluate(() => {
  const h1 = document.querySelector("#main h1");
  return { figures: document.querySelector("#main")?.textContent.includes("Points / match"), h1Box: h1 ? (({ left, top }) => ({ left: Math.round(left), top: Math.round(top + window.scrollY) }))(h1.getBoundingClientRect()) : null };
});
await shot(page, "held-released", false);
check("L3 the figures arrive without moving the identity", { figures: true, h1: early.h1Box }, late,
  early.h1Box && late.figures && late.h1Box && Math.abs(late.h1Box.left - early.h1Box.left) <= 2 && Math.abs(late.h1Box.top - early.h1Box.top) <= 2);
await page.close();
await held.close();

// ---------------------------------------------------------------- figures once, tabs still
// Every API answer 400 ms late, the European reads 1.5 s more: the reference is the last to come.
const slow = await browser.newContext({ locale: "fr-FR", viewport: { width: 1440, height: 900 } });
await slow.route(CDN, (route) => route.abort());
await slow.route(/va\.vercel-scripts\.com/, (route) => route.abort());
await slow.route(`${api}/**`, async (route) => {
  const u = new URL(route.request().url());
  await new Promise((r) => setTimeout(r, 400 + (u.pathname.startsWith("/api/clubs/europe") ? 1500 : 0)));
  await route.continue().catch(() => {});
});
// Sampled every 30 ms from the first script: each distinct KPI row and reference line, and the
// tabs' position each time they are on screen.
await slow.addInitScript(() => {
  const log = (window.__clubLoad = { kpis: [], reference: [], tabs: [] });
  const push = (list, value) => value && list[list.length - 1] !== value && list.push(value);
  setInterval(() => {
    const panel = document.querySelector("#club-profile-panel");
    const kpis = panel?.querySelector("[class*=kpis]");
    push(log.kpis, kpis?.textContent.trim());
    const reference = [...(panel?.querySelectorAll("section p") || [])].find((p) => p.textContent.startsWith("Centiles face aux"));
    push(log.reference, reference?.textContent.trim());
    const tabs = document.querySelector('#main [role="tablist"]');
    if (tabs && tabs.getBoundingClientRect().height) log.tabs.push(Math.round(tabs.getBoundingClientRect().top + window.scrollY));
  }, 30);
});
page = await slow.newPage();
page.on("pageerror", (e) => consoleLog.push(`[slow] pageerror ${e.message}`));
await page.goto(clubUrl(), { waitUntil: "domcontentloaded", timeout: 120000 });
await page.getByText("Points / match").first().waitFor({ timeout: 60000 }).catch(() => {});
await page.waitForLoadState("networkidle").catch(() => {});
await page.waitForTimeout(2500);
const load = await page.evaluate(() => window.__clubLoad);
await shot(page, "slow-final", false);
check("R1 the figures appear once, in their final reference", { kpiRows: 1, referenceLines: 1 },
  { kpiRows: load.kpis.length, referenceLines: load.reference, firstKpis: load.kpis[0]?.slice(0, 80), lastKpis: load.kpis.at(-1)?.slice(0, 80) },
  load.kpis.length === 1 && load.reference.length === 1);
const tabTops = [...new Set(load.tabs)];
check("R2 the tabs do not move while the figures arrive", "one position (± 1 px)", tabTops,
  load.tabs.length > 0 && Math.max(...tabTops) - Math.min(...tabTops) <= 1);
await page.close();
await slow.close();

check("X1 no page error", [], consoleLog, consoleLog.length === 0);
await browser.close();
const failed = results.filter((r) => !r.ok);
await writeFile(path.join(out, "evidence.json"), JSON.stringify({
  ranAt: new Date().toISOString(), base, api, club, nation, season, other,
  rerun: `node tests/e2e/club-page.e2e.mjs ${base} ${out} ${api}`,
  results, console: consoleLog, passed: results.length - failed.length, failed: failed.length,
}, null, 1));
console.log(`${results.length - failed.length}/${results.length} passed — evidence in ${out}`);
process.exit(failed.length ? 1 : 0);
