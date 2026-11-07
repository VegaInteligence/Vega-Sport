import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregateSeason,
  seasonMetric,
} from "../dashboard/frontend/src/services/season-player.js";
import {
  playerSeasonGroups,
  playerHistoryInPeriod,
  seasonTrendPoints,
} from "../dashboard/frontend/src/services/player-season-history.js";

test("date windows narrow displayed totals without changing a cached season", () => {
  const id = "p_123456";
  const appearances = [
    {
      playerId: id,
      matchId: "one",
      date: "2026-10-01",
      teamId: "club",
      leagueId: "league",
      minutes: 90,
      goals: 1,
    },
    {
      playerId: id,
      matchId: "two",
      date: "2026-10-31",
      teamId: "club",
      leagueId: "league",
      minutes: null,
    },
    {
      playerId: id,
      matchId: "three",
      date: "2026-11-01",
      teamId: "club",
      leagueId: "league",
      minutes: 90,
      goals: 3,
    },
  ];
  const original = [
    {
      season: "2026/2027",
      data: {
        appearances,
        matches: appearances.map((row) => ({
          id: row.matchId,
          date: row.date,
        })),
      },
      profile: aggregateSeason(appearances, id),
    },
  ];
  const [period] = playerHistoryInPeriod(original, id, {
    from: "2026-10-01",
    to: "2026-10-31",
  });
  assert.deepEqual(
    period.data.appearances.map((row) => row.matchId),
    ["one", "two"],
  );
  assert.equal(period.profile.matches, 1);
  assert.equal(period.profile.unknownMinutes, 1);
  assert.equal(period.profile.stats.goals.sum, 1);
  assert.equal(original[0].data.appearances.length, 3);
  assert.equal(original[0].profile.matches, 2);
  assert.equal(playerHistoryInPeriod(original, id), original);
});

test("history groups competitions under one team total per season", () => {
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
      rating: 8,
    },
    {
      playerId: id,
      matchId: "m2",
      minutes: 60,
      teamId: "a",
      team: "FC Club A",
      leagueId: "l1",
      league: "Ligue",
      goals: 0,
      assists: 1,
      rating: 6,
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
      rating: 9,
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
    {
      playerId: id,
      matchId: "m5",
      minutes: null,
      teamId: "a",
      team: "Club A",
      leagueId: "l2",
      league: "Coupe",
    },
  ];
  appearances.push({ ...appearances[0], leagueId: "duplicate" });
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
        appearances,
      },
      profile: aggregateSeason(appearances, id),
    },
  ];
  const groups = playerSeasonGroups(seasons, id);
  assert.equal(groups.length, 2);
  const club = groups.find(({ team }) => team.id === "a");
  assert.equal(club.team.imageUrl, "https://cdn.pitchapi.dev/a.png");
  assert.equal(club.profile.matches, 3);
  assert.equal(club.profile.minutes, 180);
  assert.equal(club.profile.unknownMinutes, 1);
  assert.equal(club.profile.rating, 23 / 3);
  assert.equal(seasonMetric(club.profile, "goals").value, 3);
  assert.deepEqual(
    club.competitions.map(({ competition }) => competition.id),
    ["l1", "l2"],
  );
  const [league, cup] = club.competitions;
  assert.equal(league.profile.matches, 2);
  assert.equal(seasonMetric(league.profile, "goals").value, 1);
  assert.equal(seasonMetric(league.profile, "xg").count, 1);
  assert.equal(cup.profile.matches, 1);
  assert.equal(cup.profile.unknownMinutes, 1);
  assert.equal(
    groups.find((row) => row.team.id === "b").team.name,
    "Sélection",
  );
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
