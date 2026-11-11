// Contract tests of /api/read/players (relational-players.js on main) on the seed of
// test/seed.py; expected values are recomputed by hand from that seed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { get, skip } from "./context.mjs";

const players = "/api/read/players?season=2025/2026&leagues=all";
const ids = (body) => body.data.players.map((p) => p.id);
const close = (actual, expected, digits = 9) => assert.ok(Math.abs(actual - expected) < 10 ** -digits, `${actual} != ${expected}`);
// The keys of a player record in relational-players.js (main).
const METRICS = [
  "goals", "assists", "xg", "npxg", "xgot", "xa", "shots", "shotsOnTarget", "touchesBox", "chancesCreated",
  "bigChancesCreated", "passesFinalThird", "dribbles", "touches", "passesAccurate", "passesAttempted", "duelsWon",
  "duelsLost", "tackles", "interceptions", "recoveries", "clearances", "defensiveActions", "blocks", "saves",
  "goalsPrevented", "passAccuracy", "duelRate",
];
const RECORD_KEYS = [
  "id", "playerId", "name", "imageUrl", "team", "league", "position", "power", "positionId", "matches", "minutes", "rating",
  ...METRICS, "finishingDelta", "totals", "profile",
].sort();
const PROFILE_KEYS = [
  "id", "name", "imageUrl", "role", "teams", "teamIds", "leagueIds", "leagues", "matches", "minutes", "unknownMinutes",
  "starts", "knownStarts", "rating", "ratingCount", "stats", "ratios", "identity", "latest", "rows",
].sort();

test("player directory: envelope, rating order, records", { skip }, async () => {
  const { response, body } = await get(players);
  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(body).sort(), ["data", "meta", "pagination"]);
  assert.deepEqual(ids(body), ["p_aaaab4", "p_aaaab3", "p_aaaab1", "p_aaaab2"]);
  assert.deepEqual(body.pagination, { page: 1, limit: 20, total: 4, pages: 1, generation: "7" });
  const p1 = body.data.players[2];
  assert.deepEqual(Object.keys(p1).sort(), RECORD_KEYS);
  assert.deepEqual(Object.keys(p1.profile).sort(), PROFILE_KEYS);
  assert.deepEqual(
    [p1.name, p1.imageUrl, p1.team, p1.league, p1.position, p1.positionId, p1.matches],
    ["Élie Durand", "https://img.example/p1.png", "Olympique Été", "Ligue 1", "Attaquant", 91, 3],
  );
  // The player power ranking of the season; p_aaaab3 is not ranked (under 900 minutes in the seed).
  assert.deepEqual(p1.power, {
    rank: 1, score: 87.5, role: "centre_forward", position: "Avant-centre", roleRank: 1,
    blocks: {
      finishing: { contribution: 3.1, percentile: 95 }, creation: { contribution: 0.8, percentile: 70.5 }, defence: { contribution: 0.3, percentile: 40 },
    },
    roles: [
      { role: "centre_forward", position: "Avant-centre", matches: 2, minutes: 200, contribution: 3.9, rate: 0.539 },
      { role: "winger", position: "Ailier / milieu offensif", matches: 1, minutes: 60, contribution: 0.3, rate: 0.053 },
    ],
  });
  assert.equal(body.data.players.find((p) => p.id === "p_aaaab3").power, null);
  close(p1.minutes, 260 / 3);
  close(p1.rating, 20.5 / 3, 6);
  close(p1.goals, 2 / 3);
  close(p1.xg, 1.9 / 3);
  close(p1.passAccuracy, (100 * 45) / 57);
  close(p1.finishingDelta, (2 - 1.9) / 3);
  assert.equal(p1.assists, null); // never observed
  assert.deepEqual(p1.totals, { goals: 2, assists: null, xg: p1.profile.stats.xg.sum });
  assert.deepEqual(p1.profile.stats.goals, { sum: 2, count: 3, minutes: 260 });
  assert.deepEqual(Object.keys(p1.profile.stats).sort(), ["goals", "passesAccurate", "passesAttempted", "shots", "xg"]);
  assert.deepEqual(p1.profile.ratios, { passAccuracy: { numerator: 45, denominator: 57, count: 3, minutes: 260 } });
  assert.deepEqual(
    [p1.profile.teams, p1.profile.teamIds, p1.profile.leagues, p1.profile.leagueIds],
    [["Olympique Été"], ["t_aaaaa1"], ["Ligue 1"], ["l_3FJFUl"]],
  );
  assert.deepEqual(p1.profile.role, { label: "Attaquant", group: "O", peers: "milieux offensifs et attaquants", positionId: 91 });
  assert.deepEqual(p1.profile.latest, {
    id: "m_aaaaa5:p_aaaab1", playerId: "p_aaaab1", name: "Élie Durand", imageUrl: "https://img.example/p1.png",
    date: "2025-09-05", team: "Olympique Été", teamId: "t_aaaaa1", leagueId: "l_3FJFUl", league: "Ligue 1", positionId: 91,
  });
  assert.deepEqual(body.data.teams, [
    { id: "t_aaaaa1", name: "Olympique Été", imageUrl: "https://img.example/t1.png" },
    { id: "t_aaaaa2", name: "Racing Club", imageUrl: null },
    { id: "t_aaaaa4", name: "Union Sud", imageUrl: null },
  ]);
});

test("unknown minutes, bench entries and starts", { skip }, async () => {
  const { body } = await get(players);
  const p2 = body.data.players[3];
  // m1 played, m3 on the bench (statistics collected: 0 minutes), m5 minutes unknown.
  assert.deepEqual(
    [p2.matches, p2.minutes, p2.profile.minutes, p2.profile.unknownMinutes, p2.profile.starts, p2.profile.knownStarts],
    [1, 90, 90, 1, 1, 1],
  );
  assert.equal(p2.profile.identity.date, "2025-09-05"); // any row of the scope
  assert.equal(p2.profile.latest.date, "2025-09-01"); // the latest played row
  assert.equal(p2.position, "Milieu");
});

test("rankings and their eligibility", { skip }, async () => {
  assert.deepEqual(ids((await get(players + "&ranking=goals")).body), ["p_aaaab4", "p_aaaab1"]);
  // Fewer than five rated matches: nobody is ranked on rating.
  assert.equal((await get(players + "&ranking=rating")).body.pagination.total, 0);
  assert.deepEqual(ids((await get(players + "&basis=total&sort=goals")).body), ["p_aaaab4", "p_aaaab1", "p_aaaab3", "p_aaaab2"]);
  assert.deepEqual(ids((await get(players + "&sort=name&direction=asc")).body), ["p_aaaab4", "p_aaaab1", "p_aaaab3", "p_aaaab2"]);
});

test("filters: position, search and alias, venue, result, match", { skip }, async () => {
  assert.deepEqual(ids((await get(players + "&pos=G")).body), ["p_aaaab3"]);
  assert.deepEqual(ids((await get(players + "&pos=M")).body), ["p_aaaab4", "p_aaaab2"]); // AM counts as M
  // The role groups of a profile: the attacking midfielder is with the forward, not the midfielder.
  const grouped = async (group) => (await get(players + "&group=" + group)).body.data.players.map((p) => [p.id, p.profile.role.group]);
  assert.deepEqual((await grouped("O")).sort(), [["p_aaaab1", "O"], ["p_aaaab4", "O"]]);
  assert.deepEqual(await grouped("M"), [["p_aaaab2", "M"]]);
  assert.deepEqual((await grouped("G,M")).sort(), [["p_aaaab2", "M"], ["p_aaaab3", "G"]]);
  assert.deepEqual(ids((await get(players + "&group=O&pos=A")).body), ["p_aaaab1"]);
  assert.deepEqual(ids((await get(players + "&q=cr7")).body), ["p_aaaab4"]);
  assert.deepEqual(ids((await get(players + "&q=elie")).body), ["p_aaaab1"]);
  assert.deepEqual(ids((await get(players + "&q=union")).body), ["p_aaaab3"]);
  const home = (await get(players + "&venue=home")).body.data.players;
  assert.deepEqual(Object.fromEntries(home.map((p) => [p.id, p.matches])), { p_aaaab1: 2, p_aaaab2: 1, p_aaaab3: 1, p_aaaab4: 1 });
  assert.deepEqual(ids((await get(players + "&result=win")).body).sort(), ["p_aaaab1", "p_aaaab2", "p_aaaab4"]);
  assert.deepEqual(ids((await get(players + "&match=m_aaaaa1")).body).sort(), ["p_aaaab1", "p_aaaab2", "p_aaaab4"]);
  assert.equal((await get(players + "&from=2025-09-04")).body.data.players.find((p) => p.id === "p_aaaab1").matches, 1);
  assert.deepEqual(ids((await get(players + "&stats=goals:1")).body), ["p_aaaab4"]); // 1.5 per match; P1 has 0.67
});

test("player read errors", { skip }, async () => {
  for (const bad of ["&pos=X", "&group=A", "&stats=rating:1", "&from=2025-13-01", "&match=bad", "&sort=nope", "&other=1"])
    assert.equal((await get(players + bad)).response.status, 400, bad);
  assert.equal((await get(players + "&generation=6")).response.status, 409);
});

test("a whole selection comes in one page, as its pages give it", { skip }, async () => {
  const base = "/api/read/players?season=2025/2026&leagues=all&basis=total&sort=name&direction=asc&minutes=0";
  const first = (await get(base + "&limit=2&page=1")).body;
  const paged = [...first.data.players];
  for (let page = 2; page <= first.pagination.pages; page++) paged.push(...(await get(base + "&limit=2&page=" + page)).body.data.players);
  assert.ok(first.pagination.pages > 1 && paged.length === first.pagination.total);
  const { response, body } = await get(base + "&whole=1");
  assert.equal(response.status, 200);
  assert.deepEqual(body.pagination, { page: 1, limit: 3000, total: paged.length, pages: 1, generation: "7" });
  assert.deepEqual(body.data.players, paged);
  // The page's size is the route's: a limit sent with it changes nothing.
  assert.deepEqual((await get(base + "&whole=1&limit=2")).body.pagination, body.pagination);
  assert.equal((await get(base + "&whole=1&page=2")).body.data.players.length, 0);
  assert.equal((await get(base + "&whole=0")).response.status, 400);
  assert.equal((await get("/api/dashboard/manifest")).body.capabilities.wholeSelection, true);
});
