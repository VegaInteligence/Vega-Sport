"use client";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import React, {
  lazy,
  Suspense,
  useState,
  useMemo,
  useDeferredValue,
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
import { compactQuery, playerReadParams } from "../services/compact-reads.js";
import {
  aggregateSeason,
  aggregateSeasonPlayers,
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
export default function PlayersPage() {
  const params = useSearchParams();
  const profileView = params.get("playerView") || "overview";
  const directoryView = playerDirectoryView(params.get("playersView"));
  const f = useFootball(),
    [manualSort, setManualSort] = useState({
      key: "rating",
      direction: "desc",
    }),
    [directoryPage, setDirectoryPage] = useState({ key: "", page: 1 });
  const filters = useDeferredValue(f.filters);
  const id = params.get("id");
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
    ),
    cohortParams = playerReadParams(f, { cohort: true, limit: 100 }),
    needsCohort =
      f.compactMode &&
      (id
        ? ["overview", "stats", "similar", "compare"].includes(profileView)
        : ["explore", "indices"].includes(directoryView)),
    cohort = useCompactRead("players", cohortParams, {
      enabled: needsCohort,
      allPages: true,
      refreshManifest: f.refreshManifest,
    });
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
  const localProfiles = useMemo(
    () => aggregateSeasonPlayers(contextRows),
    [contextRows],
  );
  const profiles = useMemo(
    () =>
      f.compactMode && cohort.value
        ? cohort.value.data.players.map((row) => row.profile)
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
  const scopeRows = useMemo(() => {
    if (!id) return [];
    const ids = new Set(eligible.map((row) => row.playerId));
    return contextRows.filter((row) => ids.has(row.playerId));
  }, [id, contextRows, eligible]);
  const playerRows = useMemo(
    () => (id ? scopeRows.filter((row) => row.playerId === id) : []),
    [id, scopeRows],
  );
  const displayContext = useMemo(() => {
    if (!f.compactMode) return f;
    const teams = [
      ...new Map(
        [
          ...(f.data.teams || []),
          ...(directory.value?.data.teams || []),
          ...(cohort.value?.data.teams || []),
        ].map((team) => [team.id, team]),
      ).values(),
    ];
    return Object.assign(Object.create(f), { data: { ...f.data, teams } });
  }, [f, directory.value, cohort.value]);
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
        filters
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
        {id && needsCohort && cohort.loading && (
          <p role="status" className="notice">
            Chargement des comparaisons de saison…
          </p>
        )}
        {id && needsCohort && cohort.error && (
          <p role="alert" className="notice notice-warning">
            Comparaisons indisponibles. {cohort.error}{" "}
            <button onClick={cohort.retry}>Réessayer</button>
          </p>
        )}
        {id && (
          <Suspense fallback={<p role="status">Chargement du profil…</p>}>
            <PlayerSeasonProfile
              id={id}
              rows={playerRows}
              scopeRows={contextRows}
              profiles={profiles}
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
