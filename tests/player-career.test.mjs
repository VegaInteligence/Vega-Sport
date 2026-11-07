import test from "node:test";
import assert from "node:assert/strict";
import { playerCareerGroups } from "../dashboard/frontend/src/services/player-career.js";
import {
  aggregateSeason,
  seasonMetric,
} from "../dashboard/frontend/src/services/season-player.js";
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
      appearances: rows,
      teams: [
        { id: "club", name: "Club A", imageUrl: "crest" },
        { id: "spain", name: "Espagne" },
      ],
      competitions: [
        { id: "l_0ErfuF", name: "Liga" },
        { id: "l_1XLtP0", name: "Coupe du monde" },
        { id: "other", name: "Autre" },
      ],
    },
    profile: aggregateSeason(rows, id),
  };
}
test("career groups keep exact played rows and partial metrics across seasons", () => {
  const one = row("m1", "club", "l_0ErfuF", { goals: 1 });
  const groups = playerCareerGroups(
    [
      entry("2025/2026", [
        one,
        one,
        row("m2", "spain", "l_1XLtP0", { goals: 0 }),
      ]),
      entry("2026/2027", [
        row("m3", "club", "l_0ErfuF", { goals: null }),
        row("m4", "spain", "l_1XLtP0", { minutes: null }),
        row("m5", "club", "l_0ErfuF", { minutes: 0 }),
      ]),
    ],
    id,
  );
  assert.equal(groups.clubs.length, 1);
  assert.equal(groups.selections.length, 1);
  assert.equal(groups.competitions.length, 2);
  assert.deepEqual(
    groups.clubs[0].profile.rows.map((x) => x.matchId),
    ["m1", "m3"],
  );
  assert.equal(groups.clubs[0].profile.rows[0], one);
  assert.equal(seasonMetric(groups.clubs[0].profile, "goals").count, 1);
  assert.equal(groups.selections[0].profile.unknownMinutes, 1);
  assert.deepEqual(groups.clubs[0].seasons, ["2026/2027", "2025/2026"]);
});
test("unknown or conflicting identities remain unclassified instead of guessing", () => {
  const groups = playerCareerGroups(
    [
      entry("2026/2027", [
        row("x", "unknown", "other"),
        row("y", "mixed", "l_0ErfuF"),
        row("z", "mixed", "l_1XLtP0"),
      ]),
    ],
    id,
  );
  assert.equal(groups.clubs.length, 0);
  assert.equal(groups.selections.length, 0);
  assert.deepEqual(
    new Set(groups.unknown.map((x) => x.key)),
    new Set(["unknown", "mixed"]),
  );
  assert.equal(groups.competitions.length, 3);
});
test("MLS and Saudi domestic leagues classify clubs using published country codes", () => {
  const rows = [
    row("mls", "miami", "l_0eg6C9"),
    row("saudi", "jeddah", "l_0Lpz1f"),
  ];
  const history = entry("2026", rows);
  history.data.competitions.push(
    { id: "l_0eg6C9", name: "MLS", country: "USA" },
    { id: "l_0Lpz1f", name: "Saudi Pro League", providerCountry: "KSA" },
  );
  const groups = playerCareerGroups([history], id);
  assert.deepEqual(
    new Set(groups.clubs.map((x) => x.key)),
    new Set(["miami", "jeddah"]),
  );
});
test("one player match across seasons belongs to one group and prefers a played observation", () => {
  const first = entry("2025/2026", [
    row("duplicate", "wrong", "other", { minutes: null }),
  ]);
  const second = entry("2026", [
    row("duplicate", "miami", "l_0eg6C9", { goals: 1 }),
  ]);
  second.data.competitions.push({
    id: "l_0eg6C9",
    name: "MLS",
    country: "USA",
  });
  const groups = playerCareerGroups([first, second], id);
  assert.deepEqual(
    groups.clubs.map((x) => x.key),
    ["miami"],
  );
  assert.equal(groups.unknown.length, 0);
  assert.deepEqual(
    groups.competitions.map((x) => x.key),
    ["l_0eg6C9"],
  );
  assert.equal(groups.clubs[0].profile.matches, 1);
});
