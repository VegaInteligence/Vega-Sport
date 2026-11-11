"use client";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import React, {
  lazy,
  Suspense,
  useState,
  useMemo,
  useDeferredValue,
  useCallback,
} from "react";
import Layout from "../components/Layout.jsx";
import { FootballContext, useFootball } from "../hooks/FootballContext.jsx";
const PlayerSeasonProfile = lazy(
  () => import("../components/PlayerSeasonProfile.jsx"),
);
import PlayerWorkspace from "../components/PlayerWorkspace.jsx";
import PlayerMatchesPage from "./PlayerMatchesPage.jsx";
import { ResearchComparisonTray } from "../components/ResearchUI.jsx";
import useCompactRead from "../hooks/useCompactRead.js";
import {
  cohortGroupParams,
  compactGeneration,
  compactQuery,
  playerReadParams,
} from "../services/compact-reads.js";
import {
  aggregateSeason,
  aggregateSeasonPlayers,
  MIN_SEASON_MINUTES,
} from "../services/season-player.js";
import {
  PLAYER_RANKINGS,
  playerDirectoryRanking,
  playerDirectoryView,
  rankSeasonPlayers,
} from "../services/player-leaderboard.js";
import {
  filterPlayerAverages,
  playerAverage,
  playerDirectoryScope,
  searchPlayerAverages,
  sortPlayerAverages,
} from "../services/player-directory.js";
import { EMPTY_ADVANCED } from "../services/advanced-filters.js";

const OTHER_PROFILE_VIEWS = [
  "stats",
  "advanced",
  "games",
  "similar",
  "compare",
  "evolution",
  "physical",
  "projection",
  "matches",
];

// The pages of the directory's cohort read at once, after the first.
const DIRECTORY_COHORT_PAGES = 4;

export default function PlayersPage() {
  const params = useSearchParams();
  const profileView = params.get("playerView") || "overview";
  const directoryView = playerDirectoryView(params.get("playersView"));
  const f = useFootball(),
    [manualSort, setManualSort] = useState({
      key: "rating",
      direction: "desc",
    }),
    [directoryPage, setDirectoryPage] = useState({ key: "", page: 1 }),
    [comparisonIntent, setComparisonIntent] = useState("");
  const id = params.get("id");
  const deferredFilters = useDeferredValue(f.filters);
  const filters = useMemo(
    () =>
      id
        ? {
            ...deferredFilters,
            minutes: 0,
            advanced: {
              ...EMPTY_ADVANCED,
              from: deferredFilters.advanced.from,
              to: deferredFilters.advanced.to,
            },
          }
        : deferredFilters,
    [id, deferredFilters],
  );
  const overview = Boolean(id && !OTHER_PROFILE_VIEWS.includes(profileView));
  const ranking = playerDirectoryRanking(
    f.filters,
    !id && directoryView === "table",
  );
  const sort = PLAYER_RANKINGS[ranking]?.sort || manualSort;
  const setSort = (next) => {
    setManualSort(next);
    if (ranking) f.setFilters((current) => ({ ...current, ranking: "all" }));
  };
  const mode = f.filters.basis;
  const setMode = (basis) => f.setFilters((v) => ({ ...v, basis }));
  const queryKey = compactQuery({
      ...playerReadParams(f, { sort, ranking }),
      page: undefined,
      generation: undefined,
    }),
    requestedPage = directoryPage.key === queryKey ? directoryPage.page : 1,
    directory = useCompactRead(
      "players",
      playerReadParams(f, { sort, ranking, page: requestedPage }),
      {
        enabled: f.compactMode && !id && directoryView === "table",
        refreshManifest: f.refreshManifest,
      },
    );
  const matchIndex = useMemo(
    () => new Map(f.data.matches.map((match) => [match.id, match])),
    [f.data.matches],
  );
  const contextRows = useMemo(
    () =>
      playerDirectoryScope(f.data.appearances, f.season, filters, matchIndex),
    [
      f.data.appearances,
      f.season,
      matchIndex,
      filters.league,
      filters.match,
      filters.advanced.role,
      filters.advanced.venue,
      filters.advanced.result,
      filters.advanced.from,
      filters.advanced.to,
      filters.leagues,
    ],
  );
  const subject = useMemo(
    () => (id ? aggregateSeason(contextRows, id) : null),
    [contextRows, id],
  );
  const radarLeagues = subject?.rows.every(
    ({ leagueId }) =>
      leagueId && (!f.compactMode || /^l_[A-Za-z0-9]{6}$/.test(leagueId)),
  )
    ? subject.leagueIds
    : undefined;
  // Overview, Stats avancées and similar profiles rank against one cohort:
  // the whole position group in the selected competitions.
  const localProfiles = useMemo(
    () => aggregateSeasonPlayers(contextRows),
    [contextRows],
  );
  const radarGroup = cohortGroupParams(
    f.manifest,
    subject?.minutes >= MIN_SEASON_MINUTES ? subject.role?.group : undefined,
  );
  const radarEligible = Boolean(
    Object.keys(radarGroup).length && radarLeagues?.length,
  );
  const cohortParams = playerReadParams(id ? { ...f, filters } : f, {
    cohort: true,
    limit: 100,
  });
  if (overview) {
    Object.assign(cohortParams, radarGroup);
  } else if (id && profileView !== "compare") {
    // Read every peer in the actor's complete position group, without sampling.
    Object.assign(
      cohortParams,
      cohortGroupParams(f.manifest, subject?.role?.group),
    );
  }
  const comparisonKey = `${id || "directory"}:${compactQuery(cohortParams)}`;
  const requestComparisons = useCallback(
    () => setComparisonIntent(comparisonKey),
    [comparisonKey],
  );
  const needsCohort =
    f.compactMode &&
    (id
      ? // The rail's Vega index ranks the player on every tab.
        [
          "similar",
          "compare",
          "advanced",
          "evolution",
          "games",
          "physical",
          "projection",
        ].includes(profileView) ||
        (((overview && radarEligible) || profileView === "stats") &&
          comparisonIntent === comparisonKey)
      : ["explore", "indices"].includes(directoryView));
  // Tabs built on the cohort; elsewhere it only feeds the rail's Vega index.
  const cohortTab = ["similar", "compare", "advanced", "stats"].includes(
    profileView,
  );
  const cohort = useCompactRead("players", cohortParams, {
    enabled: needsCohort,
    allPages: true,
    // Profile cohorts (and the all-positions comparison) read a bounded
    // pair of pages at a time. The directory's cohort is every player of the
    // selection: its pages are read four at a time.
    parallelPages: id ? true : DIRECTORY_COHORT_PAGES,
    refreshManifest: f.refreshManifest,
    // A cohort that names no publication is asked again at each new one: the API
    // answers that it is unchanged, or gives the new one.
    clock: cohortParams.generation ? "" : compactGeneration(f.manifest),
  });
  const profiles = useMemo(
    () =>
      f.compactMode
        ? cohort.value?.data.players.map((row) => row.profile) || []
        : localProfiles,
    [f.compactMode, cohort.value, localProfiles],
  );
  const averages = useMemo(
    () =>
      profiles.map((profile) => {
        const value = playerAverage(profile, mode);
        return {
          ...value,
          finishingDelta:
            Number.isFinite(value.goals) && Number.isFinite(value.xg)
              ? value.goals - value.xg
              : null,
          totals: {
            goals: profile.stats.goals?.count ? profile.stats.goals.sum : null,
            assists: profile.stats.assists?.count
              ? profile.stats.assists.sum
              : null,
            xg: profile.stats.xg?.count ? profile.stats.xg.sum : null,
          },
        };
      }),
    [profiles, mode],
  );
  const eligible = useMemo(
    () => filterPlayerAverages(averages, filters),
    [averages, filters.minutes, filters.advanced],
  );
  const directoryRows = useMemo(
    () =>
      f.compactMode && !id && directoryView === "table"
        ? directory.value?.data.players || []
        : ranking
          ? rankSeasonPlayers(
              searchPlayerAverages(eligible, filters.query),
              ranking,
            )
          : sortPlayerAverages(
              searchPlayerAverages(eligible, filters.query),
              sort,
            ),
    [
      eligible,
      filters.query,
      sort,
      ranking,
      f.compactMode,
      id,
      directoryView,
      directory.value,
    ],
  );
  const playerRows = useMemo(() => {
    if (!id) return [];
    return contextRows.filter((row) => row.playerId === id);
  }, [id, contextRows]);
  const displayContext = useMemo(() => {
    const profileFilters = id ? { filters } : {};
    if (!f.compactMode)
      return id ? Object.assign(Object.create(f), profileFilters) : f;
    const teams = [
      ...new Map(
        [
          ...(f.data.teams || []),
          ...(directory.value?.data.teams || []),
          ...(cohort.value?.data.teams || []),
        ].map((team) => [team.id, team]),
      ).values(),
    ];
    return Object.assign(Object.create(f), {
      ...profileFilters,
      data: { ...f.data, teams },
    });
  }, [f, id, filters, directory.value, cohort.value]);
  // Preserve old profile links while the dedicated route owns new match lists.
  if (id && profileView === "matches")
    return (
      <PlayerMatchesPage currentRows={aggregateSeason(playerRows, id).rows} />
    );
  return (
    <FootballContext.Provider value={displayContext}>
      <Layout
        path="/joueurs/"
        title="Joueurs"
        filters={!id}
        hideHeading={Boolean(id)}
        filterKind="players"
        performanceComparison={Boolean(id)}
      >
        {id && (
          <Link
            className="inline-link competition-back"
            href={f.href("/joueurs/", { id: "", q: "" })}
          >
            ← Tous les joueurs
          </Link>
        )}
        {id && !overview && cohortTab && needsCohort && cohort.loading && (
          <p role="status" className="notice">
            Chargement des comparaisons de saison…
          </p>
        )}
        {id && !overview && cohortTab && needsCohort && cohort.error && (
          <p role="alert" className="notice notice-warning">
            Comparaisons indisponibles. {cohort.error}{" "}
            <button onClick={cohort.retry}>Réessayer</button>
          </p>
        )}
        {id && (
          <Suspense
            fallback={
              <p data-page-loading="" role="status">
                Chargement du profil…
              </p>
            }
          >
            <PlayerSeasonProfile
              id={id}
              rows={playerRows}
              scopeRows={contextRows}
              profiles={profiles}
              comparisonsReady={
                !f.compactMode ||
                (overview && !radarEligible) ||
                Boolean(cohort.value)
              }
              onNeedComparisons={requestComparisons}
              radarComparison={
                overview && f.compactMode && radarEligible ? cohort : null
              }
            />
          </Suspense>
        )}
        {!id && (
          <PlayerWorkspace
            profiles={profiles}
            rows={directoryRows}
            players={averages}
            sort={sort}
            onSort={setSort}
            ranking={ranking}
            onRanking={(value) =>
              f.setFilters((current) => ({
                ...current,
                ranking: value || "all",
                basis: value && value !== "rating" ? "total" : current.basis,
              }))
            }
            mode={mode}
            onMode={setMode}
            pagination={f.compactMode ? directory.value?.pagination : undefined}
            onPage={
              f.compactMode
                ? (value) => setDirectoryPage({ key: queryKey, page: value })
                : undefined
            }
            resource={
              f.compactMode
                ? directoryView === "table"
                  ? directory
                  : ["explore", "indices"].includes(directoryView)
                    ? cohort
                    : null
                : null
            }
          />
        )}
        <ResearchComparisonTray performanceComparison={Boolean(id)} />
      </Layout>
    </FootballContext.Provider>
  );
}
