/**
 * The league strength index (/api/rankings/leagues): each league's level on the Elo's
 * scale, its rank among the leagues on the common scale, and its level season by season.
 */
import { useResource, json } from "./resources.js";

export function useLeagueLevels() {
  const resource = useResource("league-levels", () =>
    json("/api/rankings/leagues").catch((error) =>
      /\bHTTP 404\b/.test(error?.message || "") ? null : Promise.reject(error),
    ),
  );
  return resource.error ? null : (resource.value ?? null);
}

/**
 * What a league's card shows: its level and rank, the last seasons with the change from
 * one to the next, and its neighbours on the scale. null for a competition without a
 * level (a cup, a European competition).
 */
export function leagueStrength(levels, competitionId, { seasons = 4 } = {}) {
  const leagues = levels?.leagues || [];
  const index = leagues.findIndex((league) => league.id === competitionId);
  if (index < 0) return null;
  const league = leagues[index];
  const history = (league.seasons || []).slice(-seasons).map((row, at, all) => ({
    season: row.season,
    level: row.level,
    change: at > 0 ? row.level - all[at - 1].level : null,
  }));
  if (!league.onScale)
    return { name: league.name, onScale: false, level: null, rank: null, of: levels.onScale ?? null, history: [], above: null, below: null };
  const ranked = leagues.filter((row) => row.onScale);
  const at = ranked.findIndex((row) => row.id === competitionId);
  const neighbour = (row) => (row ? { name: row.name, country: row.country, level: row.level } : null);
  return {
    name: league.name,
    onScale: true,
    level: league.level,
    rank: league.rank,
    of: levels.onScale ?? ranked.length,
    history: history.reverse(),
    above: neighbour(ranked[at - 1]),
    below: neighbour(ranked[at + 1]),
  };
}
