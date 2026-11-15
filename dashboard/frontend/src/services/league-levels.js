/**
 * The league strength index (/api/rankings/leagues): each league's level on the Elo's
 * scale, its rank among the men's leagues, and its level season by season.
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
 * What a league's card shows: its level and rank among the men's leagues, the last seasons
 * with the change from one to the next, and its neighbours on the scale; a provisional
 * league (too few matches against the others to measure it closely) with its margin. null
 * for a competition without a level (a cup, a European competition); a women's league has
 * a level of its own and no rank.
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
  if (league.rank == null)
    return { name: league.name, onScale: false, women: league.universe === "women", level: null, rank: null, of: null, history: [], above: null, below: null };
  const ranked = leagues.filter((row) => row.rank != null);
  const at = ranked.findIndex((row) => row.id === competitionId);
  const neighbour = (row) => (row ? { name: row.name, country: row.country, level: row.level } : null);
  return {
    name: league.name,
    onScale: true,
    provisional: Boolean(league.provisional),
    margin: league.margin ?? null,
    level: league.level,
    score: league.score ?? null,
    evidence: league.evidence ?? null,
    rank: league.rank,
    of: levels.ranked ?? ranked.length,
    history: history.reverse(),
    above: neighbour(ranked[at - 1]),
    below: neighbour(ranked[at + 1]),
  };
}
