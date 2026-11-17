import test from "node:test";
import assert from "node:assert/strict";
import { nationsProjectionRows } from "../dashboard/frontend/src/services/nations-projection.js";

const NONE = { first: 0, second: 0, third: 0, fourth: 0, qf: 0, sf: 0, final: 0, win: 0, stay: 0, barrage: 0, relegated: 0, promoted: 0, next_a: 0, next_b: 0, next_c: 0 };
const team = (id, group, stages, points = 0) => ({ id, name: id, group, points, played: 6, elo: 1500, stages: { ...NONE, ...stages } });
const cols = (columns) => columns.map((c) => [c.key, c.label, c.range ?? null, c.tone, Boolean(c.start)]);

test("League A's projection: the quarter-finals, who stays, plays the play-off or goes down, its league in 2028–29, then the Final Four", () => {
  // The 2026–27 season is transitional (VI-19, mockup validated 17 Nov 2026): the two best third-placed stay, the two
  // worst third-placed and the two best fourth-placed play the A/B play-off, the two worst fourth-placed go down.
  const projection = { format: "nations", teams: [
    team("es", "3", { first: 0.6, second: 0.4, qf: 1, sf: 0.68, final: 0.43, win: 0.26, next_a: 1 }, 15),
    team("fr", "1", { first: 1, qf: 1, sf: 0.61, final: 0.33, win: 0.18, next_a: 1 }, 13),
    team("tr", "1", { fourth: 1, relegated: 1, next_b: 1 }),
    team("rs", "2", { fourth: 1, barrage: 1, next_a: 0.35, next_b: 0.65 }),
    team("it", "1", { third: 1, stay: 1, next_a: 1 }, 10),
  ] };
  const { rows, columns } = nationsProjectionRows(projection, "A");
  assert.deepEqual(rows.map((r) => r.id), ["es", "fr", "it", "rs", "tr"]);
  assert.deepEqual(cols(columns), [
    ["qf", "Quarts", "1er ou 2e", "ko", true], ["stay", "Maintien", "3e", "po", false], ["barrage", "Barrage", "A/B", "barrage", false],
    ["relegated", "Relégation", "directe", "out", false], ["next_a", "En A", "2028–29", "ko", true],
    ["sf", "Final Four", null, "round", true], ["final", "Finale", null, "round", false], ["win", "Vainqueur", null, "round", false],
  ]);
  assert.deepEqual([rows[0].group, rows[0].points, rows[0].played], ["3", 15, 6]);
});

test("Leagues B to D: each place with what it leads to, group by group, then the league in 2028–29", () => {
  const projection = { format: "nations", teams: [
    team("b2x", "B2", { first: 0.3, second: 0.7, next_a: 0.6, next_b: 0.4 }), team("b1x", "B1", { first: 0.9, second: 0.1, next_a: 0.95, next_b: 0.05 }),
    team("b1y", "B1", { second: 0.9, first: 0.1, next_a: 0.5, next_b: 0.5 }), team("b1w", "B1", { fourth: 1, next_b: 0.4, next_c: 0.6 }), team("b1z", "B1", { third: 1, next_b: 1 }, 4),
    team("c1x", "C1", { first: 1, next_b: 1 }), team("c1y", "C1", { second: 1, next_b: 0.3, next_c: 0.7 }), team("c1z", "C1", { third: 1, next_c: 1 }), team("c1w", "C1", { fourth: 1, next_c: 1 }),
    team("d1x", "D1", { first: 1, next_c: 1 }), team("d1y", "D1", { second: 1, next_c: 1 }), team("d1z", "D1", { third: 1, next_c: 1 }),
  ] };
  const b = nationsProjectionRows(projection, "B");
  assert.deepEqual(b.rows.map((r) => r.id), ["b1x", "b1y", "b1z", "b1w", "b2x"]);
  assert.deepEqual(cols(b.columns), [
    ["first", "1er", "monte", "ko", true], ["second", "2e", "barrage A/B", "barrage", false], ["third", "3e", "reste", "po", false], ["fourth", "4e", "barrage B/C", "barrage", false],
    ["next_a", "En A", "2028–29", "ko", true], ["next_b", "En B", null, "po", false], ["next_c", "En C", null, "out", false],
  ]);
  assert.deepEqual(cols(nationsProjectionRows(projection, "C").columns), [
    ["first", "1er", "monte", "ko", true], ["second", "2e", "barrage B/C", "barrage", false], ["third", "3e", "reste", "po", false], ["fourth", "4e", "reste", "po", false],
    ["next_b", "En B", "2028–29", "ko", true], ["next_c", "En C", null, "po", false],
  ]);
  assert.deepEqual(cols(nationsProjectionRows(projection, "D").columns), [
    ["first", "1er", "monte", "ko", true], ["second", "2e", "monte", "ko", false], ["third", "3e", "monte", "ko", false], ["next_c", "En C", "2028–29", "ko", true],
  ]);
  assert.deepEqual(nationsProjectionRows(null, "A"), { rows: [], columns: [] });
  assert.deepEqual(nationsProjectionRows(projection, "A"), { rows: [], columns: [] }); // League A's projection is its own edition's
});

test("without the season's play-offs (an edition replayed alone), the places alone", () => {
  // The joint season needs Leagues A to C rated; an edition replayed alone has no 2028–29 league to show.
  const alone = { format: "nations", teams: [team("b1x", "B1", { first: 1 }), team("b1y", "B1", { second: 1 })] };
  assert.deepEqual(nationsProjectionRows(alone, "B").columns.map((c) => c.key), ["first", "second"]);
  const a = { format: "nations", teams: [team("fr", "1", { first: 1, qf: 1, sf: 0.5, final: 0.3, win: 0.2 }), team("it", "1", { third: 1 })] };
  assert.deepEqual(nationsProjectionRows(a, "A").columns.map((c) => c.key), ["qf", "third", "fourth", "sf", "final", "win"]);
});
