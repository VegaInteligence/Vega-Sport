// Vega's grade of each player in one match: read from the route's body, kept only where shown.
import test from "node:test";
import assert from "node:assert/strict";
import { gradeTitle, gradesOf, leadingPlayers } from "../dashboard/frontend/src/services/match-grades.js";

test("a match's best players: the source's ratings first, else Vega's grades by rank", () => {
  const grades = new Map([
    ["p_b", { grade: 71, rank: 1 }],
    ["p_a", { grade: 60, rank: 2 }],
    ["p_c", { grade: 40, rank: 3 }],
  ]);
  const unrated = [
    { id: "p_a", minutes: 90, rating: null },
    { id: "p_b", minutes: 64, rating: null },
    { id: "p_c", minutes: 90, rating: null },
    { id: "p_d", minutes: 0, rating: null },
  ];
  // No rating from the source (some leagues have none): the grades, best rank first.
  assert.deepEqual(leadingPlayers(unrated, grades, 2).map((r) => r.id), ["p_b", "p_a"]);
  // With ratings, the order stays the source's, as before the grades.
  const rated = [{ id: "p_c", minutes: 90, rating: 7.9 }, { id: "p_a", minutes: 90, rating: 7.1 }];
  assert.deepEqual(leadingPlayers(rated, grades).map((r) => r.id), ["p_c", "p_a"]);
  // Neither: nothing.
  assert.deepEqual(leadingPlayers(unrated, new Map()), []);
  assert.deepEqual(leadingPlayers(undefined, grades), []);
});

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
