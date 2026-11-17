"use client";
import React from "react";
import { share } from "../services/forecasts.js";
import { matchForecast } from "../services/cup-matches.js";

/**
 * A match to come's forecast in a list (VI-19): a bar of three parts (home, draw, away), then the three shares. The same
 * in every competition's list: the cups', the leagues', a club's coming matches, the calendar. Nothing without a forecast.
 */
export default function MatchForecastBar({ home, away, forecast }) {
  const f = matchForecast(forecast);
  if (!f) return null;
  const parts = [[home, f.home, "home"], ["Nul", f.draw, "draw"], [away, f.away, "away"]];
  return (
    <span className="list-forecast" role="img" aria-label={parts.map(([name, value]) => `${name} ${share(value)}`).join(", ")}>
      <span className="list-forecast-bar">{parts.map(([, value, side]) => <i key={side} data-side={side} style={{ flexGrow: Math.max(value, 0.02) }} />)}</span>
      <span className="list-forecast-shares">{parts.map(([, value, side]) => <b key={side} data-side={side}>{share(value)}</b>)}</span>
    </span>
  );
}
