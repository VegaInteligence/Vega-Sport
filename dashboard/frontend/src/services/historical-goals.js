import { normalizeText } from "../model.js";

export function historicalGoalRows(season, competition = "all", query = "") {
  const needle = normalizeText(query).trim();
  const rows = [];
  for (const league of season?.competitions || []) {
    if (competition !== "all" && league.id !== competition) continue;
    for (let i = 0; i < league.events.length; i++) {
      const event = league.events[i];
      if (
        needle &&
        !normalizeText(`${event.player} ${event.team} ${event.match}`).includes(
          needle,
        )
      )
        continue;
      rows.push({
        key: `${league.id}:${i}`,
        competition: league.name,
        country: league.country,
        calendarYear: league.calendarYear,
        event,
      });
    }
  }
  rows.sort(
    (a, b) =>
      String(b.event.date).localeCompare(String(a.event.date)) ||
      a.key.localeCompare(b.key),
  );
  return rows;
}

export const HISTORICAL_GOAL_CSV_FIELDS = [
  "date",
  "competition",
  "pays",
  "joueur_source",
  "equipe_source",
  "minute",
  "score_domicile_apres_but",
  "score_exterieur_apres_but",
  "match_source",
  "saison_source",
  "annee_calendaire",
  "score_final_divergent",
];

export function historicalGoalCsvRow({
  competition,
  country,
  calendarYear,
  event,
}) {
  return [
    event.date,
    competition,
    country,
    event.player,
    event.team,
    event.minute,
    event.score?.[0],
    event.score?.[1],
    event.match,
    event.sourceSeason,
    calendarYear,
    event.scoreDisagreement ? "oui" : "",
  ];
}
