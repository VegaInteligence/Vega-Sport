import test from "node:test";
import assert from "node:assert/strict";
import {
  archiveRows,
  archiveSeasons,
  buildArchiveSeason,
  goalTwins,
  parseGoalMatch,
  teamSimilarity,
} from "../dashboard/frontend/src/services/archive.js";
import { reactFixtures } from "./react-runtime.mjs";

const results = {
  season: "2018/2019",
  competitions: [
    {
      id: "2018-19/de.1",
      name: "Deutsche Bundesliga 2018/19",
      country: "Allemagne",
      matches: [
        { date: "2018-08-24", team1: "FC Bayern München", team2: "TSG 1899 Hoffenheim", score: { ft: [3, 1] } },
        { date: "2018-08-25", team1: "Hertha BSC", team2: "1. FC Nürnberg", score: { ft: [0, 0] } },
        { date: "2018-08-26", team1: "Athletic Club", team2: "Wiener Neustadt", score: { ft: [1, 2] } },
      ],
    },
  ],
};
const goals = {
  season: "2018/2019",
  competitions: [
    {
      id: "bundesliga",
      name: "Bundesliga",
      country: "Allemagne",
      events: [
        { date: "2018-08-24", player: "Thomas Müller", team: "Bayern München", minute: "23", score: [1, 0], match: "Bayern München vs. 1899 Hoffenheim 3:1" },
        { date: "2018-08-24", player: "Robert Lewandowski", team: "Bayern München", minute: "82", score: [2, 1], match: "Bayern München vs. 1899 Hoffenheim 3:1" },
        { date: "2018-08-24", player: "Ádám Szalai", team: "1899 Hoffenheim", minute: "57", score: [1, 1], match: "Bayern München vs. 1899 Hoffenheim 3:1" },
        { date: "2018-08-26", player: "X", team: "Rapid Wien", minute: "5", score: [1, 0], match: "Rapid Wien vs. Admira 3:0" },
      ],
    },
    {
      id: "nor",
      name: "Eliteserien",
      country: "Norvège",
      calendarYear: 2018,
      events: [
        { date: "2018-09-01", player: "Ola", team: "Molde", minute: "12", score: [1, 0], match: "Molde vs. Rosenborg 1:0" },
      ],
    },
  ],
};

test("goal events are attached to the matching result", () => {
  const season = buildArchiveSeason(results, goals);
  const bayern = season.matches.find((m) => m.team1 === "FC Bayern München");
  assert.equal(bayern.goals.length, 3);
  assert.deepEqual(bayern.goals.map((g) => g.minute), ["23", "57", "82"]);
  const goalless = season.matches.find((m) => m.team1 === "Hertha BSC");
  assert.equal(goalless.goals, null);
  // A loose name overlap with a different score is not a match.
  const loose = season.matches.find((m) => m.team1 === "Athletic Club");
  assert.equal(loose.goals, null);
});

test("goal-only matches stay in the archive under their competition", () => {
  const season = buildArchiveSeason(results, goals);
  const molde = season.matches.find((m) => m.team1 === "Molde");
  assert.deepEqual(molde.score, [1, 0]);
  assert.equal(molde.goals.length, 1);
  assert.ok(season.competitions.some((c) => c.name === "Eliteserien 2018"));
  // The unmatched Bundesliga goal group goes under the matched results league.
  const rapid = season.matches.find((m) => m.team1 === "Rapid Wien");
  assert.equal(rapid.competitionId, "2018-19/de.1");
  assert.equal(archiveRows(season, "all", "lewandowski").length, 1);
});

test("team names and match labels", () => {
  assert.ok(teamSimilarity("Athletic Club", "Athletic Bilbao") > 0);
  assert.ok(teamSimilarity("1. FC Nürnberg", "Nürnberg") > 0);
  assert.equal(teamSimilarity("Arsenal", "Chelsea"), 0);
  assert.deepEqual(parseGoalMatch("Energie Cottbus vs. SC Freiburg 3:5 i.E."), {
    team1: "Energie Cottbus",
    team2: "SC Freiburg",
    score: [3, 5],
    suffix: "i.E.",
  });
  assert.deepEqual(
    archiveSeasons({ seasons: [{ id: "2019/2020" }] }, { seasons: [{ id: "2022/2023" }, { id: "2019/2020" }] }).map((s) => [s.id, Boolean(s.results), Boolean(s.goals)]),
    [["2022/2023", false, true], ["2019/2020", true, true]],
  );
});

test("only matches with goals are clickable", async () => {
  const { renderArchiveResults } = await reactFixtures();
  const html = renderArchiveResults(results, goals, "2018-19/de.1");
  assert.equal((html.match(/archive-row-open/g) || []).length, 2);
  assert.match(html, /archive-row-closed/);
  assert.equal((html.match(/<a /g) || []).length, 2);
});

test("a match captured twice is shown once with its final score", () => {
  const season = buildArchiveSeason(null, {
    season: "2024/2025",
    competitions: [{ id: "aut", name: "Bundesliga", country: "Autriche", events: [
      { date: "2024-11-09", player: "Maderner", team: "Grazer AK", minute: "10", score: [1, 0], match: "Grazer AK vs. WSG Tirol 1:0" },
      { date: "2024-11-09", player: "Maderner", team: "Grazer AK", minute: "10", score: [1, 0], match: "Grazer AK vs. WSG Tirol 2:1" },
      { date: "2024-11-09", player: "Anselm", team: "WSG Tirol", minute: "61", score: [1, 1], match: "Grazer AK vs. WSG Tirol 2:1" },
      { date: "2024-11-09", player: "Lawrence", team: "Grazer AK", minute: "76", score: [2, 1], match: "Grazer AK vs. WSG Tirol 2:1" },
    ] }],
  });
  assert.equal(season.matches.length, 1);
  assert.deepEqual(season.matches[0].score, [2, 1]);
  assert.equal(season.matches[0].goals.length, 3);
});

// A goal match its results twin missed (18 Nov 2026, the archives of the big leagues, 2000–2021):
// the results archive dated the match a few days or a year off, or wrote one club otherwise, and
// the same match was kept twice (« g: » beside « r: »). Expected: one row, the result's, with the
// goals and the goals' date (the goals archive is the one dated by match day: Inter 0–6 Milan was
// played on 11 May 2001, not the 13th). Not merged: a different score, two candidates, a second
// meeting weeks apart, a club neither side resembles.
const twinSeason = (matches, events) =>
  buildArchiveSeason(
    { season: "2000/2001", competitions: [{ id: "x/2000/l.1", name: "League", country: "Pays", matches }] },
    { season: "2000/2001", competitions: [{ id: "lg", name: "League", country: "Pays", events }] },
  );
const goal = (date, home, away, score, team, minute = "10") => ({
  date, player: `${team} ${minute}`, team, minute, score: [1, 0], match: `${home} vs. ${away} ${score}`,
});
// One match attached by the first pass, so that the goals league is the results league's.
const anchor = { date: "2000-08-20", team1: "Anchor FC", team2: "Other FC", score: { ft: [1, 0] } };
const anchorGoal = goal("2000-08-20", "Anchor FC", "Other FC", "1:0", "Anchor FC");

test("a goal match dated a few days from its result is that result", () => {
  const season = twinSeason(
    [anchor, { date: "2001-05-13", team1: "Inter", team2: "AC Milan", score: { ft: [0, 6] } }],
    [anchorGoal, goal("2001-05-11", "Internazionale", "Milan", "0:6", "Milan")],
  );
  const derby = season.matches.filter((m) => /Inter/.test(m.team1));
  assert.equal(derby.length, 1);
  assert.ok(derby[0].key.startsWith("r:"));
  assert.equal(derby[0].date, "2001-05-11");
  assert.equal(derby[0].goals.length, 1);
});

test("a goal match with one club written otherwise is that result, the same day", () => {
  const season = twinSeason(
    [anchor, { date: "2001-03-05", team1: "Sp Lisbon", team2: "Gil Vicente", score: { ft: [2, 0] } }],
    [anchorGoal, goal("2001-03-05", "Sporting CP", "Gil Vicente", "2:0", "Sporting CP")],
  );
  const rows = season.matches.filter((m) => m.team2 === "Gil Vicente");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].team1, "Sp Lisbon");
  assert.equal(rows[0].goals.length, 1);
});

test("a goal match a year from its result (a year inferred wrong) is that result", () => {
  const season = twinSeason(
    [anchor, { date: "2000-07-26", team1: "Arsenal FC", team2: "Watford FC", score: { ft: [3, 2] } }],
    [anchorGoal, goal("2001-07-26", "Arsenal FC", "Watford FC", "3:2", "Arsenal FC")],
  );
  const rows = season.matches.filter((m) => m.team1 === "Arsenal FC");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].date, "2001-07-26");
});

test("no merge: another score, two candidates, a meeting weeks apart, an unknown club", () => {
  const twice = { date: "2001-01-08", team1: "Celtic", team2: "Rangers", score: { ft: [1, 0] } };
  const cases = [
    // The score differs.
    [[anchor, { date: "2001-05-13", team1: "Inter", team2: "AC Milan", score: { ft: [0, 5] } }], goal("2001-05-11", "Inter", "AC Milan", "0:6", "AC Milan"), 2],
    // Two results the goal match could be (three days each way: beyond the first pass's day).
    [[anchor, twice, { ...twice, date: "2001-01-14" }], goal("2001-01-11", "Celtic", "Rangers", "1:0", "Celtic"), 3],
    // A second meeting of the same clubs, three weeks later.
    [[anchor, twice], goal("2001-01-29", "Celtic", "Rangers", "1:0", "Celtic"), 2],
    // One club the same, the other unlike it, two days apart.
    [[anchor, { date: "2001-03-05", team1: "Sp Lisbon", team2: "Gil Vicente", score: { ft: [2, 0] } }], goal("2001-03-07", "Sporting CP", "Gil Vicente", "2:0", "Sporting CP"), 2],
  ];
  for (const [matches, extra, rows] of cases) {
    const season = twinSeason(matches, [anchorGoal, extra]);
    assert.equal(season.matches.length - 1, rows, extra.match);
  }
});

test("goalTwins pairs stored archive rows the same way", () => {
  const rows = [
    { key: "r:x:1", competitionId: "x", date: "2001-05-13", team1: "Inter", team2: "AC Milan", score: [0, 6], goals: null },
    { key: "g:lg:2001-05-11:7", competitionId: "x", date: "2001-05-11", team1: "Internazionale", team2: "Milan", score: [0, 6], goals: [{}] },
    { key: "g:lg:2001-05-12:8", competitionId: "y", date: "2001-05-12", team1: "Inter", team2: "AC Milan", score: [0, 6], goals: [{}] },
  ];
  assert.deepEqual(goalTwins(rows), [{ goal: "g:lg:2001-05-11:7", result: "r:x:1", date: "2001-05-11" }]);
});

// The branch's held units and the importer's kept keys meet main's twins (FAILURE_MODES.md §35, 35a and 35d): the twin
// pass runs on the final rows, reports what it merged (`absorbed`) and what it left (`twinsHeld`, with the reason).
// Failure modes: a held unit merged back by the twin pass (its published rows were to stay); a quarantined or attested
// key merged without its review; a merge the importer cannot see.
test("the edition lists each pair it merged", () => {
  const season = twinSeason(
    [anchor, { date: "2001-05-13", team1: "Inter", team2: "AC Milan", score: { ft: [0, 6] } }],
    [anchorGoal, goal("2001-05-11", "Internazionale", "Milan", "0:6", "Milan")],
  );
  assert.deepEqual(season.absorbed, [{ goal: "g:lg:2001-05-11:1", result: "r:x/2000/l.1:1", date: "2001-05-11" }]);
  assert.deepEqual(season.twinsHeld, []);
});

test("a held unit is never merged by the twin pass; the pair is listed with its reason", () => {
  // The goal label laid out on two lines: the published reading cannot read it, the corrected one attaches it to the
  // result (an absorption), so the unit keeps its published rows. A twin pass over them would pair them again.
  const season = twinSeason(
    [anchor, { date: "2001-03-05", team1: "Leicester City FC", team2: "Sunderland AFC", score: { ft: [4, 2] } }],
    [anchorGoal, { date: "2001-03-05", player: "Vardy", team: "Leicester City", minute: "90", score: [4, 2], match: "Leicester City vs.\nSunderland 4:2" }],
  );
  const pair = season.matches.filter((m) => m.date === "2001-03-05");
  assert.deepEqual(pair.map((m) => [m.key, m.held || m.heldGoals]), [["g:lg:2001-03-05:1", "absorption"], ["r:x/2000/l.1:1", "absorption"]]);
  assert.equal(pair[1].goals, null);
  assert.deepEqual(season.absorbed, []);
  assert.deepEqual(season.twinsHeld, [{ goal: "g:lg:2001-03-05:1", result: "r:x/2000/l.1:1", reason: "held" }]);
});

test("a key the importer keeps is never merged; the pair is listed as kept", () => {
  const matches = [anchor, { date: "2001-05-13", team1: "Inter", team2: "AC Milan", score: { ft: [0, 6] } }];
  const events = [anchorGoal, goal("2001-05-11", "Internazionale", "Milan", "0:6", "Milan")];
  for (const kept of ["g:lg:2001-05-11:1", "r:x/2000/l.1:1"]) {
    const season = buildArchiveSeason(
      { season: "2000/2001", competitions: [{ id: "x/2000/l.1", name: "League", country: "Pays", matches }] },
      { season: "2000/2001", competitions: [{ id: "lg", name: "League", country: "Pays", events }] },
      { keep: [kept] },
    );
    assert.equal(season.matches.filter((m) => /Inter/.test(m.team1)).length, 2, kept);
    assert.deepEqual(season.absorbed, [], kept);
    assert.deepEqual(season.twinsHeld, [{ goal: "g:lg:2001-05-11:1", result: "r:x/2000/l.1:1", reason: "kept" }], kept);
  }
});
