import test from "node:test";
import assert from "node:assert/strict";
import { leagueStrength } from "../dashboard/frontend/src/services/league-levels.js";

const levels = {
  onScale: 3,
  ranked: 4,
  leagues: [
    { id: "l_a", name: "A", country: "ENG", level: 1777.1, rank: 1, onScale: true, provisional: false, margin: 10, universe: "men", seasons: [{ season: "2024/2025", level: 1760 }, { season: "2025/2026", level: 1771 }, { season: "2026/2027", level: 1777.1 }] },
    { id: "l_b", name: "B", country: "GER", level: 1692, rank: 2, onScale: true, provisional: false, margin: 13, universe: "men", seasons: [{ season: "2026/2027", level: 1692 }] },
    { id: "l_c", name: "C", country: "ESP", level: 1647, rank: 3, onScale: true, provisional: false, margin: 14, universe: "men", seasons: [] },
    { id: "l_d", name: "D", country: "USA", level: 1504, rank: 4, onScale: false, provisional: true, margin: 72, universe: "men", seasons: [{ season: "2026/2027", level: 1504 }] },
    { id: "l_w", name: "W", country: "KSA", level: 1500, rank: null, onScale: false, provisional: false, margin: null, universe: "women", seasons: [] },
  ],
};

test("a league's strength card: level, rank, seasons most recent first, neighbours on the scale", () => {
  const middle = leagueStrength(levels, "l_b");
  assert.deepEqual([middle.level, middle.rank, middle.of, middle.onScale, middle.provisional], [1692, 2, 4, true, false]);
  assert.deepEqual([middle.above.name, middle.below.name], ["A", "C"]);
  const first = leagueStrength(levels, "l_a");
  assert.equal(first.above, null);
  assert.deepEqual(first.history.map((row) => row.season), ["2026/2027", "2025/2026", "2024/2025"]);
  assert.deepEqual(first.history.map((row) => (row.change === null ? null : Math.round(row.change))), [6, 11, null]);
  assert.equal(leagueStrength(levels, "l_c").below.name, "D"); // a provisional league is on the scale too
});

test("a provisional league has its level, rank and margin; a women's league no rank; a cup no card", () => {
  const provisional = leagueStrength(levels, "l_d");
  assert.deepEqual([provisional.onScale, provisional.provisional, provisional.margin, provisional.level, provisional.rank, provisional.below],
    [true, true, 72, 1504, 4, null]);
  const women = leagueStrength(levels, "l_w");
  assert.deepEqual([women.onScale, women.women, women.level, women.rank, women.history.length], [false, true, null, null, 0]);
  assert.equal(leagueStrength(levels, "l_cup"), null);
  assert.equal(leagueStrength(null, "l_a"), null);
});
