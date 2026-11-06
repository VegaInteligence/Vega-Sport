"use client";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import React, { useState, useMemo, useDeferredValue } from "react";
import Layout from "../components/Layout.jsx";
import { useFootball } from "../hooks/FootballContext.jsx";
import PlayerSeasonProfile from "../components/PlayerSeasonProfile.jsx";
import PlayerWorkspace from "../components/PlayerWorkspace.jsx";
import { ResearchComparisonTray } from "../components/ResearchUI.jsx";
import PlayerMatchesPage from "./PlayerMatchesPage.jsx";
import {
  aggregateSeason,
  aggregateSeasonPlayers,
} from "../services/season-player.js";
import {
  PLAYER_RANKINGS,
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
  const f = useFootball(),
    [manualSort, setManualSort] = useState({
      key: "rating",
      direction: "desc",
    });
  const filters = useDeferredValue(f.filters);
  const ranking = f.filters.ranking;
  const sort = PLAYER_RANKINGS[ranking]?.sort || manualSort;
  const setSort = (next) => {
    setManualSort(next);
    if (ranking) f.setFilters((current) => ({ ...current, ranking: "" }));
  };
  const mode = f.filters.basis;
  const setMode = (basis) => f.setFilters((v) => ({ ...v, basis }));
  const id = params.get("id");
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
  const profiles = useMemo(
    () => aggregateSeasonPlayers(contextRows),
    [contextRows],
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
      ranking
        ? rankSeasonPlayers(
            searchPlayerAverages(eligible, filters.query),
            ranking,
          )
        : sortPlayerAverages(
            searchPlayerAverages(eligible, filters.query),
            sort,
          ),
    [eligible, filters.query, sort, ranking],
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
  // Old profile links still lead to the match list with their original filters.
  if (id && profileView === "matches")
    return (
      <PlayerMatchesPage currentRows={aggregateSeason(playerRows, id).rows} />
    );
  return (
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
      {id && (
        <PlayerSeasonProfile
          id={id}
          rows={playerRows}
          scopeRows={contextRows}
          profiles={profiles}
        />
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
              ranking: value,
              basis: value ? "total" : current.basis,
            }))
          }
          mode={mode}
          onMode={setMode}
        />
      )}
      <ResearchComparisonTray performanceComparison={Boolean(id)} />
    </Layout>
  );
}
