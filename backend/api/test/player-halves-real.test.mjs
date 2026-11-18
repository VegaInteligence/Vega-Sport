// A season by half and each metric's coverage on a real match: the provider's own halves of
// m_08LEIz (FC Orenburg–CSKA Moscow, Russian Premier League, 1 November 2026,
// backend/tests/fixtures/match_m_08LEIz), written by the collector's path (test/seed_match.py:
// normalize_family, then Store). Written before the correction:
// docs/calculs/09-audit-2026-11/FAILURE_MODES.md §4.1.
import { before, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { get, skip } from "./context.mjs";

// The shared seed runs first (context.mjs); this file's database is the real match only.
before(() => {
  if (skip) return;
  const seed = spawnSync("python3", [fileURLToPath(new URL("./seed_match.py", import.meta.url)), process.env.VEGA_V2_API_NODE_TEST_DSN], { encoding: "utf8" });
  assert.equal(seed.status, 0, seed.stderr);
});
const SEASON = "2026/2027";
const PLAYERS = JSON.parse(readFileSync(new URL("../../tests/fixtures/match_m_08LEIz/players_halves.json", import.meta.url), "utf8"))
  .data.players.map((p) => p.player.id);
const METRICS = ["goals", "shots", "xg", "touches_box", "dribbles", "passes", "touches", "duels_won", "tackles", "recoveries"];
const NONE = [null, 0, 0];
const covered = ([matches, minutes], [excludedMatches, excludedMinutes], values) => ({
  matches, minutes, excluded: { matches: excludedMatches, minutes: excludedMinutes },
  stats: Object.fromEntries(METRICS.map((key, i) => [key, { sum: values[i][0], count: values[i][1], minutes: values[i][2] }])),
});
const halves = (key) => get(`/api/players/${key}/halves?season=${SEASON}`);

test("the goalkeepers, whose halves publish no touches, keep their other statistics", { skip }, async () => {
  // Prior contract (129): 404, neither has a complete half. Each half: 45 minutes, no shot (xG 0),
  // no touches published; passes, duels won and recoveries as the source gives them.
  const keeper = ([passes, duels, recoveries]) =>
    covered([1, 45], [1, 45], [[0, 1, 45], [0, 1, 45], [0, 1, 45], [0, 1, 45], [0, 1, 45], [passes, 1, 45], NONE, [duels, 1, 45], [0, 1, 45], [recoveries, 1, 45]]);
  for (const [key, first, second] of [["p_4McHHL", [2, 0, 6], [7, 2, 6]], ["p_3yNPPF", [6, 2, 9], [5, 1, 5]]]) {
    const { response, body } = await halves(key);
    assert.equal(response.status, 200, key);
    assert.deepEqual(body.data, { id: key, season: SEASON, first: null, second: null, coverage: { first: keeper(first), second: keeper(second) } });
  }
});

test("a player with complete halves keeps his totals, which his coverage equals", { skip }, async () => {
  const { response, body } = await halves("p_02x0dj");
  assert.equal(response.status, 200);
  const first = { matches: 1, minutes: 45, goals: 0, shots: 3, xg: 0.28, touches_box: 4, dribbles: 3, passes: 6, touches: 24, duels_won: 9, tackles: 0, recoveries: 2 };
  const second = { matches: 1, minutes: 34, goals: 0, shots: 0, xg: 0, touches_box: 2, dribbles: 0, passes: 3, touches: 13, duels_won: 2, tackles: 0, recoveries: 0 };
  const same = (half) => covered([1, half.minutes], [0, 0], METRICS.map((key) => [half[key], 1, half.minutes]));
  assert.deepEqual(body.data, { id: "p_02x0dj", season: SEASON, first, second, coverage: { first: same(first), second: same(second) } });
});

test("a half of 0 minutes is not a played half, even with a touch", { skip }, async () => {
  // Egor Nazarenko's only row: the second half, 0 minutes, 1 touch and 1 accurate pass.
  assert.equal((await halves("p_3o0rP8")).response.status, 404);
});

test("over the match's players, the totals keep their complete halves and the coverage the rest", { skip }, async () => {
  const sum = () => ({ matches: 0, minutes: 0, excluded: 0, excludedMinutes: 0, kept: 0, keptMinutes: 0, passes: [0, 0, 0], touches: [0, 0, 0], xg: 0 });
  const total = { first: sum(), second: sum() };
  let served = 0;
  for (const key of PLAYERS) {
    const { response, body } = await halves(key);
    if (response.status === 404) continue;
    assert.equal(response.status, 200, key);
    served++;
    for (const side of ["first", "second"]) {
      const cover = body.data.coverage[side], kept = body.data[side];
      if (!cover) {
        assert.equal(kept, null, key);
        continue;
      }
      const t = total[side];
      t.matches += cover.matches;
      t.minutes += cover.minutes;
      t.excluded += cover.excluded.matches;
      t.excludedMinutes += cover.excluded.minutes;
      t.kept += kept?.matches ?? 0;
      t.keptMinutes += kept?.minutes ?? 0;
      for (const metric of ["passes", "touches"]) {
        const s = cover.stats[metric];
        t[metric] = [t[metric][0] + (s.sum ?? 0), t[metric][1] + s.count, t[metric][2] + s.minutes];
      }
      t.xg += cover.stats.xg.sum ?? 0;
      // The totals are the complete halves; with nothing left out, each metric's coverage is the total.
      assert.equal(kept?.matches ?? 0, cover.matches - cover.excluded.matches, key);
      assert.equal(kept?.minutes ?? 0, cover.minutes - cover.excluded.minutes, key);
      if (!cover.excluded.matches)
        for (const metric of METRICS) assert.deepEqual(cover.stats[metric], { sum: kept[metric], count: kept.matches, minutes: kept.minutes }, `${key} ${side} ${metric}`);
    }
  }
  assert.equal(served, 28);
  total.first.xg = Math.round(total.first.xg * 100) / 100;
  total.second.xg = Math.round(total.second.xg * 100) / 100;
  assert.deepEqual(total, {
    first: { matches: 22, minutes: 990, excluded: 2, excludedMinutes: 90, kept: 20, keptMinutes: 900, passes: [226, 22, 990], touches: [460, 20, 900], xg: 1.11 },
    second: { matches: 28, minutes: 990, excluded: 2, excludedMinutes: 90, kept: 26, keptMinutes: 900, passes: [185, 28, 990], touches: [452, 26, 900], xg: 0.49 },
  });
});

test("a stored xG with eight significant digits reaches the answer as stored (Astra's probe)", { skip }, async () => {
  // Damián Puebla's first half with the stored value of 0.12345679 in place of the source's 0.28
  // (tracks/1-linear/reviews/astra62-final-current/precision-check.py): the answer was 0.123457.
  const owner = new pg.Client({ connectionString: process.env.VEGA_V2_API_NODE_TEST_DSN });
  await owner.connect();
  const set = (value) =>
    owner.query(
      `UPDATE core.player_match_half_stats SET xg=$1::real WHERE player_id=api.internal_id('player','p_02x0dj') AND period='first_half'
       RETURNING xg::text AS stored`,
      [value],
    );
  try {
    const { rows: [previous] } = await owner.query(
      "SELECT xg::text AS stored FROM core.player_match_half_stats WHERE player_id=api.internal_id('player','p_02x0dj') AND period='first_half'");
    assert.deepEqual((await set("0.12345679")).rows, [{ stored: "0.12345679" }]);
    const { response, body } = await halves("p_02x0dj");
    assert.equal(response.status, 200);
    assert.deepEqual(body.data.coverage.first.stats.xg, { sum: 0.12345679, count: 1, minutes: 45 });
    assert.equal(body.data.first.xg, 0.12);
    assert.deepEqual((await set(previous.stored)).rows, [previous]);
  } finally {
    await owner.end();
  }
});
