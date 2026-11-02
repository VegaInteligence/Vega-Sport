import test from "node:test";
import assert from "node:assert/strict";
import {
  followedRecords,
  recentRecords,
  recentFinishedMatches,
} from "../dashboard/frontend/src/services/home.js";
import {
  fixtureWeek,
  upcomingFixtures,
} from "../dashboard/frontend/src/services/fixtures.js";

const now = Date.parse("2026-11-02T12:00:00Z");
test("home honors followed competitions and keeps all when none are chosen", () => {
  const rows = [{ leagueId: "eng" }, { leagueId: "fra" }, { leagueId: "eng" }];
  assert.deepEqual(followedRecords(rows, ["fra"]), [rows[1]]);
  assert.equal(followedRecords(rows, []), rows);
});

test("recent home matches have a valid date in the last 14 Paris days and a finished score", () => {
  const matches = [
    {
      id: "old-final",
      date: "2025-05-31",
      home: { score: 5 },
      away: { score: 0 },
    },
    {
      id: "first-day",
      date: "2026-10-20",
      home: { score: 0 },
      away: { score: 0 },
    },
    {
      id: "too-old",
      date: "2026-10-19",
      home: { score: 2 },
      away: { score: 1 },
    },
    {
      id: "future",
      date: "2026-11-03",
      home: { score: 2 },
      away: { score: 1 },
    },
    {
      id: "not-finished",
      date: "2026-11-01",
      finished: false,
      home: { score: 1 },
      away: { score: 1 },
    },
    { id: "missing-score", date: "2026-11-01", home: {}, away: { score: 0 } },
    {
      id: "bad-date",
      date: "2026-02-30",
      home: { score: 1 },
      away: { score: 0 },
    },
  ];
  assert.deepEqual(
    recentFinishedMatches(matches, now).map((match) => match.id),
    ["first-day"],
  );
});

test("recent performances exclude old match clubs and include the 30th day", () => {
  const rows = [
    { id: "gyokeres-2024", date: "2024-11-01", team: "Sporting CP" },
    { id: "boundary", date: "2026-10-04" },
    { id: "before-boundary", date: "2026-10-03" },
    { id: "today", date: "2026-11-02" },
    { id: "future", date: "2026-11-03" },
  ];
  assert.deepEqual(
    recentRecords(rows, now, 30).map((row) => row.id),
    ["boundary", "today"],
  );
});

test("compact fixture selection intersects favorites with the explicit league filter", () => {
  const fixtures = [
    {
      id: "eng1",
      status: "not_started",
      date: "2026-11-03",
      league: { id: "eng" },
    },
    {
      id: "fra1",
      status: "not_started",
      date: "2026-11-03",
      league: { id: "fra" },
    },
  ];
  const options = {
    week: fixtureWeek("2026-11-02"),
    now,
    league: "all",
    query: "",
  };
  assert.deepEqual(
    upcomingFixtures(fixtures, { ...options, favoriteLeagueIds: ["eng"] }).map(
      (x) => x.fixture.id,
    ),
    ["eng1"],
  );
  assert.equal(
    upcomingFixtures(fixtures, {
      ...options,
      league: "fra",
      favoriteLeagueIds: ["eng"],
    }).length,
    0,
  );
  assert.equal(upcomingFixtures(fixtures, options).length, 2);
});
