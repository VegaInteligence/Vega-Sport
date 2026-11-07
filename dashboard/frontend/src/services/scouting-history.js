import { apiUrl } from "../data-url.js";
import { publicApiFetch } from "./public-api-fetch.js";
import { loadSeason, readPages } from "../season_data.js";
import { aggregateSeason } from "./season-player.js";
import { actorReadParams } from "./actor-reads.js";
import { createResourceCache } from "./resource-cache.js";
import {
  compactGeneration,
  compactScope,
  mergeActorPages,
  readCompactPages,
  supportsCompactRead,
} from "./compact-reads.js";
import {
  addUefaNationsSnapshot,
  uefaSnapshotSeasons,
} from "./uefa-nations-snapshot.js";
const routeCaches = new WeakMap();
export async function playerRoutes(
  manifest,
  { players = [], teams = [] } = {},
  fetcher = fetch,
  { signal } = {},
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
  if (!routeCaches.has(fetcher))
    routeCaches.set(fetcher, createResourceCache({ maxEntries: 64 }));
  const key = `${compactGeneration(manifest) || manifest?.retrievedAt || "legacy"}:${params}`;
  return routeCaches.get(fetcher).read(
    key,
    async ({ signal: sharedSignal }) => {
      const response = await publicApiFetch(
        apiUrl("/api/scouting/routes?" + params),
        {
          signal: sharedSignal,
        },
        fetcher,
      );
      if (!response.ok)
        throw new Error("L’index des saisons est indisponible.");
      return response.json();
    },
    { signal },
  );
}

// Comparative tabs need the complete cohort for valid centiles and rankings.
// Other club tabs need every competition of that club, across the user's focus.
export function clubDataTeam(
  params,
  { playerOpen = false, comparing = false } = {},
) {
  if (
    playerOpen ||
    comparing ||
    ["style", "compare"].includes(params.get("clubView"))
  )
    return null;
  const id = params.get("id");
  return /^t_[A-Za-z0-9]{6}$/.test(id || "") ? id : null;
}

export async function loadClubSeason(
  manifest,
  id,
  season,
  fetcher = fetch,
  { signal } = {},
) {
  if (supportsCompactRead(manifest, "club")) {
    const result = await readCompactPages(
      "club",
      actorReadParams(manifest, "club", { id, season }),
      { signal, fetcher },
    );
    return mergeActorPages(result, manifest, season);
  }
  const index = await playerRoutes(manifest, { teams: [id] }, fetcher, {
    signal,
  });
  if (!index.clubRoutes || typeof index.clubRoutes !== "object")
    throw new Error("L’index des saisons du club est invalide.");
  const ids = index.clubRoutes[id]?.[season] || [];
  if (!Array.isArray(ids))
    throw new Error("L’index des compétitions du club est invalide.");
  return loadSeason(manifest, season, fetcher, new Set(ids), { signal });
}

export async function loadPlayerSeason(
  manifest,
  id,
  season,
  competition = "all",
  routing = null,
  { signal, fetcher = fetch } = {},
) {
  if (supportsCompactRead(manifest, "player") && !routing) {
    if (!manifest.seasons?.some((entry) => entry.id === season))
      return { season, data: null, profile: aggregateSeason([], id) };
    const leagues = competition === "all" ? "all" : competition;
    const data = mergeActorPages(
      await readCompactPages(
        "player",
        actorReadParams(manifest, "player", { id, season, leagues }),
        { signal, fetcher },
      ),
      manifest,
      season,
    );
    data.meta.actorScope = leagues;
    return { season, data, profile: aggregateSeason(data.appearances, id) };
  }
  const index =
    routing ||
    (await playerRoutes(manifest, { players: [id] }, fetcher, { signal }));
  const ids = (index.routes[id]?.[season] || []).filter(
    (value) => competition === "all" || value === competition,
  );
  if (!ids.length)
    return { season, data: null, profile: aggregateSeason([], id) };
  const data = supportsCompactRead(manifest, "player")
    ? mergeActorPages(
        await readCompactPages(
          "player",
          actorReadParams(manifest, "player", {
            id,
            season,
            leagues: compactScope(ids),
          }),
          { signal, fetcher },
        ),
        manifest,
        season,
      )
    : await loadSeason(manifest, season, fetcher, new Set(ids), { signal });
  return { season, data, profile: aggregateSeason(data.appearances, id) };
}
export function playerHistorySeasons(index, id) {
  return [
    ...new Set([
      ...Object.keys(index.routes[id] || {}),
      ...uefaSnapshotSeasons(id),
    ]),
  ]
    .sort()
    .reverse();
}

export function playerHistoryKey(manifest, id, season) {
  const key = `player-history:${id}:${compactGeneration(manifest)}`;
  return season ? `${key}:${season}` : key;
}

export async function loadPlayerHistory(
  manifest,
  id,
  {
    signal,
    fetcher = fetch,
    season: selectedSeason = null,
    routing,
    cachedSeason,
  } = {},
) {
  const directSeason =
    selectedSeason && supportsCompactRead(manifest, "player");
  const index =
    routing ||
    (directSeason
      ? null
      : await playerRoutes(manifest, { players: [id] }, fetcher, { signal }));
  const seasons = directSeason
    ? [selectedSeason]
    : playerHistorySeasons(index, id).filter(
        (season) => !selectedSeason || season === selectedSeason,
      );
  const results = new Array(seasons.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(3, seasons.length) }, async () => {
      while (cursor < seasons.length) {
        signal?.throwIfAborted();
        const position = cursor++,
          season = seasons[position];
        const cached = cachedSeason?.(season);
        const entry =
          cached?.season === season
            ? cached
            : await loadPlayerSeason(manifest, id, season, "all", index, {
                signal,
                fetcher,
              });
        const data = addUefaNationsSnapshot(entry.data, id, season);
        results[position] =
          data === entry.data
            ? entry
            : { season, data, profile: aggregateSeason(data.appearances, id) };
      }
    }),
  );
  return results;
}
export async function historicalFixtures(_manifest, leagueId, { signal } = {}) {
  const pages = await readPages(
    "/api/fixtures",
    {
      league: leagueId,
      status: "all",
    },
    fetch,
    { signal },
  );
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
