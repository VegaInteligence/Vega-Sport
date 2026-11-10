// Contract tests of /api/read/archive and /api/archives/index (relational-archives.js
// and the archive catalogue on main), on the 2015/2016 archive the seed imports with
// main's builders and shared/archive.js (tests/archive_fixtures.py).
import { test } from "node:test";
import assert from "node:assert/strict";
import { get, skip } from "./context.mjs";

const archive = "/api/read/archive?season=2015/2016";

test("archive page: listing, competitions, summary, pagination", { skip }, async () => {
  const { response, body } = await get(archive);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("etag"), /^W\/"archive-v2-/);
  const { data, meta, pagination } = body;
  assert.deepEqual(data.competitions, [
    { id: "2015-16/en.1", name: "English Premier League 2015/16", country: "Angleterre", matches: 4, withGoals: 3, goals: 4 },
  ]);
  assert.deepEqual(data.summary, { matches: 4, results: 4, withGoals: 3, goals: 4, competitions: 1 });
  assert.deepEqual(data.matches.map((m) => m.key), ["r:2015-16/en.1:2", "g:eng-premier-league:2015-08-09:2", "r:2015-16/en.1:0", "r:2015-16/en.1:1"]);
  assert.deepEqual(data.matches[0], {
    key: "r:2015-16/en.1:2", competitionId: "2015-16/en.1", competition: "English Premier League 2015/16", country: "Angleterre",
    date: "2015-08-15", dateNote: false, round: "Matchday 2", team1: "Chelsea FC", team2: "Leicester City FC", score: [2, 2],
    notes: ["après prolongation", "tirs au but 4 – 3"], hasGoals: false, goalCount: 0,
  });
  assert.deepEqual(data.matches[1].round, "");
  assert.deepEqual(pagination, { total: 4, pages: 1, page: 1, limit: 50, hasMore: false, version: meta.version });
  assert.match(meta.version, /^[a-f0-9]{64}$/);
  assert.deepEqual(Object.keys(meta.sources).sort(), ["goals", "results"]);
  const second = (await get(archive + "&limit=3&page=2")).body;
  assert.deepEqual([second.data.matches.length, second.pagination.page, second.pagination.pages], [1, 2, 2]);
});

test("archive search by team or scorer, competition filter, match goals", { skip }, async () => {
  assert.deepEqual((await get(archive + "&q=leicester")).body.data.matches.map((m) => m.key), ["r:2015-16/en.1:2", "r:2015-16/en.1:1"]);
  assert.deepEqual((await get(archive + "&q=zarate")).body.data.matches.map((m) => m.key), ["r:2015-16/en.1:0"]); // accents ignored
  assert.equal((await get(archive + "&competition=other")).body.pagination.total, 0);
  const detail = (await get(archive + "&match=" + encodeURIComponent("r:2015-16/en.1:0"))).body.data;
  assert.deepEqual(detail.matches, []);
  assert.equal(detail.match.hasGoals, undefined);
  assert.deepEqual(detail.match.goals, [
    { date: "2015-08-08", match: "Arsenal FC vs. West Ham United FC 0:2", minute: "43", player: "Cheikhou Kouyaté", score: [0, 1], team: "West Ham United FC" },
    { date: "2015-08-08", match: "Arsenal FC vs. West Ham United FC 0:2", minute: "57", player: "Mauro Zárate", score: [0, 2], team: "West Ham United FC" },
  ]);
  const vardy = (await get(archive + "&match=" + encodeURIComponent("r:2015-16/en.1:1"))).body.data.match.goals[0];
  assert.equal(vardy.scoreDisagreement, true); // one goal for a 4–2 in that source
  assert.equal((await get(archive + "&match=" + encodeURIComponent("r:2015-16/en.1:2"))).response.status, 404); // no goal
});

test("archive versions, conditional reads and errors", { skip }, async () => {
  const first = await get(archive);
  assert.equal((await get(archive, { "if-none-match": first.response.headers.get("etag") })).response.status, 304);
  assert.equal((await get(archive + "&version=" + "0".repeat(64))).response.status, 409);
  assert.equal((await get(archive + "&version=" + first.body.meta.version)).response.status, 200);
  assert.equal((await get("/api/read/archive?season=1990/1991")).response.status, 404);
  assert.equal((await get("/api/read/archive?season=bad")).response.status, 400);
});

test("archives stay out of the PitchAPI-era reads", { skip }, async () => {
  assert.deepEqual((await get("/api/fixtures?season=2015/2016")).body.data.matches, []);
  assert.equal((await get("/api/read/clubs?season=2015/2016&leagues=all")).body.pagination.total, 0);
  const manifest = (await get("/api/dashboard/manifest")).body;
  assert.deepEqual(manifest.competitions.map((c) => c.id), ["l_3FJFUl"]);
  assert.ok(manifest.seasons.every((s) => s.id !== "2015/2016"));
});

test("archive indexes", { skip }, async () => {
  const results = (await get("/api/archives/index?kind=results")).body;
  assert.deepEqual(results.seasons, [{ id: "2015/2016", competitions: 1, matches: 3, results: 3, unplayed: 0, unverifiedDates: 0 }]);
  assert.deepEqual([results.schemaVersion, results.source.name, results.source.revision], [1, "OpenFootball", "e6744429ee395bc86f247348c6184bb08d4eb361"]);
  const goals = (await get("/api/archives/index?kind=goals")).body;
  assert.deepEqual(goals.seasons, [{ id: "2015/2016", competitions: 1, events: 4, matches: 3, scoreDisagreements: 2, latestEvent: "2015-08-09" }]);
  assert.equal((await get("/api/archives/index?kind=other")).response.status, 400);
  const manifest = (await get("/api/dashboard/manifest")).body;
  assert.equal(manifest.capabilities.boundedArchive, true);
});
