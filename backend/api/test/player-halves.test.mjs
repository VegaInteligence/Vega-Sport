// /api/players/{id}/halves: a player's season by half on complete halves only (calculation
// audit of 16 Nov 2026, VI-23 B3), and each metric's own coverage (audit 15c, 137). Written
// before the corrections: docs/calculs/09-audit-2026-11/FAILURE_MODES.md §4 and §4.1.
//
// A half is eligible when its match is finished and its minutes are positive; it is complete
// when the route's every statistic is known (xG: or no shot). The rows (test/half-fixture.mjs)
// are written after the seed and before the tests; the next test file seeds again.
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { createReader } from "../src/db.mjs";
import { createHandler } from "../src/handler.mjs";
import { context, get, skip } from "./context.mjs";
import { writeHalves } from "./half-fixture.mjs";

// The route's metrics, in the order of the coverage rows below.
const METRICS = ["goals", "shots", "xg", "touches_box", "dribbles", "passes", "touches", "duels_won", "tackles", "recoveries"];
const NONE = [null, 0, 0];
/** One half's coverage: its eligible halves, those left out of the totals, and [sum, count, minutes] per metric. */
const covered = ([matches, minutes], [excludedMatches, excludedMinutes], values) => ({
  matches, minutes, excluded: { matches: excludedMatches, minutes: excludedMinutes },
  stats: Object.fromEntries(METRICS.map((key, i) => [key, { sum: values[i][0], count: values[i][1], minutes: values[i][2] }])),
});
const halves = async (key) => {
  const { response, body } = await get(`/api/players/${key}/halves?season=2025/2026`);
  assert.equal(response.status, 200, key);
  return body.data;
};
const per90 = (stat) => (stat.minutes > 0 ? Math.round((900 * stat.sum) / stat.minutes) / 10 : null);

let owner;
before(async () => {
  if (skip) return;
  owner = new pg.Client({ connectionString: process.env.VEGA_V2_API_NODE_TEST_DSN });
  await owner.connect();
  await writeHalves(owner);
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

test("each metric is summed on the halves that publish it, with their own minutes (FM-HC.1, FM-HC.4)", { skip }, async () => {
  const data = await halves("p_aaab30");
  // First half: m1, m3 and m5 (m_aaad01 canceled); m3 publishes no tackles, m5 no touches.
  assert.deepEqual(data.coverage.first, covered([3, 135], [2, 90], [
    [1, 3, 135], [3, 3, 135], [0.7, 3, 135], [5, 3, 135], [1, 3, 135], [23, 3, 135], [50, 2, 90], [3, 3, 135], [1, 2, 90], [5, 3, 135],
  ]));
  // Second half: m3's shot has no xG; m1's half without a shot is a zero xG.
  assert.deepEqual(data.coverage.second, covered([3, 130], [1, 45], [
    [1, 3, 130], [2, 3, 130], [0.2, 2, 85], [3, 3, 130], [3, 3, 130], [28, 3, 130], [65, 3, 130], [3, 3, 130], [3, 3, 130], [5, 3, 130],
  ]));
  // Rates on each metric's own minutes: 50 touches in 90 minutes is 50 per 90 (not 33.3 on 135),
  // 23 passes in 135 minutes 15.3 per 90.
  assert.deepEqual([per90(data.coverage.first.stats.touches), per90(data.coverage.first.stats.passes), per90(data.coverage.first.stats.tackles)], [50, 15.3, 1]);
  // The totals keep their complete halves: what they left out is the coverage's exclusion.
  for (const side of ["first", "second"]) {
    assert.equal(data[side].matches, data.coverage[side].matches - data.coverage[side].excluded.matches);
    assert.equal(data[side].minutes, data.coverage[side].minutes - data.coverage[side].excluded.minutes);
  }
});

test("a player without a complete half has his observed statistics and no totals (FM-HC.2)", { skip }, async () => {
  // Prior contract (VI-23 B3, 129): 404, the route publishing complete halves only. The audit's
  // requirement (15c: coverage and observed minutes per metric) supersedes it for a player who
  // played: what was observed is served, the totals stay null.
  const data = await halves("p_aaab31");
  assert.deepEqual([data.first, data.second], [null, null]);
  // First half: a shot without xG, so the xG alone is unmeasured.
  assert.deepEqual(data.coverage.first, covered([1, 45], [1, 45], [
    [0, 1, 45], [1, 1, 45], NONE, [0, 1, 45], [0, 1, 45], [4, 1, 45], [12, 1, 45], [0, 1, 45], [1, 1, 45], [1, 1, 45],
  ]));
  // Second half: no shot (xG 0), recoveries unpublished.
  assert.deepEqual(data.coverage.second, covered([1, 45], [1, 45], [
    [0, 1, 45], [0, 1, 45], [0, 1, 45], [0, 1, 45], [0, 1, 45], [6, 1, 45], [15, 1, 45], [1, 1, 45], [0, 1, 45], NONE,
  ]));
});

test("a published metric is served alone, the unpublished ones stay unknown (FM-HC.1, FM-HC.3)", { skip }, async () => {
  const data = await halves("p_aaab32");
  assert.deepEqual([data.first, data.second], [null, null]);
  // Its only played half: 14 passes in 45 minutes, nothing else published (no shot count: no xG).
  assert.deepEqual(data.coverage.first, covered([1, 45], [1, 45], [NONE, NONE, NONE, NONE, NONE, [14, 1, 45], NONE, NONE, NONE, NONE]));
  // Its second halves have 0 and unknown minutes: not played.
  assert.equal(data.coverage.second, null);
});

test("an xG is known when finite, or blank on a half without a shot (FM-HC.5)", { skip }, async () => {
  const data = await halves("p_aaab33");
  // First half: NaN without a shot, +∞ and −∞ with shots: three unknown xG, never 0 or NaN.
  assert.equal(data.first, null);
  assert.deepEqual(data.coverage.first, covered([3, 135], [3, 135], [
    [1, 3, 135], [3, 3, 135], NONE, [3, 3, 135], [1, 3, 135], [18, 3, 135], [33, 3, 135], [2, 3, 135], [1, 3, 135], [4, 3, 135],
  ]));
  // Second half: m3's shots are unknown, so its blank xG is unknown too; m1 is complete.
  assert.deepEqual(data.second, {
    matches: 1, minutes: 45, goals: 0, shots: 1, xg: 0.4, touches_box: 1, dribbles: 0, passes: 8, touches: 13, duels_won: 1, tackles: 0, recoveries: 1,
  });
  assert.deepEqual(data.coverage.second, covered([2, 90], [1, 45], [
    [0, 2, 90], [1, 1, 45], [0.4, 1, 45], [1, 2, 90], [1, 2, 90], [17, 2, 90], [27, 2, 90], [1, 2, 90], [1, 2, 90], [3, 2, 90],
  ]));
});

test("a measured zero is a zero, an unmeasured half is unknown (FM-HC.3)", { skip }, async () => {
  const zero = await halves("p_aaab36");
  assert.deepEqual(zero.first, {
    matches: 1, minutes: 45, goals: 0, shots: 0, xg: 0, touches_box: 0, dribbles: 0, passes: 0, touches: 0, duels_won: 0, tackles: 0, recoveries: 0,
  });
  assert.deepEqual(zero.coverage, { first: covered([1, 45], [0, 0], METRICS.map(() => [0, 1, 45])), second: null });
  // Played halves with no statistic: served as played, every metric unknown.
  const blank = await halves("p_aaab34");
  assert.deepEqual([blank.first, blank.second], [null, null]);
  assert.deepEqual(blank.coverage, {
    first: covered([1, 45], [1, 45], METRICS.map(() => NONE)),
    second: covered([1, 30], [1, 30], METRICS.map(() => NONE)),
  });
});

test("a player without a played half of a finished match has no season by half (FM-HC.6)", { skip }, async () => {
  // A canceled match, a match not started and a 0-minute half: no half of the season.
  assert.equal((await get("/api/players/p_aaab35/halves?season=2025/2026")).response.status, 404);
  assert.equal((await get("/api/players/p_aaab30/halves?season=2024/2025")).response.status, 404);
  assert.equal((await get("/api/players/p_aaab30/halves")).response.status, 400);
});

test("the coverage's exclusions are those of the complete halves' view (FM-HC.9)", { skip }, async () => {
  const { rows } = await owner.query(
    `SELECT c.season_id, c.player_key, c.period, c.matches, c.minutes, c.excluded_matches, c.excluded_minutes,
            t.matches AS kept, t.minutes AS kept_minutes, t.excluded_matches AS t_excluded, t.excluded_minutes AS t_excluded_minutes
     FROM api.player_half_coverage c FULL JOIN api.player_half_totals t USING (season_id, player_key, period)
     ORDER BY 1, 2, 3`,
  );
  // Every group of the totals has its coverage; a group without a complete half has a coverage
  // only (the seed's p_aaaab1 included: players.test.mjs).
  assert.deepEqual(rows.map((r) => [r.player_key, r.period, r.kept]), [
    [101, "first_half", null], [101, "second_half", null], [130, "first_half", 1], [130, "second_half", 2], [131, "first_half", null], [131, "second_half", null], [132, "first_half", null],
    [133, "first_half", null], [133, "second_half", 1], [134, "first_half", null], [134, "second_half", null], [136, "first_half", 1],
    [137, "first_half", 3], [137, "second_half", 1],
  ]);
  for (const r of rows) {
    assert.equal(r.matches - r.excluded_matches, r.kept ?? 0, `${r.player_key} ${r.period}`);
    assert.equal(r.minutes - r.excluded_minutes, r.kept_minutes ?? 0, `${r.player_key} ${r.period}`);
    if (r.kept !== null) assert.deepEqual([r.excluded_matches, r.excluded_minutes], [r.t_excluded, r.t_excluded_minutes]);
  }
  // The read role reads it.
  assert.equal((await context.reader.read("SELECT count(*)::int AS n FROM api.player_half_coverage"))[0].n, rows.length);
});

test("the route reads the asked player's season only, in one statement (FM-HC.8)", { skip }, async () => {
  const statements = [];
  const handle = createHandler({
    read: (sql, values, options) => (statements.push({ sql, values }), context.reader.read(sql, values, options)),
    mediaBase: "https://media.test/", clock: () => context.now,
  });
  const response = await handle(new Request("https://api.test/api/players/p_aaab30/halves?season=2025/2026"));
  assert.equal(response.status, 200);
  assert.equal(statements.length, 1);
  const [{ "QUERY PLAN": [plan] }] = (await owner.query(`EXPLAIN (FORMAT JSON) ${statements[0].sql}`, statements[0].values)).rows;
  // Every scan of the half statistics is filtered by the player below the views' aggregates.
  const scans = [];
  (function walk(node) {
    if (/^player_match_half_stats/.test(node["Relation Name"] || "")) scans.push(node);
    for (const child of node.Plans || []) walk(child);
  })(plan.Plan);
  assert.ok(scans.length > 0);
  for (const scan of scans) assert.match([scan["Index Cond"], scan["Recheck Cond"], scan.Filter].join(" "), /\bplayer_id = /, JSON.stringify(scan));
});

test("a stored xG is summed at its own digits and converted once (FM-HC.10, FM-HC.12)", { skip }, async () => {
  const data = await halves("p_aaab37");
  // The totals keep 129's float sums rounded to 2 decimals.
  assert.deepEqual([data.first.matches, data.first.xg, data.second.matches, data.second.xg], [3, 1.36, 1, 0.12]);
  // Three values: 0.12345679 + 1.2345678 + a half without a shot. Not 1.358027 (each value read at
  // 6 significant digits) nor 1.3580245524644852 (the stored binary values summed).
  assert.deepEqual(data.coverage.first, covered([3, 135], [0, 0], [
    [1, 3, 135], [3, 3, 135], [1.35802459, 3, 135], [2, 3, 135], [1, 3, 135], [18, 3, 135], [33, 3, 135], [2, 3, 135], [1, 3, 135], [4, 3, 135],
  ]));
  // One value beside a shot without xG and a NaN: 0.12345679 (not 0.123457) on its own half.
  assert.deepEqual(data.coverage.second, covered([3, 135], [2, 90], [
    [0, 3, 135], [3, 3, 135], [0.12345679, 1, 45], [2, 3, 135], [1, 3, 135], [21, 3, 135], [36, 3, 135], [2, 3, 135], [1, 3, 135], [3, 3, 135],
  ]));
  for (const side of ["first", "second"]) assert.equal(typeof data.coverage[side].stats.xg.sum, "number");
});

test("the answer and its ETag do not depend on the session's extra_float_digits (FM-HC.11)", { skip }, async () => {
  // The same reader as production's (vega_read, createReader), each session set to 0, 1 or 3.
  const answers = {};
  for (const digits of [0, 1, 3]) {
    const Pool = class extends pg.Pool {
      constructor(config) { super({ ...config, options: `${config.options} -c extra_float_digits=${digits}` }); }
    };
    const reader = createReader(process.env.VEGA_V2_API_NODE_TEST_DSN, { role: "vega_read", Pool });
    try {
      const handle = createHandler({ read: reader.read, mediaBase: "https://media.test/", clock: () => context.now });
      const [setting] = await reader.read("SELECT current_setting('extra_float_digits') AS digits");
      assert.equal(setting.digits, String(digits));
      for (const key of ["p_aaab37", "p_aaab30"]) {
        const response = await handle(new Request(`https://api.test/api/players/${key}/halves?season=2025/2026`));
        assert.equal(response.status, 200);
        (answers[key] ??= []).push({ digits, etag: response.headers.get("etag"), body: await response.text() });
      }
    } finally {
      await reader.end();
    }
  }
  for (const [key, runs] of Object.entries(answers)) {
    for (const run of runs.slice(1)) {
      assert.equal(run.body, runs[0].body, `${key} at extra_float_digits ${run.digits}`);
      assert.equal(run.etag, runs[0].etag, `${key} at extra_float_digits ${run.digits}`);
    }
  }
  const coverage = JSON.parse(answers.p_aaab37[0].body).data.coverage;
  assert.deepEqual([coverage.first.stats.xg.sum, coverage.second.stats.xg.sum], [1.35802459, 0.12345679]);
});
