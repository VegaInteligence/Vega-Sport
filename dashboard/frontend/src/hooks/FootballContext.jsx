"use client";
import { usePathname, useSearchParams } from "next/navigation";
import React, {
  createContext,
  useContext,
  useDeferredValue,
  useMemo,
  useRef,
  useState,
  useEffect,
} from "react";
import { loadSeason } from "../season_data.js";
import { dataUrl } from "../data-url.js";
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
} from "../services/resources.js";
import { warmProfiles } from "../services/player-profile.js";
import { filterSeasonPlayerScope } from "../services/season-player.js";
import {
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
import { enrichSeasonCompetitions } from "../services/competition-identity.js";
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
  const [matchFilter, setMatchFilter] = useState("all");
  const [preferences, setPreferences] = useState({
    focus: "europe",
    defaultSeason: "",
    favoriteLeagueIds: [],
    onboardingComplete: false,
  });
  const [pageSeasons, setPageSeasons] = useState({});
  const [preferencesReady, setPreferencesReady] = useState(false);
  const focus =
    initial.get("focus") === "europe"
      ? "europe"
      : initial.get("focus") === "all"
        ? "all"
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
  const pathname = usePathname() || "",
    playerScope = pathname.startsWith("/joueurs"),
    // The home page has no list filter: the navbar search navigates instead.
    homeScope = pathname === "/" || pathname === "";
  const currentPage = seasonPage(pathname);
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
  const [comparison, setComparison] = useState([]),
    [player, setPlayer] = useState(null),
    [comparing, setComparing] = useState(false),
    [notice, setNotice] = useState("");
  const manifest = useResource("manifest", () =>
    json(dataUrl("dashboard-manifest.json")),
  );
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
  const dataFocus = clubDetail ? "all" : focus;
  const scopeKey = `${chosen}:${dataFocus}`,
    leagueOnly =
      !pathname.startsWith("/clubs") &&
      filters.league !== "all" &&
      !loadedScopes.has(scopeKey),
    // "All competitions" first shows the Top 7 + UEFA chunks (a quarter of
    // the bytes), then merges the other leagues loaded in the background.
    // Pages opened on a specific record wait for the full scope instead.
    progressive =
      loadData &&
      dataFocus === "all" &&
      (pathname.startsWith("/clubs") || filters.league === "all") &&
      !initial.get("id") &&
      !loadedScopes.has(scopeKey),
    fullKey = `season:${chosen}:${dataFocus}:all:full`;
  const dataset = useResource(
    progressive
      ? `season:${chosen}:europe:all:full`
      : `season:${chosen}:${loadData ? `${dataFocus}:${leagueOnly ? filters.league : "all"}:full` : "catalog"}`,
    () =>
      chosen
        ? loadData
          ? loadSeason(
              manifest.value,
              chosen,
              fetch,
              leagueOnly
                ? new Set(
                    dataFocus !== "europe" ||
                      EUROPE_FOCUS_IDS.has(filters.league)
                      ? [filters.league]
                      : [],
                  )
                : dataFocus === "europe" || progressive
                  ? EUROPE_FOCUS_IDS
                  : null,
            ).then((value) => {
              if (!leagueOnly)
                loadedScopes.add(progressive ? `${chosen}:europe` : scopeKey);
              return value;
            })
          : Promise.resolve({
              meta: { retrievedAt: manifest.value.retrievedAt },
              competitions: [],
              matches: [],
              appearances: [],
              fixtures: [],
            })
        : Promise.resolve(null),
  );
  const data = dataset.value;
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
  const client = useMemo(
    () => (data ? new FootballDataClient({ data }) : null),
    [data],
  );
  const status = useResource(`status:${client?.id}`, async () => {
    if (!client) return false;
    await (loadData ? client.init() : client.checkStatus());
    return client.configured;
  });
  const seasonCompetitions = useMemo(
    () =>
      manifest.value?.storage === "json-packed"
        ? enrichSeasonCompetitions(
            manifest.value.seasons
              .find((s) => s.id === chosen)
              ?.chunks.flatMap((c) => c.competitions) || [],
            client?.catalog,
          ).sort((a, b) => (a.name || "").localeCompare(b.name || "", "fr"))
        : data?.competitions || [],
    [manifest.value, chosen, data, client, status.value, status.loading],
  );
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
  const fullSeason =
    loadData && dataFocus === "all" && !leagueOnly && !progressive;
  function searchData() {
    if (fullSeason && data) return Promise.resolve(data);
    return primeResource(`season:${chosen}:all:all:full`, () =>
      loadSeason(manifest.value, chosen, fetch, null).then((value) => {
        loadedScopes.add(`${chosen}:all`);
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
    const list = data?.appearances || [],
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
  }, [data]);
  useEffect(() => {
    if (!loadData || !data) return;
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
  }, [data, loadData, appearanceIndex]);
  function changeSeason(value) {
    updateQuery({ season: value, league: "", leagues: "" });
    setMatchFilter("all");
    setComparison([]);
    setPlayer(null);
  }
  const href = (page, params = {}) => {
    const query = new URLSearchParams({
      season: chosen || "",
      focus,
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
    return href(page, {
      season: validSeason(saved) ? saved : manifest.value?.defaultSeason || "",
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
  function toggle(id) {
    setComparison((list) =>
      list.includes(id)
        ? list.filter((x) => x !== id)
        : list.length < 3
          ? [...list, id]
          : (setNotice("La comparaison est limitée à3 performances."), list),
    );
  }
  function exportRows(mode = "total", selectedRows = rows) {
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
    focus,
    changeFocus,
    competitions,
    catalog,
    allCatalog,
    allCompetitions: seasonCompetitions,
    searchData,
    preferences,
    preferencesReady,
    savePreferences,
    manifest: manifest.value,
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
    setComparison,
    toggle,
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
            resource={dataset}
            loading={<LoadingPage href={navigationHref} />}
          >
            {(value) =>
              value ? (
                children
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
