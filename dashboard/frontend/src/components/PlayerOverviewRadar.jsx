"use client";
import React from "react";
import { overviewRadarValues } from "../services/player-overview-radar.js";
import styles from "./PlayerOverviewRadar.module.css";

export default function PlayerOverviewRadar({ profile, cohorts }) {
  const axes = overviewRadarValues(profile, cohorts);
  const point = (index, value) => {
    const angle = -Math.PI / 2 + (index * Math.PI) / 3;
    return [
      150 + (Math.cos(angle) * 110 * value) / 100,
      150 + (Math.sin(angle) * 110 * value) / 100,
    ];
  };
  const known = (value) => typeof value === "number" && Number.isFinite(value);
  if (!axes.some((axis) => known(axis.percentile))) {
    return (
      <section className={styles.radar} aria-label="Profil statistique">
        <h3>Profil statistique</h3>
        <p className={styles.intro}>
          Comparaison indisponible pour ce périmètre.
        </p>
      </section>
    );
  }
  const complete = axes.every((axis) => known(axis.percentile));
  return (
    <section className={styles.radar} aria-label="Profil statistique">
      <h3>Profil statistique</h3>
      <p className={styles.intro}>
        Par 90 minutes, parmi les joueurs du même poste dans les compétitions
        comparées.
      </p>
      <div className={styles.layout}>
        <svg
          className={styles.chart}
          viewBox="0 0 300 300"
          role="img"
          aria-label="Radar des rangs du joueur par rapport aux joueurs du même poste"
        >
          <title>Rangs parmi les joueurs du même poste</title>
          <desc>
            Les axes numérotés correspondent à la liste. Les données
            indisponibles ne sont pas tracées.
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
            const [lx, ly] = point(i, 119);
            return (
              <g key={axis.key}>
                <line className={styles.grid} x1="150" y1="150" x2={x} y2={y} />
                <text
                  className={styles.index}
                  x={lx}
                  y={ly}
                  textAnchor="middle"
                  dominantBaseline="central"
                >
                  {i + 1}
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
                  {axis.label} · {axis.percentile} %
                </title>
              </circle>
            );
          })}
        </svg>
        <ol className={styles.values}>
          {axes.map((axis, i) => (
            <li key={axis.key}>
              <span className={styles.number}>{i + 1}</span>
              <span>{axis.label}</span>
              <strong>
                {known(axis.percentile) ? `${axis.percentile} %` : "—"}
              </strong>
            </li>
          ))}
        </ol>
      </div>
      <p className={styles.note}>
        Le rang va de 0 % en bas du groupe à 100 % en haut.
        {!complete && " Un tiret indique une comparaison indisponible."}
      </p>
    </section>
  );
}
