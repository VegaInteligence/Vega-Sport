// One rule for every reader of a match grade, and the grade's status by key
// (docs/calculs/09-audit-2026-11/FAILURE_MODES.md §38, 38e and 38f, written before the change).
//
// A grade is shown from 20 minutes, or below them when |z| >= 1; otherwise it is null. Before
// §38 the match board read api.match_grades.grade unmasked: a 7-minute cameo showed a grade the
// performance page, the player's matches and the match ranking all hid.
import { before, test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { get, skip } from "./context.mjs";

const MATCH = "m_aaaaa1";
const grade = (z) => 100 / (1 + 10 ** (-z / 4));
const boardGrade = (rows, player) => {
  const row = rows.find((r) => r.player.id === player);
  assert.ok(row, player);
  const stat = Object.values(row.stats).flatMap((group) => Object.values(group.stats)).find((s) => s.key === "vega_grade");
  return stat ? stat.stat.value : null;
};

before(async () => {
  if (skip) return;
  // Cristiano Test's 70 minutes of match 1 become a 7-minute cameo, ordinary for his role (z = 0.3).
  const owner = new pg.Client({ connectionString: process.env.VEGA_V2_API_NODE_TEST_DSN });
  await owner.connect();
  try {
    await owner.query("UPDATE core.player_match_stats SET minutes_played=7 WHERE season_id=2025 AND match_id=1 AND player_id=104");
    const { rowCount } = await owner.query("UPDATE agg.player_match_grades SET minutes=7, z=0.3, first_z=0.3 WHERE season_id=2025 AND match_id=1 AND player_id=104");
    assert.equal(rowCount, 1);
  } finally {
    await owner.end();
  }
});

test("38e: the board hides the grade the other readers hide, and keeps the others", { skip }, async () => {
  const { response, body } = await get(`/api/matches/${MATCH}/players`);
  assert.equal(response.status, 200);
  const rows = body.data;
  assert.equal(boardGrade(rows, "p_aaaab4"), null);
  assert.ok(Math.abs(boardGrade(rows, "p_aaaab1") - grade(2.5)) < 1e-3);
  // The ranking and the performance page agree: no grade for the cameo.
  const ranking = await get(`/api/rankings/match?match=${MATCH}`);
  const cameo = ranking.body.grades.find((g) => g.playerId === "p_aaaab4");
  assert.deepEqual([cameo.grade, cameo.rank], [null, null]);
  const performance = await get(`/api/read/performance?season=2025/2026&leagues=all&appearance=${MATCH}:p_aaaab4`);
  assert.equal(performance.response.status, 200);
  assert.equal(performance.body.data.row.grade, null);
});

test("38f: the performance read names the grade's status of its key", { skip }, async () => {
  const status = async (appearance) => {
    const { response, body } = await get(`/api/read/performance?season=2025/2026&leagues=all&appearance=${appearance}`);
    assert.equal(response.status, 200, appearance);
    return body.data.gradeStatus;
  };
  assert.equal(await status(`${MATCH}:p_aaaab1`), "graded");
  assert.equal(await status(`${MATCH}:p_aaaab4`), "below_display_threshold");
  assert.equal(await status("m_aaaaa5:p_aaaab2"), "no_minutes");
});
