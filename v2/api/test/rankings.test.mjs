// Contract tests of the ranking catalogue (relational-catalog.js on main).
import { test } from "node:test";
import assert from "node:assert/strict";
import { get, skip } from "./context.mjs";

test("club links and a club's UEFA ranking history", { skip }, async () => {
  const links = (await get("/api/club-links?club=t_aaaaa1")).body;
  assert.deepEqual(links, { links: { t_aaaaa1: { clubName: "Olympique Été", countryCode: "FRA", entityId: "uefa:52747", method: "reviewed-alias-and-country", rankingName: "Olympique Ete" } } });
  assert.deepEqual((await get("/api/club-links?club=t_aaaaa2")).body, { links: {} });
  const history = (await get("/api/rankings/club?club=t_aaaaa1")).body;
  assert.equal(history.rows.length, 1);
  assert.deepEqual(history.rows[0].edition, {
    edition: "2026", kind: "uefa-clubs", officialEdition: true, period: "2025/2026", provider: "UEFA",
    retrievedAt: "2025-09-02T00:00:00.000Z", rows: 1, sourceUpdatedAt: "2025-09-01T08:00:00.000Z", sourceUrl: "https://comp.uefa.com/v2/coefficients?c",
  });
  assert.deepEqual([history.rows[0].row.position, history.rows[0].row.points, history.rows[0].row.entityId], [40, 30.5, "uefa:52747"]);
  assert.deepEqual((await get("/api/rankings/club?club=t_aaaaa2")).body, { rows: null });
});

test("UEFA associations of a year, with their season points", { skip }, async () => {
  const { body } = await get("/api/rankings/associations?year=2026");
  assert.deepEqual([body.kind, body.edition, body.provider, body.period, body.officialEdition], ["uefa-associations", "2026", "UEFA", "2025/2026", true]);
  assert.deepEqual(body.rows, [{
    entityId: "uefa:1", entityName: "France", countryCode: "FRA", position: 5, points: 72.3, earnedPoints: 72.3, previousPosition: null, imageUrl: null,
    sourceRow: {
      overallRanking: { numberOfTeamsStillInPlaying: 7 },
      seasonRankings: [
        { seasonYear: 2026, totalPoints: 15.5, nationalAssociationPoints: 15.5, numberOfTeamsStillInPlaying: 7 },
        { seasonYear: 2025, totalPoints: 17, nationalAssociationPoints: 17, numberOfTeamsStillInPlaying: 0 },
      ],
    },
  }]);
  assert.equal((await get("/api/rankings/associations?year=2020")).response.status, 404);
  assert.equal((await get("/api/rankings/associations")).response.status, 400);
});

test("ranking index and editions", { skip }, async () => {
  const index = (await get("/api/rankings/index")).body;
  assert.deepEqual(index.editions.map((e) => [e.kind, e.edition]), [["uefa-clubs", "2026"], ["uefa-associations", "2026"], ["fifa-men", "2025-09-18"]]);
  assert.deepEqual(index.clubMapping, { linked: 1 });
  const fifa = (await get("/api/rankings/edition?kind=fifa-men&edition=2025-09-18")).body;
  assert.deepEqual(fifa.rows, [{ entityId: "fifa:43946", entityName: "France", countryCode: "FRA", position: 2, points: 1870, previousPosition: 1, imageUrl: null, confederation: "UEFA" }]);
  assert.equal((await get("/api/rankings/edition?kind=fifa-men&edition=bad")).response.status, 400);
  assert.equal((await get("/api/rankings/edition?kind=fifa-men&edition=2025-09-18.fifa")).response.status, 400); // no source in a key
});

test("power rankings of players and clubs for a season", { skip }, async () => {
  const { response, body } = await get("/api/rankings/power?kind=players&season=2025/2026");
  assert.equal(response.status, 200);
  assert.deepEqual([body.season, body.kind, body.method.version], ["2025/2026", "players", "power-ranking-v1"]);
  assert.deepEqual(body.rows.map((r) => [r.rank, r.playerId, r.position, r.score]), [[1, "p_aaaab1", "Avant-centre", 87.5], [2, "p_aaaab4", "Ailier / milieu offensif", 50]]);
  assert.deepEqual(Object.keys(body.rows[0]).slice(0, 8), ["rank", "playerId", "name", "imageUrl", "teamId", "team", "teamImageUrl", "position"]);
  // More than one score: the season by block and by role.
  assert.deepEqual(body.rows[0].blocks.finishing, { contribution: 3.1, percentile: 95 });
  assert.deepEqual(body.rows[0].roles.map((r) => [r.role, r.minutes]), [["centre_forward", 200], ["winger", 60]]);
  assert.deepEqual([body.rows[1].blocks, body.rows[1].roles], [{}, []]);
  const clubs = (await get("/api/rankings/power?kind=clubs&season=2025/2026")).body;
  assert.equal(clubs.rows.length, 4);
  assert.deepEqual(clubs.rows.map((r) => r.rank), [1, 2, 3, 4]);
  assert.ok(clubs.rows.every((r, i) => !i || clubs.rows[i - 1].elo >= r.elo));
  assert.equal(Math.round(clubs.rows.reduce((s, r) => s + r.elo, 0)), 6000); // Elo moves points between clubs only
  for (const r of clubs.rows) {
    assert.equal(r.wins + r.draws + r.losses, r.matches);
    assert.equal(Math.round(r.eloStart + r.eloChange), Math.round(r.elo));
  }
  assert.equal(Math.round(clubs.rows.reduce((s, r) => s + r.results, 0) * 2), 10); // five matches, one point shared each
  assert.equal((await get("/api/rankings/power?kind=players&season=2025/2026&limit=1")).body.rows.length, 1);
  assert.equal((await get("/api/rankings/power?kind=nations&season=2025/2026")).response.status, 404);
  assert.equal((await get("/api/rankings/power?kind=players&season=2025")).response.status, 400);
  assert.equal((await get("/api/rankings/power?kind=ballon&season=2025/2026")).response.status, 400);
});
