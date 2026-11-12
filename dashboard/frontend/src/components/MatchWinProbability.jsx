"use client";
import React from "react";
import { Card } from "./UI.jsx";
import { probabilityChart, share, useMatchWinProbability } from "../services/forecasts.js";

const HOME = "light-dark(#1d6fd6, #3b8eff)";
const AWAY = "light-dark(#53687f, #9cc7ff)";
const DRAW = "light-dark(#d5d9df, #33383f)";
const LINE = "light-dark(#707072, #5a5a5c)";

/** A match minute by minute: the chances of each result as the score and the clock move. */
export default function MatchWinProbability({ match }) {
  const chart = probabilityChart(useMatchWinProbability(match?.id));
  if (!chart) return null;
  const { frame, start, live } = chart;
  const home = match.home?.name || "Domicile",
    away = match.away?.name || "Extérieur";
  const shares = (point) => `${home} ${share(point.home)} · nul ${share(point.draw)} · ${away} ${share(point.away)}`;
  return (
    <Card title="Probabilité de victoire" className="match-overview-wide">
      <figure className="chart-figure">
        <svg
          viewBox={`0 0 ${frame.width} ${frame.height}`}
          role="img"
          aria-label={`Probabilités minute par minute. Au coup d’envoi : ${shares(start)}.`}
        >
          <path d={chart.paths.away} fill={AWAY} />
          <path d={chart.paths.draw} fill={DRAW} />
          <path d={chart.paths.home} fill={HOME} />
          {chart.goals.map((goal, i) => (
            <g key={`goal-${i}`}>
              <line x1={goal.x} x2={goal.x} y1={frame.top} y2={frame.bottom} stroke={LINE} strokeDasharray="3 3" />
              <text x={goal.x} y={frame.top - 8} textAnchor="middle" className="chart-tick">
                {goal.label}
              </text>
              <title>{`${goal.minute}′ : but, ${goal.label}`}</title>
            </g>
          ))}
          {chart.reds.map((red, i) => (
            <rect key={`red-${i}`} x={red.x - 3} y={frame.bottom + 4} width="6" height="9" rx="1" fill="light-dark(#d93025, #ff6b61)">
              <title>{`${red.minute}′ : expulsion (${red.side === "home" ? home : away})`}</title>
            </rect>
          ))}
          {chart.ticks.map((tick) => (
            <text key={tick.minute} x={tick.x} y={frame.height - 8} textAnchor="middle" className="chart-tick">
              {tick.minute}′
            </text>
          ))}
          <text x={frame.left + 6} y={frame.bottom - 8} fill="#fff">
            {home}
          </text>
          <text x={frame.left + 6} y={frame.top + 16} fill="light-dark(#16202b, #0d1218)">
            {away}
          </text>
        </svg>
        <figcaption>
          {live ? `En cours (${live.minute}′) : ${shares(live)}. ` : ""}
          Au coup d’envoi : {shares(start)}. Le modèle connaît le score, l’heure et les expulsions, pas le jeu
          lui-même.
        </figcaption>
      </figure>
    </Card>
  );
}
