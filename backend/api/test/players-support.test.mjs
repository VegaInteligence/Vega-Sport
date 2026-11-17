// /api/read/players: which matches make a player's season, and on which matches the
// finishing gap is read (calculation audit of 16 Nov 2026, VI-23 B1 and B2). Written before
// the corrections: docs/calculs/09-audit-2026-11/FAILURE_MODES.md §2–§3.
//
// Rows written after the seed and before the tests (the next test file seeds again):
// - Finisseur Test (p_aaab20) scores 1 goal for 1.0 xG in m1 and 4 goals in m3, where his xG
//   is unknown (no touches: the blank is not restored as a zero);
// - he plays 90 minutes of a canceled match (m_aaac01: 3 goals, 2.0 xG) and is a confirmed
//   starter of a match to come (m_aaac02, statistics not collected yet).
// Expected: his season is m1 and m3 (2 matches, 180 minutes, 5 goals, 1.0 xG, no unknown
// match); his finishing gap is read on m1 alone (0); he is not « Efficace »; the canceled
// match is still read when it is asked by its id.
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { get, skip } from "./context.mjs";

const players = "/api/read/players?season=2025/2026&leagues=all&minutes=0";
const ID = "p_aaab20";
// (id, key, status, date, statistics coverage)
const EXTRA = [
  [9201, "m_aaac01", "canceled", "2025-09-10", "ok"],
  [9202, "m_aaac02", "not_started", "2025-09-25", "pending"],
];
// (match, minutes, goals, xg, shots)
const STATS = [
  [1, 90, 1, 1.0, 3],
  [3, 90, 4, null, 5],
  [9201, 90, 3, 2.0, 4],
];

let owner;
before(async () => {
  if (skip) return;
  owner = new pg.Client({ connectionString: process.env.VEGA_V2_API_NODE_TEST_DSN });
  await owner.connect();
  const x = (sql, values) => owner.query(sql, values);
  for (const [id, key, status, day, coverage] of EXTRA) {
    await x(
      `INSERT INTO core.matches(id,competition_season_id,season_id,source,status,home_team_id,away_team_id,match_date,kickoff_at)
       VALUES ($1,1,2025,'pitchapi',$2,1,2,$3::date,$3::date + time '19:00')`,
      [id, status, day],
    );
    await x("INSERT INTO core.provider_ids(entity_type,provider,provider_key,entity_id) VALUES ('match','pitchapi',$1,$2)", [key, id]);
    await x("INSERT INTO core.match_coverage(season_id,match_id,player_stats) VALUES (2025,$1,$2)", [id, coverage]);
  }
  await x("INSERT INTO core.players(id,name) VALUES (120,'Finisseur Test')");
  await x("INSERT INTO core.provider_ids(entity_type,provider,provider_key,entity_id) VALUES ('player','pitchapi',$1,120)", [ID]);
  for (const [match, minutes, goals, xg, shots] of STATS)
    await x(
      `INSERT INTO core.player_match_stats(season_id,match_id,team_id,player_id,minutes_played,goals,xg,total_shots)
       VALUES (2025,$1,1,120,$2,$3,$4,$5)`,
      [match, minutes, goals, xg, shots],
    );
  for (const match of [1, 3, 9201, 9202])
    await x("INSERT INTO core.lineup_players(season_id,match_id,team_id,player_id,is_starter,position_id) VALUES (2025,$1,1,120,true,91)", [match]);
  // What the calculator does after a collected match of the edition.
  await x("SELECT agg.refresh_player_list(1)");
});
after(() => owner?.end());

const find = async (query) => {
  const { response, body } = await get(players + query);
  assert.equal(response.status, 200, query);
  return body.data.players.find((p) => p.id === ID) || null;
};
const close = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: ${actual} != ${expected}`);

// FM-B1.8, on both reads of a season: the calculator's rows (rollup) and the appearances
// worked out for a filtered request (from=: every match of the season is after it).
for (const [label, query] of [["rollup", "&q=finisseur"], ["appearances", "&q=finisseur&from=2025-08-01"]])
  test(`a season is its finished matches (${label})`, { skip }, async () => {
    const p = await find(query);
    assert.ok(p, "the player is listed");
    assert.deepEqual(
      [p.matches, p.profile.minutes, p.profile.unknownMinutes, p.profile.starts, p.profile.knownStarts],
      [2, 180, 0, 2, 2],
    );
    assert.deepEqual(p.totals, { goals: 5, assists: null, xg: 1 });
    assert.deepEqual(p.profile.stats.goals, { sum: 5, count: 2, minutes: 180 });
    assert.deepEqual(p.profile.stats.xg, { sum: 1, count: 1, minutes: 90 });
  });

// FM-B2.1: the gap is read on the matches where both goals and xG are known (m1: 1 − 1.0).
for (const [label, query] of [["rollup", "&q=finisseur"], ["appearances", "&q=finisseur&from=2025-08-01"]])
  test(`the finishing gap is paired, on every basis (${label})`, { skip }, async () => {
    for (const basis of ["total", "perMatch", "per90"]) {
      const p = await find(`${query}&basis=${basis}`);
      close(p.finishingDelta, 0, `${label} ${basis}`);
    }
    const p = await find(query);
    assert.deepEqual(p.profile.stats.finishing, { sum: 0, count: 1, minutes: 90, goals: 1, xg: 1 });
  });

// FM-B2.2: « Efficaces » needs four goals on matches whose xG is known; he has one.
test("the clinical ranking reads the paired support", { skip }, async () => {
  for (const basis of ["total", "perMatch"]) {
    const { body } = await get(`${players}&ranking=clinical&basis=${basis}`);
    assert.equal(body.data.players.some((p) => p.id === ID), false, basis);
  }
});

// BC: one match asked by its id is read as it is, whatever its status.
test("a canceled match asked by its id still gives its figures", { skip }, async () => {
  const p = await find("&match=m_aaac01");
  assert.ok(p, "the player of the canceled match is listed");
  assert.deepEqual([p.matches, p.goals, p.xg], [1, 3, 2]);
});
