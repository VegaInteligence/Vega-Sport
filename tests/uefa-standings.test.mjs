import test from "node:test";
import assert from "node:assert/strict";
import {
  hasUefaStandings,
  normalizeUefaStandings,
  uefaSeasonYear,
} from "../dashboard/frontend/src/services/uefa-standings.js";

function group(year, name, size, competitionId = "1") {
  return {
    group: { competitionId, seasonYear: String(year), phase: "TOURNAMENT", metaData: { groupName: name } },
    items: Array.from({ length: size }, (_, i) => ({
      rank: size - i, played: 6, won: 3, drawn: 2, lost: 1,
      goalsFor: 10, goalsAgainst: 4, goalDifference: 6, points: 11,
      teamId: String(1000 + i), team: { internationalName: `Team ${i}` },
    })),
  };
}

test("official league-phase tables keep UEFA rank, statistics and club mapping", () => {
  const input = [group(2026, "League", 36)];
  const output = normalizeUefaStandings(input, "l_0bfbkO", "2025/2026", { 1035: "t_123456" });
  assert.equal(output.source, "UEFA");
  assert.equal(output.season, "2025/2026");
  assert.equal(output.tables[0].name, "Phase de ligue");
  assert.equal(output.tables[0].rows.length, 36);
  assert.deepEqual(output.tables[0].rows[0], {
    id: "t_123456", uefaId: "1035", name: "Team 35", imageUrl: "",
    position: 1, played: 6, wins: 3, draws: 2, losses: 1,
    goalsFor: 10, goalsAgainst: 4, difference: 6, points: 11,
  });
});

test("older seasons keep their eight group tables and UEFA's tie-break order", () => {
  const groups = "ABCDEFGH".split("").map((letter) => group(2024, `Group ${letter}`, 4));
  const output = normalizeUefaStandings(groups, "l_0bfbkO", "2023/2024");
  assert.deepEqual(output.tables.map((table) => table.name), "ABCDEFGH".split("").map((letter) => `Groupe ${letter}`));
  assert.deepEqual(output.tables[0].rows.map((row) => row.position), [1, 2, 3, 4]);
  assert.equal(output.tables[0].rows[0].points, 11);
});

test("rejects truncated, wrong-season, wrong-competition and inconsistent standings", () => {
  const valid = [group(2026, "League", 36)];
  assert.equal(normalizeUefaStandings(valid, "l_0bfbkO", "2024/2025"), null);
  assert.equal(normalizeUefaStandings(valid, "l_38d9HA", "2025/2026"), null);
  const partial = structuredClone(valid);
  partial[0].items.pop();
  assert.equal(normalizeUefaStandings(partial, "l_0bfbkO", "2025/2026"), null);
  const broken = structuredClone(valid);
  broken[0].items[0].goalsFor++;
  assert.equal(normalizeUefaStandings(broken, "l_0bfbkO", "2025/2026"), null);
});

test("supports the three European competitions and validates season identity", () => {
  assert.equal(uefaSeasonYear("2025/2026"), 2026);
  assert.equal(uefaSeasonYear("2025/2027"), null);
  assert.equal(uefaSeasonYear("2020/2021"), null);
  assert.ok(hasUefaStandings("l_38d9HA", "2025/2026"));
  assert.ok(hasUefaStandings("l_2WZ2tt", "2021/2022"));
  assert.equal(hasUefaStandings("l_4WFCIZ", "2025/2026"), false);
  assert.equal(normalizeUefaStandings([group(2026, "League", 36, "14")], "l_38d9HA", "2025/2026").competition, "Ligue Europa");
});
