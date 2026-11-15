/**
 * The Power Ranking page's reads (/api/rankings/power): every ranked player of a season, a
 * page at a time (`scope=all`, by universe and role), and the clubs' ranking by Elo.
 */
import { useResource, json } from "./resources.js";

export const PLAYERS_PER_PAGE = 50;

/** The roles of the ranking, as the API names and labels them. */
export const RANKING_ROLES = [
  ["", "Tous les postes"],
  ["goalkeeper", "Gardiens"],
  ["centre_back", "Défenseurs centraux"],
  ["full_back", "Latéraux"],
  ["defensive_midfielder", "Milieux défensifs"],
  ["central_midfielder", "Milieux centraux"],
  ["winger", "Ailiers"],
  ["centre_forward", "Avant-centres"],
];

/** Why a rank is provisional, in a few words for a table cell (the API's provisionalReason). */
export const PROVISIONAL_SHORT = {
  minutes: "Peu de minutes",
  league: "Championnat mesuré à peu près",
  no_league: "Club sans championnat suivi",
  national: "Connu en sélection seulement",
};

const missing = (error) => (/\bHTTP 404\b/.test(error?.message || "") ? null : Promise.reject(error));

/** { total, rows: [{ rank, roleRank, playerId, name, team, position, score, provisionalReason… }] }, null without a ranking. */
export function useWholeRanking(season, { page = 1, role = "", universe = "men" } = {}) {
  const query = { kind: "players", season, scope: "all", limit: String(PLAYERS_PER_PAGE), page: String(page), universe, ...(role ? { role } : {}) };
  return useResource(
    `power-ranking:all:${season || "none"}:${universe}:${role || "all"}:${page}`,
    () => json("/api/rankings/power?" + new URLSearchParams(query)).catch(missing),
    Boolean(season),
  );
}

/** The clubs' ranking by Elo: [{ rank, teamId, name, imageUrl, country, score (out of 100), elo, eloChange, matches }], null without one. */
export function useClubRanking(season) {
  return useResource(
    `power-ranking:clubs:${season || "none"}`,
    () =>
      json("/api/rankings/power?" + new URLSearchParams({ kind: "clubs", season, limit: "200" }))
        .then((body) => body.rows || null)
        .catch(missing),
    Boolean(season),
  );
}
