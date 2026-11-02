import test from "node:test";
import assert from "node:assert/strict";
import {
  historicalGoalRows,
  historicalGoalCsvRow,
  HISTORICAL_GOAL_CSV_FIELDS,
} from "../dashboard/frontend/src/services/historical-goals.js";
import { reactFixtures } from "./react-runtime.mjs";

const season = {
  season: "2020/2021",
  competitions: [
    {
      id: "nor",
      name: "Eliteserien",
      country: "Norvège",
      calendarYear: 2020,
      events: [
        {
          date: "2020-08-01",
          player: "Jérémy",
          team: "A",
          minute: "90+2",
          score: [1, 0],
          match: "A vs. B 1:0",
          sourceSeason: "NA",
          scoreDisagreement: true,
        },
      ],
    },
    {
      id: "fra",
      name: "Ligue 1",
      country: "France",
      calendarYear: null,
      events: [
        {
          date: "2021-01-01",
          player: "Ada",
          team: "Paris",
          minute: "8",
          score: [0, 1],
          match: "A vs. Paris 0:1",
          sourceSeason: "2020-2021",
        },
      ],
    },
  ],
};

test("filters by player, team and competition and preserves source fields in CSV", () => {
  assert.equal(historicalGoalRows(season, "all", "jeremy").length, 1);
  assert.equal(historicalGoalRows(season, "fra", "paris").length, 1);
  assert.equal(historicalGoalRows(season, "nor", "paris").length, 0);
  const row = historicalGoalRows(season, "nor")[0];
  const csv = Object.fromEntries(
    HISTORICAL_GOAL_CSV_FIELDS.map((field, i) => [
      field,
      historicalGoalCsvRow(row)[i],
    ]),
  );
  assert.equal(csv.minute, "90+2");
  assert.equal(csv.annee_calendaire, 2020);
  assert.equal(csv.saison_source, "NA");
  assert.equal(csv.score_final_divergent, "oui");
});

test("goal-only matches open a sub-page with their goal events", async () => {
  const { renderArchiveResults, renderArchiveMatch } = await reactFixtures();
  const html = renderArchiveResults(null, season);
  assert.match(html, /archive-row-open/);
  assert.match(html, /href="\/archives\/?\?m=/);
  const { buildArchiveSeason } = await import(
    "../dashboard/frontend/src/services/archive.js"
  );
  const match = buildArchiveSeason(null, season).matches.find(
    (item) => item.team1 === "A" && item.team2 === "B",
  );
  const detail = renderArchiveMatch(match);
  assert.match(detail, /Jérémy/);
  assert.match(detail, /90\+2/);
  assert.match(detail, /archive-goal-home/);
  assert.match(detail, /Retour aux archives/);
});
