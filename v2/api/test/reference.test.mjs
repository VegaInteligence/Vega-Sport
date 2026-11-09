// Contract tests of /api/standings and /api/matchdays (support and catalogue reads of
// aws-app.js on main) on the seed of test/seed.py.
import { test } from "node:test";
import assert from "node:assert/strict";
import { get, skip } from "./context.mjs";

test("standings: Vega's table when no official one is published", { skip }, async () => {
  const { response, body } = await get("/api/standings?competition=l_3FJFUl");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("etag"), /^W\/"support-v1-/);
  assert.deepEqual(Object.keys(body).sort(), ["competition", "fetchedAt", "season", "source", "tables"]);
  assert.deepEqual([body.competition, body.season, body.source, body.fetchedAt], ["l_3FJFUl", "2025/2026", "vega", "2025-09-20T11:00:00.000Z"]);
  assert.equal(body.tables.length, 1);
  assert.equal(body.tables[0].name, "Ligue 1");
  assert.deepEqual(body.tables[0].rows.map((r) => [r.id, r.position, r.points]), [
    ["t_aaaaa1", 1, 4], ["t_aaaaa3", 2, 4], ["t_aaaaa2", 3, 3], ["t_aaaaa4", 4, 2],
  ]);
  assert.deepEqual(body.tables[0].rows[0], {
    id: "t_aaaaa1", uefaId: "52747", imageUrl: "https://img.example/t1.png", name: "Olympique Été", wins: 1, draws: 1,
    losses: 1, played: 3, points: 4, goalsFor: 2, goalsAgainst: 1, difference: 1, position: 1,
  });
  assert.deepEqual((await get("/api/standings?competition=l_3FJFUl&season=2025/2026")).body, body);
  const again = await get("/api/standings?competition=l_3FJFUl", { "if-none-match": response.headers.get("etag") });
  assert.equal(again.response.status, 304);
  assert.equal((await get("/api/standings?competition=l_3FJFUl&season=2019/2020")).response.status, 404);
  assert.equal((await get("/api/standings?competition=bad")).response.status, 400);
  assert.equal((await get("/api/standings")).response.status, 400);
});

test("matchdays: round of each match", { skip }, async () => {
  const { response, body } = await get("/api/matchdays?competition=l_3FJFUl&season=2025/2026");
  assert.equal(response.status, 200);
  assert.deepEqual(body, { matches: { m_aaaaa1: { name: "1", playoff: false } } });
  assert.equal((await get("/api/matchdays?competition=l_3FJFUl")).response.status, 400); // both are required
  assert.equal((await get("/api/matchdays?competition=l_3FJFUl&season=2024/2025")).response.status, 404);
});
