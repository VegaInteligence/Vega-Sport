import React, { useRef } from "react";
import Link from "next/link";
import { useFootball } from "../hooks/FootballContext.jsx";
import { isNumber, number } from "../services/format.js";
import { Empty, Pager } from "./UI.jsx";
import { exportChart } from "./ResearchCharts.jsx";
import { useState } from "react";

/** Preserve the provider's coordinates; no inferred pitch direction or tracking. */
export default function SeasonShots({ shots, title = "Tirs de la saison" }) {
  const f = useFootball(),
    ref = useRef(),
    [page, setPage] = useState(1);
  const located = shots.filter(
    (s) =>
      isNumber(s.x) &&
      isNumber(s.y) &&
      s.x >= 0 &&
      s.x <= 105 &&
      s.y >= 0 &&
      s.y <= 68,
  );
  const current = Math.min(page, Math.max(1, Math.ceil(shots.length / 20)));
  if (!shots.length)
    return <Empty>Aucun tir collecté dans ce périmètre.</Empty>;
  return (
    <>
      <figure className="research-chart">
        <svg ref={ref} viewBox="0 0 680 470" role="img" aria-label={title}>
          <title>{title}</title>
          <desc>
            Coordonnées du fournisseur. Buts en plein, autres tirs en contour ;
            les valeurs absentes ne sont pas placées sur le terrain.
          </desc>
          <rect
            x="25"
            y="25"
            width="630"
            height="408"
            rx="2"
            fill="var(--surface)"
            className="radar-grid"
          />
          <path
            d="M340 25v408M25 112h100v234H25M655 112H555v234H655"
            fill="none"
            className="radar-grid"
          />
          <circle cx="340" cy="229" r="54" fill="none" className="radar-grid" />
          {located.map((shot, i) => (
            <circle
              key={`${shot.matchId}:${shot.id || i}`}
              cx={25 + shot.x * 6}
              cy={25 + shot.y * 6}
              r={shot.isGoal ? 5 : 3}
              fill={shot.isGoal ? "var(--accent)" : "none"}
              stroke="var(--accent)"
              strokeWidth="1.5"
              opacity=".7"
            >
              <title>
                {shot.playerName || "Tir"} · {shot.minute ?? "?"}′ ·{" "}
                {shot.isOwnGoal
                  ? "CSC"
                  : shot.isGoal
                    ? "But"
                    : shot.type || "Tir"}{" "}
                · xG {number(shot.xg, 2)}
              </title>
            </circle>
          ))}
        </svg>
        <figcaption>
          <span>
            {number(located.length)} / {number(shots.length)} tirs placés ·{" "}
            {number(shots.filter((s) => isNumber(s.xg)).length)} xG renseignés
          </span>
          <button
            className="inline-link"
            onClick={() => exportChart(ref, "statarena-tirs")}
          >
            Exporter SVG
          </button>
        </figcaption>
      </figure>
      <details className="research-details">
        <summary>Tous les tirs</summary>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Joueur</th>
                <th>Minute</th>
                <th>Résultat</th>
                <th>xG</th>
                <th>Match</th>
              </tr>
            </thead>
            <tbody>
              {shots.slice((current - 1) * 20, current * 20).map((s, i) => (
                <tr key={`${s.matchId}:${s.id || i}`}>
                  <td>{s.date}</td>
                  <td>{s.playerName || "—"}</td>
                  <td>{number(s.minute)}′</td>
                  <td>
                    {s.isOwnGoal ? "CSC" : s.isGoal ? "But" : s.type || "Tir"}
                  </td>
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
          total={Math.max(1, Math.ceil(shots.length / 20))}
          onChange={setPage}
        />
      </details>
    </>
  );
}
