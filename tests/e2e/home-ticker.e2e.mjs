// E2E — the home's strip with the matches to come (#69). The owner, 24 Nov 2026: « sur le bandeau en haut [je vois]
// que les matchs finis ; je veux aussi les futurs matchs ». The strip is a scoreboard, time flowing left to right,
// opened on "now" (doc docs/calculs/06-accueil-et-matchs/01-accueil.md, « Le bandeau »; the rule's unit tests:
// tests/home-ticker.test.mjs).
//
// Failure modes and expected outcomes (the API's answers are read by this script, the expected strip recomputed
// here from them, independently of the site's code, then compared with the page; a visitor without country nor
// favourites, so the choice is the served weight alone):
//  H1 The strip holds only results, or the matches to come are not the rule's → its days = the week's 4 latest
//     result days (nations first, then matchWeight, 8 a day), then from today to `billboardWindow.end` the
//     billboard's matches not among the results: in play (the feed says in_play, or kick-off passed < 3 h ago and
//     the feed still says not started) and to come (kick-off ≥ now, not started), the 8 heaviest of each day, shown
//     in play first, then by kick-off, then weight; each tick's top line says « Terminé », its kick-off time (Paris,
//     HH:MM) or « En direct ».
//  H2 The days run newest first → oldest on the left, each label's date after the previous one.
//  H3 The server's HTML (JavaScript off) differs → the same ticks and the nav labelled « Résultats et matchs à venir
//     … »; one hidden holder right after the nav carries the opening script.
//  H4 The strip opens at the wrong place → the anchored tick (data-ticker-anchor) is the first tick not finished,
//     wholly in view, with the up to two ticks before it in view too when they fit (1440 px: two).
//  H5 It jumps once the page hydrates → from the first frame the strip is visible to well after hydration, its
//     scrollLeft takes one value only (recorded every frame from an init script).
//  H6 It snaps back after the visitor scrolled it → a scroll by the visitor, then the page's clock refresh
//     (visibilitychange): the strip stays where the visitor left it.
//  P1 Phone 390 × 844: the anchored tick wholly in view, no jump, no sideways page scroll.
//  X1 No page error, no console error, no hydration warning (failed remote loads excluded).
//
// Run (same setup as tests/e2e/home-country.e2e.mjs: the test double in front of the replay, the clock fixed for
// this script, the double and the site's server):
//   VEGA_NOW=<ISO> [VEGA_IMAGES=<replay origin>] node tests/e2e/home-ticker.e2e.mjs <base url> <evidence dir> [api origin]
// It writes evidence.json (setup, inputs, expected, actual, console) and the captures into the evidence dir; exit 1
// when a check fails.
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { europeFocusIds } from "../../dashboard/shared/competition-scope.js";
import { matchDay, matchWeight } from "../../dashboard/frontend/src/services/home-insights.js";

const [base = "http://127.0.0.1:3000", out = path.join(os.tmpdir(), "home-ticker-e2e"), api = "https://dngp6kh9jx2bl.cloudfront.net"] = process.argv.slice(2);
const NOW = process.env.VEGA_NOW || null;
const nowMs = NOW ? Date.parse(NOW) : Date.now();
await mkdir(out, { recursive: true });
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_CORE || "playwright");

const results = [], consoleLog = [], inputs = {};
const check = (id, expected, actual, ok) => {
  results.push({ id, expected, actual, ok: Boolean(ok) });
  console.log(ok ? "PASS" : "FAIL", id, "—", String(JSON.stringify(actual ?? null)).slice(0, 400));
};
const getJson = async (p) => {
  const r = await fetch(api + p, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`${r.status} ${p}`);
  return r.json();
};
const query = (values) => new URLSearchParams(Object.entries(values).sort(([a], [b]) => a.localeCompare(b))).toString();

// ---------- What the API serves ----------
const manifest = await getJson("/api/dashboard/manifest");
const homePath = `/api/read/home?${query({ generation: manifest.publicationVersion, leagues: [...europeFocusIds(manifest)].sort().join(","), season: manifest.defaultSeason })}`;
const home = (await getJson(homePath)).data;
inputs.homePath = homePath;
inputs.now = new Date(nowMs).toISOString();
inputs.billboardWindow = home.billboardWindow ?? null;
inputs.billboard = (home.billboard || []).map((m) => [m.fixture.id, m.day, new Date(m.time).toISOString(), m.weight, m.fixture.status]);
inputs.results = (home.results || []).map((m) => [m.id, m.timeUtc || m.date]);

// ---------- The strip, written again here from the doc ----------
const parisDay = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date(ms));
const hhmm = (ms) => new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" }).format(new Date(ms));
const SPAN = 3 * 3600_000;
function expectedStrip() {
  const ranks = new Map(home.ranks || []);
  const days = new Map();
  const day = (k) => days.get(k) || days.set(k, { day: k, nations: [], clubs: [] }).get(k);
  for (const m of home.internationals || []) day(m.date).nations.push(m);
  for (const m of home.results || []) day(matchDay(m)).clubs.push(m);
  const past = [...days.values()].sort((a, b) => (a.day < b.day ? 1 : -1)).slice(0, 4).map((d) => ({
    day: d.day,
    ticks: [...d.nations.map(() => ["nation", "Terminé"]), ...[...d.clubs].sort((a, b) => matchWeight(b, ranks) - matchWeight(a, ranks)).map((m) => [m.id, "Terminé"])].slice(0, 8),
  }));
  const known = new Set((home.results || []).map((m) => m.id));
  const today = parisDay(nowMs), end = home.billboardWindow?.end;
  const state = (m) => {
    const s = m.fixture.status;
    if (m.time >= nowMs && s !== "finished" && s !== "in_play") return "upcoming";
    if (s === "in_play") return "live";
    if (["finished", "postponed", "canceled", "abandoned"].includes(s)) return null;
    return m.time < nowMs && nowMs <= m.time + SPAN ? "live" : null;
  };
  const coming = new Map();
  for (const m of home.billboard || []) {
    const tick = state(m);
    if (known.has(m.fixture.id) || !tick || m.day > end || (tick === "upcoming" && m.day < today)) continue;
    (coming.get(m.day) || coming.set(m.day, []).get(m.day)).push({ ...m, tick });
  }
  if (!coming.size) return { ahead: false, days: past };
  const strip = new Map([...past].reverse().map((d) => [d.day, d]));
  for (const [d, list] of coming) {
    const picked = list
      .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0) || a.time - b.time || a.fixture.id.localeCompare(b.fixture.id))
      .slice(0, 8)
      .sort((a, b) => Number(b.tick === "live") - Number(a.tick === "live") || a.time - b.time || (b.weight ?? 0) - (a.weight ?? 0) || a.fixture.id.localeCompare(b.fixture.id))
      .map((m) => [m.fixture.id, m.tick === "live" ? "En direct" : hhmm(m.time)]);
    strip.set(d, { day: d, ticks: [...(strip.get(d)?.ticks || []), ...picked] });
  }
  return { ahead: true, days: [...strip.values()].sort((a, b) => (a.day < b.day ? -1 : 1)) };
}
const want = expectedStrip();
inputs.expected = want;

// ---------- The page ----------
const browser = await chromium.launch();
async function newContext({ country = "XX", phone = false, js = true } = {}) {
  const context = await browser.newContext({
    locale: "fr-FR", timezoneId: "Europe/Paris", colorScheme: "dark", deviceScaleFactor: 2, javaScriptEnabled: js,
    viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
    isMobile: phone, hasTouch: phone,
    extraHTTPHeaders: { "x-vercel-ip-country": country },
  });
  if (NOW && js) await context.clock.setFixedTime(new Date(NOW));
  if (process.env.VEGA_IMAGES)
    await context.route(`${new URL(api.startsWith("http://127.0.0.1") ? "https://dngp6kh9jx2bl.cloudfront.net" : api).origin}/**`, async (route) => {
      const u = new URL(route.request().url());
      const r = await fetch(process.env.VEGA_IMAGES + u.pathname + u.search).catch(() => null);
      if (!r) return route.abort();
      return route.fulfill({ status: r.status, contentType: r.headers.get("content-type") || undefined, body: Buffer.from(await r.arrayBuffer()), headers: { "access-control-allow-origin": "*" } });
    });
  // H5: every frame, the strip's scrollLeft while it is visible, and whether React has hydrated it yet.
  if (js)
    await context.addInitScript(() => {
      window.__tickerLog = [];
      const start = performance.now();
      const frame = () => {
        const nav = document.querySelector(".home-ticker");
        if (nav && nav.clientWidth) {
          const hydrated = Object.keys(nav).some((k) => k.startsWith("__reactFiber"));
          const last = window.__tickerLog.at(-1);
          if (!last || last.left !== nav.scrollLeft || last.hydrated !== hydrated)
            window.__tickerLog.push({ t: Math.round(performance.now() - start), left: nav.scrollLeft, hydrated });
        }
        if (performance.now() - start < 60000) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
  return context;
}
const readStrip = (page) =>
  page.evaluate(() => {
    const nav = document.querySelector(".home-ticker");
    if (!nav) return null;
    const days = [];
    for (const el of nav.children) {
      if (el.classList.contains("home-ticker-day")) days.push({ label: el.textContent, ticks: [] });
      else if (el.classList.contains("home-tick")) {
        const a = el.querySelector("a.home-tick-top");
        days.at(-1).ticks.push([a ? new URL(a.getAttribute("href"), location.href).searchParams.get("id") : "nation", el.querySelector(".home-tick-top span:last-child")?.textContent]);
      }
    }
    const holder = nav.nextElementSibling;
    return { label: nav.getAttribute("aria-label"), days, holder: Boolean(holder?.hidden && holder.querySelector("script")) };
  });
const view = (page) =>
  page.evaluate(() => {
    const nav = document.querySelector(".home-ticker");
    const box = nav.getBoundingClientRect();
    const ticks = [...nav.querySelectorAll(".home-tick")];
    const anchor = nav.querySelector("[data-ticker-anchor]");
    const i = ticks.indexOf(anchor);
    const inView = (el) => { const r = el.getBoundingClientRect(); return r.left >= box.left - 1 && r.right <= box.right + 1; };
    const firstOpen = ticks.findIndex((t) => t.querySelector(".home-tick-top span:last-child")?.textContent !== "Terminé");
    return {
      scrollLeft: nav.scrollLeft, width: nav.clientWidth, anchorIndex: i, firstOpen,
      anchor: anchor?.querySelector("a.home-tick-top") ? new URL(anchor.querySelector("a.home-tick-top").getAttribute("href"), location.href).searchParams.get("id") : null,
      anchorInView: Boolean(anchor && inView(anchor)),
      beforeInView: ticks.slice(Math.max(0, i - 2), Math.max(0, i)).map(inView),
      widths: [...new Set(ticks.map((t) => Math.round(t.getBoundingClientRect().width)))],
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
const consoleOf = (page, tag) => {
  page.on("console", (m) => {
    const text = m.text();
    if ((m.type() === "error" && !/Failed to load resource|vercel-scripts/.test(text)) || /hydrat/i.test(text)) consoleLog.push(`[${tag}] ${m.type()} ${text}`);
  });
  page.on("pageerror", (e) => consoleLog.push(`[${tag}] pageerror ${e.message}`));
};
const ticksOf = (strip) => strip?.days.map((d) => d.ticks) ?? null;
const wantTicks = want.days.map((d) => d.ticks);
const shortDay = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const wantLabels = want.days.map((d) => shortDay.format(new Date(d.day + "T12:00:00Z")));

async function visit({ phone = false, country = "XX", tag }) {
  // The server's HTML first (JavaScript off).
  let context = await newContext({ country, phone, js: false });
  let page = await context.newPage();
  await page.goto(base + "/", { waitUntil: "domcontentloaded", timeout: 120000 });
  // Without JavaScript the streamed part of the page stays in its hidden holder: attached, not shown.
  await page.locator(".home-ticker").waitFor({ state: "attached", timeout: 60000 });
  const server = await readStrip(page);
  await context.close();
  context = await newContext({ country, phone });
  page = await context.newPage();
  consoleOf(page, tag);
  await page.goto(base + "/", { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.locator(".home-ticker").waitFor({ timeout: 60000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForFunction(() => Object.keys(document.querySelector(".home-ticker")).some((k) => k.startsWith("__reactFiber")), null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  return { context, page, server, strip: await readStrip(page), view: await view(page), log: await page.evaluate(() => window.__tickerLog) };
}

// ---------- Desktop, no country ----------
{
  const { context, page, server, strip, view: v, log } = await visit({ tag: "desktop" });
  inputs.desktop = { strip, view: v, log };
  check("H1 the strip = the week's results, then the matches in play and to come (recomputed from the API)", wantTicks, ticksOf(strip),
    want.ahead && JSON.stringify(ticksOf(strip)) === JSON.stringify(wantTicks) && wantTicks.flat().some(([, top]) => /^\d\d:\d\d$/.test(top)));
  check("H2 days oldest first", wantLabels, strip?.days.map((d) => d.label), JSON.stringify(strip?.days.map((d) => d.label)) === JSON.stringify(wantLabels) && want.days.every((d, i) => !i || d.day > want.days[i - 1].day));
  check("H3 the server's HTML: the same ticks, « Résultats et matchs à venir », the opening script after the nav",
    { ticks: wantTicks, label: /^Résultats et matchs à venir /, holder: true }, { ticks: ticksOf(server), label: server?.label, holder: server?.holder },
    JSON.stringify(ticksOf(server)) === JSON.stringify(wantTicks) && /^Résultats et matchs à venir /.test(server?.label || "") && server?.holder && /^Résultats et matchs à venir /.test(strip?.label || ""));
  check("H4 opened on the first tick not finished, it and the two before it in view", { anchorIndex: v.firstOpen, anchorInView: true, beforeInView: [true, true], oneWidth: [182] }, v,
    v.anchorIndex === v.firstOpen && v.anchorIndex >= 0 && v.anchorInView && v.beforeInView.length === Math.min(2, v.anchorIndex) && v.beforeInView.every(Boolean) && v.scrollLeft > 0 && JSON.stringify(v.widths) === "[182]");
  const lefts = [...new Set(log.map((s) => s.left))];
  check("H5 no horizontal jump: one scrollLeft from the first visible frame to after hydration", { lefts: [v.scrollLeft], hydrated: true }, { lefts, samples: log.slice(0, 12) },
    lefts.length === 1 && lefts[0] === v.scrollLeft && log.some((s) => !s.hydrated) && log.some((s) => s.hydrated));
  await page.locator(".home-ticker").scrollIntoViewIfNeeded();
  await page.locator(".home-ticker").hover();
  await page.mouse.wheel(-5000, 0);
  await page.waitForTimeout(400);
  const moved = await page.evaluate(() => document.querySelector(".home-ticker").scrollLeft);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.waitForTimeout(1200);
  const after = await page.evaluate(() => document.querySelector(".home-ticker").scrollLeft);
  check("H6 the visitor's scroll is kept after the page's clock refresh", { moved: "< opening", after: moved }, { opening: v.scrollLeft, moved, after }, moved < v.scrollLeft && after === moved);
  await page.close();
  await context.close();
}

// ---------- Phone, no country ----------
{
  const { context, page, view: v, log } = await visit({ phone: true, tag: "phone" });
  inputs.phone = { view: v, log };
  const lefts = [...new Set(log.map((s) => s.left))];
  check("P1 phone 390: the anchored tick in view, no jump, no sideways page scroll", { anchorInView: true, lefts: 1, overflow: 0 }, { ...v, lefts },
    v.anchorIndex === v.firstOpen && v.anchorInView && lefts.length === 1 && v.overflow <= 0);
  await page.close();
  await context.close();
}

check("X1 no page error, console error or hydration warning", [], consoleLog, consoleLog.length === 0);
await browser.close();
const failed = results.filter((r) => r.ok === false);
await writeFile(path.join(out, "evidence.json"), JSON.stringify({
  ranAt: new Date().toISOString(), base, api, now: NOW,
  rerun: `${NOW ? `VEGA_NOW=${NOW} ` : ""}${process.env.VEGA_IMAGES ? `VEGA_IMAGES=${process.env.VEGA_IMAGES} ` : ""}node tests/e2e/home-ticker.e2e.mjs ${base} ${out} ${api}`,
  inputs, results, console: consoleLog,
  summary: { passed: results.filter((r) => r.ok === true).length, failed: failed.length },
}, null, 2));
console.log(`${results.filter((r) => r.ok === true).length} passed, ${failed.length} failed — ${out}/evidence.json`);
process.exit(failed.length ? 1 : 0);
