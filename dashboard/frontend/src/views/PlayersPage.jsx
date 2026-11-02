"use client";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import React, { useState, useMemo, useDeferredValue } from "react";
import Layout from "../components/Layout.jsx";
import { useFootball } from "../hooks/FootballContext.jsx";
import { useResearch } from "../hooks/ResearchContext.jsx";
import { number, isNumber } from "../services/format.js";
import { sortRows, per90 } from "../model.js";
import PlayerSeasonProfile from "../components/PlayerSeasonProfile.jsx";
import PlayerWorkspace from "../components/PlayerWorkspace.jsx";
import { ResearchComparisonTray } from "../components/ResearchUI.jsx";
import { aggregateSeasonPlayers } from "../services/season-player.js";
import {
  directoryCSV,
  filterPlayerAverages,
  playerAverage,
  playerDirectoryScope,
  searchPlayerAverages,
  sortPlayerAverages,
} from "../services/player-directory.js";
import { download } from "../services/resources.js";
import {
  Card,
  Rating,
  Pager,
  Segments,
  Media,
  Empty,
} from "../components/UI.jsx";
export default function PlayersPage() {
  const research = useResearch(),
    params = useSearchParams();
  const profileView = params.get("playerView") || "overview";
  const f = useFootball(),
    [sort, setSort] = useState({ key: "rating", direction: "desc" }),
    [page, setPage] = useState(1);
  const filters = useDeferredValue(f.filters);
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
    ],
  );
  const profiles = useMemo(
    () => aggregateSeasonPlayers(contextRows),
    [contextRows],
  );
  const averages = useMemo(
    () => profiles.map((value) => playerAverage(value, mode)),
    [profiles, mode],
  );
  const eligible = useMemo(
    () => filterPlayerAverages(averages, filters),
    [averages, filters.minutes, filters.advanced],
  );
  const directoryRows = useMemo(
    () =>
      sortPlayerAverages(searchPlayerAverages(eligible, filters.query), sort),
    [eligible, filters.query, sort],
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
      sortRows(playerRows, sort.key, sort.direction, mode, f.data.appearances),
    [playerRows, f.data, sort, mode],
  );
  const pages = Math.max(1, Math.ceil(rows.length / 20)),
    current = Math.min(page, pages);
  const fields = [
    ["name", "Joueur"],
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
  const exportCurrent = () =>
    id
      ? f.exportRows(mode, rows)
      : download(
          "statarena-joueurs-moyennes.csv",
          directoryCSV(directoryRows, mode, research.data.settings.columns),
          "text/csv;charset=utf-8",
        );
  return (
    <Layout
      path="/joueurs/"
      title="Joueurs"
      filters
      filterKind="players"
      onExport={exportCurrent}
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
          <Card
            title={`Matchs de ${rows[0]?.name || id}`}
            action={
              <>
                <button
                  className="button button-secondary"
                  onClick={exportCurrent}
                >
                  Exporter CSV
                </button>
              </>
            }
          >
            <Segments
              label="Mode des statistiques"
              value={mode}
              onChange={setMode}
              items={[
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
                            sort.key === key
                              ? sort.direction === "asc"
                                ? "ascending"
                                : "descending"
                              : "none"
                          }
                        >
                          <button
                            onClick={() => {
                              setSort({
                                key,
                                direction:
                                  sort.key === key && sort.direction === "desc"
                                    ? "asc"
                                    : "desc",
                              });
                              setPage(1);
                            }}
                          >
                            {label}{" "}
                            <span className="sort-indicator" aria-hidden="true">
                              {sort.key === key
                                ? sort.direction === "asc"
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
                    {rows.slice((current - 1) * 20, current * 20).map((r) => (
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
                          <button
                            className="table-player"
                            onClick={() => f.setPlayer(r.id)}
                          >
                            <Media
                              name={r.name}
                              url={r.imageUrl}
                              className="player-avatar"
                            />
                            <span className="player-copy">
                              <strong className="player-name">{r.name}</strong>
                              <span className="player-meta">
                                {r.team} · {r.league}
                              </span>
                            </span>
                          </button>
                        </td>
                        {fields.slice(1).map(([key]) => (
                          <td key={key}>
                            {key === "rating" ? (
                              <Rating value={r.rating} />
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
            <Pager page={current} total={pages} onChange={setPage} />
          </Card>
        )
      ) : (
        <PlayerWorkspace
          profiles={profiles}
          rows={directoryRows}
          players={averages}
          sort={sort}
          onSort={setSort}
          mode={mode}
          onMode={setMode}
          onExport={exportCurrent}
        />
      )}
      <ResearchComparisonTray performanceComparison={Boolean(id)} />
    </Layout>
  );
}
