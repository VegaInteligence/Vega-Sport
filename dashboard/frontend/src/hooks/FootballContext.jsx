"use client";
import { usePathname, useSearchParams } from "next/navigation";
import React, {
  createContext,
  useCallback,
  useContext,
  useDeferredValue,
  useMemo,
  useRef,
  useState,
  useEffect,
} from "react";
import { loadSeason } from "../season_data.js";
import {
  filterAppearances,
  filterMatches,
  csvString,
  normalizeText,
  per90,
  seasonLabel,
} from "../model.js";
import {
  json,
  useResource,
  download,
  primeResource,
  cachedResource,
} from "../services/resources.js";
import { warmProfiles } from "../services/player-profile.js";
import { filterSeasonPlayerScope } from "../services/season-player.js";
import {
  playerDirectoryRanking,
  playerDirectoryView,
  playerLeagueIds,
  playerRankingKey,
} from "../services/player-leaderboard.js";
import {
  advancedKey,
  advancedQuery,
  advancedTest,
  EMPTY_ADVANCED,
  parseAdvanced,
} from "../services/advanced-filters.js";
import { FootballDataClient } from "../services/football-client.js";
import { ProFootballDataClient } from "../services/pro-football-client.js";
import { isProManifest } from "../services/pro-match-data.js";
import {
  pagedMatchList,
  seasonVersion,
  selectSeasonSnapshot,
} from "../services/season-version.js";
import usePublishedDataRefresh from "./usePublishedDataRefresh.js";
import {
  compactGeneration,
  compactCatalogue,
  compactScope,
  directoryScopeIds,
  mergeActorPages,
  readCompact,
  readCompactPages,
  playerReadParams,
  supportsCompactRead,
} from "../services/compact-reads.js";
import { directoryCSV } from "../services/player-directory.js";
import { enrichSeasonCompetitions } from "../services/competition-identity.js";
import { clubDataTeam, loadClubSeason } from "../services/scouting-history.js";
import { AsyncState } from "../components/UI.jsx";
import LoadingPage from "../components/LoadingPage.jsx";
import {
  europeFocusIds,
  inEuropeFocus,
  PREFERENCES_KEY,
} from "../../../shared/competition-scope.js";
export const FootballContext = createContext(null);
const loadedScopes = new Set();
const PAGE_SEASONS_KEY = "statarena:page-seasons:v1";
const seasonPage = (path) => path.replace(/\/$/, "") || "/";
const metricBasis = (value) =>
  value === "per90" || value === "total" ? value : "perMatch";
const Context = FootballContext;
export const useFootball = () => useContext(Context);
export function FootballProvider({ children, loadData = true }) {
  const initial = useSearchParams();
  const pathname = usePathname() || "";
  const currentPage = seasonPage(pathname);
  const playerDirectory = currentPage === "/joueurs" && !initial.get("id");
  const [matchFilter, setMatchFilter] = useState("all");
  const [preferences, setPreferences] = useState({
    focus: "europe",
    defaultSeason: "",
    favoriteLeagueIds: [],
    onboardingComplete: false,
  });
  const [pageSeasons, setPageSeasons] = useState({});
  const [preferencesReady, setPreferencesReady] = useState(false);
  const requestedFocus = initial.get("focus");
  const defaultPlayerScope =
    playerDirectory && !initial.get("league") && !initial.get("leagues");
  const focus =
    requestedFocus === "europe" || requestedFocus === "all"
      ? requestedFocus
      : defaultPlayerScope
        ? "europe"
        : preferences.focus;
  function savePreferences(values) {
    setPreferences((previous) => {
      const next = { ...previous, ...values };
      try {
        window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }
  useEffect(() => {
    try {
      const saved = JSON.parse(
        window.localStorage.getItem(PREFERENCES_KEY) || "{}",
      );
      setPreferences({
        focus: saved.focus === "all" ? "all" : "europe",
        defaultSeason:
          typeof saved.defaultSeason === "string" ? saved.defaultSeason : "",
        favoriteLeagueIds: Array.isArray(saved.favoriteLeagueIds)
          ? [
              ...new Set(
                saved.favoriteLeagueIds.filter((id) => typeof id === "string"),
              ),
            ]
          : [],
        onboardingComplete: saved.onboardingComplete === true,
      });
    } catch {
      // An unavailable or invalid local preference must not prevent browsing.
    } finally {
      try {
        const saved = JSON.parse(
          window.sessionStorage.getItem(PAGE_SEASONS_KEY) || "{}",
        );
        if (saved && typeof saved === "object" && !Array.isArray(saved))
          setPageSeasons(
            Object.fromEntries(
              Object.entries(saved).filter(
                ([path, value]) =>
                  path.startsWith("/") && typeof value === "string",
              ),
            ),
          );
      } catch {
        // Page selections still work in memory when browser storage is unavailable.
      }
      setPreferencesReady(true);
    }
  }, []);
  const season = initial.get("season") || "";
  // Playing time and advanced filters belong to the players page: they stay
  // in the URL across pages but only narrow the data there.
  const playerScope = pathname.startsWith("/joueurs"),
    // The home page has no list filter: the navbar search navigates instead.
    homeScope = pathname === "/" || pathname === "";
  const urlFilters = useMemo(
    () => ({
      query: initial.get("q") || "",
      league: initial.get("league") || "all",
      minutes: Number(initial.get("minutes") ?? 1),
      basis: metricBasis(initial.get("basis")),
      ranking: playerRankingKey(initial.get("ranking")),
      leagues: playerLeagueIds(initial.get("leagues")),
      match: matchFilter,
      advanced: parseAdvanced(initial),
    }),
    [initial, matchFilter],
  );
  const filters = useMemo(() => {
    const scoped = playerScope
      ? urlFilters
      : { ...urlFilters, minutes: 1, advanced: EMPTY_ADVANCED };
    return homeScope && scoped.query ? { ...scoped, query: "" } : scoped;
  }, [urlFilters, playerScope, homeScope]);
  function updateQuery(values) {
    const url = new URL(window.location.href);
    for (const [key, value] of Object.entries(values)) {
      if (value === "" || value == null) url.searchParams.delete(key);
      else url.searchParams.set(key, String(value));
    }
    window.history.replaceState(null, "", url.pathname + url.search);
  }
  function setFilters(action) {
    // History updates are synchronous; Next's search-parameter render may follow
    // a frame later. Apply quick successive edits to the latest URL scope.
    const current = new URLSearchParams(window.location.search);
    const latest = {
      ...filters,
      query: current.get("q") || "",
      league: current.get("league") || "all",
      minutes: Number(current.get("minutes") ?? 1),
      basis: metricBasis(current.get("basis")),
      ranking: playerRankingKey(current.get("ranking")),
      leagues: playerLeagueIds(current.get("leagues")),
      advanced: parseAdvanced(current),
    };
    const next = typeof action === "function" ? action(latest) : action;
    setMatchFilter(next.match || "all");
    updateQuery({
      q: next.query,
      league: next.league === "all" ? "" : next.league,
      minutes: next.minutes === 1 ? "" : next.minutes,
      basis: metricBasis(next.basis) === "perMatch" ? "" : next.basis,
      ranking: playerRankingKey(next.ranking),
      leagues: Array.isArray(next.leagues) ? next.leagues.join(",") : "",
      ...advancedQuery(next.advanced || EMPTY_ADVANCED),
    });
  }
  const [selectedPerformances, setSelectedPerformances] = useState([]),
    [player, setPlayer] = useState(null),
    [comparing, setComparing] = useState(false),
    [notice, setNotice] = useState("");
  const currentManifest = useResource("manifest", ({ signal } = {}) =>
    json("/api/dashboard/manifest", { signal }),
  );
  const requestedVersion = initial.get("v");
  const pinnedManifest = useResource(
    `manifest:${requestedVersion}`,
    ({ signal } = {}) =>
      json(
        `/api/dashboard/manifest?v=${encodeURIComponent(requestedVersion)}`,
        { signal },
      ),
    Boolean(requestedVersion),
  );
  const manifest = requestedVersion ? pinnedManifest : currentManifest;
  const proMode =
    isProManifest(manifest.value) || isProManifest(currentManifest.value);
  const catalogueManifest = proMode
    ? currentManifest.value || manifest.value
    : manifest.value;
  // Background refresh never unpins an explicitly requested representation.
  const refreshCurrentManifest = currentManifest.revalidate;
  const refreshManifest = useCallback(
    () => refreshCurrentManifest(),
    [refreshCurrentManifest],
  );
  usePublishedDataRefresh(refreshManifest, Boolean(currentManifest.value));
  // Top 7 Europe + UEFA, extended to the national and super cups of the
  // seven countries present in the manifest.
  const EUROPE_FOCUS_IDS = useMemo(
    () => europeFocusIds(manifest.value),
    [manifest.value],
  );
  const validSeason = (value) =>
    manifest.value?.seasons.some((s) => s.id === value);
  const chosen = validSeason(season)
    ? season
    : validSeason(pageSeasons[currentPage])
      ? pageSeasons[currentPage]
      : manifest.value?.defaultSeason;
  // A competition filter only narrows the download when the whole scope has
  // not been loaded yet (deep link). Once it has, the filter runs in memory:
  // no second download, no re-merge, no loading screen.
  const clubDetail =
    pathname.startsWith("/clubs") && Boolean(initial.get("id"));
  const clubTeam =
    !proMode && clubDetail
      ? clubDataTeam(initial, { playerOpen: Boolean(player), comparing })
      : null;
  const dataFocus = clubDetail ? "all" : focus;
  const pagedMatches = pagedMatchList(
    manifest.value,
    pathname,
    initial.get("id"),
  );
  const actorId = initial.get("id"),
    compactKind = homeScope
      ? "home"
      : playerScope
        ? actorId
          ? "player"
          : "players"
        : pathname.startsWith("/clubs")
          ? actorId
            ? "club"
            : "clubs"
          : null,
    compactRanking =
      playerDirectory &&
      playerDirectoryView(initial.get("playersView")) === "table"
        ? playerDirectoryRanking(filters, true)
        : "",
    compactMode = Boolean(
      compactKind &&
      supportsCompactRead(manifest.value, compactKind, {
        ranking: compactRanking,
      }),
    ),
    compactActor = compactMode && ["player", "club"].includes(compactKind),
    actorScope =
      compactKind === "club"
        ? "all"
        : compactScope(
            directoryScopeIds(manifest.value, chosen, focus, filters),
          ),
    actorInclude =
      compactKind === "player"
        ? initial.get("playerView") === "stats"
          ? "shots"
          : ""
        : initial.get("clubView") === "squad"
          ? "appearances"
          : initial.get("clubView") === "matches"
            ? "shots"
            : "";
  const versions = useMemo(
    () => ({
      all: seasonVersion(manifest.value, chosen),
      europe: seasonVersion(manifest.value, chosen, EUROPE_FOCUS_IDS),
      league: seasonVersion(manifest.value, chosen, new Set([filters.league])),
    }),
    [manifest.value, chosen, EUROPE_FOCUS_IDS, filters.league],
  );
  const scopeVersion = dataFocus === "europe" ? versions.europe : versions.all;
  const previousDataset = useRef(null);
  // The user intent excludes the digest, but includes every filter and the
  // actual competition membership. A changed intent never inherits stale data.
  const dataIntent = JSON.stringify([
    pathname,
    initial.get("id"),
    requestedVersion,
    chosen,
    dataFocus,
    clubTeam,
    proMode,
    pagedMatches,
    compactMode,
    compactKind,
    actorScope,
    actorInclude,
    loadData,
    filters,
    JSON.parse(scopeVersion)[2].map(([leagueId]) => leagueId),
  ]);
  const renewingFullScope =
    previousDataset.current?.intent === dataIntent &&
    previousDataset.current.fullScope;
  const scopeKey = `${chosen}:${dataFocus}:${scopeVersion}`,
    leagueOnly =
      !pathname.startsWith("/clubs") &&
      filters.league !== "all" &&
      !renewingFullScope &&
      !loadedScopes.has(scopeKey),
    // "All competitions" first shows the Top 7 + UEFA chunks (a quarter of
    // the bytes), then merges the other leagues loaded in the background.
    // Pages opened on a specific record wait for the full scope instead.
    progressive =
      !proMode &&
      !pagedMatches &&
      !compactMode &&
      !renewingFullScope &&
      loadData &&
      dataFocus === "all" &&
      (pathname.startsWith("/clubs") || filters.league === "all") &&
      !initial.get("id") &&
      !loadedScopes.has(scopeKey),
    fullKey = `season:${chosen}:${dataFocus}:${scopeVersion}:all:full`;
  const proMatchPage =
    proMode && /^\/matchs\/?$/.test(pathname) && !initial.get("id");
  const proVersionKey = JSON.stringify(manifest.value?.editions || []);
  const seasonKey = compactMode
    ? compactActor && loadData
      ? `compact-actor:${compactKind}:${actorId}:${chosen}:${actorScope}:${actorInclude}:${compactGeneration(manifest.value)}`
      : `compact-catalogue:${chosen}:${compactKind}:${compactGeneration(manifest.value)}`
    : proMode
      ? `pro-season:${chosen}:${proMatchPage || !loadData ? "catalogue" : `${dataFocus}:${leagueOnly ? filters.league : "all"}`}:${proVersionKey}`
      : clubTeam
        ? `club-season:${chosen}:${clubTeam}:${versions.all}`
        : pagedMatches
          ? `match-catalogue:${chosen}:${scopeVersion}`
          : progressive
            ? `season:${chosen}:europe:${versions.europe}:all:full`
            : `season:${chosen}:${loadData ? `${dataFocus}:${leagueOnly ? versions.league : scopeVersion}:${leagueOnly ? filters.league : "all"}:full` : `catalog:${scopeVersion}`}`;
  const detailId =
    /^\/matchs\/?$/.test(pathname) &&
    /^m_[A-Za-z0-9]{6}$/.test(initial.get("id") || "")
      ? initial.get("id")
      : null;
  // Reuse the scope that exists on entering this match. Later intent loads must not
  // replace the rendered match, recreate its client, or discard the active tab.
  const warmSeason = useMemo(() => {
    const cached = detailId && cachedResource(seasonKey);
    if (
      cached?.matches?.some((m) => m.id === detailId) ||
      cached?.fixtures?.some(
        (m) => m.id === detailId && m.status !== "finished",
      )
    )
      return cached;
    return null;
  }, [detailId, seasonKey]);
  const deferSeason = !proMode && Boolean(detailId && !warmSeason);
  const emptySeason = useMemo(
    () =>
      !manifest.value || !chosen
        ? null
        : {
            meta: {
              retrievedAt: manifest.value.retrievedAt,
              storage: manifest.value.storage,
            },
            competitions: compactMode
              ? compactCatalogue(catalogueManifest, chosen)
              : catalogueManifest?.competitions || [],
            teams: [],
            matches: [],
            appearances: [],
            fixtures: [],
            metrics: [],
          },
    [manifest.value, catalogueManifest, chosen, proMode, compactMode],
  );
  function loadScope({ signal } = {}) {
    if (compactActor)
      return readCompactPages(
        compactKind,
        {
          season: chosen,
          [compactKind === "player" ? "player" : "team"]: actorId,
          leagues: actorScope,
          include: actorInclude,
          generation: compactGeneration(manifest.value),
        },
        { signal },
      )
        .then((value) => mergeActorPages(value, manifest.value, chosen))
        .catch((error) => {
          if (error.status === 409) void refreshManifest().catch(() => {});
          throw error;
        });
    if (compactMode) return Promise.resolve(emptySeason);
    if (proMatchPage || pagedMatches) return Promise.resolve(emptySeason);
    if (clubTeam)
      return loadClubSeason(manifest.value, clubTeam, chosen, fetch, {
        signal,
      });
    return loadSeason(
      manifest.value,
      chosen,
      fetch,
      leagueOnly
        ? new Set(
            dataFocus !== "europe" || EUROPE_FOCUS_IDS.has(filters.league)
              ? [filters.league]
              : [],
          )
        : dataFocus === "europe" || progressive
          ? EUROPE_FOCUS_IDS
          : null,
      { signal },
    );
  }
  const dataset = useResource(
    seasonKey,
    ({ signal } = {}) =>
      !chosen
        ? null
        : loadData
          ? loadScope({ signal }).then((value) => {
              if (
                !compactMode &&
                !leagueOnly &&
                !proMatchPage &&
                !pagedMatches &&
                !clubTeam
              )
                loadedScopes.add(
                  progressive
                    ? `${chosen}:europe:${versions.europe}`
                    : scopeKey,
                );
              return value;
            })
          : emptySeason,
    !deferSeason,
  );
  const currentSnapshot = {
    key: seasonKey,
    intent: dataIntent,
    scope: JSON.stringify([
      leagueOnly,
      progressive,
      clubTeam,
      pagedMatches,
      proMatchPage,
      compactMode,
      compactKind,
    ]),
    fullScope: !leagueOnly && !progressive,
    manifest: manifest.value,
    data: dataset.value,
  };
  const displayedSnapshot = selectSeasonSnapshot(
    previousDataset.current,
    currentSnapshot,
    !deferSeason,
  );
  useEffect(() => {
    if (currentSnapshot.data) previousDataset.current = currentSnapshot;
  }, [
    dataset.value,
    seasonKey,
    dataIntent,
    currentSnapshot.scope,
    manifest.value,
  ]);
  const displayedDataset = displayedSnapshot.retained
    ? { ...dataset, value: displayedSnapshot.data, loading: false, error: null }
    : dataset;
  const displayedManifest = displayedSnapshot.manifest;
  const refreshing =
    (displayedSnapshot.retained && dataset.loading) || dataset.refreshing;
  const refreshError = displayedSnapshot.retained
    ? dataset.error
    : dataset.refreshError;
  const data = deferSeason ? emptySeason : warmSeason || displayedDataset.value;
  const lastRecoveryManifest = useRef(currentManifest.value);
  useEffect(() => {
    const revalidated = lastRecoveryManifest.current !== currentManifest.value;
    lastRecoveryManifest.current = currentManifest.value;
    // Retry a failed season at the next manifest refresh, even if its digest
    // is unchanged. An error alone never schedules an immediate retry loop.
    if (revalidated && dataset.error) dataset.revalidate().catch(() => {});
  }, [currentManifest.value, dataset.revalidate]);
  useEffect(() => {
    if (!detailId) return;
    return () => setPlayer(null);
  }, [detailId, chosen]);
  // A retained comparison belongs to its original rows. Only a player action
  // on the displayed match may request the new match's owning cohort.
  const detailPlayer = Boolean(
    detailId && typeof player === "string" && player.startsWith(detailId + ":"),
  );
  const selectedMatch = detailPlayer
    ? (deferSeason
        ? cachedResource(`remote-match:${detailId}`)
        : data?.matches.find((match) => match.id === detailId)) || {
        leagueId: initial.get("competition"),
        season: initial.get("sourceSeason"),
      }
    : null;
  const performanceContext = useMemo(() => {
    const leagueIds = directoryScopeIds(
      manifest.value,
      chosen,
      dataFocus,
      filters,
    );
    if (!selectedMatch?.leagueId)
      return { season: chosen, leagueIds, matchOnly: false };
    const sourceSeason = selectedMatch.season || initial.get("sourceSeason"),
      candidates = sourceSeason
        ? [sourceSeason, seasonLabel(sourceSeason)]
        : [chosen];
    // A match link carries its own edition and competition even when the
    // previous directory's championship filter remains in the URL.
    const target = candidates.find((id) =>
      manifest.value?.seasons.some(
        (item) =>
          item.id === id &&
          item.chunks.some(
            (chunk) => chunk.leagueId === selectedMatch.leagueId,
          ),
      ),
    );
    const matchOnly =
      target !== chosen ||
      (leagueIds !== null && !leagueIds.includes(selectedMatch.leagueId));
    return {
      season: target,
      leagueIds: matchOnly ? [selectedMatch.leagueId] : leagueIds,
      matchOnly,
    };
  }, [manifest.value, chosen, dataFocus, filters, selectedMatch, initial]);
  const unavailablePerformance = () =>
    new Error(
      "Les performances de cette compétition ne sont pas disponibles pour cette saison.",
    );
  const compactPerformanceAvailable = supportsCompactRead(
      manifest.value,
      "performance",
    ),
    compactPerformance = compactPerformanceAvailable && Boolean(player),
    performanceParams = {
      season: performanceContext.season,
      appearance: player,
      leagues: compactScope(performanceContext.leagueIds),
      generation: compactGeneration(manifest.value),
    },
    performanceSummary = useResource(
      `compact-performance:${performanceParams.season}:${player}:${performanceParams.leagues}:${performanceParams.generation}`,
      ({ signal }) => {
        if (!performanceContext.season)
          return Promise.reject(unavailablePerformance());
        return readCompact("performance", performanceParams, { signal }).catch(
          (error) => {
            if (error.status === 409) void refreshManifest().catch(() => {});
            throw error;
          },
        );
      },
      compactPerformance,
    );
  const perfIntent =
    !proMode && !compactPerformance && deferSeason && Boolean(selectedMatch);
  const perf = useResource(
    `detail-cohort:${detailId}:${seasonKey}`,
    async () => {
      const match = selectedMatch;
      if (!match?.leagueId) return primeResource(seasonKey, loadScope);
      const target = performanceContext.season;
      if (!target) throw unavailablePerformance();
      const targetScope = () =>
        loadSeason(manifest.value, target, fetch, new Set([match.leagueId]));
      if (performanceContext.matchOnly) return targetScope();
      const scope = await primeResource(seasonKey, loadScope);
      if (!scope.competitions.some((c) => c.id === match.leagueId))
        return targetScope();
      return scope;
    },
    perfIntent,
  );
  const performanceData = useMemo(() => {
    const summary = compactPerformance && performanceSummary.value?.data;
    return summary
      ? {
          ...data,
          appearances: [summary.row],
          matches: summary.match ? [summary.match] : [],
          competitions: summary.competition
            ? [summary.competition]
            : data?.competitions || [],
        }
      : perfIntent && perf.value
        ? perf.value
        : data;
  }, [
    compactPerformance,
    performanceSummary.value,
    data,
    perfIntent,
    perf.value,
  ]);
  const [, settle] = useState(0);
  useEffect(() => {
    if (!progressive || !data) return;
    let active = true;
    primeResource(fullKey, () =>
      loadSeason(manifest.value, chosen, fetch, null).then((value) => {
        loadedScopes.add(scopeKey);
        return value;
      }),
    )
      .then(() => active && settle((n) => n + 1))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [progressive, data, fullKey]);
  const clientManifest = proMode ? displayedManifest : null;
  const clientLeague = proMode ? filters.league : null;
  const clientSeason = proMode ? chosen : null;
  const client = useMemo(
    () =>
      data
        ? proMode
          ? new ProFootballDataClient({
              data,
              manifest: displayedManifest,
              leagueId: filters.league,
              season: chosen,
            })
          : new FootballDataClient({ data })
        : null,
    [data, proMode, clientManifest, clientLeague, clientSeason],
  );
  const status = useResource(`status:${client?.id}`, async () => {
    if (!client) return false;
    await (loadData && !deferSeason && !pagedMatches && !compactMode
      ? client.init()
      : client.checkStatus());
    return client.configured;
  });
  const seasonCompetitions = useMemo(() => {
    const season = catalogueManifest?.seasons.find(
      (item) => item.id === chosen,
    );
    if (!season) return data?.competitions || [];
    const ids = new Set(season.chunks.map((chunk) => chunk.leagueId));
    const byId = new Map(
      (catalogueManifest.competitions || [])
        .filter((c) => ids.has(c.id))
        .map((c) => [c.id, c]),
    );
    // A loaded competition has more precise, season-specific coverage counts.
    for (const item of data?.competitions || []) byId.set(item.id, item);
    return enrichSeasonCompetitions([...byId.values()], client?.catalog).sort(
      (a, b) => (a.name || "").localeCompare(b.name || "", "fr"),
    );
  }, [catalogueManifest, chosen, data, client, status.value, status.loading]);
  // The navbar search and the competition directory ignore the selected
  // scope: they always see every competition of the season.
  const allCatalog = useMemo(() => {
    const byId = new Map();
    for (const c of [
      ...(client?.catalog || data?.competitions || []),
      ...seasonCompetitions,
    ])
      if (c?.id && !byId.has(c.id)) byId.set(c.id, c);
    return [...byId.values()];
  }, [client, data, seasonCompetitions, status.value, status.loading]);
  const searchDataKey = `season:${chosen}:all:${versions.all}:all:full`;
  function searchData() {
    const fullSeason =
      !proMatchPage &&
      !pagedMatches &&
      !compactMode &&
      loadData &&
      !deferSeason &&
      !clubTeam &&
      dataFocus === "all" &&
      !leagueOnly &&
      !progressive;
    if (fullSeason && data && !displayedSnapshot.retained)
      return Promise.resolve(data);
    return primeResource(searchDataKey, () =>
      loadSeason(manifest.value, chosen, fetch, null).then((value) => {
        loadedScopes.add(`${chosen}:all:${versions.all}`);
        return value;
      }),
    );
  }
  const competitions = useMemo(
    () =>
      seasonCompetitions.filter((c) => focus !== "europe" || inEuropeFocus(c)),
    [seasonCompetitions, focus],
  );
  const catalog = useMemo(
    () =>
      (client?.catalog || data?.competitions || []).filter(
        (c) => focus !== "europe" || inEuropeFocus(c),
      ),
    [client, data, focus, status.value, status.loading],
  );
  const matchIndex = useMemo(
    () => new Map((data?.matches || []).map((m) => [m.id, m])),
    [data],
  );
  const scope = useMemo(
    () => ({
      ...filters,
      season: chosen,
      test: advancedTest(filters.advanced, matchIndex),
      advancedKey: advancedKey(filters.advanced),
    }),
    [filters, chosen, matchIndex],
  );
  // Inputs update at once; the filtered lists follow in a deferred render.
  const deferredScope = useDeferredValue(scope);
  const lastSearch = useRef(null),
    recentRows = useRef({ data: null, entries: new Map() });
  const rows = useMemo(() => {
    if (!data) return [];
    const query = normalizeText(deferredScope.query).trim(),
      base = [
        deferredScope.league,
        deferredScope.season,
        deferredScope.minutes,
        deferredScope.match,
        deferredScope.advancedKey,
      ].join("|"),
      recent = recentRows.current;
    // Going back to a recent filter returns the same list (and its sorts).
    if (recent.data !== data) {
      recent.data = data;
      recent.entries.clear();
    }
    const signature = `${base}|${query}`;
    if (recent.entries.has(signature)) return recent.entries.get(signature);
    // Typing more letters only narrows the previous result, so each new
    // letter filters the last matches instead of the whole season.
    const previous = lastSearch.current,
      source =
        previous?.data === data &&
        previous.base === base &&
        previous.query &&
        query.includes(previous.query)
          ? previous.rows
          : data.appearances,
      result = filterAppearances(source, deferredScope);
    lastSearch.current = { data, base, query, rows: result };
    recent.entries.set(signature, result);
    if (recent.entries.size > 8)
      recent.entries.delete(recent.entries.keys().next().value);
    return result;
  }, [data, deferredScope]);
  // A player's season and its peers share the active filters, but not the
  // search text or the selected single-match filter. Compute only on demand.
  const seasonPlayerScope = useMemo(() => {
    let value;
    return () =>
      (value ??= data
        ? filterSeasonPlayerScope(data.appearances, deferredScope)
        : []);
  }, [data, deferredScope]);
  // Computed on first use: the players pages never read the match list.
  const matchList = useMemo(() => {
    let value;
    return () =>
      (value ??= data
        ? filterMatches(data.matches, data.appearances, deferredScope)
        : []);
  }, [data, deferredScope]);
  // Index of every performance by id, filled in idle time after a load and
  // completed at once if a card opens before it is ready.
  const appearanceIndex = useMemo(() => {
    const list = performanceData?.appearances || [],
      index = new Map();
    let next = 0;
    const fill = (budget = Infinity) => {
      const stop = performance.now() + budget;
      while (next < list.length) {
        const end = Math.min(next + 5000, list.length);
        for (; next < end; next++) index.set(list[next].id, list[next]);
        if (performance.now() > stop) break;
      }
      return next >= list.length;
    };
    const get = () => (fill(), index);
    get.fill = fill;
    return get;
  }, [performanceData]);
  useEffect(() => {
    if (proMode || !loadData || !data || deferSeason) return;
    const cancelProfiles = warmProfiles(data.appearances),
      idle =
        window.requestIdleCallback ||
        ((callback) =>
          setTimeout(() => callback({ timeRemaining: () => 8 }), 50)),
      cancelIdle = window.cancelIdleCallback || clearTimeout;
    let handle;
    const step = (deadline) => {
      if (
        !appearanceIndex.fill(
          Math.max(4, Math.min(12, deadline.timeRemaining())),
        )
      )
        handle = idle(step, { timeout: 2000 });
    };
    handle = idle(step, { timeout: 2000 });
    return () => {
      cancelProfiles();
      cancelIdle(handle);
    };
  }, [data, loadData, appearanceIndex, proMode]);
  function changeSeason(value) {
    updateQuery({
      season: value,
      league: "",
      leagues: "",
      ...(proMode ? { v: "" } : {}),
    });
    setMatchFilter("all");
    setComparison([]);
    setPlayer(null);
  }
  const href = (page, params = {}) => {
    const targetLeague = params.competition || params.league || filters.league;
    const targetSeason = params.sourceSeason || params.season || chosen;
    const candidates =
      proMode && seasonPage(page) === "/matchs"
        ? (manifest.value?.editions || []).filter(
            (edition) =>
              edition.season === targetSeason &&
              (!targetLeague ||
                targetLeague === "all" ||
                edition.leagueId === targetLeague),
          )
        : [];
    const targetVersion =
      candidates.length === 1 ? candidates[0].representationToken : null;
    const query = new URLSearchParams({
      season: chosen || "",
      focus,
      ...(targetVersion ? { v: targetVersion } : {}),
      ...(urlFilters.query ? { q: urlFilters.query } : {}),
      ...(urlFilters.league !== "all" ? { league: urlFilters.league } : {}),
      ...(urlFilters.minutes !== 1
        ? { minutes: String(urlFilters.minutes) }
        : {}),
      ...(urlFilters.basis !== "perMatch" ? { basis: urlFilters.basis } : {}),
      ...(seasonPage(page) === "/joueurs"
        ? {
            ranking: urlFilters.ranking,
            leagues: urlFilters.leagues.join(","),
            playersView: initial.get("playersView") || "",
          }
        : {}),
      ...Object.fromEntries(
        Object.entries(advancedQuery(urlFilters.advanced)).filter(
          ([, value]) => value,
        ),
      ),
      ...params,
    });
    // An emptied parameter means "absent", not "empty value".
    for (const [key, value] of [...query]) if (value === "") query.delete(key);
    return `${page}${query.size ? "?" + query : ""}`;
  };
  // Site navigation restores the destination page's selection. Links to a
  // specific match, player or club keep using href with their source context.
  const navigationHref = (page) => {
    const destination = seasonPage(page);
    const saved =
      destination === currentPage ? chosen : pageSeasons[destination];
    const enteringPlayers = destination === "/joueurs" && !playerDirectory;
    return href(page, {
      season: validSeason(saved) ? saved : manifest.value?.defaultSeason || "",
      ...(enteringPlayers
        ? {
            focus: "europe",
            league: "",
            leagues: "",
            ranking: "",
            playersView: "",
            q: "",
          }
        : {}),
    });
  };
  function changeFocus(next) {
    const value = next === "europe" ? "europe" : "all";
    const params = new URLSearchParams(window.location.search);
    const league = params.get("league");
    updateQuery({
      focus: value,
      leagues: "",
      ...(value === "europe" && league && !EUROPE_FOCUS_IDS.has(league)
        ? { league: "" }
        : {}),
      ...(value === "europe" &&
      window.location.pathname.startsWith("/competitions") &&
      params.get("id") &&
      !EUROPE_FOCUS_IDS.has(params.get("id")) &&
      !inEuropeFocus({ id: params.get("id") })
        ? { id: "" }
        : {}),
    });
    savePreferences({ focus: value });
    setComparison([]);
    setPlayer(null);
    setMatchFilter("all");
  }
  const comparison = selectedPerformances.map((row) => row.id);
  function setComparison(next) {
    setSelectedPerformances((previous) => {
      const ids =
        typeof next === "function" ? next(previous.map((row) => row.id)) : next;
      return ids
        .map(
          (id) =>
            previous.find((row) => row.id === id) || appearanceIndex().get(id),
        )
        .filter(Boolean);
    });
  }
  function toggle(id) {
    setComparison((list) =>
      list.includes(id)
        ? list.filter((x) => x !== id)
        : list.length < 3
          ? [...list, id]
          : (setNotice("La comparaison est limitée à3 performances."), list),
    );
  }
  async function exportRows(mode = "total", selectedRows) {
    if (
      compactMode &&
      compactKind === "players" &&
      selectedRows === undefined
    ) {
      try {
        const params = playerReadParams(
            {
              manifest: manifest.value,
              season: chosen,
              focus,
              filters: { ...filters, basis: mode },
            },
            {
              limit: 100,
              ranking: playerDirectoryRanking(
                filters,
                playerDirectory &&
                  playerDirectoryView(initial.get("playersView")) === "table",
              ),
            },
          ),
          result = await readCompactPages("players", params),
          allPlayers = result.pages.flatMap((page) => page.players);
        download(
          "statarena-joueurs.csv",
          directoryCSV(allPlayers, mode),
          "text/csv;charset=utf-8",
        );
      } catch (error) {
        setNotice(`Export indisponible : ${error.message}`);
      }
      return;
    }
    selectedRows ||= rows;
    const fields = [
      "date",
      "matchId",
      "playerId",
      "name",
      "team",
      "league",
      "season",
      "minutes",
      "rating",
      "goals",
      "assists",
      "xg",
      "xa",
      "shots",
      "chancesCreated",
      "defensiveActions",
      "saves",
      "goalsPrevented",
    ];
    download(
      "statarena-performances.csv",
      csvString(
        fields,
        selectedRows.map((r) =>
          fields.map((key) =>
            mode === "per90" &&
            ![
              "date",
              "matchId",
              "playerId",
              "name",
              "team",
              "league",
              "season",
              "minutes",
              "rating",
            ].includes(key)
              ? per90(r[key], r.minutes)
              : key === "season"
                ? seasonLabel(r[key])
                : r[key],
          ),
        ),
      ),
      "text/csv;charset=utf-8",
    );
  }
  useEffect(() => {
    if (!preferencesReady || !chosen) return;
    setPageSeasons((previous) =>
      previous[currentPage] === chosen
        ? previous
        : { ...previous, [currentPage]: chosen },
    );
    if (initial.get("season") !== chosen) updateQuery({ season: chosen });
  }, [preferencesReady, chosen, initial, currentPage]);
  useEffect(() => {
    if (!preferencesReady) return;
    try {
      window.sessionStorage.setItem(
        PAGE_SEASONS_KEY,
        JSON.stringify(pageSeasons),
      );
    } catch {}
  }, [preferencesReady, pageSeasons]);
  const value = {
    data,
    pro: proMode,
    compactMode,
    compactKind,
    pagedMatches,
    refreshManifest,
    refreshing: Boolean(refreshing),
    refreshError,
    focus,
    changeFocus,
    competitions,
    catalog,
    allCatalog,
    allCompetitions: seasonCompetitions,
    searchData,
    searchDataKey,
    preferences,
    preferencesReady,
    savePreferences,
    manifest: displayedManifest,
    season: chosen,
    changeSeason,
    filters,
    setFilters,
    rows,
    get seasonPlayerScope() {
      return seasonPlayerScope();
    },
    get matches() {
      return matchList();
    },
    partial: progressive && Boolean(data),
    client,
    configured: status.value === true,
    statusKnown: !status.loading,
    href,
    navigationHref,
    comparison,
    get comparisonRows() {
      return selectedPerformances.map(
        (row) => appearanceIndex().get(row.id) || row,
      );
    },
    setComparison,
    toggle,
    performanceData,
    compactPerformanceAvailable,
    performanceSummary: compactPerformance ? performanceSummary : null,
    deferredPerformance: compactPerformance
      ? performanceSummary
      : perfIntent
        ? perf
        : detailPlayer
          ? { loading: false }
          : null,
    get byAppearance() {
      return appearanceIndex();
    },
    player,
    setPlayer,
    comparing,
    setComparing,
    notice,
    setNotice,
    exportRows,
  };
  return (
    <Context.Provider value={value}>
      <AsyncState
        resource={manifest}
        loading={<LoadingPage href={navigationHref} />}
      >
        {() => (
          <AsyncState
            resource={deferSeason ? { value: data } : displayedDataset}
            loading={<LoadingPage href={navigationHref} />}
          >
            {(value) =>
              value ? (
                <>
                  {refreshing && (
                    <div role="status" className="notice">
                      Actualisation des données…
                    </div>
                  )}
                  {refreshError && (
                    <div role="alert" className="notice notice-warning">
                      La dernière version reste affichée. {refreshError}{" "}
                      <button
                        className="button button-secondary"
                        onClick={dataset.retry}
                      >
                        Réessayer
                      </button>
                    </div>
                  )}
                  {children}
                </>
              ) : (
                <div role="status">Chargement de la saison…</div>
              )
            }
          </AsyncState>
        )}
      </AsyncState>
    </Context.Provider>
  );
}
