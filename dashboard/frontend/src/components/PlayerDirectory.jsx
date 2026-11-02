import Link from "next/link";
import React, { useState } from "react";
import { useFootball } from "../hooks/FootballContext.jsx";
import { useResearch } from "../hooks/ResearchContext.jsx";
import { playerSelection } from "../services/research-storage.js";
import { SCOUT_METRICS } from "../services/scouting.js";
import { number } from "../services/format.js";
import { Card, Empty, Media, Pager, Rating, Segments } from "./UI.jsx";
import {
  BookmarkButton,
  MetricInfo,
  MetricPicker,
  SavedViews,
} from "./ResearchUI.jsx";
const labels = { matches: "Matchs", minutes: "Min. moy.", rating: "Note" };
export default function PlayerDirectory({
  rows,
  sort,
  onSort,
  mode,
  onMode,
  onExport,
}) {
  const f = useFootball(),
    r = useResearch();
  const [page, setPage] = useState({ rows: null, value: 1 });
  const fields = r.data.settings.columns.map((key) => [
    key,
    labels[key] || SCOUT_METRICS[key]?.label || key,
  ]);
  const pages = Math.max(1, Math.ceil(rows.length / 20));
  const current = page.rows === rows ? Math.min(page.value, pages) : 1;
  return (
    <Card
      title="Performances"
      action={
        <>
          <SavedViews />
          <MetricPicker
            label="Colonnes"
            value={r.data.settings.columns}
            includeMeta
            onChange={(columns) => r.setSettings({ columns })}
          />
          <button className="button button-secondary" onClick={onExport}>
            Exporter CSV
          </button>
        </>
      }
    >
      <div className="player-directory-toolbar">
        <Segments
          label="Calcul des performances"
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
              Un joueur par ligne, valeurs{" "}
              {mode === "per90" ? "par 90 minutes" : "par match"}
            </caption>
            <thead>
              <tr>
                <th scope="col">
                  <span className="sr-only">Comparer et enregistrer</span>
                </th>
                {[["name", "Joueur"], ...fields].map(([key, label]) => (
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
                      {label}
                      <span className="sort-indicator" aria-hidden="true">
                        {sort.key === key
                          ? sort.direction === "asc"
                            ? "↑"
                            : "↓"
                          : "↕"}
                      </span>
                    </button>
                    {SCOUT_METRICS[key] && <MetricInfo metric={key} />}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice((current - 1) * 20, current * 20).map((row) => {
                const entry = playerSelection(row.profile, f);
                return (
                  <tr key={row.playerId} data-player-id={row.playerId}>
                    <td>
                      <span className="research-row-actions">
                        <input
                          type="checkbox"
                          aria-label={`Comparer ${row.name}`}
                          checked={r.isComparing(entry)}
                          onChange={() => r.toggleComparison(entry)}
                        />
                        <BookmarkButton
                          kind="players"
                          id={row.playerId}
                          name={row.name}
                          imageUrl={row.imageUrl}
                          season={f.season}
                          compact
                        />
                      </span>
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
                    {fields.map(([key]) => {
                      const observed =
                        key === "rating"
                          ? row.profile.ratingCount
                          : (row.profile.stats[key]?.count ??
                            row.profile.ratios[key]?.count);
                      return (
                        <td
                          key={key}
                          title={
                            observed != null
                              ? `${observed} / ${row.matches} matchs renseignés`
                              : undefined
                          }
                        >
                          {key === "rating" ? (
                            <Rating value={row.rating} />
                          ) : (
                            <>
                              {number(
                                row[key],
                                key === "matches"
                                  ? 0
                                  : key === "minutes"
                                    ? 1
                                    : 2,
                              )}
                              {SCOUT_METRICS[key]?.unit
                                ? ` ${SCOUT_METRICS[key].unit}`
                                : ""}
                            </>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
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
  );
}
