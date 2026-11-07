import {
  compactCatalogue,
  compactGeneration,
  compactQuery,
  compactScope,
} from "../services/compact-reads.js";
import { europeFocusIds } from "../../../shared/competition-scope.js";
import { archiveSeason } from "../services/home-insights.js";
import {
  DEFAULT_HOME_STATE,
  normalizeHomeState,
} from "../services/home-bootstrap-preferences.js";

const origin =
  process.env.NEXT_PUBLIC_API_ORIGIN || "https://d317dq37z1tacb.cloudfront.net";
async function serverJson(path) {
  const response = await fetch(origin + path, {
    cache: "no-store",
    signal: AbortSignal.timeout(7000),
  });
  if (!response.ok)
    throw new Error(`Initial data unavailable (${response.status})`);
  return response.json();
}

export async function prepareHomeBootstrap(
  search,
  saved,
  fetchJson = serverJson,
  now = Date.now(),
) {
  const normalized = normalizeHomeState(
    saved?.clientOnly ? DEFAULT_HOME_STATE : saved || DEFAULT_HOME_STATE,
  );
  const state = normalized.clientOnly
    ? normalizeHomeState(DEFAULT_HOME_STATE)
    : normalized;
  const manifest = await fetchJson("/api/dashboard/manifest");
  const resources = { manifest };
  const result = { resources, state, now, createdAt: now, homeReady: false };
  if (
    saved?.clientOnly ||
    normalized.clientOnly ||
    search.get("v") ||
    manifest.storage !== "aws-relational" ||
    !manifest.capabilities?.compactReads?.home
  )
    return result;
  const season = [
    search.get("season"),
    state.season,
    manifest.defaultSeason,
  ].find((value) => manifest.seasons?.some((entry) => entry.id === value));
  if (!season) return result;
  state.season = season;
  const focus = ["all", "europe"].includes(search.get("focus"))
    ? search.get("focus")
    : state.preferences.focus;
  const league = search.get("league") || "all";
  const ids =
    league !== "all"
      ? [league]
      : state.preferences.favoriteLeagueIds.length
        ? state.preferences.favoriteLeagueIds
        : focus === "all" && state.preferences.onboardingComplete
          ? null
          : [...europeFocusIds(manifest)];
  const generation = compactGeneration(manifest);
  const params = {
    season,
    leagues: compactScope(ids),
    generation,
    archive: archiveSeason(season, manifest.defaultSeason, now) ? 1 : undefined,
    personalTeams: state.personalTeams.join(","),
    personalPlayers: state.personalPlayers.join(","),
  };
  const summary = await fetchJson(
    `/api/read/home?${compactQuery({ ...params, ...(manifest.capabilities.resolvedMedia ? { media: 1 } : {}) })}`,
  );
  if (!summary.data || String(summary.meta?.generation) !== String(generation))
    return result;
  resources[`compact-catalogue:${season}:home:${generation}`] = {
    meta: { retrievedAt: manifest.retrievedAt, storage: manifest.storage },
    competitions: compactCatalogue(manifest, season),
    teams: [],
    matches: [],
    appearances: [],
    fixtures: [],
    metrics: [],
  };
  resources[
    `compact:home:${compactQuery(params)}:${Math.floor(now / 300_000)}`
  ] = summary;
  result.homeReady = true;
  result.media = summary.media || null;
  result.homeKey = compactQuery(params);
  return result;
}
