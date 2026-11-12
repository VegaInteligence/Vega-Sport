import test from "node:test";
import assert from "node:assert/strict";
import {
  shotOutcome,
  shotPosition,
  strikeQuality,
} from "../dashboard/frontend/src/services/season-shots.js";
test("outcomes require observed evidence", () => {
  assert.equal(shotOutcome({ isGoal: true }), "But");
  assert.equal(shotOutcome({ isOnTarget: true }), "Cadré sans but");
  assert.equal(shotOutcome({ type: "MissedShots" }), "Non cadré");
  assert.equal(shotOutcome({ isBlocked: true }), "Bloqué");
  assert.equal(shotOutcome({ isOnTarget: false }), "Résultat inconnu");
});
test("distance uses only an identified attack direction and pitch", () => {
  assert.equal(shotPosition({ x: 94, y: 34 }).distance, null);
  assert.equal(
    shotPosition({ x: 94, y: 34, coordinateFrame: "acting_ltr" }).distance,
    11,
  );
  assert.equal(
    shotPosition({ x: 94, y: 34, coordinateFrame: "acting_ltr" }).approximate,
    true,
  );
  assert.equal(
    shotPosition({
      x: 94,
      y: 34,
      coordinateFrame: "acting_ltr",
      pitchLengthM: 105,
      pitchWidthM: 68,
    }).approximate,
    false,
  );
  assert.equal(
    shotPosition({ x: 106, y: 34, coordinateFrame: "acting_ltr" }),
    null,
  );
});

test("what the strikes add to the chances: xGOT minus xG over the shots fully known", () => {
  const quality = strikeQuality([
    { xg: 0.1, xgot: 0.6, isGoal: true, isOnTarget: true },
    { xg: 0.3, xgot: 0.05, isOnTarget: true },
    { xg: 0.2, xgot: null, isOnTarget: false },
    { xg: 0.1, isBlocked: true },
    // Left out: on target without an xGOT, an own goal, a shot without xG.
    { xg: 0.4, xgot: null, isOnTarget: true },
    { xg: 0.2, xgot: 0.9, isGoal: true, isOwnGoal: true },
    { xgot: 0.3, isOnTarget: true },
  ]);
  assert.equal(Math.round(quality.value * 100) / 100, -0.05);
  assert.deepEqual([quality.shots, quality.onTarget], [4, 2]);
  assert.equal(strikeQuality([]), null);
  assert.equal(strikeQuality([{ xg: 0.4, xgot: null, isOnTarget: true }]), null);
  assert.equal(strikeQuality(null), null);
});
