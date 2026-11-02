import Link from "next/link";
import React, { useMemo, useState } from "react";
import { useFootball } from "../hooks/FootballContext.jsx";
import { Card, Empty, Media, Modal, Pager, Rating, Segments } from "./UI.jsx";
import { number } from "../services/format.js";
import { DIRECTORY_FIELDS } from "../services/player-directory.js";

function averageText(row, key) {
  return number(row[key], key === "matches" ? 0 : key === "minutes" ? 1 : 2);
}

export default function PlayerDirectory({
  rows,
  players,
  sort,
  onSort,
  mode,
  onMode,
  onExport,
}) {
  const f = useFootball();
  const [page, setPage] = useState({ rows: null, value: 1 });
  const [selected, setSelected] = useState([]);
  const [comparing, setComparing] = useState(false);
  const pages = Math.max(1, Math.ceil(rows.length / 20));
  const current = page.rows === rows ? Math.min(page.value, pages) : 1;
  const selection = useMemo(
    () => players.filter((row) => selected.includes(row.playerId)),
    [players, selected],
  );
  function toggle(id) {
    const ids = selection.map((row) => row.playerId);
    if (!ids.includes(id) && ids.length >= 3) {
      f.setNotice("La comparaison est limitée à 3 joueurs.");
      return;
    }
    setSelected(
      ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id],
    );
  }
  return (
    <>
      <Card
        title="Performances"
        action={
          <button className="button button-secondary" onClick={onExport}>
            Exporter CSV
          </button>
        }
      >
        <div className="player-directory-toolbar">
          <Segments
            label="Calcul des moyennes"
            value={mode}
            onChange={onMode}
            items={[
              ["perMatch", "Par match"],
              ["per90", "Par 90 minutes"],
            ]}
          />
          <span role="status">
            {number(rows.length)} joueur{rows.length === 1 ? "" : "s"}
          </span>
        </div>
        {rows.length ? (
          <div className="table-scroll">
            <table className="data-table player-directory-table">
              <caption className="sr-only">
                Un joueur par ligne,{" "}
                {mode === "per90"
                  ? "moyennes par 90 minutes"
                  : "moyennes par match"}
              </caption>
              <thead>
                <tr>
                  <th scope="col">
                    <span className="sr-only">Comparer</span>
                  </th>
                  {[["name", "Joueur"], ...DIRECTORY_FIELDS].map(
                    ([key, label]) => (
                      <th
                        key={key}
                        scope="col"
                        aria-sort={
                          sort.key === key
                            ? sort.direction === "asc"
                              ? "ascending"
                              : "descending"
                            : "none"
                        }
                      >
                        <button
                          onClick={() =>
                            onSort({
                              key,
                              direction:
                                sort.key === key
                                  ? sort.direction === "desc"
                                    ? "asc"
                                    : "desc"
                                  : key === "name"
                                    ? "asc"
                                    : "desc",
                            })
                          }
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
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.slice((current - 1) * 20, current * 20).map((row) => (
                  <tr key={row.playerId} data-player-id={row.playerId}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Comparer ${row.name}`}
                        checked={selection.some(
                          (value) => value.playerId === row.playerId,
                        )}
                        onChange={() => toggle(row.playerId)}
                      />
                    </td>
                    <td>
                      <Link
                        className="table-player"
                        href={f.href("/joueurs/", { id: row.playerId, q: "" })}
                      >
                        <Media
                          name={row.name}
                          url={row.imageUrl}
                          className="player-avatar"
                        />
                        <span className="player-copy">
                          <strong className="player-name">{row.name}</strong>
                          <span className="player-meta">
                            {row.position} · {row.team}
                          </span>
                        </span>
                      </Link>
                    </td>
                    {DIRECTORY_FIELDS.map(([key]) => {
                      const observed =
                        key === "rating"
                          ? row.profile.ratingCount
                          : row.profile.stats[key]?.count;
                      return (
                        <td
                          key={key}
                          title={
                            observed != null && observed < row.matches
                              ? `${observed} / ${row.matches} matchs renseignés`
                              : undefined
                          }
                        >
                          {key === "rating" ? (
                            <Rating value={row.rating} />
                          ) : (
                            averageText(row, key)
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>Aucun joueur pour ces filtres.</Empty>
        )}
        <Pager
          page={current}
          total={pages}
          label="Pagination des joueurs"
          onChange={(value) => setPage({ rows, value })}
        />
      </Card>
      {selection.length > 0 && (
        <aside className="compare-tray" aria-label="Comparaison de joueurs">
          <span>
            Comparer <strong>{selection.length}/3</strong>
          </span>
          {selection.map((row) => (
            <span className="compare-pill" key={row.playerId}>
              {row.name}
              <button
                aria-label={`Retirer ${row.name} de la comparaison`}
                onClick={() => toggle(row.playerId)}
              >
                ×
              </button>
            </span>
          ))}
          <button
            className="button button-primary"
            disabled={selection.length < 2}
            onClick={() => setComparing(true)}
          >
            Comparer les joueurs
          </button>
          <button
            className="button button-ghost"
            onClick={() => setSelected([])}
          >
            Vider
          </button>
        </aside>
      )}
      {comparing && (
        <Modal title="Comparer les joueurs" onClose={() => setComparing(false)}>
          <div className="table-scroll">
            <table className="data-table">
              <caption className="sr-only">
                {mode === "per90"
                  ? "Moyennes par 90 minutes"
                  : "Moyennes par match"}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Indicateur</th>
                  {selection.map((row) => (
                    <th scope="col" key={row.playerId}>
                      {row.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {DIRECTORY_FIELDS.map(([key, label]) => (
                  <tr key={key}>
                    <th scope="row">{label}</th>
                    {selection.map((row) => (
                      <td key={row.playerId}>{averageText(row, key)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Modal>
      )}
    </>
  );
}
