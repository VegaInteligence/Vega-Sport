// GET /api/teams/{id}/squad, /api/players/{id}/physical and /api/players/{id}/style (117): the
// last blocks of the club and player pages that showed mock-up figures, read from the base.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { get, skip } from "./context.mjs";
import { centileOf, passShare, physicalBlock, roleCohort, ROLE_PEERS } from "../src/routes/profiles.mjs";

let owner;
before(async () => {
  if (skip) return;
  owner = new pg.Client({ connectionString: process.env.VEGA_V2_API_NODE_TEST_DSN });
  await owner.connect();
  // Ligue 1 is a league of the ranking (its clubs' places and the passes' league read it).
  await owner.query(`INSERT INTO agg.league_levels(competition_id, entry_level, level, teams, links, linked, run_id)
                     SELECT 1, 1500, 1500, 4, 0, true, id FROM agg.power_runs ORDER BY id LIMIT 1 ON CONFLICT DO NOTHING`);
});
after(() => owner?.end());

test("a centile counts ties half; a role too small gives way to its line", () => {
  assert.equal(centileOf([1, 2, 3, 4], 3), 63);
  assert.equal(centileOf([], 3), null);
  assert.equal(centileOf([1, 2], null), null);
  const rows = [
    ...Array.from({ length: ROLE_PEERS }, () => ({ role: "winger" })),
    ...Array.from({ length: 5 }, () => ({ role: "full_back" })),
    ...Array.from({ length: 7 }, () => ({ role: "centre_back" })),
    { role: "goalkeeper" },
  ];
  assert.deepEqual([roleCohort(rows, "winger").scope, roleCohort(rows, "winger").rows.length], ["role", ROLE_PEERS]);
  const backs = roleCohort(rows, "full_back");
  assert.deepEqual([backs.scope, backs.key, backs.label, backs.rows.length], ["line", "D", "défenseurs", 12]);
  assert.equal(roleCohort(rows, "goalkeeper").rows.length, 1);
  assert.equal(roleCohort(rows, null), null);
});

test("a competition's physical block places the player once he is tracked 450 minutes", () => {
  const peers = Array.from({ length: 12 }, (_, i) => ({
    player_id: i + 1, role: "winger", minutes: 900, distance_m: 9000 + 100 * i, running_m: 1500, sprinting_m: 200 + 10 * i,
    sprints: 10, top_speed_kmh: 30 + i / 2, tracked: 93, finished: 100,
  }));
  const games = Array.from({ length: 6 }, (_, i) => ({ date: `2026-09-0${i + 1}`, opponent: "X", minutes: 90, distance: 10000,
    running: 1600, sprinting: 300, sprints: 12, topSpeed: i === 5 ? null : 33 + i / 10 }));
  const block = physicalBlock({ name: "Premier League", games, peers, role: "winger" });
  assert.deepEqual([block.matches, block.minutes, block.tracked, block.finished, block.maxSpeed], [6, 540, 93, 100, 33.4]);
  assert.deepEqual(block.cohort, { scope: "line", key: "A", label: "attaquants", players: 12 });
  const distance = block.metrics.find((m) => m.key === "distance");
  assert.deepEqual([distance.value, distance.percentile, distance.median], [10000, 88, 9550]);
  assert.equal(block.metrics.find((m) => m.key === "topSpeed").value, 33.2);
  assert.equal(block.games[5].topSpeed, null);
  // Under 450 minutes: his figures, no place.
  const short = physicalBlock({ name: "Premier League", games: games.slice(0, 4), peers, role: "winger" });
  assert.equal(short.cohort, null);
  assert.ok(short.metrics.every((m) => m.percentile === null));
});

test("his share of the passes is placed among his role once he is in five networks", () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({ competition_name: "Ligue 1", player_id: i + 1, role: "central_midfielder",
    networks: 10, received: 100 + 10 * i, total: 1000 }));
  rows.push({ competition_name: "Ligue 1", player_id: 99, role: "central_midfielder", networks: 4, received: 900, total: 1000 });
  const mine = passShare(rows, 12);
  assert.deepEqual([mine.share, mine.percentile, mine.cohort.players, mine.networks], [21, 96, 12, 10]);
  assert.equal(passShare(rows, 99), null);
});

test("a club's squad: its record's figures, and a place once three quarters of its league have one", { skip }, async () => {
  assert.equal((await get("/api/teams/t_aaaaa1/squad?season=2025/2026")).response.status, 404);
  assert.equal((await get("/api/teams/t_aaaaa1/squad")).response.status, 400);
  for (const [team, key, value] of [[1, "131", 1300000000], [2, "418", 500000000]]) {
    await owner.query("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('team', 'transfermarkt', $1, $2)", [key, team]);
    await owner.query(`INSERT INTO core.provider_clubs(provider, provider_key, name, read_on, squad_value_eur, top18_value_eur, average_age, squad_size)
                       VALUES ('transfermarkt', $1, 'Club', '2026-11-16', $2, $3, 25.4, 27)`, [key, value, value - 90000000]);
  }
  const { response, body } = await get("/api/teams/t_aaaaa1/squad?season=2025/2026");
  assert.equal(response.status, 200);
  assert.deepEqual(body.data, { id: "t_aaaaa1", season: "2025/2026", value: 1300000000, readOn: "2026-11-16", top18Value: 1210000000, averageAge: 25.4, size: 27 });
  const valued = async (team, key) => {
    await owner.query("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('team', 'transfermarkt', $1, $2)", [key, team]);
    await owner.query("INSERT INTO core.provider_clubs(provider, provider_key, name, read_on, squad_value_eur) VALUES ('transfermarkt', $1, 'Club', '2026-11-16', 800000000)", [key]);
  };
  // Three clubs of four valued: a rank among them, with how many they are.
  await valued(3, "583");
  assert.deepEqual((await get("/api/teams/t_aaaaa2/squad?season=2025/2026")).body.data.league, { rank: 3, valued: 3, clubs: 4 });
  await valued(4, "1041");
  assert.deepEqual((await get("/api/teams/t_aaaaa2/squad?season=2025/2026")).body.data.league, { rank: 4, valued: 4, clubs: 4 });
  assert.deepEqual((await get("/api/teams/t_aaaaa1/squad?season=2025/2026")).body.data.league, { rank: 1, valued: 4, clubs: 4 });
  // A quarantined link shows nothing.
  await owner.query("INSERT INTO ops.provider_links(entity_type, provider, provider_key, entity_id, rule, evidence, quarantined_at, quarantine_reason) VALUES ('team', 'transfermarkt', '131', 1, 'club_votes', 3, now(), 'test')");
  assert.equal((await get("/api/teams/t_aaaaa1/squad?season=2025/2026")).response.status, 404);
});

test("a player's tracked matches: per competition, an aberrant top speed left out", { skip }, async () => {
  assert.equal((await get("/api/players/p_aaaab1/physical?season=2025/2026")).response.status, 404);
  for (const [match, distance, speed] of [[1, 10500, 33.5], [3, 9800, 120], [5, 8800, 31.9]])
    await owner.query(`UPDATE core.player_match_stats SET distance_m = $2, running_m = 1500, sprinting_m = 250, sprints = 11, top_speed_kmh = $3
                       WHERE season_id = 2025 AND player_id = 101 AND match_id = $1`, [match, distance, speed]);
  const { response, body } = await get("/api/players/p_aaaab1/physical?season=2025/2026");
  assert.equal(response.status, 200);
  const [block] = body.data.competitions;
  assert.deepEqual([block.name, block.matches, block.minutes, block.tracked, block.finished, block.maxSpeed, block.cohort], ["Ligue 1", 3, 260, 3, 5, 33.5, null]);
  assert.deepEqual(block.games.map((g) => [g.date, g.opponent, g.topSpeed]), [["2025-09-01", "Racing Club", 33.5], ["2025-09-03", "Stade Nord", null], ["2025-09-05", "Union Sud", 31.9]]);
  assert.equal(block.metrics.find((m) => m.key === "distance").value, Math.round((10 * 90 * (10500 + 9800 + 8800)) / 260) / 10);
  assert.equal((await get("/api/players/p_aaaab1/physical")).response.status, 400);
});

test("a player's style: his zones by third and side, the foot he shoots with", { skip }, async () => {
  assert.equal((await get("/api/players/p_aaaab3/style?season=2025/2026")).response.status, 404);
  await owner.query("UPDATE core.shots SET body_part = 'left_foot', is_inside_box = true WHERE season_id = 2025 AND match_id = 1 AND shot_no = 1");
  await owner.query("UPDATE core.shots SET body_part = 'right_foot', situation = 'penalty' WHERE season_id = 2025 AND match_id = 1 AND shot_no = 3");
  const { response, body } = await get("/api/players/p_aaaab1/style?season=2025/2026");
  assert.equal(response.status, 200);
  // Match 5's map is left out: its cells do not add up to its actions.
  assert.deepEqual(body.data.zones, { matches: 2, minutes: 180, actions: 10, thirds: [9, 0, 1], sides: [9, 0, 1] });
  assert.deepEqual(body.data.shots, { shots: 1, rightFoot: 0, leftFoot: 1, header: 0, other: 0, insideBox: 1 });
  // Two networks only: too few to give his share.
  assert.equal("passes" in body.data, false);
});

test("a player without a birth date of ours takes his linked profile's in the club's ages", { skip }, async () => {
  const ages = async () => (await get("/api/teams/t_aaaaa1/age-profile?season=2025/2026")).body.data.minutesByAge;
  assert.deepEqual(await ages(), [{ age: 26, minutes: 90 }, { age: null, minutes: 260 }]);
  await owner.query("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('player', 'transfermarkt', '555001', 101)");
  await owner.query("INSERT INTO core.provider_players(provider, provider_key, name, birth_date, read_on) VALUES ('transfermarkt', '555001', 'Élie Durand', '2000-01-01', '2026-11-16')");
  assert.deepEqual(await ages(), [{ age: 25, minutes: 260 }, { age: 26, minutes: 90 }]);
  // A doubted link gives no age.
  await owner.query("INSERT INTO ops.provider_links(entity_type, provider, provider_key, entity_id, rule, quarantined_at, quarantine_reason) VALUES ('player', 'transfermarkt', '555001', 101, 'unknown', now(), 'test')");
  assert.deepEqual(await ages(), [{ age: 26, minutes: 90 }, { age: null, minutes: 260 }]);
});
