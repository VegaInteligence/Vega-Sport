// The read API's copy of the in-play calculation gives the values of backend/vega/inplay.py
// (backend/tests/test_inplay.py checks the same numbers with the Python functions).
import { test } from "node:test";
import assert from "node:assert/strict";
import { outcome, poisson, rates, remaining, timeline } from "../src/inplay.mjs";

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
