import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";

// The hook reads through the resource cache; the rows are pure.
const source = await fs.readFile(new URL("../dashboard/frontend/src/services/player-actions.js", import.meta.url), "utf8");
const { actionRows, ACTION_MIN_MINUTES } = await import(
  "data:text/javascript," + encodeURIComponent(source.replace(/^import .*$/m, "const useResource = null, json = null;"))
);

const answer = {
  competition: { id: "l_aaaaa1", name: "Ligue 1" }, role: "winger", position: "Ailier / milieu offensif", minutes: 1840, peers: 54,
  values: [
    { key: "vaep", value: 0.413, rank: 3, percentile: 95.4, offensive: 0.439, defensive: -0.026 },
    { key: "pv", value: 0.387, rank: 5, percentile: 91.7, offensive: 0.38, defensive: 0.007 },
    { key: "xt", value: 0.083, rank: 30, percentile: 45.4 },
  ],
};

test("a player's action values read as three rows, each with its place among his role", () => {
  const table = actionRows(answer);
  assert.deepEqual([table.competition, table.position, table.peers, table.minutes, table.placed], ["Ligue 1", "Ailier / milieu offensif", 54, 1840, true]);
  assert.deepEqual(table.rows.map((row) => [row.key, row.label, row.value, row.rank, row.percentile]), [
    ["vaep", "VAEP", 0.413, 3, 95], ["pv", "Valeur de possession (PV)", 0.387, 5, 92], ["xt", "Menace attendue (xT)", 0.083, 30, 45],
  ]);
  // The two parts are read beside their total; the threat has none.
  assert.deepEqual(table.rows.map((row) => row.parts), [{ offensive: 0.439, defensive: -0.026 }, { offensive: 0.38, defensive: 0.007 }, null]);
  assert.equal(ACTION_MIN_MINUTES, 450);
});

test("too few players of his role in his league: the values, without a rank", () => {
  const table = actionRows({ ...answer, peers: 7, values: [{ key: "vaep", value: 0.151, offensive: 0.14, defensive: 0.011 }, { key: "pv", value: 0.13 }, { key: "xt", value: 0.091 }] });
  assert.equal(table.placed, false);
  assert.deepEqual(table.rows.map((row) => [row.value, row.rank, row.percentile]), [[0.151, null, null], [0.13, null, null], [0.091, null, null]]);
  assert.deepEqual(table.rows.map((row) => Boolean(row.parts)), [true, false, false]);
});

test("no reading, or a measure the site does not know, gives no row", () => {
  assert.equal(actionRows(null), null);
  assert.equal(actionRows({ values: [] }), null);
  assert.equal(actionRows({ values: [{ key: "obv", value: 0.2 }, { key: "vaep" }] }), null);
  assert.equal(actionRows({ ...answer, values: [...answer.values, { key: "obv", value: 0.2 }] }).rows.length, 3);
});
