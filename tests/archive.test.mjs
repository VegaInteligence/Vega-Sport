import test from "node:test";
import assert from "node:assert/strict";
import {
  archiveRows,
  archiveSeasons,
  buildArchiveSeason,
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
