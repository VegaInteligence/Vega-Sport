import test from "node:test";
import assert from "node:assert/strict";
import {
  historicalRows,
  historicalScore,
} from "../dashboard/frontend/src/services/openfootball-history.js";
import { reactFixtures } from "./react-runtime.mjs";

const season = {
  season: "2020/2021",
  competitions: [
    {
      id: "2020-21/en.1",
      name: "Premier League",
      country: "Angleterre",
      matches: [
        {
          date: "2020-09-12",
          team1: "Fulham",
          team2: "Arsenal",
          score: { ft: [0, 3] },
        },
        { date: "2020-09-13", team1: "City", team2: "United" },
      ],
    },
    {
      id: "2020-21/fr.1",
      name: "Ligue 1",
      country: "France",
      matches: [
        {
          date: "2020-09-10",
          team1: "Paris",
          team2: "Marseille",
          score: { ft: [0, 0] },
        },
      ],
    },
  ],
};

test("historical results preserve zero and do not invent missing scores", () => {
  assert.deepEqual(historicalScore(season.competitions[0].matches[0]), [0, 3]);
  assert.deepEqual(historicalScore(season.competitions[0].matches[1]), [
    null,
    null,
  ]);
  assert.deepEqual(historicalScore(season.competitions[1].matches[0]), [0, 0]);
  assert.equal(historicalRows(season, "all", "arsenal").length, 1);
  assert.equal(historicalRows(season, "2020-21/fr.1", "").length, 1);
  assert.equal(historicalRows(season).length, 3);
});

test("historical result table shows scores and missing scores separately", async () => {
  const { renderArchiveResults } = await reactFixtures();
  const html = renderArchiveResults(season);
  assert.match(html, /Fulham/);
  assert.match(html, /0 – 3/);
  assert.match(html, /0 – 0/);
  assert.match(html, /—/);
});

test("extra time and shootouts remain distinct from the regulation score", async () => {
  const match = {
    date: "1958-05-28",
    team1: "Real Madrid",
    team2: "AC Milan",
    score: { ft: [2, 2], et: [3, 2], p: [4, 3] },
  };
  assert.deepEqual(historicalScore(match), [3, 2]);
  const { renderArchiveResults } = await reactFixtures();
  const html = renderArchiveResults({
    season: "1957/1958",
    competitions: [
      {
        id: "cup",
        name: "Coupe d’Europe",
        country: "Europe",
        matches: [match],
      },
    ],
  });
  assert.match(html, /3 – 2/);
  assert.match(html, /après prolongation/);
  assert.match(html, /tirs au but 4 – 3/);
});

import {
  HISTORICAL_CSV_FIELDS,
  historicalCsvRow,
} from "../dashboard/frontend/src/services/openfootball-history.js";
test("CSV keeps existing goal columns and separates regulation from extra time and shootouts", () => {
  const match = {
    date: "1958-05-28",
    team1: "Real Madrid",
    team2: "AC Milan",
    score: { ft: [2, 2], et: [3, 2], p: [4, 3] },
  };
  const row = Object.fromEntries(
    HISTORICAL_CSV_FIELDS.map((key, index) => [
      key,
      historicalCsvRow({ competition: "Coupe", match })[index],
    ]),
  );
  assert.deepEqual([row.home_goals, row.away_goals], [3, 2]);
  assert.deepEqual([row.home_goals_90, row.away_goals_90], [2, 2]);
  assert.deepEqual([row.penalties_home, row.penalties_away], [4, 3]);
});

import { historicalScoreNotes } from "../dashboard/frontend/src/services/openfootball-history.js";
test("source-only final scores, unplayed ties and neutral venues remain explicit", () => {
  const match = {
    score: { final: [2, 1], et: [2, 1], p: [4, 3] },
    sourceFields: { neutral: "yes", notes: "Final" },
    status: "finished",
  };
  assert.deepEqual(historicalScore(match), [2, 1]);
  assert.match(historicalScoreNotes(match).join(" "), /après prolongation/);
  assert.match(historicalScoreNotes(match).join(" "), /terrain neutre/);
  const row = Object.fromEntries(
    HISTORICAL_CSV_FIELDS.map((key, index) => [
      key,
      historicalCsvRow({ competition: "FA Cup", match })[index],
    ]),
  );
  assert.equal(row.home_goals_90, null);
  assert.equal(row.home_goals, 2);
  const notPlayed = {
    status: "not_played",
    sourceFields: { nonmatch: "Walkover", notes: "Team progresses" },
  };
  assert.deepEqual(historicalScore(notPlayed), [null, null]);
  assert.match(
    historicalScoreNotes(notPlayed).join(" "),
    /Rencontre non disputée/,
  );
});
