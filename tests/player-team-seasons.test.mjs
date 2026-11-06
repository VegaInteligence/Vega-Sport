import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregateSeason,
  seasonMetric,
} from "../dashboard/frontend/src/services/season-player.js";
import { playerTeamSeasons } from "../dashboard/frontend/src/services/player-team-seasons.js";

const id = "p_123456";
const row = (matchId, teamId, leagueId, extra = {}) => ({
  playerId: id,
  matchId,
  teamId,
  team: teamId,
  leagueId,
  minutes: 90,
  ...extra,
});
function entry(season, rows) {
  return {
    season,
    data: {
      teams: [
        { id: "a", name: "Club A" },
        { id: "b", name: "Spain" },
      ],
      competitions: [
        { id: "l_0ErfuF", country: "ESP" },
        { id: "cup", country: "ESP" },
        { id: "l_1XLtP0", country: "INT" },
      ],
    },
    profile: aggregateSeason(rows, id),
  };
}

test("splits played team seasons, aggregates competitions, and retains missing metrics", () => {
  const rows = playerTeamSeasons([
    entry("2026/2027", [
      row("1", "a", "l_0ErfuF", { goals: 1, rating: 8 }),
      row("2", "a", "cup", { goals: 0, rating: 6 }),
      row("3", "b", "l_1XLtP0", { assists: 0 }),
      row("4", "c", "l_0ErfuF", { minutes: 25, goals: 2 }),
      row("4", "c", "l_0ErfuF", { minutes: 25, goals: 2 }),
      row("5", "c", "l_0ErfuF", { minutes: 0 }),
      row("6", "c", "l_0ErfuF", { minutes: null }),
    ]),
  ]);
  assert.deepEqual(
    rows.map((x) => [x.teamId, x.kind]),
    [
      ["a", "club"],
      ["c", "club"],
      ["b", "selection"],
    ],
  );
  assert.equal(rows[0].profile.matches, 2);
  assert.equal(rows[0].profile.minutes, 180);
  assert.equal(rows[0].profile.rating, 7);
  assert.equal(seasonMetric(rows[0].profile, "goals").value, 1);
  assert.equal(seasonMetric(rows[0].profile, "assists").value, null);
  assert.equal(seasonMetric(rows[2].profile, "assists").value, 0);
  assert.equal(rows[1].profile.matches, 1);
  assert.equal(rows[0].team, "Club A");
});

test("preserves native years and stable IDs, excludes ambiguous teams, and does not guess international kind", () => {
  const rows = playerTeamSeasons([
    entry("2026/2027", [row("1", "a", "l_0ErfuF"), row("2", "", "l_0ErfuF")]),
    entry("2026", [row("3", "b", "unknown")]),
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].season, "2026");
  assert.equal(rows[1].kind, "unknown");
  assert.notEqual(rows[0].key, rows[1].key);
  const translated = entry("2026/2027", [
    row("1", "a", "l_0ErfuF", { team: "Translated" }),
  ]);
  assert.equal(playerTeamSeasons([translated])[0].key, rows[0].key);
});
