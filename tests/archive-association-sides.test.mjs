// FAILURE_MODES.md §23 (23n), written before the code: in an OpenFootball UEFA results row, whose team names carry their
// association (« Real Madrid (ESP) »), a goal's team is compared, after exact names, with each name without its suffix.
// One side only may match; the stored names keep their suffix; no other feed is read this way.
import test from "node:test";
import assert from "node:assert/strict";
import { goalSide } from "../dashboard/shared/archive.js";

const uefa = (team1, team2, competitionId = "2013-14/uefa.cl") => ({ competitionId, team1, team2 });

test("23n: the association suffix of an OpenFootball UEFA row is read for the goal's side", () => {
  assert.equal(goalSide({ team: "Real Madrid" }, uefa("Real Madrid (ESP)", "Atlético Madrid (ESP)")), "home");
  assert.equal(goalSide({ team: "Atlético Madrid" }, uefa("Real Madrid (ESP)", "Atlético Madrid (ESP)")), "away");
  assert.equal(goalSide({ team: "Dinamo Zagreb" }, uefa("Dinamo Zagreb (CRO)", "Dinamo Kiev (UKR)", "2012-13/uefa.cl")), "home");
  assert.equal(goalSide({ team: "Dinamo Kiev" }, uefa("Dinamo Zagreb (CRO)", "Dinamo Kiev (UKR)", "2012-13/uefa.cl")), "away");
});

test("23n: ambiguous or other feeds stay as they were", () => {
  // Both sides with one base name: unknown.
  assert.equal(goalSide({ team: "Dinamo" }, uefa("Dinamo (CRO)", "Dinamo (UKR)")), null);
  // Not an OpenFootball UEFA row: the suffix is a name, read by similarity as before (a tie stays unknown).
  assert.equal(goalSide({ team: "Real Madrid" }, uefa("Real Madrid (ESP)", "Atlético Madrid (ESP)", "england/2013-14/eng.1")), null);
  // Lower-case or longer codes are not an association.
  assert.equal(goalSide({ team: "Real Madrid" }, uefa("Real Madrid (esp)", "Atlético Madrid (esp)")), null);
});
