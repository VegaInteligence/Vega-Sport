import test from "node:test";
import assert from "node:assert/strict";
import { projectionRows, share } from "../dashboard/frontend/src/services/forecasts.js";

test("shares read as the site writes them", () => {
  assert.deepEqual([0, null, 0.004, 0.005, 0.5, 0.994, 0.999, 1].map(share), ["—", "—", "< 1 %", "1 %", "50 %", "99 %", "> 99 %", "100 %"]);
});

test("a projection's rows: the title, the first four places, the last three", () => {
  const places = (values) => values.concat(Array(8 - values.length).fill(0));
  const rows = projectionRows({ teams: [
    { id: "t_a", name: "A", imageUrl: null, played: 10, points: 24, projectedPoints: 80.4, places: places([0.7, 0.2, 0.1]) },
    { id: "t_b", name: "B", imageUrl: null, played: 10, points: 9, projectedPoints: 31.2, places: [0, 0, 0, 0.1, 0.1, 0.3, 0.3, 0.2] },
  ] });
  assert.deepEqual(rows.map((row) => [row.id, row.title, Math.round(row.topFour * 100), Math.round(row.bottomThree * 100)]), [["t_a", 0.7, 100, 0], ["t_b", 0, 10, 80]]);
  // A league too small for the last three to mean relegation has no such column.
  assert.equal(projectionRows({ teams: [{ id: "t_a", places: [0.6, 0.4] }] })[0].bottomThree, null);
  assert.deepEqual(projectionRows(null), []);
});

test("a projection's rows carry the club's coming matches when the answer has them", () => {
  const next = { matches: 5, home: 3, opponentLevel: 1648, expectedPoints: 7.9, rank: 2 };
  const rows = projectionRows({ teams: [{ id: "t_a", places: [1], next }, { id: "t_b", places: [1], next: { matches: 0 } }, { id: "t_c", places: [1] }] });
  assert.deepEqual(rows.map((row) => row.next), [next, null, null]);
});
