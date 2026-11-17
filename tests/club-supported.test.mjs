// What the club page shows side by side must stand on the same matches (VI-22, handoff of the
// VI-23 calculation audit). Written before services/club-supported.js. Expected behaviour:
//
// - Points beside xPts: the points of the matches whose xPts is known, never the season's points
//   beside the xPts of fewer matches. Unknown (null) when no match has an xPts.
// - xG for beside xG against, and their difference: on the matches that know both.
// - Goals beside xG: goals for and xG for on the matches whose xG for is known; conceded and xG
//   against on those whose xG against is known.
// - A season total of a per-match indicator (finishing, keeper, placement): its mean times the
//   matches that support it, never times every match; unknown when none does; a known 0 stays 0.
// - The service's own fields win when it gives them (VI-23's pairedFields and coverage); without
//   them the same definitions are read on the club's match rows.
// - A sum with an unknown term is unknown; known zeros stay zero.
import assert from "node:assert/strict";
import test from "node:test";
import {
  goalsBesideXg,
  pairedPoints,
  pairedXg,
  seasonTotal,
  sumKnown,
} from "../dashboard/frontend/src/services/club-supported.js";

const row = (points, gf, ga, own, opp) => ({
  points,
  gf,
  ga,
  own,
  opp,
  xpts: own?.xg != null && opp?.xg != null ? points / 2 : null,
});
// Three matches: the first knows both xG, the second only its own, the third neither.
const rows = [
  row(3, 2, 0, { xg: 1.5, xgot: 1.9 }, { xg: 0.5, xgot: 0.4 }),
  row(1, 1, 1, { xg: 0.7, xgot: null }, { xg: null, xgot: null }),
  row(0, 0, 2, null, null),
];
const club = { record: { matches: 3, points: 4, gf: 3, ga: 3 }, rows, values: {} };

test("points beside xPts stand on the matches whose xPts is known", () => {
  assert.deepEqual(pairedPoints(club), { matches: 1, actual: 3, expected: 1.5, delta: 1.5 });
  assert.deepEqual(pairedPoints({ ...club, rows: [rows[2]] }), { matches: 0, actual: null, expected: null, delta: null });
  // The service's paired fields win over the rows.
  assert.deepEqual(
    pairedPoints({ ...club, pairedMatches: 2, pairedActualPoints: 4, pairedExpectedPoints: 2.5, pairedPointsDelta: 1.5 }),
    { matches: 2, actual: 4, expected: 2.5, delta: 1.5 },
  );
});

test("xG for, against and their difference on the matches that know both", () => {
  assert.deepEqual(pairedXg(club), { matches: 1, xgFor: 1.5, xgAgainst: 0.5, delta: 1, perMatch: 1 });
  assert.deepEqual(pairedXg({ ...club, rows: [] }), { matches: 0, xgFor: null, xgAgainst: null, delta: null, perMatch: null });
  assert.deepEqual(
    pairedXg({ ...club, pairedXgMatches: 4, pairedXgFor: 6, pairedXgAgainst: 2, pairedXgDelta: 4, pairedXgDeltaPerMatch: 1 }),
    { matches: 4, xgFor: 6, xgAgainst: 2, delta: 4, perMatch: 1 },
  );
});

test("goals beside xG on the matches whose xG of that side is known", () => {
  // For: matches 1 and 2 know their own xG (2 + 1 goals, 1.5 + 0.7 xG); against: only match 1.
  const goals = goalsBesideXg(club);
  assert.equal(goals.for.matches, 2);
  assert.equal(goals.for.goals, 3);
  assert.ok(Math.abs(goals.for.xg - 2.2) < 1e-9);
  assert.ok(Math.abs(goals.for.delta - 0.8) < 1e-9);
  assert.deepEqual(goals.against, { matches: 1, goals: 0, xg: 0.5, delta: -0.5 });
  assert.deepEqual(goalsBesideXg({ ...club, rows: [rows[2]] }).for, { matches: 0, goals: null, xg: null, delta: null });
});

test("a season total multiplies the mean by its own support, not by every match", () => {
  // The service's coverage: one supported match of three.
  const served = { ...club, values: { finishing: 0.8, keeper: 0.4, placement: null }, coverage: { finishing: 1, keeper: 1, placement: 0 } };
  assert.deepEqual(seasonTotal(served, "finishing"), { value: 0.8, matches: 1 });
  assert.deepEqual(seasonTotal(served, "keeper"), { value: 0.4, matches: 1 });
  assert.deepEqual(seasonTotal(served, "placement"), { value: null, matches: 0 });
  // Without the service's coverage, the support is unknown: the rows cannot say which matches the
  // mean stands on (VI-23 classifies the scoring of each match), so no total is made of the mean.
  const read = { ...club, values: { finishing: 0.5, keeper: -0.1, placement: 0.4 } };
  assert.deepEqual(seasonTotal(read, "finishing"), { value: null, matches: null });
  assert.deepEqual(seasonTotal(read, "keeper"), { value: null, matches: null });
  assert.deepEqual(seasonTotal(read, "placement"), { value: null, matches: null });
  // A known zero stays zero; an unknown mean stays unknown.
  assert.deepEqual(seasonTotal({ ...served, values: { finishing: 0 } }, "finishing"), { value: 0, matches: 1 });
  assert.deepEqual(seasonTotal({ ...served, values: {} }, "finishing"), { value: null, matches: 1 });
});

test("a sum with an unknown term is unknown, known zeros stay zero", () => {
  assert.equal(sumKnown([0.4, null, 1.2]), null);
  assert.equal(sumKnown([0.4, Number.NaN]), null);
  assert.equal(sumKnown([0, 0]), 0);
  assert.ok(Math.abs(sumKnown([0.4, 1.2]) - 1.6) < 1e-9);
  assert.equal(sumKnown([]), 0);
});
