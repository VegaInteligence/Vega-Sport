"use client";
import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Icon from "./Icon.jsx";
import { useCardFold } from "./PhoneFold.jsx";
import { useFootball } from "../hooks/FootballContext.jsx";
import { PercentileBar, toneVar } from "./PlayerScoutCharts.jsx";
import { RankingTrigger } from "./RankingDialog.jsx";
import { Hint, Term } from "./Hint.jsx";
import { explain } from "../services/glossary.js";
import {
  METRICS,
  SITUATION_LABELS,
  STYLE_AXES,
  formatMetric,
} from "../services/club-scout.js";
import {
  pairedPoints,
  pairedXg,
  partOf,
  sumKnown,
} from "../services/club-supported.js";
import { safeImageUrl } from "../services/format.js";
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
 * mount after a long read into their initials. The source goes through the
 * site's checked resolver, as Media's does: a Vega reference is read through
 * /api/assets, never from its reserved host; a refused one shows the initials.
 * A failure belongs to its source: a new url is a new attempt, as Media's (VI-30).
 */
export function Picture(props) {
  return <PictureAttempt key={props.url || ""} {...props} />;
}

function PictureAttempt({
  name = "",
  url,
  className = "crest",
  round = false,
}) {
  const [failed, setFailed] = useState(false);
  const src = failed ? null : safeImageUrl(url) || null;
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
            {title && (
              <h3>
                <Term>{title}</Term>
              </h3>
            )}
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
          <span>
            <Term>{label}</Term>
          </span>
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

/** The « i » of a value: its own note, else the glossary's sentence for its name. */
export function Info({ text, label }) {
  return <Hint text={text || explain(label)} label={label} />;
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
            <th scope="col"><Term>Indicateur</Term></th>
            <th scope="col">{club.name}</th>
            <th scope="col"><Term>Médiane</Term></th>
            <th scope="col"><Term>Rang</Term></th>
            <th scope="col"><Term>Centile</Term></th>
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
                  <Info text={metric.info} label={metric.label} />
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
              <Hint text={explain(phase.label)} label={phase.label} />
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
          // Every club shows its crest (user, 20 Nov 2026); a large referential draws them smaller.
          data-dense={clubs.length > 30 || undefined}
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

// The crests of a style axis: the lanes they may take, each this tall (px), and the room a crest needs (% of the axis).
const MAX_LANES = 3, LANE_HEIGHT = 20, LANE_GAP = 2.8;

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
        const at = (v) => {
          const t = hi === lo ? 0.5 : (v - lo) / (hi - lo);
          return 4 + (axis.invert ? 1 - t : t) * 92;
        };
        const pos = (v) => `${at(v)}%`;
        // Each crest on the first lane where it clears its neighbour (LANE_GAP % of the axis), at most MAX_LANES lanes;
        // past that, on the lane whose last crest is farthest.
        const marks = [], lanes = [];
        for (const c of dossier.clubs
          .filter((c) => c.id !== club.id && c.values[axis.key] != null)
          .map((c) => ({ c, x: at(c.values[axis.key]) }))
          .sort((a, b) => a.x - b.x)) {
          let lane = lanes.findIndex((last) => c.x - last >= LANE_GAP);
          if (lane < 0 && lanes.length < MAX_LANES) lane = lanes.length;
          if (lane < 0) lane = lanes.indexOf(Math.min(...lanes));
          lanes[lane] = c.x;
          marks.push({ ...c, lane });
        }
        const height = Math.max(34, lanes.length * LANE_HEIGHT + 2);
        return (
          <div className={s.spectrumRow} key={axis.key} data-axis={axis.key}>
            <div className={s.spectrumTitle}>
              <strong>
                {metric.label}
                <Info text={metric.info} label={metric.label} />
              </strong>
              <span>
                {formatMetric(axis.key, value)} · médiane{" "}
                {formatMetric(axis.key, dossier.stats[axis.key]?.median)}
              </span>
            </div>
            <div className={s.spectrumTrack} data-track="" style={{ height }}>
              {/* Each club's crest at its value (user, 20 Nov 2026); the club itself larger, in the middle. */}
              {marks.map(({ c, x, lane }) => (
                  <span
                    key={c.id}
                    className={s.spectrumMark}
                    data-club=""
                    style={{ left: `${x}%`, top: 1 + lane * LANE_HEIGHT + (height - 2 - lanes.length * LANE_HEIGHT) / 2 }}
                    title={`${c.name} : ${formatMetric(axis.key, c.values[axis.key])}`}
                  >
                    <Crest club={c} />
                  </span>
                ))}
              <span
                className={s.spectrumSelf}
                data-club=""
                data-self="true"
                style={{ left: pos(value) }}
                title={`${club.name} : ${formatMetric(axis.key, value)}`}
              >
                <Crest club={club} />
              </span>
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

/** A box's laid-out width, measured: a chart drawn at it keeps its text at its own size.
 * `fallback` until measured (the server's rendering, a test). */
export function useBoxWidth(fallback) {
  // A callback ref: the box may appear after the first rendering (data still loading).
  const [node, setNode] = useState(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    if (!node) return undefined;
    const read = () => node.clientWidth && setWidth(Math.round(node.clientWidth));
    read();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(read);
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);
  return [setNode, width];
}

const DAY_MS = 86_400_000;
const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const dayOf = (iso) => Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`);
const nextMonth = (time) => {
  const d = new Date(time);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
};
/** A tick label: whole numbers bare, halves with their decimal. */
const tickText = (v) => fmtNum(v, Number.isInteger(v) ? 0 : 1);

/** Mean of each run of `size` consecutive values, null until `size` matches are known. */
function fullRolling(values, size) {
  return values.map((_, i) =>
    i < size - 1
      ? null
      : values.slice(i - size + 1, i + 1).reduce((a, b) => a + b, 0) / size,
  );
}

/**
 * The club's xG for and against: each match a dot at its real date, the means over the last
 * `window` matches as two lines, the space between them coloured by the side ahead. Drawn at its
 * measured width; the match nearest the pointer gets its card.
 */
export function XgTrend({ rows, window = 5 }) {
  const [ref, width] = useBoxWidth(720);
  const [active, setActive] = useState(null);
  const usable = rows.filter((row) => row.own?.xg != null && row.opp?.xg != null);
  if (!usable.length) return <p className={s.muted}>xG non renseignés.</p>;
  const FOR = "var(--accent)",
    AGAINST = "var(--mq-series-2)";
  const phone = width < 560;
  const height = phone ? 220 : 260;
  const m = { t: 12, r: phone ? 8 : 104, b: 26, l: 30 };
  const iw = width - m.l - m.r,
    ih = height - m.t - m.b;
  const days = usable.map((row) => dayOf(row.match.date));
  const pad = usable.length > 1 ? 4 * DAY_MS : 15 * DAY_MS;
  const t0 = days[0] - pad,
    t1 = days[days.length - 1] + pad;
  const x = (t) => m.l + ((t - t0) / (t1 - t0)) * iw;
  const xg = usable.map((row) => row.own.xg),
    xga = usable.map((row) => row.opp.xg);
  const meanFor = fullRolling(xg, window),
    meanAgainst = fullRolling(xga, window);
  const peak = Math.max(0.5, ...xg, ...xga);
  let step = peak > 2.5 ? 1 : 0.5;
  if (peak / step > 6) step *= 2;
  const top = Math.max(Math.ceil(peak / step) * step, peak * 1.04);
  const ticks = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(v);
  const y = (v) => m.t + (1 - v / top) * ih;
  const months = [];
  for (let t = nextMonth(t0); t < t1; t = nextMonth(t)) months.push(t);
  const known = usable.map((_, i) => i).filter((i) => meanFor[i] != null);
  const line = (values) =>
    known.map((i, k) => `${k ? "L" : "M"}${x(days[i])},${y(values[i])}`).join("");
  // The space between the two means, cut where they cross: blue where the club creates more.
  const gaps = [];
  for (let k = 0; k < known.length - 1; k++) {
    const i = known[k],
      j = known[k + 1];
    const lerp = (a, b, t) => a + (b - a) * t;
    const piece = (ta, tb) => {
      const [xa, xb] = [lerp(days[i], days[j], ta), lerp(days[i], days[j], tb)];
      const [fa, fb] = [lerp(meanFor[i], meanFor[j], ta), lerp(meanFor[i], meanFor[j], tb)];
      const [ga, gb] = [lerp(meanAgainst[i], meanAgainst[j], ta), lerp(meanAgainst[i], meanAgainst[j], tb)];
      gaps.push({
        d: `M${x(xa)},${y(fa)}L${x(xb)},${y(fb)}L${x(xb)},${y(gb)}L${x(xa)},${y(ga)}Z`,
        ahead: fa + fb >= ga + gb,
      });
    };
    const d0 = meanFor[i] - meanAgainst[i],
      d1 = meanFor[j] - meanAgainst[j];
    if (d0 * d1 < 0) {
      const t = d0 / (d0 - d1);
      piece(0, t);
      piece(t, 1);
    } else piece(0, 1);
  }
  const last = usable.length - 1;
  const ends =
    meanFor[last] == null
      ? []
      : [
          ["for", meanFor[last], FOR, "xG créés"],
          ["against", meanAgainst[last], AGAINST, "xG concédés"],
        ];
  // Labels at the right end, kept apart when the two means meet.
  let labelY = ends.map(([, v]) => y(v));
  if (ends.length && Math.abs(labelY[0] - labelY[1]) < 30) {
    const mid = (labelY[0] + labelY[1]) / 2;
    labelY = labelY[0] <= labelY[1] ? [mid - 15, mid + 15] : [mid + 15, mid - 15];
  }
  const pick = (event) => {
    const box = event.currentTarget.getBoundingClientRect();
    const vx = event.clientX - box.left;
    let best = 0;
    days.forEach((d, i) => {
      if (Math.abs(x(d) - vx) < Math.abs(x(days[best]) - vx)) best = i;
    });
    setActive(best);
  };
  const row = active == null ? null : usable[active];
  return (
    <div ref={ref} className={s.xgTrend}>
      <div className={s.trendLegend} data-legend>
        <span>
          <i style={{ background: FOR }} />
          xG créés, moyenne {window} matchs
        </span>
        <span>
          <i style={{ background: AGAINST }} />
          xG concédés, moyenne {window} matchs
        </span>
        <span>
          <i className={s.legendDot} />
          Un match
        </span>
      </div>
      <div className={s.xgPlot}>
      <svg
        data-chart="xg-trend"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`xG créés et concédés par match, moyennes sur ${window} matchs`}
        className={s.xgSvg}
        onPointerMove={pick}
        onPointerDown={pick}
        onPointerLeave={() => setActive(null)}
      >
        {ticks.map((v) => (
          <g key={v}>
            <line
              x1={m.l}
              x2={width - m.r}
              y1={y(v)}
              y2={y(v)}
              stroke={v ? "var(--grid)" : "var(--border-strong)"}
              strokeDasharray={v ? "2 3" : undefined}
            />
            <text data-tick="y" x={m.l - 8} y={y(v) + 4} textAnchor="end" className={s.axisText}>
              {tickText(v)}
            </text>
          </g>
        ))}
        {months.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={m.t} y2={height - m.b} stroke="var(--grid)" strokeDasharray="2 3" />
            <text x={x(t) + 4} y={height - 8} className={s.axisText}>
              {MONTHS[new Date(t).getUTCMonth()]}
            </text>
          </g>
        ))}
        {(!months.length || x(months[0]) - m.l > 40) && (
          <text x={m.l + 2} y={height - 8} className={s.axisText}>
            {MONTHS[new Date(t0).getUTCMonth()]}
          </text>
        )}
        {gaps.map((gap, i) => (
          <path key={i} d={gap.d} fill={gap.ahead ? FOR : AGAINST} opacity="0.2" />
        ))}
        {active != null && (
          <line x1={x(days[active])} x2={x(days[active])} y1={m.t} y2={height - m.b} stroke="var(--border-strong)" />
        )}
        {usable.map((r, i) => (
          <g key={r.match.id ?? i} opacity={active == null || active === i ? 1 : 0.6}>
            <circle data-dot="against" data-match={r.match.id} cx={x(days[i])} cy={y(r.opp.xg)} r={active === i ? 4.5 : 3} fill={AGAINST} fillOpacity={active === i ? 1 : 0.55} />
            <circle data-dot="for" data-match={r.match.id} cx={x(days[i])} cy={y(r.own.xg)} r={active === i ? 4.5 : 3} fill={FOR} fillOpacity={active === i ? 1 : 0.55} />
          </g>
        ))}
        {known.length > 1 && (
          <>
            <path d={line(meanAgainst)} fill="none" stroke={AGAINST} strokeWidth="2.25" strokeLinejoin="round" />
            <path d={line(meanFor)} fill="none" stroke={FOR} strokeWidth="2.25" strokeLinejoin="round" />
          </>
        )}
        {ends.map(([key, v, color, label], k) => (
          <g key={key}>
            <circle cx={x(days[last])} cy={y(v)} r="4.5" fill={color} stroke="var(--bg)" strokeWidth="2" />
            {!phone && (
              <>
                <text data-end={key} x={x(days[last]) + 12} y={labelY[k] - 1} className={s.endValue}>
                  {fmtNum(v, 2)}
                </text>
                <text x={x(days[last]) + 12} y={labelY[k] + 13} className={s.axisText}>
                  {label}
                </text>
              </>
            )}
          </g>
        ))}
      </svg>
      {row && (
        <div
          className={`${s.plotTip} ${s.sideTip}`}
          data-tip
          data-flip={x(days[active]) > width / 2 || undefined}
          style={{ left: x(days[active]), top: height / 2 }}
        >
          <strong>
            {dateShort(row.match.date)} · {row.side === "home" ? "vs" : "à"} {row.opponent.name} {row.gf}–{row.ga}
          </strong>
          {row.match.league && <small className={s.tipNote}>{row.match.league}</small>}
          <span>
            xG créés <b>{fmtNum(row.own.xg, 2)}</b>
          </span>
          <span>
            xG concédés <b>{fmtNum(row.opp.xg, 2)}</b>
          </span>
          {meanFor[active] != null && (
            <>
              <small className={s.plotTipRule}>Moyenne {window} matchs</small>
              <span>
                Créés <b>{fmtNum(meanFor[active], 2)}</b>
              </span>
              <span>
                Concédés <b>{fmtNum(meanAgainst[active], 2)}</b>
              </span>
            </>
          )}
        </div>
      )}
      </div>
    </div>
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
  // No match of known chronology: the time in each state is unknown, not 0 %.
  const minutes = states.minutes;
  const total = minutes
    ? minutes.lead + minutes.level + minutes.behind || 1
    : null;
  const pct = (v) => (total ? (100 * v) / total : 0);
  const share = (v) => (total ? `${fmtNum(pct(v))} %` : "—");
  const line = (bucket) =>
    bucket.matches
      ? `${bucket.w}V ${bucket.d}N ${bucket.l}D · ${fmtNum(bucket.points / bucket.matches, 2)} pt/m`
      : "—";
  return (
    <div className={s.stack}>
      <div>
        <div className={s.stateBar} aria-hidden="true">
          <i style={{ width: `${pct(minutes?.lead)}%` }} />
          <i style={{ width: `${pct(minutes?.level)}%` }} />
          <i style={{ width: `${pct(minutes?.behind)}%` }} />
        </div>
        <div className={s.stateLegend}>
          <span>
            Mène <b>{share(minutes?.lead)}</b>
          </span>
          <span>
            Égalité <b>{share(minutes?.level)}</b>
          </span>
          <span>
            Mené <b>{share(minutes?.behind)}</b>
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
        {states.halves && (states.halfMatches ?? states.matches) > 0 && (
          <>
            {[
              ["1re mi-temps", states.halves.first],
              ["2e mi-temps", states.halves.second],
            ].map(([label, half]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>
                  {half.gf - half.ga > 0 ? "+" : ""}
                  {half.gf - half.ga} <small>de différence</small>
                </dd>
                <small>
                  {half.gf} marqués · {half.ga} encaissés
                </small>
              </div>
            ))}
          </>
        )}
      </dl>
      <p className={s.note}>
        {states.matches} matchs dont la chronologie des buts est complète.
        {states.halves &&
          (states.halfMatches ?? states.matches) > 0 &&
          ` Arrêtés à la pause, ${(states.halfMatches ?? states.matches) < states.matches ? `${states.halfMatches} d’entre eux` : "ils"} donneraient ${states.halves.halfTimePoints} points ; le club en a pris ${states.halves.points}.`}
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

/** A shot's mark radius in pixels, by its xG: the same on every screen, so the key holds. */
const shotRadius = (xg) => 2 + Math.sqrt(Math.max(0, xg)) * 17;

/** Half pitch for a whole season of team shots, drawn at its measured width: goals filled in the
 * side's colour, saved shots filled grey, the others hollow; size by xG; a dashed arc at the
 * shots' mean distance; the shot nearest the pointer gets its card. */
function TeamShotMap({ side, title, shots, goalColor, depth }) {
  const [ref, measured] = useBoxWidth(560);
  const [active, setActive] = useState(null);
  const clip = useId();
  const w = Math.min(measured, 600);
  const near = shots.filter((shot) => shot.x <= 40);
  const dist = (shot) => Math.hypot(shot.x, shot.y - 34);
  const total = sumKnown(shots.map((shot) => shot.xg));
  const goals = shots.filter((shot) => shot.outcome === "goal").length;
  const meanDist = shots.length
    ? shots.reduce((sum, shot) => sum + dist(shot), 0) / shots.length
    : null;
  const k = w / 68;
  const top = 2.6 * k;
  const h = top + depth * k;
  const X = (across) => across * k,
    Y = (out) => top + out * k;
  const radius = (shot) => (Number.isFinite(shot.xg) ? shotRadius(shot.xg) : 2);
  const kind = (shot) =>
    shot.outcome === "goal" ? "goal" : shot.outcome === "saved" ? "saved" : "miss";
  const order = { miss: 0, saved: 1, goal: 2 };
  const drawn = [...near].sort(
    (a, b) =>
      order[kind(a)] - order[kind(b)] ||
      (Number.isFinite(b.xg) ? b.xg : -1) - (Number.isFinite(a.xg) ? a.xg : -1),
  );
  const pick = (event) => {
    const box = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - box.left,
      py = event.clientY - box.top;
    let best = null,
      bestD = Infinity;
    for (const shot of near) {
      const d = Math.hypot(X(shot.y) - px, Y(shot.x) - py) - radius(shot);
      if (d < bestD) [best, bestD] = [shot, d];
    }
    setActive(bestD <= 10 ? best : null);
  };
  const line = { fill: "none", stroke: "var(--mq-pitch-line)", strokeWidth: 1.25 };
  const figures = [
    ["shots", "Tirs", String(shots.length)],
    ["xg", "xG", fmtNum(total, 1)],
    ["goals", "Buts", String(goals)],
    ["diff", "Buts − xG", total == null ? "—" : fmtNum(goals - total, 1, true).replace("-", "−")],
    ["perShot", "xG par tir", total == null || !shots.length ? "—" : fmtNum(total / shots.length, 2)],
    ["distance", "Distance moy.", meanDist == null ? "—" : `${fmtNum(meanDist, 1)} m`],
  ];
  const arcLabel = meanDist != null && meanDist < depth - 1;
  return (
    <div data-shotmap={side} className={s.shotMap}>
      <strong className={s.shotTitle}>{title}</strong>
      <dl className={s.shotFigures}>
        {figures.map(([key, label, value]) => (
          <div key={key} data-figure={key}>
            <dt>{label}</dt>
            <dd>
              <b>{value}</b>
            </dd>
          </div>
        ))}
      </dl>
      <div ref={ref} className={s.shotPlot}>
        <svg
          width={w}
          height={h}
          viewBox={`0 0 ${w} ${h}`}
          role="img"
          aria-label={`${title} : ${shots.length} tirs, ${fmtNum(total, 1)} xG, ${goals} buts`}
          onPointerMove={pick}
          onPointerDown={pick}
          onPointerLeave={() => setActive(null)}
        >
          <defs>
            <clipPath id={clip}>
              <rect x="0" y={top} width={w} height={depth * k} />
            </clipPath>
          </defs>
          <rect x="0" y={top} width={w} height={depth * k} fill="var(--mq-pitch)" />
          <line x1="0" x2={w} y1={top} y2={top} {...line} />
          <rect x={X(13.85)} y={top} width={40.3 * k} height={16.5 * k} {...line} />
          <rect x={X(24.85)} y={top} width={18.3 * k} height={5.5 * k} {...line} />
          <path d={`M${X(34 - 7.3)} ${Y(16.5)}A${9.15 * k} ${9.15 * k} 0 0 0 ${X(34 + 7.3)} ${Y(16.5)}`} {...line} />
          <circle cx={X(34)} cy={Y(11)} r="1.6" fill="var(--mq-pitch-line)" />
          <rect x={X(30.34)} y={top - 2.2 * k} width={7.32 * k} height={2.2 * k} fill="none" stroke="var(--muted)" strokeWidth="1.5" />
          {meanDist != null && (
            <g clipPath={`url(#${clip})`}>
              <circle data-arc cx={X(34)} cy={top} r={meanDist * k} fill="none" stroke="var(--muted)" strokeDasharray="3 4" opacity="0.7" />
            </g>
          )}
          {arcLabel && (
            <text
              x={X(34) + meanDist * k * Math.cos(Math.PI * 0.08) + 6}
              y={top + meanDist * k * Math.sin(Math.PI * 0.08) + 4}
              className={s.axisText}
            >
              {fmtNum(meanDist, 1)} m
            </text>
          )}
          {drawn.map((shot) => {
            const mark = kind(shot);
            const unknown = !Number.isFinite(shot.xg);
            const common = { "data-mark": mark, cx: X(shot.y), cy: Y(shot.x), r: radius(shot), strokeDasharray: unknown ? "2 2" : undefined };
            return mark === "goal" ? (
              <circle key={shot.id} {...common} fill={goalColor} stroke="var(--mq-pitch)" strokeWidth="1.5" />
            ) : mark === "saved" ? (
              <circle key={shot.id} {...common} fill="var(--muted-light)" fillOpacity="0.45" stroke="var(--mq-pitch)" strokeWidth="1" />
            ) : (
              <circle key={shot.id} {...common} fill="none" stroke="var(--muted)" strokeOpacity="0.6" strokeWidth="1" />
            );
          })}
          {active && (
            <circle cx={X(active.y)} cy={Y(active.x)} r={radius(active) + 3} fill="none" stroke="var(--ink-strong)" strokeWidth="1.5" />
          )}
        </svg>
        {active && (
          <div
            className={`${s.plotTip} ${s.sideTip}`}
            data-tip
            data-flip={X(active.y) > w / 2 || undefined}
            style={{ left: X(active.y), top: Y(active.x) }}
          >
            <strong>
              {active.player || "—"}
              {active.minute != null ? ` · ${active.minute}′` : ""}
            </strong>
            <small className={s.tipNote}>
              {[dateShort(active.date), active.opponent].filter(Boolean).join(" · ")}
            </small>
            <span>
              Issue <b>{OUTCOME[active.outcome] || "—"}</b>
            </span>
            <span>
              xG <b>{Number.isFinite(active.xg) ? fmtNum(active.xg, 2) : "indisponible"}</b>
            </span>
            <span>
              Situation <b>{active.situation}</b>
            </span>
            <span>
              Distance <b>{fmtNum(dist(active), 1)} m</b>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export function ShotPair({
  profile,
  own = "Tirs du club",
  against = "Tirs concédés",
}) {
  // One depth for both halves, fitted to the farthest shot drawn: the two maps compare.
  const far = [...profile.mapFor, ...profile.mapAgainst].map((shot) => shot.x).filter((x) => x <= 40);
  const depth = Math.min(40, Math.max(28, Math.ceil(Math.max(0, ...far) + 2)));
  return (
    <div className={s.shotPair}>
      <div className={s.pitchPair}>
        <TeamShotMap side="for" title={own} shots={profile.mapFor} goalColor="var(--accent)" depth={depth} />
        <TeamShotMap side="against" title={against} shots={profile.mapAgainst} goalColor="var(--mq-series-2)" depth={depth} />
      </div>
      <div className={s.trendLegend}>
        <span>
          <i className={s.legendDot} style={{ background: "var(--accent)" }} /> But marqué
        </span>
        <span>
          <i className={s.legendDot} style={{ background: "var(--mq-series-2)" }} /> But concédé
        </span>
        <span>
          <i className={s.legendDot} style={{ background: "color-mix(in srgb, var(--muted-light) 55%, transparent)" }} /> Cadré, arrêté
        </span>
        <span>
          <i className={s.legendRing} /> Non cadré ou contré
        </span>
        <span>
          <i className={s.legendDash} /> Distance moyenne
        </span>
        <span className={s.sizeKey}>
          Taille selon les xG
          {[0.05, 0.2, 0.5].map((v) => (
            <span key={v}>
              <i style={{ width: 2 * shotRadius(v), height: 2 * shotRadius(v) }} />
              {fmtNum(v, 2)}
            </span>
          ))}
        </span>
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
            <th scope="col"><Term>Situation</Term></th>
            <th scope="col"><Term>Tirs pour</Term></th>
            <th scope="col"><Term>xG pour</Term></th>
            <th scope="col"><Term>Buts</Term></th>
            <th scope="col"><Term>Tirs contre</Term></th>
            <th scope="col"><Term>xG contre</Term></th>
            <th scope="col"><Term>Encaissés</Term></th>
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

/**
 * A club match row: a link to the match's page (as MatchLink), or a plain row when the
 * match has no page.
 */
export function MatchRowLink({ match, className, children }) {
  const f = useFootball();
  const upcoming = match.status === "not_started";
  if (!match.id || String(match.id).startsWith("uefa:"))
    return <div className={className}>{children}</div>;
  return (
    <Link
      prefetch={false}
      className={`${className} ${s.matchLink}`}
      href={f.href("/matchs/", {
        tab: upcoming ? "upcoming" : "results",
        ...(upcoming ? { from: "upcoming" } : {}),
        id: match.id,
        competition: match.league?.id || match.leagueId || "",
        sourceSeason: match.season || "",
      })}
    >
      {children}
    </Link>
  );
}

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
          <MatchRowLink className={s.matchRow} key={row.match.id} match={row.match}>
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
          </MatchRowLink>
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
            <th scope="col"><Term>Joueur</Term></th>
            <th scope="col"><Term>MJ</Term></th>
            <th scope="col"><Term>Tit.</Term></th>
            <th scope="col"><Term>Minutes</Term></th>
            <th scope="col"><Term>Part du temps</Term></th>
            <th scope="col"><Term>Buts</Term></th>
            <th scope="col"><Term>PD</Term></th>
            <th scope="col"><Term>xG + xA</Term></th>
            <th scope="col"><Term>Note Vega</Term></th>
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
                <td>{fmtNum(player.grade, 0)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* --------------------------------------------------------- league table */

/** A table's club: a link to its page, except the club the page is about. */
function ClubCell({ club, self, children }) {
  const f = useFootball();
  if (self || !club.id) return <span className={s.clubCell}>{children}</span>;
  return (
    <Link
      className={`${s.clubCell} ${s.clubLink}`}
      href={f.href("/clubs/", { id: club.id, clubView: "", clubScope: "", vs: "" })}
    >
      {children}
    </Link>
  );
}

export function LeagueTable({ dossier, sort = "points", compact = false }) {
  const rows = [...dossier.clubs].sort((a, b) =>
    sort === "xpts" ? a.xptsPosition - b.xptsPosition : a.position - b.position,
  );
  // Points beside xPts, and xG for beside xG against, on the same matches (club-supported.js).
  const tone = (value) =>
    Number.isFinite(value) && value !== 0 ? (value > 0 ? s.up : s.down) : undefined;
  return (
    <div className={s.tableScroll}>
      <table className={s.table}>
        <caption className="sr-only">
          Classement réel et classement aux points attendus
        </caption>
        <thead>
          <tr>
            <th scope="col">
              {sort === "xpts" ? <Term label="Rang aux xPts">Rang aux xPts · club</Term> : "Club"}
            </th>
            <th scope="col">
              {sort === "xpts" ? (
                <Term>Réel</Term>
              ) : (
                <Term hint="Rang aux points attendus : le classement si chaque match s'était joué selon ses occasions.">xPts</Term>
              )}
            </th>
            <th scope="col"><Term>MJ</Term></th>
            <th scope="col"><Term>Pts</Term></th>
            <th scope="col"><Term>xPts</Term></th>
            <th scope="col"><Term>Écart</Term></th>
            {!compact && <th scope="col"><Term>Diff.</Term></th>}
            {!compact && <th scope="col"><Term label="Diff. xG / match">Diff. xG</Term></th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((club, i) => {
            const paired = pairedPoints(club),
              xg = pairedXg(club);
            const part = partOf(paired.matches, club.record.matches);
            const partTitle = part
              ? `Sur ${part} : xG manquants sur les autres`
              : undefined;
            return (
              <tr key={club.id} data-self={club.id === dossier.id}>
                <th scope="row">
                  <ClubCell club={club} self={club.id === dossier.id}>
                    <span
                      className={s.muted}
                      style={{ width: 18, textAlign: "right" }}
                    >
                      {i + 1}
                    </span>
                    <Crest club={club} />
                    {club.name}
                  </ClubCell>
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
                <td title={partTitle}>{fmtNum(paired.expected, 1)}</td>
                <td className={tone(paired.delta)} title={partTitle}>
                  {fmtNum(paired.delta, 1, true)}
                </td>
                {!compact && (
                  <td>{fmtNum(club.record.gf - club.record.ga, 0, true)}</td>
                )}
                {!compact && (
                  <td
                    title={
                      partOf(xg.matches, club.record.matches)
                        ? `Sur ${partOf(xg.matches, club.record.matches)}`
                        : undefined
                    }
                  >
                    {fmtNum(xg.delta, 1, true)}
                  </td>
                )}
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
  // Per match on the matches whose xPts is known; unknown without one (club-supported.js).
  const per = (club, key) => {
    const paired = pairedPoints(club);
    return paired.matches && Number.isFinite(paired[key])
      ? paired[key] / paired.matches
      : null;
  };
  const gap = (club) => per(club, "delta");
  const rows = [...dossier.clubs].sort(
    (a, b) => (gap(b) ?? -Infinity) - (gap(a) ?? -Infinity),
  );
  return (
    <div className={s.tableScroll}>
      <table className={s.table}>
        <caption className="sr-only">
          Écart aux points attendus par match, et classements dans chaque
          championnat
        </caption>
        <thead>
          <tr>
            <th scope="col"><Term>Club</Term></th>
            <th scope="col">
              <Term>Champ. réel · xPts</Term>
            </th>
            <th scope="col"><Term>MJ</Term></th>
            <th scope="col"><Term>Pts / m</Term></th>
            <th scope="col"><Term>xPts / m</Term></th>
            <th scope="col">
              <Term>Écart / m</Term>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((club, i) => {
            const g = gap(club);
            return (
              <tr key={club.id} data-self={club.id === dossier.id}>
                <th scope="row">
                  <ClubCell club={club} self={club.id === dossier.id}>
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
                  </ClubCell>
                </th>
                <td className={s.muted}>
                  {club.leaguePosition
                    ? `${ordinal(club.leaguePosition)} · ${ordinal(club.leagueXptsPosition)}`
                    : "—"}
                </td>
                <td>{club.record.matches}</td>
                <td>{fmtNum(per(club, "actual"), 2)}</td>
                <td>{fmtNum(per(club, "expected"), 2)}</td>
                <td
                  className={
                    g > 0 ? s.up : g < 0 ? s.down : undefined
                  }
                >
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
