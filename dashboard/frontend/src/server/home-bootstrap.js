import {
  compactCatalogue,
  compactGeneration,
  compactQuery,
  compactScope,
} from "../services/compact-reads.js";
import { europeFocusIds } from "../../../shared/competition-scope.js";
import { archiveSeason } from "../services/home-insights.js";
import { API_ORIGIN } from "../api-origin.js";
import { edgeKeyHeaders } from "./api-edge-key.js";
import {
  DEFAULT_HOME_STATE,
  normalizeHomeState,
} from "../services/home-bootstrap-preferences.js";
import { resolveHomeCountry } from "../services/home-country.js";

const origin = process.env.NEXT_PUBLIC_API_ORIGIN || API_ORIGIN;
async function serverJson(path) {
  const response = await fetch(origin + path, {
    cache: "no-store",
    headers: edgeKeyHeaders(),
    signal: AbortSignal.timeout(7000),
  });
  if (!response.ok)
    throw new Error(`Initial data unavailable (${response.status})`);
  return response.json();
}

/**
 * `country`: the hosting's ISO-2 code of the visitor (x-vercel-ip-country), when there is one.
 * The result names it (`visitorCountry`) and the strip's country (`homeCountry`, the browser's
 * own rule: home-country.js), and seeds the strip's read under the browser's key.
 */
export async function prepareHomeBootstrap(
  search,
  saved,
  fetchJson = serverJson,
  now = Date.now(),
  { country = null } = {},
) {
  const normalized = normalizeHomeState(
    saved?.clientOnly ? DEFAULT_HOME_STATE : saved || DEFAULT_HOME_STATE,
  );
  const state = normalized.clientOnly
    ? normalizeHomeState(DEFAULT_HOME_STATE)
    : normalized;
  const manifest = await fetchJson("/api/dashboard/manifest");
  const resources = { manifest };
  const visitorCountry = /^[A-Z]{2}$/.test(country || "") ? country : null;
  const result = {
    resources,
    state,
    now,
    createdAt: now,
    homeReady: false,
    visitorCountry,
    homeCountry: resolveHomeCountry(
      state.preferences.homeCountry,
      visitorCountry,
    ),
  };
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
    // The common read takes no favourites: they have their own read, client side.
  };
  const media = manifest.capabilities.resolvedMedia ? { media: 1 } : {};
  // « Chez vous » (VI-48): the country's common read, beside the home's; never in the way of the home.
  const localParams =
    result.homeCountry &&
    !params.archive &&
    manifest.capabilities.compactReads["home-local"] === true
      ? { season, country: result.homeCountry, generation }
      : null;
  const [summary, local] = await Promise.all([
    fetchJson(`/api/read/home?${compactQuery({ ...params, ...media })}`),
    localParams
      ? fetchJson(
          `/api/read/home-local?${compactQuery({ ...localParams, ...media })}`,
        ).catch(() => null)
      : null,
  ]);
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
  if (local?.data && String(local.meta?.generation) === String(generation))
    resources[
      `compact:home-local:${compactQuery(localParams)}:${Math.floor(now / 300_000)}`
    ] = local;
  result.homeReady = true;
  result.media =
    summary.media || local?.media
      ? { ...summary.media, ...local?.media }
      : null;
  result.homeKey = compactQuery(params);
  return result;
}
