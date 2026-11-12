import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";

// The hook reads through the resource cache; the rows are pure.
const source = await fs.readFile(new URL("../dashboard/frontend/src/services/pass-partners.js", import.meta.url), "utf8");
const { partnerRows } = await import("data:text/javascript," + encodeURIComponent(source.replace(/^import .*$/m, "const useResource = null, json = null;")));

test("the three partners a player exchanged the most passes with", () => {
  const rows = partnerRows([
    { id: "p_a", name: "A", given: 10, received: 4, matches: 2 },
    { id: "p_b", name: "B", given: 2, received: 30, matches: 5 },
    { id: "p_c", name: "C", given: 0, received: 0, matches: 1 },
    { id: "p_d", name: "D", given: 7, received: 7, matches: 3 },
    { id: "p_e", name: "E", given: 1, received: 1, matches: 1 },
  ]);
  assert.deepEqual(rows.map((row) => [row.id, row.passes]), [["p_b", 32], ["p_a", 14], ["p_d", 14]]);
  assert.deepEqual(partnerRows(null), []);
  assert.deepEqual(partnerRows([{ id: "p_c", name: "C", given: 0, received: 0, matches: 1 }]), []);
});
