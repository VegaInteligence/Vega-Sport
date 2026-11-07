"use client";
import React from "react";
import { overviewRadarValues } from "../services/player-overview-radar.js";
import styles from "./PlayerOverviewRadar.module.css";

const center = [220, 160];
const labels = [
  [220, 18, "middle"],
  [328, 92, "start"],
  [328, 204, "start"],
  [220, 292, "middle"],
  [112, 204, "end"],
  [112, 92, "end"],
];

function point(index, value) {
  const angle = -Math.PI / 2 + (index * Math.PI) / 3;
  return [
    center[0] + (Math.cos(angle) * 110 * value) / 100,
    center[1] + (Math.sin(angle) * 110 * value) / 100,
  ];
}

const known = Number.isFinite;
const percentage = (value) => (known(value) ? `${value} %` : "—");

export default function PlayerOverviewRadar({ profile, cohorts, comparison }) {
  const axes = overviewRadarValues(profile, cohorts);
  const competitions = [
    ...new Set(profile.rows.map(({ league }) => league).filter(Boolean)),
  ];
  const hasRanks = axes.some((axis) => known(axis.percentile));
  const complete = axes.every((axis) => known(axis.percentile));
  return (
    <section className={styles.radar} aria-label="Profil statistique">
      <h3>Profil statistique</h3>
      <p className={styles.intro}>
        Par 90 minutes, parmi les joueurs du même poste dans les compétitions
        disputées.
        {competitions.length > 0 && (hasRanks || comparison) && (
          <strong className={styles.scope}>{competitions.join(" · ")}</strong>
        )}
      </p>
      <svg
        className={styles.chart}
        viewBox="0 0 440 326"
        role="img"
        aria-label="Radar des rangs du joueur par rapport aux joueurs du même poste"
        aria-busy={Boolean(comparison?.loading)}
      >
        <desc>
          {axes
            .map(
              ({ label, percentile }) =>
                `${label} ${known(percentile) ? percentage(percentile) : "non disponible"}`,
            )
            .join(". ")}
        </desc>
        {[25, 50, 75, 100].map((level) => (
          <polygon
            key={level}
            className={styles.grid}
            points={axes.map((_, i) => point(i, level).join(",")).join(" ")}
          />
        ))}
        {axes.map((axis, i) => {
          const [x, y] = point(i, 100);
          const [lx, ly, anchor] = labels[i];
          return (
            <g key={axis.key}>
              <line
                className={styles.grid}
                x1={center[0]}
                y1={center[1]}
                x2={x}
                y2={y}
              />
              <text className={styles.label} x={lx} y={ly} textAnchor={anchor}>
                {axis.label}
                <tspan className={styles.value} x={lx} dy="20">
                  {percentage(axis.percentile)}
                </tspan>
              </text>
            </g>
          );
        })}
        {complete && (
          <polygon
            className={styles.area}
            points={axes
              .map((axis, i) => point(i, axis.percentile).join(","))
              .join(" ")}
          />
        )}
        {!complete &&
          axes.map((axis, i) => {
            const next = (i + 1) % axes.length;
            if (!known(axis.percentile) || !known(axes[next].percentile))
              return null;
            const [x1, y1] = point(i, axis.percentile),
              [x2, y2] = point(next, axes[next].percentile);
            return (
              <line
                key={axis.key}
                className={styles.edge}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
              />
            );
          })}
        {axes.map((axis, i) => {
          if (!known(axis.percentile)) return null;
          const [x, y] = point(i, axis.percentile);
          return (
            <circle key={axis.key} className={styles.dot} cx={x} cy={y} r="4">
              <title>
                {axis.label} · {percentage(axis.percentile)}
              </title>
            </circle>
          );
        })}
      </svg>
      {comparison?.loading ? (
        <p className={styles.note} role="status">
          Calcul des pourcentages…
        </p>
      ) : comparison?.error ? (
        <p className={styles.note} role="alert">
          Les pourcentages n’ont pas pu être chargés.{" "}
          <button
            type="button"
            className="inline-link"
            onClick={comparison.retry}
          >
            Réessayer
          </button>
        </p>
      ) : hasRanks ? (
        <p className={styles.note}>
          100 % correspond au haut du groupe.
          {!complete && " Un tiret indique une comparaison indisponible."}
        </p>
      ) : (
        <p className={styles.note}>
          Données insuffisantes pour calculer les pourcentages dans ce
          périmètre.
        </p>
      )}
    </section>
  );
}
