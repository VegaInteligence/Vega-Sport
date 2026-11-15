/**
 * Vega's grade of each player in one match (/api/rankings/match): how exceptional the match was
 * for his role, whatever his season, on the 0–100 curve of the season's ranking (50 an ordinary
 * match of the role), and his rank in the match. A grade is given from 20 minutes, or below
 * them when the match stood a full standard deviation from the ordinary.
 */
import { useResource, json } from "./resources.js";
import { isNumber } from "./format.js";

/** A player row's player id: an appearance's own id, or a leader's `playerId` (its id is the match's and the player's). */
export const playerOf = (row) => row?.playerId ?? row?.id;

/** The fewest minutes for a match's best players: the reference's full matches (cameos are shown, not ranked). */
export const LEADING_MINUTES = 60;

/**
 * The match's best players (at most `count`), by Vega's grade from 60 minutes: the rows' own
 * normal score z when they carry it, else the grades' rank, each row then built from the grade
 * itself (its player's name, photo, team, minutes, goals) with the id of an appearance of
 * `match` (« match:player »), as the rows it stands in for.
 */
export function leadingPlayers(pool, grades, { match, count = 5 } = {}) {
  const graded = (pool || [])
    .filter((r) => r.minutes >= LEADING_MINUTES && isNumber(r.gradeZ))
    .sort((a, b) => b.gradeZ - a.gradeZ);
  if (graded.length) return graded.slice(0, count);
  return [...(grades || new Map()).entries()]
    .filter(([, g]) => g.minutes >= LEADING_MINUTES && g.name)
    .sort(([, a], [, b]) => a.rank - b.rank)
    .slice(0, count)
    .map(([playerId, g]) => ({
      id: match ? `${match}:${playerId}` : playerId, playerId, name: g.name, imageUrl: g.imageUrl, team: g.team,
      teamId: g.teamId, minutes: g.minutes, goals: g.goals, assists: g.assists, grade: g.grade,
    }));
}

/** { playerId → { grade, rank, and the player's appearance } } from the route's body, the grades shown only; an empty map without one. */
export function gradesOf(body) {
  const out = new Map();
  for (const g of body?.grades || []) {
    if (g.grade == null) continue;
    out.set(g.playerId, {
      grade: g.grade, rank: g.rank, name: g.name ?? null, imageUrl: g.imageUrl ?? null, team: g.team ?? null,
      teamId: g.teamId ?? null, minutes: g.minutes, goals: g.goals ?? null, assists: g.assists ?? null,
    });
  }
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
