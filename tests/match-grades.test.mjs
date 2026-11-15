// Vega's grade of each player in one match: read from the route's body, kept only where shown.
import test from "node:test";
import assert from "node:assert/strict";
import { gradeTitle, gradesOf } from "../dashboard/frontend/src/services/match-grades.js";

test("a match's grades by player, the ones shown only, with their rank in the match", () => {
  const grades = gradesOf({
    match: "m_aaaaa1",
    grades: [
      { playerId: "p_aaaab1", minutes: 90, grade: 80.8, rank: 1 },
      { playerId: "p_aaaab4", minutes: 90, grade: 50, rank: 2 },
      { playerId: "p_aaaab3", minutes: 10, grade: null, rank: null },
    ],
  });
  assert.deepEqual([...grades.keys()], ["p_aaaab1", "p_aaaab4"]);
  assert.equal(gradeTitle(grades.get("p_aaaab1")), "Note Vega du match sur 100 · 1er du match");
  assert.equal(gradeTitle(grades.get("p_aaaab4")), "Note Vega du match sur 100 · 2e du match");
  assert.equal(gradesOf(null).size, 0);
});
