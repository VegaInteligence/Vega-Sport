"use client";
import Link from "next/link";
import React, { useEffect, useRef, useState } from "react";
import { useFootball } from "../hooks/FootballContext.jsx";
import { Media } from "./UI.jsx";
import { gradeTone } from "../services/grades.js";
import s from "./FormBars.module.css";

/* A player's recent form: one thin bar per rated match on a faint 0–100 rail, a curve over
   the bars' tops, the period's average as a dotted hairline, and under each bar the match
   it stands for. Each column links to its match; hover or focus opens a short tip, a first
   tap on a touch screen opens the match's line under the chart instead. */

const TONES = ["neg-2", "neg-1", "mid", "pos-1", "pos-2"];
/** The tone of the figure shown: 59.5 is displayed 60, so it takes the 60-and-over tone. */
const toneOf = (grade) =>
  `var(--mq-${TONES[gradeTone(Math.round(grade)) - 1]})`;
const RESULT = { V: "victoire", N: "nul", D: "défaite" };

const day = (value, narrow) => {
  if (!value) return "";
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00Z`);
  return date.toLocaleDateString(
    "fr-FR",
    narrow
      ? { day: "2-digit", month: "2-digit", timeZone: "UTC" }
      : { day: "numeric", month: "short", timeZone: "UTC" },
  );
};
const versus = (item) => (item.home ? "vs" : "à");
const scoreText = (item) =>
  item.score ? `${item.score.for}–${item.score.against}` : "";
/** What a screen reader hears for a column: who, how it ended, when, the grade. */
function describe(item) {
  const parts = [
    item.opponent
      ? `${versus(item)} ${item.opponent.name}`
      : item.competition || "Match",
  ];
  if (item.result && item.score)
    parts.push(`${RESULT[item.result]} ${scoreText(item)}`);
  if (item.date) parts.push(day(item.date));
  parts.push(`note ${Math.round(item.grade)}`);
  return parts.join(", ");
}

/** The drawing follows its box's real width, so text and marks keep their pixel size. */
function useWidth(fallback) {
  const ref = useRef(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") return undefined;
    const update = () => node.clientWidth && setWidth(node.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/** Monotone cubic through the tops (Fritsch–Carlson): the curve never overshoots a grade. */
function curve(points) {
  const n = points.length;
  const dx = [],
    slope = [],
    tangent = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = points[i + 1][0] - points[i][0];
    slope[i] = (points[i + 1][1] - points[i][1]) / dx[i];
  }
  tangent[0] = slope[0];
  tangent[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i++)
    tangent[i] =
      slope[i - 1] * slope[i] <= 0
        ? 0
        : (3 * (dx[i - 1] + dx[i])) /
          ((2 * dx[i] + dx[i - 1]) / slope[i - 1] +
            (dx[i] + 2 * dx[i - 1]) / slope[i]);
  let path = `M${points[0][0]} ${points[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    path += `C${points[i][0] + h} ${points[i][1] + h * tangent[i]} ${points[i + 1][0] - h} ${
      points[i + 1][1] - h * tangent[i + 1]
    } ${points[i + 1][0]} ${points[i + 1][1]}`;
  }
  return path;
}

export default function FormBars({ items, average, ariaLabel }) {
  const f = useFootball();
  const [ref, width] = useWidth(1000);
  const [active, setActive] = useState(null);
  const [tapped, setTapped] = useState(false);
  const touch = useRef(false);
  const narrow = width < 560;
  const n = items.length;
  const height = narrow ? 132 : 150;
  const top = 24;
  const inner = height - top - 2;
  const gutter = narrow ? 28 : 36; // the average's figure
  const plot = Math.max(1, width - gutter);
  const column = plot / Math.max(1, n);
  const bar = narrow ? 6 : 8;
  const x = (i) => column * (i + 0.5);
  const y = (value) =>
    top + inner - (Math.max(0, Math.min(100, value)) / 100) * inner;
  const mean = Number.isFinite(average) ? Math.round(average) : null;
  const tip = active != null && !tapped ? items[active] : null;
  const picked = active != null && tapped ? items[active] : null;
  const href = (item) => f.href("/matchs/", { id: item.matchId });

  return (
    <div
      className={s.root}
      ref={ref}
      data-narrow={narrow ? "" : undefined}
      data-tight={column < 46 ? "" : undefined}
    >
      <svg
        className={s.plot}
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={ariaLabel}
      >
        {active != null && (
          <rect
            className={s.band}
            x={x(active) - column / 2 + 4}
            y={0}
            width={Math.max(0, column - 8)}
            height={height}
            rx={8}
          />
        )}
        <line
          className={s.base}
          x1={0}
          x2={plot}
          y1={y(0) + 0.5}
          y2={y(0) + 0.5}
        />
        {mean != null && (
          <g data-average={mean}>
            <line
              className={s.average}
              x1={0}
              x2={plot + 4}
              y1={y(mean)}
              y2={y(mean)}
            />
            <text
              className={s.averageText}
              x={width}
              y={y(mean) + 4}
              textAnchor="end"
            >
              {mean}
            </text>
          </g>
        )}
        {items.map((item, i) => {
          const shown = Math.round(item.grade);
          return (
            <g
              key={item.key}
              opacity={active == null || active === i ? 1 : 0.45}
            >
              <rect
                className={s.rail}
                x={x(i) - bar / 2}
                y={top}
                width={bar}
                height={inner}
                rx={bar / 2}
              />
              <rect
                data-bar={shown}
                fill={toneOf(item.grade)}
                x={x(i) - bar / 2}
                y={y(item.grade)}
                width={bar}
                height={Math.max(bar, y(0) - y(item.grade))}
                rx={bar / 2}
              />
            </g>
          );
        })}
        {n >= 2 && (
          <path
            data-curve=""
            className={s.curve}
            d={curve(items.map((item, i) => [x(i), y(item.grade)]))}
          />
        )}
        {items.map((item, i) => (
          <g key={item.key}>
            {n >= 2 && (
              <circle
                className={s.dot}
                cx={x(i)}
                cy={y(item.grade)}
                r={active === i ? 4 : 3}
              />
            )}
            <text
              className={`${s.value} ${active != null && active !== i ? s.dim : ""}`}
              x={x(i)}
              y={y(item.grade) - 10}
              textAnchor="middle"
            >
              {Math.round(item.grade)}
            </text>
          </g>
        ))}
      </svg>
      <ol
        className={s.columns}
        style={{
          width: `${(plot / width) * 100}%`,
          gridTemplateColumns: `repeat(${Math.max(1, n)}, minmax(0, 1fr))`,
          marginTop: -height,
        }}
      >
        {items.map((item, i) => (
          <li key={item.key}>
            <Link
              href={href(item)}
              prefetch={false}
              className={s.column}
              style={{ paddingTop: height + 10 }}
              data-active={active === i ? "" : undefined}
              aria-label={describe(item)}
              onPointerDown={(event) => {
                touch.current = event.pointerType === "touch";
              }}
              onPointerEnter={(event) => {
                if (event.pointerType === "touch") return;
                setTapped(false);
                setActive(i);
              }}
              onPointerLeave={(event) => {
                if (event.pointerType === "touch" || tapped) return;
                setActive(null);
              }}
              onFocus={() => {
                if (touch.current) return;
                setTapped(false);
                setActive(i);
              }}
              onBlur={() => !tapped && setActive(null)}
              onClick={(event) => {
                // A first tap shows the match under the chart; a second one opens it.
                if (touch.current && !(tapped && active === i)) {
                  event.preventDefault();
                  setTapped(true);
                  setActive(i);
                }
              }}
            >
              {item.opponent ? (
                <>
                  <span className={s.crest} aria-hidden="true">
                    <Media
                      name={item.opponent.name}
                      url={item.opponent.imageUrl}
                    />
                  </span>
                  <span className={s.name}>
                    <span>{versus(item)}</span> {item.opponent.name}
                  </span>
                </>
              ) : (
                <>
                  <span className={s.crest} aria-hidden="true" />
                  <span className={s.name}>{item.competition}</span>
                </>
              )}
              {item.score && (
                <span className={s.score}>
                  <i data-result={item.result} />
                  {scoreText(item)}
                </span>
              )}
              <span className={s.date}>{day(item.date, narrow)}</span>
            </Link>
          </li>
        ))}
      </ol>
      {tip && (
        <div
          className={s.tip}
          style={
            active < n / 2
              ? { left: column * (active + 1) + 4 }
              : { right: width - column * active + 4 }
          }
          role="presentation"
        >
          <strong>
            {tip.opponent && (
              <Media name={tip.opponent.name} url={tip.opponent.imageUrl} />
            )}
            {tip.opponent
              ? `${versus(tip)} ${tip.opponent.name}`
              : tip.competition}
          </strong>
          <span>
            {[
              tip.opponent && tip.competition,
              Number.isFinite(tip.minutes) && `${tip.minutes}′`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
          <span>
            Buts / PD <b>{tip.goalsAssists}</b>
          </span>
          <em>Voir le match →</em>
        </div>
      )}
      {picked && (
        <div className={s.detail}>
          {picked.opponent && (
            <Media name={picked.opponent.name} url={picked.opponent.imageUrl} />
          )}
          <div>
            <strong>
              {picked.opponent
                ? `${versus(picked)} ${picked.opponent.name}`
                : picked.competition}
            </strong>
            <span>
              {[
                picked.result &&
                  picked.score &&
                  `${RESULT[picked.result][0].toUpperCase()}${RESULT[picked.result].slice(1)} ${scoreText(picked)}`,
                day(picked.date),
                Number.isFinite(picked.minutes) && `${picked.minutes}′`,
                `B/PD\u00a0${String(picked.goalsAssists).replaceAll(" ", "\u00a0")}`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </div>
          <Link href={href(picked)} prefetch={false}>
            Match →
          </Link>
        </div>
      )}
    </div>
  );
}
