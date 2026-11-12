"use client";
import React from "react";
import { Card } from "./UI.jsx";
import { useMatchForecast, share } from "../services/forecasts.js";

const goals = (value) => value.toFixed(1).replace(".", ",");

/** Before kick-off: what the model gives for the match, from the two teams' strengths. */
export default function MatchForecast({ match }) {
  const answer = useMatchForecast(match?.id);
  const forecast = answer?.forecast;
  if (!forecast) return null;
  const parts = [
    [match.home?.name || "Domicile", forecast.home, "home"],
    ["Nul", forecast.draw, "draw"],
    [match.away?.name || "Extérieur", forecast.away, "away"],
  ];
  return (
    <Card title="Probabilités">
      <div className="match-forecast-bar" role="img" aria-label={parts.map(([name, value]) => `${name} ${share(value)}`).join(", ")}>
        {parts.map(([name, value, side]) => (
          <span key={side} data-side={side} style={{ flexGrow: Math.max(value, 0.04) }} title={name} />
        ))}
      </div>
      <ul className="match-forecast-shares">
        {parts.map(([name, value, side]) => (
          <li key={side} data-side={side}>
            <strong>{share(value)}</strong>
            <span>{name}</span>
          </li>
        ))}
      </ul>
      <p className="match-forecast-note">
        Score le plus probable {forecast.score[0]}–{forecast.score[1]} · buts attendus {goals(forecast.homeGoals)} –{" "}
        {goals(forecast.awayGoals)}. D’après la force des deux équipes avant le match ; le modèle ne connaît ni les
        compositions ni les absents.
      </p>
    </Card>
  );
}
