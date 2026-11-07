import test from "node:test";
import assert from "node:assert/strict";
import { overviewRadarValues } from "../dashboard/frontend/src/services/player-overview-radar.js";
import { buildCohorts } from "../dashboard/frontend/src/services/scouting.js";
function profile(group, value, missing = false) {
  const keys = [
    "goals",
    "assists",
    "shotsOnTarget",
    "shots",
    "chancesCreated",
    "passesAccurate",
    "recoveries",
    "duelsWon",
    "touchesBox",
    "saves",
    "goalsPrevented",
    "clearances",
    "touches",
  ];
  return {
    role: { group },
    matches: 5,
    minutes: 450,
    ratios: {},
    stats: Object.fromEntries(
      keys
        .filter((k) => !(missing && k === "recoveries"))
        .map((k) => [k, { sum: value, count: 5, minutes: 450 }]),
    ),
  };
}
test("six metrics use same-position per-90 ranks and preserve missing values", () => {
  const profiles = Array.from({ length: 40 }, (_, i) => profile("O", i));
  const target = profile("O", 25, true),
    values = overviewRadarValues(target, buildCohorts(profiles));
  assert.equal(values.length, 6);
  assert.ok(values[0].percentile > 50);
  assert.equal(values.find((v) => v.key === "recoveries").percentile, null);
});
test("goalkeepers receive keeper axes; small cohorts yield unavailable", () => {
  const target = profile("G", 8),
    values = overviewRadarValues(target, buildCohorts([target]));
  assert.equal(values.length, 6);
  assert.equal(values[0].key, "saves");
  assert.equal(values[1].key, "goalsPrevented");
  assert.ok(values.every((v) => v.percentile === null));
});
