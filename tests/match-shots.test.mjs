// FAILURE_MODES § 63.4, R12: the shot map's periods read the same in the shots family's spelling (FirstHalf…) and in
// the base's (first_half…), which a match without a summary version carries (backend/api/src/match-record.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { shotPeriods, shotsOf } from "../dashboard/frontend/src/services/match-shots.js";

const shots = (first, second, kicks) => [
  { id: "a", period: first },
  { id: "b", period: first },
  { id: "c", period: second },
  { id: "k1", period: kicks },
  { id: "k2", period: kicks },
];
const CHOICES = [["all", "Match"], ["FirstHalf", "1re mi-temps"], ["SecondHalf", "2e mi-temps"], ["Penalties", "Tirs au but"]];

for (const [label, spelling] of [
  ["the shots family", ["FirstHalf", "SecondHalf", "Penalties"]],
  ["the base", ["first_half", "second_half", "penalties"]],
]) {
  test(`R12 periods in ${label}'s spelling`, () => {
    const list = shots(...spelling);
    assert.deepEqual(shotPeriods(list), CHOICES);
    assert.deepEqual(shotsOf(list, "all").map((s) => s.id), ["a", "b", "c"]);
    assert.deepEqual(shotsOf(list, "FirstHalf").map((s) => s.id), ["a", "b"]);
    assert.deepEqual(shotsOf(list, "Penalties").map((s) => s.id), ["k1", "k2"]);
  });
}

test("R12 no period: no choice, every shot in « Match »", () => {
  const list = [{ id: "a" }, { id: "b", period: null }];
  assert.deepEqual(shotPeriods(list), []);
  assert.deepEqual(shotsOf(list, "all").map((s) => s.id), ["a", "b"]);
});
