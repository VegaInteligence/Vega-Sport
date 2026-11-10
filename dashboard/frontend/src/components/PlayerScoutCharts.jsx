"use client";
import React, { useId, useRef, useState } from "react";
import s from "./PlayerScoutCharts.module.css";

export const chartTokens = s.root;

/* ---------------------------------------------------------------- format */

export function fmt(value, decimals = 0, { signed = false, unit = "" } = {}) {
  if (value == null || Number.isNaN(value)) return "—";
  const text = Number(value).toLocaleString("fr-FR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  const sign = signed && value > 0 ? "+" : "";
  return `${sign}${text}${unit ? (unit.startsWith("%") ? " %" : ` ${unit}`) : ""}`;
}

export const ordinal = (rank) => (rank === 1 ? "1er" : `${rank}e`);

/* ------------------------------------------------------------------ tone */

export function tone(percentile) {
  if (percentile == null) return "mid";
  if (percentile >= 80) return "pos-2";
  if (percentile >= 60) return "pos-1";
  if (percentile >= 40) return "mid";
  if (percentile >= 20) return "neg-1";
  return "neg-2";
}
export const toneVar = (percentile) => `var(--mq-${tone(percentile)})`;
export const toneClass = (percentile) => s[`tone-${tone(percentile)}`];

export function PercentileBadge({
  value,
  prefix = "P",
  className = "",
  label,
  title,
}) {
  return (
    <span
      className={`${s.badge} ${toneClass(value)} ${className}`}
      title={
        title ?? `Centile ${value} : meilleur que ${value} % de la cohorte`
      }
    >
      {label ?? `${prefix}${value}`}
    </span>
  );
}

export function PercentileBar({ value }) {
  return (
    <div className={`${s.pbar} ${toneClass(value)}`} aria-hidden="true">
      <div className={s.pbarFill} style={{ width: `${value}%` }} />
      <div className={s.pbarMedian} />
    </div>
  );
}

export function ToneLegend({ label = "Centile" }) {
  const steps = [
    [90, "≥ 80"],
    [70, "60–79"],
    [50, "40–59"],
    [30, "20–39"],
    [10, "< 20"],
  ];
  return (
    <div className={s.legend}>
      <span>{label}</span>
      {steps.map(([value, text]) => (
        <span key={text} className={toneClass(value)}>
          <i className={s.swatch} />
          {text}
        </span>
      ))}
    </div>
  );
}

export function SeriesLegend({ series }) {
  return (
    <div className={s.legend}>
      {series.map((item) => (
        <span key={item.name} style={{ "--tone": item.color }}>
          <i className={item.dashed ? s.swatchDash : s.swatchLine} />
          {item.name}
        </span>
      ))}
    </div>
  );
}

export function Legend({ items }) {
  return (
    <div className={s.legend}>
      {items.map(([kind, text, color]) => (
        <span key={text} style={color ? { "--tone": color } : undefined}>
          <i className={s[kind]} />
          {text}
        </span>
      ))}
    </div>
  );
}

/* --------------------------------------------------------------- tooltip */

function useTip() {
  const ref = useRef(null);
  const [tip, setTip] = useState(null);
  const place = (x, y, content) => {
    const width = ref.current?.clientWidth || 0;
    setTip({ x: Math.max(80, Math.min(width - 80, x)), y, content });
  };
  return {
    ref,
    tip,
    hide: () => setTip(null),
    show(event, content) {
      const box = ref.current?.getBoundingClientRect();
      if (box)
        place(event.clientX - box.left, event.clientY - box.top, content);
    },
    showFor(element, content) {
      const box = ref.current?.getBoundingClientRect();
      const mark = element.getBoundingClientRect();
      if (box)
        place(
          mark.left + mark.width / 2 - box.left,
          mark.top - box.top,
          content,
        );
    },
  };
}

function Tip({ tip }) {
  if (!tip) return null;
  return (
    <div className={s.tooltip} style={{ left: tip.x, top: tip.y }}>
      {tip.content}
    </div>
  );
}

export function TipBody({ title, rows }) {
  return (
    <>
      <strong>{title}</strong>
      {rows.map(([label, value]) => (
        <span key={label}>
          {label}
          <b>{value}</b>
        </span>
      ))}
    </>
  );
}

/** Spread on a focusable SVG mark: hover and keyboard focus show the same tip. */
function tipHandlers(t, content, onActive) {
  return {
    tabIndex: 0,
    onPointerMove: (event) => {
      t.show(event, content);
      onActive?.(true);
    },
    onPointerLeave: () => {
      t.hide();
      onActive?.(false);
    },
    onFocus: (event) => {
      t.showFor(event.currentTarget, content);
      onActive?.(true);
    },
    onBlur: () => {
      t.hide();
      onActive?.(false);
    },
  };
}

/* ------------------------------------------------------------- geometry */

const polar = (cx, cy, r, angle) => [
  cx + r * Math.cos(angle),
  cy + r * Math.sin(angle),
];
function wedge(cx, cy, r0, r1, a0, a1) {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const [x0, y0] = polar(cx, cy, r1, a0);
  const [x1, y1] = polar(cx, cy, r1, a1);
  const [x2, y2] = polar(cx, cy, r0, a1);
  const [x3, y3] = polar(cx, cy, r0, a0);
  return `M${x0} ${y0}A${r1} ${r1} 0 ${large} 1 ${x1} ${y1}L${x2} ${y2}A${r0} ${r0} 0 ${large} 0 ${x3} ${y3}Z`;
}
function wrap(label, width = 14) {
  const lines = [];
  for (const word of label.split(" ")) {
    const last = lines[lines.length - 1];
    if (last && (last + " " + word).length <= width)
      lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return lines;
}
function AxisLabel({ x, y, angle, lines, className, extra }) {
  const cos = Math.cos(angle),
    sin = Math.sin(angle);
  const anchor = cos > 0.25 ? "start" : cos < -0.25 ? "end" : "middle";
  const total = lines.length + (extra ? 1 : 0);
  const shift =
    sin < -0.3 ? -(total - 1) * 13 : sin > 0.3 ? 0 : -((total - 1) * 13) / 2;
  return (
    <text x={x} y={y + shift + 4} textAnchor={anchor} className={className}>
      {lines.map((line, index) => (
        <tspan key={line} x={x} dy={index ? 13 : 0}>
          {line}
        </tspan>
      ))}
      {extra && (
        <tspan x={x} dy={13} className={s.valueText}>
          {extra}
        </tspan>
      )}
    </text>
  );
}

/* --------------------------------------------------------- pizza chart */

export function PercentilePizza({ items, cohort, size = 560 }) {
  const t = useTip();
  const [active, setActive] = useState(null);
  const c = size / 2,
    r0 = size * 0.065,
    r1 = size * 0.34;
  const step = (Math.PI * 2) / items.length;
  const radius = (p) => r0 + ((r1 - r0) * p) / 100;
  return (
    <div className={s.chart} ref={t.ref}>
      <svg
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label="Centiles au poste par indicateur"
      >
        {[25, 50, 75, 100].map((p) => (
          <circle
            key={p}
            cx={c}
            cy={c}
            r={radius(p)}
            className={p === 50 ? s.gridStrong : s.grid}
          />
        ))}
        {items.map((item, i) => {
          const a0 = -Math.PI / 2 + i * step,
            a1 = a0 + step,
            mid = (a0 + a1) / 2;
          const ranked = item.percentile != null;
          const end = radius(ranked ? item.percentile : 0);
          const inside = ranked && item.percentile >= 80;
          const [lx, ly] = polar(
            c,
            c,
            inside ? end - 15 : Math.min(end + 14, r1 - 2),
            mid,
          );
          const [tx, ty] = polar(c, c, r1 + 20, mid);
          const content = (
            <TipBody
              title={item.label}
              rows={[
                [
                  "Valeur / 90",
                  fmt(item.value, item.decimals, {
                    signed: item.signed,
                    unit: item.unit,
                  }),
                ],
                ["Centile", ranked ? item.percentile : "non classé"],
                ...(item.rank
                  ? [
                      [
                        "Rang",
                        `${ordinal(item.rank)} / ${item.peers || cohort}`,
                      ],
                    ]
                  : []),
              ]}
            />
          );
          return (
            <g
              key={item.key}
              className={active && active !== item.key ? s.dimmed : undefined}
              {...tipHandlers(t, content, (on) =>
                setActive(on ? item.key : null),
              )}
              aria-label={`${item.label} : ${ranked ? `centile ${item.percentile}` : "non classé"}`}
              style={{ outline: "none" }}
            >
              <path
                d={wedge(c, c, r0, r1, a0, a1)}
                className={s.track}
                stroke="var(--mq-gap)"
                strokeWidth="2"
              />
              {ranked && (
                <path
                  d={wedge(c, c, r0, end, a0, a1)}
                  fill={`color-mix(in srgb, ${toneVar(item.percentile)} 84%, var(--mq-gap))`}
                  stroke="var(--mq-gap)"
                  strokeWidth="2"
                />
              )}
              <text
                x={lx}
                y={ly + 4}
                textAnchor="middle"
                className={inside ? s.valueTextOnFill : s.valueText}
              >
                {ranked ? item.percentile : "—"}
              </text>
              <AxisLabel
                x={tx}
                y={ty}
                angle={mid}
                lines={wrap(item.label)}
                className={s.axisTextStrong}
              />
            </g>
          );
        })}
        <circle cx={c} cy={c} r={r0 - 1} fill="var(--mq-gap)" />
      </svg>
      <Tip tip={t.tip} />
    </div>
  );
}

/* --------------------------------------------------------- radar chart */

export function RadarChart({ axes, series, size = 420, showValues = true }) {
  const t = useTip();
  const [active, setActive] = useState(null);
  const c = size / 2,
    r = size * 0.32;
  const step = (Math.PI * 2) / axes.length;
  const angle = (i) => -Math.PI / 2 + i * step;
  const point = (i, value) => polar(c, c, (r * value) / 100, angle(i));
  const ring = (p) => axes.map((_, i) => point(i, p).join(",")).join(" ");
  const main = series[0];
  return (
    <div className={s.chart} ref={t.ref}>
      <svg
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label="Profil par dimension"
      >
        {[25, 50, 75, 100].map((p) => (
          <polygon
            key={p}
            points={ring(p)}
            className={p === 100 ? s.gridStrong : s.grid}
          />
        ))}
        {axes.map((axis, i) => {
          const [x, y] = point(i, 100);
          return (
            <line
              key={axis.key}
              x1={c}
              y1={c}
              x2={x}
              y2={y}
              className={active === axis.key ? s.gridStrong : s.grid}
            />
          );
        })}
        {[...series].reverse().map((item) => (
          <polygon
            key={item.name}
            points={axes
              .map((axis, i) => point(i, item.values[axis.key] ?? 0).join(","))
              .join(" ")}
            fill={item.dashed ? "none" : item.color}
            fillOpacity={item === main ? 0.16 : 0.06}
            stroke={item.dashed ? "var(--muted)" : item.color}
            strokeWidth="2"
            strokeDasharray={item.dashed ? "5 4" : undefined}
            strokeLinejoin="round"
          />
        ))}
        {series
          .filter((item) => !item.dashed)
          .map((item) =>
            axes.map((axis, i) => {
              const [x, y] = point(i, item.values[axis.key] ?? 0);
              return (
                <circle
                  key={`${item.name}-${axis.key}`}
                  cx={x}
                  cy={y}
                  r={active === axis.key ? 5.5 : 4}
                  fill={item.color}
                  stroke="var(--mq-gap)"
                  strokeWidth="2"
                />
              );
            }),
          )}
        {axes.map((axis, i) => {
          const a = angle(i);
          const [tx, ty] = polar(c, c, r + 22, a);
          const content = (
            <TipBody
              title={axis.label}
              rows={series.map((item) => [
                item.name,
                item.values[axis.key] ?? "—",
              ])}
            />
          );
          const a0 = a - step / 2,
            a1 = a + step / 2;
          return (
            <g
              key={axis.key}
              {...tipHandlers(t, content, (on) =>
                setActive(on ? axis.key : null),
              )}
              style={{ outline: "none" }}
            >
              <path d={wedge(c, c, 0.1, r + 16, a0, a1)} className={s.hit} />
              <AxisLabel
                x={tx}
                y={ty}
                angle={a}
                lines={wrap(axis.label, 16)}
                className={s.axisTextStrong}
                extra={showValues && main ? `P${main.values[axis.key]}` : null}
              />
            </g>
          );
        })}
      </svg>
      <Tip tip={t.tip} />
    </div>
  );
}

/* --------------------------------------------------- distribution strip */

export function DistributionStrip({ metric, showLabels = true }) {
  const t = useTip();
  const [p10, p25, p50, p75, p90] = metric.dist;
  const pad = (p90 - p10) * 0.14;
  const lo = Math.min(p10, metric.value) - pad,
    hi = Math.max(p90, metric.value) + pad;
  const pos = (v) => `${((v - lo) / (hi - lo)) * 100}%`;
  const f = (v) => fmt(v, metric.decimals, { signed: metric.signed });
  // Keep the median label; drop an outer label that would collide with it.
  const room = (a, b) => Math.abs((a - b) / (hi - lo)) >= 0.3;
  const labels = [
    ...(room(p10, p50) ? [["P10", p10]] : []),
    ["Méd.", p50],
    ...(room(p90, p50) ? [["P90", p90]] : []),
  ];
  const content = (
    <TipBody
      title={metric.label}
      rows={[
        ["Joueur", f(metric.value)],
        ["P90", f(p90)],
        ["P75", f(p75)],
        ["Médiane", f(p50)],
        ["P25", f(p25)],
        ["P10", f(p10)],
      ]}
    />
  );
  return (
    <div className={s.chart} ref={t.ref}>
      <div className={`${s.strip} ${toneClass(metric.percentile)}`}>
        <div
          className={s.stripTrack}
          {...tipHandlers(t, content)}
          aria-label={`${metric.label} : ${f(metric.value)}, médiane ${f(p50)}`}
          style={{ outline: "none" }}
        >
          <div
            className={s.stripLine}
            style={{ left: pos(p10), width: `calc(${pos(p90)} - ${pos(p10)})` }}
          />
          <div
            className={s.stripBand}
            style={{ left: pos(p25), width: `calc(${pos(p75)} - ${pos(p25)})` }}
          />
          <div className={s.stripTick} style={{ left: pos(p10) }} />
          <div className={s.stripTick} style={{ left: pos(p90) }} />
          <div className={s.stripMedian} style={{ left: pos(p50) }} />
          <div className={s.stripMarker} style={{ left: pos(metric.value) }} />
        </div>
        {showLabels && (
          <div className={s.stripLabels} aria-hidden="true">
            {labels.map(([text, value]) => (
              <span key={text} style={{ left: pos(value) }}>
                {text} <b>{f(value)}</b>
              </span>
            ))}
          </div>
        )}
      </div>
      <Tip tip={t.tip} />
    </div>
  );
}

/* ---------------------------------------------------------------- pitch */

function PitchLines() {
  const line = {
    fill: "none",
    stroke: "var(--mq-pitch-line)",
    strokeWidth: 0.35,
  };
  return (
    <g>
      <rect x="0" y="0" width="105" height="68" fill="var(--mq-pitch)" />
      <rect x="0.5" y="0.5" width="104" height="67" {...line} />
      <line x1="52.5" y1="0.5" x2="52.5" y2="67.5" {...line} />
      <circle cx="52.5" cy="34" r="9.15" {...line} />
      <rect x="0.5" y="13.85" width="16" height="40.3" {...line} />
      <rect x="88.5" y="13.85" width="16" height="40.3" {...line} />
      <rect x="0.5" y="24.85" width="5" height="18.3" {...line} />
      <rect x="99.5" y="24.85" width="5" height="18.3" {...line} />
      <path d="M16.5 26.7A9.15 9.15 0 0 1 16.5 41.3" {...line} />
      <path d="M88.5 26.7A9.15 9.15 0 0 0 88.5 41.3" {...line} />
    </g>
  );
}

export function PositionsPitch({ positions, total }) {
  const t = useTip();
  const max = Math.max(...positions.map((p) => p.minutes));
  return (
    <div className={s.chart} ref={t.ref}>
      <svg
        viewBox="0 0 105 68"
        role="img"
        aria-label="Postes occupés, attaque vers la droite"
      >
        <PitchLines />
        <text
          x="52.5"
          y="65.5"
          textAnchor="middle"
          fontSize="2.6"
          fill="var(--muted-light)"
        >
          Sens du jeu →
        </text>
        {positions.map((p) => {
          const x = (p.x / 100) * 105,
            y = (p.y / 100) * 68;
          const radius = 2.6 + 3.4 * Math.sqrt(p.minutes / max);
          const share = Math.round((p.minutes / total) * 100);
          const content = (
            <TipBody
              title={p.label}
              rows={[
                ["Minutes", fmt(p.minutes)],
                ["Part du temps", `${share} %`],
              ]}
            />
          );
          return (
            <g
              key={p.code}
              {...tipHandlers(t, content)}
              style={{ outline: "none" }}
            >
              <circle
                cx={x}
                cy={y}
                r={radius}
                fill="var(--accent)"
                fillOpacity={0.25 + 0.75 * (p.minutes / max)}
                stroke="var(--mq-pitch)"
                strokeWidth="0.6"
              />
              <text
                x={x}
                y={y + 1}
                textAnchor="middle"
                fontSize="2.8"
                fontWeight="700"
                fill="var(--mq-on-strong)"
              >
                {p.code}
              </text>
            </g>
          );
        })}
      </svg>
      <Tip tip={t.tip} />
    </div>
  );
}

export function HeatmapPitch({ grid }) {
  const rows = grid.length,
    cols = grid[0].length;
  const max = Math.max(...grid.flat());
  const w = 105 / cols,
    h = 68 / rows;
  return (
    <div className={s.chart}>
      <svg
        viewBox="0 0 105 68"
        role="img"
        aria-label="Zones de présence, attaque vers la droite"
      >
        <PitchLines />
        {grid.map((row, y) =>
          row.map((value, x) =>
            value ? (
              <rect
                key={`${x}-${y}`}
                x={x * w + 0.4}
                y={y * h + 0.4}
                width={w - 0.8}
                height={h - 0.8}
                rx="1.2"
                fill="var(--accent)"
                fillOpacity={(value / max) * 0.85}
              />
            ) : null,
          ),
        )}
      </svg>
    </div>
  );
}

/* ------------------------------------------------------------- shot map */

const SHOT_LABELS = {
  goal: "But",
  saved: "Arrêté",
  off: "Non cadré",
  blocked: "Contré",
};

export function ShotMap({ shots }) {
  const t = useTip();
  const line = {
    fill: "none",
    stroke: "var(--mq-pitch-line)",
    strokeWidth: 0.35,
  };
  return (
    <div className={s.chart} ref={t.ref}>
      <svg
        viewBox="0 0 68 40"
        role="img"
        aria-label="Carte des tirs, taille selon les xG"
      >
        <rect x="0" y="0" width="68" height="40" fill="var(--mq-pitch)" />
        <rect x="0.5" y="0.5" width="67" height="39" {...line} />
        <rect x="13.85" y="0.5" width="40.3" height="16" {...line} />
        <rect x="24.85" y="0.5" width="18.3" height="5" {...line} />
        <path d="M26.7 16.5A9.15 9.15 0 0 0 41.3 16.5" {...line} />
        <line
          x1="30.34"
          y1="0.5"
          x2="37.66"
          y2="0.5"
          stroke="var(--ink)"
          strokeWidth="0.9"
        />
        {[...shots]
          .sort((a, b) => b.xg - a.xg)
          .map((shot, i) => {
            const radius = 0.7 + Math.sqrt(shot.xg) * 2.6;
            const goal = shot.outcome === "goal";
            const content = (
              <TipBody
                title={SHOT_LABELS[shot.outcome]}
                rows={[
                  ["xG", fmt(shot.xg, 2)],
                  ["Distance", `${shot.x} m`],
                ]}
              />
            );
            return (
              <circle
                key={i}
                cx={shot.y}
                cy={shot.x}
                r={radius}
                fill={goal ? "var(--accent)" : "transparent"}
                stroke={
                  goal
                    ? "var(--mq-pitch)"
                    : shot.outcome === "saved"
                      ? "var(--ink)"
                      : "var(--muted-light)"
                }
                strokeOpacity={goal ? 1 : shot.outcome === "saved" ? 0.8 : 0.6}
                strokeWidth={goal ? 0.4 : 0.3}
                {...tipHandlers(t, content)}
                style={{ outline: "none" }}
              />
            );
          })}
      </svg>
      <Tip tip={t.tip} />
    </div>
  );
}

/* ------------------------------------------------------ injury timeline */

const MONTHS = [
  "Juil",
  "Août",
  "Sep",
  "Oct",
  "Nov",
  "Déc",
  "Jan",
  "Fév",
  "Mar",
  "Avr",
  "Mai",
  "Juin",
];
const day = 86400000;
const parse = (value) => new Date(`${value}T00:00:00Z`).getTime();
export const dateFr = (value) =>
  new Date(`${value}T00:00:00Z`).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

export function InjuryTimeline({ seasons, injuries }) {
  const t = useTip();
  return (
    <div className={s.chart} ref={t.ref}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "52px 1fr",
          gap: "6px 10px",
          alignItems: "center",
        }}
      >
        <span />
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(12, 1fr)",
            color: "var(--muted-light)",
            fontSize: "var(--text-2xs)",
          }}
        >
          {MONTHS.map((month) => (
            <span key={month} style={{ textAlign: "center" }}>
              {month}
            </span>
          ))}
        </div>
        {seasons.map((season) => {
          const startYear = Number(season.slice(0, 4));
          const origin = Date.UTC(startYear, 6, 1);
          const items = injuries.filter((item) => item.season === season);
          return (
            <React.Fragment key={season}>
              <span
                style={{
                  color: "var(--muted)",
                  fontSize: "var(--text-xs)",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {season.replace(/^20(\d\d)\/(\d\d)$/, "$1-$2")}
              </span>
              <div
                style={{
                  position: "relative",
                  height: 18,
                  borderRadius: 4,
                  background:
                    "repeating-linear-gradient(90deg, var(--mq-track) 0 calc(100% / 12 - 1px), var(--mq-gap) calc(100% / 12 - 1px) calc(100% / 12))",
                }}
              >
                {items.map((item) => {
                  const start = (parse(item.start) - origin) / day,
                    length = (parse(item.end) - parse(item.start)) / day + 1;
                  const content = (
                    <TipBody
                      title={item.label}
                      rows={[
                        ["Du", dateFr(item.start)],
                        ["Au", dateFr(item.end)],
                        ["Durée", `${length} j`],
                        ["Matchs manqués", item.missed],
                      ]}
                    />
                  );
                  return (
                    <div
                      key={item.start}
                      {...tipHandlers(t, content)}
                      aria-label={`${item.label}, ${length} jours`}
                      style={{
                        position: "absolute",
                        top: 3,
                        bottom: 3,
                        left: `${(start / 365) * 100}%`,
                        width: `max(6px, ${(length / 365) * 100}%)`,
                        borderRadius: 3,
                        background:
                          item.type === "suspension"
                            ? "var(--muted-light)"
                            : "var(--mq-neg-2)",
                        outline: "none",
                        cursor: "default",
                      }}
                    />
                  );
                })}
              </div>
            </React.Fragment>
          );
        })}
      </div>
      <Tip tip={t.tip} />
    </div>
  );
}

export function injuryTotals(injuries, currentSeason) {
  const days = injuries.reduce(
    (sum, item) => sum + (parse(item.end) - parse(item.start)) / day + 1,
    0,
  );
  return {
    count: injuries.length,
    weeks: Math.round(days / 7),
    current: injuries
      .filter((item) => item.season === currentSeason)
      .reduce(
        (sum, item) => sum + (parse(item.end) - parse(item.start)) / day + 1,
        0,
      ),
    missed: injuries.reduce((sum, item) => sum + item.missed, 0),
  };
}

/* ----------------------------------------------------------- line chart */

export function LineChart({
  points,
  domain,
  ticks,
  height = 200,
  width = 640,
  format = (v) => fmt(v),
  tip,
  reference,
  area = true,
  labelEvery = 1,
  color = "var(--accent)",
  ariaLabel,
  xValue,
  xTicks,
  leftMargin = 36,
  markers = [],
}) {
  const t = useTip();
  const [active, setActive] = useState(null);
  const m = { top: 14, right: 16, bottom: 26, left: leftMargin };
  const axisGap = markers.length ? 12 : 8;
  const iw = width - m.left - m.right,
    ih = height - m.top - m.bottom;
  const xValues = xValue ? points.map(xValue) : points.map((_, i) => i);
  const xMin = Math.min(...xValues);
  const xRange = Math.max(...xValues) - xMin;
  const xAt = (value) =>
    m.left + iw * (xRange > 0 ? (value - xMin) / xRange : 0.5);
  const x = (i) => xAt(xValues[i]);
  const y = (v) =>
    m.top + ih - ((v - domain[0]) / (domain[1] - domain[0])) * ih;
  const line = points
    .map((p, i) => `${i ? "L" : "M"}${x(i)} ${y(p.y)}`)
    .join("");
  const fill = `${line}L${x(points.length - 1)} ${m.top + ih}L${x(0)} ${m.top + ih}Z`;
  const gradient = `mq-grad-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const pointTip = (i) =>
    tip ? (
      tip(points[i], i)
    ) : (
      <TipBody title={points[i].x} rows={[["Valeur", format(points[i].y)]]} />
    );
  const pick = (event) => {
    const box = event.currentTarget.ownerSVGElement.getBoundingClientRect();
    const vx = ((event.clientX - box.left) / box.width) * width;
    let best = 0;
    points.forEach((_, i) => {
      if (Math.abs(x(i) - vx) < Math.abs(x(best) - vx)) best = i;
    });
    setActive(best);
    t.show(event, pointTip(best));
  };
  return (
    <div className={s.chart} ref={t.ref}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel}>
        <defs>
          <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity="0.22" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((v) => (
          <g key={v}>
            <line
              x1={m.left}
              x2={width - m.right}
              y1={y(v)}
              y2={y(v)}
              className={s.grid}
            />
            <text
              x={m.left - axisGap}
              y={y(v) + 4}
              textAnchor="end"
              className={s.axisText}
            >
              {format(v)}
            </text>
          </g>
        ))}
        {reference && (
          <g>
            <line
              x1={m.left}
              x2={width - m.right}
              y1={y(reference.y)}
              y2={y(reference.y)}
              stroke="var(--muted)"
              strokeDasharray="4 4"
            />
            <text
              x={width - m.right}
              y={y(reference.y) - 6}
              textAnchor="end"
              className={s.axisText}
            >
              {reference.label}
            </text>
          </g>
        )}
        {area && <path d={fill} fill={`url(#${gradient})`} />}
        <path
          d={line}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {active != null && (
          <line
            x1={x(active)}
            x2={x(active)}
            y1={m.top}
            y2={m.top + ih}
            className={s.gridStrong}
          />
        )}
        {points.map((p, i) => (
          <circle
            key={i}
            cx={x(i)}
            cy={y(p.y)}
            r={active === i ? 5 : 3.5}
            fill={color}
            stroke="var(--mq-gap)"
            strokeWidth="2"
          />
        ))}
        {markers.map(({ index, name, label }) => (
          <g
            key={index}
            role="img"
            aria-label={`${name}, ${points[index].x}, ${format(points[index].y)}`}
            className={s.lineMarker}
            {...tipHandlers(t, pointTip(index), (on) => setActive(on ? index : null))}
          >
            <circle cx={x(index)} cy={y(points[index].y)} r="8.5" />
            <text x={x(index)} y={y(points[index].y)}>{label}</text>
          </g>
        ))}
        {xTicks
          ? xTicks.map(({ value, label }, i) => {
              let anchor = "middle";
              if (xTicks.length > 1 && i === 0) anchor = "start";
              if (i > 0 && i === xTicks.length - 1) anchor = "end";
              return (
                <text
                  key={value}
                  x={xAt(value)}
                  y={height - 6}
                  textAnchor={anchor}
                  className={s.axisText}
                >
                  {label}
                </text>
              );
            })
          : points.map((p, i) =>
              i % labelEvery === 0 || i === points.length - 1 ? (
                <text
                  key={`l${i}`}
                  x={x(i)}
                  y={height - 6}
                  textAnchor="middle"
                  className={s.axisText}
                >
                  {p.x}
                </text>
              ) : null,
            )}
        <rect
          x={m.left - 10}
          y={m.top}
          width={iw + 20}
          height={ih}
          className={s.hit}
          onPointerDown={pick}
          onPointerMove={pick}
          onPointerLeave={() => {
            setActive(null);
            t.hide();
          }}
        />
      </svg>
      <Tip tip={t.tip} />
    </div>
  );
}

/* --------------------------------------------------------- segmented bar */

export function SegmentBar({ items, format }) {
  const t = useTip();
  const total = items.reduce((sum, item) => sum + item.value, 0);
  const shade = (i) =>
    `color-mix(in srgb, var(--accent) ${30 + (70 * i) / Math.max(1, items.length - 1)}%, var(--surface))`;
  return (
    <div className={s.chart} ref={t.ref}>
      <div className={s.segments}>
        {items.map((item, i) => (
          <div
            key={item.label}
            style={{ flex: item.value, "--tone": shade(i), outline: "none" }}
            {...tipHandlers(
              t,
              <TipBody
                title={`${item.label} (${item.range})`}
                rows={[
                  ["Distance / 90", format(item.value)],
                  ["Part", `${Math.round((item.value / total) * 100)} %`],
                ]}
              />,
            )}
            aria-label={`${item.label} : ${format(item.value)}`}
          />
        ))}
      </div>
      <div className={s.legend} style={{ marginTop: 10 }}>
        {items.map((item, i) => (
          <span key={item.label} style={{ "--tone": shade(i) }}>
            <i className={s.swatch} />
            {item.label}{" "}
            <b style={{ color: "var(--ink-strong)", fontWeight: 600 }}>
              {format(item.value)}
            </b>
          </span>
        ))}
      </div>
      <Tip tip={t.tip} />
    </div>
  );
}

/* ---------------------------------------------------------------- gauge */

export function Gauge({ value, label, size = 180 }) {
  const c = size / 2,
    r = size * 0.4;
  const a0 = Math.PI * 0.8,
    a1 = Math.PI * 2.2;
  const at = a0 + ((a1 - a0) * value) / 100;
  const arc = (from, to) => {
    const [x0, y0] = polar(c, c, r, from);
    const [x1, y1] = polar(c, c, r, to);
    return `M${x0} ${y0}A${r} ${r} 0 ${to - from > Math.PI ? 1 : 0} 1 ${x1} ${y1}`;
  };
  return (
    <svg
      viewBox={`0 0 ${size} ${size * 0.86}`}
      role="img"
      aria-label={`${label} : ${value} sur 100`}
      style={{ display: "block", width: "100%", height: "auto" }}
    >
      <path
        d={arc(a0, a1)}
        fill="none"
        stroke="var(--mq-track)"
        strokeWidth="10"
        strokeLinecap="round"
      />
      <path
        d={arc(a0, at)}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="10"
        strokeLinecap="round"
      />
      <text x={c} y={c + 8} textAnchor="middle" className={s.gaugeValue}>
        {value}
      </text>
      <text x={c} y={c + 28} textAnchor="middle" className={s.gaugeLabel}>
        {label}
      </text>
    </svg>
  );
}

/* ------------------------------------------------------------ sparkline */

export function Sparkline({ values, width = 84, height = 26 }) {
  const min = Math.min(...values),
    max = Math.max(...values);
  const x = (i) => 2 + (i / (values.length - 1)) * (width - 4);
  const y = (v) => height - 3 - ((v - min) / (max - min || 1)) * (height - 6);
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i)} ${y(v)}`).join("");
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      aria-hidden="true"
    >
      <path
        d={d}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle
        cx={x(values.length - 1)}
        cy={y(values[values.length - 1])}
        r="2.5"
        fill="var(--accent)"
      />
    </svg>
  );
}
