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

export function historicalScore(match) {
  const value = match?.score?.ft;
  if (!Array.isArray(value) || value.length !== 2) return [null, null];
  return value.map((item) =>
    Number.isInteger(item) && item >= 0 ? item : null,
  );
}
