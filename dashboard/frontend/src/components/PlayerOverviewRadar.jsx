"use client";
import React from "react";
import { number } from "../services/format.js";
import { overviewRadarValues } from "../services/player-overview-radar.js";
import styles from "./PlayerOverviewRadar.module.css";

const center = [210, 166];
const plotRadius = 105;
const labelRadius = 145;
const known = Number.isFinite;
const percentage = (value) => (known(value) ? `${value} %` : "—");
const rate = (value) => (known(value) ? number(value, 2) : "—");

function point(index, distance) {
  const angle = -Math.PI / 2 + (index * Math.PI) / 3;
  return [
    center[0] + Math.cos(angle) * distance,
    center[1] + Math.sin(angle) * distance,
  ];
}

function RadarSeries({ axes, field, className, name }) {
  const points = axes.map((axis, index) => {
    if (!known(axis[field]) || !known(axis.maximum)) return null;
    const range = axis.maximum - axis.minimum;
    return point(
      index,
      range > 0 ? (plotRadius * (axis[field] - axis.minimum)) / range : 0,
    );
  });
  const complete = points.every(Boolean);
  return (
    <g className={className} data-series={field}>
      {complete && (
        <polygon points={points.map((p) => p.join(",")).join(" ")} />
      )}
      {points.map((position, index) => {
        if (!position) return null;
        const [x, y] = position;
        const next = points[(index + 1) % points.length];
        const axis = axes[index];
        return (
          <g key={axis.key}>
            {!complete && next && (
              <line x1={x} y1={y} x2={next[0]} y2={next[1]} />
            )}
            <circle cx={x} cy={y} r={field === "mean" ? 2.8 : 3.5}>
              <title>
                {name} · {axis.label} · {rate(axis[field])} par 90 min
              </title>
            </circle>
          </g>
        );
      })}
    </g>
  );
}

function PercentileBars({ axes }) {
  return (
    <section
      className={styles.percentiles}
      aria-label="Percentiles par indicateur"
    >
      <div className={styles.barHeading}>
        <h4>Percentiles</h4>
        <p>
          <span className={styles.meanTick} aria-hidden="true" /> Rang de la
          moyenne du poste
        </p>
      </div>
      <ul className={styles.bars}>
        {axes.map(
          ({ key, label, value, mean, percentile, meanPercentile, peers }) => (
            <li key={key}>
              <div className={styles.barLabel}>
                <span>{label}</span>
                <small
                  title={`Moyenne sur ${peers} joueurs entièrement renseignés`}
                >
                  {rate(value)} · moy. {rate(mean)}
                </small>
                <strong>{percentage(percentile)}</strong>
              </div>
              <div
                className={styles.track}
                role="img"
                aria-label={`${label}. Percentile du joueur ${percentage(percentile)}. Rang de la moyenne ${percentage(meanPercentile)}.`}
              >
                {known(percentile) && (
                  <span
                    className={styles.barFill}
                    style={{ width: `${percentile}%` }}
                  />
                )}
                {known(meanPercentile) && (
                  <span
                    className={styles.meanMarker}
                    style={{ left: `${meanPercentile}%` }}
                    title={`Moyenne du poste · ${rate(mean)} par 90 min · percentile ${meanPercentile}`}
                  />
                )}
              </div>
            </li>
          ),
        )}
      </ul>
    </section>
  );
}

export default function PlayerOverviewRadar({ profile, cohorts, comparison }) {
  const awaitingPeers = comparison && !comparison.value;
  const axes = overviewRadarValues(profile, cohorts).map((axis) =>
    awaitingPeers
      ? {
          ...axis,
          mean: null,
          percentile: null,
          meanPercentile: null,
          minimum: null,
          maximum: null,
          peers: 0,
        }
      : axis,
  );
  const competitions = [
    ...new Set(profile.rows.map(({ league }) => league).filter(Boolean)),
  ];
  const hasComparison = axes.some(
    ({ value, mean }) => known(value) && known(mean),
  );
  const partial = axes.some(
    ({ percentile, meanPercentile }) =>
      !known(percentile) || !known(meanPercentile),
  );
  const smallSamples = axes.filter(
    ({ mean, peers }) => known(mean) && peers < cohorts.minPeers,
  );
  return (
    <section className={styles.radar} aria-label="Profil statistique">
      <h3>Profil statistique</h3>
      <p className={styles.intro}>
        Par 90 minutes, comparé aux{" "}
        {profile.role?.peers || "joueurs du même poste"}.
        {competitions.length > 0 && (hasComparison || comparison) && (
          <strong className={styles.scope}>{competitions.join(" · ")}</strong>
        )}
      </p>
      <div className={styles.legend}>
        <span>
          <i className={styles.playerLine} aria-hidden="true" /> Joueur
        </span>
        <span>
          <i className={styles.meanLine} aria-hidden="true" /> Moyenne du poste
        </span>
      </div>
      <svg
        className={styles.chart}
        viewBox="0 0 420 332"
        role="img"
        aria-label="Radar du joueur et de la moyenne des joueurs du même poste"
        aria-busy={Boolean(comparison?.loading)}
      >
        <desc>
          {axes
            .map(
              ({ label, value, mean }) =>
                `${label} · Joueur ${rate(value)} · Moyenne ${rate(mean)}`,
            )
            .join(". ")}
        </desc>
        {[0.25, 0.5, 0.75, 1].map((level) => (
          <polygon
            key={level}
            className={styles.grid}
            points={axes
              .map((_, i) => point(i, plotRadius * level).join(","))
              .join(" ")}
          />
        ))}
        {axes.map(({ key }, index) => {
          const [x, y] = point(index, plotRadius);
          return (
            <line
              key={key}
              className={styles.grid}
              x1={center[0]}
              y1={center[1]}
              x2={x}
              y2={y}
            />
          );
        })}
        <RadarSeries
          axes={axes}
          field="value"
          className={styles.playerSeries}
          name="Joueur"
        />
        <RadarSeries
          axes={axes}
          field="mean"
          className={styles.meanSeries}
          name="Moyenne du poste"
        />
        {axes.map(({ key, label }, index) => {
          const [x, y] = point(index, labelRadius);
          const words = label.split(" ");
          return (
            <text
              key={key}
              className={styles.axisLabel}
              x={x}
              y={y - (words.length - 1) * 7}
              textAnchor="middle"
              dominantBaseline="central"
            >
              {words.map((word, row) => (
                <tspan key={word} x={x} dy={row ? 14 : 0}>
                  {word}
                </tspan>
              ))}
            </text>
          );
        })}
      </svg>
      <p className={styles.note}>Chaque axe a sa propre échelle.</p>
      <PercentileBars axes={axes} />
      {smallSamples.map(({ key, label, peers }) => (
        <p key={key} className={styles.note}>
          {label} · moyenne sur {peers} joueurs renseignés. Percentile
          indisponible.
        </p>
      ))}
      {comparison?.loading ? (
        <p className={styles.note} role="status">
          Calcul de la comparaison…
        </p>
      ) : comparison?.error ? (
        <p className={styles.note} role="alert">
          La comparaison n’a pas pu être chargée.{" "}
          <button
            type="button"
            className="inline-link"
            onClick={comparison.retry}
          >
            Réessayer
          </button>
        </p>
      ) : !hasComparison ? (
        <p className={styles.note}>
          Données insuffisantes pour comparer le joueur à son poste dans ce
          périmètre.
        </p>
      ) : partial ? (
        <p className={styles.note}>
          Un tiret indique une mesure ou un rang indisponible.
        </p>
      ) : null}
    </section>
  );
}
