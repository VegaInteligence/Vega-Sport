import { dataUrl } from "./data-url.js";
import { decodeTables } from "./packed_data.js";
const chunkCaches = new WeakMap();
async function compressedJson(url, fetcher) {
  const response = await fetcher(url);
  if (!response.ok)
    throw new Error(`Données indisponibles (HTTP ${response.status})`);
  return new Response(
    response.body.pipeThrough(new DecompressionStream("gzip")),
  ).json();
}
function cachedPart(key, fetcher, loader) {
  if (!chunkCaches.has(fetcher)) chunkCaches.set(fetcher, new Map());
  const cache = chunkCaches.get(fetcher);
  if (cache.has(key)) {
    const value = cache.get(key);
    cache.delete(key);
    cache.set(key, value);
    return value;
  }
  const promise = loader().catch((error) => {
    cache.delete(key);
    throw error;
  });
  cache.set(key, promise);
  while (cache.size > 48) cache.delete(cache.keys().next().value);
  return promise;
}
/** Load one season from independently compressed competition snapshots. */
export function mergeSeason(manifest, selected, parts) {
  const matches = [],
    appearances = [],
    fixtures = [],
    competitionMap = new Map(),
    teamMap = new Map(),
    ids = new Set();
  for (const part of parts) {
    for (const match of part.matches || []) {
      if (ids.has(match.id)) throw new Error(`Match dupliqué : ${match.id}`);
      ids.add(match.id);
      matches.push(match);
    }
    appearances.push(...(part.appearances || []));
    fixtures.push(...(part.fixtures || []));
    for (const competition of part.competitions || []) {
      const current = competitionMap.get(competition.id);
      if (!current)
        competitionMap.set(competition.id, {
          ...competition,
          seasons: [...(competition.seasons || [])],
          sampleSeasons: [...(competition.sampleSeasons || [])],
        });
      else {
        current.sampleMatches += competition.sampleMatches || 0;
        current.seasons = [
          ...new Set([...current.seasons, ...(competition.seasons || [])]),
        ];
        current.sampleSeasons = [
          ...new Set([
            ...current.sampleSeasons,
            ...(competition.sampleSeasons || []),
          ]),
        ];
      }
    }
    for (const team of part.teams || []) {
      const current = teamMap.get(team.id);
      if (!current)
        teamMap.set(team.id, {
          ...team,
          leagueIds: [...(team.leagueIds || [])],
          seasons: [...(team.seasons || [])],
        });
      else {
        current.sampleMatches += team.sampleMatches || 0;
        current.leagueIds = [
          ...new Set([...current.leagueIds, ...(team.leagueIds || [])]),
        ];
        current.seasons = [
          ...new Set([...current.seasons, ...(team.seasons || [])]),
        ];
      }
    }
  }
  matches.sort(
    (a, b) =>
      (b.timeUtc || b.date || "").localeCompare(a.timeUtc || a.date || "") ||
      b.id.localeCompare(a.id),
  );
  const played = appearances.filter(
      (p) => typeof p.minutes === "number" && p.minutes > 0,
    ),
    dates = matches
      .map((m) => m.date)
      .filter(Boolean)
      .sort();
  const sum = (key) => parts.reduce((n, p) => n + (p.meta?.[key] || 0), 0);
  const retrieved =
    parts
      .map((p) => p.meta?.retrievedAt)
      .filter(Boolean)
      .sort()
      .at(-1) || null;
  const competitions = [...competitionMap.values()].sort((a, b) =>
    (a.name || "").localeCompare(b.name || "", "fr"),
  );
  return {
    meta: {
      schemaVersion: 2,
      source: "PitchAPI · archive européenne locale",
      retrievedAt: retrieved,
      currentSeason: selected,
      seasons: manifest.seasons.map((s) => s.id),
      matchCount: matches.length,
      collectedMatches: sum("collectedMatches"),
      expectedFinishedMatches: sum("expectedFinishedMatches"),
      playerCount: new Set(appearances.map((p) => p.playerId)).size,
      activePlayerCount: new Set(played.map((p) => p.playerId)).size,
      appearanceCount: played.length,
      listedAppearanceCount: appearances.length,
      teamCount: teamMap.size,
      catalogCount: competitions.length,
      sampleCompetitionCount: competitions.filter((c) => c.sampleMatches > 0)
        .length,
      shotCount: sum("shotCount"),
      knownShotXgCount: sum("knownShotXgCount"),
      ratedAppearanceCount: sum("ratedAppearanceCount"),
      xgAppearanceCount: sum("xgAppearanceCount"),
      xaAppearanceCount: sum("xaAppearanceCount"),
      startDate: dates[0] || null,
      endDate: dates.at(-1) || null,
      ratingSource: "PitchAPI",
      rankingAvailable: false,
    },
    competitions,
    teams: [...teamMap.values()].sort((a, b) =>
      (a.name || "").localeCompare(b.name || "", "fr"),
    ),
    fixtures,
    matches,
    appearances,
    metrics: parts[0]?.metrics || [],
  };
}

function restoreTables(tables, chunk) {
  const players = new Map(tables.players.map((p) => [p.id, p]));
  const shots = new Map(),
    stats = new Map(
      tables.team_statistics.map((row) => [row.matchId, row.values]),
    );
  for (const shot of tables.shots) {
    const { matchId, ...value } = shot;
    if (!shots.has(matchId)) shots.set(matchId, []);
    shots.get(matchId).push(value);
  }
  const appearances = tables.performances.map((row) => {
    const { playerRef, ...value } = row,
      player = players.get(playerRef);
    if (!player) throw new Error("Référence joueur absente");
    return { ...value, name: player.name, imageUrl: player.imageUrl };
  });
  return {
    meta: chunk.meta,
    metrics: chunk.metrics,
    fixtures: tables.fixtures,
    competitions: tables.competitions,
    teams: tables.teams,
    matches: tables.matches.map((row) => ({
      ...row,
      shots: shots.get(row.id) || [],
      stats: stats.get(row.id) || [],
    })),
    appearances,
  };
}

export async function loadSeason(
  manifest,
  selected,
  fetcher = fetch,
  leagueIds = null,
) {
  const source = manifest.seasons.find((item) => item.id === selected);
  if (!source) throw new Error("Saison indisponible");
  const season = {
    ...source,
    chunks: source.chunks.filter(
      (c) => !leagueIds || leagueIds.has(c.leagueId),
    ),
  };
  const parts = new Array(season.chunks.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= season.chunks.length) return;
      if (manifest.storage === "json-packed") {
        const chunk = season.chunks[index];
        const url = dataUrl(chunk.path);
        parts[index] = await cachedPart(url, fetcher, async () => {
          const packed = await compressedJson(url, fetcher);
          return restoreTables(decodeTables(packed), packed);
        });
        continue;
      }
      if (manifest.storage === "json-relational") {
        const chunk = season.chunks[index],
          tables = {};
        for (const [table, ref] of Object.entries(chunk.tables)) {
          const response = await fetcher(dataUrl(ref.path));
          if (!response.ok)
            throw new Error(
              `Table indisponible : ${table} (HTTP ${response.status})`,
            );
          const stream = response.body.pipeThrough(
            new DecompressionStream("gzip"),
          );
          tables[table] = await new Response(stream).json();
        }
        parts[index] = restoreTables(tables, chunk);
        continue;
      }
      const chunk = season.chunks[index],
        response = await fetcher(dataUrl(chunk.path));
      if (!response.ok)
        throw new Error(
          `Données de saison indisponibles (HTTP ${response.status})`,
        );
      if (typeof DecompressionStream === "undefined")
        throw new Error(
          "Ce navigateur ne peut pas décompresser les données de saison.",
        );
      const stream = response.body.pipeThrough(new DecompressionStream("gzip"));
      parts[index] = await new Response(stream).json();
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(6, season.chunks.length) }, worker),
  );
  return mergeSeason(manifest, selected, parts);
}
