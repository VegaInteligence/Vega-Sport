import React from "react";
import { isNumber, number } from "../services/format.js";
import { trendExtent } from "../services/trend-chart.js";
const COLORS = ["#3b8eff", "#bc8a37", "#a579df", "#dc6d7a"];
export function ResearchRadar({
  axes,
  series,
  title = "Profil en centiles",
  context = "",
}) {
  const cx = 200,
    cy = 170,
    radius = 112,
    count = Math.max(3, axes.length);
  const point = (i, value) => [
    cx +
      (Math.cos(-Math.PI / 2 + (2 * Math.PI * i) / count) * radius * value) /
        100,
    cy +
      (Math.sin(-Math.PI / 2 + (2 * Math.PI * i) / count) * radius * value) /
        100,
  ];
  const hasGaps = series.some(
    (item) =>
      axes.some((axis) => isNumber(item.values[axis.key])) &&
      axes.some((axis) => !isNumber(item.values[axis.key])),
  );
  return (
    <figure className="research-chart">
      <svg viewBox="0 0 400 350" role="img" aria-label={title}>
        <title>{title}</title>
        <desc>{context}. Les valeurs absentes ne sont pas tracées.</desc>
        {[25, 50, 75, 100].map((level) => (
          <polygon
            key={level}
            points={Array.from({ length: count }, (_, i) =>
              point(i, level).join(","),
            ).join(" ")}
            fill="none"
            className="radar-grid"
          />
        ))}
        {axes.map((axis, i) => {
          const p = point(i, 100),
            text = point(i, 122);
          return (
            <g key={axis.key}>
              <line
                x1={cx}
                y1={cy}
                x2={p[0]}
                y2={p[1]}
                className="radar-grid"
              />
              <text
                x={text[0]}
                y={text[1]}
                textAnchor={
                  Math.abs(text[0] - cx) < 5
                    ? "middle"
                    : text[0] > cx
                      ? "start"
                      : "end"
                }
                dominantBaseline="central"
                className="research-chart-label"
              >
                {axis.label}
              </text>
            </g>
          );
        })}
        {series.map((item, n) => (
          <g key={item.name}>
            {axes.every((axis) => isNumber(item.values[axis.key])) && (
              <polygon
                points={axes
                  .map((axis, i) => point(i, item.values[axis.key]).join(","))
                  .join(" ")}
                fill={COLORS[n % 4]}
                fillOpacity=".10"
                stroke={COLORS[n % 4]}
                strokeWidth="2"
              />
            )}
            {!axes.every((axis) => isNumber(item.values[axis.key])) &&
              axes.map((axis, i) => {
                const next = (i + 1) % axes.length;
                const from = item.values[axis.key];
                const to = item.values[axes[next].key];
                if (!isNumber(from) || !isNumber(to)) return null;
                const start = point(i, from),
                  end = point(next, to);
                return (
                  <line
                    key={`${axis.key}:${axes[next].key}`}
                    x1={start[0]}
                    y1={start[1]}
                    x2={end[0]}
                    y2={end[1]}
                    stroke={COLORS[n % 4]}
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                );
              })}
            {axes.map((axis, i) =>
              isNumber(item.values[axis.key]) ? (
                <circle
                  key={axis.key}
                  cx={point(i, item.values[axis.key])[0]}
                  cy={point(i, item.values[axis.key])[1]}
                  r="3"
                  fill={COLORS[n % 4]}
                >
                  <title>{`${item.name} · ${axis.label} : ${number(item.values[axis.key])}e centile`}</title>
                </circle>
              ) : null,
            )}
          </g>
        ))}
      </svg>
      <figcaption>
        <span className="research-chart-legend">
          {series.map((item, i) => (
            <span key={item.name}>
              <i style={{ background: COLORS[i % 4] }} />
              {item.name}
            </span>
          ))}
        </span>
        {hasGaps && <small>Le tracé s’interrompt si une donnée manque.</small>}
      </figcaption>
    </figure>
  );
}
export function ResearchTrend({ points, label, bounds, decimals = 2 }) {
  const extent = trendExtent(points, bounds);
  if (!extent)
    return (
      <p className="club-note">Aucune valeur renseignée pour ce graphique.</p>
    );
  const { low, high } = extent;
  const x = (i) =>
      points.length === 1 ? 360 : 65 + (i * 590) / (points.length - 1),
    y = (v) => 195 - ((v - low) / (high - low)) * 150;
  const step = Math.max(1, Math.ceil((points.length - 1) / 5));
  const tickDecimals = Math.min(
    4,
    Math.max(0, Math.ceil(-Math.log10((high - low) / 3)) + 1),
  );
  const description = points
    .map(
      (p) =>
        `${p.label} : ${isNumber(p.value) ? number(p.value, decimals) : "non renseigné"}`,
    )
    .join(" ; ");
  return (
    <figure className="research-chart research-trend">
      <figcaption>
        <strong>{label}</strong>
        <span>Échelle adaptée aux valeurs renseignées</span>
      </figcaption>
      <div className="research-trend-plot" tabIndex={0}>
        <svg viewBox="0 0 720 240" role="img" aria-label={label}>
          <title>{label}</title>
          <desc>
            {description}. Les valeurs manquantes interrompent la courbe.
          </desc>
          {[0, 1, 2, 3].map((i) => {
            const value = low + ((high - low) * i) / 3;
            return (
              <g key={i}>
                <line
                  x1="65"
                  y1={y(value)}
                  x2="655"
                  y2={y(value)}
                  className="radar-grid"
                />
                <text
                  x="54"
                  y={y(value)}
                  textAnchor="end"
                  dominantBaseline="central"
                  className="research-chart-label"
                >
                  {number(value, tickDecimals)}
                </text>
              </g>
            );
          })}
          {points.map((p, i) => (
            <g key={`${p.label}:${i}`}>
              {isNumber(p.value) && (
                <>
                  {i > 0 && isNumber(points[i - 1].value) && (
                    <line
                      x1={x(i - 1)}
                      y1={y(points[i - 1].value)}
                      x2={x(i)}
                      y2={y(p.value)}
                      stroke="var(--accent)"
                      strokeWidth="2.5"
                    />
                  )}
                  <circle
                    cx={x(i)}
                    cy={y(p.value)}
                    r="4.5"
                    fill="var(--accent)"
                  >
                    <title>{`${p.label} : ${number(p.value, decimals)}`}</title>
                  </circle>
                </>
              )}
              {(i === 0 || i === points.length - 1 || i % step === 0) && (
                <text
                  x={x(i)}
                  y="220"
                  textAnchor="middle"
                  className="research-chart-label"
                >
                  {p.label}
                </text>
              )}
            </g>
          ))}
        </svg>
      </div>
    </figure>
  );
}
