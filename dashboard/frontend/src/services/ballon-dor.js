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

/**
 * One player's power ranking of a season, for his page (/api/rankings/power/player):
 * { score, role, position, roleRank, roleCount, … }; null for a player or a season
 * without one, undefined while it loads.
 */
export function usePlayerPower(season, id) {
  const enabled = Boolean(season && /^p_(?:[A-Za-z0-9]{6}|v\d{7})$/.test(id || ""));
  const resource = useResource(
    `power-ranking:player:${season || "none"}:${id || "none"}`,
    () =>
      json("/api/rankings/power/player?" + new URLSearchParams({ season, player: id }))
        .then((body) => body.player || null)
        .catch((error) => (/\bHTTP 404\b/.test(error?.message || "") ? null : Promise.reject(error))),
    enabled,
  );
  if (!enabled || resource.error) return null;
  return resource.value === undefined ? undefined : resource.value;
}
