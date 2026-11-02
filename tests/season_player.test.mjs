import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregateSeason,
  createSeasonPeerBuilder,
  playerSearchResults,
  seasonMetric,
} from "../dashboard/frontend/src/services/season-player.js";

test("a season keeps observed zero, missing values and metric-specific minutes distinct", () => {
  const rows = [
    {
      playerId: "p_A",
      matchId: "m_1",
      name: "Neymar",
      date: "2026-07-05",
      team: "Brazil",
      positionId: 91,
      minutes: 90,
      goals: 2,
      xg: 1.2,
      passesAccurate: 8,
      passesAttempted: 10,
      duelsWon: 2,
      duelsLost: 2,
      rating: 8,
    },
    {
      playerId: "p_A",
      matchId: "m_2",
      name: "Neymar",
      date: "2026-07-01",
      team: "Brazil",
      positionId: 91,
      minutes: 30,
      goals: 0,
      xg: null,
      passesAccurate: 1,
      passesAttempted: 2,
      duelsWon: 0,
      duelsLost: 1,
      rating: 6,
    },
    { playerId: "p_A", matchId: "m_2", name: "Neymar", minutes: 30, goals: 20 },
    {
      playerId: "p_A",
      matchId: "m_bench",
      name: "Neymar",
      minutes: 0,
      goals: 0,
    },
    {
      playerId: "p_A",
      matchId: "m_unknown",
      name: "Neymar",
      minutes: null,
      goals: 1,
    },
    { playerId: "p_B", matchId: "m_3", name: "Neymar", minutes: 90, goals: 30 },
  ];
  const p = aggregateSeason(rows, "p_A");
  assert.equal(p.matches, 2);
  assert.equal(p.minutes, 120);
  assert.equal(p.unknownMinutes, 1);
  assert.equal(p.rating, 7);
  assert.deepEqual(
    p.rows.map((r) => r.matchId),
    ["m_1", "m_2"],
  );
  assert.deepEqual(seasonMetric(p, "goals", "total"), {
    value: 2,
    count: 2,
    minutes: 120,
  });
  assert.equal(seasonMetric(p, "goals", "perMatch").value, 1);
  assert.equal(seasonMetric(p, "goals", "per90").value, 1.5);
  assert.deepEqual(seasonMetric(p, "xg", "per90"), {
    value: 1.2,
    count: 1,
    minutes: 90,
  });
  assert.equal(seasonMetric(p, "passAccuracy", "total").value, 75);
  assert.equal(seasonMetric(p, "duelRate", "per90").value, 40);
  assert.equal(seasonMetric(p, "xa").value, null);
});

test("search returns a single result per case-sensitive player ID and preserves homonyms", () => {
  const rows = [
    { playerId: "p_Ab", name: "Neymár", team: "A" },
    { playerId: "p_Ab", name: "Neymár", team: "A" },
    { playerId: "p_aB", name: "Neymar", team: "B" },
    { playerId: "p_C", name: "Someone else", team: "Neymar FC" },
  ];
  assert.deepEqual(
    playerSearchResults(rows, "neymar").map((p) => p.id),
    ["p_Ab", "p_aB"],
  );
  assert.deepEqual(playerSearchResults(rows, "n"), []);
});

test("season percentiles compare aggregated players in the same position and coverage", () => {
  const rows = [];
  for (let i = 0; i < 31; i++) {
    for (let match = 0; match < 5; match++) {
      rows.push({
        playerId: `p_${i}`,
        matchId: `m_${i}_${match}`,
        name: `Player ${i}`,
        minutes: 90,
        positionId: 91,
        xg: i / 5,
      });
    }
  }
  rows.push({
    playerId: "p_defender",
    matchId: "m_def",
    name: "Defender",
    minutes: 900,
    positionId: 31,
    xg: 100,
  });
  const target = aggregateSeason(rows, "p_15");
  const builder = createSeasonPeerBuilder(rows, target);
  while (!builder.step(7)) {}
  const result = builder.result();
  assert.equal(result.peers, 31);
  assert.equal(result.metrics.xg.peers, 31);
  assert.equal(result.metrics.xg.percentile, 50);
  assert.equal(result.metrics.xa.percentile, null);
});

test("incomplete target coverage does not produce a season percentile", () => {
  const rows = [];
  for (let player = 0; player < 31; player++) {
    for (let match = 0; match < 5; match++) {
      rows.push({
        playerId: `p_${player}`,
        matchId: `m_${player}_${match}`,
        name: `Player ${player}`,
        minutes: 90,
        positionId: 91,
        xg: player === 0 && match === 0 ? null : 0.5,
      });
    }
  }
  const target = aggregateSeason(rows, "p_0");
  const builder = createSeasonPeerBuilder(rows, target);
  while (!builder.step(50)) {}
  assert.equal(builder.result().metrics.xg.percentile, null);
});

test("the player role is chosen by total minutes in the position group", () => {
  const rows = [
    {
      playerId: "p_role",
      matchId: "m_a",
      name: "Player",
      minutes: 300,
      positionId: 81,
    },
    {
      playerId: "p_role",
      matchId: "m_b",
      name: "Player",
      minutes: 300,
      positionId: 91,
    },
    {
      playerId: "p_role",
      matchId: "m_c",
      name: "Player",
      minutes: 400,
      positionId: 61,
    },
  ];
  assert.equal(aggregateSeason(rows, "p_role").role.group, "O");
});

import { filterSeasonPlayerScope } from "../dashboard/frontend/src/services/season-player.js";
import {
  advancedTest,
  EMPTY_ADVANCED,
} from "../dashboard/frontend/src/services/advanced-filters.js";
test("player season scope keeps advanced filters but ignores name search and selected match", () => {
  const rows = [
    {
      playerId: "p_A",
      matchId: "m_1",
      name: "Neymar",
      team: "Brazil",
      league: "World Cup",
      leagueId: "l_1",
      season: "2026/2027",
      minutes: 23,
      starter: true,
      goals: 1,
    },
    {
      playerId: "p_A",
      matchId: "m_2",
      name: "Neymar",
      team: "Brazil",
      league: "World Cup",
      leagueId: "l_1",
      season: "2026/2027",
      minutes: 14,
      starter: false,
      goals: 0,
    },
  ];
  const advanced = { ...EMPTY_ADVANCED, role: "starter" };
  const scope = {
    query: "unrelated search",
    match: "m_2",
    league: "all",
    season: "2026/2027",
    minutes: 1,
    test: advancedTest(advanced, new Map()),
  };
  const filtered = filterSeasonPlayerScope(rows, scope);
  assert.deepEqual(
    filtered.map((row) => row.matchId),
    ["m_1"],
  );
  assert.equal(aggregateSeason(filtered, "p_A").minutes, 23);
});
