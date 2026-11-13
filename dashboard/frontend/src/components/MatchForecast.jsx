"use client";
import React from "react";
import { Card } from "./UI.jsx";
import { matchForecastReading, useMatchForecast, share } from "../services/forecasts.js";

const goals = (value) => value.toFixed(1).replace(".", ",");

/** Before kick-off: what the model gives for the match, from the two teams' strengths and,
 *  once both have confirmed their eleven, from those line-ups. */
export default function MatchForecast({ match }) {
  const home = match?.home?.name || "Domicile",
    away = match?.away?.name || "Extérieur";
  const reading = matchForecastReading(useMatchForecast(match?.id), home, away);
  if (!reading) return null;
  const { forecast } = reading;
  const parts = [
    [home, forecast.home, "home"],
    ["Nul", forecast.draw, "draw"],
    [away, forecast.away, "away"],
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
        {goals(forecast.awayGoals)}. {reading.basis}
        {reading.before ? ` ${reading.before}` : ""}
      </p>
    </Card>
  );
}
