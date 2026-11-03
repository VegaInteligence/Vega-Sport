"use client";
import React, { useState } from "react";
import Link from "next/link";
import { useFootball } from "../hooks/FootballContext.jsx";
import { date, isNumber, number } from "../services/format.js";
import { Empty, Pager, Segments } from "./UI.jsx";

const isGoal = (shot) => shot.isGoal && !shot.isOwnGoal;
function outcome(shot) {
  if (shot.isOwnGoal) return "Contre son camp";
  if (shot.isGoal) return "But";
  if (shot.type === "Post") return "Poteau";
  if (shot.isBlocked) return "Contré";
  if (shot.isOnTarget || shot.type === "AttemptSaved") return "Cadré";
  if (["Miss", "MissedShots", "MissedShot"].includes(shot.type))
    return "Non cadré";
  return "Tir";
}
const placed = (shot) =>
  isNumber(shot.x) &&
  isNumber(shot.y) &&
  shot.x >= 0 &&
  shot.x <= 105 &&
  shot.y >= 0 &&
  shot.y <= 68;

/** Keep the recorded positions; do not infer direction from the teams. */
export default function SeasonShots({ shots, title = "Tirs de la saison" }) {
  const f = useFootball();
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);
  if (!shots.length)
    return <Empty>Aucun tir collecté dans ce périmètre.</Empty>;
  const filtered = shots.filter((shot) =>
    filter === "goals"
      ? isGoal(shot)
      : filter === "other"
        ? !isGoal(shot)
        : true,
  );
  const located = filtered.filter(placed);
  const knownXg = filtered.filter(
    (shot) => !shot.isOwnGoal && isNumber(shot.xg),
  );
  const totalXg = knownXg.reduce((sum, shot) => sum + shot.xg, 0);
  const current = Math.min(page, Math.max(1, Math.ceil(filtered.length / 20)));
  const setView = (next) => {
    setFilter(next);
    setPage(1);
    setSelected(null);
  };
  return (
    <section className="player-shots" aria-label={title}>
      <div className="player-shots-header">
        <Segments
          label="Filtrer les tirs"
          value={filter}
          onChange={setView}
          items={[
            ["all", "Tous"],
            ["goals", "Buts"],
            ["other", "Autres tirs"],
          ]}
        />
        <div className="player-shots-legend">
          <span>
            <i className="is-goal" /> But
          </span>
          <span>
            <i /> Autre tir
          </span>
          <span>La taille indique les xG lorsqu’ils sont connus</span>
        </div>
      </div>
      <div className="player-shots-layout">
        <figure className="player-shots-figure">
          <svg viewBox="0 0 680 470" role="group" aria-label={title}>
            <title>{title}</title>
            <desc>
              Buts en plein, autres tirs en contour. Les tirs sans coordonnées
              ne sont pas placés.
            </desc>
            <rect
              className="player-shot-field"
              x="25"
              y="25"
              width="630"
              height="408"
              rx="2"
            />
            <g className="player-shot-lines" fill="none">
              <path d="M340 25v408M25 112h100v234H25M655 112H555v234H655M25 172h34v114H25M655 172h-34v114h34" />
              <circle cx="340" cy="229" r="54" />
              <path d="M125 183a58 58 0 0 1 0 92M555 183a58 58 0 0 0 0 92" />
            </g>
            {located.map((shot, i) => (
              <circle
                key={`${shot.matchId}:${shot.id || i}`}
                className={`player-shot-point ${isGoal(shot) ? "is-goal" : ""}${selected === shot ? " is-selected" : ""}`}
                cx={25 + shot.x * 6}
                cy={25 + shot.y * 6}
                r={
                  isNumber(shot.xg)
                    ? 3.5 + Math.sqrt(Math.max(0, Math.min(1, shot.xg))) * 5
                    : 4
                }
                role="button"
                tabIndex={
                  selected ? (selected === shot ? 0 : -1) : i === 0 ? 0 : -1
                }
                data-shot-index={i}
                aria-label={`${date(shot.date)} · ${number(shot.minute)}′ · ${outcome(shot)} · xG ${number(shot.xg, 2)}`}
                onClick={() => setSelected(shot)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSelected(shot);
                  } else if (["ArrowLeft", "ArrowRight"].includes(event.key)) {
                    event.preventDefault();
                    const delta = event.key === "ArrowRight" ? 1 : -1;
                    const next = (i + delta + located.length) % located.length;
                    setSelected(located[next]);
                    event.currentTarget.parentNode
                      .querySelector(`[data-shot-index="${next}"]`)
                      ?.focus();
                  }
                }}
              >
                <title>{`${date(shot.date)} · ${number(shot.minute)}′ · ${outcome(shot)} · xG ${number(shot.xg, 2)}`}</title>
              </circle>
            ))}
          </svg>
          <figcaption>
            {number(located.length)} / {number(filtered.length)} tirs placés
          </figcaption>
        </figure>
        <aside className="player-shots-summary">
          <div>
            <span>Tirs</span>
            <strong>{number(filtered.length)}</strong>
          </div>
          <div>
            <span>Buts</span>
            <strong>{number(filtered.filter(isGoal).length)}</strong>
          </div>
          <div>
            <span>xG renseignés</span>
            <strong>{knownXg.length ? number(totalXg, 2) : "—"}</strong>
            <small>
              {knownXg.length} /{" "}
              {filtered.filter((shot) => !shot.isOwnGoal).length} tirs
            </small>
          </div>
          {selected ? (
            <div className="player-shot-selected">
              <span>Dernier tir sélectionné</span>
              <strong>
                {outcome(selected)} · {number(selected.minute)}′
              </strong>
              <small>
                {date(selected.date)} · xG {number(selected.xg, 2)}
              </small>
              <Link
                href={f.href("/matchs/", {
                  id: selected.matchId,
                  competition: selected.leagueId,
                  sourceSeason: selected.season,
                })}
              >
                Voir le match
              </Link>
            </div>
          ) : (
            <p>Sélectionner un tir pour voir son détail.</p>
          )}
        </aside>
      </div>
      <details className="research-details">
        <summary>Voir la liste des tirs</summary>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Minute</th>
                <th>Résultat</th>
                <th>xG</th>
                <th>Match</th>
              </tr>
            </thead>
            <tbody>
              {filtered
                .slice((current - 1) * 20, current * 20)
                .map((shot, i) => (
                  <tr key={`${shot.matchId}:${shot.id || i}`}>
                    <td>{date(shot.date)}</td>
                    <td>{number(shot.minute)}′</td>
                    <td>{outcome(shot)}</td>
                    <td>{number(shot.xg, 2)}</td>
                    <td>
                      <Link
                        href={f.href("/matchs/", {
                          id: shot.matchId,
                          competition: shot.leagueId,
                          sourceSeason: shot.season,
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
      </details>
    </section>
  );
}
