import test from "node:test";
import assert from "node:assert/strict";
import { leagueStrength } from "../dashboard/frontend/src/services/league-levels.js";

const levels = {
  onScale: 3,
  leagues: [
    { id: "l_a", name: "A", country: "ENG", level: 1777.1, rank: 1, onScale: true, seasons: [{ season: "2024/2025", level: 1760 }, { season: "2025/2026", level: 1771 }, { season: "2026/2027", level: 1777.1 }] },
    { id: "l_b", name: "B", country: "GER", level: 1692, rank: 2, onScale: true, seasons: [{ season: "2026/2027", level: 1692 }] },
    { id: "l_c", name: "C", country: "ESP", level: 1647, rank: 3, onScale: true, seasons: [] },
    { id: "l_d", name: "D", country: "USA", level: 1500, rank: null, onScale: false, seasons: [{ season: "2026/2027", level: 1500 }] },
  ],
};

test("a league's strength card: level, rank, seasons most recent first, neighbours on the scale", () => {
  const middle = leagueStrength(levels, "l_b");
  assert.deepEqual([middle.level, middle.rank, middle.of, middle.onScale], [1692, 2, 3, true]);
  assert.deepEqual([middle.above.name, middle.below.name], ["A", "C"]);
  const first = leagueStrength(levels, "l_a");
  assert.equal(first.above, null);
  assert.deepEqual(first.history.map((row) => row.season), ["2026/2027", "2025/2026", "2024/2025"]);
  assert.deepEqual(first.history.map((row) => (row.change === null ? null : Math.round(row.change))), [6, 11, null]);
  assert.equal(leagueStrength(levels, "l_c").below, null); // the next league is off the scale: no neighbour
});

test("a league off the common scale has no level to show, a cup no card", () => {
  const off = leagueStrength(levels, "l_d");
  assert.deepEqual([off.onScale, off.level, off.rank, off.history.length], [false, null, null, 0]);
  assert.equal(leagueStrength(levels, "l_cup"), null);
  assert.equal(leagueStrength(null, "l_a"), null);
});
