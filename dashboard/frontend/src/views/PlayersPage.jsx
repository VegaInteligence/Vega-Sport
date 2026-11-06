"use client";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import React, { useState, useMemo, useDeferredValue } from "react";
import Layout from "../components/Layout.jsx";
import { useFootball } from "../hooks/FootballContext.jsx";
import { useResearch } from "../hooks/ResearchContext.jsx";
import { date, number } from "../services/format.js";
import { sortRows, per90 } from "../model.js";
import PlayerSeasonProfile from "../components/PlayerSeasonProfile.jsx";
import PlayerWorkspace from "../components/PlayerWorkspace.jsx";
import PlayerFixture from "../components/PlayerFixture.jsx";
import { ResearchComparisonTray } from "../components/ResearchUI.jsx";
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
import { Card, Rating, Segments, Empty } from "../components/UI.jsx";
export default function PlayersPage() {
  const research = useResearch(),
    params = useSearchParams();
  const profileView = params.get("playerView") || "overview";
  const f = useFootball(),
    [manualSort, setManualSort] = useState({
      key: "rating",
      direction: "desc",
    }),
    [matchSort, setMatchSort] = useState({ key: "date", direction: "desc" });
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
  const rows = useMemo(
    () =>
      id && profileView === "matches"
        ? sortRows(
            aggregateSeason(playerRows, id).rows,
            matchSort.key,
            matchSort.direction,
            matchSort.key === "date" ? "total" : mode,
          )
        : [],
    [id, profileView, playerRows, matchSort, mode],
  );
  const fields = [
    ["date", "Match"],
    ["minutes", "Min."],
    ["rating", "Note"],
    ["goals", "Buts"],
    ["assists", "PD"],
    ["xg", "xG"],
    ["xa", "xA"],
    ["chancesCreated", "Occ. créées"],
    ["defensiveActions", "Défense"],
    ["saves", "Arrêts"],
    ["goalsPrevented", "Buts évités"],
  ];
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
      {id ? (
        profileView === "matches" && (
          <Card title={`Matchs de ${rows[0]?.name || "ce joueur"}`}>
            <Segments
              label="Mode des statistiques"
              value={mode}
              onChange={setMode}
              items={[
                ["total", "Total"],
                ["perMatch", "Par match"],
                ["per90", "Par 90 minutes"],
              ]}
            />
            {rows.length ? (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Comparer</th>
                      {fields.map(([key, label]) => (
                        <th
                          key={key}
                          aria-sort={
                            matchSort.key === key
                              ? matchSort.direction === "asc"
                                ? "ascending"
                                : "descending"
                              : "none"
                          }
                        >
                          <button
                            onClick={() => {
                              setMatchSort({
                                key,
                                direction:
                                  matchSort.key === key &&
                                  matchSort.direction === "desc"
                                    ? "asc"
                                    : "desc",
                              });
                            }}
                          >
                            {label}{" "}
                            <span className="sort-indicator" aria-hidden="true">
                              {matchSort.key === key
                                ? matchSort.direction === "asc"
                                  ? "↑"
                                  : "↓"
                                : "↕"}
                            </span>
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`Comparer ${r.name}`}
                            checked={f.comparison.includes(r.id)}
                            onChange={() => {
                              research.setComparisonKind("performances");
                              f.toggle(r.id);
                            }}
                          />
                        </td>
                        <td>
                          <PlayerFixture
                            row={r}
                            match={matchIndex.get(r.matchId)}
                          />
                        </td>
                        {fields.slice(1).map(([key]) => (
                          <td key={key}>
                            {key === "rating" ? (
                              <button
                                type="button"
                                className="player-rating-detail"
                                onClick={() => f.setPlayer(r.id)}
                                aria-label={`Détail de la performance du ${date(r.date)}`}
                              >
                                <Rating value={r.rating} />
                              </button>
                            ) : (
                              number(
                                mode === "per90" && key !== "minutes"
                                  ? per90(r[key], r.minutes)
                                  : r[key],
                                ["xg", "xa", "goalsPrevented"].includes(key) ||
                                  mode === "per90"
                                  ? 2
                                  : 0,
                              )
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>Aucune performance pour ces filtres.</Empty>
            )}
          </Card>
        )
      ) : (
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
