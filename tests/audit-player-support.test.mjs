// The players' directory and profile on the browser's side: the finishing gap on its own
// support, and a percentile only where the metric itself has enough peers (calculation audit
// of 16 Nov 2026, VI-23 B2 and B5). Written before the corrections:
// docs/calculs/09-audit-2026-11/FAILURE_MODES.md §3 and §6.1.
import test from "node:test";
import assert from "node:assert/strict";
import { aggregateSeasonPlayers, seasonMetric } from "../dashboard/frontend/src/services/season-player.js";
import { playerAverage } from "../dashboard/frontend/src/services/player-directory.js";
import { rankSeasonPlayers } from "../dashboard/frontend/src/services/player-leaderboard.js";
import { performanceProfileFromCounts } from "../dashboard/shared/player-profile.js";
import { performanceProfile } from "../dashboard/frontend/src/services/player-profile.js";

let day = 0;
const appearance = (playerId, goals, xg, extra = {}) => ({
  playerId, matchId: `m_${playerId}_${++day}`, name: playerId.toUpperCase(), date: `2026-0${1 + (day % 9)}-1${day % 9}`,
  team: "Club", teamId: "t_club", leagueId: "l_league", league: "Ligue", positionId: 91, minutes: 90, goals, xg, ...extra,
});
const repeat = (n, make) => Array.from({ length: n }, make);
const profiles = (rows) => Object.fromEntries(aggregateSeasonPlayers(rows).map((p) => [p.id, p]));
const close = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-12, `${label}: ${actual} != ${expected}`);

test("the audit's player: 1 goal for 1.0 xG, then 4 goals with an unknown xG", () => {
  const { p1 } = profiles([appearance("p1", 1, 1), appearance("p1", 4, null)]);
  // The ordinary totals keep their definitions.
  assert.equal(seasonMetric(p1, "goals").value, 5);
  assert.equal(seasonMetric(p1, "xg").value, 1);
  // « Efficaces » needs four goals where xG is known: he has one.
  assert.deepEqual(rankSeasonPlayers([playerAverage(p1, "total")], "clinical"), []);
  // The gap's own support: the one match where both are known.
  assert.deepEqual(p1.stats.finishing, { sum: 0, count: 1, minutes: 90, goals: 1, xg: 1 });
  for (const basis of ["total", "perMatch", "per90"]) {
    close(seasonMetric(p1, "finishing", basis).value, 0, `seasonMetric ${basis}`);
    close(playerAverage(p1, basis).finishingDelta, 0, `playerAverage ${basis}`);
  }
});

test("the clinical and wasteful lists are ordered by the paired gap", () => {
  const rows = [
    // A: +2 on the four matches with xG, +8 if the six uncovered goals were counted.
    ...repeat(4, () => appearance("pA", 1, 0.5)),
    ...repeat(3, () => appearance("pA", 2, null)),
    // B: +3 on five covered matches.
    ...repeat(5, () => appearance("pB", 1, 0.4)),
    // C: −4 on four covered matches. D: 2.0 xG where his goals are known, 4.0 more where not.
    ...repeat(4, () => appearance("pC", 0, 1)),
    ...repeat(2, () => appearance("pD", 0, 1)),
    ...repeat(2, () => appearance("pD", null, 2)),
  ];
  const p = profiles(rows);
  for (const basis of ["total", "perMatch"]) {
    const ids = (key) => rankSeasonPlayers(Object.values(p).map((profile) => playerAverage(profile, basis)), key).map((r) => r.id);
    assert.deepEqual(ids("clinical"), ["pB", "pA"], `clinical ${basis}`);
    assert.deepEqual(ids("wasteful"), ["pC"], `wasteful ${basis}`);
  }
  close(seasonMetric(p.pA, "finishing", "perMatch").value, 0.5, "A per match");
  close(seasonMetric(p.pA, "finishing", "per90").value, (90 * 2) / 360, "A per 90");
});

test("the home's season totals, already strict, still rank (BC)", () => {
  const totals = [{ name: "H", playerId: "pH", goals: 6, xg: 3, xa: null, assists: 1 }];
  assert.deepEqual(rankSeasonPlayers(totals, "clinical").map((r) => r.playerId), ["pH"]);
});

// ------------------------------------------------------------------ percentiles (13c)

const percentiles = (profile) => Object.fromEntries(profile.sections.flatMap((s) => s.metrics).map((m) => [m.key, m.percentile]));
const counts = (metrics) => ({ peers: 100, metrics });
const midrank = (below, equal, known) => Math.round(((below + equal / 2) / known) * 100);

test("a metric known for one peer of a hundred has no percentile", () => {
  const row = { positionId: 91, minutes: 90, xg: 2, shots: 3 };
  const got = percentiles(performanceProfileFromCounts(row, counts({ xg: { known: 1, below: 0, equal: 1 }, shots: { known: 100, below: 50, equal: 1 } })));
  assert.equal(got.xg, null);
  assert.equal(got.shots, midrank(50, 1, 100));
});

test("the metric's own support: the threshold, ties, an observed zero, a derived rate", () => {
  const row = { positionId: 91, minutes: 90, xg: 2, shots: 3, duelsWon: 3, duelsLost: 1 };
  const at = (known, extra = {}) => percentiles(performanceProfileFromCounts(row, counts({ xg: { known, below: 10, equal: 2 }, ...extra })));
  assert.equal(at(29).xg, null);
  assert.equal(at(30).xg, midrank(10, 2, 30));
  // Everyone tied: the middle.
  assert.equal(percentiles(performanceProfileFromCounts(row, counts({ xg: { known: 30, below: 0, equal: 30 } }))).xg, 50);
  // An observed zero (no shot: xG 0) is a value, ranked when the metric has its peers.
  const quiet = { positionId: 91, minutes: 90, shots: 0 };
  assert.equal(percentiles(performanceProfileFromCounts(quiet, counts({ xg: { known: 40, below: 0, equal: 10 } }))).xg, 13);
  // A derived rate counts the peers whose rate exists.
  assert.equal(at(30, { duelRate: { known: 10, below: 5, equal: 1 } }).duelRate, null);
  assert.equal(at(30, { duelRate: { known: 35, below: 5, equal: 1 } }).duelRate, midrank(5, 1, 35));
  // Fewer than thirty peers in all: nothing is ranked (BC).
  const few = performanceProfileFromCounts(row, { peers: 29, metrics: { xg: { known: 29, below: 1, equal: 1 } } });
  assert.ok(few.sections.flatMap((s) => s.metrics).every((m) => m.percentile === null));
});

test("the browser's distributions rank a metric on its own known values only", () => {
  const peers = Array.from({ length: 40 }, (_, i) => ({
    playerId: `p${i}`, matchId: `m${i}`, positionId: 91, minutes: 90, shots: 1 + i, xg: i < 5 ? 0.1 * (i + 1) : null,
    duelsWon: 2, duelsLost: i < 10 ? 2 : null, passesAccurate: 20, passesAttempted: 25,
  }));
  const target = { positionId: 91, minutes: 90, shots: 10, xg: 0.3, duelsWon: 3, duelsLost: 1, passesAccurate: 20, passesAttempted: 25 };
  const got = percentiles(performanceProfile(target, peers));
  assert.equal(got.shots, midrank(9, 1, 40));
  assert.equal(got.xg, null); // five peers know their xG
  assert.equal(got.duelRate, null); // ten peers know their duel rate
  assert.equal(got.passAccuracy, 50); // forty, all tied
});
