import { apiUrl } from "../data-url.js";
import { loadSeason, readPages } from "../season_data.js";
import { aggregateSeason } from "./season-player.js";
const routeCaches = new WeakMap();
export async function playerRoutes(
  manifest,
  { players = [], teams = [] } = {},
) {
  const params = new URLSearchParams();
  for (const [key, ids] of [
    ["player", players],
    ["team", teams],
  ]) {
    const unique = [...new Set(ids)].sort();
    if (unique.length > 8) throw new Error("Trop de profils demandés.");
    if (unique.length) params.set(key, unique.join(","));
  }
  if (!params.size) return { routes: {}, clubRoutes: {} };
  if (!routeCaches.has(manifest)) routeCaches.set(manifest, new Map());
  const cache = routeCaches.get(manifest),
    key = params.toString();
  if (!cache.has(key)) {
    const pending = fetch(apiUrl("/api/scouting/routes?" + params))
      .then(async (r) => {
        if (!r.ok) throw new Error("L’index des saisons est indisponible.");
        return r.json();
      })
      .catch((error) => {
        cache.delete(key);
        throw error;
      });
    cache.set(key, pending);
  }
  return cache.get(key);
}

export async function loadPlayerSeason(
  manifest,
  id,
  season,
  competition = "all",
  routing = null,
) {
  const index = routing || (await playerRoutes(manifest, { players: [id] }));
  const ids = (index.routes[id]?.[season] || []).filter(
    (value) => competition === "all" || value === competition,
  );
  if (!ids.length)
    return { season, data: null, profile: aggregateSeason([], id) };
  const data = await loadSeason(manifest, season, fetch, new Set(ids));
  return { season, data, profile: aggregateSeason(data.appearances, id) };
}
export async function loadPlayerHistory(manifest, id) {
  const index = await playerRoutes(manifest, { players: [id] });
  const seasons = Object.keys(index.routes[id] || {})
    .sort()
    .reverse();
  return Promise.all(
    seasons.map((season) =>
      loadPlayerSeason(manifest, id, season, "all", index),
    ),
  );
}
export async function historicalFixtures(_manifest, leagueId) {
  const pages = await readPages("/api/fixtures", {
    league: leagueId,
    status: "all",
  });
  return [
    ...new Map(
      pages
        .flatMap((page) => {
          if (!Array.isArray(page.matches))
            throw new Error("Page de rencontres invalide.");
          return page.matches;
        })
        .map((match) => [match.id, match]),
    ).values(),
  ];
}
