import test from "node:test";
import assert from "node:assert/strict";
import {
  ballonDorRaceOpen,
  bestDefence,
  inSeason,
  bestWinStreak,
  biggestWin,
  leagueProgress,
  matchdayWindow,
  playerOfTheWeek,
  seasonLeaders,
  seasonTotals,
  selectMatchOfTheWeek,
  teamRanks,
  upcomingHighlights,
  weekPerformances,
  weekResults,
  xgTimeline,
} from "../dashboard/frontend/src/services/home-insights.js";

const UCL = "l_0bfbkO",
  L1 = "l_3FJFUl",
  BUN = "l_1Isor4",
  ERE = "l_4H43wr";
const match = (id, leagueId, date, home, away, hs, as, extra = {}) => ({
  id,
  leagueId,
  date,
  timeUtc: date + "T19:00:00Z",
  status: "finished",
  home: { id: home, name: home, score: hs },
  away: { id: away, name: away, score: as },
  ...extra,
});
const fixture = (
  id,
  league,
  date,
  home,
  away,
  sh,
  sa,
  status = "finished",
) => ({
  id,
  date,
  time_utc: date + "T19:00:00Z",
  status,
  league: { id: league },
  home_team: { id: home, name: home },
  away_team: { id: away, name: away },
  score_home: sh,
  score_away: sa,
});

test("the home week ends on the last finished match, even on a past season", () => {
  const now = Date.parse("2026-11-03T11:00:00Z");
  const current = matchdayWindow(
    [
      match("a", L1, "2026-11-01", "x", "y", 1, 0),
      match("b", L1, "2026-11-04", "x", "y", 1, 0, { status: "not_started" }),
    ],
    now,
  );
  assert.deepEqual(current, {
    start: "2026-10-26",
    end: "2026-11-01",
    current: true,
  });
  const past = matchdayWindow(
    [match("c", L1, "2026-05-24", "x", "y", 2, 2)],
    now,
  );
  assert.equal(past.end, "2026-05-24");
  assert.equal(past.current, false);
  assert.equal(matchdayWindow([], now), null);
  const results = weekResults(
    [
      match("in", L1, "2026-10-27", "x", "y", 0, 0),
      match("out", L1, "2026-10-20", "x", "y", 0, 0),
    ],
    current,
  );
  assert.deepEqual(
    results.map((m) => m.id),
    ["in"],
  );
});

test("the match of the week prefers two big clubs near the top of the table", () => {
  const ranks = new Map([
    ["t_1cpjqO", { rank: 1 }],
    ["t_386iz1", { rank: 2 }],
    ["t_0BrMnM", { rank: 6 }],
    ["t_1gkhxH", { rank: 1 }],
  ]);
  const klassiker = match(
    "klassiker",
    BUN,
    "2026-10-31",
    "t_1cpjqO",
    "t_386iz1",
    2,
    2,
  );
  const liverpool = match(
    "liverpool",
    "l_4WFCIZ",
    "2026-11-01",
    "t_0BrMnM",
    "t_1gkhxH",
    0,
    1,
  );
  const ordinary = match(
    "ordinary",
    ERE,
    "2026-11-01",
    "excelsior",
    "twente",
    0,
    9,
  );
  assert.equal(
    selectMatchOfTheWeek([ordinary, liverpool, klassiker], ranks).id,
    "klassiker",
  );
  assert.equal(selectMatchOfTheWeek([ordinary], ranks).id, "ordinary");
  assert.equal(biggestWin([ordinary, klassiker]).margin, 9);
});

test("expected goals accumulate per team and an own goal counts for the other side", () => {
  const m = match("m", L1, "2026-11-01", "h", "a", 1, 1, {
    shots: [
      {
        teamId: "h",
        minute: 10,
        xg: 0.4,
        isGoal: true,
        playerName: "Alpha One",
      },
      { teamId: "a", minute: 30, xg: 0.2, isGoal: false, playerName: "Beta" },
      {
        teamId: "h",
        minute: 80,
        xg: 0.1,
        isGoal: false,
        isOwnGoal: true,
        playerName: "Gamma",
      },
    ],
  });
  const line = xgTimeline(m);
  assert.equal(line.total.home, 0.4);
  assert.equal(line.total.away, 0.2);
  assert.deepEqual(
    line.goals.map((g) => [g.side, g.minute, g.ownGoal]),
    [
      ["home", 10, false],
      ["away", 80, true],
    ],
  );
  assert.equal(line.end, 90);
});

test("league progress keeps points after every game, the form and the winning run", () => {
  const fixtures = [
    fixture("1", L1, "2026-08-01", "psg", "lille", 2, 0),
    fixture("2", L1, "2026-08-08", "lille", "psg", 1, 1),
    fixture("3", L1, "2026-08-15", "psg", "lyon", 3, 0),
    fixture("4", L1, "2026-08-22", "lyon", "lille", 0, 1),
    fixture("5", L1, "2026-08-29", "psg", "lyon", null, null, "not_started"),
    fixture("u", UCL, "2026-09-01", "psg", "inter", 1, 0),
  ];
  const progress = leagueProgress(fixtures);
  assert.deepEqual([...progress.keys()], [L1]);
  const table = progress.get(L1),
    psg = table.rows[0];
  assert.equal(psg.id, "psg");
  assert.deepEqual(psg.cumulative, [3, 4, 7]);
  assert.deepEqual(psg.form, ["W", "D", "W"]);
  assert.equal(psg.streak, 1);
  assert.equal(table.games, 4);
  assert.equal(teamRanks(progress).get("lyon").rank, 3);
  assert.equal(bestWinStreak(progress), null);
});

test("upcoming highlights stay within a week, in the selection, the biggest first", () => {
  const now = Date.parse("2026-11-03T10:00:00Z");
  const list = upcomingHighlights(
    [
      fixture(
        "small",
        L1,
        "2026-11-04",
        "lorient",
        "brest",
        null,
        null,
        "not_started",
      ),
      fixture(
        "big",
        UCL,
        "2026-11-04",
        "t_3NIiXl",
        "t_1cpjqO",
        null,
        null,
        "not_started",
      ),
      fixture(
        "late",
        UCL,
        "2026-11-20",
        "t_3NIiXl",
        "t_1cpjqO",
        null,
        null,
        "not_started",
      ),
      fixture(
        "other",
        "l_other",
        "2026-11-04",
        "x",
        "y",
        null,
        null,
        "not_started",
      ),
    ],
    now,
    new Set([L1, UCL]),
  );
  assert.deepEqual(
    list.map((h) => h.fixture.id),
    ["big", "small"],
  );
});

test("the player of the week comes from a Top 5 league or a European cup first", () => {
  const window = { start: "2026-10-26", end: "2026-11-01" };
  const rows = [
    {
      id: "a",
      playerId: "p1",
      name: "Twente star",
      leagueId: ERE,
      date: "2026-11-01",
      minutes: 90,
      rating: 9.9,
      goals: 4,
    },
    {
      id: "b",
      playerId: "p2",
      name: "Hakimi",
      leagueId: L1,
      date: "2026-10-30",
      minutes: 71,
      rating: 9.8,
      goals: 3,
    },
    {
      id: "c",
      playerId: "p3",
      name: "Short",
      leagueId: L1,
      date: "2026-10-30",
      minutes: 30,
      rating: 10,
    },
  ];
  const week = weekPerformances(rows, window);
  assert.deepEqual(
    week.map((r) => r.id),
    ["a", "b"],
  );
  assert.equal(playerOfTheWeek(week).id, "b");
});

test("season leaders compare goals with expected goals", () => {
  const rows = [
    ...Array.from({ length: 10 }, (_, i) => ({
      id: "r" + i,
      playerId: "raph",
      name: "Raphinha",
      team: "Barcelona",
      leagueId: "l_0ErfuF",
      date: "2026-10-" + String(10 + i),
      minutes: 90,
      goals: 2,
      xg: 1,
      rating: 8,
    })),
    ...Array.from({ length: 10 }, (_, i) => ({
      id: "g" + i,
      playerId: "garcia",
      name: "García",
      team: "Real Madrid",
      leagueId: "l_0ErfuF",
      date: "2026-10-" + String(10 + i),
      minutes: 90,
      goals: i ? 0 : 1,
      xg: 0.5,
      rating: 6.5,
    })),
  ];
  const leaders = seasonLeaders(seasonTotals(rows));
  assert.equal(leaders.goals[0].name, "Raphinha");
  assert.equal(leaders.clinical[0].goals - leaders.clinical[0].xg, 10);
  assert.equal(leaders.wasteful[0].name, "García");
  assert.equal(leaders.rating[0].name, "Raphinha");
  assert.equal(leaders.goals[0].lastId, "r9");
});

test("the Ballon d'Or race opens once every Champions League quarter-final is played", () => {
  const legs = Array.from({ length: 8 }, (_, i) =>
    fixture(
      "q" + i,
      UCL,
      "2027-04-1" + (i % 2 ? 4 : 7),
      "a" + i,
      "b" + i,
      1,
      0,
    ),
  );
  const rounds = Object.fromEntries(legs.map((f) => [f.id, { name: "1/4" }]));
  assert.equal(ballonDorRaceOpen({ fixtures: legs, rounds }), true);
  const pending = legs.map((f, i) =>
    i === 7
      ? { ...f, status: "not_started", score_home: null, score_away: null }
      : f,
  );
  assert.equal(ballonDorRaceOpen({ fixtures: pending, rounds }), false);
  assert.equal(
    ballonDorRaceOpen({ fixtures: legs.slice(0, 4), rounds }),
    false,
  );
  assert.equal(ballonDorRaceOpen({ fixtures: legs, rounds: {} }), false);
  const semi = fixture("s1", UCL, "2027-04-28", "a", "b", 2, 1);
  assert.equal(
    ballonDorRaceOpen({
      fixtures: [semi],
      rounds: { s1: { name: "Semi-finals" } },
    }),
    true,
  );
  assert.equal(
    ballonDorRaceOpen({
      fixtures: [{ ...semi, status: "not_started" }],
      rounds: { s1: { name: "1/2" } },
    }),
    false,
  );
});

test("season totals leave out an international tournament of the previous season", () => {
  const club = {
    id: "c",
    playerId: "p",
    name: "Mbappé",
    leagueId: "l_0ErfuF",
    country: "ESP",
    season: "2026/2027",
    date: "2026-09-01",
    minutes: 90,
    goals: 1,
  };
  const worldCup = {
    ...club,
    id: "w",
    leagueId: "l_1XLtP0",
    country: "INT",
    season: "2026",
    date: "2026-07-01",
    goals: 5,
  };
  const ucl = {
    ...club,
    id: "u",
    leagueId: "l_0bfbkO",
    country: "INT",
    season: "2026/2027",
    goals: 2,
  };
  const sweden = {
    ...club,
    id: "s",
    leagueId: "l_1XsMdH",
    country: "SWE",
    season: "2026",
    goals: 3,
  };
  assert.equal(inSeason(worldCup, "2026/2027"), false);
  assert.equal(inSeason(ucl, "2026/2027"), true);
  assert.equal(inSeason(sweden, "2026/2027"), true);
  assert.equal(seasonTotals([club, worldCup, ucl], "2026/2027")[0].goals, 3);
});

test("the meanest defence concedes the fewest goals per game after five games", () => {
  const games = [];
  for (let i = 0; i < 6; i++)
    games.push(
      fixture(
        "g" + i,
        L1,
        "2026-08-0" + (i + 1),
        i % 2 ? "wall" : "other" + i,
        i % 2 ? "other" + i : "wall",
        i === 0 ? 0 : 1,
        i === 0 ? 2 : 0,
      ),
    );
  const defence = bestDefence(leagueProgress(games));
  assert.equal(defence.id, "wall");
  assert.equal(defence.cleanSheets, 4);
  assert.equal(defence.goalsAgainst, 2);
});

test("the nightly refresh waits for the next midnight in Paris and notices new data", async () => {
  const { untilParisMidnight, manifestSignature } =
    await import("../dashboard/frontend/src/services/home-insights.js");
  // 23:30 in Paris in winter (UTC+1) is 22:30 UTC: midnight is 30 minutes away.
  assert.equal(
    untilParisMidnight(Date.parse("2026-11-03T22:30:00Z")),
    30 * 60_000,
  );
  // 23:30 in Paris in summer (UTC+2).
  assert.equal(
    untilParisMidnight(Date.parse("2026-07-03T21:30:00Z")),
    30 * 60_000,
  );
  const a = { seasons: [{ id: "2026/2027", chunks: [{ sha256: "x" }] }] };
  assert.equal(manifestSignature(a), manifestSignature(structuredClone(a)));
  assert.notEqual(
    manifestSignature(a),
    manifestSignature({
      seasons: [{ id: "2026/2027", chunks: [{ sha256: "y" }] }],
    }),
  );
});
