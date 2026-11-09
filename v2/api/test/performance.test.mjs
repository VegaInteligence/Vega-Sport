// Contract tests of /api/read/performance (relational-performance.js on main).
import { test } from "node:test";
import assert from "node:assert/strict";
import { get, skip } from "./context.mjs";

const base = "/api/read/performance?season=2025/2026&leagues=all&appearance=m_aaaaa1:p_aaaab1";

test("a performance: record, rank, match, competition, profile", { skip }, async () => {
  const { response, body } = await get(base);
  assert.equal(response.status, 200);
  const { row, match, competition, profile, rank } = body.data;
  assert.deepEqual(
    [row.id, row.playerId, row.teamId, row.matchId, row.leagueId, row.league, row.country, row.season, row.date, row.positionId],
    ["m_aaaaa1:p_aaaab1", "p_aaaab1", "t_aaaaa1", "m_aaaaa1", "l_3FJFUl", "Ligue 1", "FRA", "2025/2026", "2025-09-01", 91],
  );
  assert.deepEqual(
    [row.minutes, row.rating, row.goals, row.xg, row.shots, row.passesAccurate, row.passesAttempted, row.starter, row.assists],
    [90, 7.5, 2, 1.2, 4, 20, 25, true, null],
  );
  assert.equal(row.name, "Élie Durand");
  assert.deepEqual(rank, { rank: 1, total: 3 });
  assert.equal(match.id, "m_aaaaa1");
  assert.deepEqual(match.stats.map((s) => s.key), ["BallPossesion", "total_shots", "ShotsOnTarget", "expected_goals", "passes", "accurate_passes"]);
  assert.deepEqual(match.stats[0], { key: "BallPossesion", label: null, home: 46, away: 47, homeRaw: 46, awayRaw: 47, format: "integer", reliable: true });
  assert.deepEqual(match.players, ["m_aaaaa1:p_aaaab1", "m_aaaaa1:p_aaaab2", "m_aaaaa1:p_aaaab4"]);
  assert.deepEqual(match.shots, []); // only with include=shots
  assert.deepEqual(competition, { id: "l_3FJFUl", name: "Ligue 1", country: "FRA", providerCountry: "FRA", imageUrl: "https://img.example/l1.png", seasons: ["2025/2026"] });
  // Peers: the season's attacking performances of at least 30 minutes (P1 three times, P4 twice).
  assert.equal(profile.peers, 5);
  assert.equal(profile.line.group, "O");
  assert.ok(profile.sections.length > 0);
  assert.ok(profile.sections.flatMap((s) => s.metrics).every((m) => m.percentile === null)); // fewer than 30 peers
});

test("performance with shots, conditional reads and errors", { skip }, async () => {
  const shots = (await get(base + "&include=shots")).body.data.match.shots;
  assert.equal(shots.length, 3);
  assert.deepEqual(
    [shots[0].id, shots[0].playerId, shots[0].type, shots[0].period, shots[0].isGoal, shots[0].xg],
    ["s1", "p_aaaab1", "goal", "first_half", true, 0.7],
  );
  const first = await get(base);
  assert.equal((await get(base, { "if-none-match": first.response.headers.get("etag") })).response.status, 304);
  assert.equal((await get(base.replace("p_aaaab1", "p_aaaab3"))).response.status, 404); // not in that match
  assert.equal((await get(base.replace("m_aaaaa1:p_aaaab1", "nope"))).response.status, 404);
  assert.equal((await get(base + "&include=all")).response.status, 400);
  assert.equal((await get(base.replace("leagues=all", "leagues=l_zzzzzz"))).response.status, 404);
});
