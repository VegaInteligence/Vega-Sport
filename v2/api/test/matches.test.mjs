// Contract tests of /api/fixtures and /api/matches/{id}/summary (relational-core.js on
// main) on the seed of test/seed.py.
import { test } from "node:test";
import assert from "node:assert/strict";
import { get, skip } from "./context.mjs";

const fixtures = "/api/fixtures?league=l_3FJFUl&season=2025/2026";
const ids = (body) => body.data.matches.map((m) => m.id);

test("fixtures: shape, order and filters", { skip }, async () => {
  const { response, body } = await get(fixtures);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("etag"), /^W\/"core-v3-/);
  assert.deepEqual(ids(body), ["m_aaaaa1", "m_aaaaa2", "m_aaaaa3", "m_aaaaa4", "m_aaaaa5", "m_aaaaa6"]);
  assert.deepEqual(body.data.matches[0], {
    id: "m_aaaaa1", season: "2025/2026", date: "2025-09-01", time_utc: "2025-09-01T19:00:00Z", status: "finished",
    round_name: "1", has_playoff: null,
    home_team: { id: "t_aaaaa1", name: "Olympique Été", image_url: "https://img.example/t1.png" },
    away_team: { id: "t_aaaaa2", name: "Racing Club", image_url: null },
    league: { id: "l_3FJFUl", name: "Ligue 1", image_url: "https://img.example/l1.png" },
    score_home: 2, score_away: 0, score_penalty_home: null, score_penalty_away: null,
  });
  assert.deepEqual(body.pagination, { limit: 50, nextCursor: null, generation: "7" });
  assert.deepEqual(ids((await get(fixtures + "&status=upcoming")).body), ["m_aaaaa6"]);
  assert.equal((await get(fixtures + "&status=played")).body.data.matches.length, 5);
  assert.deepEqual(ids((await get(fixtures + "&q=union")).body), ["m_aaaaa2", "m_aaaaa4", "m_aaaaa5"]);
  assert.deepEqual(ids((await get(fixtures + "&order=desc&limit=2")).body), ["m_aaaaa6", "m_aaaaa5"]);
  assert.deepEqual(ids((await get(fixtures + "&from=2025-09-03&to=2025-09-04")).body), ["m_aaaaa3", "m_aaaaa4"]);
  assert.deepEqual(ids((await get("/api/fixtures?seasons=2025/2026&leagues=l_zzzzzz")).body), []);
});

test("fixtures: cursor pages and their generation", { skip }, async () => {
  const first = (await get(fixtures + "&limit=2")).body;
  assert.deepEqual(ids(first), ["m_aaaaa1", "m_aaaaa2"]);
  const cursor = first.pagination.nextCursor;
  assert.ok(cursor);
  const second = (await get(fixtures + "&limit=2&cursor=" + cursor)).body;
  assert.deepEqual(ids(second), ["m_aaaaa3", "m_aaaaa4"]);
  // A cursor of another publication: the client must reload the first page.
  const stale = JSON.parse(Buffer.from(cursor, "base64url").toString());
  stale.generation = "6";
  const changed = await get(fixtures + "&limit=2&cursor=" + Buffer.from(JSON.stringify(stale)).toString("base64url"));
  assert.equal(changed.response.status, 409);
  // A cursor of another scope is refused.
  assert.equal((await get(fixtures + "&limit=3&cursor=" + cursor)).response.status, 400);
  const again = await get(fixtures, { "if-none-match": (await get(fixtures)).response.headers.get("etag") });
  assert.equal(again.response.status, 304);
});

test("fixtures: invalid filters", { skip }, async () => {
  for (const bad of ["&status=live", "&order=up", "&from=2025-02-30", "&limit=0", "&limit=101", "&cursor=@@", "&x=1"])
    assert.equal((await get(fixtures + bad)).response.status, 400, bad);
  assert.equal((await get("/api/fixtures?league=l_3FJFUl&leagues=l_3FJFUl")).response.status, 400);
});

test("match summary of a collected match", { skip }, async () => {
  const { response, body } = await get("/api/matches/m_aaaaa1/summary");
  assert.equal(response.status, 200);
  assert.equal(body.data.version, 1);
  assert.equal(body.data.state, "ready");
  const m = body.data.match;
  assert.deepEqual(
    [m.id, m.season, m.leagueId, m.league, m.country, m.date, m.timeUtc, m.status, m.roundName, m.summaryVersion, m.detailCollected],
    ["m_aaaaa1", "2025/2026", "l_3FJFUl", "Ligue 1", "FRA", "2025-09-01", "2025-09-01T19:00:00Z", "finished", "1", 1, true],
  );
  assert.deepEqual(m.referee, { id: "r_v0000001", name: "Clément Turpin" });
  assert.equal(m.stadium, null);
  assert.deepEqual(m.home, {
    id: "t_aaaaa1", name: "Olympique Été", imageUrl: "https://img.example/t1.png", formation: "4-3-3", coach: "Coach Un",
    score: 2, xg: 0.75, shots: 11, shotsOnTarget: 4, possession: 46, lineupConfirmed: true,
  });
  assert.equal(m.away.coach, null);
  assert.deepEqual(m.stats.map((s) => s.key), ["expected_goals", "total_shots", "ShotsOnTarget", "BallPossesion"]);
  assert.deepEqual(m.stats[3], { key: "BallPossesion", label: null, home: 46, away: 47, homeRaw: 46, awayRaw: 47, format: "integer", reliable: true });
  assert.deepEqual(m.shots.map((s) => [s.id, s.teamId, s.playerId, s.minute, s.isGoal]), [
    ["s1", "t_aaaaa1", "p_aaaab1", 11, true], ["s2", "t_aaaaa2", "p_aaaab4", 30, false], ["s3", "t_aaaaa1", "p_aaaab1", 21, true],
  ]);
  assert.deepEqual(m.coverage, {
    players: true, playerStats: true, ratings: true, xg: true, xa: false, shots: true, teamStatsReliable: true,
    listedPlayers: 3, playedPlayers: 3, ratedPlayers: 3, xgPlayers: 3, xaPlayers: 0,
  });
  assert.deepEqual(m.leadingPlayers.map((p) => [p.playerId, p.rating]), [["p_aaaab1", 7.5], ["p_aaaab4", 6.9], ["p_aaaab2", 6.5]]);
  assert.deepEqual(m.leadingPlayers[0], {
    id: "m_aaaaa1:p_aaaab1", playerId: "p_aaaab1", matchId: "m_aaaaa1", teamId: "t_aaaaa1", team: "Olympique Été",
    name: "Élie Durand", imageUrl: "https://img.example/p1.png", minutes: 90, rating: 7.5, goals: 2, assists: null,
  });
  assert.equal(response.headers.get("cache-control").includes("s-maxage=15"), true);
  const again = await get("/api/matches/m_aaaaa1/summary", { "if-none-match": response.headers.get("etag") });
  assert.equal(again.response.status, 304);
});

test("match summary of an upcoming match, and unknown ids", { skip }, async () => {
  const { body } = await get("/api/matches/m_aaaaa6/summary");
  assert.equal(body.data.state, "pending");
  assert.deepEqual(body.data.match.home, { id: "t_aaaaa2", name: "Racing Club", image_url: null, imageUrl: null, score: null });
  assert.deepEqual([body.data.match.shots, body.data.match.stats, body.data.match.leadingPlayers], [[], [], []]);
  assert.equal((await get("/api/matches/m_zzzzzz/summary")).response.status, 404);
  assert.equal((await get("/api/matches/m_aaaaa1/summary?x=1")).response.status, 400);
});
