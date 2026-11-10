/**
 * The STATARENA Ballon d'Or ranking of each season, shared by the ranking page and the
 * home: the player power ranking (/api/rankings/power, the method of
 * docs/METHODE_CLASSEMENT_BALLON_D_OR.md), its 30 first entries
 * ({ rank, playerId, name, imageUrl, team, teamImageUrl, position, score }), or null
 * for a season without a published ranking.
 */
import { useResource, json } from "./resources.js";

export function useBallonDorRanking(season) {
  const resource = useResource(
    `power-ranking:players:${season || "none"}`,
    () =>
      json("/api/rankings/power?" + new URLSearchParams({ kind: "players", season, limit: "30" }))
        .then((body) => body.rows || null)
        // A season without a published ranking yet (HTTP 404) has none.
        .catch((error) => (/\bHTTP 404\b/.test(error?.message || "") ? null : Promise.reject(error))),
    Boolean(season),
  );
  return resource.value ?? null;
}
