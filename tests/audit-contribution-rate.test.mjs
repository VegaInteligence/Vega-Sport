// The player page's minutes per goal or assist (calculation audit of 16 Nov 2026, VI-23 N9).
// Written before the correction: docs/calculs/09-audit-2026-11/FAILURE_MODES.md §6.5. The cases
// are the coordinator's seven real-browser fixtures (context/browser-contributions-red-*), three
// played matches of 90, 90 and 80 minutes; the profiles are built by the real aggregateSeason, as
// the page's KPI and competition table build theirs.
import test from "node:test";
import assert from "node:assert/strict";
import * as season from "../dashboard/frontend/src/services/season-player.js";

const PLAYER = "p_aaaab1";
/** A profile from [minutes, goals, assists] rows (null: the statistic not observed). */
function profileOf(values) {
  const rows = values.map(([minutes, goals, assists], i) => ({
    playerId: PLAYER, matchId: `m${i + 1}`, date: `2025-09-0${i + 1}`, name: "Élie Durand", team: "Club",
    teamId: "t_club", leagueId: "l_league", league: "Ligue", positionId: 91, minutes, goals, assists,
  }));
  return season.aggregateSeason(rows, PLAYER);
}
const rate = (values) => season.contributionRate(profileOf(values));

const CASES = {
  unknown_assists: { rows: [[90, 2, null], [90, 0, null], [80, 0, null]], expected: null },
  unknown_goals: { rows: [[90, null, 1], [90, null, 0], [80, null, 0]], expected: null },
  partial_assists: { rows: [[90, 2, 0], [90, 0, null], [80, 0, 1]], expected: null },
  disjoint: { rows: [[90, 2, null], [90, null, 1], [80, null, 0]], expected: null },
  complete_zero_assists: { rows: [[90, 2, 0], [90, 0, 0], [80, 0, 0]], expected: { minutes: 130, count: 2 } },
  complete_positive: { rows: [[90, 2, 1], [90, 0, 0], [80, 0, 0]], expected: { minutes: 260 / 3, count: 3 } },
  zero_contributions: { rows: [[90, 0, 0], [90, 0, 0], [80, 0, 0]], expected: null },
};

test("the seven browser fixtures: a rate only on complete goals and assists", () => {
  const wrong = [];
  for (const [name, { rows, expected }] of Object.entries(CASES)) {
    const got = rate(rows);
    const same = expected === null ? got === null
      : got !== null && got.count === expected.count && Math.abs(got.minutes - expected.minutes) < 1e-9;
    if (!same) wrong.push(`${name}: ${JSON.stringify(got)} != ${JSON.stringify(expected)}`);
  }
  assert.deepEqual(wrong, []);
});

test("the ordinary totals keep their values when the rate is unknown", () => {
  const profile = profileOf(CASES.unknown_assists.rows);
  assert.equal(season.contributionRate(profile), null);
  assert.equal(profile.matches, 3);
  assert.equal(profile.minutes, 260);
  assert.deepEqual(profile.stats.goals, { sum: 2, count: 3, minutes: 260 });
  assert.equal(profile.stats.assists, undefined);
});

test("no played match, no minutes or a non-finite figure: no rate", () => {
  assert.equal(rate([]), null, "no played match");
  assert.equal(rate([[0, 1, 1]]), null, "a substitute who did not enter");
  const complete = profileOf(CASES.complete_zero_assists.rows);
  assert.equal(season.contributionRate({ ...complete, minutes: 0 }), null, "zero minutes");
  assert.equal(season.contributionRate({ ...complete, minutes: Number.NaN }), null, "minutes not a number");
  assert.equal(season.contributionRate({ ...complete, minutes: Number.POSITIVE_INFINITY }), null, "infinite minutes");
  const nan = { ...complete, stats: { ...complete.stats, goals: { ...complete.stats.goals, sum: Number.NaN } } };
  assert.equal(season.contributionRate(nan), null, "a goal sum not a number");
  // The API's profile has the same shape (players.mjs playerProfile): counts of the played matches.
  const api = { matches: 3, minutes: 260, stats: { goals: { sum: 2, count: 3, minutes: 260 }, assists: { sum: 0, count: 3, minutes: 260 } } };
  assert.deepEqual(season.contributionRate(api), { minutes: 130, count: 2 });
  assert.equal(season.contributionRate({ ...api, stats: { goals: api.stats.goals } }), null, "assists never observed (absent)");
});
