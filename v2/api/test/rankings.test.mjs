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
    edition: "2026.uefa", kind: "uefa-clubs", officialEdition: true, period: "2025/2026", provider: "UEFA",
    retrievedAt: "2025-09-02T00:00:00.000Z", rows: 1, sourceUpdatedAt: "2025-09-01T08:00:00.000Z", sourceUrl: "https://comp.uefa.com/v2/coefficients?c",
  });
  assert.deepEqual([history.rows[0].row.position, history.rows[0].row.points, history.rows[0].row.entityId], [40, 30.5, "uefa:52747"]);
  assert.deepEqual((await get("/api/rankings/club?club=t_aaaaa2")).body, { rows: null });
});

test("UEFA associations of a year, with their season points", { skip }, async () => {
  const { body } = await get("/api/rankings/associations?year=2026");
  assert.deepEqual([body.kind, body.edition, body.provider, body.period, body.officialEdition], ["uefa-associations", "2026.uefa", "UEFA", "2025/2026", true]);
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
  assert.deepEqual(index.editions.map((e) => [e.kind, e.edition]), [["uefa-clubs", "2026.uefa"], ["uefa-associations", "2026.uefa"], ["fifa-men", "2025-09-18.fifa"]]);
  assert.deepEqual(index.clubMapping, { linked: 1 });
  const fifa = (await get("/api/rankings/edition?kind=fifa-men&edition=2025-09-18.fifa")).body;
  assert.deepEqual(fifa.rows, [{ entityId: "fifa:43946", entityName: "France", countryCode: "FRA", position: 2, points: 1870, previousPosition: 1, imageUrl: null, confederation: "UEFA" }]);
  assert.equal((await get("/api/rankings/edition?kind=fifa-men&edition=bad")).response.status, 400);
});
