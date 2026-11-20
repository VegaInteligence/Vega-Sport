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

/** A match minute by minute: the chances of each result as three lines, each goal a jump with
 * what it changed for the side that scored. The read-out beside it follows the pointer, else
 * gives the present or final state. `live`: the match's live state (hooks/useLiveMatch.js),
 * drawn from while the base has not read the match yet. */
export default function MatchWinProbability({ match, live: feed = null }) {
  const chart = probabilityLines(withLive(useMatchWinProbability(match?.id), feed, match));
  const [ref, width] = useBoxWidth(900);
  const [at, setAt] = useState(null);
  if (!chart) return null;
  const { lines, series, goals, reds, span, start, end, live } = chart;
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
  const head = at
    ? `${Math.round(at.minute)}′${at.score ? ` · ${scoreText(at)}` : ""}`
    : `${live ? `En cours · ${live.minute}′` : "Fin"}${end.score ? ` · ${scoreText(end)}` : ""}`;
  const goalText = (goal) => {
    const base = `${goal.minute}′ · ${goal.label}`;
    if (phone || goal.from == null) return base;
    return `${base} · ${goal.side === "home" ? home : away} ${Math.round(goal.from * 100)} → ${Math.round(goal.to * 100)} %`;
  };
  return (
    <Card title="Probabilité de victoire" className="match-overview-wide">
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
              <g data-plot data-x0={x0} data-x1={x1} data-span={span}>
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
                {[0, 15, 30, 45, 60, 75, 90].map((minute) => (
                  <text key={minute} x={x(minute)} y={height - 8} textAnchor="middle" className={s.winTick}>
                    {minute === 45 ? "MT" : `${minute}′`}
                  </text>
                ))}
                <path data-line="draw" d={path("draw")} fill="none" stroke={DRAW} strokeWidth="2" strokeDasharray="4 3" />
                <path data-line="away" d={path("away")} fill="none" stroke={AWAY} strokeWidth="2.25" strokeLinejoin="round" />
                <path data-line="home" d={path("home")} fill="none" stroke={HOME} strokeWidth="2.25" strokeLinejoin="round" />
                {goals.map((goal, i) => {
                  const gx = x(goal.minute);
                  const text = goalText(goal);
                  const left = gx - x0 > text.length * 6.6 + 12;
                  return (
                    <g key={`goal-${i}`} data-goal>
                      <line x1={gx} x2={gx} y1={m.t - 6} y2={height - m.b} stroke="var(--ink-strong)" strokeOpacity="0.5" />
                      <circle cx={gx} cy={m.t - 12} r="4.5" fill={goal.side === "home" ? HOME : AWAY} stroke="var(--bg)" strokeWidth="2" />
                      <text x={left ? gx - 10 : gx + 10} y={m.t - 8} textAnchor={left ? "end" : "start"} className={s.winGoal}>
                        {text}
                      </text>
                    </g>
                  );
                })}
                {reds.map((red, i) => (
                  <rect key={`red-${i}`} x={x(red.minute) - 3} y={height - m.b + 4} width="6" height="9" fill={RED}>
                    <title>{`${red.minute}′ : expulsion (${red.side === "home" ? home : away})`}</title>
                  </rect>
                ))}
                {at && <line x1={x(at.minute)} x2={x(at.minute)} y1={m.t} y2={height - m.b} stroke="var(--ink-strong)" strokeWidth="1.5" />}
              </g>
            </svg>
          </div>
          <div className={s.winReadout} data-readout aria-live="polite">
            <p className={s.winReadoutHead}>{head}</p>
            <dl>
            {[
              [home, shown.home, HOME],
              ["Nul", shown.draw, DRAW],
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
        <figcaption>
          Au coup d’envoi{chart.lineups ? ", compositions prises en compte" : ""} : {shares(start)}. Le modèle connaît
          le score, l’heure et les expulsions, pas le jeu lui-même.
        </figcaption>
      </figure>
    </Card>
  );
}
