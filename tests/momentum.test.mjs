import assert from "node:assert/strict";
import test from "node:test";
import { momentumSpells } from "../dashboard/frontend/src/services/momentum.js";

// One point a minute; the pressure is 0 except where the spells say so.
const match = (spells, minutes = 90) =>
  Array.from({ length: minutes }, (_, i) => ({ minute: i + 1, value: spells[i + 1] ?? 0 }));

test("the strongest five-minute spells, the strongest first, never overlapping", () => {
  const points = match({ 10: 0.5, 11: 0.6, 12: 0.7, 13: 0.6, 14: 0.5, 61: -0.9, 62: -0.9, 63: -0.9, 64: -0.9, 65: -0.9, 80: 0.3 });
  assert.deepEqual(momentumSpells(points).map((s) => [s.side, s.from, s.to]), [["away", 61, 65], ["home", 10, 14], ["home", 76, 80]]);
  assert.deepEqual(momentumSpells(points, { count: 1 }).map((s) => s.side), ["away"]);
});

test("no spell is read from a match barely measured, from a flat one or across missing minutes", () => {
  assert.deepEqual(momentumSpells(match({ 3: 1 }, 20)), []);
  assert.deepEqual(momentumSpells(match({})), []);
  assert.deepEqual(momentumSpells(null), []);
  // Minutes 44 to 47 are missing: the stretch around them is not a full spell.
  const cut = match({ 42: 1, 43: 1, 48: 1, 49: 1 }).filter((p) => p.minute < 44 || p.minute > 47);
  assert.ok(momentumSpells(cut).every((s) => s.to < 44 || s.from > 47));
});
