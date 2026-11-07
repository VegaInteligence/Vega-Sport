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

test("arithmetic peer mean and its rank use the same asymmetric distribution", () => {
  const profiles = [
    ...Array.from({ length: 39 }, () => profile("O", 0)),
    profile("O", 40),
  ];
  const target = profile("O", 4);
  const axis = overviewRadarValues(target, buildCohorts(profiles)).find(
    (v) => v.key === "shotsOnTarget",
  );
  assert.equal(axis.value, 0.8);
  assert.equal(axis.mean, 0.2);
  assert.equal(axis.maximum, 8);
  assert.equal(axis.peers, 40);
  assert.ok(axis.meanPercentile > 50);
  assert.notEqual(axis.meanPercentile, 50);
});
test("partial observations do not become a plotted value and zero remains observed", () => {
  const peers = Array.from({ length: 40 }, () => profile("O", 0));
  const target = profile("O", 0);
  target.stats.shotsOnTarget.count = 4;
  const axes = overviewRadarValues(target, buildCohorts(peers));
  const missing = axes.find((v) => v.key === "shotsOnTarget");
  assert.equal(missing.value, null);
  assert.equal(missing.percentile, null);
  assert.equal(missing.mean, 0);
  assert.equal(missing.maximum, 0);
  assert.equal(axes.find((v) => v.key === "goals").value, 0);
});

test("a small complete sample has a descriptive mean without invented percentile", () => {
  const target = profile("O", 4);
  const axes = overviewRadarValues(
    target,
    buildCohorts([profile("O", 0), target]),
  );
  const shots = axes.find((axis) => axis.key === "shotsOnTarget");
  assert.equal(shots.mean, 0.4);
  assert.equal(shots.peers, 2);
  assert.equal(shots.percentile, null);
  assert.equal(shots.meanPercentile, null);
});

test("the axis scale includes negative goalkeeper observations and a zero baseline", () => {
  const target = profile("G", -1);
  const keepers = Array.from({ length: 40 }, (_, index) =>
    profile("G", index - 20),
  );
  const axis = overviewRadarValues(target, buildCohorts(keepers)).find(
    (item) => item.key === "goalsPrevented",
  );
  assert.equal(axis.minimum, -4);
  assert.equal(axis.maximum, 3.8);
  assert.ok(axis.mean < 0);
});
