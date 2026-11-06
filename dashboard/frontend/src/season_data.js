import { decodeTables, rowCopier } from "./packed_data.js";
import { apiUrl, dataUrl } from "./data-url.js";
const chunkCaches = new WeakMap();
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
/** Merge one complete partition per competition into a season. */
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
    for (const appearance of part.appearances || [])
      appearances.push(appearance);
    for (const fixture of part.fixtures || []) fixtures.push(fixture);
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
      source: manifest.storage?.startsWith("aws-") ? "PitchAPI · AWS" : "PitchAPI · archives",
      storage: manifest.storage,
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

/** Cursor traversal always returns a complete single generation or throws. */
export async function readPages(path, filters, fetcher = fetch) {
  let limit = 100,
    restarted = false;
  for (;;) {
    const pages = [],
      seen = new Set();
    let cursor = null,
      generation;
    for (;;) {
      const params = new URLSearchParams({ ...filters, limit: String(limit) });
      if (cursor) params.set("cursor", cursor);
      const response = await fetcher(apiUrl(path + "?" + params));
      if (response.status === 409 && !restarted) {
        restarted = true;
        break;
      }
      if (response.status === 413 && limit > 1) {
        limit = Math.max(1, Math.floor(limit / 2));
        break;
      }
      if (!response.ok)
        throw new Error(
          "Données indisponibles (HTTP " + response.status + ").",
        );
      const page = await response.json(),
        current = page.pagination?.generation;
      if (
        !page.data ||
        current == null ||
        (filters.v && current !== filters.v) ||
        !Object.hasOwn(page.pagination, "nextCursor")
      )
        throw new Error("Page de données invalide.");
      if (generation !== undefined && generation !== current) {
        if (restarted)
          throw new Error("Les données ont changé pendant la lecture.");
        restarted = true;
        break;
      }
      generation = current;
      pages.push(page.data);
      cursor = page.pagination.nextCursor;
      if (cursor === null) return pages;
      if (typeof cursor !== "string" || !cursor || seen.has(cursor))
        throw new Error("Curseur de données invalide.");
      seen.add(cursor);
    }
  }
}

export function decodePartition(data) {
  if (!data.format) return data;
  const decoded = decodeTables(data);
  for (const [name, table] of Object.entries(data.tables)) {
    const constants = table.constants || {};
    if (Object.hasOwn(constants, "__proto__")) {
      const descriptors = Object.getOwnPropertyDescriptors(constants);
      for (const row of decoded[name])
        Object.defineProperties(row, descriptors);
    } else if (Object.keys(constants).length) {
      for (const row of decoded[name]) Object.assign(row, constants);
    }
  }
  const { shots, stats, matches, ...tables } = decoded;
  let shotOffset = 0,
    statOffset = 0;
  for (const match of matches) {
    match.players = match.players.map((ref) =>
      typeof ref === "number" ? tables.appearances[ref].id : ref,
    );
    const shotCount = match.shots,
      statCount = match.stats;
    match.shots = shots.slice(shotOffset, shotOffset + shotCount);
    match.stats = stats.slice(statOffset, statOffset + statCount);
    shotOffset += shotCount;
    statOffset += statCount;
  }
  if (shotOffset !== shots.length || statOffset !== stats.length)
    throw new Error("Page de saison incomplète.");
  return { meta: data.meta, metrics: data.metrics, ...tables, matches };
}

function mergePartition(packedPages) {
  const pages = packedPages.map(decodePartition);
  const first = pages[0],
    teams = new Map(),
    competitions = new Map();
  const part = {
    meta: first.meta,
    metrics: first.metrics,
    fixtures: [],
    matches: [],
    appearances: [],
  };
  for (const page of pages) {
    for (const name of ["fixtures", "matches", "appearances"]) {
      if (!Array.isArray(page[name]))
        throw new Error("Page de saison incomplète.");
      for (const row of page[name]) part[name].push(row);
    }
    for (const team of page.teams || []) teams.set(team.id, team);
    for (const competition of page.competitions || [])
      competitions.set(competition.id, competition);
  }
  return {
    ...part,
    teams: [...teams.values()],
    competitions: [...competitions.values()],
  };
}

// A single queue per module prevents parallel history/compare loaders from each
// opening their own full set of simultaneous requests to the small API pool.
const pending = [];
let running = 0;
function scheduled(loader) {
  return new Promise((resolve, reject) => {
    function start() {
      running++;
      loader()
        .then(resolve, reject)
        .finally(() => {
          running--;
          pending.shift()?.();
        });
    }
    if (running < 3) start();
    else pending.push(start);
  });
}

export function restoreLegacyTables(tables, chunk) {
  const players = new Map(tables.players.map((player) => [player.id, player]));
  const shots = new Map(), stats = new Map(tables.team_statistics.map((row) => [row.matchId, row.values]));
  for (const shot of tables.shots) {
    const { matchId, ...value } = shot;
    if (!shots.has(matchId)) shots.set(matchId, []);
    shots.get(matchId).push(value);
  }
  const packed = chunk?.tables?.performances;
  const uniform = packed?.keys && !Object.values(packed.missing || {}).some((absent) => absent?.length);
  const copy = uniform ? rowCopier(packed.keys.filter((key) => key !== "playerRef"), ["name", "imageUrl"]) : null;
  const appearances = tables.performances.map((row) => {
    const player = players.get(row.playerRef);
    if (!player) throw new Error("Référence joueur absente");
    if (copy) return copy(row, player);
    const { playerRef, ...value } = row;
    return { ...value, name: player.name, imageUrl: player.imageUrl };
  });
  return {
    meta: chunk.meta,
    metrics: chunk.metrics,
    fixtures: tables.fixtures,
    competitions: tables.competitions,
    teams: tables.teams,
    matches: tables.matches.map((row) => ({ ...row, shots: shots.get(row.id) || [], stats: stats.get(row.id) || [] })),
    appearances,
  };
}

async function loadLegacySeason(manifest, selected, fetcher, leagueIds) {
  const season = manifest.seasons.find((item) => item.id === selected);
  if (!season) throw new Error("Saison indisponible");
  const chunks = season.chunks.filter((chunk) => !leagueIds || leagueIds.has(chunk.leagueId));
  const parts = await Promise.all(chunks.map((chunk) => {
    const load = () => scheduled(async () => {
      const result = await fetcher(dataUrl(chunk.path));
      if (!result.ok) throw new Error(`Données indisponibles (HTTP ${result.status})`);
      if (typeof DecompressionStream === "undefined") throw new Error("Ce navigateur ne peut pas décompresser les données de saison.");
      const packed = await new Response(result.body.pipeThrough(new DecompressionStream("gzip"))).json();
      return restoreLegacyTables(decodeTables(packed), packed);
    });
    return chunk.sourceDigest ? cachedPart(JSON.stringify(["neon", selected, chunk.leagueId, chunk.sourceDigest]), fetcher, load) : load();
  }));
  return mergeSeason(manifest, selected, parts);
}

export async function loadSeason(
  manifest,
  selected,
  fetcher = fetch,
  leagueIds = null,
) {
  if (manifest.storage === "json-packed")
    return loadLegacySeason(manifest, selected, fetcher, leagueIds);
  const season = manifest.seasons.find((item) => item.id === selected);
  if (!season) throw new Error("Saison indisponible");
  const chunks = season.chunks.filter(
    (c) => !leagueIds || leagueIds.has(c.leagueId),
  );
  const parts = await Promise.all(
    chunks.map((chunk) => {
      const version = manifest.storage === "aws-orion-pro"
        ? chunk.representationToken
        : null;
      if (manifest.storage === "aws-orion-pro" &&
          (!/^pro1\.[1-9][0-9]{0,18}\.[a-f0-9]{64}$/.test(version || "") ||
           !manifest.editions?.some((edition) => edition.leagueId === chunk.leagueId &&
             edition.season === selected && edition.representationToken === version)))
        throw new Error("Version de saison indisponible.");
      const load = () =>
        scheduled(async () =>
          mergePartition(
            await readPages(
              "/api/seasons/partition",
              { season: selected, league: chunk.leagueId, format: "columns", ...(version ? { v: version } : {}) },
              fetcher,
            ),
          ),
        );
      return chunk.sourceDigest
        ? cachedPart(
            JSON.stringify([selected, chunk.leagueId, chunk.sourceDigest, version]),
            fetcher,
            load,
          )
        : load();
    }),
  );
  return mergeSeason(manifest, selected, parts);
}
