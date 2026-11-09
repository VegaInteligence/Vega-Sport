// Contract tests of the European club pool (it replaces main's public/demo/europe-clubs.json).
import { test } from "node:test";
import assert from "node:assert/strict";
import { get, skip } from "./context.mjs";

const CLUBS = ["t_aaaaa1", "t_aaaaa2", "t_aaaaa3", "t_aaaaa4"];

test("the pool: Top 7 leagues, UEFA cups, clubs with coefficient and Elo level", { skip }, async () => {
  const { response, body } = await get("/api/clubs/europe?season=2025/2026");
  assert.equal(response.status, 200);
  const pool = body.data;
  assert.deepEqual(pool.leagues.map((l) => l.country), ["ENG", "ESP", "GER", "ITA", "FRA", "POR", "NED"]);
  assert.deepEqual(pool.uefa.map((l) => l.id), ["l_0bfbkO", "l_38d9HA", "l_2WZ2tt"]);
  assert.equal(pool.season, "2025/2026");
  assert.equal(pool.generation, body.meta.generation);
  assert.equal(pool.level.kind, "elo");
  assert.deepEqual(pool.clubs.map((c) => c.id).sort(), CLUBS);
  assert.ok(pool.clubs.every((c) => c.leagueId === "l_3FJFUl"));
  assert.deepEqual(pool.clubs.map((c) => [c.id, c.country]).sort(), [["t_aaaaa1", "FRA"], ["t_aaaaa2", "FRA"], ["t_aaaaa3", null], ["t_aaaaa4", "FRA"]]);
  const one = pool.clubs.find((c) => c.id === "t_aaaaa1");
  assert.deepEqual([one.name, one.imageUrl, one.uefaCoefficient], ["Olympique Été", "https://img.example/t1.png", 30.5]);
  assert.equal(pool.clubs.find((c) => c.id === "t_aaaaa2").uefaCoefficient, null);
  // Elo only moves points between clubs: four clubs started at 1500.
  assert.equal(Math.round(pool.clubs.reduce((sum, c) => sum + c.level, 0)), 6000);
  assert.deepEqual(pool.clubs.map((c) => c.levelRank).sort(), [1, 2, 3, 4]);
  assert.deepEqual(Object.keys(pool.levels).sort(), CLUBS);
  for (const c of pool.clubs) assert.equal(pool.levels[c.id], c.level);
});

test("the matches of one competition, in the demo's match shape", { skip }, async () => {
  const { body } = await get("/api/clubs/europe/matches?season=2025/2026&league=l_3FJFUl");
  const { matches } = body.data;
  assert.equal(matches.length, 5); // the not-started match is left out
  const first = matches[0];
  assert.deepEqual(Object.keys(first).sort(), ["away", "coverage", "date", "home", "id", "leagueId", "stats", "status", "timeUtc"]);
  assert.deepEqual([first.id, first.leagueId, first.date, first.status], ["m_aaaaa1", "l_3FJFUl", "2025-09-01", "finished"]);
  assert.deepEqual(first.home, { id: "t_aaaaa1", name: "Olympique Été", imageUrl: "https://img.example/t1.png", score: 2 });
  assert.deepEqual(first.coverage, { teamStatsReliable: true });
  assert.equal(matches[1].coverage.teamStatsReliable, false);
  assert.deepEqual(first.stats.find((s) => s.key === "expected_goals"), { key: "expected_goals", home: 0.75, away: 1 });
  assert.deepEqual(first.stats.map((s) => s.key).sort(), ["BallPossesion", "ShotsOnTarget", "accurate_passes", "expected_goals", "passes", "total_shots"]);
  const cup = (await get("/api/clubs/europe/matches?season=2025/2026&league=l_0bfbkO")).body.data;
  assert.deepEqual(cup.matches, []);
});

test("pool reads reject what they do not serve", { skip }, async () => {
  assert.equal((await get("/api/clubs/europe/matches?season=2025/2026&league=l_aaaaaa")).response.status, 400);
  assert.equal((await get("/api/clubs/europe/matches?season=2025/2026")).response.status, 400);
  assert.equal((await get("/api/clubs/europe?season=2025")).response.status, 400);
  assert.equal((await get("/api/clubs/europe?season=2025/2026&league=l_3FJFUl")).response.status, 400);
});
