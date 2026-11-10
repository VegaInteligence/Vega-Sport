// Contract tests of the read API against a seeded local database (test/seed.py).
// Shapes are the current API's (main); values are recomputed by hand from the seed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { context, get, skip } from "./context.mjs";

const clubs = "/api/read/clubs?season=2025/2026&leagues=all";
// The keys of a club record in the previous backend's relational-clubs.js (main), plus
// the power ranking of the season.
const DIRECTORY_KEYS = ["competitionCounts", "count", "country", "id", "imageUrl", "league", "name", "power"];
const ANALYSIS_KEYS = [
  ...DIRECTORY_KEYS, "away", "cleanSheets", "draws", "excludedStats", "formations", "forms", "games",
  "goalTimes", "goalsAgainst", "goalsFor", "home", "losses", "matches", "points", "shots", "stats", "unscored", "wins",
].sort();

test("club directory: envelope, order, facets", { skip }, async () => {
  const { response, body } = await get(clubs);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("etag"), /^W\/"compact-v2-/);
  assert.deepEqual(Object.keys(body).sort(), ["data", "meta", "pagination"]);
  assert.deepEqual(body.data.clubs.map((c) => c.id), ["t_aaaaa1", "t_aaaaa2", "t_aaaaa3", "t_aaaaa4"]);
  assert.deepEqual(Object.keys(body.data.clubs[0]).sort(), DIRECTORY_KEYS);
  const { power, ...club } = body.data.clubs[0];
  assert.deepEqual(club, {
    id: "t_aaaaa1", name: "Olympique Été", imageUrl: "https://img.example/t1.png", league: "Ligue 1",
    country: "FRA", count: 3, competitionCounts: { l_3FJFUl: 3 },
  });
  // The club power ranking (Elo after its last match of the season): moved points only.
  assert.deepEqual(Object.keys(power).sort(), ["draws", "elo", "eloChange", "eloLow", "eloPeak", "eloStart", "expectedResults", "losses", "matches", "rank", "results", "wins"]);
  assert.equal(power.matches, 3);
  // t_aaaaa1: won 2–0, lost 0–1, drew 0–0.
  assert.deepEqual([power.wins, power.draws, power.losses, power.results, power.eloStart], [1, 1, 1, 1.5, 1500]);
  assert.ok(power.eloPeak >= power.elo && power.elo >= power.eloLow);
  assert.equal(Math.round(body.data.clubs.reduce((sum, c) => sum + c.power.elo, 0)), 6000);
  assert.deepEqual(body.data.clubs.map((c) => c.power.rank).sort(), [1, 2, 3, 4]);
  // No team country: the domestic league's country.
  assert.equal(body.data.clubs[2].country, "FRA");
  assert.deepEqual(body.data.facets, { countries: ["FRA"], competitionIds: ["l_3FJFUl"] });
  assert.deepEqual(body.meta, {
    generation: "7", publishedAt: "2025-09-20T11:00:00.000Z", sourceRetrievedAt: "2025-09-20T10:00:00.000Z",
    latestSourceRetrievedAt: "2025-09-20T10:00:00.000Z", startDate: "2025-09-01", endDate: "2025-09-06",
    partitionCount: 1, missingWatermarks: 0,
  });
  assert.deepEqual(body.pagination, { page: 1, limit: 24, total: 4, pages: 1, generation: "7" });
});

test("club analysis: records, statistics, forms, formations, goal times", { skip }, async () => {
  const { body } = await get(clubs + "&analysis=1&sort=points&direction=desc");
  const ids = body.data.clubs.map((c) => c.id);
  assert.deepEqual(ids, ["t_aaaaa1", "t_aaaaa3", "t_aaaaa2", "t_aaaaa4"]);
  const t1 = body.data.clubs[0];
  assert.deepEqual(Object.keys(t1).sort(), ANALYSIS_KEYS);
  assert.deepEqual(
    [t1.matches, t1.wins, t1.draws, t1.losses, t1.points, t1.goalsFor, t1.goalsAgainst, t1.cleanSheets],
    [3, 1, 1, 1, 4, 2, 1, 2],
  );
  assert.deepEqual(t1.home, { matches: 2, wins: 1, draws: 0, losses: 1, points: 3, goalsFor: 2, goalsAgainst: 1, cleanSheets: 1 });
  assert.deepEqual(t1.stats.xgFor, { sum: 2.25, count: 3 });
  assert.deepEqual(t1.stats.possession, { sum: 138, count: 3 });
  assert.equal(t1.stats.corners, undefined); // never observed: omitted, as today
  assert.deepEqual(t1.formations, [["4-3-3", 2], ["4-4-2", 1]]);
  // As main, from the shot map: only match 1 has one (its two goals); the goal conceded in
  // match 3 has no shot, so it is not observed.
  assert.deepEqual(t1.goalTimes, { for: [1, 1, 0, 0, 0, 0], against: [0, 0, 0, 0, 0, 0], observed: 2 });
  assert.equal(t1.forms.length, 3);
  assert.deepEqual(t1.forms[0], {
    match: {
      id: "m_aaaaa5", season: "2025/2026", leagueId: "l_3FJFUl", league: "Ligue 1", date: "2025-09-05",
      timeUtc: "2025-09-05T19:00:00Z", status: "finished",
      home: { id: "t_aaaaa4", name: "Union Sud", score: 0, formation: "4-3-3" },
      away: { id: "t_aaaaa1", name: "Olympique Été", score: 0, formation: "4-4-2" },
    },
    result: "N", scoreFor: 0, scoreAgainst: 0, side: "away",
  });
  const t2 = body.data.clubs[2];
  assert.equal(t2.unscored, 0);
  assert.equal(t2.count, 3); // the upcoming match counts in the directory, not in the record
  assert.equal(t2.matches, 2);
});

test("accent-insensitive search, country and competition filters", { skip }, async () => {
  const { body } = await get(clubs + "&q=ete");
  assert.deepEqual(body.data.clubs.map((c) => c.id), ["t_aaaaa1"]);
  const none = await get(clubs + "&competition=l_zzzzzz");
  assert.equal(none.body.pagination.total, 0);
});

test("errors: stable codes and retry advice", { skip }, async () => {
  const bad = await get(clubs + "&unknown=1");
  assert.equal(bad.response.status, 400);
  assert.deepEqual(bad.body.error, { code: "INVALID_PARAMETER", message: "Paramètres invalides.", retry: false });
  const changed = await get(clubs + "&generation=6");
  assert.equal(changed.response.status, 409);
  assert.equal(changed.body.error.code, "PUBLICATION_CHANGED");
  assert.equal(changed.body.error.retry, true);
  const missing = await get("/api/read/nothing");
  assert.equal(missing.response.status, 404);
  assert.equal(missing.body.error.code, "RESOURCE_NOT_FOUND");
  const season = await get("/api/read/clubs?season=bad");
  assert.equal(season.response.status, 400);
});

test("media=1 maps image URLs to their copies", { skip }, async () => {
  const { response, body } = await get(clubs + "&media=1");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("etag"), /^W\/"media-v1-/);
  assert.deepEqual(body.media, { "https://img.example/t1.png": "https://media.test/data/sources/v2/images/" + "ab".repeat(32) + ".png" });
  const again = await get(clubs + "&media=1", { "if-none-match": response.headers.get("etag") });
  assert.equal(again.response.status, 304);
  // Not a compact read: no map, as on main.
  assert.equal((await get("/api/dashboard/manifest?media=1")).response.status, 400);
});

test("a database failure answers DATA_UNAVAILABLE, never the database's code", { skip }, async () => {
  const { createHandler } = await import("../src/handler.mjs");
  const failing = createHandler({ read: async () => { throw Object.assign(new Error("boom"), { code: "42P18" }); } });
  const response = await failing(new Request("https://api.test" + clubs));
  assert.equal(response.status, 503);
  assert.deepEqual((await response.json()).error, { code: "DATA_UNAVAILABLE", message: "Données indisponibles.", retry: true });
});

test("conditional reads answer 304 without the payload query", { skip }, async () => {
  const first = await get(clubs);
  const again = await get(clubs, { "if-none-match": first.response.headers.get("etag") });
  assert.equal(again.response.status, 304);
});

test("the read role cannot reach core, agg or ops", { skip }, async () => {
  await assert.rejects(context.reader.read("SELECT 1 FROM core.matches"), /permission denied/);
  await assert.rejects(context.reader.read("SELECT 1 FROM agg.team_season_stats"), /permission denied/);
  await assert.rejects(context.reader.read("INSERT INTO api.publication VALUES (1, now())"), /read-only|permission denied|cannot insert/);
});

test("manifest, health and status", { skip }, async () => {
  const { response, body } = await get("/api/dashboard/manifest");
  assert.equal(response.status, 200);
  assert.equal(body.publicationVersion, "7");
  assert.equal(body.defaultSeason, "2025/2026");
  assert.equal(body.capabilities.compactReads.clubs, true);
  const chunk = body.seasons[0].chunks[0];
  assert.equal(chunk.leagueId, "l_3FJFUl");
  assert.deepEqual(
    [chunk.meta.matchCount, chunk.meta.expectedFinishedMatches, chunk.meta.collectedMatches, chunk.meta.teamCount],
    [6, 5, 5, 4],
  );
  assert.deepEqual(body.competitions, [
    { id: "l_3FJFUl", name: "Ligue 1", country: "FRA", providerCountry: "FRA", imageUrl: "https://img.example/l1.png", seasons: ["2025/2026"] },
  ]);
  assert.deepEqual(body.clubCountries, { t_aaaaa1: "FRA", t_aaaaa2: "FRA", t_aaaaa4: "FRA" });
  const health = await get("/api/health");
  assert.deepEqual(health.body, { source: "AWS", status: "ok", revision: "7" });
  assert.equal((await get("/api/status")).body.schema, "v2");
});

test("the default season is the latest one already started", async () => {
  const { defaultSeason } = await import("../src/routes/system.mjs");
  const season = (...starts) => ({ chunks: starts.map((startDate) => ({ meta: { startDate } })) });
  // A league's next calendar year is published ahead: it is not the default.
  const seasons = new Map([["2027/2028", season("2027-02-13")], ["2026/2027", season("2026-08-14", null)], ["2025/2026", season("2025-08-15")]]);
  assert.equal(defaultSeason(seasons, "2026-11-09"), "2026/2027");
  assert.equal(defaultSeason(seasons, "2027-02-13"), "2027/2028");
  assert.equal(defaultSeason(new Map([["2027/2028", season("2027-02-13")]]), "2026-11-09"), "2027/2028");
  assert.equal(defaultSeason(new Map(), "2026-11-09"), null);
});
