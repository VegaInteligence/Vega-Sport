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
const message = "Le match n’a pas encore commencé.";
// Before kick-off the page has two tabs (issue #221, FAILURE_MODES § 62): a game view's address
// opens « Avant-match », the former « Joueurs » « Compositions », which holds it now.
const TABS = ["Avant-match", "Compositions"];
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
      await check(label + " — deux onglets, aucune donnée de jeu lue", {
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
        probableAndOfficial: true, playerMessage: message, gameRequests: [],
      }, async () => {
        // Reset the observations from the five tabs, even when recording a failing baseline.
        run.requests.length = 0;
        for (const name of TABS) {
          await tab(page, name).click();
          await tab(page, name).and(page.locator('[aria-selected="true"]')).waitFor();
          assert.equal(await tab(page, name).getAttribute("aria-selected"), "true");
        }
        const probable = page.locator('[data-marker="probable"]').first();
        const official = page.locator('[data-marker="lineup"]').first();
        await probable.waitFor();
        await official.waitFor();
        const playerMessages = [];
        for (const marker of [probable, official]) {
          await marker.click();
          const dialog = page.getByRole("dialog", { name: "Performance du joueur" });
          await dialog.waitFor();
          await page.screenshot({ path: join(out, label + "-composition-joueur.png") });
          await dialog.locator(".modal-body").waitFor();
          await page.waitForTimeout(350);
          playerMessages.push((await dialog.locator(".modal-body").innerText()).trim());
          await dialog.getByRole("button", { name: "Fermer" }).click();
        }
        run.lineupRequests = [...run.requests];
        assert.deepEqual(playerMessages, [message, message]);
        assert.deepEqual(forbidden(run), []);
        return { playerMessages, lineups: fixture.lineups.reads };
      });
    } finally {
      await fixture.close();
    }
  }

  await check("Début en direct sur une fiche déjà ouverte", {
    scheduled: "Avant-match", statsAfterStart: [7, 2], sameDocument: true, selectedTab: "stats",
    runningTabs: ["Direct", "Résumé", "Compositions", "Statistiques", "Analyses", "Avant-match"],
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
      assert.deepEqual(runningTabs, ["Direct", "Résumé", "Compositions", "Statistiques", "Analyses", "Avant-match"]);
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
