// A league's matchweeks on the site: a round's label and its Team of the Round by line.
import test from "node:test";
import assert from "node:assert/strict";
import { roundLabel, teamLines, raceRowsThatFit } from "../dashboard/frontend/src/services/league-rounds.js";

test("a round reads « Journée N », a week its first day", () => {
  assert.equal(roundLabel({ label: "11" }), "Journée 11");
  assert.equal(roundLabel({ label: "Semaine du 2026-11-10" }), "Semaine du 10/11/2026");
  assert.equal(roundLabel(null), "");
});

test("the team's lines go from the forwards down to the goalkeeper, left to right", () => {
  const players = [
    { slot: 0, line: 0, name: "Gardien" },
    { slot: 2, line: 1, name: "B" }, { slot: 1, line: 1, name: "A" },
    { slot: 3, line: 2, name: "Avant" },
  ];
  assert.deepEqual(teamLines({ players }).map((line) => line.map((p) => p.name)), [["Avant"], ["A", "B"], ["Gardien"]]);
  assert.deepEqual(teamLines(null), []);
});

test("the race fills its card: the whole rows that fit, one at least, the race kept at most", () => {
  assert.equal(raceRowsThatFit({ available: 330, rowHeight: 40, gap: 12, max: 10 }), 6); // 6 × 40 + 5 × 12 = 300
  assert.equal(raceRowsThatFit({ available: 2000, rowHeight: 40, gap: 12, max: 10 }), 10);
  assert.equal(raceRowsThatFit({ available: 10, rowHeight: 40, gap: 12, max: 10 }), 1);
  assert.equal(raceRowsThatFit({ available: Number.NaN, rowHeight: 40, gap: 12, max: 3 }), 3);
});
