"use client";
import React, { useState } from "react";
import Link from "next/link";
import { useFootball } from "../hooks/FootballContext.jsx";
import { date, isNumber, number } from "../services/format.js";
import { shotOutcome, shotPosition } from "../services/season-shots.js";
import { Empty, Pager, Segments } from "./UI.jsx";
import styles from "./SeasonShots.module.css";

const distance = (shot) => {
  const pos = shotPosition(shot);
  return pos?.distance != null
    ? `${pos.approximate ? "env. " : ""}${number(pos.distance, 1)} m`
    : "—";
};
const kinds = [
  "But",
  "Cadré sans but",
  "Non cadré",
  "Bloqué",
  "Poteau",
  "Contre son camp",
  "Résultat inconnu",
];
const kindClass = (outcome) =>
  ({
    But: "goal",
    "Cadré sans but": "target",
    "Non cadré": "miss",
    Bloqué: "blocked",
    Poteau: "post",
  })[outcome] || "unknown";

export default function SeasonShots({
  shots: sourceShots,
  title = "Tirs de la saison",
  legacyPitchApi = false,
}) {
  const shots = React.useMemo(
    () =>
      legacyPitchApi
        ? sourceShots.map((shot) =>
            shot.coordinateFrame || shot.coordinate_frame
              ? shot
              : { ...shot, coordinateFrame: "acting_ltr" },
          )
        : sourceShots,
    [sourceShots, legacyPitchApi],
  );
  const f = useFootball();
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [selectedShot, setSelected] = useState(null);
  if (!shots.length)
    return (
      <section className={styles.shots}>
        <h3>{title}</h3>
        <Empty>Aucun tir collecté dans ce périmètre.</Empty>
      </section>
    );
  const filtered =
    filter === "all" ? shots : shots.filter((s) => shotOutcome(s) === filter);
  const selected = filtered.includes(selectedShot) ? selectedShot : null;
  const located = filtered
    .map((shot) => ({ shot, pos: shotPosition(shot) }))
    .filter((entry) => entry.pos);
  const knownXg = filtered.filter((s) => !s.isOwnGoal && isNumber(s.xg));
  const current = Math.min(page, Math.max(1, Math.ceil(filtered.length / 20)));
  const select = (shot) => {
    setSelected(shot);
    const index = filtered.indexOf(shot);
    if (index >= 0) setPage(Math.floor(index / 20) + 1);
  };
  const label = (s) =>
    `${date(s.date)} · ${number(s.minute)}′ · ${shotOutcome(s)} · ${distance(s)} du but · xG ${number(s.xg, 2)}`;
  return (
    <section className={styles.shots} aria-label={title}>
      <h3>{title}</h3>
      <div className={styles.header}>
        <Segments
          label="Filtrer les tirs"
          value={filter}
          onChange={(next) => {
            setFilter(next);
            setPage(1);
            setSelected(null);
          }}
          items={[
            ["all", "Tous"],
            ...kinds
              .filter((k) => shots.some((s) => shotOutcome(s) === k))
              .map((k) => [k, k]),
          ]}
        />
        <p>
          Un point par tir. Sélectionnez un point ou une ligne pour voir le
          résultat et la distance au but.
        </p>
      </div>
      <div className={styles.layout}>
        <figure className={styles.figure}>
          <svg viewBox="0 0 680 470" role="group" aria-label={title}>
            <title>{title}</title>
            <desc>
              Chaque point représente un tir. Le sens du jeu est inconnu lorsque
              le fournisseur ne le précise pas.
            </desc>
            <rect
              className={styles.field}
              x="25"
              y="25"
              width="630"
              height="408"
            />
            <g className={styles.lines} fill="none">
              <path d="M340 25v408M25 112h100v234H25M655 112H555v234H655M25 172h34v114H25M655 172h-34v114h34" />
              <circle cx="340" cy="229" r="54" />
              <path d="M125 183a58 58 0 0 1 0 92M555 183a58 58 0 0 0 0 92" />
            </g>
            {located.length > 0 && located.every(({ pos }) => pos.verified) && (
              <text
                x="653"
                y="16"
                textAnchor="end"
                className={styles.goalLabel}
              >
                BUT ATTAQUÉ →
              </text>
            )}
            {located.map(({ shot, pos }, i) => (
              <circle
                key={`${shot.matchId}:${shot.id || i}`}
                className={`${styles.point} ${styles[kindClass(shotOutcome(shot))]} ${selected === shot ? styles.selected : ""}`}
                cx={25 + pos.x * 630}
                cy={25 + pos.y * 408}
                r={
                  isNumber(shot.xg)
                    ? 5 + Math.sqrt(Math.max(0, Math.min(1, shot.xg))) * 5
                    : 6
                }
                role="button"
                tabIndex={0}
                aria-label={label(shot)}
                aria-pressed={selected === shot}
                onClick={() => select(shot)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    select(shot);
                  }
                }}
              >
                <title>{label(shot)}</title>
              </circle>
            ))}
          </svg>
          <figcaption>
            {located.length} / {filtered.length} tirs placés · taille du point
            selon les xG connus
          </figcaption>
          <div className={styles.legend}>
            {kinds
              .filter((k) => filtered.some((s) => shotOutcome(s) === k))
              .map((k) => (
                <span key={k}>
                  <i className={styles[kindClass(k)]} />
                  {k}
                </span>
              ))}
          </div>
        </figure>
        <aside className={styles.summary}>
          <div>
            <span>Tirs</span>
            <strong>{filtered.length}</strong>
          </div>
          <div>
            <span>Buts</span>
            <strong>
              {filtered.filter((s) => shotOutcome(s) === "But").length}
            </strong>
          </div>
          <div>
            <span>xG connus</span>
            <strong>
              {knownXg.length
                ? number(
                    knownXg.reduce((a, s) => a + s.xg, 0),
                    2,
                  )
                : "—"}
            </strong>
            <small>
              {knownXg.length} / {filtered.filter((s) => !s.isOwnGoal).length}{" "}
              tirs
            </small>
          </div>
          <div className={styles.detail}>
            {selected ? (
              <>
                <span>Tir sélectionné</span>
                <strong>
                  {shotOutcome(selected)} · {number(selected.minute)}′
                </strong>
                <small>
                  {date(selected.date)} · xG {number(selected.xg, 2)}
                </small>
                <small>Distance au centre du but · {distance(selected)}</small>
                <Link
                  href={f.href("/matchs/", {
                    id: selected.matchId,
                    competition: selected.leagueId,
                    sourceSeason: selected.season,
                  })}
                >
                  Voir le match
                </Link>
              </>
            ) : (
              <p>Sélectionnez un tir sur la carte ou dans la liste.</p>
            )}
          </div>
        </aside>
      </div>
      <p className={styles.note}>
        Distance jusqu’au centre du but. « env. » indique une estimation sur un
        terrain de 105 × 68 m.
        {(located.length < filtered.length ||
          located.some(({ pos }) => !pos.verified)) &&
          " Un tiret indique une position ou un sens de jeu inconnu."}
      </p>
      <div className="table-scroll">
        <table className="data-table">
          <caption className={styles.caption}>Liste des tirs</caption>
          <thead>
            <tr>
              <th>Date</th>
              <th>Minute</th>
              <th>Résultat</th>
              <th>Distance au but</th>
              <th>xG</th>
              <th>Match</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice((current - 1) * 20, current * 20).map((s, i) => (
              <tr
                key={`${s.matchId}:${s.id || i}`}
                className={selected === s ? styles.selectedRow : ""}
              >
                <td>{date(s.date)}</td>
                <td>{number(s.minute)}′</td>
                <td>
                  <button
                    type="button"
                    className={styles.selectButton}
                    aria-pressed={selected === s}
                    onClick={() => select(s)}
                  >
                    {shotOutcome(s)}
                  </button>
                </td>
                <td>{distance(s)}</td>
                <td>{number(s.xg, 2)}</td>
                <td>
                  <Link
                    href={f.href("/matchs/", {
                      id: s.matchId,
                      competition: s.leagueId,
                      sourceSeason: s.season,
                    })}
                  >
                    Voir le match
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager
        page={current}
        total={Math.max(1, Math.ceil(filtered.length / 20))}
        onChange={setPage}
      />
    </section>
  );
}
