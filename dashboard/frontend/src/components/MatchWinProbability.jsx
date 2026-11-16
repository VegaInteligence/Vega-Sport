"use client";
import React, { useRef, useState } from "react";
import { Card } from "./UI.jsx";
import { useHoverBubble } from "./HoverCard.jsx";
import { probabilityChart, share, useMatchWinProbability, withLive } from "../services/forecasts.js";
import s from "./MatchTabs.module.css";

const HOME = "light-dark(#1d6fd6, #3b8eff)";
const AWAY = "light-dark(#53687f, #9cc7ff)";
const DRAW = "light-dark(#d5d9df, #33383f)";
const LINE = "light-dark(#707072, #5a5a5c)";
// The whole width of the overview: a frame drawn wide, so its labels keep their size.
const WIDE = { width: 1200, height: 280, left: 44, right: 1186, top: 30, bottom: 240 };

/** A match minute by minute: the chances of each result as the score and the clock move.
 * Hovered or touched, the chart says the minute, the score and the three chances then.
 * `live`: the match's live state (hooks/useLiveMatch.js), drawn from while the base has not
 * read the match yet. */
export default function MatchWinProbability({ match, live: feed = null }) {
  const chart = probabilityChart(withLive(useMatchWinProbability(match?.id), feed, match), WIDE);
  const svgRef = useRef(null);
  const [at, setAt] = useState(null);
  const bubble = useHoverBubble({ width: 230, follow: true });
  if (!chart) return null;
  const { frame, start, live, series } = chart;
  const home = match.home?.name || "Domicile",
    away = match.away?.name || "Extérieur";
  const shares = (point) => `${home} ${share(point.home)} · nul ${share(point.draw)} · ${away} ${share(point.away)}`;
  const pick = (event) => {
    const svg = svgRef.current;
    if (!svg) return;
    const box = svg.getBoundingClientRect();
    const vx = ((event.clientX - box.left) / box.width) * frame.width;
    let best = series[0];
    for (const point of series) if (Math.abs(point.x - vx) < Math.abs(best.x - vx)) best = point;
    setAt(best);
    bubble.show(svg, (
      <>
        <p className={s.bubbleHead}>
          {Math.round(best.minute)}′{best.score ? ` · ${best.score[0]}–${best.score[1]}` : ""}
        </p>
        <div className={s.bubbleLine}><span className={s.homeText}>{home}</span><b>{share(best.home)}</b></div>
        <div className={s.bubbleLine}><span>Match nul</span><b>{share(best.draw)}</b></div>
        <div className={s.bubbleLine}><span className={s.awayText}>{away}</span><b>{share(best.away)}</b></div>
      </>
    ), event);
  };
  const leave = () => {
    setAt(null);
    bubble.hide();
  };
  return (
    <Card title="Probabilité de victoire" className="match-overview-wide">
      <figure className={`chart-figure ${s.winFigure}`}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${frame.width} ${frame.height}`}
          role="img"
          aria-label={`Probabilités minute par minute. Au coup d’envoi : ${shares(start)}.`}
          className={s.winChart}
          onPointerMove={pick}
          onPointerDown={pick}
          onPointerLeave={leave}
        >
          <path d={chart.paths.away} fill={AWAY} />
          <path d={chart.paths.draw} fill={DRAW} />
          <path d={chart.paths.home} fill={HOME} />
          {[0.25, 0.5, 0.75].map((value) => (
            <text key={value} x={frame.left - 8} y={frame.bottom - value * (frame.bottom - frame.top) + 4} textAnchor="end" className="chart-tick">
              {value * 100} %
            </text>
          ))}
          {chart.goals.map((goal, i) => (
            <g key={`goal-${i}`}>
              <line x1={goal.x} x2={goal.x} y1={frame.top} y2={frame.bottom} stroke={LINE} strokeDasharray="3 3" />
              <text x={goal.x} y={frame.top - 10} textAnchor="middle" className="chart-tick">
                ⚽ {goal.label}
              </text>
            </g>
          ))}
          {chart.reds.map((red, i) => (
            <rect key={`red-${i}`} x={red.x - 3} y={frame.bottom + 4} width="6" height="9" rx="1" fill="light-dark(#d93025, #ff6b61)">
              <title>{`${red.minute}′ : expulsion (${red.side === "home" ? home : away})`}</title>
            </rect>
          ))}
          {chart.ticks.map((tick) => (
            <text key={tick.minute} x={tick.x} y={frame.height - 12} textAnchor="middle" className="chart-tick">
              {tick.minute}′
            </text>
          ))}
          <text x={frame.left + 8} y={frame.bottom - 10} fill="#fff" fontWeight="600">
            {home}
          </text>
          <text x={frame.left + 8} y={frame.top + 20} fill="light-dark(#16202b, #0d1218)" fontWeight="600">
            {away}
          </text>
          {at && (
            <line x1={at.x} x2={at.x} y1={frame.top} y2={frame.bottom} stroke="light-dark(#16202b, #fff)" strokeWidth="2" />
          )}
        </svg>
        <figcaption>
          {live ? `En cours (${live.minute}′) : ${shares(live)}. ` : ""}
          Au coup d’envoi{chart.lineups ? ", compositions prises en compte" : ""} : {shares(start)}. Survolez ou touchez le
          graphique pour lire chaque minute. Le modèle connaît le score, l’heure et les expulsions, pas le jeu lui-même.
        </figcaption>
      </figure>
      {chart.swings.length > 0 && (
        <ol className={s.swings} aria-label="Ce que chaque but a changé">
          {chart.swings.map((swing, i) => (
            <li key={i}>
              ⚽ {swing.minute}′ · {swing.label} · {swing.side === "home" ? home : away} {share(swing.from)} →{" "}
              <b>{share(swing.to)}</b>
            </li>
          ))}
        </ol>
      )}
      {bubble.bubble}
    </Card>
  );
}
