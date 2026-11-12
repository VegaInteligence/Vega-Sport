import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";

// The hook reads through the resource cache; the figures and phrases are pure.
const source = await fs.readFile(new URL("../dashboard/frontend/src/services/club-substitutions.js", import.meta.url), "utf8");
const { changeFacts, substituteLine } = await import("data:text/javascript," + encodeURIComponent(source.replace(/^import .*$/m, "const useResource = null, json = null;")));

test("the four figures of what followed a club's changes", () => {
  const facts = changeFacts({ matches: 14, pointsThen: 27, points: 35, gained: 8,
    leading: { matches: 7, pointsThen: 21, points: 19 }, level: { matches: 4, pointsThen: 4, points: 8 }, behind: { matches: 3, pointsThen: 0, points: 8 } });
  assert.deepEqual(facts.map((f) => [f.label, f.value, f.unit ?? null, f.note]), [
    ["Points au premier changement", 27, null, "si chaque score en était resté là · 14 matchs"],
    ["Points à la fin", 35, null, "+8 après les changements"],
    ["Mené au premier changement", 3, "matchs", "8 points pris"],
    ["Menait au premier changement", 7, "matchs", "2 points perdus"],
  ]);
  const flat = changeFacts({ matches: 1, pointsThen: 3, points: 1, gained: -2,
    leading: { matches: 1, pointsThen: 3, points: 1 }, level: { matches: 0, pointsThen: 0, points: 0 }, behind: { matches: 0, pointsThen: 0, points: 0 } });
  assert.deepEqual([flat[0].note, flat[1].note, flat[2].unit, flat[2].note, flat[3].unit], ["si chaque score en était resté là · 1 match", "-2 après les changements", "match", "0 point pris", "match"]);
  assert.equal(changeFacts(null), null);
  assert.equal(changeFacts({ matches: 0 }), null);
});

test("a decisive substitute reads as one phrase", () => {
  assert.equal(substituteLine({ name: "Gonçalo Ramos", goals: 4, assists: 1, entries: 9 }), "Gonçalo Ramos (4 buts, 1 passe décisive en 9 entrées)");
  assert.equal(substituteLine({ name: "A", goals: 1, assists: 0, entries: 1 }), "A (1 but en 1 entrée)");
  assert.equal(substituteLine({ name: "B", goals: 0, assists: 2, entries: 3 }), "B (2 passes décisives en 3 entrées)");
});
