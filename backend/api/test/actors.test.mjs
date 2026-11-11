// Contract tests of /api/read/player and /api/read/club (relational-actors.js on main).
import { test } from "node:test";
import assert from "node:assert/strict";
import { get, skip } from "./context.mjs";

const scope = "season=2025/2026&leagues=all";
const DATA_KEYS = ["appearances", "competitions", "fixtures", "matches", "meta", "metrics", "teams"];

test("player profile: his matches, appearances and context", { skip }, async () => {
  const { response, body } = await get(`/api/read/player?${scope}&player=p_aaaab1`);
  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(body.data).sort(), DATA_KEYS);
  const d = body.data;
  assert.deepEqual(d.meta.actor, { kind: "player", id: "p_aaaab1" });
  assert.deepEqual([d.meta.storage, d.meta.currentSeason, d.meta.detail, d.meta.appearancesLoaded, d.meta.shotsLoaded], ["aws-relational", "2025/2026", "full", true, false]);
  assert.deepEqual(d.fixtures.map((f) => f.id), ["m_aaaaa5", "m_aaaaa3", "m_aaaaa1"]);
  assert.deepEqual(d.matches.map((m) => m.id), ["m_aaaaa5", "m_aaaaa3", "m_aaaaa1"]);
  assert.deepEqual(d.matches[2].players, ["m_aaaaa1:p_aaaab1"]);
  assert.deepEqual(d.appearances.map((a) => [a.id, a.minutes, a.goals]), [
    ["m_aaaaa1:p_aaaab1", 90, 2], ["m_aaaaa3:p_aaaab1", 90, 0], ["m_aaaaa5:p_aaaab1", 80, 0],
  ]);
  assert.deepEqual(d.teams.map((t) => t.id), ["t_aaaaa1", "t_aaaaa2", "t_aaaaa3", "t_aaaaa4"]);
  assert.deepEqual(d.teams[0], { id: "t_aaaaa1", name: "Olympique Été", imageUrl: "https://img.example/t1.png", country: "FRA", leagueIds: ["l_3FJFUl"], sampleMatches: 3, seasons: ["2025/2026"] });
  assert.equal(d.teams[2].country, null);
  assert.deepEqual(d.competitions.map((c) => c.id), ["l_3FJFUl"]);
  assert.deepEqual(body.pagination, { page: 1, limit: 25, total: 3, pages: 1, generation: "7" });
  // A bench entry and a match with unknown minutes are his matches too.
  assert.equal((await get(`/api/read/player?${scope}&player=p_aaaab2`)).body.pagination.total, 3);
});

test("profile pages, summary detail and shots", { skip }, async () => {
  const page = (await get(`/api/read/player?${scope}&player=p_aaaab1&limit=2&page=2`)).body;
  assert.deepEqual(page.data.fixtures.map((f) => f.id), ["m_aaaaa1"]);
  assert.deepEqual(page.pagination, { page: 2, limit: 2, total: 3, pages: 2, generation: "7" });
  const summary = (await get(`/api/read/player?${scope}&player=p_aaaab1&detail=summary`)).body.data;
  assert.ok(summary.matches.every((m) => m.stats.length === 0 && Object.keys(m.coverage).length === 0));
  const shots = (await get(`/api/read/player?${scope}&player=p_aaaab1&include=shots`)).body.data;
  assert.equal(shots.matches.find((m) => m.id === "m_aaaaa1").shots.length, 3);
  assert.equal(shots.meta.shotsLoaded, true);
});

test("club profile, with and without appearances", { skip }, async () => {
  const club = (await get(`/api/read/club?${scope}&team=t_aaaaa1`)).body.data;
  assert.deepEqual(club.fixtures.map((f) => f.id), ["m_aaaaa5", "m_aaaaa3", "m_aaaaa1"]);
  assert.deepEqual(club.appearances, []);
  assert.equal(club.meta.appearancesLoaded, false);
  assert.deepEqual(club.matches[2].players, []);
  const withPlayers = (await get(`/api/read/club?${scope}&team=t_aaaaa1&include=appearances`)).body.data;
  assert.equal(withPlayers.appearances.length, 6); // P1 three times, P2 three times (one on the bench)
  const summary = (await get(`/api/read/club?${scope}&team=t_aaaaa1&detail=summary`)).body.data;
  assert.deepEqual(summary.matches[2].coverage, { teamStatsReliable: true });
  assert.ok(summary.matches[2].stats.length > 0);
});

test("a league's season: every match once, as each club's summary read gives it", { skip }, async () => {
  const league = "season=2025/2026&league=l_3FJFUl&detail=summary";
  const { response, body } = await get(`/api/read/league?${league}&limit=100`);
  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(body.data).sort(), DATA_KEYS);
  const d = body.data;
  assert.deepEqual(d.meta.actor, { kind: "league", id: "l_3FJFUl" });
  assert.deepEqual([d.meta.detail, d.meta.appearancesLoaded, d.meta.shotsLoaded], ["summary", false, false]);
  assert.deepEqual(d.appearances, []);
  assert.equal(body.pagination.total, d.fixtures.length);
  const matches = new Map(d.matches.map((m) => [m.id, m]));
  assert.equal(matches.size, d.matches.length);
  assert.ok(d.matches.some((m) => m.stats.length > 0));
  // What a club profile read club by club: the same fixtures and the same match records.
  const seen = new Set();
  for (const team of d.teams) {
    const club = (await get(`/api/read/club?season=2025/2026&leagues=l_3FJFUl&team=${team.id}&detail=summary&limit=100`)).body.data;
    assert.ok(club.fixtures.length > 0, team.id);
    for (const f of club.fixtures) seen.add(f.id);
    for (const m of club.matches) assert.deepEqual(matches.get(m.id), m);
  }
  assert.deepEqual([...seen].sort(), d.fixtures.map((f) => f.id).sort());
  // Pages, newest first, and the publication fence of the other reads.
  const second = (await get(`/api/read/league?${league}&limit=2&page=2`)).body;
  assert.deepEqual(second.data.fixtures.map((f) => f.id), d.fixtures.slice(2, 4).map((f) => f.id));
  assert.equal(second.pagination.pages, Math.ceil(d.fixtures.length / 2));
  assert.equal((await get(`/api/read/league?${league}&generation=6`)).response.status, 409);
  // The finished matches alone: the same records, without the matches to come.
  const finished = (await get(`/api/read/league?${league}&limit=100&played=1`)).body;
  const done = d.fixtures.filter((f) => f.status === "finished").map((f) => f.id);
  assert.ok(done.length > 0 && done.length < d.fixtures.length);
  assert.deepEqual(finished.data.fixtures.map((f) => f.id), done);
  assert.equal(finished.pagination.total, done.length);
  for (const m of finished.data.matches) assert.deepEqual(matches.get(m.id), m);
  assert.equal((await get(`/api/read/league?${league}&played=0`)).response.status, 400);
  assert.equal((await get("/api/read/club?season=2025/2026&leagues=all&team=t_aaaaa1&played=1")).response.status, 400);
  // One competition, in the summary detail, without player rows.
  for (const query of ["season=2025/2026&detail=summary", "season=2025/2026&league=l_3FJFUl", `${league}&include=shots`, `${league}&leagues=all`, `${league}&team=t_aaaaa1`])
    assert.equal((await get(`/api/read/league?${query}`)).response.status, 400, query);
  assert.equal((await get("/api/read/league?season=2025/2026&league=l_zzzzzz&detail=summary")).body.pagination.total, 0);
});

test("profile errors", { skip }, async () => {
  assert.equal((await get(`/api/read/player?${scope}&player=bad`)).response.status, 400);
  assert.equal((await get(`/api/read/club?${scope}&team=t_aaaaa1&include=goals`)).response.status, 400);
  assert.equal((await get(`/api/read/club?${scope}&team=t_aaaaa1&detail=all`)).response.status, 400);
  assert.equal((await get(`/api/read/player?${scope}&player=p_aaaab1&generation=6`)).response.status, 409);
  const none = (await get(`/api/read/player?${scope}&player=p_zzzzzz`)).body;
  assert.equal(none.pagination.total, 0);
});
