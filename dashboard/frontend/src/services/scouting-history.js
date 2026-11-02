import { dataUrl } from "../data-url.js";
import { loadSeason } from "../season_data.js";
import { aggregateSeason } from "./season-player.js";
const routing = new Map();
async function compressed(path) {
  const response = await fetch(dataUrl(path));
  if (!response.ok)
    throw new Error(`Archive indisponible (HTTP ${response.status}).`);
  return new Response(
    response.body.pipeThrough(new DecompressionStream("gzip")),
  ).json();
}
export function playerRoutes(manifest) {
  const path = manifest.scouting?.playerRoutes?.path;
  if (!path)
    return Promise.reject(
      new Error("L’index des saisons n’est pas encore disponible."),
    );
  if (!routing.has(path))
    routing.set(
      path,
      compressed(path).catch((error) => {
        routing.delete(path);
        throw error;
      }),
    );
  return routing.get(path);
}
export async function loadPlayerSeason(
  manifest,
  id,
  season,
  competition = "all",
) {
  const index = await playerRoutes(manifest);
  const ids = (index.routes[id]?.[season] || []).filter(
    (value) => competition === "all" || value === competition,
  );
  if (!ids.length)
    return { season, data: null, profile: aggregateSeason([], id) };
  const data = await loadSeason(manifest, season, fetch, new Set(ids));
  return { season, data, profile: aggregateSeason(data.appearances, id) };
}
export async function loadPlayerHistory(manifest, id) {
  const index = await playerRoutes(manifest);
  const seasons = Object.keys(index.routes[id] || {})
    .sort()
    .reverse();
  return Promise.all(
    seasons.map((season) => loadPlayerSeason(manifest, id, season)),
  );
}

/** Fixture-only history avoids downloading player-statistic seasons for H2H. */
let fixtureIndex;
export async function historicalFixtures(manifest, leagueId) {
  if (!fixtureIndex)
    fixtureIndex = fetch(dataUrl("football-manifest.json"))
      .then((response) => {
        if (!response.ok)
          throw new Error("L’archive des rencontres est indisponible.");
        return response.json();
      })
      .catch((error) => {
        fixtureIndex = null;
        throw error;
      });
  const index = await fixtureIndex;
  const refs = index.seasons.flatMap((s) =>
    s.chunks
      .filter((c) => c.leagueId === leagueId)
      .map((c) => c.tables.fixtures?.path)
      .filter(Boolean),
  );
  const all = await Promise.all(refs.map((path) => compressed(path)));
  return [...new Map(all.flat().map((match) => [match.id, match])).values()];
}
