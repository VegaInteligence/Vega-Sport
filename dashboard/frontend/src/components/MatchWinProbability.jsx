"use client";
import React, { useState } from "react";
import { Card } from "./UI.jsx";
import { probabilityLines, share, useMatchWinProbability, withLive } from "../services/forecasts.js";
import useBoxWidth from "../hooks/useBoxWidth.js";
import s from "./MatchTabs.module.css";

const HOME = "var(--home)";
const AWAY = "var(--away)";
const DRAW = "var(--muted)";
const RED = "light-dark(#d93025, #ff6b61)";
const CHIP_GAP = 6;

/** A chip's width for its text: a dot, the score in tabular figures, padding. */
const chipWidth = (text) => 22 + text.length * 7;

/**
 * Left edges for chips of `widths` wanted centred on `centres` (in order), on one row between `lo`
 * and `hi`: each as close to its centre as the others allow, never closer than CHIP_GAP. Chips that
 * would touch are moved as one block, centred on their centres' mean.
 */
export function spreadChips(centres, widths, lo, hi) {
  const blocks = [];
  centres.forEach((centre, i) => {
    let block = { first: i, last: i, want: centre - widths[i] / 2, size: widths[i] };
    for (;;) {
      block.left = Math.min(Math.max(block.want, lo), hi - block.size);
      const prev = blocks.at(-1);
      if (!prev || prev.left + prev.size + CHIP_GAP <= block.left) break;
      blocks.pop();
      const n1 = prev.last - prev.first + 1, n2 = block.last - block.first + 1;
      // The merged block's wanted left edge: the mean of each chip's wanted edge, minus its offset in the block.
      const want = (prev.want * n1 + (block.want - prev.size - CHIP_GAP) * n2) / (n1 + n2);
      block = { first: prev.first, last: block.last, want, size: prev.size + CHIP_GAP + block.size };
    }
    blocks.push(block);
  });
  const lefts = [];
  for (const block of blocks) {
    let left = block.left;
    for (let i = block.first; i <= block.last; i++) {
      lefts.push(left);
      left += widths[i] + CHIP_GAP;
    }
  }
  return lefts;
}

/** A match minute by minute: the chances of each result as three lines, each goal a jump marked by a
 * chip above the plot (the score it made, joined to its minute), and listed under the chart with
 * what it changed for the side that scored. The read-out beside it follows the pointer, else
 * gives the present or final state. `live`: the match's live state (hooks/useLiveMatch.js),
 * drawn from while the base has not read the match yet. `bare`: the chart without its own card (a view
 * of the Résumé's « Le match minute par minute »). */
export default function MatchWinProbability({ match, live: feed = null, bare = false }) {
  const chart = probabilityLines(withLive(useMatchWinProbability(match?.id), feed, match));
  const [ref, width] = useBoxWidth(900);
  const [at, setAt] = useState(null);
  if (!chart) return null;
  const { lines, series, goals, reds, span, start, end, live, extra, penalties } = chart;
  const home = match.home?.name || "Domicile",
    away = match.away?.name || "Extérieur";
  const shares = (point) => `${home} ${share(point.home)} · nul ${share(point.draw)} · ${away} ${share(point.away)}`;
  const phone = width < 520;
  const height = phone ? 210 : 250;
  const m = { t: 30, r: 12, b: 26, l: 48 };
  const x0 = m.l,
    x1 = width - m.r;
  const x = (minute) => x0 + (Math.min(minute, span) / span) * (x1 - x0);
  const y = (p) => m.t + (1 - p) * (height - m.t - m.b);
  const path = (key) => lines.map((p, i) => `${i ? "L" : "M"}${x(p.minute).toFixed(1)},${y(p[key]).toFixed(1)}`).join("");
  const pick = (event) => {
    const box = event.currentTarget.getBoundingClientRect();
    const minute = ((event.clientX - box.left - x0) / (x1 - x0)) * span;
    let best = series[0];
    for (const point of series) if (Math.abs(point.minute - minute) < Math.abs(best.minute - minute)) best = point;
    setAt(best);
  };
  const shown = at || end;
  const scoreText = (point) => (point.score ? `${point.score[0]}–${point.score[1]}` : "");
  // The end of a match that went past the 90th: « a.p. » after extra time, the shoot-out's score after one.
  const pens = penalties ? `${penalties[0]}–${penalties[1]}` : "";
  const after = penalties ? ` · t.a.b. ${pens}` : extra ? " a.p." : "";
  const head = at
    ? `${Math.round(at.minute)}′${at.score ? ` · ${scoreText(at)}` : ""}`
    : live
      ? penalties ? `Tirs au but · ${pens}` : `En cours · ${live.minute}′${end.score ? ` · ${scoreText(end)}` : ""}`
      : `Fin${end.score ? ` · ${scoreText(end)}` : ""}${after}`;
  const ticks = extra ? [0, 15, 30, 45, 60, 75, 90, 105, 120] : [0, 15, 30, 45, 60, 75, 90];
  // One row of chips above the plot, each nudged just enough not to touch the others.
  const widths = goals.map((goal) => chipWidth(goal.label));
  const lefts = spreadChips(goals.map((goal) => x(goal.minute)), widths, 0, width);
  const CHIP_TOP = 4,
    CHIP_H = 16;
  const Frame = bare ? React.Fragment : Card;
  const frame = bare ? {} : { title: "Probabilité de victoire", className: "match-overview-wide" };
  return (
    <Frame {...frame}>
      <figure className={`chart-figure ${s.winFigure}`}>
        <div className={s.winBody}>
          <div ref={ref} className={s.winPlot}>
            <svg
              data-chart="win-probability"
              width={width}
              height={height}
              viewBox={`0 0 ${width} ${height}`}
              role="img"
              aria-label={`Probabilités minute par minute. Au coup d’envoi : ${shares(start)}.`}
              className={s.winChart}
              // Its measured size, over the site's « .chart-figure svg » that stretches every chart.
              style={{ width, height, maxHeight: "none" }}
              onPointerMove={pick}
              onPointerDown={pick}
              onPointerLeave={() => setAt(null)}
            >
              <g data-plot data-x0={x0} data-x1={x1} data-span={span} data-top={m.t}>
                {[0, 0.25, 0.5, 0.75, 1].map((v) => (
                  <line
                    key={v}
                    x1={x0}
                    x2={x1}
                    y1={y(v)}
                    y2={y(v)}
                    stroke={v ? "var(--grid)" : "var(--border-strong)"}
                    strokeDasharray={v ? "2 3" : undefined}
                  />
                ))}
                {[0, 0.5, 1].map((v) => (
                  <text key={v} x={x0 - 8} y={y(v) + 4} textAnchor="end" className={s.winTick}>
                    {v * 100} %
                  </text>
                ))}
                <line x1={x(45)} x2={x(45)} y1={m.t} y2={height - m.b} stroke="var(--border-strong)" />
                {extra && (
                  <g data-extra-time>
                    <line x1={x(90)} x2={x(90)} y1={m.t} y2={height - m.b} stroke="var(--muted)" strokeWidth="1.5" />
                    <line x1={x(105)} x2={x(105)} y1={m.t} y2={height - m.b} stroke="var(--border-strong)" strokeDasharray="2 3" />
                  </g>
                )}
                {ticks.map((minute) => (
                  <text key={minute} x={x(minute)} y={height - 8} textAnchor="middle" className={s.winTick}>
                    {minute === 45 ? "MT" : `${minute}′`}
                  </text>
                ))}
                <path data-line="draw" d={path("draw")} fill="none" stroke={DRAW} strokeWidth="2" strokeDasharray="4 3" />
                <path data-line="away" d={path("away")} fill="none" stroke={AWAY} strokeWidth="2.25" strokeLinejoin="round" />
                <path data-line="home" d={path("home")} fill="none" stroke={HOME} strokeWidth="2.25" strokeLinejoin="round" />
                {goals.map((goal, i) => {
                  const gx = x(goal.minute),
                    left = lefts[i],
                    bottom = CHIP_TOP + CHIP_H;
                  return (
                    <g key={`goal-${i}`} data-goal>
                      <line data-goal-line x1={gx} x2={gx} y1={m.t} y2={height - m.b} stroke="var(--ink-strong)" strokeOpacity="0.5" />
                      <line data-leader x1={left + widths[i] / 2} y1={bottom} x2={gx} y2={m.t} stroke="var(--ink-strong)" strokeOpacity="0.5" />
                      <g data-chip>
                        <rect x={left} y={CHIP_TOP} width={widths[i]} height={CHIP_H} className={s.winChip} />
                        <circle data-chip-dot cx={left + 8} cy={CHIP_TOP + CHIP_H / 2} r="3.5" fill={goal.side === "home" ? HOME : AWAY} />
                        <text x={left + 15} y={CHIP_TOP + 12} className={s.winGoal}>
                          {goal.label}
                        </text>
                      </g>
                    </g>
                  );
                })}
                {reds.map((red, i) => (
                  <rect key={`red-${i}`} x={x(red.minute) - 3} y={height - m.b + 4} width="6" height="9" fill={RED}>
                    <title>{`${red.minute}′ : expulsion (${red.side === "home" ? home : away})`}</title>
                  </rect>
                ))}
                {extra && (
                  <text x={x(90) + 6} y={m.t + 12} className={s.winPeriod}>
                    {phone ? "Prol." : "Prolongation"}
                  </text>
                )}
                {at && <line x1={x(at.minute)} x2={x(at.minute)} y1={m.t} y2={height - m.b} stroke="var(--ink-strong)" strokeWidth="1.5" />}
              </g>
            </svg>
          </div>
          <div className={s.winReadout} data-readout aria-live="polite">
            <p className={s.winReadoutHead}>{head}</p>
            <dl>
            {[
              [home, shown.home, HOME],
              // After the 90th of a match in extra time, level means a shoot-out.
              [extra && shown.minute > 90 ? "Tirs au but" : "Nul", shown.draw, DRAW],
              [away, shown.away, AWAY],
            ].map(([name, value, color]) => (
              <div key={name}>
                <dt>
                  <i style={{ background: color }} />
                  {name}
                </dt>
                <dd>{value === 0 ? "0 %" : share(value)}</dd>
              </div>
            ))}
            </dl>
          </div>
        </div>
        {goals.length > 0 && (
          <ol data-goal-list className={s.winGoals}>
            {goals.map((goal, i) => (
              <li key={i}>
                <i style={{ background: goal.side === "home" ? HOME : AWAY }} />
                <b>
                  {goal.minute}′ {goal.label}
                </b>
                {goal.from != null &&
                  ` ${goal.side === "home" ? home : away} ${Math.round(goal.from * 100)} → ${Math.round(goal.to * 100)} %`}
              </li>
            ))}
          </ol>
        )}
        <figcaption>
          Au coup d’envoi{chart.lineups ? ", compositions prises en compte" : ""} : {shares(start)}. Le modèle connaît
          le score, l’heure et les expulsions, pas le jeu lui-même.
        </figcaption>
      </figure>
    </Frame>
  );
}
