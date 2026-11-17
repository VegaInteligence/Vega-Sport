import test from "node:test";
import assert from "node:assert/strict";
import { nationsProjectionRows } from "../dashboard/frontend/src/services/nations-projection.js";

const team = (id, group, stages, points = 0) => ({ id, name: id, group, points, played: 6, elo: 1500, stages: { first: 0, second: 0, third: 0, fourth: 0, qf: 0, sf: 0, final: 0, win: 0, stay: 0, barrage: 0, relegated: 0, ...stages } });

test("League A's projection: each nation's way to the quarter-finals, then the Final Four, the likeliest winner first", () => {
  // The 2026–27 season is transitional: the play-off (« Barrage ») is for the two worst third-placed and the two best
  // fourth-placed, the relegation for the two worst fourth-placed; the two best third-placed stay (VI-19, 17 Nov 2026).
  const projection = { format: "nations", teams: [
    team("es", "3", { first: 0.6, second: 0.4, qf: 1, sf: 0.68, final: 0.43, win: 0.26 }, 15),
    team("fr", "1", { first: 1, qf: 1, sf: 0.61, final: 0.33, win: 0.18 }, 13),
    team("tr", "1", { fourth: 1, relegated: 1 }),
    team("rs", "2", { fourth: 1, barrage: 1 }),
    team("it", "1", { third: 1, stay: 1 }, 10),
  ] };
  const { rows, columns } = nationsProjectionRows(projection, "A");
  assert.deepEqual(rows.map((r) => r.id), ["es", "fr", "it", "rs", "tr"]);
  assert.deepEqual(columns.map((c) => [c.key, c.label, c.range ?? null, c.tone]), [
    ["qf", "Quarts", "1er ou 2e", "ko"], ["barrage", "Barrage", "A/B", "po"], ["relegated", "Relégation", "directe", "out"],
    ["sf", "Final Four", null, "round"], ["final", "Finale", null, "round"], ["win", "Vainqueur", null, "round"],
  ]);
  assert.deepEqual([rows[0].group, rows[0].points, rows[0].played], ["3", 15, 6]);
});

test("Leagues B to D: their groups' places, group by group, the likeliest first; a league of groups of three has no fourth", () => {
  const projection = { format: "nations", teams: [
    team("b2x", "B2", { first: 0.3, second: 0.7 }), team("b1x", "B1", { first: 0.9, second: 0.1 }), team("b1y", "B1", { second: 0.9, first: 0.1 }),
    team("b1w", "B1", { fourth: 1 }), team("b1z", "B1", { third: 1 }, 4),
    team("d1x", "D1", { first: 1 }), team("c1x", "C1", { first: 1 }),
  ] };
  const b = nationsProjectionRows(projection, "B");
  assert.deepEqual(b.rows.map((r) => r.id), ["b1x", "b1y", "b1z", "b1w", "b2x"]);
  assert.deepEqual(b.columns.map((c) => [c.key, c.label]), [["first", "1er"], ["second", "2e"], ["third", "3e"], ["fourth", "4e"]]);
  const d = nationsProjectionRows({ format: "nations", teams: [team("d1x", "D1", { first: 1 }), team("d1y", "D1", { second: 1 }), team("d1z", "D1", { third: 1 })] }, "D");
  assert.deepEqual(d.columns.map((c) => c.key), ["first", "second", "third"]);
  assert.deepEqual(nationsProjectionRows(null, "A"), { rows: [], columns: [] });
  assert.deepEqual(nationsProjectionRows(projection, "A"), { rows: [], columns: [] });  // League A's projection is its own edition's
});
