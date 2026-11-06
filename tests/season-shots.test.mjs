import test from "node:test";
import assert from "node:assert/strict";
import {
  shotOutcome,
  shotPosition,
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
