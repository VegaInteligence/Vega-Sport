import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";

// The hooks read through the resource cache; the rows and figures are pure.
const load = async (file) => {
  const source = await fs.readFile(new URL(`../dashboard/frontend/src/services/${file}`, import.meta.url), "utf8");
  return import("data:text/javascript," + encodeURIComponent(source.replace(/^import .*$/m, "const useResource = null, json = null;")));
};
const { halfRows } = await load("player-halves.js");
const { passingFacts } = await load("club-passing.js");

test("a player's statistics per 90 minutes of each half", () => {
  const table = halfRows({
    first: { matches: 20, minutes: 900, goals: 6, shots: 30, xg: 5.4, touches_box: 60, dribbles: 20, passes: 300, touches: 600, duels_won: 40, tackles: 10, recoveries: 30 },
    second: { matches: 20, minutes: 450, goals: 1, shots: 10, xg: 1.5, touches_box: 20, dribbles: 5, passes: 120, touches: 260, duels_won: 15, tackles: 5, recoveries: 20 },
  });
  assert.deepEqual(table.minutes, [900, 450]);
  assert.deepEqual(table.rows.slice(0, 3).map((row) => [row.label, row.first, row.second]), [["Buts", 0.6, 0.2], ["Tirs", 3, 2], ["xG", 0.54, 0.3]]);
  assert.equal(table.rows.length, 10);
  // A statistic the answer does not carry stays empty rather than read as zero.
  assert.equal(halfRows({ first: { minutes: 900, goals: 1 }, second: { minutes: 900, goals: 2 } }).rows[1].first, null);
});

test("too little time in a half, or a half missing, gives no table", () => {
  const half = { matches: 5, minutes: 200, goals: 1, shots: 2, xg: 0.5, passes: 50, touches: 90, duels_won: 6, recoveries: 5 };
  assert.equal(halfRows({ first: half, second: { ...half, minutes: 100 } }), null);
  assert.equal(halfRows({ first: half, second: null }), null);
  assert.equal(halfRows(null), null);
});

test("a club's triangle and pair read as two figures", () => {
  const facts = passingFacts({
    triangle: { passes: 412, players: [{ id: "p_a", name: "Vitinha" }, { id: "p_b", name: "João Neves" }, { id: "p_c", name: "Achraf Hakimi" }] },
    pair: { passes: 187, players: [{ id: "p_a", name: "Vitinha" }, { id: "p_b", name: "João Neves" }] },
  });
  assert.deepEqual(facts, [
    { label: "Triangle le plus utilisé", passes: 412, players: "Vitinha · João Neves · Achraf Hakimi" },
    { label: "Duo le plus lié", passes: 187, players: "Vitinha · João Neves" },
  ]);
  // A pair without a triangle (three players never all linked) shows the pair alone.
  assert.equal(passingFacts({ triangle: null, pair: { passes: 9, players: [{ name: "A" }, { name: "B" }] } }).length, 1);
  assert.equal(passingFacts(null), null);
  assert.equal(passingFacts({ triangle: null, pair: null }), null);
});
