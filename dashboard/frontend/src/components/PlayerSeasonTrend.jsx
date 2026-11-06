import React, { useEffect, useRef, useState } from "react";
import { number } from "../services/format.js";
import styles from "./PlayerSeasonTrend.module.css";

const COLORS = [
  "#3b8eff",
  "#bc8a37",
  "#a579df",
  "#dc6d7a",
  "#31a787",
  "#e0793e",
];
const hasValue = (value) =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= 10;
const consecutive = (previous, current) => {
  const a = /^(\d{4})(?:\/(\d{4}))?$/.exec(String(previous));
  const b = /^(\d{4})(?:\/(\d{4}))?$/.exec(String(current));
  return Boolean(
    a &&
    b &&
    Boolean(a[2]) === Boolean(b[2]) &&
    Number(b[1]) === Number(a[1]) + 1 &&
    (!a[2] || Number(b[2]) === Number(a[2]) + 1),
  );
};

export default function PlayerSeasonTrend({ points = [] }) {
  const plot = useRef(null);
  const [plotWidth, setPlotWidth] = useState(0);
  const seasons = [...new Set(points.map((point) => point.season))].sort(
    (a, b) => String(a).localeCompare(String(b), "fr", { numeric: true }),
  );
  const teams = [
    ...new Map(points.map((point) => [point.teamKey, point])).values(),
  ];
  const values = points
    .filter((point) => hasValue(point.value))
    .map((point) => point.value);
  const hasNotes = values.length > 0;
  useEffect(() => {
    const element = plot.current;
    if (!element) return;
    const measure = () => setPlotWidth(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasNotes]);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 10;
  const low = Math.max(0, Math.floor((min - 0.3) * 2) / 2);
  const high = Math.min(10, Math.ceil((max + 0.3) * 2) / 2);
  const bottom = high > low ? low : Math.max(0, low - 0.5);
  const top = high > low ? high : Math.min(10, high + 0.5);
  const width = Math.max(plotWidth, 268, seasons.length * 88 + 80);
  const scrollable = width > plotWidth && plotWidth > 0;
  const x = (index) =>
    seasons.length === 1
      ? width / 2
      : 55 + (index * (width - 99)) / (seasons.length - 1);
  const y = (value) => 166 - ((value - bottom) / (top - bottom)) * 130;
  const color = (key) =>
    COLORS[teams.findIndex((team) => team.teamKey === key) % COLORS.length];
  const pointX = (point, index) => {
    const coincident = points.filter(
      (other) =>
        other.season === point.season &&
        hasValue(other.value) &&
        other.value === point.value,
    );
    const offset =
      coincident.findIndex((other) => other.teamKey === point.teamKey) -
      (coincident.length - 1) / 2;
    return x(index) + offset * 5;
  };
  const teamLabel = (team) =>
    `${team.team || "Équipe inconnue"}${team.kind === "selection" ? " · sélection" : ""}`;

  return (
    <figure className={styles.chart}>
      <figcaption className={styles.heading}>
        <div>
          <strong>Note moyenne par saison</strong>
          <span>Par équipe · échelle adaptée aux notes disponibles</span>
        </div>
      </figcaption>
      {hasNotes ? (
        <div
          className={styles.plot}
          ref={plot}
          role={scrollable ? "region" : undefined}
          tabIndex={scrollable ? 0 : undefined}
          aria-label={
            scrollable ? "Graphique défilable horizontalement" : undefined
          }
        >
          <svg
            viewBox={`0 0 ${width} 205`}
            width={width}
            height="205"
            role="group"
            aria-label="Évolution des notes moyennes par équipe et par saison"
          >
            <title>Évolution des notes moyennes par équipe</title>
            <desc>
              Les points représentent les notes disponibles. Les lignes relient
              uniquement les saisons consécutives d’une même équipe. Les valeurs
              exactes sont accessibles sur chaque point et dans le tableau de la
              page.
            </desc>
            {[0, 1, 2, 3, 4].map((i) => {
              const tick = bottom + ((top - bottom) * i) / 4;
              return (
                <g key={i}>
                  <line
                    x1="55"
                    x2={width - 44}
                    y1={y(tick)}
                    y2={y(tick)}
                    className={styles.grid}
                  />
                  <text
                    x="44"
                    y={y(tick)}
                    textAnchor="end"
                    dominantBaseline="central"
                    className={styles.axis}
                  >
                    {number(tick, 2)}
                  </text>
                </g>
              );
            })}
            {seasons.map((season, i) => (
              <text
                key={season}
                x={x(i)}
                y="194"
                textAnchor="middle"
                className={styles.axis}
              >
                {season}
              </text>
            ))}
            {teams.map((team) => {
              const bySeason = new Map(
                points
                  .filter((point) => point.teamKey === team.teamKey)
                  .map((point) => [point.season, point]),
              );
              return (
                <g key={team.teamKey}>
                  {seasons.map((season, i) => {
                    const point = bySeason.get(season);
                    const previous = bySeason.get(seasons[i - 1]);
                    const connected =
                      previous &&
                      hasValue(previous.value) &&
                      consecutive(seasons[i - 1], season);
                    return point && hasValue(point.value) ? (
                      <g key={season}>
                        {connected && (
                          <>
                            <polygon
                              points={`${pointX(previous, i - 1)},166 ${pointX(previous, i - 1)},${y(previous.value)} ${pointX(point, i)},${y(point.value)} ${pointX(point, i)},166`}
                              fill={color(team.teamKey)}
                              fillOpacity=".09"
                            />
                            <line
                              x1={pointX(previous, i - 1)}
                              y1={y(previous.value)}
                              x2={pointX(point, i)}
                              y2={y(point.value)}
                              stroke={color(team.teamKey)}
                              strokeWidth="2.5"
                            />
                          </>
                        )}
                        <g className={styles.marker}>
                          <circle
                            cx={pointX(point, i)}
                            cy={y(point.value)}
                            r="5"
                            fill={color(team.teamKey)}
                            stroke="var(--surface-raised)"
                            strokeWidth="2"
                            tabIndex={0}
                            role="img"
                            aria-label={`${season} · ${teamLabel(team)} · Note ${number(point.value, 2)}`}
                          />
                          <g
                            className={styles.pointValue}
                            transform={`translate(${pointX(point, i)}, ${y(point.value) - 18})`}
                            aria-hidden="true"
                          >
                            <rect
                              x="-23"
                              y="-11"
                              width="46"
                              height="22"
                              rx="6"
                            />
                            <text
                              textAnchor="middle"
                              dominantBaseline="central"
                            >
                              {number(point.value, 2)}
                            </text>
                          </g>
                        </g>
                      </g>
                    ) : null;
                  })}
                </g>
              );
            })}
          </svg>
        </div>
      ) : (
        <p className={styles.empty}>
          Aucune note disponible pour les saisons collectées.
        </p>
      )}
      {teams.length > 0 && (
        <div className={styles.legend} aria-label="Équipes">
          {teams.map((team) => {
            const latest = [...seasons]
              .reverse()
              .map((season) =>
                points.find(
                  (point) =>
                    point.teamKey === team.teamKey &&
                    point.season === season &&
                    hasValue(point.value),
                ),
              )
              .find(Boolean);
            return (
              <span key={team.teamKey}>
                <i style={{ backgroundColor: color(team.teamKey) }} />
                {teamLabel(team)}{" "}
                <strong>
                  {latest
                    ? `${number(latest.value, 2)} · ${latest.season}`
                    : "Note indisponible"}
                </strong>
              </span>
            );
          })}
        </div>
      )}
    </figure>
  );
}
