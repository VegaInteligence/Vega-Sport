// /api/players/{id}/halves: a player's season by half on complete halves only (calculation
// audit of 16 Nov 2026, VI-23 B3). Written before the correction:
// docs/calculs/09-audit-2026-11/FAILURE_MODES.md §4.
//
// A half counts when its match is finished and the route's every statistic is known (xG: or
// no shot). Rows written after the seed and before the tests (the next test file seeds again):
// Moitiés Test (p_aaab30) in m1 (two complete halves, the second without a shot and so without
// xG), m3 (a first half without tackles, a second whose shot has no xG), m5 (a first half
// without touches, a complete second half of 40 minutes) and the canceled m_aaad01 (complete,
// not a match of the season). Demi Inconnu (p_aaab31) has incomplete halves only.
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { get, skip } from "./context.mjs";

const COLUMNS = ["minutes_played", "goals", "total_shots", "xg", "accurate_passes", "touches", "duels_won", "recoveries", "touches_opp_box", "dribbles_succeeded", "tackles"];
// (player, match, period, minutes, goals, shots, xg, passes, touches, duels won, recoveries, touches in the box, dribbles, tackles)
const HALVES = [
  [130, 1, "first_half", 45, 1, 2, 0.6, 10, 30, 2, 3, 4, 1, 1],
  [130, 1, "second_half", 45, 0, 0, null, 12, 25, 1, 2, 0, 0, 2],
  [130, 3, "first_half", 45, 0, 1, 0.1, 8, 20, 1, 1, 1, 0, null],
  [130, 3, "second_half", 45, 1, 1, null, 9, 22, 2, 1, 2, 1, 0],
  [130, 5, "first_half", 45, 0, 0, null, 5, null, 0, 1, 0, 0, 0],
  [130, 5, "second_half", 40, 0, 1, 0.2, 7, 18, 0, 2, 1, 2, 1],
  [130, 9301, "first_half", 45, 2, 3, 1.5, 10, 30, 3, 3, 5, 2, 2],
  [131, 1, "first_half", 45, 0, 1, null, 4, 12, 0, 1, 0, 0, 1],
  [131, 3, "second_half", 45, 0, 0, null, 6, 15, 1, null, 0, 0, 0],
];

let owner;
before(async () => {
  if (skip) return;
  owner = new pg.Client({ connectionString: process.env.VEGA_V2_API_NODE_TEST_DSN });
  await owner.connect();
  const x = (sql, values) => owner.query(sql, values);
  await x(`INSERT INTO core.matches(id,competition_season_id,season_id,source,status,home_team_id,away_team_id,match_date,kickoff_at)
           VALUES (9301,1,2025,'pitchapi','canceled',1,4,'2025-09-12','2025-09-12T19:00:00Z')`);
  await x("INSERT INTO core.provider_ids(entity_type,provider,provider_key,entity_id) VALUES ('match','pitchapi','m_aaad01',9301)");
  for (const [id, key, name] of [[130, "p_aaab30", "Moitiés Test"], [131, "p_aaab31", "Demi Inconnu"]]) {
    await x("INSERT INTO core.players(id,name) VALUES ($1,$2)", [id, name]);
    await x("INSERT INTO core.provider_ids(entity_type,provider,provider_key,entity_id) VALUES ('player','pitchapi',$1,$2)", [key, id]);
  }
  for (const [player, match, period, ...values] of HALVES)
    await x(
      `INSERT INTO core.player_match_half_stats(season_id,match_id,team_id,player_id,period,${COLUMNS.join(",")})
       VALUES (2025,$1,1,$2,$3,${COLUMNS.map((_, i) => `$${i + 4}`).join(",")})`,
      [match, player, period, ...values],
    );
});
after(() => owner?.end());

test("a season by half sums complete halves of finished matches only", { skip }, async () => {
  const { response, body } = await get("/api/players/p_aaab30/halves?season=2025/2026");
  assert.equal(response.status, 200);
  // First half: m1 only (m3 has no tackles, m5 no touches, m_aaad01 is canceled).
  assert.deepEqual(body.data.first, {
    matches: 1, minutes: 45, goals: 1, shots: 2, xg: 0.6, touches_box: 4, dribbles: 1, passes: 10, touches: 30, duels_won: 2, tackles: 1, recoveries: 3,
  });
  // Second half: m1 (no shot: no xG) and m5; m3's shot has no xG.
  assert.deepEqual(body.data.second, {
    matches: 2, minutes: 85, goals: 0, shots: 1, xg: 0.2, touches_box: 1, dribbles: 2, passes: 19, touches: 43, duels_won: 1, tackles: 3, recoveries: 4,
  });
});

test("the view counts what it left out and keeps an unknown unknown", { skip }, async () => {
  const { rows } = await owner.query(
    `SELECT period, matches, minutes, excluded_matches, excluded_minutes, chances_created FROM api.player_half_totals
     WHERE player_key=130 AND season_id=2025 ORDER BY period`,
  );
  assert.deepEqual(rows, [
    { period: "first_half", matches: 1, minutes: 45, excluded_matches: 2, excluded_minutes: 90, chances_created: null },
    { period: "second_half", matches: 2, minutes: 85, excluded_matches: 1, excluded_minutes: 45, chances_created: null },
  ]);
});

test("a player without a complete half has no season by half", { skip }, async () => {
  assert.equal((await get("/api/players/p_aaab31/halves?season=2025/2026")).response.status, 404);
});
