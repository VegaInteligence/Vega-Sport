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

test("renders event details, calendar year and score disagreement", async () => {
  const { renderHistoricalGoals } = await reactFixtures();
  const html = renderHistoricalGoals(season, "nor");
  assert.match(html, /Jérémy/);
  assert.match(html, /90\+2/);
  assert.match(html, /Année civile 2020/);
  assert.match(html, /score final divergents/);
  assert.match(html, /Exporter CSV/);
});
