import { normalizeText } from "./archive-text.js";

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

const isPair = (value) => Array.isArray(value) && value.length === 2 && value.every((item) => Number.isInteger(item) && item >= 0);

/** Two non-negative integer goals, or [null, null]: half a pair is no score. */
export function historicalPair(value) {
  return isPair(value) ? [...value] : [null, null];
}

// worldcup.json writes a full-time result as {ft: [2, 1], ht: […]} or, in most editions from 1950
// to 2014 and seven matches of 2022, as [2, 1]: the same full-time result.
const scoreObject = (score) => (Array.isArray(score) ? { ft: score } : score);
const SCORE_PARTS = ["ft", "ht", "et", "p"];

/**
 * An OpenFootball score as the cup sources store it (open-cups.mjs, vega/sources/cups.py
 * score_parts): {ft, ht, et, p}, each a [home, away] pair, or null without a result. Throws on
 * anything else (an INVALID_SCORE: the edition is not written).
 */
export function openFootballScore(score) {
  if (score === undefined || score === null) return null;
  const parts = scoreObject(score);
  if (!parts || typeof parts !== "object" || Array.isArray(parts)) throw invalidScore();
  const keys = Object.keys(parts);
  if (keys.some((key) => !SCORE_PARTS.includes(key) || !isPair(parts[key]))) throw invalidScore();
  if (!keys.length) return null;
  // A half time or a shoot-out without the match's score is incomplete.
  if (!keys.includes("ft") && !keys.includes("et")) throw invalidScore();
  return Object.fromEntries(keys.map((key) => [key, [...parts[key]]]));
}

function invalidScore() {
  return Object.assign(new Error("Invalid OpenFootball score"), { code: "INVALID_SCORE" });
}

/** Show the final match score, with extra time distinguished from penalties. */
export function historicalScore(match) {
  const score = scoreObject(match?.score);
  const final = historicalPair(score?.final);
  if (final.every((value) => value !== null)) return final;
  const extra = historicalPair(score?.et);
  return extra.every((value) => value !== null)
    ? extra
    : historicalPair(score?.ft);
}

export function historicalScoreNotes(match) {
  const notes = [];
  const score = scoreObject(match?.score);
  const extra = historicalPair(score?.et);
  const penalties = historicalPair(score?.p);
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
  const score = scoreObject(match.score);
  const [home90, away90] = historicalPair(score?.ft);
  const [home, away] = historicalScore(match);
  const [penaltiesHome, penaltiesAway] = historicalPair(score?.p);
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
