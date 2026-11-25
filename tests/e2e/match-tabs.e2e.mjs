// E2E — the match page in five tabs (issue #221, FAILURE_MODES.md § 62), written before the code from the mock-up
// hugo validated on 25 Nov 2026 (https://claude.ai/artifact/3KkomqcnEFUSvY71pf6eWY).
//
// The match's own reads are Playwright route mocks in the read API's shapes (summary, stats, shots, players, events,
// momentum, line-ups, the in-play forecast); the rest of the site (manifest, catalog, standings) comes from whatever
// API the frontend is configured with, so the file runs against a local frontend on the public API or a replay of it.
//
//   node tests/e2e/match-tabs.e2e.mjs <base url> <evidence dir>
//
// § 63 (hugo's review in production, 25 Nov 2026, 18 h 31) amends it: R1 six tabs, « Classement » of its own · R2 the
// table and the projection · R3 each team on its side of the shot map · R4 the period choice · R5 the shoot-out on the
// goal · R6 the finished match's strip in the Résumé · R7 the search in « Compositions » · R8 ten valued actions.
// § 63.3 (hugo, 18 h 47): R9 no list under the shot map · R10 the best grades end with the shot map · R11 the
// competition page's block in « Classement ». § 63.4 (Codex): R13 a blocked shot is not « Cadré ». § 63.5: R14 eight best grades.
// § 63.6 (hugo chose direction C of the head's mock-up): R15 the top row · R16 the thread of matches · R17 previous /
// next keep the view · R18 the competition's button opens the picker · R19 the head on a phone.
// § 64 (hugo, 19 h 39): R26 each team in its crest's colour, blue and violet without one.
//
// Failure modes (§ 62.2): M1 tabs and default · M2 Résumé's blocks · M3 the three views of « Le match minute par
// minute » · M4 one view only · M5 (now R9) · M6 « Tous les joueurs » and the board in Compositions ·
// M7 Analyses without momentum and halves · M8 the table in Avant-match, a final included · M9 the former addresses ·
// M10 before kick-off · M11 phone without sideways scroll · M12 no page error · M14 the halves in Statistiques.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { PROBABLE_KICKOFF, PROBABLE_MATCH_ID, serveLineups } from "./support/probable.mjs";

const [base, out] = process.argv.slice(2);
const { chromium, devices } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_CORE || "playwright");
const id = PROBABLE_MATCH_ID;
const api = "/api/matches/" + id;
// The crests' copies (§ 64): PSG navy with a red band, Lorient orange with white, each on a transparent ground.
// As the API gives them: the provider's address, whose copy the site reads by the same file name.
const PROVIDER = "https://cdn.pitchapi.dev/images/teams/";
const CREST = { home: "1".repeat(64) + ".png", away: "2".repeat(64) + ".png" };
const HOME = { id: "t_41iFW3", name: "Paris Saint-Germain", imageUrl: PROVIDER + CREST.home };
const AWAY = { id: "t_2lHmy6", name: "Lorient", imageUrl: PROVIDER + CREST.away };
/** A 40×40 RGBA PNG: `paint(x, y)` gives each pixel. */
function png(paint) {
  const size = 40, raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) raw.set(paint(x, y), y * (size * 4 + 1) + 1 + x * 4);
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = table[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const head = Buffer.alloc(8); head.writeUInt32BE(data.length); head.write(type, 4); const tail = Buffer.alloc(4); tail.writeUInt32BE(crc(Buffer.concat([head.subarray(4), data]))); return Buffer.concat([head, data, tail]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const inside = (x, y) => (x - 19.5) ** 2 + (y - 19.5) ** 2 < 18 ** 2;
const CREST_PNG = {
  [CREST.home]: png((x, y) => (!inside(x, y) ? [0, 0, 0, 0] : x >= 16 && x < 24 ? [218, 41, 28, 255] : [0, 65, 112, 255])),
  [CREST.away]: png((x, y) => (!inside(x, y) ? [0, 0, 0, 0] : y < 12 ? [255, 255, 255, 255] : [241, 117, 27, 255])),
};
const kickoff = new Date(PROBABLE_KICKOFF).toISOString();
const TABS = ["Résumé", "Compositions", "Statistiques", "Analyses", "Classement", "Avant-match"];

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
// The shoot-out's kicks (§ 63, R5): [side, player id, name, outcome, goal_crossed_y, goal_crossed_z].
const KICKS = [
  ["home", "p_0eDvLa", "Ousmane Dembélé", "Goal", 31.5, 0.6], ["away", "p_lor009", "Pablo Pagis", "AttemptSaved", 35.2, 0.4],
  ["home", "p_3Ckl7x", "Vitinha", "Goal", 36.9, 1.9], ["away", "p_lor010", "Aiyegun Tosin", "Miss", 38.4, 2.9],
  ["home", "p_hom011", "Marquinhos", "AttemptSaved", 33.0, 1.1],
];
const shotsFamily = { periods: [
  { period: "FirstHalf", shots: [] }, { period: "SecondHalf", shots: [] },
  { period: "Penalties", shots: KICKS.map(([side, pid, name, outcome, gy, gz], i) => ({
    id: "k" + i, player: { id: pid, name }, team_id: teamOf(side).id, x: 94, y: 34, minute: 120, situation: "Penalty",
    event_type: outcome, is_goal: outcome === "Goal", is_own_goal: false, is_on_target: outcome !== "Miss", goal_crossed_y: gy, goal_crossed_z: gz,
  })) },
] };
SHOTS.forEach(([minute, side, pid, name, xg, goal, onTarget, x, y], i) =>
  shotsFamily.periods[minute > 45 ? 1 : 0].shots.push({
    id: "s" + i, player: { id: pid, name }, team_id: teamOf(side).id, x, y, expected_goals: xg, minute,
    event_type: goal ? "Goal" : onTarget ? "AttemptSaved" : "Miss", is_goal: goal, is_own_goal: false, is_on_target: onTarget,
    // Pagis's shot is blocked yet marked on target, as the provider can (§ 63.4, R13).
    is_blocked: i === 1, goal_crossed_y: 34 + (i - 2), goal_crossed_z: 0.5 + i * 0.3,
  }));
// Twelve players valued (§ 63, R8): the list shows ten.
const advancedPlayers = { players: Array.from({ length: 12 }, (_, i) => ({
  player: { id: "p_val" + String(i).padStart(3, "0"), name: "Joueur " + (i + 1) }, team_id: (i % 2 ? AWAY : HOME).id, actions: 40 - i,
  possession_value: { vaep_total: 0.9 - i * 0.06, vaep_offensive: 0.6 - i * 0.04, vaep_defensive: 0.3 - i * 0.02 },
})) };
// The season replayed to its end (§ 63, R2): eighteen clubs, PSG and Lorient among them.
const projection = { format: "league", competition: "l_3FJFUl", season: "2026/2027", model: { replays: 10000 }, teams: Array.from({ length: 18 }, (_, i) => ({
  id: i === 0 ? HOME.id : i === 13 ? AWAY.id : "t_cl" + String(i).padStart(4, "0"), name: i === 0 ? HOME.name : i === 13 ? AWAY.name : "Club " + (i + 1),
  imageUrl: null, played: 14, points: 34 - i * 2, projectedPoints: 80 - i * 3.5,
  places: Array.from({ length: 18 }, (_, k) => (k === i ? 0.6 : 0.4 / 17)),
})) };
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
})).concat(Array.from({ length: 8 }, (_, i) => ({
  // Eight more graded players the page's rows do not hold (§ 63.5, R14): « Meilleures notes » shows 8.
  playerId: "p_gr" + String(i).padStart(4, "0"), grade: 45 - i * 2, rank: 5 + i, name: "Joueur noté " + (i + 1),
  team: i % 2 ? AWAY.name : HOME.name, teamId: (i % 2 ? AWAY : HOME).id, minutes: 90,
}))) };
// The season's fixtures (§ 63.6): rounds 13, 14 and 15, four matches each, the match second of round 14.
const H = 3600_000, D = 24 * H;
const CLUBS = ["Marseille", "Lyon", "Monaco", "Lille", "Rennes", "Nice", "Lens", "Nantes", "Brest", "Toulouse", "Reims", "Auxerre",
  "Angers", "Metz", "Le Havre", "Strasbourg", "Paris FC", "Montpellier", "Saint-Étienne", "Ajaccio", "Troyes", "Bordeaux"];
const FIXTURES = [13, 14, 15].flatMap((round, r) => [0, 1, 2, 3].map((k) => {
  const at = PROBABLE_KICKOFF + (r - 1) * 7 * D + (k - 1) * 2 * H;
  if (round === 14 && k === 1)
    return { id, date: new Date(at).toISOString().slice(0, 10), time_utc: new Date(at).toISOString(), status: "finished", round_name: "14",
      home_team: { id: HOME.id, name: HOME.name }, away_team: { id: AWAY.id, name: AWAY.name }, score_home: 2, score_away: 0 };
  const n = r * 8 + k * 2;
  const played = round < 15;
  return { id: `m_fx${round}${k}`, date: new Date(at).toISOString().slice(0, 10), time_utc: new Date(at).toISOString(),
    status: played ? "finished" : "not_started", round_name: String(round),
    home_team: { id: "t_fx" + n, name: CLUBS[n % CLUBS.length] }, away_team: { id: "t_fx" + (n + 1), name: CLUBS[(n + 1) % CLUBS.length] },
    score_home: played ? k % 3 : null, score_away: played ? 1 : null };
}));
const ORDER = FIXTURES.map((m) => m.id);
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
    result.actual = error.message.split("\n").slice(0, 24).join("\n");
    result.passed = false;
  }
  process.stdout.write((result.passed ? "PASS " : "FAIL ") + name + (result.passed ? "" : " — " + result.actual.split("\n")[0]) + "\n");
}

/** A page on the match, its families mocked. `plan`: { status, minutes (from kick-off), roundName, forecast, momentum }. */
async function setup(label, device, plan = {}) {
  const { status = "finished", minutes = 300, forecast: withForecast = true, momentum: withMomentum = true, roundName, crests = true } = plan;
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
    if (family === "advanced/players") return reply(route, { data: advancedPlayers });
    if (family.startsWith("lineups")) return route.fallback();
    return reply(route, { error: "Donnée indisponible." }, 404);
  });
  await serveLineups(context, { lineups: "both", probable: status === "not_started" ? "both" : 404 });
  await context.route(/\/api\/forecasts\/live\?/, (route) => (withForecast && status !== "not_started"
    ? reply(route, forecast) : reply(route, { error: "Prévision indisponible." }, 404)));
  await context.route(/\/api\/rankings\/match\?/, (route) => reply(route, grades));
  await context.route(/\/api\/forecasts\/season\?/, (route) => reply(route, projection));
  await context.route("**/live/config", (route) => reply(route, { enabled: false }));
  // The crests: their copies on the site's origin (§ 64); `crests: false` leaves them unreadable.
  await context.route(/\/api\/crest\//, (route) => {
    const file = route.request().url().split("/").pop();
    return crests && CREST_PNG[file]
      ? route.fulfill({ status: 200, contentType: "image/png", body: CREST_PNG[file] })
      : route.fulfill({ status: 404, body: "" });
  });
  await context.route(/dngp6kh9jx2bl\.cloudfront\.net\/data\//, (route) => {
    const file = route.request().url().split("/").pop();
    return CREST_PNG[file] ? route.fulfill({ status: 200, contentType: "image/png", body: CREST_PNG[file] }) : route.fallback();
  });
  await context.route(/\/api\/fixtures\?/, (route) => {
    const q = new URL(route.request().url()).searchParams;
    if (q.get("league") !== "l_3FJFUl" || q.get("status") !== "all") return route.fallback();
    return reply(route, { data: { matches: FIXTURES }, pagination: { generation: "e2e", nextCursor: null } });
  });
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
/** The match page's --home / --away and the hue each gives (null: not a crest's colour). */
const teamColours = (page) => page.evaluate(() => {
  const style = getComputedStyle(document.querySelector(".match-detail"));
  const hue = (v) => { const m = /^light-dark\(hsl\(([\d.]+) /.exec(v); return m ? Number(m[1]) : null; };
  const home = style.getPropertyValue("--home").trim(), away = style.getPropertyValue("--away").trim();
  // A shot's tooltip is drawn in document.body (§ 64, Codex): the charts' colours are there too.
  const body = getComputedStyle(document.body);
  return { home, away, homeHue: hue(home), awayHue: hue(away), bodyHome: body.getPropertyValue("--chart-home").trim(), bodyAway: body.getPropertyValue("--chart-away").trim() };
});
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

      await check("R15 the head's top row, no breadcrumb row, the date in the status",
        { back: "Résultats", competition: ["Ligue 1", "2026/2027", "14ᵉ journée"], report: 1, bookmark: 1, oldRows: 0, status: "Terminé · 28 nov. 2026" }, async () => {
          const head = page.locator(".match-head");
          await head.waitFor();
          const button = head.locator("button[data-match-picker]");
          await button.waitFor();
          const name = (await button.textContent()).replace(/\s+/g, " ").trim();
          const got = {
            back: (await head.locator("a").first().textContent()).replace(/[←\s]+/g, " ").trim(),
            competition: ["Ligue 1", "2026/2027", "14ᵉ journée"].filter((t) => name.includes(t)),
            report: await head.getByRole("link", { name: "Rapport du match" }).count(),
            bookmark: await head.getByRole("button", { name: /Enregistrer/ }).count(),
            oldRows: await page.locator(".match-breadcrumb-row, .scoreboard-meta").count(),
            status: ((await page.locator(".match-scoreboard .match-status").textContent()) || "").replace(/\s+/g, " ").trim().slice(0, 22),
          };
          await page.locator(".match-head").screenshot({ path: join(out, "haut-de-page-bureau.png") });
          assert.deepEqual(got, { back: "Résultats", competition: ["Ligue 1", "2026/2027", "14ᵉ journée"], report: 1, bookmark: 1, oldRows: 0, status: "Terminé · 28 nov. 2026" });
          return { ...got, name };
        });

      await check("R16 the thread: six before, six after, the current one marked and in view", { tiles: ORDER, current: id, inView: true }, async () => {
        const thread = page.locator('nav[aria-label="Matchs de la compétition"]');
        await thread.locator("[data-match-tile]").first().waitFor();
        const tiles = await thread.locator("[data-match-tile]").evaluateAll((a) => a.map((x) => x.getAttribute("data-match-tile")));
        const current = await thread.locator('[data-match-tile][aria-current="page"]').getAttribute("data-match-tile");
        const inView = await thread.evaluate((nav) => {
          const strip = nav.querySelector("[data-match-strip]"), tile = nav.querySelector('[aria-current="page"]');
          const a = strip.getBoundingClientRect(), b = tile.getBoundingClientRect();
          return b.left >= a.left - 1 && b.right <= a.right + 1;
        });
        const got = { tiles, current, inView };
        assert.deepEqual(got, { tiles: ORDER, current: id, inView: true });
        return got;
      });

      await check("R26 each team in its crest's colour: PSG's navy, Lorient's orange", { homeHue: "200–220", awayHue: "20–35" }, async () => {
        await page.waitForFunction(() => /^light-dark/.test(getComputedStyle(document.querySelector(".match-detail")).getPropertyValue("--away").trim()), null, { timeout: 10000 }).catch(() => {});
        const got = await teamColours(page);
        await page.locator(".match-scoreboard").screenshot({ path: join(out, "couleurs-logos-bureau.png") });
        assert.ok(got.homeHue >= 200 && got.homeHue <= 220, `home ${got.home}`);
        assert.ok(got.awayHue >= 20 && got.awayHue <= 35, `away ${got.away}`);
        assert.deepEqual([got.bodyHome, got.bodyAway], [got.home, got.away], "the tooltip's colours on body");
        return got;
      });

      await check("R18 the competition's button opens the picker on round 14", { round: "regular:14", current: 1 }, async () => {
        await page.locator(".match-head button[data-match-picker]").click();
        const dialog = page.getByRole("dialog");
        await dialog.waitFor();
        const got = {
          round: await dialog.locator('[role="group"][aria-label="Journées"] button[aria-pressed="true"]').getAttribute("data-round"),
          current: await dialog.locator('a[aria-current="page"]').count(),
        };
        await page.screenshot({ path: join(out, "haut-de-page-selecteur.png") });
        await page.keyboard.press("Escape");
        await dialog.waitFor({ state: "detached" }).catch(() => {});
        assert.deepEqual(got, { round: "regular:14", current: 1 });
        return got;
      });

      await check("M1/R1 six tabs, « Résumé » selected, no view in the address", { tabs: TABS, selected: "Résumé", view: null },
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

      await check("R6 the finished match's strip opens the Résumé", { motm: "Ousmane Dembélé", first: true, leaders: ["Le plus dangereux", "Le plus présent", "Le plus solide"] },
        async () => {
          const strip = panel(page).locator("[data-match-leaders]");
          await strip.waitFor();
          // The labels are upper-cased by the style: their text, not their rendering.
          const text = (await strip.textContent()).replace(/\s+/g, " ");
          const first = await page.evaluate(() => {
            const s = document.querySelector('[role="tabpanel"] [data-match-leaders]'), c = document.querySelector('[role="tabpanel"] .match-flow-card');
            return Boolean(s && c && s.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING);
          });
          const got = { motm: /Meilleure note du match[\s\S]*Ousmane Dembélé/.test(text) ? "Ousmane Dembélé" : text.slice(0, 80), first,
            leaders: ["Le plus dangereux", "Le plus présent", "Le plus solide"].filter((t) => text.includes(t)) };
          assert.deepEqual(got, { motm: "Ousmane Dembélé", first: true, leaders: ["Le plus dangereux", "Le plus présent", "Le plus solide"] });
          return got;
        });

      await check("R3 each team on its side of the shot map, two colours", { home: { n: 3, left: 3 }, away: { n: 2, right: 2 }, colours: 2 },
        async () => {
          const map = panel(page).locator('[data-chart="match-shot-map"]');
          await map.waitFor();
          const got = await map.evaluate((svg) => {
            const half = Number(svg.querySelector("[data-halfway]").getAttribute("x1"));
            const pts = [...svg.querySelectorAll("[data-side]")];
            const of = (side) => pts.filter((p) => p.dataset.side === side);
            const colours = new Set(pts.map((p) => getComputedStyle(p).stroke));
            return {
              home: { n: of("home").length, left: of("home").filter((p) => Number(p.getAttribute("cx")) < half).length },
              away: { n: of("away").length, right: of("away").filter((p) => Number(p.getAttribute("cx")) > half).length },
              colours: colours.size,
            };
          });
          assert.deepEqual(got, { home: { n: 3, left: 3 }, away: { n: 2, right: 2 }, colours: 2 });
          return got;
        });

      await check("R4 the period choice, the first half alone", { periods: ["Match", "1re mi-temps", "2e mi-temps", "Tirs au but"], firstHalf: { points: 3 } },
        async () => {
          const card = panel(page).locator(".card", { has: page.locator(".card-title", { hasText: "Carte des tirs" }) });
          const choice = card.getByRole("group", { name: "Période des tirs" });
          const periods = (await choice.locator("button").allInnerTexts()).map((t) => t.trim());
          await choice.getByRole("button", { name: "1re mi-temps", exact: true }).click();
          const points = await card.locator('[data-chart="match-shot-map"] [data-side]').count();
          const got = { periods, firstHalf: { points } };
          await choice.getByRole("button", { name: "Match", exact: true }).click();
          assert.deepEqual(got, { periods: ["Match", "1re mi-temps", "2e mi-temps", "Tirs au but"], firstHalf: { points: 3 } });
          return got;
        });

      await check("R5 the shoot-out on the goal, a team choice", { kicks: 5, teams: ["Les deux", "Paris Saint-Germain", "Lorient"], lorient: 2 },
        async () => {
          const card = panel(page).locator(".card", { has: page.locator(".card-title", { hasText: "Carte des tirs" }) });
          await card.getByRole("group", { name: "Période des tirs" }).getByRole("button", { name: "Tirs au but", exact: true }).click();
          const goal = card.locator('[data-chart="goal-mouth"]');
          await goal.waitFor();
          const kicks = await goal.locator("[data-kick]").count();
          const teamChoice = card.getByRole("group", { name: "Équipe des tirs au but" });
          const teams = (await teamChoice.locator("button").allInnerTexts()).map((t) => t.trim());
          await teamChoice.getByRole("button", { name: "Lorient", exact: true }).click();
          const lorient = await goal.locator("[data-kick]").count();
          await page.screenshot({ path: join(out, "resume-tirs-au-but.png") });
          await teamChoice.getByRole("button", { name: "Les deux", exact: true }).click();
          await card.getByRole("group", { name: "Période des tirs" }).getByRole("button", { name: "Match", exact: true }).click();
          const got = { kicks, teams, lorient };
          assert.deepEqual(got, { kicks: 5, teams: ["Les deux", "Paris Saint-Germain", "Lorient"], lorient: 2 });
          return got;
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

      await check("R9 no list under the shot map, a label on each of the 5 marks", { list: 0, button: 0, labelled: 5 }, async () => {
        const card = panel(page).locator(".card", { has: page.locator(".card-title", { hasText: "Carte des tirs" }) });
        const got = {
          list: await card.locator("ol.match-shot-list").count(),
          button: await card.getByRole("button", { name: /(Voir|Masquer) les \d+ tirs?/ }).count(),
          labelled: await card.locator('[data-chart="match-shot-map"] [data-side][aria-label]').count(),
        };
        assert.deepEqual(got, { list: 0, button: 0, labelled: 5 });
        return got;
      });

      await check("R13 a blocked shot marked on target is drawn with no fill", { blocked: "0", saved: null }, async () => {
        const map = panel(page).locator('[data-chart="match-shot-map"]');
        const blocked = await map.locator('[data-side][aria-label*="Pablo Pagis"]').getAttribute("fill-opacity");
        assert.equal(blocked, "0");
        return { blocked };
      });

      await check("R14 « Meilleures notes » shows 8 players of the match's grades", { rows: 8, first: "Ousmane Dembélé" }, async () => {
        const card = panel(page).locator(".card", { has: page.locator(".card-title", { hasText: "Meilleures notes" }) });
        await card.locator(".match-player-row").nth(7).waitFor();
        const got = { rows: await card.locator(".match-player-row").count(), first: (await card.locator(".match-player-row .player-name").first().innerText()).trim() };
        assert.deepEqual(got, { rows: 8, first: "Ousmane Dembélé" });
        return got;
      });

      await check("R10 the best grades reach the foot of the shot map (1440 px)", { lastRowBelowPitch: true }, async () => {
        const grades = panel(page).locator(".card", { has: page.locator(".card-title", { hasText: "Meilleures notes" }) });
        const row = await grades.locator(".match-player-row").last().boundingBox();
        const pitch = await panel(page).locator('[data-chart="match-shot-map"]').boundingBox();
        await page.screenshot({ path: join(out, "resume-bureau-carte-et-notes.png"), fullPage: true });
        const got = { lastRowFoot: Math.round(row.y + row.height), pitchFoot: Math.round(pitch.y + pitch.height) };
        // The svg keeps a margin under the pitch's line: the rows must reach it within a row's padding.
        assert.ok(got.lastRowFoot >= got.pitchFoot - 16, JSON.stringify(got));
        return { lastRowBelowPitch: true, ...got };
      });

      await check("M6 « Tous les joueurs » opens Compositions, the board under the pitch (R6: no strip there)", { selected: "Compositions", view: "lineups", board: true, motm: null },
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
          assert.deepEqual(got, { selected: "Compositions", view: "lineups", board: true, motm: null });
          return got;
        });

      await check("R7 the search in the players' table", { demb: ["Ousmane Dembélé"], none: true }, async () => {
        const search = panel(page).getByRole("searchbox", { name: "Rechercher un joueur" });
        await search.fill("demb");
        await page.waitForTimeout(200);
        const demb = (await panel(page).locator("table.data-table tbody tr th button").allInnerTexts()).map((t) => t.trim());
        await search.fill("zzz");
        await page.waitForTimeout(200);
        const none = (await panel(page).getByText(/Aucun joueur ne correspond/).count()) > 0;
        await search.fill("");
        const got = { demb, none };
        assert.deepEqual(got, { demb: ["Ousmane Dembélé"], none: true });
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

      await check("R8 ten valued actions of twelve", { rows: 10 }, async () => {
        const card = panel(page).locator(".card", { hasText: "Les actions qui ont pesé le plus" });
        await card.waitFor();
        const rows = await card.locator("button").count();
        assert.equal(rows, 10);
        return { rows };
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

      await check("R11/R21/M8a « Classement »: the competition page's block, its table (the match's teams marked) and its projection; no table in Avant-match",
        { views: ["Classement", "Matchs", "Projection"], table: true, projection: 18, avantMatch: 0 }, async () => {
          await page.getByRole("tab", { name: "Classement" }).click();
          await page.waitForURL((url) => url.searchParams.get("view") === "standings");
          const views = panel(page).getByRole("group", { name: "Vue de la compétition" });
          await views.waitFor();
          // « Projection » appears once the season's projection is read: a miss stays a miss below.
          await views.getByRole("button", { name: "Projection", exact: true }).waitFor({ timeout: 30000 }).catch(() => {});
          const names = (await views.locator("button").allInnerTexts()).map((t) => t.trim());
          await panel(page).locator(".competition-standings table.standings-table").first().waitFor({ timeout: 30000 });
          await page.screenshot({ path: join(out, "classement-bureau.png"), fullPage: true });
          // R21 (§ 63.7): the match's two teams marked in the table, as the former card did.
          const marked = await panel(page).locator(".competition-standings tr[data-match-team]").count();
          assert.equal(marked, 2, "R21 rows marked: " + marked);
          await views.getByRole("button", { name: "Projection", exact: true }).click();
          await panel(page).locator("table.season-projection tbody tr").first().waitFor();
          const projection = await panel(page).locator("table.season-projection tbody tr").count();
          await page.screenshot({ path: join(out, "classement-projection-bureau.png"), fullPage: true });
          await page.getByRole("tab", { name: "Avant-match" }).click();
          await page.waitForURL((url) => url.searchParams.get("view") === "context");
          await page.waitForTimeout(1500);
          const avantMatch = await panel(page).locator(".match-standings-card, .competition-standings").count();
          await page.screenshot({ path: join(out, "avant-match-bureau.png"), fullPage: true });
          const got = { views: names.filter((n) => ["Classement", "Matchs", "Projection"].includes(n)), table: true, projection, avantMatch };
          assert.deepEqual(got, { views: ["Classement", "Matchs", "Projection"], table: true, projection: 18, avantMatch: 0 });
          return { ...got, allViews: names };
        });

      await check("M9 the former addresses", { shots: "Résumé", players: "Compositions", standings: "Classement", stats: "Statistiques" }, async () => {
        const got = {};
        for (const view of ["shots", "players", "standings", "stats"]) {
          await f.go(view);
          await settle(page);
          got[view] = await selected(page);
        }
        assert.deepEqual(got, { shots: "Résumé", players: "Compositions", standings: "Classement", stats: "Statistiques" });
        return got;
      });
      await check("R17 previous and next point at the neighbours and keep the view", { previous: ORDER[4], next: ORDER[6], view: "stats" }, async () => {
        const thread = page.locator('nav[aria-label="Matchs de la compétition"]');
        await thread.locator('a[aria-label^="Match précédent"]').waitFor();
        const hrefOf = async (label) => new URL(await thread.locator(`a[aria-label^="${label}"]`).getAttribute("href"), base).searchParams;
        const prev = await hrefOf("Match précédent"), next = await hrefOf("Match suivant");
        const got = { previous: prev.get("id"), next: next.get("id"), view: prev.get("view") === "stats" && next.get("view") === "stats" ? "stats" : null };
        assert.deepEqual(got, { previous: ORDER[4], next: ORDER[6], view: "stats" });
        return got;
      });
      run.pageErrors = [...run.errors];
    } finally {
      await f.close();
    }
  }

  // ------------------------------------------------------------------ no forecast, no momentum
  {
    const f = await setup("xg-only", desktop, { forecast: false, momentum: false, crests: false });
    try {
      await f.go();
      await settle(f.page, "Le match minute par minute");
      await check("R26 crests that cannot be read: blue and violet", { home: "#7fb0ff", away: "#b9a8f0" }, async () => {
        await f.page.waitForTimeout(1500);
        const got = await teamColours(f.page);
        assert.deepEqual({ home: got.home, away: got.away }, { home: "#7fb0ff", away: "#b9a8f0" });
        return got;
      });
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
      await f.go("standings");
      await settle(f.page);
      // Nothing lost: the former « Classement » tab showed the competition's table for every match.
      await check("M8b a final: the competition's table in « Classement »", { table: 1 }, async () => {
        await panel(f.page).locator(".competition-standings table.standings-table").first().waitFor({ timeout: 30000 });
        const n = await panel(f.page).locator(".competition-standings").count();
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
      await check("M10/R1 before kick-off: three tabs, « Avant-match » for view=stats, no game family read",
        { tabs: ["Avant-match", "Compositions", "Classement"], selected: "Avant-match", gameReads: [] }, async () => {
          await f.page.waitForTimeout(1500);
          const gameReads = f.run.requests.filter((u) => u.startsWith(api + "/") && !/^\/(summary|lineups(?:\/probable)?)(?:\?|$)/.test(u.slice(api.length)));
          const got = { tabs: await tabNames(f.page), selected: await selected(f.page), gameReads };
          await f.page.screenshot({ path: join(out, "avant-coup-envoi-bureau.png") });
          assert.deepEqual(got, { tabs: ["Avant-match", "Compositions", "Classement"], selected: "Avant-match", gameReads: [] });
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
      await check("M11/R19 phone: no sideways scroll on Résumé and Compositions, the current tile visible", { resume: 0, lineups: 0 }, async () => {
        await f.go();
        await settle(f.page, "Le match minute par minute");
        const resume = await sideways(f.page);
        await f.page.screenshot({ path: join(out, "resume-telephone.png"), fullPage: true });
        // R19 (§ 63.6): the head on a phone, the current tile visible.
        const tile = f.page.locator('nav[aria-label="Matchs de la compétition"] [aria-current="page"]');
        await tile.waitFor();
        const box = await tile.boundingBox();
        await f.page.locator(".match-head").screenshot({ path: join(out, "haut-de-page-telephone.png") });
        assert.ok(box && box.x >= 0 && box.x + box.width <= 393 + 1, "R19 current tile " + JSON.stringify(box));
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
