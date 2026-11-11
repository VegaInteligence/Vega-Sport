"use client";
import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Icon from "./Icon.jsx";
import { useCardFold } from "./PhoneFold.jsx";
import { useFootball } from "../hooks/FootballContext.jsx";
import { PercentileBar, toneVar } from "./PlayerScoutCharts.jsx";
import { RankingTrigger } from "./RankingDialog.jsx";
import {
  METRICS,
  SITUATION_LABELS,
  STYLE_AXES,
  formatMetric,
  rolling,
} from "../services/club-scout.js";
import s from "./ClubScout.module.css";

export const clubStyles = s;

export function ClubLoading({ state, compact = false }) {
  if (state.status === "error")
    return (
      <div className={s.loading} role="alert">
        <strong>Lecture impossible</strong>
        <span>{state.error}</span>
      </div>
    );
  const p = state.progress;
  const share =
    p?.step === "league" && p.total ? 20 + (80 * p.done) / p.total : p ? 10 : 2;
  return (
    <div
      className={s.loading}
      data-compact={compact || undefined}
      role="status"
    >
      <strong>
        {p?.step === "league"
          ? `Construction du référentiel ${p.league ? `· ${p.league}` : "du championnat"}`
          : "Lecture du club"}
      </strong>
      <span>
        {p?.step === "league"
          ? `${p.done} / ${p.total} clubs lus · chaque indicateur est classé contre tout le championnat`
          : "Matchs, tirs et apparitions de la saison…"}
      </span>
      <span className={s.progress}>
        <i style={{ width: `${share}%` }} />
      </span>
    </div>
  );
}

/* ------------------------------------------------------------- basics */

/**
 * A club the base knows in the season without any match statistics: its
 * results may be known (`played`), but there is nothing to rank yet.
 */
export function ClubEmptySeason({ dossier, played = 0 }) {
  const games = `${played} match${played > 1 ? "s" : ""} joué${played > 1 ? "s" : ""}`;
  return (
    <div className={s.loading} role="status" data-empty-season="">
      <Crest club={dossier} />
      <strong>{dossier.name}</strong>
      <span>
        {[dossier.league?.name, dossier.season].filter(Boolean).join(" · ")}
      </span>
      <span>
        {played
          ? `Les résultats de cette saison sont connus (${games}), mais les statistiques de match ne sont pas disponibles pour l’instant.`
          : "Aucun match joué cette saison."}
      </span>
      {played > 0 && (
        <span>La fiche se remplira dès qu’elles le seront.</span>
      )}
    </div>
  );
}

/**
 * Plain images: the site's reveal deadline would freeze Media elements that
 * mount after a long read into their initials.
 */
export function Picture({
  name = "",
  url,
  className = "crest",
  round = false,
}) {
  const [failed, setFailed] = useState(false);
  const src = failed ? null : url;
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  return (
    <span
      className={`${className} ${s.picture}`}
      data-round={round || undefined}
      aria-hidden="true"
    >
      {src ? (
        <img
          src={src}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <span>{initials || "—"}</span>
      )}
    </span>
  );
}

export const Crest = ({ club, className = "crest" }) => (
  <Picture name={club?.name || ""} url={club?.imageUrl} className={className} />
);

/** `fold`: on a phone the card shows closed, its heading alone (PhoneFold). */
export function Card({
  title,
  text,
  action,
  children,
  className = "",
  id,
  fold = false,
}) {
  const f = useCardFold(fold, title);
  return (
    <section className={`${s.card} ${className}`} id={id} {...f.section}>
      {(title || action) && (
        <div className={s.cardHead} {...f.head}>
          <div>
            {title && <h3>{title}</h3>}
            {text && <p className={f.part || undefined}>{text}</p>}
          </div>
          {action && (
            <div className={`${s.cardAction} ${f.part}`.trim()}>{action}</div>
          )}
          {f.button}
        </div>
      )}
      {f.wrap(children)}
    </section>
  );
}

export function Kpis({ items }) {
  return (
    <div className={s.kpis}>
      {items.map(([label, value, meta, tone]) => (
        <div key={label}>
          <span>{label}</span>
          <strong className={tone ? s[tone] : undefined}>{value}</strong>
          {meta && <small>{meta}</small>}
        </div>
      ))}
    </div>
  );
}

export function FormStrip({ rows, limit = 5 }) {
  return (
    <span
      className={s.form}
      aria-label="Forme récente, du plus ancien au plus récent"
    >
      {rows.slice(-limit).map((row) => (
        <span
          key={row.match.id}
          data-result={row.result}
          title={`${dateShort(row.match.date)} · ${row.side === "home" ? "vs" : "à"} ${row.opponent.name} · ${row.gf}–${row.ga}`}
        >
          {row.result}
        </span>
      ))}
    </span>
  );
}

export function Info({ text }) {
  return text ? (
    <span className={s.info} title={text} aria-label={text}>
      i
    </span>
  ) : null;
}

export const dateShort = (value) =>
  value
    ? new Date(`${String(value).slice(0, 10)}T12:00:00Z`).toLocaleDateString(
        "fr-FR",
        {
          day: "numeric",
          month: "short",
        },
      )
    : "";
export const fmtNum = (value, digits = 0, signed = false) =>
  value == null || Number.isNaN(value)
    ? "—"
    : `${signed && value > 0 ? "+" : ""}${Number(value).toLocaleString(
        "fr-FR",
        {
          minimumFractionDigits: digits,
          maximumFractionDigits: digits,
        },
      )}`;
/** "1er", "15e"; a dash when there is no rank. */
export const ordinal = (n) => (n == null ? "—" : n === 1 ? "1er" : `${n}e`);

/* ------------------------------------------------------- metric table */

function NeutralBar({ value }) {
  return (
    <div
      style={{
        height: 6,
        borderRadius: 999,
        background: "var(--surface-subtle)",
        overflow: "hidden",
      }}
      aria-hidden="true"
    >
      <div
        style={{
          width: `${value}%`,
          height: "100%",
          background: "var(--muted-light)",
        }}
      />
    </div>
  );
}

/** Indicator, value, league median, rank and centile, one row per metric. */
export function MetricTable({ dossier, keys, club = dossier.self, caption }) {
  const total = dossier.clubs.length;
  return (
    <div className={s.tableScroll}>
      <table className={s.table}>
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            <th scope="col">Indicateur</th>
            <th scope="col">{club.name}</th>
            <th scope="col">Médiane</th>
            <th scope="col">Rang</th>
            <th scope="col">Centile</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((key) => {
            const metric = METRICS[key],
              c = club.centiles?.[key],
              rank = club.ranks?.[key];
            return (
              <tr key={key}>
                <th scope="row">
                  <RankingTrigger target={{ type: "metric", key }}>
                    {metric.label}
                    {metric.better === -1 ? " ↓" : ""}
                  </RankingTrigger>
                  <Info text={metric.info} />
                </th>
                <td>
                  {formatMetric(key, club.values[key], { total: metric.total })}
                </td>
                <td className={s.muted}>
                  {formatMetric(key, dossier.stats[key]?.median, {
                    total: metric.total,
                  })}
                </td>
                <td>{rank ? `${ordinal(rank)} / ${total}` : "—"}</td>
                <td>
                  {c == null ? (
                    "—"
                  ) : (
                    <span className={s.centileCell}>
                      {metric.better === 0 ? (
                        <NeutralBar value={c} />
                      ) : (
                        <PercentileBar value={c} />
                      )}
                      <span>{c}</span>
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* --------------------------------------------------------- phase bars */

export function PhaseBars({
  dossier,
  phases,
  club = dossier.self,
  base = false,
}) {
  const total = dossier.clubs.length;
  return (
    <div className={s.phases}>
      {phases.map((phase) => {
        const value = club.phases?.[phase.key];
        const rank =
          value == null
            ? null
            : 1 +
              dossier.clubs.filter((c) => (c.phases[phase.key] ?? -1) > value)
                .length;
        return (
          <div className={s.phase} key={phase.key}>
            <span>
              <RankingTrigger target={{ type: "phase", key: phase.key, base }}>
                {phase.label}
              </RankingTrigger>
              <small>
                {rank ? `${ordinal(rank)} sur ${total}` : "non classé"}
              </small>
            </span>
            {value == null ? <span /> : <PercentileBar value={value} />}
            <strong>{value ?? "—"}</strong>
          </div>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------- mirror bars */

/**
 * For / against reading, the core of a team: what the club produces on the
 * left, what it concedes on the right, league median as a tick on each side.
 */
export function MirrorBars({ dossier, rows, club = dossier.self }) {
  const values = dossier.clubs;
  return (
    <div className={s.mirror}>
      <div className={s.mirrorHead}>
        <span />
        <span>{club.name}</span>
        <span />
        <span>Adversaires</span>
        <span />
      </div>
      {rows.map(({ label, own, opp, digits = 1, unit = "" }) => {
        const ownValue = club.values[own],
          oppValue = club.values[opp];
        const all = values
          .flatMap((c) => [c.values[own], c.values[opp]])
          .filter((v) => v != null);
        const max = Math.max(...all, ownValue || 0, oppValue || 0) || 1;
        const ownMedian = dossier.stats[own]?.median,
          oppMedian = dossier.stats[opp]?.median;
        const pct = (v) =>
          `${Math.max(0, Math.min(100, (100 * (v || 0)) / max))}%`;
        return (
          <div className={s.mirrorRow} key={label}>
            <span>
              {fmtNum(ownValue, digits)}
              {unit}
            </span>
            <span className={s.mirrorTrack} data-side="own">
              <i style={{ width: pct(ownValue) }} />
              {ownMedian != null && (
                <b
                  style={{ right: pct(ownMedian) }}
                  title="Médiane du championnat"
                />
              )}
            </span>
            <span className={s.mirrorLabel}>{label}</span>
            <span className={s.mirrorTrack} data-side="opp">
              <i style={{ width: pct(oppValue) }} />
              {oppMedian != null && (
                <b
                  style={{ left: pct(oppMedian) }}
                  title="Médiane du championnat"
                />
              )}
            </span>
            <span>
              {fmtNum(oppValue, digits)}
              {unit}
            </span>
          </div>
        );
      })}
      <p className={s.note}>
        Le trait vertical marque la médiane du championnat.
      </p>
    </div>
  );
}

/* --------------------------------------------------------- league plot */

/** Every league club placed on two indicators, crests as marks. */
export function LeaguePlot({
  dossier,
  x,
  y,
  invertY = false,
  invertX = false,
  xLabel = METRICS[x].label,
  yLabel = METRICS[y].label,
  quadrants = [],
  highlight = [],
  ratio,
  fill = false,
}) {
  const [hover, setHover] = useState(null);
  const clubs = dossier.clubs.filter(
    (c) => c.values[x] != null && c.values[y] != null,
  );
  const xs = clubs.map((c) => c.values[x]),
    ys = clubs.map((c) => c.values[y]);
  const pad = (lo, hi) => (hi - lo || 1) * 0.1;
  const x0 = Math.min(...xs) - pad(Math.min(...xs), Math.max(...xs)),
    x1 = Math.max(...xs) + pad(Math.min(...xs), Math.max(...xs));
  const y0 = Math.min(...ys) - pad(Math.min(...ys), Math.max(...ys)),
    y1 = Math.max(...ys) + pad(Math.min(...ys), Math.max(...ys));
  const m = { l: 8, r: 3, t: 4, b: 10 };
  const px = (v) => {
    const t = (v - x0) / (x1 - x0);
    return m.l + (invertX ? 1 - t : t) * (100 - m.l - m.r);
  };
  const py = (v) => {
    const t = (v - y0) / (y1 - y0);
    return m.t + (invertY ? t : 1 - t) * (100 - m.t - m.b);
  };
  const mx = dossier.stats[x]?.median,
    my = dossier.stats[y]?.median;
  const ticks = (lo, hi) => [0.15, 0.5, 0.85].map((t) => lo + (hi - lo) * t);
  return (
    <div
      className={fill ? `${s.plot} ${s.plotFill}` : s.plot}
      style={ratio && !fill ? { aspectRatio: ratio } : undefined}
      onMouseLeave={() => setHover(null)}
    >
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {ticks(x0, x1).map((v) => (
          <line
            key={`x${v}`}
            x1={px(v)}
            x2={px(v)}
            y1={m.t}
            y2={100 - m.b}
            className={s.plotGrid}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {ticks(y0, y1).map((v) => (
          <line
            key={`y${v}`}
            y1={py(v)}
            y2={py(v)}
            x1={m.l}
            x2={100 - m.r}
            className={s.plotGrid}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {mx != null && (
          <line
            x1={px(mx)}
            x2={px(mx)}
            y1={m.t}
            y2={100 - m.b}
            className={s.plotMedian}
            vectorEffect="non-scaling-stroke"
          />
        )}
        {my != null && (
          <line
            y1={py(my)}
            y2={py(my)}
            x1={m.l}
            x2={100 - m.r}
            className={s.plotMedian}
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      {ticks(x0, x1).map((v) => (
        <span
          key={`xl${v}`}
          className={s.plotAxis}
          style={{
            position: "absolute",
            left: `${px(v)}%`,
            top: `${100 - m.b + 2}%`,
            transform: "translateX(-50%)",
            fontSize: 11,
            color: "var(--muted)",
          }}
        >
          {fmtNum(v, METRICS[x].digits)}
        </span>
      ))}
      {ticks(y0, y1).map((v) => (
        <span
          key={`yl${v}`}
          style={{
            position: "absolute",
            left: 0,
            top: `${py(v)}%`,
            transform: "translateY(-50%)",
            fontSize: 11,
            color: "var(--muted)",
          }}
        >
          {fmtNum(v, METRICS[y].digits)}
        </span>
      ))}
      <span
        style={{
          position: "absolute",
          right: `${m.r}%`,
          bottom: 0,
          fontSize: 11,
          color: "var(--muted)",
        }}
      >
        {xLabel} {invertX ? "←" : "→"}
      </span>
      <span
        style={{
          position: "absolute",
          left: `${m.l + 1}%`,
          top: 0,
          fontSize: 11,
          color: "var(--muted)",
        }}
      >
        {invertY ? "↓" : "↑"} {yLabel}
      </span>
      {quadrants.map(([text, corner]) => (
        <span
          key={text}
          className={s.quadrant}
          style={{
            [corner.includes("top") ? "top" : "bottom"]: corner.includes("top")
              ? `${m.t + 2}%`
              : `${m.b + 3}%`,
            [corner.includes("left") ? "left" : "right"]: corner.includes(
              "left",
            )
              ? `${m.l + 2}%`
              : `${m.r + 2}%`,
          }}
        >
          {text}
        </span>
      ))}
      {clubs.map((club) => (
        <span
          key={club.id}
          className={s.plotDot}
          data-compact={
            (clubs.length > 30 && club.id !== dossier.id) || undefined
          }
          data-self={club.id === dossier.id || highlight.includes(club.id)}
          style={{
            left: `${px(club.values[x])}%`,
            top: `${py(club.values[y])}%`,
          }}
          onMouseEnter={() => setHover(club)}
          tabIndex={0}
          onFocus={() => setHover(club)}
          onBlur={() => setHover(null)}
          aria-label={`${club.name} : ${formatMetric(x, club.values[x])}, ${formatMetric(y, club.values[y])}`}
        >
          <Crest club={club} />
        </span>
      ))}
      {hover && (
        <div
          className={s.plotTip}
          style={{
            left: `${px(hover.values[x])}%`,
            top: `${py(hover.values[y])}%`,
          }}
        >
          <strong>
            {hover.position}. {hover.name}
          </strong>
          <span>
            {METRICS[x].label} <b>{formatMetric(x, hover.values[x])}</b>
          </span>
          <span>
            {METRICS[y].label} <b>{formatMetric(y, hover.values[y])}</b>
          </span>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------- style spectrum */

export function StyleSpectrum({
  dossier,
  club = dossier.self,
  axes = STYLE_AXES,
}) {
  return (
    <div className={s.spectrum}>
      {axes.map((axis) => {
        const metric = METRICS[axis.key];
        const values = dossier.clubs
          .map((c) => c.values[axis.key])
          .filter((v) => v != null);
        const value = club.values[axis.key];
        if (value == null || !values.length) return null;
        const lo = Math.min(...values),
          hi = Math.max(...values);
        const pos = (v) => {
          const t = hi === lo ? 0.5 : (v - lo) / (hi - lo);
          return `${4 + (axis.invert ? 1 - t : t) * 92}%`;
        };
        return (
          <div className={s.spectrumRow} key={axis.key}>
            <div className={s.spectrumTitle}>
              <strong>
                {metric.label}
                <Info text={metric.info} />
              </strong>
              <span>
                {formatMetric(axis.key, value)} · médiane{" "}
                {formatMetric(axis.key, dossier.stats[axis.key]?.median)}
              </span>
            </div>
            <div className={s.spectrumTrack}>
              {dossier.clubs
                .filter((c) => c.id !== club.id && c.values[axis.key] != null)
                .map((c) => (
                  <i
                    key={c.id}
                    style={{ left: pos(c.values[axis.key]) }}
                    title={c.name}
                  />
                ))}
              <b style={{ left: pos(value) }} title={club.name} />
            </div>
            <div className={s.spectrumEnds}>
              <span>{axis.low}</span>
              <span>{axis.high}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Plain-language tags derived from the style centiles. */
export function styleTags(club) {
  const c = club.centiles || {},
    tags = [];
  if (c.possession >= 75) tags.push("Possession dominante");
  else if (c.possession <= 25) tags.push("Accepte de ne pas avoir le ballon");
  if (c.fieldTilt >= 75) tags.push("Installé dans le camp adverse");
  if (c.ppda >= 75) tags.push("Pressing haut et agressif");
  else if (c.ppda <= 25) tags.push("Bloc qui attend l’adversaire");
  if (c.directness >= 75) tags.push("Jeu direct, longs ballons");
  else if (c.directness <= 25) tags.push("Relance courte");
  if (c.crosses >= 75) tags.push("Beaucoup de centres");
  if (c.setShare >= 75) tags.push("Dangereux sur coups de pied arrêtés");
  if (c.xgPerShot >= 75) tags.push("Tirs de grande qualité");
  if (c.xga >= 75) tags.push("Défense qui concède peu");
  if (c.duels >= 75) tags.push("Gagne ses duels");
  if (c.finishing >= 80) tags.push("Finition au-dessus des xG");
  else if (c.finishing <= 20) tags.push("Finition en dessous des xG");
  return tags.slice(0, 6);
}

/* ---------------------------------------------------------- line chart */

/** Several series over the same matches, hover shows the column. */
export function MultiLine({
  labels,
  series,
  height = 220,
  format = (v) => fmtNum(v, 2),
  ariaLabel,
  step = 1,
  details,
  // How far the chart may grow past the 640 px it is drawn for. A chart that has a
  // whole row to itself grows more than one beside a table.
  grow = 1.75,
}) {
  const [active, setActive] = useState(null);
  const width = 640,
    m = { t: 12, r: 12, b: 26, l: 34 };
  const all = series.flatMap((serie) => serie.values).filter((v) => v != null);
  const hi = Math.max(...all, 0.1) * 1.08,
    lo = Math.min(0, ...all);
  const n = labels.length;
  const x = (i) =>
    m.l +
    (n === 1 ? (width - m.l - m.r) / 2 : (i / (n - 1)) * (width - m.l - m.r));
  const y = (v) => m.t + (1 - (v - lo) / (hi - lo)) * (height - m.t - m.b);
  const ticks = [lo, (lo + hi) / 2, hi];
  return (
    <div
      className={s.trend}
      style={{ "--chart-cap": `${Math.round(width * grow)}px` }}
    >
      <div className={s.trendLegend}>
        {series.map((serie) => (
          <span key={serie.name}>
            <i
              style={{
                background: serie.color,
                opacity: serie.dashed ? 0.7 : 1,
              }}
            />
            {serie.name}
          </span>
        ))}
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={ariaLabel}
        onMouseLeave={() => setActive(null)}
        onMouseMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          const vx = ((event.clientX - box.left) / box.width) * width;
          const i = Math.round(((vx - m.l) / (width - m.l - m.r)) * (n - 1));
          setActive(Math.max(0, Math.min(n - 1, i)));
        }}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={m.l}
              x2={width - m.r}
              y1={y(t)}
              y2={y(t)}
              stroke="var(--grid)"
            />
            <text
              x={m.l - 6}
              y={y(t) + 4}
              textAnchor="end"
              fontSize="10"
              fill="var(--muted)"
            >
              {format(t)}
            </text>
          </g>
        ))}
        {labels.map((label, i) =>
          i % step === 0 || i === n - 1 ? (
            <text
              key={i}
              x={x(i)}
              y={height - 8}
              textAnchor="middle"
              fontSize="10"
              fill="var(--muted)"
            >
              {label}
            </text>
          ) : null,
        )}
        {series.map((serie) => {
          const d = serie.values
            .map((v, i) => (v == null ? null : `${x(i)} ${y(v)}`))
            .filter(Boolean)
            .map((p, i) => `${i ? "L" : "M"}${p}`)
            .join("");
          return (
            <g key={serie.name}>
              {serie.area && (
                <path
                  d={`${d}L${x(n - 1)} ${y(lo)}L${x(0)} ${y(lo)}Z`}
                  fill={serie.color}
                  opacity="0.1"
                />
              )}
              <path
                d={d}
                fill="none"
                stroke={serie.color}
                strokeWidth="2"
                strokeDasharray={serie.dashed ? "5 4" : undefined}
                strokeLinejoin="round"
              />
              {serie.dots &&
                serie.values.map((v, i) =>
                  v == null ? null : (
                    <circle
                      key={i}
                      cx={x(i)}
                      cy={y(v)}
                      r="2.5"
                      fill={serie.color}
                    />
                  ),
                )}
            </g>
          );
        })}
        {active != null && (
          <g>
            <line
              x1={x(active)}
              x2={x(active)}
              y1={m.t}
              y2={height - m.b}
              stroke="var(--border-strong)"
            />
            {series.map((serie) =>
              serie.values[active] == null ? null : (
                <circle
                  key={serie.name}
                  cx={x(active)}
                  cy={y(serie.values[active])}
                  r="4"
                  fill={serie.color}
                  stroke="var(--surface)"
                  strokeWidth="2"
                />
              ),
            )}
          </g>
        )}
      </svg>
      {active != null && (
        <div
          className={s.plotTip}
          style={{
            left: `${(x(active) / width) * 100}%`,
            top: `${(m.t / height) * 100 + 8}%`,
            transform: "translate(-50%, 0)",
          }}
        >
          <strong>{series[0].tips?.[active] || labels[active]}</strong>
          {details?.[active]?.map(([label, value, tone]) => (
            <span key={label}>
              {label}{" "}
              <b className={tone === 1 ? s.up : tone === -1 ? s.down : undefined}>
                {value}
              </b>
            </span>
          ))}
          {details && <small className={s.plotTipRule}>Cumul</small>}
          {series.map((serie) => (
            <span key={serie.name}>
              {serie.name} <b>{format(serie.values[active])}</b>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function XgTrend({ rows, window = 5 }) {
  const usable = rows.filter((row) => row.xpts != null);
  const labels = usable.map((row) => dateShort(row.match.date));
  const tips = usable.map(
    (row) =>
      `${dateShort(row.match.date)} · ${row.side === "home" ? "vs" : "à"} ${row.opponent.name} ${row.gf}–${row.ga}`,
  );
  return (
    <MultiLine
      ariaLabel={`xG pour et contre, moyenne glissante sur ${window} matchs`}
      labels={labels}
      step={Math.max(1, Math.ceil(labels.length / 8))}
      series={[
        {
          name: `xG pour (moy. ${window} matchs)`,
          color: "var(--accent)",
          values: rolling(
            usable.map((r) => r.own.xg),
            window,
          ),
          tips,
          area: true,
        },
        {
          name: `xG contre (moy. ${window} matchs)`,
          color: "var(--mq-series-2)",
          values: rolling(
            usable.map((r) => r.opp.xg),
            window,
          ),
        },
        {
          name: "xG du match",
          color: "var(--muted-light)",
          values: usable.map((r) => r.own.xg),
          dashed: true,
          dots: true,
        },
      ]}
    />
  );
}

export function PointsTrend({ rows, height = 220, grow }) {
  let points = 0,
    xpts = 0;
  const usable = rows.filter((row) => row.xpts != null);
  const real = [],
    expected = [];
  for (const row of usable) {
    points += row.points;
    xpts += row.xpts;
    real.push(points);
    expected.push(xpts);
  }
  return (
    <MultiLine
      height={height}
      grow={grow}
      ariaLabel="Points cumulés et points attendus cumulés, avec les points et xPts de chaque match"
      labels={usable.map((_, i) => `J${i + 1}`)}
      format={(v) => fmtNum(v, 1)}
      step={Math.max(1, Math.ceil(usable.length / 10))}
      details={usable.map((row) => {
        const gap = row.points - row.xpts;
        return [
          ["Points pris", String(row.points)],
          ["xPts du match", fmtNum(row.xpts, 2)],
          ["Écart", fmtNum(gap, 2, true), gap > 0 ? 1 : gap < 0 ? -1 : 0],
        ];
      })}
      series={[
        {
          name: "Points",
          color: "var(--accent)",
          values: real,
          dots: true,
          tips: usable.map(
            (row, i) =>
              `J${i + 1} · ${dateShort(row.match.date)} · ${row.side === "home" ? "vs" : "à"} ${row.opponent.name} ${row.gf}–${row.ga}`,
          ),
        },
        {
          name: "Points attendus (xPts)",
          color: "var(--mq-series-3)",
          values: expected,
          dashed: true,
        },
      ]}
    />
  );
}

/* --------------------------------------------------------- goal periods */

export function GoalPeriods({ times }) {
  const labels = ["0–15′", "16–30′", "31–45′", "46–60′", "61–75′", "76–90′+"];
  const max = Math.max(1, ...times.for, ...times.against);
  return (
    <>
      <div className={s.trendLegend}>
        <span>
          <i style={{ background: "var(--accent)" }} /> Marqués
        </span>
        <span>
          <i style={{ background: "var(--mq-series-2)" }} /> Encaissés
        </span>
      </div>
      <div
        className={s.periods}
        role="table"
        aria-label="Buts par tranche de quinze minutes"
      >
        {labels.map((label, i) => (
          <div className={s.period} key={label} role="row">
            <div className={s.periodBars} aria-hidden="true">
              <i style={{ height: `${(100 * times.for[i]) / max}%` }} />
              <i style={{ height: `${(100 * times.against[i]) / max}%` }} />
            </div>
            <span className={s.periodValues} role="cell">
              {times.for[i]} – {times.against[i]}
            </span>
            <span role="rowheader">{label}</span>
          </div>
        ))}
      </div>
    </>
  );
}

/* ----------------------------------------------------------- game state */

export function GameState({ states }) {
  const total =
    states.minutes.lead + states.minutes.level + states.minutes.behind || 1;
  const pct = (v) => (100 * v) / total;
  const line = (bucket) =>
    bucket.matches
      ? `${bucket.w}V ${bucket.d}N ${bucket.l}D · ${fmtNum(bucket.points / bucket.matches, 2)} pt/m`
      : "—";
  return (
    <div className={s.stack}>
      <div>
        <div className={s.stateBar} aria-hidden="true">
          <i style={{ width: `${pct(states.minutes.lead)}%` }} />
          <i style={{ width: `${pct(states.minutes.level)}%` }} />
          <i style={{ width: `${pct(states.minutes.behind)}%` }} />
        </div>
        <div className={s.stateLegend}>
          <span>
            Mène <b>{fmtNum(pct(states.minutes.lead))} %</b>
          </span>
          <span>
            Égalité <b>{fmtNum(pct(states.minutes.level))} %</b>
          </span>
          <span>
            Mené <b>{fmtNum(pct(states.minutes.behind))} %</b>
          </span>
          <span>du temps de jeu</span>
        </div>
      </div>
      <dl className={s.facts}>
        <div>
          <dt>Ouvre le score</dt>
          <dd>
            {states.scoredFirst.matches} <small>matchs</small>
          </dd>
          <small>{line(states.scoredFirst)}</small>
        </div>
        <div>
          <dt>Encaisse le premier</dt>
          <dd>
            {states.concededFirst.matches} <small>matchs</small>
          </dd>
          <small>{line(states.concededFirst)}</small>
        </div>
        <div>
          <dt>Points pris après avoir été mené</dt>
          <dd>{states.pointsFromBehind}</dd>
          <small>
            {states.comebacks.length} match(s) renversé(s) ou accroché(s)
          </small>
        </div>
        <div>
          <dt>Points perdus après avoir mené</dt>
          <dd>{states.pointsDropped}</dd>
          <small>{states.collapses.length} avance(s) non conservée(s)</small>
        </div>
      </dl>
      <p className={s.note}>
        {states.matches} matchs dont la chronologie des buts est complète.
      </p>
    </div>
  );
}

/* ------------------------------------------------------- shots, maps */

const OUTCOME = {
  goal: "But",
  saved: "Arrêté",
  off: "Non cadré",
  blocked: "Contré",
};

/** Half pitch for a whole season of team shots: small marks, goals filled. */
function TeamShotMap({ shots }) {
  const line = {
    fill: "none",
    stroke: "var(--mq-pitch-line)",
    strokeWidth: 0.35,
  };
  return (
    <svg
      viewBox="0 0 68 40"
      role="img"
      aria-label="Carte des tirs, taille selon les xG"
      // A half pitch drawn 68 units wide: it stops growing at 640 px.
      style={{
        display: "block",
        width: "100%",
        maxWidth: 640,
        height: "auto",
        marginInline: "auto",
      }}
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
        .sort(
          (a, b) =>
            (a.outcome === "goal") - (b.outcome === "goal") || b.xg - a.xg,
        )
        .map((shot) => {
          const goal = shot.outcome === "goal";
          return (
            <circle
              key={shot.id}
              cx={shot.y}
              cy={shot.x}
              r={0.4 + Math.sqrt(shot.xg) * 1.7}
              fill={goal ? "var(--accent)" : "transparent"}
              fillOpacity={goal ? 0.9 : 0}
              stroke={
                goal
                  ? "var(--mq-pitch)"
                  : shot.outcome === "saved"
                    ? "var(--ink)"
                    : "var(--muted-light)"
              }
              strokeOpacity={goal ? 1 : shot.outcome === "saved" ? 0.55 : 0.4}
              strokeWidth={goal ? 0.25 : 0.2}
            >
              <title>
                {`${OUTCOME[shot.outcome]} · ${shot.player || ""} ${shot.minute ?? ""}′ · xG ${fmtNum(shot.xg, 2)} · ${shot.situation} · ${shot.opponent}`}
              </title>
            </circle>
          );
        })}
    </svg>
  );
}

export function ShotPair({
  profile,
  own = "Tirs du club",
  against = "Tirs concédés",
}) {
  const near = (list) => list.filter((shot) => shot.x <= 40);
  const total = (list) => list.reduce((t, shot) => t + shot.xg, 0);
  const goals = (list) => list.filter((shot) => shot.outcome === "goal").length;
  return (
    <div className={s.pitchPair}>
      {[
        [own, profile.mapFor],
        [against, profile.mapAgainst],
      ].map(([title, list]) => (
        <div key={title}>
          <div className={s.pitchTitle}>
            <strong>{title}</strong>
            <span>
              {list.length} tirs · {fmtNum(total(list), 1)} xG · {goals(list)}{" "}
              buts
            </span>
          </div>
          <TeamShotMap shots={near(list)} />
        </div>
      ))}
      <div
        className={s.trendLegend}
        style={{ gridColumn: "1 / -1", margin: 0 }}
      >
        <span>
          <i
            style={{
              background: "var(--accent)",
              height: 8,
              width: 8,
              borderRadius: "50%",
            }}
          />{" "}
          But
        </span>
        <span>
          <i
            style={{
              border: "1px solid var(--ink)",
              height: 8,
              width: 8,
              borderRadius: "50%",
              opacity: 0.6,
            }}
          />{" "}
          Arrêté
        </span>
        <span>
          <i
            style={{
              border: "1px solid var(--muted-light)",
              height: 8,
              width: 8,
              borderRadius: "50%",
            }}
          />{" "}
          Non cadré ou contré
        </span>
        <span>Survoler un tir pour le détail</span>
      </div>
    </div>
  );
}

export function SituationTable({ profile }) {
  const keys = Object.keys(SITUATION_LABELS);
  return (
    <div className={s.tableScroll}>
      <table className={s.table}>
        <caption className="sr-only">
          Tirs, xG et buts par situation de jeu
        </caption>
        <thead>
          <tr>
            <th scope="col">Situation</th>
            <th scope="col">Tirs pour</th>
            <th scope="col">xG pour</th>
            <th scope="col">Buts</th>
            <th scope="col">Tirs contre</th>
            <th scope="col">xG contre</th>
            <th scope="col">Encaissés</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((key) => (
            <tr key={key}>
              <th scope="row">{SITUATION_LABELS[key]}</th>
              <td>{profile.for[key].shots}</td>
              <td>{fmtNum(profile.for[key].xg, 1)}</td>
              <td>{profile.for[key].goals}</td>
              <td>{profile.against[key].shots}</td>
              <td>{fmtNum(profile.against[key].xg, 1)}</td>
              <td>{profile.against[key].goals}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* --------------------------------------------------------------- matches */

export function MatchRows({ rows, limit = 99, competitionName = true }) {
  const max = Math.max(
    1,
    ...rows.flatMap((row) => (row.own ? [row.own.xg, row.opp.xg] : [])),
  );
  return (
    <div className={s.matchList}>
      {[...rows]
        .reverse()
        .slice(0, limit)
        .map((row) => (
          <div className={s.matchRow} key={row.match.id}>
            <span className={s.matchDate}>{dateShort(row.match.date)}</span>
            <span className={s.form}>
              <span data-result={row.result}>{row.result}</span>
            </span>
            <span className={s.matchOpp}>
              <Crest club={row.opponent} />
              <span>
                {row.opponent.name}{" "}
                <small>{row.side === "home" ? "dom." : "ext."}</small>
              </span>
            </span>
            <span className={s.matchScore}>
              {row.gf}–{row.ga}
            </span>
            <span
              title={
                row.own
                  ? `xG ${fmtNum(row.own.xg, 2)} – ${fmtNum(row.opp.xg, 2)}`
                  : "xG non publiés"
              }
            >
              {row.own ? (
                <>
                  <span className={s.xgBar}>
                    <span>
                      <i style={{ width: `${(100 * row.own.xg) / max}%` }} />
                    </span>
                    <span>
                      <i style={{ width: `${(100 * row.opp.xg) / max}%` }} />
                    </span>
                  </span>
                  <small className={s.muted} style={{ fontSize: 11 }}>
                    xG {fmtNum(row.own.xg, 2)} – {fmtNum(row.opp.xg, 2)}
                  </small>
                </>
              ) : (
                <small className={s.muted}>xG non publiés</small>
              )}
            </span>
            <span className={s.matchComp}>
              {competitionName ? row.match.league : ""}
            </span>
          </div>
        ))}
    </div>
  );
}

/* ----------------------------------------------------------------- squad */

export function SquadTable({ dossier, limit = 30 }) {
  const f = useFootball();
  const possible = dossier.allRecord.matches * 90 || 1;
  const rows = dossier.squad.profiles
    .filter((p) => p.minutes > 0)
    .slice(0, limit);
  return (
    <div className={s.tableScroll}>
      <table className={s.table}>
        <caption className="sr-only">
          Temps de jeu et contributions de l’effectif
        </caption>
        <thead>
          <tr>
            <th scope="col">Joueur</th>
            <th scope="col">MJ</th>
            <th scope="col">Tit.</th>
            <th scope="col">Minutes</th>
            <th scope="col">Part du temps</th>
            <th scope="col">Buts</th>
            <th scope="col">PD</th>
            <th scope="col">xG + xA</th>
            <th scope="col">Note</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((player) => {
            const share = (100 * player.minutes) / possible;
            const xg = player.stats.xg?.sum ?? null,
              xa = player.stats.xa?.sum ?? null;
            return (
              <tr key={player.id}>
                <th scope="row">
                  <Link
                    className={s.player}
                    href={f.href("/joueurs/", { id: player.id, q: "" })}
                  >
                    <Picture
                      name={player.name}
                      url={player.imageUrl}
                      className={s.avatar}
                      round
                    />
                    <span>
                      <strong>{player.name}</strong>
                      <small>
                        {player.role?.label || "Poste non renseigné"}
                      </small>
                    </span>
                  </Link>
                </th>
                <td>{player.matches}</td>
                <td>{player.knownStarts ? player.starts : "—"}</td>
                <td>{fmtNum(player.minutes)}</td>
                <td>
                  <span className={s.share}>
                    <span>
                      <i style={{ width: `${Math.min(100, share)}%` }} />
                    </span>
                    {fmtNum(share)} %
                  </span>
                </td>
                <td>{fmtNum(player.stats.goals?.sum ?? null)}</td>
                <td>{fmtNum(player.stats.assists?.sum ?? null)}</td>
                <td>
                  {xg == null && xa == null
                    ? "—"
                    : fmtNum((xg || 0) + (xa || 0), 1)}
                </td>
                <td>{fmtNum(player.rating, 2)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* --------------------------------------------------------- league table */

/**
 * Rows a table can show to end level with its neighbour in a side-by-side
 * grid (no gap under the shorter column); `fallback` when stacked.
 */
function useFillRows(ref, fallback, enabled) {
  const [rows, setRows] = useState(fallback);
  useEffect(() => {
    const el = ref.current,
      grid = el?.parentElement;
    if (!enabled || !grid) return;
    const measure = () => {
      const me = el.getBoundingClientRect();
      const beside = [...grid.children]
        .filter((child) => child !== el)
        .map((child) => child.getBoundingClientRect())
        .filter((r) => Math.abs(r.top - me.top) < 4 && r.left !== me.left);
      if (!beside.length) return setRows(fallback);
      const target = Math.max(...beside.map((r) => r.height));
      const head = el.querySelector("thead")?.getBoundingClientRect().height;
      const row = el.querySelector("tbody tr")?.getBoundingClientRect().height;
      if (!head || !row) return;
      setRows(Math.max(5, Math.floor((target - head) / row)));
    };
    const observer = new ResizeObserver(measure);
    for (const child of grid.children) if (child !== el) observer.observe(child);
    observer.observe(grid);
    measure();
    return () => observer.disconnect();
  }, [ref, fallback, enabled]);
  return rows;
}

export function LeagueTable({
  dossier,
  sort = "points",
  compact = false,
  window: minimum = 0,
  fill = false,
}) {
  const box = useRef(null);
  const size = useFillRows(box, minimum, fill && minimum > 0);
  const rows = [...dossier.clubs].sort((a, b) =>
    sort === "xpts" ? a.xptsPosition - b.xptsPosition : a.position - b.position,
  );
  // Window: only the clubs around this one, ranks kept.
  const at = rows.findIndex((club) => club.id === dossier.id);
  const first =
    size && size < rows.length
      ? Math.max(0, Math.min(rows.length - size, at - Math.floor(size / 2)))
      : 0;
  const shown = size ? rows.slice(first, first + size) : rows;
  const xgd = (club) =>
    (club.values.xg ?? 0) * club.rows.length -
    (club.values.xga ?? 0) * club.rows.length;
  return (
    <div className={s.tableScroll} ref={box}>
      <table className={s.table}>
        <caption className="sr-only">
          Classement réel et classement aux points attendus
        </caption>
        <thead>
          <tr>
            <th scope="col">
              {sort === "xpts" ? "Rang aux xPts · club" : "Club"}
            </th>
            <th
              scope="col"
              title={
                sort === "xpts"
                  ? "Rang au classement réel (points)"
                  : "Rang aux points attendus"
              }
            >
              {sort === "xpts" ? "Réel" : "xPts"}
            </th>
            <th scope="col">MJ</th>
            <th scope="col">Pts</th>
            <th scope="col">xPts</th>
            <th scope="col" title="Points moins points attendus">
              Écart
            </th>
            {!compact && <th scope="col">Diff.</th>}
            {!compact && <th scope="col">Diff. xG</th>}
          </tr>
        </thead>
        <tbody>
          {shown.map((club, i) => {
            const gap = club.record.points - club.xptsTotal;
            return (
              <tr key={club.id} data-self={club.id === dossier.id}>
                <th scope="row">
                  <span className={s.clubCell}>
                    <span
                      className={s.muted}
                      style={{ width: 18, textAlign: "right" }}
                    >
                      {first + i + 1}
                    </span>
                    <Crest club={club} />
                    {club.name}
                  </span>
                </th>
                <td className={s.muted}>
                  {sort === "xpts" ? club.position : club.xptsPosition}
                  {sort === "xpts" && club.position !== club.xptsPosition && (
                    <small
                      className={
                        club.position < club.xptsPosition ? s.up : s.down
                      }
                      title={
                        club.position < club.xptsPosition
                          ? "Mieux classé que ses points attendus"
                          : "Moins bien classé que ses points attendus"
                      }
                    >
                      {" "}
                      {club.position < club.xptsPosition ? "▲" : "▼"}
                    </small>
                  )}
                </td>
                <td>{club.record.matches}</td>
                <td>{club.record.points}</td>
                <td>{fmtNum(club.xptsTotal, 1)}</td>
                <td className={gap > 0 ? s.up : gap < 0 ? s.down : undefined}>
                  {fmtNum(gap, 1, true)}
                </td>
                {!compact && (
                  <td>{fmtNum(club.record.gf - club.record.ga, 0, true)}</td>
                )}
                {!compact && <td>{fmtNum(xgd(club), 1, true)}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Several leagues in one pool: totals and table positions do not compare. */
export const mixedReferential = (dossier) => {
  const ref = dossier.referential;
  return Boolean(ref && (ref.europe || ref.multi || ref.inserted));
};

/**
 * Expected table of a mixed referential. Leagues differ in calendar and
 * size, so no cross-league position: each club's gap to its expected points
 * per match (comparable everywhere), with its positions in its own league.
 */
export function ExpectedGapTable({ dossier }) {
  const per = (club, value) => value / (club.record.matches || 1);
  const gap = (club) => per(club, club.record.points - club.xptsTotal);
  const rows = [...dossier.clubs].sort((a, b) => gap(b) - gap(a));
  return (
    <div className={s.tableScroll}>
      <table className={s.table}>
        <caption className="sr-only">
          Écart aux points attendus par match, et classements dans chaque
          championnat
        </caption>
        <thead>
          <tr>
            <th scope="col">Club</th>
            <th scope="col" title="Rang réel · rang aux points attendus, dans son championnat">
              Champ. réel · xPts
            </th>
            <th scope="col">MJ</th>
            <th scope="col">Pts / m</th>
            <th scope="col">xPts / m</th>
            <th scope="col" title="Points moins points attendus, par match">
              Écart / m
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((club, i) => {
            const g = gap(club);
            return (
              <tr key={club.id} data-self={club.id === dossier.id}>
                <th scope="row">
                  <span className={s.clubCell}>
                    <span
                      className={s.muted}
                      style={{ width: 18, textAlign: "right" }}
                    >
                      {i + 1}
                    </span>
                    <Crest club={club} />
                    <span>
                      {club.name}
                      <small className={s.muted}> · {club.league?.name}</small>
                    </span>
                  </span>
                </th>
                <td className={s.muted}>
                  {club.leaguePosition
                    ? `${ordinal(club.leaguePosition)} · ${ordinal(club.leagueXptsPosition)}`
                    : "—"}
                </td>
                <td>{club.record.matches}</td>
                <td>{fmtNum(per(club, club.record.points), 2)}</td>
                <td>{fmtNum(per(club, club.xptsTotal), 2)}</td>
                <td className={g > 0 ? s.up : g < 0 ? s.down : undefined}>
                  {fmtNum(g, 2, true)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export { toneVar };

/* ------------------------------------------------------ search menu */

/**
 * Dropdown with a search field: suggestions while the query is short, then
 * results (sync or async) as the user types. Arrow keys and Enter pick.
 */
export function SearchMenu({
  label,
  button,
  placeholder,
  suggestions = [],
  suggestionsLabel = "Suggestions",
  search,
  minLength = 2,
  itemKey = (item) => item.id,
  renderItem,
  onSelect,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState({
    items: [],
    loading: false,
    error: null,
  });
  const [active, setActive] = useState(0);
  const root = useRef(null),
    input = useRef(null);
  const listId = useId();
  const typed = query.trim().length >= minLength;
  const items = typed ? found.items : suggestions;
  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const down = (event) => {
      if (!root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", down);
    return () => document.removeEventListener("mousedown", down);
  }, [open]);
  useEffect(() => {
    setActive(0);
    if (!typed) {
      setFound({ items: [], loading: false, error: null });
      return;
    }
    const controller = new AbortController();
    setFound((previous) => ({ ...previous, loading: true, error: null }));
    const timer = setTimeout(async () => {
      try {
        const result = await search(query.trim(), controller.signal);
        if (!controller.signal.aborted)
          setFound({ items: result, loading: false, error: null });
      } catch (error) {
        if (!controller.signal.aborted)
          setFound({
            items: [],
            loading: false,
            error: error?.message || "Recherche impossible.",
          });
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // `search` is recreated on every render; the query drives the read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, typed]);
  const pick = (item) => {
    onSelect(item);
    setOpen(false);
    setQuery("");
  };
  return (
    <div className={s.menu} ref={root}>
      {label && <span className={s.menuLabel}>{label}</span>}
      <span className={s.menuAnchor}>
        <button
          type="button"
          className={s.menuButton}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <span className={s.menuValue}>{button}</span>
          <Icon name="chevron" />
        </button>
        {open && (
          <div
            className={s.menuPanel}
            role="dialog"
            aria-label={label || placeholder}
          >
            <label className={s.menuSearch}>
              <Icon name="search" />
              <input
                ref={input}
                type="search"
                value={query}
                placeholder={placeholder}
                autoComplete="off"
                role="combobox"
                aria-expanded="true"
                aria-controls={listId}
                aria-activedescendant={
                  items[active] ? `${listId}-${active}` : undefined
                }
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setOpen(false);
                  else if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setActive((i) => Math.min(items.length - 1, i + 1));
                  } else if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setActive((i) => Math.max(0, i - 1));
                  } else if (event.key === "Enter" && items[active]) {
                    event.preventDefault();
                    pick(items[active]);
                  }
                }}
              />
            </label>
            <p className={s.menuHint}>
              {!typed
                ? suggestionsLabel
                : found.loading
                  ? "Recherche…"
                  : found.error
                    ? found.error
                    : items.length
                      ? `${items.length} résultat${items.length > 1 ? "s" : ""}`
                      : "Aucun résultat"}
            </p>
            <ul className={s.menuList} id={listId} role="listbox">
              {items.map((item, i) => (
                <li
                  key={itemKey(item)}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => pick(item)}
                >
                  {renderItem(item)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </span>
    </div>
  );
}

/** One line of a club or competition in a search menu. */
export function MenuItem({ item, meta }) {
  return (
    <span className={s.menuItem}>
      <Crest club={item} />
      <span>
        <strong>{item.name}</strong>
        {meta && <small>{meta}</small>}
      </span>
    </span>
  );
}
