"use client";
import { useSearchParams } from "next/navigation";
import { ProfileDialog } from "../components/PlayerDetails.jsx";
import React, { useState, useMemo } from "react";
import Layout from "../components/Layout.jsx";
import { useFootball } from "../hooks/FootballContext.jsx";
import { number, isNumber } from "../services/format.js";
import { sortRows, per90 } from "../model.js";
import PlayerSeasonProfile from "../components/PlayerSeasonProfile.jsx";
import {
  Card,
  Rating,
  Pager,
  Segments,
  Media,
  Empty,
} from "../components/UI.jsx";
export default function PlayersPage() {
  const [profile, setProfile] = useState(false);
  const f = useFootball(),
    [mode, setMode] = useState("total"),
    [sort, setSort] = useState({ key: "rating", direction: "desc" }),
    [page, setPage] = useState(1);
  const id = useSearchParams().get("id");
  const scopeRows = id ? f.seasonPlayerScope : [];
  const playerRows = useMemo(
    () => (id ? scopeRows.filter((row) => row.playerId === id) : f.rows),
    [id, scopeRows, f.rows],
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
  return (
    <Layout
      path="/joueurs/"
      title="Joueurs"
      filters
      filterKind="players"
      onExport={() => f.exportRows(mode, id ? rows : undefined)}
    >
      {id && (
        <PlayerSeasonProfile id={id} rows={playerRows} scopeRows={scopeRows} />
      )}
      <Card
        title={id ? `Performances de ${rows[0]?.name || id}` : "Performances"}
        action={
          <>
            {id && (
              <button
                className="button button-secondary"
                onClick={() => setProfile(true)}
              >
                Fiche PitchAPI
              </button>
            )}
            <button
              className="button button-secondary"
              onClick={() => f.exportRows(mode, id ? rows : undefined)}
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
            ["total", "Par match"],
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
                        onChange={() => f.toggle(r.id)}
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
      {profile && (
        <ProfileDialog
          id={id}
          kind="players"
          onClose={() => setProfile(false)}
        />
      )}
    </Layout>
  );
}
