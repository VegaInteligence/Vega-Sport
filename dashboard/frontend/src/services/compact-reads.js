import { publicApiFetch, wasPublicApiThrottle } from "./public-api-fetch.js";
import { apiUrl } from "../data-url.js";
import { europeFocusIds } from "../../../shared/competition-scope.js";
import { advancedQuery, EMPTY_ADVANCED } from "./advanced-filters.js";

export function supportsCompactRead(manifest, kind, { ranking } = {}) {
  return (
    manifest?.storage === "aws-relational" &&
    manifest.capabilities?.compactReads?.[kind] === true &&
    (kind !== "players" ||
      ranking !== "rating" ||
      manifest.capabilities.playerRatingRanking === true)
  );
}

export const compactGeneration = (manifest) =>
  manifest?.publicationVersion || manifest?.scouting?.sourceDigest || "";

/** Catalogue identities keep the selected edition's counts without its rows. */
export function compactCatalogue(manifest, season) {
  const catalog = new Map(
    (manifest?.competitions || []).map((item) => [item.id, item]),
  );
  return (
    manifest?.seasons?.find((item) => item.id === season)?.chunks || []
  ).map((chunk) => {
    const competition =
        chunk.competitions?.find((item) => item.id === chunk.leagueId) || {},
      count = chunk.meta?.matchCount ?? competition.sampleMatches ?? 0;
    return {
      ...catalog.get(chunk.leagueId),
      ...competition,
      id: chunk.leagueId,
      sampleMatches: count,
      sampleSeasons: count ? [season] : [],
    };
  });
}

/** null means all; [] means the intersection really is empty. */
export function directoryScopeIds(manifest, season, focus, filters = {}) {
  let ids = focus === "europe" ? europeFocusIds(manifest) : null;
  for (const selection of [
    filters.league && filters.league !== "all" ? [filters.league] : [],
    filters.leagues || [],
  ]) {
    if (!selection.length) continue;
    ids = new Set(selection.filter((id) => !ids || ids.has(id)));
  }
  if (!ids) return null;
  const published = new Set(
    manifest?.seasons
      ?.find((item) => item.id === season)
      ?.chunks?.map((chunk) => chunk.leagueId) || [],
  );
  return [...ids].filter((id) => published.has(id)).sort();
}

export const compactScope = (ids) =>
  ids == null
    ? "all"
    : ids.length
      ? [...new Set(ids)].sort().join(",")
      : "none";

export function compactQuery(values) {
  return new URLSearchParams(
    Object.entries(values)
      .filter(
        ([, value]) => value !== undefined && value !== null && value !== "",
      )
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => [key, String(value)]),
  ).toString();
}

export function playerReadParams(
  f,
  {
    sort,
    ranking = f.filters.ranking,
    page = 1,
    limit = 20,
    cohort = false,
  } = {},
) {
  const filters = f.filters,
    advanced = cohort
      ? { ...filters.advanced, positions: [], rating: null, conditions: [] }
      : filters.advanced || EMPTY_ADVANCED;
  return {
    season: f.season,
    leagues: compactScope(
      directoryScopeIds(f.manifest, f.season, f.focus, filters),
    ),
    generation: compactGeneration(f.manifest),
    q: cohort ? "" : filters.query,
    minutes: cohort ? 0 : filters.minutes,
    basis: cohort ? "total" : filters.basis,
    match: filters.match !== "all" ? filters.match : "",
    ...advancedQuery(advanced),
    ranking: cohort || ranking === "all" ? "" : ranking,
    sort: cohort ? "name" : sort?.key || "rating",
    direction: cohort ? "asc" : sort?.direction || "desc",
    page,
    limit,
  };
}

/** An advertised compact route must fail visibly; never fall back to a bulk read. */
export async function readCompact(
  kind,
  params,
  { signal, fetcher = fetch } = {},
) {
  signal?.throwIfAborted();
  const response = await publicApiFetch(
    apiUrl(`/api/read/${kind}?${compactQuery(params)}`),
    {
      signal,
      headers: { Accept: "application/json" },
    },
    fetcher,
  );
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error("La réponse des données est invalide.");
  }
  if (!response.ok || body.error) {
    const error = new Error(
      body.error?.message ||
        (response.status === 409
          ? "La publication a changé. Actualisez les données."
          : `Données indisponibles (HTTP ${response.status}).`),
    );
    error.status = response.status;
    error.throttled = wasPublicApiThrottle(response);
    throw error;
  }
  const generation = body.pagination?.generation || body.meta?.generation;
  if (
    !body.data ||
    !generation ||
    (params.generation && params.generation !== generation)
  )
    throw new Error("La publication reçue ne correspond pas à la sélection.");
  return body;
}

/** Exact selected actor matches, split only to respect the API's 200-ID budget. */
export async function readPlayerDiscipline(
  manifest,
  season,
  player,
  matchIds,
  { signal, fetcher = fetch } = {},
) {
  const ids = [
      ...new Set(matchIds.filter((id) => /^m_[A-Za-z0-9]{6}$/.test(id))),
    ].sort(),
    totals = { yellow: 0, directRed: 0, secondYellow: 0, covered: 0, total: 0 };
  let generation = compactGeneration(manifest);
  for (let offset = 0; offset < ids.length; offset += 200) {
    signal?.throwIfAborted();
    const batch = ids.slice(offset, offset + 200),
      result = await readCompact(
        "discipline",
        {
          season,
          player,
          matches: batch.join(","),
          generation,
        },
        { signal, fetcher },
      );
    generation ||= result.meta.generation;
    const counts = result.data;
    if (
      Object.keys(totals).some(
        (key) => !Number.isSafeInteger(counts[key]) || counts[key] < 0,
      ) ||
      counts.covered > counts.total ||
      counts.total > batch.length
    )
      throw new Error(
        "La couverture des événements disciplinaires est invalide.",
      );
    for (const key of Object.keys(totals)) totals[key] += counts[key];
  }
  signal?.throwIfAborted();
  return totals;
}

/** Explicit analysis/detail intent only: complete aggregates or one actor, one generation. */
export async function readCompactPages(
  kind,
  params,
  { signal, fetcher = fetch, onPage, parallelPages = false } = {},
) {
  const pages = [],
    seen = new Set();
  let generation = params.generation,
    expectedPages,
    expectedTotal;
  const limit =
    /(?:appearances|shots)/.test(params.include || "") ||
    (kind === "player" && params.detail !== "summary")
      ? 25
      : params.limit || 100;
  const load = (page) =>
    readCompact(
      kind,
      { ...params, page, limit, generation },
      { signal, fetcher },
    );
  function accept(result, page) {
    signal?.throwIfAborted();
    const pagination = result.pagination;
    if (
      !pagination ||
      pagination.page !== page ||
      !Number.isInteger(pagination.pages) ||
      pagination.pages < 1 ||
      !Number.isInteger(pagination.total) ||
      pagination.total < 0 ||
      (expectedPages != null &&
        (expectedPages !== pagination.pages ||
          expectedTotal !== pagination.total))
    )
      throw new Error("La pagination des données est invalide.");
    generation ||= pagination.generation;
    expectedPages = pagination.pages;
    expectedTotal = pagination.total;
    const ids =
      kind === "players" || kind === "clubs"
        ? (result.data[kind] || []).map((row) => row.playerId || row.id)
        : [
            ...new Set(
              [
                ...(result.data.matches || []),
                ...(result.data.fixtures || []),
              ].map((row) => row.id),
            ),
          ];
    if (
      !Number.isInteger(pagination.limit) ||
      pagination.limit < 1 ||
      ids.length !==
        Math.min(
          pagination.limit,
          Math.max(0, expectedTotal - (page - 1) * pagination.limit),
        ) ||
      ids.some((id) => !id || seen.has(id)) ||
      new Set(ids).size !== ids.length
    )
      throw new Error("La page reçue est incomplète ou contient des doublons.");
    ids.forEach((id) => seen.add(id));
    pages.push(result.data);
    onPage?.({ page, pages: expectedPages, total: expectedTotal });
    if (page === expectedPages && seen.size !== expectedTotal)
      throw new Error("La cohorte reçue est incomplète.");
    if (page > expectedPages)
      throw new Error("La pagination des données est invalide.");
    return { pages, meta: result.meta, pagination };
  }
  let final;
  for (let first = 1; first <= (expectedPages ?? 1);) {
    signal?.throwIfAborted();
    const count = Math.min(
      parallelPages ? 2 : 1,
      (expectedPages ?? 1) - first + 1,
    );
    const settled = await Promise.allSettled(
      Array.from({ length: count }, (_, index) => load(first + index)),
    );
    signal?.throwIfAborted();
    for (const item of settled)
      if (
        item.status === "rejected" &&
        (!parallelPages ||
          item.reason?.throttled ||
          ![502, 503, 504].includes(item.reason?.status))
      )
        throw item.reason;
    for (let index = 0; index < settled.length; index++) {
      signal?.throwIfAborted();
      const item = settled[index];
      const result =
        item.status === "fulfilled" ? item.value : await load(first + index);
      final = accept(result, first + index);
    }
    first += count;
  }
  return final;
}

export function mergeActorPages(result, manifest, season) {
  const names = [
    "matches",
    "fixtures",
    "appearances",
    "teams",
    "competitions",
    "metrics",
  ];
  return {
    meta: {
      storage: manifest.storage,
      currentSeason: season,
      ...result.pages[0]?.meta,
      ...result.meta,
      complete: true,
    },
    ...Object.fromEntries(
      names.map((name) => [
        name,
        [
          ...new Map(
            result.pages
              .flatMap((page) => page[name] || [])
              .map((row) => [row.id || row.key, row]),
          ).values(),
        ],
      ]),
    ),
  };
}
