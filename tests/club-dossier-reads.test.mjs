// GH138 (docs/calculs/09-audit-2026-11/FAILURE_MODES_OPTIMISATIONS.md, written before the change): the club dossier
// reads its season's history once per page, the shots and the appearances together, and builds the dossier the two
// separate reads gave. club-scout.js and compact-reads.js run with their real code; React and the football context are
// stubbed, and the network is answered as /api/read/club answers (backend/api/src/routes/actors.mjs): the club's
// fixtures newest first, a page of `limit`, a record for each match with its details, its shot list with `shots`, the
// club's appearances (and their ids on each record) with `appearances`, the club's version fencing the next pages.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url)),
  requireLocal = createRequire(path.join(root, "dashboard/package.json")),
  React = requireLocal("react"),
  { renderToStaticMarkup } = requireLocal("react-dom/server"),
  babel = requireLocal("next/dist/compiled/babel/core"),
  preset = requireLocal("next/dist/compiled/babel/preset-react"),
  commonjs = requireLocal("next/dist/compiled/babel/plugin-transform-modules-commonjs");
const SERVICES = path.join(root, "dashboard/frontend/src/services");

const SEASON = "2026/2027",
  GENERATION = "25853209",
  VERSION = "2bd28f172ffef736",
  LEAGUE_VERSION = "0123456789abcdef";
const CLUB = "t_club01";
const LEAGUE = { id: "l_league", name: "Championnat", country: "FRA" };
const CUP = { id: "l_cup001", name: "Coupe d'Europe", country: "UEFA" };
const OPPONENTS = Array.from({ length: 19 }, (_, i) => `t_opp${String(i + 1).padStart(3, "0")}`);
const NAMES = Object.fromEntries([[CLUB, "Club Un"], ...OPPONENTS.map((id, i) => [id, `Adversaire ${i + 1}`])]);
const DAY = 86_400_000,
  NOW = Date.now();
const date = (offset) => new Date(NOW + offset * DAY).toISOString().slice(0, 10);
const MANIFEST = (versioned) => ({
  storage: "aws-relational",
  publicationVersion: GENERATION,
  defaultSeason: SEASON,
  seasons: [{ id: SEASON }],
  capabilities: {
    compactReads: { club: true, clubs: true, league: true },
    playedLeague: true,
    versionedReads: versioned ? { club: true, league: true } : {},
  },
});

/**
 * A club's season: `coming` fixtures to come (the furthest first, three days apart), then `played` finished ones (the
 * latest first); every fourth is a cup match. Among the finished ones, counted from the latest: `bare` have no details
 * (a fixture and its score, no record), `blank` have their details but neither team statistics nor shots.
 */
function clubSeason({ coming, played, bare = [], blank = [] }) {
  const fixtures = [];
  for (let n = 1; n <= coming + played; n++) {
    const finished = n > coming,
      rank = finished ? n - coming : coming - n + 1,
      opponent = OPPONENTS[n % OPPONENTS.length],
      home = n % 2 ? CLUB : opponent,
      away = home === CLUB ? opponent : CLUB,
      id = `m_a${String(n).padStart(5, "0")}`,
      league = n % 4 === 0 ? CUP : LEAGUE,
      detailed = finished && !bare.includes(rank),
      empty = blank.includes(rank),
      score = finished ? [n % 3, (n * 7) % 4 === 0 ? 1 : 0] : null,
      day = date(finished ? -3 * rank : 3 * rank);
    const shots = !detailed || empty ? [] : shotList(id, home, away, score);
    fixtures.push({
      id, home, away, league, day, status: finished ? "finished" : "not_started", score, detailed, round: n,
      stats: !detailed || empty ? [] : statList(n),
      shots,
      appearances: detailed ? squad(id, league.id, day) : [],
      // A match to come's forecast as the club read gives it after GH139 (`forecasts`), none for every fifth.
      forecast: finished || n % 5 === 0 ? null : { home: 0.4 + n / 1000, draw: 0.25, away: 0.35 - n / 1000 },
    });
  }
  return fixtures;
}
function statList(n) {
  const pair = (key, home, away) => ({ key, home, away });
  return [
    pair("expected_goals", 1 + (n % 5) / 10, 0.6 + (n % 3) / 10),
    pair("expected_goals_non_penalty", 1 + (n % 5) / 10, 0.6 + (n % 3) / 10),
    pair("total_shots", 12 + (n % 4), 8 + (n % 3)),
    pair("ShotsOnTarget", 5, 3),
    pair("BallPossesion", 55, 45),
    pair("passes", 520, 410),
    pair("accurate_passes", 460, 340),
    pair("opposition_half_passes", 260, 160),
    pair("own_half_passes", 200, 180),
    pair("touches_opp_box", 28, 14),
    pair("duel_won", 52, 47),
    pair("corners", 6, 3),
  ];
}
function shotList(id, home, away, [hs, as]) {
  const shot = (teamId, k, goal) => ({
    id: `${id}:${teamId}:${k}`, teamId, minute: 5 + k * 7, isGoal: goal, isOwnGoal: false, situation: k % 3 ? "regular_play" : "set_piece",
    xg: 0.05 + (k % 4) / 20, x: 80 + (k % 10), y: 30 + (k % 20), isOnTarget: goal || k % 2 === 0,
  });
  return [
    ...Array.from({ length: 9 }, (_, k) => shot(home, k, k < hs)),
    ...Array.from({ length: 6 }, (_, k) => shot(away, k, k < as)),
  ];
}
/** The club's sheet of a match: eleven starters, three substitutes on, two who stayed on the bench. */
function squad(matchId, leagueId, day) {
  return Array.from({ length: 16 }, (_, k) => {
    const playerId = `p_club${String(k + 1).padStart(2, "0")}`;
    return {
      id: `${matchId}:${playerId}`, playerId, teamId: CLUB, matchId, leagueId, date: day, name: `Joueur ${k + 1}`, imageUrl: null,
      positionId: k === 0 ? 11 : k < 5 ? 1 : k < 9 ? 82 : 3, starter: k < 11, minutes: k < 11 ? 90 - (k > 8 ? 25 : 0) : k < 14 ? 25 : 0,
      goals: k === 9 ? 1 : 0, assists: k === 7 ? 1 : 0, xg: k > 8 ? 0.3 : 0.02, xa: k > 5 ? 0.1 : 0, shots: k > 8 ? 2 : 0, grade: k < 14 ? 6.5 + (k % 4) / 4 : null,
      statsReliable: true,
    };
  });
}

/* ------------------------------------------------------------------ the read API */

const fixtureRow = (f) => ({
  id: f.id, season: SEASON, date: f.day, time_utc: `${f.day}T19:00:00Z`, status: f.status, round_name: String(f.round), has_playoff: false,
  home_team: { id: f.home, name: NAMES[f.home], image_url: null }, away_team: { id: f.away, name: NAMES[f.away], image_url: null },
  league: { id: f.league.id, name: f.league.name, image_url: null },
  score_home: f.score?.[0] ?? null, score_away: f.score?.[1] ?? null, score_penalty_home: null, score_penalty_away: null,
});
function record(f, { shots, players, summary }) {
  const side = (name, i) => ({
    id: f[name], name: NAMES[f[name]], imageUrl: null, formation: f[name] === CLUB ? "4-3-3" : "4-4-2", coach: f[name] === CLUB ? "Entraîneur Un" : null,
    score: f.score[i], xg: f.stats[0]?.[name] ?? null, shots: f.stats[2]?.[name] ?? null, shotsOnTarget: null, possession: null, lineupConfirmed: true,
    ownGoalsFor: 0, penaltyAttempts: 0,
  });
  return {
    id: f.id, season: SEASON, leagueId: f.league.id, league: f.league.name, country: f.league.country, date: f.day, timeUtc: `${f.day}T19:00:00Z`,
    status: "finished", roundName: String(f.round), hasPlayoff: false, referee: null, stadium: f.home === CLUB ? "Stade du Club" : null,
    home: side("home", 0), away: side("away", 1),
    shots: shots ? f.shots : [],
    stats: f.stats,
    coverage: summary
      ? { teamStatsReliable: f.stats.length > 0 }
      : { players: true, playerStats: true, grades: true, xg: true, xa: true, shots: f.shots.length > 0, teamStatsReliable: f.stats.length > 0,
          listedPlayers: 16, playedPlayers: 14, gradedPlayers: 14, xgPlayers: 14, xaPlayers: 14 },
    warnings: [], warningCodes: [], detailCollected: true,
    players: players ? f.appearances.map((a) => a.id) : [],
  };
}
const newestFirst = (a, b) => b.day.localeCompare(a.day) || b.id.localeCompare(a.id);
const CLUB_PARAMS = ["season", "leagues", "league", "generation", "v", "team", "page", "limit", "include", "detail"];

/** /api/read/club, /api/read/clubs and /api/read/league over `fixtures`; every request is logged. `forecasts`: the club
 * read's matches to come carry their forecast (GH139). */
function readApi(fixtures, { combinedTooLargePage, forecasts = false } = {}) {
  const log = [], refused = [];
  const answer = (u) => {
    const q = u.searchParams,
      page = Number(q.get("page") || 1),
      versioned = !q.has("generation");
    const refuse = (status, message) => {
      throw Object.assign(new Error(message), { status });
    };
    if (q.has("generation") && q.get("generation") !== GENERATION) refuse(409, "publication");
    const slice = (rows, limit) => rows.slice((page - 1) * limit, page * limit);
    const paginate = (total, limit, version) => ({
      meta: { generation: GENERATION, ...(versioned && version ? { version } : {}) },
      pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)), generation: GENERATION },
    });
    if (u.pathname === "/api/read/clubs") {
      const clubs = [CLUB, ...OPPONENTS].map((id) => ({ id, name: NAMES[id], imageUrl: null, country: "FRA" }));
      return { data: { clubs: slice(clubs, Number(q.get("limit"))) }, ...paginate(clubs.length, Number(q.get("limit"))) };
    }
    if (u.pathname === "/api/read/league") {
      if (q.get("league") !== LEAGUE.id || q.get("detail") !== "summary") refuse(400, "league scope");
      if (versioned && q.has("v") && q.get("v") !== LEAGUE_VERSION) refuse(409, "version");
      const rows = fixtures.filter((f) => f.league.id === LEAGUE.id && (q.get("played") !== "1" || f.status === "finished")).sort(newestFirst),
        limit = Number(q.get("limit")),
        shown = slice(rows, limit);
      return {
        data: { meta: {}, metrics: [], competitions: [], teams: [], appearances: [], fixtures: shown.map(fixtureRow),
          matches: shown.filter((f) => f.detailed).map((f) => record(f, { summary: true })) },
        ...paginate(rows.length, limit, LEAGUE_VERSION),
      };
    }
    if (u.pathname !== "/api/read/club") refuse(404, "route");
    if ([...q.keys()].some((key) => !CLUB_PARAMS.includes(key))) refuse(400, "parameter");
    const includes = new Set((q.get("include") || "").split(",").filter(Boolean));
    if ([...includes].some((value) => !["appearances", "shots"].includes(value))) refuse(400, "include");
    if (q.get("team") !== CLUB || q.get("season") !== SEASON || q.get("leagues") !== "all") refuse(400, "scope");
    if (versioned && q.has("v") && q.get("v") !== VERSION) refuse(409, "version");
    const limit = Number(q.get("limit") || 25);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) refuse(400, "limit");
    const shown = slice([...fixtures].sort(newestFirst), limit),
      appearances = includes.has("appearances") ? shown.flatMap((f) => f.appearances) : [];
    const context = [...new Set(shown.flatMap((f) => [f.home, f.away]))].sort();
    return {
      data: {
        meta: { storage: "aws-relational", currentSeason: SEASON, shotsLoaded: includes.has("shots"), appearancesLoaded: includes.has("appearances"),
          actor: { kind: "club", id: CLUB }, detail: q.get("detail") || "full", notes: [] },
        metrics: [],
        competitions: [...new Map(shown.map((f) => [f.league.id, f.league])).values()]
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((c) => ({ id: c.id, name: c.name, country: c.country, providerCountry: c.country, imageUrl: null, seasons: [] })),
        teams: context.map((id) => ({ id, name: NAMES[id], imageUrl: null, country: "FRA", leagueIds: [LEAGUE.id], sampleMatches: 1, seasons: [SEASON] })),
        fixtures: shown.map((f) => ({ ...fixtureRow(f), ...(forecasts && f.status === "not_started" && { forecast: f.forecast }) })),
        matches: shown.filter((f) => f.detailed).map((f) => record(f, { shots: includes.has("shots"), players: includes.has("appearances") })),
        appearances,
      },
      ...paginate(fixtures.length, limit, VERSION),
    };
  };
  return {
    log,
    refused,
    fetch: async (url) => {
      const u = new URL(url, "https://api.test");
      log.push({ path: u.pathname, query: Object.fromEntries(u.searchParams) });
      if (
        u.pathname === "/api/read/club" &&
        u.searchParams.get("include") === "appearances,shots" &&
        u.searchParams.get("page") === combinedTooLargePage
      ) {
        return Response.json(
          { error: { code: "PAGE_TOO_LARGE", message: "Réduisez la taille de page." } },
          { status: 413 },
        );
      }
      try {
        return Response.json(answer(u));
      } catch (error) {
        refused.push(`${u.pathname}?${u.searchParams}: ${error.message}`);
        return Response.json({ ok: false, error: { message: error.message } }, { status: error.status || 500 });
      }
    },
  };
}

/* ------------------------------------------------------------------ the site's modules */

/** club-scout.js and compact-reads.js with their real code: the football context gives `context`, the network is `api`. */
function loadSite(api, context) {
  const network = { publicApiFetch: (url) => api.fetch(url), wasPublicApiThrottle: () => false };
  const stubs = {
    "club-scout.js": { react: React, "../hooks/FootballContext.jsx": { useFootball: () => context }, "./public-api-fetch.js": network },
    "compact-reads.js": { "./public-api-fetch.js": network },
  };
  const cache = new Map();
  const load = (file) => {
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} };
    cache.set(file, mod);
    const code = babel.transformSync(fs.readFileSync(file, "utf8"), {
      presets: [[preset, { runtime: "classic" }]], plugins: [commonjs], babelrc: false, configFile: false, filename: file,
    }).code;
    const own = stubs[path.basename(file)] || {};
    vm.runInThisContext("(function(require,module,exports,process){" + code + "\n})", { filename: file })(
      (name) => {
        if (name in own) return own[name];
        if (name === "react") return React;
        if (!name.startsWith(".")) return requireLocal(name);
        return load(path.resolve(path.dirname(file), name));
      },
      mod, mod.exports, process,
    );
    return mod.exports;
  };
  return { scout: load(path.join(SERVICES, "club-scout.js")), compact: load(path.join(SERVICES, "compact-reads.js")) };
}

/** The dossier the page gets: started as the data provider starts it, then read by the profile's hook. */
async function pageDossier(scout, api, context) {
  scout.startClubDossier(CLUB, context);
  let state;
  const Probe = () => {
    state = scout.useClubDossier(CLUB);
    return null;
  };
  for (let tick = 0; tick < 2000; tick++) {
    renderToStaticMarkup(React.createElement(Probe));
    if (state.status === "ready") return state.dossier;
    assert.deepEqual(api.refused, [], "a read the API refused");
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.fail(`the dossier never came: ${JSON.stringify(state)}`);
}

/** The club's history reads: its own reads that name an `include`. */
const historyReads = (log) => log.filter((r) => r.path === "/api/read/club" && r.query.include !== undefined);

/** Every read's rows once, by id (club-scout.js `merge`). */
const merged = (pages) =>
  Object.fromEntries(
    ["matches", "fixtures", "appearances", "teams", "competitions"].map((name) => [
      name,
      [...new Map(pages.flatMap((page) => page[name] || []).map((row) => [row.id, row])).values()],
    ]),
  );

/**
 * What the dossier was built from before GH138: the shots and the appearances read each on its own, with the same
 * parameters, then put together as club-scout.js's loadDossier did (the fixtures of both, the records of the shots read).
 */
async function separateReads({ compact }, versioned) {
  const base = { season: SEASON, team: CLUB, leagues: "all", generation: GENERATION, ...(versioned ? { versioned: 1 } : {}) };
  const [shots, apps] = await Promise.all(
    ["shots", "appearances"].map(async (include) => merged((await compact.readCompactPages("club", { ...base, include }, { parallelPages: true })).pages)),
  );
  return { matches: shots.matches, fixtures: [...shots.fixtures, ...apps.fixtures], appearances: apps.appearances, teams: shots.teams, competitions: shots.competitions };
}

/** A dossier as the page shows it: every field but its raw read (`data`) and the records' appearance ids (`players`). */
function shown(dossier) {
  return JSON.parse(
    JSON.stringify(dossier, function (key, value) {
      if (this === dossier && key === "data") return undefined;
      if (key === "players" && Array.isArray(value) && /^m_/.test(String(this?.id)) && this.home && this.away) return undefined;
      return value;
    }),
  );
}

const ids = (rows) => rows.map((row) => row.id);
const earliestToCome = (fixtures, count) =>
  ids(fixtures.filter((f) => f.status === "not_started").sort((a, b) => a.day.localeCompare(b.day)).slice(0, count));

/* ------------------------------------------------------------------ cases */

test("GH138-a/b: 42 fixtures, two pages: one read per page with both families, the dossier the separate reads gave", async () => {
  // 26 to come, then 16 finished: the 5th latest without its details, the 9th without statistics or shots.
  const fixtures = clubSeason({ coming: 26, played: 16, bare: [5], blank: [9] });
  const api = readApi(fixtures),
    context = { manifest: MANIFEST(true), season: SEASON },
    site = loadSite(api, context);
  const dossier = await pageDossier(site.scout, api, context);
  const reads = historyReads(api.log);
  assert.deepEqual(
    reads.map((r) => r.query),
    [
      { include: "appearances,shots", leagues: "all", limit: "25", page: "1", season: SEASON, team: CLUB },
      { include: "appearances,shots", leagues: "all", limit: "25", page: "2", season: SEASON, team: CLUB, v: VERSION },
    ],
    "the history read once per page, the shots and the appearances together (four reads before: two per family)",
  );

  // GH138-b: the same dossier, figure for figure, as the separate reads gave.
  const before = await separateReads(site, true);
  const { competitions, league } = site.scout.clubLeagues(before, CLUB);
  const cohort = await site.scout.leagueCohort(league, { season: SEASON, generation: GENERATION, whole: true, played: true, versioned: { club: true, league: true } }).promise;
  assert.deepEqual(shown(dossier), shown(site.scout.buildDossier({ id: CLUB, season: SEASON, data: before, competitions, league, cohort })));

  // What it holds: each fixture once; the next six matches in order; both competitions; 16 played, 15 analysed.
  assert.equal(dossier.data.fixtures.length, 42);
  assert.equal(new Set(ids(dossier.data.fixtures)).size, 42);
  assert.deepEqual(ids(dossier.upcoming), earliestToCome(fixtures, 6));
  const count = (league, status) => fixtures.filter((f) => f.league.id === league && (!status || f.status === status)).length;
  assert.deepEqual(
    dossier.competitions.map((c) => [c.id, c.matches, c.finished]),
    [[LEAGUE.id, count(LEAGUE.id), count(LEAGUE.id, "finished")], [CUP.id, count(CUP.id), count(CUP.id, "finished")]],
  );
  assert.deepEqual(dossier.coverage, { played: 16, analysed: 15, empty: false });
  // The finished match without its details: played, but no row, record, shot or appearance.
  const bare = fixtures.find((f) => f.status === "finished" && !f.detailed);
  assert.ok(dossier.summary.games.some((m) => m.id === bare.id && m.status === "finished"));
  assert.ok(!dossier.allRows.some((row) => row.match.id === bare.id));
  assert.ok(!dossier.data.matches.some((m) => m.id === bare.id));
  assert.ok(!dossier.data.appearances.some((a) => a.matchId === bare.id));
  // The match without statistics or shots: a row with unknown statistics.
  const blank = fixtures.find((f) => f.detailed && !f.stats.length);
  assert.deepEqual(dossier.allRows.filter((row) => row.match.id === blank.id).map((row) => [row.own, row.opp]), [[null, null]]);
  assert.equal(dossier.shotsAll.matches, 14);
  // A match to come: no row, no statistic.
  const coming = new Set(ids(fixtures.filter((f) => f.status === "not_started")));
  assert.ok(!dossier.allRows.some((row) => coming.has(row.match.id)));
  assert.ok(dossier.summary.games.filter((m) => coming.has(m.id)).every((m) => !m.stats?.length && !m.shots?.length));
  assert.equal(dossier.squad.profiles.length, 16);
});

test("GH138-c: 60 fixtures, the first two pages to come only: three reads, every page and fixture", async () => {
  const fixtures = clubSeason({ coming: 50, played: 10 });
  const api = readApi(fixtures),
    context = { manifest: MANIFEST(true), season: SEASON },
    site = loadSite(api, context);
  const dossier = await pageDossier(site.scout, api, context);
  const reads = historyReads(api.log);
  assert.deepEqual(reads.map((r) => [r.query.include, r.query.limit, r.query.page, r.query.v]), [
    ["appearances,shots", "25", "1", undefined],
    ["appearances,shots", "25", "2", VERSION],
    ["appearances,shots", "25", "3", VERSION],
  ]);
  assert.equal(new Set(ids(dossier.data.fixtures)).size, 60);
  assert.deepEqual(ids(dossier.upcoming), earliestToCome(fixtures, 6));
  assert.deepEqual(dossier.coverage, { played: 10, analysed: 10, empty: false });
  assert.equal(dossier.data.appearances.length, 10 * 16);
});

test("GH138-d: a club with matches to come only, read pinned to the publication", async () => {
  const fixtures = clubSeason({ coming: 30, played: 0 });
  const api = readApi(fixtures),
    context = { manifest: MANIFEST(false), season: SEASON },
    site = loadSite(api, context);
  const dossier = await pageDossier(site.scout, api, context);
  const reads = historyReads(api.log);
  assert.deepEqual(reads.map((r) => [r.query.include, r.query.page, r.query.generation, r.query.v]), [
    ["appearances,shots", "1", GENERATION, undefined],
    ["appearances,shots", "2", GENERATION, undefined],
  ]);
  assert.deepEqual(dossier.coverage, { played: 0, analysed: 0, empty: true });
  assert.deepEqual(ids(dossier.upcoming), earliestToCome(fixtures, 6));
  assert.deepEqual(dossier.competitions.map((c) => [c.id, c.finished]), [[LEAGUE.id, 0], [CUP.id, 0]]);
  assert.deepEqual([dossier.allRows.length, dossier.data.matches.length, dossier.data.appearances.length], [0, 0, 0]);
  assert.equal(new Set(ids(dossier.data.fixtures)).size, 30);
});

test("GH138-e: an oversized combined page reloads both complete reads", async () => {
  const fixtures = clubSeason({ coming: 26, played: 16 });
  const api = readApi(fixtures, { combinedTooLargePage: "2" });
  const context = { manifest: MANIFEST(true), season: SEASON };
  const site = loadSite(api, context);
  const dossier = await pageDossier(site.scout, api, context);
  const query = historyReads(api.log).map((r) => r.query);
  assert.deepEqual(query.slice(0, 2).map((q) => [q.include, q.page, q.v]), [
    ["appearances,shots", "1", undefined],
    ["appearances,shots", "2", VERSION],
  ]);
  for (const include of ["shots", "appearances"]) {
    assert.deepEqual(
      query.filter((q) => q.include === include).map((q) => [q.page, q.v]),
      [["1", undefined], ["2", VERSION]],
    );
  }
  assert.equal(query.length, 6);
  assert.deepEqual(dossier.coverage, { played: 16, analysed: 16, empty: false });
  assert.deepEqual(ids(dossier.upcoming), earliestToCome(fixtures, 6));
  assert.equal(dossier.data.appearances.length, 16 * 16);
});

// GH139-j: holds before GH139's change; it pins what « Prochains matchs » relies on (FAILURE_MODES_OPTIMISATIONS.md).
test("GH139-j: the next six matches keep the club read's forecasts, in the 413 fallback too", async () => {
  for (const combinedTooLargePage of [undefined, "2"]) {
    const fixtures = clubSeason({ coming: 26, played: 16 });
    const api = readApi(fixtures, { combinedTooLargePage, forecasts: true }),
      context = { manifest: MANIFEST(true), season: SEASON },
      site = loadSite(api, context);
    const dossier = await pageDossier(site.scout, api, context);
    const given = new Map(fixtures.map((f) => [f.id, f.forecast]));
    assert.deepEqual(dossier.upcoming.map((m) => [m.id, m.forecast]), earliestToCome(fixtures, 6).map((id) => [id, given.get(id)]));
    assert.ok(dossier.upcoming.some((m) => m.forecast === null) && dossier.upcoming.some((m) => m.forecast?.draw === 0.25));
  }
});
