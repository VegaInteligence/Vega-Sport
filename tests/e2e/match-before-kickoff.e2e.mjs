// Run against the local Vega Sport frontend with its normal public API configuration.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { PROBABLE_KICKOFF, PROBABLE_MATCH_ID, serveLineups } from "./support/probable.mjs";

const [base, out] = process.argv.slice(2);
const { chromium, devices } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_CORE || "playwright");
const id = PROBABLE_MATCH_ID;
const api = "/api/matches/" + id;
const kickoff = new Date(PROBABLE_KICKOFF).toISOString();
// R40 (FAILURE_MODES § 70): before the kick-off a player's bubble shows his last five matches and a link to his page.
const recentHead = /5 derniers matchs joués · 450 min/;
const recentRows = [
  // The match itself, listed before it is played, and a match on the bench: neither is a match played.
  { matchId: id, date: kickoff.slice(0, 10), minutes: null, positionId: 34 },
  { matchId: "m_e2e006", date: "2026-11-22", minutes: null, positionId: 2 },
  ...["2026-11-21", "2026-11-14", "2026-11-07", "2026-11-04", "2026-10-31"].map((date, i) => ({
    matchId: "m_e2e00" + i, date, minutes: 90, grade: 50 + i * 5, positionId: 34, leagueId: i % 2 ? "l_0bfbkO" : "l_3FJFUl",
    duelsWon: 3, duelsLost: 1, tackles: 1, interceptions: 1, clearances: 2, passesAccurate: 45, passesAttempted: 50,
    saves: null, goalsConceded: null,
  })),
];
const recentBody = (url) => {
  const params = new URL(url).searchParams, generation = params.get("generation") || "e2e";
  return {
    data: {
      appearances: recentRows.map((r) => ({ playerId: params.get("player"), ...r })),
      competitions: [{ id: "l_3FJFUl", name: "Ligue 1" }, { id: "l_0bfbkO", name: "Champions League" }],
      fixtures: [], records: [],
    },
    meta: { generation, actor: { kind: "player", id: params.get("player") } },
    pagination: { generation, page: 1, limit: 12, total: recentRows.length },
  };
};
// Before kick-off the page has three tabs (issue #221, FAILURE_MODES § 62 and § 63): a game view's address
// opens « Avant-match », the former « Joueurs » « Compositions », which holds it now.
const TABS = ["Avant-match", "Compositions", "Classement"];
const views = [
  ["stats", "Avant-match"], ["shots", "Avant-match"], ["players", "Compositions"],
  ["analyses", "Avant-match"], ["overview", "Avant-match"],
];
const summary = {
  id, season: "2026/2027", leagueId: "l_3FJFUl", league: "Ligue 1", summaryVersion: 1,
  date: kickoff.slice(0, 10), timeUtc: kickoff, status: "not_started",
  home: { id: "t_41iFW3", name: "Paris Saint-Germain", score: null },
  away: { id: "t_2lHmy6", name: "Lorient", score: null },
  shots: [], stats: [], leadingPlayers: [], coverage: {},
};
const stats = { periods: [{ period: "All", groups: [{ items: [{ key: "total_shots", home: 7, away: 2 }] }] }] };
const desktop = { viewport: { width: 1280, height: 800 } };
const mobile = { ...devices["iPhone 15"], viewport: { width: 393, height: 852 } };
const headers = { "access-control-allow-origin": "*", "cache-control": "no-store" };
const reply = (route, json, status = 200) => route.fulfill({ status, headers, json });
const results = [], runs = [];
await mkdir(out, { recursive: true });
const browser = await chromium.launch();

async function check(name, expected, run) {
  const result = { name, expected };
  results.push(result);
  try {
    result.actual = await run();
    result.passed = true;
  } catch (error) {
    result.actual = error.message;
    result.passed = false;
  }
  process.stdout.write((result.passed ? "PASS " : "FAIL ") + name + "\n");
}

async function setup(label, device, { status = "not_started", minutes = -40, live = false } = {}) {
  const context = await browser.newContext({ ...device, locale: "fr-FR", colorScheme: "dark" });
  const page = await context.newPage();
  const run = { label, status, minutes, live, requests: [], errors: [] };
  runs.push(run);
  page.setDefaultTimeout(10000);
  await page.addInitScript(() => localStorage.setItem("vega.consent.v1", JSON.stringify({
    measurement: false, at: "2026-11-25T12:00:00Z",
  })));
  page.on("pageerror", (error) => run.errors.push(error.message));
  let started = status !== "not_started";
  let liveReads = 0;
  await context.route(new RegExp(api + "(?:/[^?]+)?(?:\\?|$)"), (route) => {
    const family = new URL(route.request().url()).pathname.slice(api.length + 1);
    if (family === "summary") return reply(route, { data: { match: {
      ...summary, status,
      ...(status === "finished" ? { home: { ...summary.home, score: 2 }, away: { ...summary.away, score: 1 } } : {}),
    } } });
    if (family === "stats" && started) return reply(route, { data: stats });
    if (family === "shots" && started) return reply(route, { data: { periods: [] } });
    return reply(route, { error: "Donnée indisponible." }, 404);
  });
  await context.route("**/api/read/player?*", (route) => reply(route, recentBody(route.request().url())));
  const lineups = { lineups: "home", probable: "both" };
  await serveLineups(context, lineups);
  await context.route("**/live/config", (route) => reply(route, live
    ? { enabled: true, http: "live.invalid", realtime: "live.invalid", key: "e2e" }
    : { enabled: false }));
  await context.route("**/live/matches/" + id, (route) => {
    ++liveReads;
    return reply(route, {
      status: started ? "in_play" : "scheduled", revision: liveReads, period: "first_half", minute: 1,
      score: { home: 0, away: 0 }, events: [], stats: [],
      families: { score: "live", events: "live", stats: "live" },
    });
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.href.includes(id)) run.requests.push(url.pathname + url.search);
  });
  await page.clock.install({ time: PROBABLE_KICKOFF + minutes * 60_000 });
  const go = async (view) => {
    await page.goto(base + "/matchs?" + new URLSearchParams({ id, view }), { waitUntil: "domcontentloaded", timeout: 45000 });
  };
  return {
    page, go, run, lineups, close: () => context.close(),
    start: () => { started = true; }, liveReads: () => liveReads,
  };
}

const forbidden = (run) => run.requests.filter((url) =>
  url.startsWith("/api/archive/matches/") ||
  url.startsWith("/api/rankings/match?") ||
  /^\/api\/(?:dashboard\/)?performance(?:s)?\b/.test(url) ||
  url.startsWith(api + "/") && !/^\/(summary|lineups(?:\/probable)?)(?:\?|$)/.test(url.slice(api.length)),
);

const panelOf = (page) => page.getByRole("tabpanel");
const tab = (page, name) => page.getByRole("tab", { name, exact: true });

try {
  for (const [label, device, entry] of [["ordinateur", desktop, "stats"], ["mobile", mobile, "shots"]]) {
    const fixture = await setup(label, device);
    const { page, run } = fixture;
    try {
      await check(label + " — trois onglets, aucune donnée de jeu lue", {
        tabs: TABS, opened: Object.fromEntries(views), requests: [], pageErrors: [], overflow: 0,
      }, async () => {
        const opened = {};
        let tabs = [];
        for (const [key] of [...views.filter(([key]) => key === entry), ...views.filter(([key]) => key !== entry)]) {
          await fixture.go(key);
          const selectedTab = page.locator('[role="tab"][aria-selected="true"]');
          await selectedTab.waitFor();
          await page.waitForTimeout(350);
          opened[key] = (await selectedTab.innerText()).trim();
          tabs = (await page.locator('[role="tab"]').allInnerTexts()).map((t) => t.trim());
          if (key === entry) await page.screenshot({ path: join(out, label + ".png") });
        }
        const width = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        run.visible = opened;
        run.tabRequests = [...run.requests];
        run.unexpectedBeforeKickoff = forbidden(run);
        assert.deepEqual(tabs, TABS);
        assert.deepEqual(opened, Object.fromEntries(views));
        assert.deepEqual(run.unexpectedBeforeKickoff, []);
        assert.deepEqual(run.errors, []);
        assert.ok(width <= 0);
        return { tabs, opened, width };
      });
      await check(label + " — contexte et compositions", {
        accessible: TABS,
        probableAndOfficial: true, bubbles: ["5 derniers matchs joués · 450 min", "5 derniers matchs joués · 450 min"],
        kept: true, link: "/joueurs/?id=…", performanceWindow: 0, gameRequests: [],
      }, async () => {
        // Reset the observations from the five tabs, even when recording a failing baseline.
        run.requests.length = 0;
        // Each tab, « Compositions » last: its markers are read below.
        for (const name of [...TABS.filter((n) => n !== "Compositions"), "Compositions"]) {
          await tab(page, name).click();
          await tab(page, name).and(page.locator('[aria-selected="true"]')).waitFor();
          assert.equal(await tab(page, name).getAttribute("aria-selected"), "true");
        }
        const probable = page.locator('[data-marker="probable"]').first();
        const official = page.locator('[data-marker="lineup"]').first();
        await probable.waitFor();
        await official.waitFor();
        const bubbles = [];
        let kept = true;
        const recent = page.locator("[data-player-recent]");
        for (const marker of [probable, official]) {
          // R40: a mouse hovers, a phone taps (the tap pins the bubble). A scroll closes a bubble: the player is
          // brought into view first, as a reader scrolls before tapping.
          await marker.scrollIntoViewIfNeeded();
          await page.waitForTimeout(300);
          if (device === desktop) await marker.hover();
          else await marker.click();
          await recent.getByText(recentHead).waitFor();
          bubbles.push((await recent.locator("p").nth(1).innerText()).trim());
          if (device === desktop) {
            // The pointer crosses to the bubble: it stays open; a click on the player pins it.
            await recent.hover();
            await page.waitForTimeout(400);
            kept &&= await recent.isVisible();
            await marker.click();
            await page.waitForTimeout(200);
            kept &&= await recent.isVisible();
          }
          await page.screenshot({ path: join(out, label + "-composition-joueur.png") });
          await page.keyboard.press("Escape");
          await recent.waitFor({ state: "detached" }).catch(() => {});
        }
        const performanceWindow = await page.getByRole("dialog", { name: "Performance du joueur" }).count();
        // The link opens his page.
        // The pointer leaves the player first: hovering where it already is fires nothing.
        await official.scrollIntoViewIfNeeded();
        await page.waitForTimeout(300);
        if (device === desktop) {
          await page.mouse.move(2, 400);
          await official.hover();
        } else await official.click();
        const link = recent.getByRole("link", { name: "Voir la fiche du joueur" });
        await link.waitFor();
        const href = await link.getAttribute("href");
        await link.click();
        await page.waitForURL(/\/joueurs\/?\?(?:.*&)?id=p_/, { timeout: 15000, waitUntil: "commit" });
        run.lineupRequests = [...run.requests];
        assert.equal(bubbles.length, 2);
        assert.ok(bubbles.every((b) => recentHead.test(b)));
        assert.ok(kept);
        assert.equal(performanceWindow, 0);
        assert.match(href, /^\/joueurs\/?\?(?:.*&)?id=p_/);
        assert.deepEqual(forbidden(run), []);
        return { bubbles, kept, href, performanceWindow, url: page.url(), lineups: fixture.lineups.reads };
      });
    } finally {
      await fixture.close();
    }
  }

  await check("Début en direct sur une fiche déjà ouverte", {
    scheduled: "Avant-match", statsAfterStart: [7, 2], sameDocument: true, selectedTab: "stats",
    runningTabs: ["Direct", "Résumé", "Compositions", "Statistiques", "Analyses", "Classement", "Avant-match"],
  }, async () => {
    const fixture = await setup("transition", desktop, { live: true });
    const { page, run } = fixture;
    try {
      await fixture.go("stats");
      await panelOf(page).waitFor();
      await page.evaluate(() => { window.vegaE2EDocument = true; });
      const selectedName = async () => (await page.locator('[role="tab"][aria-selected="true"]').innerText()).trim();
      const before = await selectedName();
      await page.clock.fastForward(11 * 60_000);
      await page.waitForRequest("**/live/matches/" + id, { timeout: 7000 }).catch((error) => {
        if (!fixture.liveReads()) throw error;
      });
      await page.clock.fastForward(30 * 60_000);
      const whileScheduled = await selectedName();
      run.unexpectedWhileScheduled = forbidden(run);
      fixture.start();
      await page.clock.runFor(31000);
      const board = panelOf(page).getByRole("region", { name: "Statistiques des équipes" });
      await board.waitFor();
      const text = await board.innerText();
      assert.equal(before, "Avant-match");
      assert.equal(whileScheduled, "Avant-match");
      assert.deepEqual(run.unexpectedWhileScheduled, []);
      assert.match(text, /7/);
      assert.match(text, /2/);
      assert.equal(await page.evaluate(() => window.vegaE2EDocument), true);
      assert.equal(await tab(page, "Statistiques").getAttribute("aria-selected"), "true");
      await tab(page, "Direct").waitFor();
      // M13 (FAILURE_MODES § 62): the Résumé stays a tab while the match runs.
      const runningTabs = (await page.locator('[role="tab"]').allInnerTexts()).map((t) => t.trim());
      assert.deepEqual(runningTabs, ["Direct", "Résumé", "Compositions", "Statistiques", "Analyses", "Classement", "Avant-match"]);
      await page.screenshot({ path: join(out, "direct.png") });
      return { before, whileScheduled, text, liveReads: fixture.liveReads() };
    } finally {
      await fixture.close();
    }
  });

  for (const status of ["in_play", "finished"]) {
    await check(status + " — données affichées à l’ouverture", { stats: [7, 2], shots: true }, async () => {
      const fixture = await setup(status, desktop, { status, minutes: 300 });
      const { page, run } = fixture;
      try {
        await fixture.go("stats");
        const board = panelOf(page).getByRole("region", { name: "Statistiques des équipes" });
        await board.waitFor();
        const text = await board.innerText();
        assert.match(text, /7/);
        assert.match(text, /2/);
        await tab(page, "Résumé").click();
        await panelOf(page).getByRole("heading", { name: "Carte des tirs" }).waitFor();
        assert.ok(run.requests.includes(api + "/stats"));
        assert.ok(run.requests.includes(api + "/shots"));
        assert.deepEqual(run.errors, []);
        return { text, requests: run.requests };
      } finally {
        await fixture.close();
      }
    });
  }
} finally {
  await browser.close();
  await writeFile(join(out, "evidence.json"), JSON.stringify({
    base, inputs: { kickoff, summary, stats, lineups: "tests/e2e/support/probable.mjs" },
    rerun: `PLAYWRIGHT_CORE='${process.env.PLAYWRIGHT_CORE || "playwright"}' node tests/e2e/match-before-kickoff.e2e.mjs '${base}' '${out}'`,
    results, runs,
  }, null, 2));
}
if (results.some((result) => !result.passed)) process.exitCode = 1;
