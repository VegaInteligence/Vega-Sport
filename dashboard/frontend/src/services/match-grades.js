/**
 * Vega's grade of each player in one match (/api/rankings/match): how exceptional the match was
 * for his role, whatever his season, on the 0–100 curve of the season's ranking (50 an ordinary
 * match of the role), and his rank in the match. A grade is given from 20 minutes, or below
 * them when the match stood a full standard deviation from the ordinary.
 */
import { useResource, json } from "./resources.js";

/** { playerId → { grade, rank } } from the route's body; an empty map without one. */
export function gradesOf(body) {
  const out = new Map();
  for (const g of body?.grades || []) if (g.grade != null) out.set(g.playerId, { grade: g.grade, rank: g.rank });
  return out;
}

const NONE = new Map();

export function useMatchGrades(matchId) {
  const enabled = /^m_(?:[A-Za-z0-9]{6}|v\d{7})$/.test(matchId || "");
  const resource = useResource(
    `match-grades:${matchId || "none"}`,
    () =>
      json("/api/rankings/match?" + new URLSearchParams({ match: matchId }))
        .then(gradesOf)
        // A match the ranking has not read yet (HTTP 404) has no grade.
        .catch((error) => (/\bHTTP 404\b/.test(error?.message || "") ? NONE : Promise.reject(error))),
    enabled,
  );
  return (enabled && !resource.error && resource.value) || NONE;
}

/** The grade's label for its tooltip: « Note Vega du match sur 100 · 3e du match ». */
export function gradeTitle(entry) {
  if (!entry) return "";
  return `Note Vega du match sur 100 · ${entry.rank === 1 ? "1er" : `${entry.rank}e`} du match`;
}
