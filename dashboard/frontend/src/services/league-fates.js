/**
 * What became of each club of a finished league edition (/api/rankings/fates): the European
 * competition or the tier it played the next season (api.league_team_fates). An edition
 * whose next season is not in the base has none (HTTP 404, or an empty map: null).
 */
import { useResource, json } from "./resources.js";

const missing = (error) => (/\bHTTP 404\b/.test(error?.message || "") ? null : Promise.reject(error));

export function useLeagueFates(competition, season) {
  return useResource(
    `league-fates:${competition || "none"}:${season || "none"}`,
    () =>
      json("/api/rankings/fates?" + new URLSearchParams({ competition, season }))
        .then((body) => (body && Object.keys(body.teams || {}).length ? body.teams : null))
        .catch(missing),
    Boolean(competition && /^\d{4}\/\d{4}$/.test(season || "")),
  );
}
