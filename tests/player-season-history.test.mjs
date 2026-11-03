import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregateSeason,
  seasonMetric,
} from "../dashboard/frontend/src/services/season-player.js";
import {
  playerSeasonRows,
  seasonTrendPoints,
} from "../dashboard/frontend/src/services/player-season-history.js";

test("history keeps a player's teams and competitions separate, with their own observed totals", () => {
  const id = "p_123456";
  const appearances = [
    {
      playerId: id,
      matchId: "m1",
      minutes: 90,
      teamId: "a",
      team: "Club A",
      leagueId: "l1",
      league: "Ligue",
      goals: 1,
      assists: 0,
      xg: 0.4,
    },
    {
      playerId: id,
      matchId: "m2",
      minutes: 60,
      teamId: "a",
      team: "Club A",
      leagueId: "l1",
      league: "Ligue",
      goals: 0,
      assists: 1,
    },
    {
      playerId: id,
      matchId: "m3",
      minutes: 30,
      teamId: "a",
      team: "Club A",
      leagueId: "l2",
      league: "Coupe",
      goals: 2,
    },
    {
      playerId: id,
      matchId: "m4",
      minutes: 90,
      teamId: "b",
      team: "Sélection",
      leagueId: "l3",
      league: "Mondial",
      goals: 1,
    },
  ];
  const seasons = [
    {
      season: "2026/2027",
      data: {
        teams: [
          {
            id: "a",
            name: "Club A",
            imageUrl: "https://cdn.pitchapi.dev/a.png",
          },
        ],
        competitions: [{ id: "l1", name: "Ligue" }],
      },
      profile: aggregateSeason(appearances, id),
    },
  ];
  const rows = playerSeasonRows(seasons, id);
  assert.equal(rows.length, 3);
  const league = rows.find((row) => row.competition.id === "l1");
  assert.equal(league.team.imageUrl, "https://cdn.pitchapi.dev/a.png");
  assert.equal(league.profile.matches, 2);
  assert.equal(seasonMetric(league.profile, "goals").value, 1);
  assert.equal(seasonMetric(league.profile, "xg").count, 1);
  assert.equal(
    rows.find((row) => row.competition.id === "l2").profile.matches,
    1,
  );
  assert.equal(rows.find((row) => row.team.id === "b").team.name, "Sélection");
});

test("a missing season is a gap, not a line between distant observations", () => {
  const seasons = [
    { season: "2026/2027", profile: { value: 8.2 } },
    { season: "2022/2023", profile: { value: 8.1 } },
  ];
  const points = seasonTrendPoints(seasons, (profile) => profile.value);
  assert.deepEqual(
    points.map((point) => point.label),
    ["2022/2023", "2023/2024", "2024/2025", "2025/2026", "2026/2027"],
  );
  assert.deepEqual(
    points.map((point) => point.value),
    [8.1, null, null, null, 8.2],
  );
});
