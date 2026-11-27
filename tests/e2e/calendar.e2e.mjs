// E2E — the calendar as a thread of days, FAILURE_MODES § 87: hugo, 27 Nov 2026, 20 h 27 « pour calendrier il est
// libre », then piste A of https://claude.ai/artifact/Uw76VAiFvpWqZoUowgt52o (20 h 41 « POUR Calendrier va pour le
// A »). Written before the code: on main (the tabs À venir / Résultats, the rectangular search) every K check fails.
//
// The API is the double tests/e2e/support/calendar-api.mjs, started here (made-up matches, three weeks around Friday
// 27 Nov 2026, 20 h 40 in Paris); the browser's clock is fixed at that instant (page.clock).
//
// Failure modes and expected outcomes (dark theme, 1440 × 900 unless said):
//  K1  Head: the h1 « Calendrier », on its right one 40 px pill track holding Saison (2026/2027), Compétition (Top 7
//      Europe + UEFA) and a round search button (34 px, 999 px); no rectangular search field (#player-search), no
//      filter panel, no tabs À venir / Résultats.
//  K2  The strip: seven days in one 999 px track between two round arrows, each with its count (« 9 matchs », « — »
//      without), today « Aujourd’hui » and chosen (aria-current="date"), the counts those of the double's week
//      (2, 9, 9, 36, 8, 28, 28: Ligue 2 is outside the scope).
//  K3  Today (Friday 27): « Aujourd’hui 27 novembre », « 8 matchs · 2 en direct · 1 terminé · heure de Paris »; one
//      22 px card on the veil; its groups in the site's order PL, LaLiga, Bundesliga, Serie A, Ligue 1, Liga Portugal,
//      Eredivisie, each head with its country and « 13e journée »; the rows: the Eredivisie match of 18 h 45 a score
//      pill with its winner bold, two « En direct » (Eredivisie 20 h 00, Bundesliga 20 h 30), five hours with a
//      forecast bar of three parts under them; no competition's name repeated on a row.
//  K4  A past day (Tuesday 24): the Champions League only, nine scores, no forecast bar; the address says day=2026-11-24.
//  K5  A day to come (Sunday 29): 28 rows, all hours (« 13:30 » …) with a forecast bar; no score, no « En direct ».
//  K6  The next week's arrow: 30 Nov – 6 Dec, its first day with matches chosen (Friday 4); « Aujourd’hui » shown,
//      which takes back to Friday 27.
//  K7  The reads: one week = /api/fixtures with status=all, from=2026-11-22, to=2026-11-29, limit=50, season, leagues
//      = the ten ids of the scope, then its cursors to the end (3 reads); no status=upcoming or played, no limit=30;
//      choosing another day of the same week reads nothing.
//  K8  Compétition → Ligue 1 (the panel, « Appliquer »): league=l_3FJFUl in the address and the reads; the strip
//      counts Ligue 1 only (0, 0, 0, 0, 1, 4, 4); one group.
//  K9  Search: the round button opens a pill with its field; « Club PL 13 » → q in the reads and only matches of that
//      club; the cross clears it and the round button comes back.
//  K10 Former addresses: ?tab=upcoming&week=2026-11-30 → week of 30 Nov, Friday 4 chosen; ?tab=results → Friday 27;
//      /calendrier → /matchs, Friday 27.
//  K11 « Mes matchs »: a pill; pressed, the address says tab=saved, the strip stays with no day chosen, the saved
//      matches' list below; a day of the strip takes back to it.
//  K12 A row's link: /matchs/?…id=…&from=calendar&day=2026-11-27; the match page's way back says « Calendrier » and
//      leads to day=2026-11-27.
//  K13 An empty day (Wednesday 2 Dec): « Aucun match le mercredi 2 décembre. » and a filled pill to « Vendredi
//      4 décembre ».
//  K14 Skeleton: /matchs without id is flagged data-route-skeleton="calendar" before the page's code; while a week is
//      read (the double holds it 2.5 s) the seven days (the skeleton's, or the page's strip once its code is there)
//      and a 22 px card of skeleton rows show, not the logo alone.
//  K15 Phone (iPhone 13): no sideways scroll; the bar spans the width; the seven days on one row; a row's teams one
//      under the other at the left of the pill; the search open stays within the bar and the phone's width.
//  K16 Logos drawn in black (Ligue 1, Premier League, Champions League): filter brightness(0) invert(0.92) in the dark
//      theme, none in the light one; the card's veil differs from the page's background in both.
//  K17 A week longer than its pages (400 more matches on Monday 23), today read on its own, and that read failing (503):
//      an alert with « Réessayer », not an endless skeleton; once the API answers again, « Réessayer » shows the day.
//  K18 The day read on its own longer than its 20 pages (Codex on PR #274): with 1 000 more matches the day before
//      (UTC), « Liste incomplète » and the notice, no card and no skeleton; with 960, the 4 matches read of today
//      under « Au moins 4 matchs » and the notice, never as the whole day.
//  K19 A week cut before its first day (400 more matches on Sunday 29, the UTC day before Monday 30) and an empty day
//      chosen (Tuesday 1 Dec, Codex on PR #274): « Aucun match le mardi 1 décembre. », never « Aucun match cette
//      semaine. » nor a pill to another week, and Friday 4 still in the strip.
//  X1  No page error.
//
// Setup: the site built against the double's origin, then started:
//   cd dashboard && NEXT_PUBLIC_API_ORIGIN=http://127.0.0.1:8791 NEXT_TELEMETRY_DISABLED=1 node node_modules/next/dist/bin/next build frontend
//   node node_modules/next/dist/bin/next start frontend -p 3291 -H 127.0.0.1 &
// Run (the double is started here on the port given, default 8791):
//   node tests/e2e/calendar.e2e.mjs http://127.0.0.1:3291 <evidence dir> [8791]
// It writes evidence.json and the captures; exit 1 when a check fails.
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NOW, startCalendarApi } from "./support/calendar-api.mjs";

const [base = "http://127.0.0.1:3291", out = path.join(os.tmpdir(), "calendar-e2e"), port = "8791"] = process.argv.slice(2);
await mkdir(out, { recursive: true });
const { chromium, devices } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_CORE || "playwright");
const api = await startCalendarApi({ port: Number(port) });

const results = [],
  errors = [];
const check = (id, expected, actual, ok) => {
  results.push({ id, expected, actual, ok: Boolean(ok) });
  console.log(ok ? "PASS" : "FAIL", id, "—", String(JSON.stringify(actual ?? null)).slice(0, 400));
};
async function run(name, part) {
  try {
    await part();
  } catch (error) {
    check(`${name} stopped`, "the part runs to its end", String(error.message).split("\n")[0], false);
  }
}
const SCOPE = "l_0ALvwF,l_0ErfuF,l_0bfbkO,l_1Isor4,l_2WZ2tt,l_38d9HA,l_3FJFUl,l_4H43wr,l_4QexZg,l_4WFCIZ";
const round = (v) => v === "999px" || parseFloat(v) >= 100;

const browser = await chromium.launch();
async function open(url, options = {}) {
  const { theme = "dark", phone = false } = options;
  const context = await browser.newContext({
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
    colorScheme: theme,
    deviceScaleFactor: 1,
    ...(phone ? devices["iPhone 13"] : { viewport: { width: 1440, height: 900 } }),
  });
  await context.addInitScript((value) => {
    try {
      localStorage.setItem("vega.consent.v1", JSON.stringify({ measurement: false, at: "2026-11-27T12:00:00Z" }));
      localStorage.setItem("statarena.theme", value);
    } catch {}
  }, theme);
  const page = await context.newPage();
  await page.clock.install({ time: Date.parse(NOW) });
  page.on("pageerror", (error) => errors.push(`${url}: ${error.message.slice(0, 300)}`));
  await page.goto(base + url, { waitUntil: "domcontentloaded", timeout: 120000 });
  return { context, page };
}
const ready = (page) => page.locator(".calendar-page .calendar-strip .calendar-day").first().waitFor({ timeout: 60000 });
const rowsReady = (page) => page.locator(".calendar-page :is(.calendar-row, .calendar-empty)").first().waitFor({ timeout: 60000 });
// Hidden, not removed: React still owns these nodes (removing them breaks its next render).
const hideConsent = (page) => page.evaluate(() => document.querySelectorAll(".consent-live, .consent").forEach((n) => n.style.setProperty("display", "none", "important")));
// The page as the checks read it.
const snapshot = (page) =>
  page.evaluate(() => {
    const css = (n) => n && getComputedStyle(n);
    const text = (n) => n?.textContent.replace(/\s+/g, " ").trim() || null;
    const days = [...document.querySelectorAll(".calendar-strip .calendar-day")];
    const groups = [...document.querySelectorAll(".calendar-card .calendar-group")];
    const rows = [...document.querySelectorAll(".calendar-card .calendar-row")];
    return {
      url: location.pathname + location.search,
      title: text(document.querySelector(".calendar-day-head h2")),
      summary: text(document.querySelector(".calendar-day-head .calendar-day-summary")),
      days: days.map((d) => ({
        name: text(d.querySelector(".calendar-day-name")),
        number: text(d.querySelector(".calendar-day-number")),
        count: text(d.querySelector(".calendar-day-count")),
        current: d.getAttribute("aria-current"),
        today: d.classList.contains("is-today"),
      })),
      week: text(document.querySelector(".calendar-week")),
      todayPill: [...document.querySelectorAll(".calendar-side .calendar-pill")].some((p) => /Aujourd’hui/.test(p.textContent)),
      saved: document.querySelector(".calendar-side .calendar-saved")?.getAttribute("aria-current") || null,
      cards: document.querySelectorAll(".calendar-card").length,
      card: (() => {
        const c = document.querySelector(".calendar-card");
        return c && { radius: css(c).borderTopLeftRadius, background: css(c).backgroundColor };
      })(),
      body: css(document.body).backgroundColor,
      groups: groups.map((g) => ({ league: g.dataset.league, name: text(g.querySelector(".calendar-group-name")), meta: text(g.querySelector(".calendar-group-meta")), rows: g.querySelectorAll(".calendar-row").length })),
      rows: rows.map((r) => ({
        state: r.dataset.state,
        href: r.getAttribute("href"),
        home: text(r.querySelector(".calendar-team.is-home .calendar-team-name")),
        away: text(r.querySelector(".calendar-team.is-away .calendar-team-name")),
        mid: text(r.querySelector(".calendar-mid")),
        win: text(r.querySelector(".calendar-team.is-win .calendar-team-name")),
        winWeight: css(r.querySelector(".calendar-team.is-win"))?.fontWeight || null,
        forecastParts: r.querySelectorAll(".list-forecast-bar i").length,
        league: Boolean(r.querySelector(".match-league, .fixture-competition")),
      })),
      empty: text(document.querySelector(".calendar-empty p")),
      emptyPill: text(document.querySelector(".calendar-empty .calendar-pill")),
      notice: text(document.querySelector(".calendar-notice")),
    };
  });
const fixtureReads = (mark) => api.log.slice(mark).filter((r) => r.path === "/api/fixtures");
const waitFor = async (page, fn, timeout = 20000) => {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeout) {
    last = await fn().catch((e) => ({ error: e.message }));
    if (last && last.ok) return last;
    await page.waitForTimeout(150);
  }
  return last;
};
const counts = (s) => s.days.map((d) => d.count);
// Each group's logo slot in the page, and the filter a logo of that competition gets (a stand-in of the same classes).
function logoFilters(ids) {
  return ids.map((id) => {
    const slot = Boolean(document.querySelector(`.calendar-group[data-league="${id}"] .calendar-group-head .calendar-group-logo`));
    const root = document.createElement("div");
    root.className = "calendar-page";
    root.style.cssText = "position:absolute;left:-9999px;top:0";
    root.innerHTML = `<div class="calendar-group" data-league="${id}"><span class="crest calendar-group-logo"><img alt="" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></span></div>`;
    document.body.appendChild(root);
    const filter = getComputedStyle(root.querySelector("img")).filter;
    root.remove();
    return { id, slot, filter };
  });
}

// ---------- K1 to K7, K12, K16 dark: the page of today ----------
await run("today", async () => {
  const mark = api.log.length;
  const { context, page } = await open("/matchs/");
  await ready(page);
  await rowsReady(page);
  await hideConsent(page);
  await page.waitForTimeout(600);
  const head = await page.evaluate(() => {
    const css = (n) => n && getComputedStyle(n);
    const bar = document.querySelector(".calendar-head .calendar-bar");
    const segments = bar ? [...bar.querySelectorAll(".home-settings-segment")].map((s) => s.getAttribute("aria-label")) : [];
    const search = bar?.querySelector(".calendar-search");
    const h1 = document.querySelector(".calendar-head h1");
    return {
      h1: h1?.textContent.trim() || null,
      barHeight: bar?.getBoundingClientRect().height ?? null,
      barRadius: css(bar)?.borderTopLeftRadius || null,
      barRight: bar && h1 ? bar.getBoundingClientRect().left > h1.getBoundingClientRect().right : null,
      segments,
      search: search && { w: search.getBoundingClientRect().width, h: search.getBoundingClientRect().height, radius: css(search).borderTopLeftRadius, tag: search.tagName },
      oldSearch: Boolean(document.querySelector("#player-search")),
      filterPanel: Boolean(document.querySelector(".filter-panel")),
      tabs: [...document.querySelectorAll("a, button")].filter((n) => /^(À venir|Résultats)$/.test(n.textContent.trim()) && n.getClientRects().length).length,
    };
  });
  check(
    "K1 head",
    "h1 « Calendrier », a 40 px pill track on its right: Saison 2026/2027 · Compétition Top 7 Europe + UEFA · a round 34 px search; no rectangular search, no filter panel, no tabs",
    head,
    head.h1 === "Calendrier" && Math.abs(head.barHeight - 40) <= 1 && round(head.barRadius) && head.barRight &&
      head.segments.some((s) => /Saison : 2026\/2027/.test(s)) && head.segments.some((s) => /Top 7 Europe \+ UEFA/.test(s)) &&
      head.search && Math.abs(head.search.w - 34) <= 1 && Math.abs(head.search.h - 34) <= 1 && round(head.search.radius) &&
      !head.oldSearch && !head.filterPanel && head.tabs === 0,
  );
  const s = await snapshot(page);
  const strip = await page.evaluate(() => {
    const track = document.querySelector(".calendar-strip");
    const arrows = [...document.querySelectorAll(".calendar-strip .calendar-arrow")].map((a) => ({ label: a.getAttribute("aria-label"), radius: getComputedStyle(a).borderTopLeftRadius }));
    return { radius: track && getComputedStyle(track).borderTopLeftRadius, arrows };
  });
  check(
    "K2 strip",
    "seven days in a 999 px track between two round arrows; counts 2, 9, 9, 36, 8, 28, 28 matchs; Friday 27 « Aujourd’hui » and current",
    { strip, days: s.days },
    s.days.length === 7 && round(strip.radius) && strip.arrows.length === 2 && strip.arrows.every((a) => round(a.radius)) &&
      JSON.stringify(counts(s)) === JSON.stringify(["2 matchs", "9 matchs", "9 matchs", "36 matchs", "8 matchs", "28 matchs", "28 matchs"]) &&
      s.days[4].today && s.days[4].current === "date" && /Aujourd’hui/.test(s.days[4].name) && s.days.filter((d) => d.current).length === 1,
  );
  const order = ["l_4WFCIZ", "l_0ErfuF", "l_1Isor4", "l_0ALvwF", "l_3FJFUl", "l_4QexZg", "l_4H43wr"];
  const over = s.rows.filter((r) => r.state === "over"),
    live = s.rows.filter((r) => r.state === "live"),
    coming = s.rows.filter((r) => r.state === "upcoming");
  check(
    "K3 today",
    "« Aujourd’hui 27 novembre », « 8 matchs · 2 en direct · 1 terminé · heure de Paris », one 22 px card, groups PL … Eredivisie with country and « 13e journée », 1 score with bold winner, 2 « En direct », 5 hours with a 3-part bar, no league on a row",
    { title: s.title, summary: s.summary, cards: s.cards, card: s.card, groups: s.groups, rows: s.rows },
    /^Aujourd’hui 27 novembre$/.test(s.title || "") && s.summary === "8 matchs · 2 en direct · 1 terminé · heure de Paris" &&
      s.cards === 1 && s.card?.radius === "22px" && s.card.background !== s.body && s.card.background !== "rgba(0, 0, 0, 0)" &&
      JSON.stringify(s.groups.map((g) => g.league)) === JSON.stringify(order) &&
      s.groups.every((g) => /13\s*e\s*journée/.test(g.meta || "")) && s.groups.find((g) => g.league === "l_3FJFUl")?.meta?.startsWith("France") &&
      over.length === 1 && /^\d+ – \d+$/.test(over[0].mid) && (!over[0].win || Number(over[0].winWeight) >= 600) &&
      live.length === 2 && live.every((r) => r.mid === "En direct" && r.forecastParts === 0) &&
      coming.length === 5 && coming.every((r) => /^\d\d:\d\d$/.test(r.mid) && r.forecastParts === 3) &&
      s.rows.every((r) => !r.league),
  );
  await page.screenshot({ path: path.join(out, "today-desktop-dark.png"), fullPage: true });
  // K16 dark: the three black logos lighter. The double carries no logo: the groups' logo slots are checked in the
  // page, the rule on a stand-in of the same classes added beside it (never inside what React draws).
  const logos = await page.evaluate(logoFilters, ["l_4WFCIZ", "l_3FJFUl", "l_0ALvwF"]);
  check(
    "K16 dark logos",
    "Premier League and Ligue 1 logos brightness(0) invert(0.92) on the dark theme, Serie A untouched; each group's logo in .calendar-group-logo",
    logos,
    logos.every((l) => l.slot) && logos[0].filter === "brightness(0) invert(0.92)" && logos[1].filter === "brightness(0) invert(0.92)" && logos[2].filter === "none",
  );
  const first = fixtureReads(mark).filter((r) => r.status === 200);
  const k7 = {
    reads: first.map((r) => r.query),
    ok:
      first.length === 3 &&
      first.every((r) => r.query.status === "all" && r.query.from === "2026-11-22" && r.query.to === "2026-11-29" && r.query.limit === "50" && r.query.leagues === SCOPE && r.query.season === "2026/2027") &&
      !first[0].query.cursor && first[1].query.cursor && first[2].query.cursor,
  };
  // Another day of the same week: no read.
  const mark2 = api.log.length;
  await page.locator(".calendar-strip .calendar-day").nth(1).click();
  await page.waitForFunction(() => /day=2026-11-24/.test(location.search), null, { timeout: 15000 });
  await page.waitForTimeout(800);
  const tuesday = await snapshot(page);
  const extra = fixtureReads(mark2);
  check(
    "K7 reads",
    "the week in 3 reads (status=all, from=2026-11-22, to=2026-11-29, limit=50, season, leagues = the ten ids, then its cursors); no read when another day of it is chosen",
    { ...k7, extra: extra.map((r) => r.query) },
    k7.ok && extra.length === 0,
  );
  check(
    "K4 past day",
    "Tuesday 24: day=2026-11-24, the Champions League only, nine scores, no forecast bar, Tuesday current",
    { url: tuesday.url, title: tuesday.title, groups: tuesday.groups, rows: tuesday.rows.map((r) => [r.state, r.mid, r.forecastParts]) },
    /day=2026-11-24/.test(tuesday.url) && /^Mardi 24 novembre$/.test(tuesday.title || "") && tuesday.groups.length === 1 && tuesday.groups[0].league === "l_0bfbkO" &&
      tuesday.rows.length === 9 && tuesday.rows.every((r) => r.state === "over" && /^\d+ – \d+$/.test(r.mid) && r.forecastParts === 0) && tuesday.days[1].current === "date",
  );
  await page.locator(".calendar-strip .calendar-day").nth(6).click();
  await page.waitForFunction(() => /day=2026-11-29/.test(location.search), null, { timeout: 15000 });
  await page.waitForTimeout(500);
  const sunday = await snapshot(page);
  check(
    "K5 day to come",
    "Sunday 29: 28 rows, all hours with a 3-part forecast bar; no score, no « En direct »",
    { title: sunday.title, n: sunday.rows.length, mids: [...new Set(sunday.rows.map((r) => r.mid))], parts: [...new Set(sunday.rows.map((r) => r.forecastParts))] },
    /^Dimanche 29 novembre$/.test(sunday.title || "") && sunday.rows.length === 28 && sunday.rows.every((r) => r.state === "upcoming" && /^\d\d:\d\d$/.test(r.mid) && r.forecastParts === 3),
  );
  await page.screenshot({ path: path.join(out, "sunday-desktop-dark.png"), fullPage: false });
  // K6: the next week, its first day with matches; « Aujourd’hui » back.
  await page.locator('.calendar-strip .calendar-arrow[aria-label="Semaine suivante"]').click();
  const next = await waitFor(page, async () => {
    const n = await snapshot(page);
    return { ...n, ok: n.days[4]?.current === "date" && n.rows.length > 0 && n.days[0].number === "30" };
  });
  check(
    "K6 next week",
    "30 Nov – 6 Dec, Friday 4 chosen (its first day with matches), « Aujourd’hui » shown",
    next && { week: next.week, days: next.days, title: next.title, todayPill: next.todayPill },
    next?.ok && next.todayPill && /^Vendredi 4 décembre$/.test(next.title || "") && JSON.stringify(counts(next)) === JSON.stringify(["—", "—", "—", "—", "2 matchs", "21 matchs", "21 matchs"]),
  );
  // K13: an empty day of that week.
  await page.locator(".calendar-strip .calendar-day").nth(2).click();
  const empty = await waitFor(page, async () => {
    const n = await snapshot(page);
    return { ...n, ok: Boolean(n.empty) };
  });
  check(
    "K13 empty day",
    "« Aucun match le mercredi 2 décembre. » and a filled pill « Vendredi 4 décembre »",
    empty && { empty: empty.empty, pill: empty.emptyPill },
    empty?.empty === "Aucun match le mercredi 2 décembre." && /^Vendredi 4 décembre/.test(empty.emptyPill || ""),
  );
  await page.screenshot({ path: path.join(out, "empty-day-desktop-dark.png"), fullPage: false });
  await page.locator(".calendar-side .calendar-pill", { hasText: "Aujourd’hui" }).click();
  const back = await waitFor(page, async () => {
    const n = await snapshot(page);
    return { ...n, ok: n.days[4]?.today && n.days[4]?.current === "date" && n.rows.length === 8 };
  });
  check("K6 back to today", "« Aujourd’hui » → Friday 27 again, its eight matches", back && { url: back.url, title: back.title }, back?.ok && !back.todayPill);
  // K12: a row's link, then the match page's way back.
  const href = back.rows[0]?.href || "";
  const params = new URLSearchParams(href.split("?")[1] || "");
  await page.locator(".calendar-card .calendar-row").first().click();
  const backLink = await waitFor(
    page,
    async () => {
      const link = await page.evaluate(() => {
        const a = document.querySelector(".match-head-back");
        return a && { text: a.textContent.replace(/\s+/g, " ").trim(), href: a.getAttribute("href") };
      });
      return { link, ok: Boolean(link) };
    },
    30000,
  );
  check(
    "K12 match link",
    "a row links /matchs/?id=…&from=calendar&day=2026-11-27; the match page's way back « Calendrier » to day=2026-11-27",
    { href, back: backLink?.link },
    /^\/matchs\/?\?/.test(href) && params.get("id") && params.get("from") === "calendar" && params.get("day") === "2026-11-27" &&
      /Calendrier/.test(backLink?.link?.text || "") && /day=2026-11-27/.test(backLink?.link?.href || ""),
  );
  await context.close();
});

// ---------- K8, K9: the competition and the search ----------
await run("filters", async () => {
  const { context, page } = await open("/matchs/");
  await ready(page);
  await rowsReady(page);
  await hideConsent(page);
  const mark = api.log.length;
  await page.locator('.calendar-bar .home-settings-segment[aria-label^="Compétition"]').click();
  await page.locator('.home-settings-tile[data-league="l_3FJFUl"]').click();
  await page.locator(".home-settings-action.is-filled").click();
  const l1 = await waitFor(page, async () => {
    const n = await snapshot(page);
    return { ...n, ok: /league=l_3FJFUl/.test(n.url) && n.groups.length === 1 && n.groups[0].league === "l_3FJFUl" };
  });
  const reads = fixtureReads(mark).filter((r) => r.status === 200);
  check(
    "K8 competition",
    "league=l_3FJFUl in the address and the reads; counts —, —, —, —, 1 match, 4 matchs, 4 matchs; one group",
    l1 && { url: l1.url, counts: counts(l1), groups: l1.groups, reads: reads.map((r) => r.query.league || r.query.leagues) },
    l1?.ok && reads.length > 0 && reads.every((r) => r.query.league === "l_3FJFUl" && !r.query.leagues) &&
      JSON.stringify(counts(l1)) === JSON.stringify(["—", "—", "—", "—", "1 match", "4 matchs", "4 matchs"]),
  );
  // Back to the scope, then the search.
  await page.goto(base + "/matchs/", { waitUntil: "domcontentloaded" });
  await ready(page);
  await rowsReady(page);
  const mark2 = api.log.length;
  await page.locator(".calendar-bar button.calendar-search").click();
  const field = page.locator(".calendar-bar .calendar-search input");
  await field.waitFor({ timeout: 5000 });
  await field.fill("Club PL 13");
  const searched = await waitFor(page, async () => {
    const n = await snapshot(page);
    return { ...n, ok: /q=Club/.test(n.url) && n.rows.length > 0 && n.rows.every((r) => r.home === "Club PL 13" || r.away === "Club PL 13") };
  });
  const qReads = fixtureReads(mark2).filter((r) => r.query.q);
  check(
    "K9 search",
    "the round button opens a field; « Club PL 13 » → q in the reads, only that club's matches",
    searched && { url: searched.url, rows: searched.rows.map((r) => `${r.home} – ${r.away}`), q: qReads.map((r) => r.query.q) },
    searched?.ok && qReads.length > 0 && qReads.every((r) => r.query.q === "Club PL 13"),
  );
  await page.screenshot({ path: path.join(out, "search-desktop-dark.png"), fullPage: false });
  await page.locator(".calendar-bar .calendar-search .calendar-search-clear").click();
  const cleared = await waitFor(page, async () => {
    const r = await page.evaluate(() => ({ round: Boolean(document.querySelector(".calendar-bar button.calendar-search")), url: location.search }));
    return { ...r, ok: r.round && !/q=/.test(r.url) };
  });
  check("K9 clear", "the cross clears the search and the round button comes back", cleared, cleared?.ok);
  await context.close();
});

// ---------- K10, K11: former addresses, Mes matchs ----------
await run("addresses", async () => {
  const cases = [
    ["/matchs/?tab=upcoming&week=2026-11-30", (n) => n.days[0]?.number === "30" && n.days[4]?.current === "date" && /^Vendredi 4 décembre$/.test(n.title || "")],
    ["/matchs/?tab=results", (n) => n.days[4]?.current === "date" && /^Aujourd’hui 27 novembre$/.test(n.title || "")],
    ["/calendrier/", (n) => n.days[4]?.current === "date" && /^\/matchs\/?(\?|$)/.test(n.url)],
  ];
  const seen = [];
  for (const [url, ok] of cases) {
    const { context, page } = await open(url);
    await ready(page);
    await rowsReady(page);
    const n = await snapshot(page);
    seen.push({ url, landed: n.url, title: n.title, ok: ok(n) });
    await context.close();
  }
  check("K10 former addresses", "week=2026-11-30 → Friday 4 Dec; tab=results → Friday 27; /calendrier → /matchs, Friday 27", seen, seen.every((s) => s.ok));
  const { context, page } = await open("/matchs/");
  await ready(page);
  await rowsReady(page);
  await hideConsent(page);
  const pill = await page.evaluate(() => {
    const p = document.querySelector(".calendar-side .calendar-saved");
    return p && { text: p.textContent.trim(), radius: getComputedStyle(p).borderTopLeftRadius };
  });
  await page.locator(".calendar-side .calendar-saved").click();
  const saved = await waitFor(page, async () => {
    const n = await snapshot(page);
    return { ...n, ok: /tab=saved/.test(n.url) && n.saved === "page" && n.days.length === 7 && n.days.every((d) => !d.current) };
  });
  const list = await page.evaluate(() => Boolean(document.querySelector(".calendar-page .research-lists, .calendar-page [data-research-list], .calendar-page .calendar-saved-list")));
  await page.locator(".calendar-strip .calendar-day").nth(4).click();
  const again = await waitFor(page, async () => {
    const n = await snapshot(page);
    return { ...n, ok: !/tab=saved/.test(n.url) && n.days[4]?.current === "date" && n.rows.length === 8 };
  });
  check(
    "K11 Mes matchs",
    "a pill; pressed: tab=saved, the strip with no day chosen, the saved list; a day takes back to it",
    { pill, saved: saved && { url: saved.url, saved: saved.saved }, list, again: again && again.url },
    pill && round(pill.radius) && /Mes matchs/.test(pill.text) && saved?.ok && list && again?.ok,
  );
  await context.close();
});

// ---------- K14: the skeleton ----------
await run("skeleton", async () => {
  api.state.delay = 2500;
  const context = await browser.newContext({ locale: "fr-FR", timezoneId: "Europe/Paris", colorScheme: "dark", viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.clock.install({ time: Date.parse(NOW) });
  page.on("pageerror", (error) => errors.push(`skeleton: ${error.message.slice(0, 300)}`));
  await page.goto(base + "/matchs/", { waitUntil: "commit" });
  const flag = await page.evaluate(() => document.documentElement.getAttribute("data-route-skeleton")).catch(() => null);
  const shown = await waitFor(
    page,
    async () => {
      const s = await page.evaluate(() => {
        const visible = (n) => n && n.getClientRects().length > 0 && getComputedStyle(n).visibility !== "hidden";
        // Before the page's code: the whole skeleton; after it, the page's own strip above the day's skeleton.
        const sk = [...document.querySelectorAll(".calendar-skeleton")].find(visible);
        const card = sk?.querySelector(".calendar-skeleton-card");
        const strip = [...document.querySelectorAll(".calendar-page .calendar-strip .calendar-day")].filter(visible).length;
        return {
          flag: document.documentElement.getAttribute("data-route-skeleton"),
          skeleton: Boolean(sk),
          days: sk ? sk.querySelectorAll(".calendar-skeleton-day").length || strip : 0,
          cardRadius: card ? getComputedStyle(card).borderTopLeftRadius : null,
          logoOnly: Boolean([...document.querySelectorAll(".route-logo, .page-loader")].find(visible)) && !sk,
        };
      });
      return { ...s, ok: s.skeleton && s.days === 7 && s.cardRadius === "22px" };
    },
    15000,
  );
  check(
    "K14 skeleton",
    "data-route-skeleton=\"calendar\" on /matchs; while the week is read a skeleton of seven days and a 22 px card",
    { flag, shown },
    (flag === "calendar" || shown?.flag === "calendar") && shown?.ok,
  );
  await page.screenshot({ path: path.join(out, "loading-desktop.png") });
  api.state.delay = 0;
  await context.close();
});

// ---------- K15, K16 light: phone and light theme ----------
await run("phone", async () => {
  const { context, page } = await open("/matchs/", { phone: true });
  await ready(page);
  await rowsReady(page);
  await hideConsent(page);
  await page.waitForTimeout(600);
  const p = await page.evaluate(() => {
    const box = (n) => n && n.getBoundingClientRect();
    const bar = box(document.querySelector(".calendar-bar"));
    const days = [...document.querySelectorAll(".calendar-strip .calendar-day")].map(box);
    const row = document.querySelector(".calendar-card .calendar-row[data-state='upcoming']");
    const home = box(row?.querySelector(".calendar-team.is-home")),
      away = box(row?.querySelector(".calendar-team.is-away")),
      mid = box(row?.querySelector(".calendar-mid"));
    return {
      scroll: document.documentElement.scrollWidth,
      width: window.innerWidth,
      bar: bar && { left: bar.left, right: bar.right },
      daysTop: [...new Set(days.map((d) => Math.round(d.top)))],
      daysInside: days.every((d) => d.left >= 0 && d.right <= window.innerWidth),
      stacked: home && away && mid ? { homeBelow: away.top >= home.bottom - 1, sameLeft: Math.abs(home.left - away.left) <= 2, midRight: mid.left >= Math.max(home.right, away.right) - 2 } : null,
    };
  });
  check(
    "K15 phone",
    "no sideways scroll; the bar spans the width (16 px gutters); the seven days on one row; a row's teams one under the other, the pill at their right",
    p,
    p.scroll <= p.width && p.bar && p.bar.left <= 20 && p.bar.right >= p.width - 20 && p.daysTop.length === 1 && p.daysInside &&
      p.stacked?.homeBelow && p.stacked.sameLeft && p.stacked.midRight,
  );
  await page.screenshot({ path: path.join(out, "today-phone-dark.png"), fullPage: true });
  // The search open: it fills what the bar leaves, the page as wide as the phone.
  await page.locator(".calendar-bar button.calendar-search").click();
  await page.locator(".calendar-search input").fill("Club PL");
  await page.waitForTimeout(400);
  const s = await page.evaluate(() => {
    const bar = document.querySelector(".calendar-bar").getBoundingClientRect(),
      search = document.querySelector(".calendar-search.is-open")?.getBoundingClientRect();
    return { scroll: document.documentElement.scrollWidth, width: window.innerWidth, barRight: bar.right, searchRight: search?.right, searchWidth: search?.width };
  });
  check(
    "K15 phone search open",
    "the search open stays within the bar and the phone's width (no sideways scroll)",
    s,
    s.width === 390 && s.scroll <= s.width && s.searchRight <= s.barRight + 1 && s.barRight <= s.width && s.searchWidth >= 150,
  );
  await page.screenshot({ path: path.join(out, "search-open-phone-dark.png") });
  await context.close();
  const light = await open("/matchs/", { theme: "light" });
  await ready(light.page);
  await rowsReady(light.page);
  await hideConsent(light.page);
  await light.page.waitForTimeout(600);
  const l = await snapshot(light.page);
  const logo = (await light.page.evaluate(logoFilters, ["l_3FJFUl"]))[0].filter;
  check(
    "K16 light",
    "light theme: the card's veil differs from the page's background; Ligue 1's logo unfiltered",
    { card: l.card, body: l.body, logo },
    l.card && l.card.radius === "22px" && l.card.background !== l.body && logo === "none",
  );
  await light.page.screenshot({ path: path.join(out, "today-desktop-light.png"), fullPage: true });
  await light.context.close();
  const lp = await open("/matchs/", { theme: "light", phone: true });
  await ready(lp.page);
  await rowsReady(lp.page);
  await hideConsent(lp.page);
  await lp.page.screenshot({ path: path.join(out, "today-phone-light.png"), fullPage: true });
  await lp.context.close();
});

// ---------- K17, K18: the day read on its own ----------
await run("day read", async () => {
  api.state.pad = { date: "2026-11-23", count: 400 };
  api.state.failDay = true;
  const { context, page } = await open("/matchs/");
  await ready(page);
  await hideConsent(page);
  const alert = page.locator(".calendar-page .calendar-error[role=alert]");
  await alert.waitFor({ timeout: 60000 });
  const failed = { alert: (await alert.textContent()).replace(/\s+/g, " ").trim(), skeleton: await page.locator(".calendar-page .calendar-skeleton-body").count() };
  api.state.failDay = false;
  await alert.getByRole("button", { name: "Réessayer" }).click();
  await rowsReady(page);
  const back = await snapshot(page);
  check(
    "K17 day read failing",
    "an alert naming the failure with « Réessayer » (no skeleton); after it, today's eight matches",
    { failed, title: back.title, summary: back.summary, rows: back.rows?.length },
    /HTTP 503/.test(failed.alert) && /Réessayer/.test(failed.alert) && failed.skeleton === 0 && back.title === "Aujourd’hui 27 novembre" && /^8 matchs/.test(back.summary || ""),
  );
  await context.close();
  const cutRead = async (count) => {
    api.state.pad = { date: "2026-11-26", count };
    const opened = await open("/matchs/");
    await ready(opened.page);
    await hideConsent(opened.page);
    await opened.page.locator(".calendar-page .calendar-day-head").waitFor({ timeout: 60000 });
    await opened.page.waitForTimeout(400);
    const seen = await opened.page.evaluate(() => {
      const text = (n) => n?.textContent.replace(/\s+/g, " ").trim() || null;
      return {
        summary: text(document.querySelector(".calendar-day-summary")),
        notice: text(document.querySelector(".calendar-page .calendar-notice")),
        rows: document.querySelectorAll(".calendar-card .calendar-row").length,
        cards: document.querySelectorAll(".calendar-card").length,
        skeleton: document.querySelectorAll(".calendar-page .calendar-skeleton-body").length,
      };
    });
    await opened.page.screenshot({ path: path.join(out, `day-cut-${count}.png`), fullPage: true });
    await opened.context.close();
    return seen;
  };
  const none = await cutRead(1000),
    some = await cutRead(960);
  check(
    "K18 day read cut",
    "1 000 the day before: « Liste incomplète », the notice, no card; 960: « Au moins 4 matchs », the notice, 4 rows",
    { none, some },
    /^Liste incomplète/.test(none.summary || "") && /trop de matchs/.test(none.notice || "") && none.cards === 0 && none.skeleton === 0 &&
      /^Au moins 4 matchs/.test(some.summary || "") && /trop de matchs/.test(some.notice || "") && some.rows === 4,
  );
  api.state.pad = { date: "2026-11-29", count: 400 };
  const cut = await open("/matchs/?day=2026-12-01");
  await ready(cut.page);
  await hideConsent(cut.page);
  await cut.page.locator(".calendar-page .calendar-empty").waitFor({ timeout: 60000 });
  const empty = await cut.page.evaluate(() => ({
    text: document.querySelector(".calendar-page .calendar-empty")?.textContent.replace(/\s+/g, " ").trim(),
    pills: [...document.querySelectorAll(".calendar-page .calendar-empty .calendar-pill")].map((a) => a.textContent.trim()),
    friday: Boolean(document.querySelector('.calendar-strip a.calendar-day[href*="day=2026-12-04"]')),
  }));
  await cut.context.close();
  check(
    "K19 cut week not empty",
    "« Aucun match le mardi 1 décembre. », no pill to another week, Friday 4 in the strip",
    empty,
    /^Aucun match le mardi 1 décembre\./.test(empty.text || "") && !/cette semaine/.test(empty.text || "") && !empty.pills.some((t) => /Semaine/.test(t)) && empty.friday,
  );
  api.state.pad = null;
});

check("X1 no page error", "no uncaught exception in any run", errors, errors.length === 0);
await writeFile(path.join(out, "evidence.json"), JSON.stringify({ base, now: NOW, results, errors, requests: api.log.slice(-400) }, null, 2));
await browser.close();
await api.close();
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
