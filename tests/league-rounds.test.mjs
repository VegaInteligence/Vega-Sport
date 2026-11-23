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

test("the Player of the Round: the best grade of the Team of the Round, the lowest slot on a tie", async () => {
  const { roundStar } = await import("../dashboard/frontend/src/services/league-rounds.js");
  const players = [
    { slot: 0, grade: 70 }, { slot: 4, grade: 89 }, { slot: 9, grade: 89 }, { slot: 10, grade: 81 },
  ];
  assert.equal(roundStar({ players }), 4);
  assert.equal(roundStar({ players: [{ slot: 3, grade: null }, { slot: 7, grade: 60 }] }), 7);
  assert.equal(roundStar({ players: [{ slot: 3, grade: null }] }), null);
  assert.equal(roundStar({ players: [] }), null);
  assert.equal(roundStar(null), null);
});

test("the whole race, 20 a page: the page asked for, kept inside the race", async () => {
  const { racePage, RACE_PAGE } = await import("../dashboard/frontend/src/services/league-rounds.js");
  assert.equal(RACE_PAGE, 20);
  const race = Array.from({ length: 45 }, (_, i) => ({ rank: i + 1 }));
  const first = racePage(race, 1);
  assert.deepEqual([first.page, first.pages, first.rows.length, first.rows[0].rank, first.rows.at(-1).rank], [1, 3, 20, 1, 20]);
  const last = racePage(race, 3);
  assert.deepEqual([last.page, last.rows.length, last.rows[0].rank], [3, 5, 41]);
  assert.equal(racePage(race, 9).page, 3);
  assert.equal(racePage(race, 0).page, 1);
  assert.deepEqual(racePage([], 1), { page: 1, pages: 1, rows: [] });
  assert.deepEqual(racePage(undefined, 2), { page: 1, pages: 1, rows: [] });
});
