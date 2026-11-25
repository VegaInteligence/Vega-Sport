// E2E — the match page in five tabs (issue #221, FAILURE_MODES.md § 62), written before the code from the mock-up
// hugo validated on 25 Nov 2026 (https://claude.ai/artifact/3KkomqcnEFUSvY71pf6eWY).
//
// The match's own reads are Playwright route mocks in the read API's shapes (summary, stats, shots, players, events,
// momentum, line-ups, the in-play forecast); the rest of the site (manifest, catalog, standings) comes from whatever
// API the frontend is configured with, so the file runs against a local frontend on the public API or a replay of it.
//
//   node tests/e2e/match-tabs.e2e.mjs <base url> <evidence dir>
//
// Failure modes (§ 62.2): M1 tabs and default · M2 Résumé's blocks · M3 the three views of « Le match minute par
// minute » · M4 one view only · M5 the shots under the fold · M6 « Tous les joueurs » and the board in Compositions ·
// M7 Analyses without momentum and halves · M8 the table in Avant-match, a final included · M9 the former addresses ·
// M10 before kick-off · M11 phone without sideways scroll · M12 no page error · M14 the halves in Statistiques.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { PROBABLE_KICKOFF, PROBABLE_MATCH_ID, serveLineups } from "./support/probable.mjs";

const [base, out] = process.argv.slice(2);
const { chromium, devices } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_CORE || "playwright");
const id = PROBABLE_MATCH_ID;
const api = "/api/matches/" + id;
const HOME = { id: "t_41iFW3", name: "Paris Saint-Germain" }, AWAY = { id: "t_2lHmy6", name: "Lorient" };
const kickoff = new Date(PROBABLE_KICKOFF).toISOString();
const TABS = ["Résumé", "Compositions", "Statistiques", "Analyses", "Avant-match"];

// Shots: [minute, side, player id, name, xG, goal, on target, x, y].
const SHOTS = [
  [8, "home", "p_0eDvLa", "Ousmane Dembélé", 0.31, true, true, 89, 40],
  [21, "away", "p_lor009", "Pablo Pagis", 0.07, false, true, 80, 55],
  [34, "home", "p_3Ckl7x", "Vitinha", 0.04, false, false, 76, 30],
  [52, "home", "p_0eDvLa", "Ousmane Dembélé", 0.58, true, true, 95, 50],
  [77, "away", "p_lor010", "Aiyegun Tosin", 0.12, false, false, 88, 62],
];
const teamOf = (side) => (side === "home" ? HOME : AWAY);
const summaryShots = SHOTS.map(([minute, side, playerId, playerName, xg, isGoal, isOnTarget, x, y], i) => ({
  id: "s" + i, teamId: teamOf(side).id, playerId, playerName, minute, xg, isGoal, isOnTarget, isOwnGoal: false, x, y,
}));
const shotsFamily = { periods: [
  { period: "FirstHalf", shots: [] }, { period: "SecondHalf", shots: [] },
] };
SHOTS.forEach(([minute, side, pid, name, xg, goal, onTarget, x, y], i) =>
  shotsFamily.periods[minute > 45 ? 1 : 0].shots.push({
    id: "s" + i, player: { id: pid, name }, team_id: teamOf(side).id, x, y, expected_goals: xg, minute,
    event_type: goal ? "Goal" : onTarget ? "AttemptSaved" : "Miss", is_goal: goal, is_own_goal: false, is_on_target: onTarget,
  }));
const statItems = (h, a, xh, xa) => [{ items: [
  { key: "expected_goals", title: "xG", home: xh, away: xa }, { key: "total_shots", title: "Tirs", home: h, away: a },
  { key: "BallPossesion", title: "Possession", home: 61, away: 39 },
] }];
const stats = { periods: [
  { period: "All", groups: statItems(3, 2, 0.93, 0.19) },
  { period: "FirstHalf", groups: statItems(2, 1, 0.35, 0.07) },
  { period: "SecondHalf", groups: statItems(1, 1, 0.58, 0.12) },
] };
const summaryStats = [
  { key: "expected_goals", home: 0.93, away: 0.19 }, { key: "total_shots", home: 3, away: 2 },
  { key: "ShotsOnTarget", home: 2, away: 1 }, { key: "BallPossesion", home: 61, away: 39 },
];
const playerEntry = (pid, name, team, minutes, goals) => ({
  player: { id: pid, name }, team_id: team.id,
  stats: [{ stats: {
    m: { key: "minutes_played", stat: { value: minutes } }, g: { key: "goals", stat: { value: goals } },
    x: { key: "expected_goals", stat: { value: 0.2 } }, a: { key: "expected_assists", stat: { value: 0.1 } },
    p: { key: "accurate_passes", stat: { value: 40, total: 46 } }, d: { key: "duel_won", stat: { value: 5 } },
  } }],
});
const players = [
  playerEntry("p_0eDvLa", "Ousmane Dembélé", HOME, 90, 2), playerEntry("p_3Ckl7x", "Vitinha", HOME, 90, 0),
  playerEntry("p_lor009", "Pablo Pagis", AWAY, 90, 0), playerEntry("p_lor010", "Aiyegun Tosin", AWAY, 77, 0),
];
// Vega's grades of the match (/api/rankings/match): Dembélé first, the board's « Meilleure note du match ».
const grades = { grades: players.map((p, i) => ({
  playerId: p.player.id, grade: [78, 61, 52, 47][i], rank: i + 1, name: p.player.name,
  team: p.team_id === HOME.id ? HOME.name : AWAY.name, teamId: p.team_id, minutes: [90, 90, 90, 77][i],
})) };
const momentum = { points: Array.from({ length: 90 }, (_, i) => ({ minute: i + 1, value: Math.round(Math.sin(i / 6) * 60) })) };
const forecast = {
  match: id, points: Array.from({ length: 91 }, (_, minute) => {
    const home = minute < 8 ? 0.62 : minute < 52 ? 0.8 : 0.95;
    return { minute, home, draw: (1 - home) * 0.6, away: (1 - home) * 0.4 };
  }),
  events: [{ minute: 8, added: 0, kind: "goal", side: "home" }, { minute: 52, added: 0, kind: "goal", side: "home" }],
};
const summary = (over = {}) => ({
  id, season: "2026/2027", leagueId: "l_3FJFUl", league: "Ligue 1", summaryVersion: 1, roundName: "Journée 14",
  date: kickoff.slice(0, 10), timeUtc: kickoff, status: "finished",
  home: { ...HOME, score: 2 }, away: { ...AWAY, score: 0 },
  shots: summaryShots, stats: summaryStats, leadingPlayers: [], players: [],
  coverage: { shots: true, players: true, playerStats: true, teamStatsReliable: true }, ...over,
});
const desktop = { viewport: { width: 1440, height: 900 } };
const mobile = { ...devices["iPhone 15"], viewport: { width: 393, height: 852 } };
const headers = { "access-control-allow-origin": "*", "cache-control": "no-store" };
const reply = (route, json, status = 200) => route.fulfill({ status, headers, json }).catch(() => {});
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
    result.actual = error.message.split("\n").slice(0, 6).join("\n");
    result.passed = false;
  }
  process.stdout.write((result.passed ? "PASS " : "FAIL ") + name + (result.passed ? "" : " — " + result.actual.split("\n")[0]) + "\n");
}

/** A page on the match, its families mocked. `plan`: { status, minutes (from kick-off), roundName, forecast, momentum }. */
async function setup(label, device, plan = {}) {
  const { status = "finished", minutes = 300, forecast: withForecast = true, momentum: withMomentum = true, roundName } = plan;
  const context = await browser.newContext({ ...device, locale: "fr-FR", colorScheme: "dark" });
  const page = await context.newPage();
  const run = { label, plan, requests: [], errors: [] };
  runs.push(run);
  page.setDefaultTimeout(15000);
  await page.addInitScript(() => localStorage.setItem("vega.consent.v1", JSON.stringify({ measurement: false, at: "2026-11-25T12:00:00Z" })));
  page.on("pageerror", (error) => run.errors.push(error.message));
  await context.route(new RegExp(api + "(?:/[^?]+)?(?:\\?|$)"), (route) => {
    const family = new URL(route.request().url()).pathname.slice(api.length + 1);
    if (family === "summary") return reply(route, { data: { version: 1, state: "ready", match: summary({
      status, ...(roundName ? { roundName } : {}),
      ...(status === "not_started" ? { home: { ...HOME, score: null }, away: { ...AWAY, score: null }, shots: [], stats: [] } : {}),
    }) } });
    if (status === "not_started") return reply(route, { error: "Donnée indisponible." }, 404);
    if (family === "stats") return reply(route, { data: stats });
    if (family === "shots") return reply(route, { data: shotsFamily });
    if (family === "players/display" || family === "players") return reply(route, { data: players });
    if (family === "events") return reply(route, { data: { events: [] } });
    if (family === "momentum" && withMomentum) return reply(route, { data: momentum });
    if (family.startsWith("lineups")) return route.fallback();
    return reply(route, { error: "Donnée indisponible." }, 404);
  });
  await serveLineups(context, { lineups: "both", probable: status === "not_started" ? "both" : 404 });
  await context.route(/\/api\/forecasts\/live\?/, (route) => (withForecast && status !== "not_started"
    ? reply(route, forecast) : reply(route, { error: "Prévision indisponible." }, 404)));
  await context.route(/\/api\/rankings\/match\?/, (route) => reply(route, grades));
  await context.route("**/live/config", (route) => reply(route, { enabled: false }));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.href.includes(id)) run.requests.push(url.pathname + url.search);
  });
  await page.clock.install({ time: PROBABLE_KICKOFF + minutes * 60_000 });
  const go = (view) => page.goto(base + "/matchs?" + new URLSearchParams({ id, ...(view ? { view } : {}) }), { waitUntil: "domcontentloaded", timeout: 60000 });
  return { page, run, go, close: () => context.close() };
}

const tabs = (page) => page.getByRole("tab");
const tabNames = async (page) => (await tabs(page).allInnerTexts()).map((t) => t.trim());
const selected = async (page) => ((await page.locator('[role="tab"][aria-selected="true"]').innerText()) || "").trim();
const panel = (page) => page.getByRole("tabpanel");
const cardTitles = async (page) => (await panel(page).locator(".card-title").allInnerTexts()).map((t) => t.trim());
// Waits for the tabs (and a card's title); a miss is left to the checks that follow, which record it.
const settle = async (page, title) => {
  try {
    await page.locator('[role="tab"]').first().waitFor();
    if (title) await panel(page).locator(".card-title", { hasText: title }).first().waitFor();
  } catch {
    // recorded by the checks
  }
  await page.waitForTimeout(400);
};
const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const viewOf = (page) => new URL(page.url()).searchParams.get("view");

try {
  // ------------------------------------------------------------------ desktop, finished league match
  {
    const f = await setup("finished", desktop);
    const { page, run } = f;
    try {
      await f.go();
      await settle(page, "Le match minute par minute");
      await page.screenshot({ path: join(out, "resume-bureau.png"), fullPage: true });

      await check("M1 five tabs, « Résumé » selected, no view in the address", { tabs: TABS, selected: "Résumé", view: null },
        async () => {
          const got = { tabs: await tabNames(page), selected: await selected(page), view: viewOf(page) };
          assert.deepEqual(got, { tabs: TABS, selected: "Résumé", view: null });
          return got;
        });

      await check("M2 Résumé's blocks, none of the former doubles",
        { has: ["Le match minute par minute", "Carte des tirs", "Meilleures notes"], not: ["Les chiffres du match", "Occasions au fil du match", "Analyse des tirs"] },
        async () => {
          const titles = await cardTitles(page);
          for (const t of ["Le match minute par minute", "Carte des tirs", "Meilleures notes"]) assert.ok(titles.includes(t), "missing " + t + " in " + titles.join(" | "));
          for (const t of ["Les chiffres du match", "Occasions au fil du match", "Analyse des tirs", "Probabilité de victoire"]) assert.ok(!titles.includes(t), "still there: " + t);
          return titles;
        });

      await check("M3 the three views, each its chart", { choices: ["Probabilité de victoire", "xG cumulés", "Domination"], first: "win-probability", xg: "svg.xg-timeline", momentum: "momentum" },
        async () => {
          const card = panel(page).locator(".card", { has: page.locator(".card-title", { hasText: "Le match minute par minute" }) });
          const choices = (await card.locator(".segmented-control button").allInnerTexts()).map((t) => t.trim());
          assert.deepEqual(choices, ["Probabilité de victoire", "xG cumulés", "Domination"]);
          assert.equal(await card.getByRole("button", { name: "Probabilité de victoire", exact: true }).getAttribute("aria-pressed"), "true");
          await card.locator('[data-chart="win-probability"]').waitFor();
          await card.getByRole("button", { name: "xG cumulés", exact: true }).click();
          await card.locator("svg.xg-timeline").waitFor();
          assert.equal(await card.locator('[data-chart="win-probability"]').count(), 0);
          await card.getByRole("button", { name: "Domination", exact: true }).click();
          await card.locator('[data-chart="momentum"]').waitFor();
          await page.screenshot({ path: join(out, "resume-domination.png") });
          await card.getByRole("button", { name: "Probabilité de victoire", exact: true }).click();
          return { choices };
        });

      await check("M5 « Voir les 5 tirs » opens on the five shots", { button: "Voir les 5 tirs", rows: 5 }, async () => {
        const card = panel(page).locator(".card", { has: page.locator(".card-title", { hasText: "Carte des tirs" }) });
        const button = card.getByRole("button", { name: /Voir les \d+ tirs/ });
        const text = (await button.innerText()).trim();
        assert.equal(await button.getAttribute("aria-expanded"), "false");
        await button.click();
        const rows = await card.locator("ol.match-shot-list > li").count();
        assert.equal(text, "Voir les 5 tirs");
        assert.equal(rows, 5);
        return { button: text, rows };
      });

      await check("M6 « Tous les joueurs » opens Compositions, the board under the pitch", { selected: "Compositions", view: "lineups", board: true, motm: "Meilleure note du match" },
        async () => {
          await panel(page).getByRole("button", { name: "Tous les joueurs" }).click();
          await page.waitForURL((url) => url.searchParams.get("view") === "lineups");
          const table = panel(page).locator("table.data-table");
          await table.waitFor();
          const pitch = panel(page).locator('[data-marker="lineup"]').first();
          await pitch.waitFor();
          const order = await page.evaluate(() => {
            const p = document.querySelector('[role="tabpanel"] [data-marker="lineup"]'), t = document.querySelector('[role="tabpanel"] table.data-table');
            return Boolean(p && t && p.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING);
          });
          const motm = await panel(page).getByText("Meilleure note du match").count();
          await page.screenshot({ path: join(out, "compositions-bureau.png"), fullPage: true });
          const got = { selected: await selected(page), view: viewOf(page), board: order, motm: motm ? "Meilleure note du match" : null };
          assert.deepEqual(got, { selected: "Compositions", view: "lineups", board: true, motm: "Meilleure note du match" });
          return got;
        });

      await check("M7 Analyses without « Qui a dominé » and « Première et deuxième mi-temps »", { absent: ["Qui a dominé, minute par minute", "Première et deuxième mi-temps"] },
        async () => {
          await page.getByRole("tab", { name: "Analyses" }).click();
          await page.waitForURL((url) => url.searchParams.get("view") === "analyses");
          await page.waitForTimeout(1200);
          const text = await panel(page).innerText();
          assert.ok(!text.includes("Qui a dominé"), "momentum still in Analyses");
          assert.ok(!text.includes("Première et deuxième mi-temps"), "halves still in Analyses");
          return text.slice(0, 160);
        });

      // Nothing lost: the former halves' table is the period choice of « Statistiques » (same family), each half
      // with its own values.
      await check("M14 the halves in Statistiques", { periods: ["Match", "1re mi-temps", "2e mi-temps"], secondHalfXg: "0,58" },
        async () => {
          await page.getByRole("tab", { name: "Statistiques" }).click();
          await page.waitForURL((url) => url.searchParams.get("view") === "stats");
          const choice = panel(page).getByRole("group", { name: "Période des statistiques" }).or(panel(page).locator(".stats-board-head .segmented-control")).first();
          await choice.waitFor();
          const periods = (await choice.locator("button").allInnerTexts()).map((t) => t.trim());
          await choice.getByRole("button", { name: "2e mi-temps" }).click();
          await page.waitForTimeout(300);
          const board = await panel(page).innerText();
          const got = { periods, secondHalfXg: board.includes("0,58") ? "0,58" : null };
          assert.deepEqual(got, { periods: ["Match", "1re mi-temps", "2e mi-temps"], secondHalfXg: "0,58" });
          return got;
        });

      await check("M8a a league match: the competition's table in Avant-match", { table: 1 }, async () => {
        await page.getByRole("tab", { name: "Avant-match" }).click();
        await page.waitForURL((url) => url.searchParams.get("view") === "context");
        await panel(page).locator(".match-standings-card").waitFor();
        await page.screenshot({ path: join(out, "avant-match-bureau.png"), fullPage: true });
        return { table: await panel(page).locator(".match-standings-card").count() };
      });

      await check("M9 the former addresses", { shots: "Résumé", players: "Compositions", standings: "Avant-match", stats: "Statistiques" }, async () => {
        const got = {};
        for (const view of ["shots", "players", "standings", "stats"]) {
          await f.go(view);
          await settle(page);
          got[view] = await selected(page);
        }
        assert.deepEqual(got, { shots: "Résumé", players: "Compositions", standings: "Avant-match", stats: "Statistiques" });
        return got;
      });
      run.pageErrors = [...run.errors];
    } finally {
      await f.close();
    }
  }

  // ------------------------------------------------------------------ no forecast, no momentum
  {
    const f = await setup("xg-only", desktop, { forecast: false, momentum: false });
    try {
      await f.go();
      await settle(f.page, "Le match minute par minute");
      await check("M4 no forecast and no momentum: « xG cumulés » alone, drawn", { choices: [], chart: "svg.xg-timeline" }, async () => {
        const card = panel(f.page).locator(".card", { has: f.page.locator(".card-title", { hasText: "Le match minute par minute" }) });
        await card.locator("svg.xg-timeline").waitFor();
        const radios = await card.locator(".segmented-control button").count();
        assert.equal(radios, 0);
        return { choices: radios, chart: "svg.xg-timeline" };
      });
    } finally {
      await f.close();
    }
  }

  // ------------------------------------------------------------------ a final: no table
  {
    const f = await setup("final", desktop, { roundName: "Final" });
    try {
      await f.go("context");
      await settle(f.page);
      // Nothing lost: the former « Classement » tab showed the competition's table for every match.
      await check("M8b a final: the competition's table still in Avant-match", { table: 1 }, async () => {
        await panel(f.page).locator(".match-standings-card").waitFor();
        const n = await panel(f.page).locator(".match-standings-card").count();
        assert.equal(n, 1);
        return { table: n };
      });
    } finally {
      await f.close();
    }
  }

  // ------------------------------------------------------------------ before kick-off
  {
    const f = await setup("before", desktop, { status: "not_started", minutes: -40 });
    try {
      await f.go("stats");
      await settle(f.page);
      await check("M10 before kick-off: two tabs, « Avant-match » for view=stats, no game family read",
        { tabs: ["Avant-match", "Compositions"], selected: "Avant-match", gameReads: [] }, async () => {
          await f.page.waitForTimeout(1500);
          const gameReads = f.run.requests.filter((u) => u.startsWith(api + "/") && !/^\/(summary|lineups(?:\/probable)?)(?:\?|$)/.test(u.slice(api.length)));
          const got = { tabs: await tabNames(f.page), selected: await selected(f.page), gameReads };
          await f.page.screenshot({ path: join(out, "avant-coup-envoi-bureau.png") });
          assert.deepEqual(got, { tabs: ["Avant-match", "Compositions"], selected: "Avant-match", gameReads: [] });
          return got;
        });
    } finally {
      await f.close();
    }
  }

  // ------------------------------------------------------------------ phone
  {
    const f = await setup("phone", mobile);
    try {
      await check("M11 phone: no sideways scroll on Résumé and Compositions", { resume: 0, lineups: 0 }, async () => {
        await f.go();
        await settle(f.page, "Le match minute par minute");
        const resume = await sideways(f.page);
        await f.page.screenshot({ path: join(out, "resume-telephone.png"), fullPage: true });
        await f.go("lineups");
        await settle(f.page);
        await f.page.locator("table.data-table").waitFor();
        const lineups = await sideways(f.page);
        await f.page.screenshot({ path: join(out, "compositions-telephone.png"), fullPage: true });
        assert.ok(resume <= 0 && lineups <= 0, JSON.stringify({ resume, lineups }));
        return { resume, lineups };
      });
    } finally {
      await f.close();
    }
  }

  await check("M12 no page error", [], async () => {
    const errors = runs.flatMap((r) => r.errors.map((e) => r.label + ": " + e));
    assert.deepEqual(errors, []);
    return errors;
  });
} finally {
  await browser.close();
  await writeFile(join(out, "evidence.json"), JSON.stringify({
    base, inputs: { match: id, kickoff, shots: SHOTS, stats, players, momentum: "90 points", forecast: "91 points, goals 8′ and 52′" },
    rerun: `PLAYWRIGHT_CORE='${process.env.PLAYWRIGHT_CORE || "playwright"}' node tests/e2e/match-tabs.e2e.mjs '${base}' '${out}'`,
    results, runs,
  }, null, 2));
}
if (results.some((result) => !result.passed)) process.exitCode = 1;
