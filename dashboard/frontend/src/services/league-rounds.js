/**
 * A league's matchweeks (/api/rankings/rounds, /api/rankings/round): the rounds of an
 * edition and, for a closed one, its Team of the Round and the Player of the Season race
 * after it (backend/vega/rounds.py). A league without rounds yet has none (HTTP 404: null).
 */
import { useResource, json } from "./resources.js";

const missing = (error) => (/\bHTTP 404\b/.test(error?.message || "") ? null : Promise.reject(error));

export function useLeagueRounds(competition, season) {
  return useResource(
    `league-rounds:${competition || "none"}:${season || "none"}`,
    () => json("/api/rankings/rounds?" + new URLSearchParams({ competition, season })).catch(missing),
    Boolean(competition && season),
  );
}

export function useLeagueRound(competition, season, round) {
  return useResource(
    `league-round:${competition || "none"}:${season || "none"}:${round || "latest"}`,
    () => json("/api/rankings/round?" + new URLSearchParams({ competition, season, ...(round ? { round } : {}) })).catch(missing),
    Boolean(competition && season),
  );
}

/** A round's label for the page: « Journée 5 » for a numbered round, its own label otherwise. */
export function roundLabel(round) {
  if (!round) return "";
  return /^\d+$/.test(round.label) ? `Journée ${round.label}` : round.label.replace(/^Semaine du (\d{4})-(\d{2})-(\d{2})$/, "Semaine du $3/$2/$1");
}

/** A Team of the Round's players by line, from the forwards (top) to the goalkeeper. */
export function teamLines(team) {
  const lines = new Map();
  for (const player of team?.players || []) {
    if (!lines.has(player.line)) lines.set(player.line, []);
    lines.get(player.line).push(player);
  }
  return [...lines.entries()].sort((a, b) => b[0] - a[0]).map(([, players]) => players.sort((a, b) => a.slot - b.slot));
}
