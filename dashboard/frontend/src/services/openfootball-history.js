import { normalizeText } from "../model.js";

/** OpenFootball stays separate from PitchAPI; no player or xG fields are inferred. */
export function historicalRows(season, competition = "all", query = "") {
  const needle = normalizeText(query).trim();
  const rows = [];
  for (const league of season?.competitions || []) {
    if (competition !== "all" && league.id !== competition) continue;
    for (let i = 0; i < league.matches.length; i++) {
      const match = league.matches[i];
      if (
        needle &&
        !normalizeText(`${match.team1 || ""} ${match.team2 || ""}`).includes(
          needle,
        )
      )
        continue;
      rows.push({
        key: `${league.id}:${i}`,
        competition: league.name,
        country: league.country,
        match,
      });
    }
  }
  rows.sort(
    (a, b) =>
      String(b.match.date || "").localeCompare(String(a.match.date || "")) ||
      a.key.localeCompare(b.key),
  );
  return rows;
}

export function historicalPair(value) {
  if (!Array.isArray(value) || value.length !== 2) return [null, null];
  return value.map((item) =>
    Number.isInteger(item) && item >= 0 ? item : null,
  );
}

/** Show the final match score, with extra time distinguished from penalties. */
export function historicalScore(match) {
  const final = historicalPair(match?.score?.final);
  if (final.every((value) => value !== null)) return final;
  const extra = historicalPair(match?.score?.et);
  return extra.every((value) => value !== null)
    ? extra
    : historicalPair(match?.score?.ft);
}

export function historicalScoreNotes(match) {
  const notes = [];
  const extra = historicalPair(match?.score?.et);
  const penalties = historicalPair(match?.score?.p);
  if (extra.every((value) => value !== null)) notes.push("après prolongation");
  if (penalties.every((value) => value !== null))
    notes.push(`tirs au but ${penalties[0]} – ${penalties[1]}`);
  const fields = match?.sourceFields || {};
  if (match?.status === "not_played")
    notes.push(
      `Rencontre non disputée${fields.nonmatch ? ` : ${fields.nonmatch}` : ""}`,
    );
  if ((fields.neutral || "").toLowerCase() === "yes")
    notes.push("terrain neutre");
  const comment = (fields.Comments || fields.notes || "").trim();
  if (comment && comment.toLowerCase() !== "na")
    notes.push(`Source : ${comment}`);
  return notes;
}

export const HISTORICAL_CSV_FIELDS = [
  "date",
  "competition",
  "round",
  "home",
  "home_goals",
  "away_goals",
  "away",
  "home_goals_90",
  "away_goals_90",
  "penalties_home",
  "penalties_away",
  "notes",
  "source_date",
  "source_venue",
  "source_attendance",
  "source_neutral",
  "status",
  "date_note",
];

export function historicalCsvRow({ competition, match }) {
  const [home90, away90] = historicalPair(match.score?.ft);
  const [home, away] = historicalScore(match);
  const [penaltiesHome, penaltiesAway] = historicalPair(match.score?.p);
  return [
    match.date,
    competition,
    match.round,
    match.team1,
    home,
    away,
    match.team2,
    home90,
    away90,
    penaltiesHome,
    penaltiesAway,
    historicalScoreNotes(match).join(" · "),
    match.sourceFields?.Date,
    match.sourceFields?.Venue,
    match.sourceFields?.attendance,
    match.sourceFields?.neutral,
    match.status,
    match.dateNote,
  ];
}
