// The read API's copy of the in-play calculation gives the values of backend/vega/inplay.py
// (backend/tests/test_inplay.py checks the same numbers with the Python functions).
import { test } from "node:test";
import assert from "node:assert/strict";
import { outcome, poisson, rates, remaining, timeline, lateShare, extraRemaining, EXTRA_SHARE } from "../../../dashboard/shared/inplay.js";

const MODEL = { profile: [0.13, 0.14, 0.18, 0.16, 0.16, 0.16, 0.07], down: 0.6, up: 1.7 };
const RHO = -0.03;
const close = (got, want) => got.forEach((value, i) => assert.ok(Math.abs(value - want[i]) < 5e-7, `${got} != ${want}`));

test("the share of goals still to come", () => {
  close([[0, 0], [15, 0], [37.5, 0], [60, 0], [89, 0], [90, 0], [90, 4], [90, 12]].map(([m, a]) => remaining(MODEL.profile, m, a)),
    [1.0, 0.87, 0.64, 0.39, 0.080667, 0.07, 0.035, 0.0]);
});

test("the state of a match moves the probabilities", () => {
  close(outcome(1.6, 1.1, 1.0, 0, 0, 0, 0, MODEL, RHO), [0.486025, 0.256008, 0.257967]);
  close(outcome(1.6, 1.1, 0.39, 1, 0, 0, 0, MODEL, RHO), [0.782823, 0.17635, 0.040828]);
  close(outcome(1.6, 1.1, 0.39, 1, 0, 1, 0, MODEL, RHO), [0.590557, 0.284731, 0.124712]);
  close(outcome(1.2, 1.9, 0.07, 2, 2, 0, 1, MODEL, RHO), [0.123551, 0.809582, 0.066867]);
  // A side ahead scores less for the rest of the match, a side behind more (version 2); a level score changes nothing.
  const state = { ...MODEL, ahead: 0.85, behind: 1.1 };
  close(outcome(1.6, 1.1, 0.39, 1, 0, 0, 0, state, RHO), [0.745134, 0.202399, 0.052467]);
  close(outcome(1.6, 1.1, 0.39, 0, 1, 0, 0, state, RHO), [0.114505, 0.281145, 0.60435]);
  close(outcome(1.6, 1.1, 0.39, 2, 1, 1, 0, state, RHO), [0.552454, 0.296477, 0.151069]);
  close(outcome(1.6, 1.1, 0.39, 1, 1, 0, 0, state, RHO), outcome(1.6, 1.1, 0.39, 1, 1, 0, 0, MODEL, RHO));
  close(outcome(1.6, 1.1, 1.0, 0, 0, 0, 0, state, RHO), [0.486025, 0.256008, 0.257967]);
  // The score changes the rates of the goals expected after the hour only.
  const tilt = { ...MODEL, ahead: 0.85, behind: 1.15 };
  close([[0, 0], [30, 0], [60, 0], [75, 0], [90, 4]].map(([m, a]) => lateShare(MODEL.profile, m, a)), [0.39, 0.39, 0.39, 0.23, 0.035]);
  const at = (minute, home, away) => outcome(1.6, 1.1, remaining(MODEL.profile, minute, 0), home, away, 0, 0, tilt, RHO, lateShare(MODEL.profile, minute, 0));
  close(at(30, 1, 0), [0.706589, 0.196064, 0.097347]);
  close(at(75, 0, 1), [0.057434, 0.245146, 0.69742]);
  const tilted = timeline(1.6, 1.1, [{ minute: 23, added: 0, kind: "goal", side: "home" }, { minute: 45, added: 3, kind: "goal", side: "away" },
    { minute: 61, added: 0, kind: "red", side: "away" }, { minute: 90, added: 4, kind: "goal", side: "home" }], tilt, RHO);
  for (const [minute, want] of [[23, [0.705142, 0.19164, 0.103218]], [40, [0.711598, 0.203393, 0.085009]], [70, [0.468921, 0.447483, 0.083596]]])
    close([tilted[minute].home, tilted[minute].draw, tilted[minute].away], want);
  assert.deepEqual(outcome(1.6, 1.1, 0, 0, 1, 0, 0, MODEL, RHO), [0, 0, 1]);
  assert.deepEqual(outcome(1.6, 1.1, 0, 1, 1, 0, 0, MODEL, RHO), [0, 1, 0]);
});

test("a match minute by minute", () => {
  const events = [{ minute: 23, added: 0, kind: "goal", side: "home" }, { minute: 45, added: 3, kind: "goal", side: "away" },
    { minute: 61, added: 0, kind: "red", side: "away" }, { minute: 90, added: 4, kind: "goal", side: "home" }];
  const points = timeline(1.6, 1.1, events, MODEL, RHO);
  assert.equal(points.length, 91);
  const want = { 0: [0.486025, 0.256008, 0.257967, 0, 0], 22: [0.453259, 0.2955, 0.251242, 0, 0], 23: [0.740991, 0.173839, 0.085169, 1, 0],
    45: [0.395849, 0.368416, 0.235735, 1, 1], 61: [0.552411, 0.359206, 0.088383, 1, 1], 89: [0.183654, 0.775406, 0.040939, 1, 1], 90: [0.962515, 0.036627, 0.000858, 2, 1] };
  for (const [minute, values] of Object.entries(want)) {
    const p = points[minute];
    close([p.home, p.draw, p.away], values.slice(0, 3));
    assert.deepEqual(p.score, values.slice(3));
  }
  // A match in progress stops at its clock.
  assert.equal(timeline(1.6, 1.1, events, MODEL, RHO, 50).length, 51);
});

test("the expected goals of each side from the two strengths", () => {
  const model = { home_base: 0.26, home_slope: 0.93, away_base: 0.32, away_slope: 0.91 };
  close(rates(model, 1600, 1500), [Math.exp(0.26 + 0.93 * 0.4), Math.exp(0.32 - 0.91 * 0.4)]);
  close(rates(model, 1600, 1500, true), [Math.exp(0.26 + 0.93 * 0.25), Math.exp(0.32 - 0.91 * 0.25)]);
  assert.ok(Math.abs(poisson(1.3).reduce((a, b) => a + b, 0) - 1) < 1e-12);
});

// Extra time (issue #68): the timeline carried to the 120th minute when the caller says the
// match went there (`extra`). Failure modes and expected outcomes, written before the code:
// 1. Level at the 90th, decided in extra time: the points run 0..120; 0..90 are the regulation
//    timeline's own; from the 91st the goals still to come are Poisson(λ × EXTRA_SHARE ×
//    (120 − m) / 30 × the red-card factors × the score factors, all of it "late"), without
//    the low-score correction; a goal at the 104th counts from the 104th; the 120th is the result.
// 2. Level at the 120th (a shoot-out): the 120th point is (0, 1, 0), the shoot-out being outside the model.
// 3. A red card in extra time counts from its minute (95th), not from the 90th.
// 4. A goal at 90+3 is regulation (stored as minute 90, added 3): it counts at the 90th.
// 5. Without `extra`, nothing changes: a goal stored at the 105th still counts at the 90th.
// 6. In play in extra time (the live feed's period): the points stop at the clock, and an event
//    past the clock counts at the clock, as in regulation.
// The values are also checked by backend/tests/test_inplay.py (extra time).
const TILT = { ...MODEL, ahead: 0.85, behind: 1.15 };
const goal = (minute, side, added = 0) => ({ minute, added, kind: "goal", side });
const three = (p) => [p.home, p.draw, p.away];

test("extra time: the share of goals still to come after the 90th", () => {
  close([90, 91, 105, 119, 120].map(extraRemaining), [1 / 3, 0.322222, 1 / 6, 0.011111, 0]);
  assert.equal(EXTRA_SHARE, 1 / 3);
});

test("extra time: level at the 90th, decided at the 104th", () => {
  const regulation = [goal(23, "home"), goal(45, "away", 3)];
  const points = timeline(1.6, 1.1, [...regulation, goal(104, "home")], TILT, RHO, 120, true);
  assert.equal(points.length, 121);
  assert.deepEqual(points.slice(0, 91), timeline(1.6, 1.1, regulation, TILT, RHO));
  close(three(points[90]), [0.096132, 0.83894, 0.064928]);
  for (const [minute, want, score] of [[91, [0.306922, 0.499078, 0.194], [1, 1]], [103, [0.218275, 0.6388, 0.142925], [1, 1]],
    [104, [0.837683, 0.144894, 0.017423], [2, 1]], [119, [0.986251, 0.013653, 0.000096], [2, 1]]]) {
    close(three(points[minute]), want);
    assert.deepEqual([points[minute].minute, points[minute].score], [minute, score]);
  }
  assert.deepEqual(three(points[120]), [1, 0, 0]);
  // Level at the 120th: the shoot-out is outside the model.
  assert.deepEqual(three(timeline(1.6, 1.1, regulation, TILT, RHO, 120, true)[120]), [0, 1, 0]);
});

test("extra time: a red card counts from its minute, a goal at 90+3 stays in regulation", () => {
  const red = timeline(1.6, 1.1, [goal(23, "home"), goal(45, "away", 3), { minute: 95, added: 0, kind: "red", side: "away" }], TILT, RHO, 120, true);
  close(three(red[94]), [0.288057, 0.528252, 0.183692]);
  close(three(red[95]), [0.468771, 0.447136, 0.084092]);
  close(three(red[110]), [0.244944, 0.702216, 0.05284]);
  const late = timeline(1.6, 1.1, [goal(23, "home"), goal(45, "away", 3), goal(90, "home", 3)], TILT, RHO, 120, true);
  assert.deepEqual([late[89].score, late[90].score, late[91].score], [[1, 1], [2, 1], [2, 1]]);
  close(three(late[91]), [0.76551, 0.191043, 0.043447]);
});

test("extra time: without the flag nothing changes, in play it stops at the clock", () => {
  const events = [goal(23, "home"), goal(105, "away")];
  const regulation = timeline(1.6, 1.1, events, TILT, RHO);
  assert.equal(regulation.length, 91);
  assert.deepEqual(regulation[90].score, [1, 1]);
  assert.deepEqual(timeline(1.6, 1.1, events, TILT, RHO, 90, false), regulation);
  const live = timeline(1.6, 1.1, events, TILT, RHO, 100, true);
  assert.deepEqual([live.length, live.at(-1).minute, live[90].score, live[100].score], [101, 100, [1, 0], [1, 1]]);
});
