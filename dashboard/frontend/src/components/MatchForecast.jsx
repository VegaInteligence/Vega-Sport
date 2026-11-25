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
  // The bar and the shares under it share one grid: each share sits under its own part of the
  // bar (the shares were in three equal thirds: « Nul » fell under the favourite's part).
  const columns = { gridTemplateColumns: parts.map(([, value]) => `minmax(var(--forecast-min), ${Math.max(value, 0.01)}fr)`).join(" ") };
  return (
    <Card title="Probabilités">
      <div className="match-forecast-bar" style={columns} role="img" aria-label={parts.map(([name, value]) => `${name} ${share(value)}`).join(", ")}>
        {parts.map(([name, , side]) => (
          <span key={side} data-side={side} title={name} />
        ))}
      </div>
      <ul className="match-forecast-shares" style={columns}>
        {parts.map(([name, value, side]) => (
          <li key={side} data-side={side}>
            <strong>{share(value)}</strong>
            <span>{name}</span>
          </li>
        ))}
      </ul>
      {/* The forecast in parts (FAILURE_MODES § 69, proposal A of the mock-up hugo chose). */}
      <div className="match-forecast-figures">
        <div>
          <small>Score le plus probable</small>
          <b>
            {forecast.score[0]}
            <i>–</i>
            {forecast.score[1]}
          </b>
        </div>
        <div>
          <small>Buts attendus</small>
          <b>
            {goals(forecast.homeGoals)}
            <i>–</i>
            {goals(forecast.awayGoals)}
          </b>
        </div>
      </div>
      <div className="match-forecast-read">
        <h4>Ce que le modèle a lu</h4>
        <div className="match-forecast-chips">
          {reading.sources.map((source) => (
            <span key={source} className="match-forecast-chip">
              {source}
            </span>
          ))}
        </div>
        {reading.elevens.length ? (
          <ul className="match-forecast-elevens">
            {reading.elevens.map((eleven) => (
              <li key={eleven.side} data-side={eleven.side}>
                <span>
                  <i aria-hidden="true" />
                  Onze de {eleven.name}
                </span>
                <span data-tone={eleven.tone}>{eleven.words}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="match-forecast-note">Le modèle ne connaît ni les compositions ni les absents.</p>
        )}
      </div>
      {reading.without && (
        <table className="match-forecast-compare">
          <thead>
            <tr>
              <th scope="col">
                <span className="sr-only">Pronostic</span>
              </th>
              <th scope="col">{home}</th>
              <th scope="col">Nul</th>
              <th scope="col">{away}</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["Avec les compositions", forecast],
              ["Sans les compositions", reading.without],
            ].map(([label, values]) => (
              <tr key={label}>
                <th scope="row">{label}</th>
                <td>{share(values.home)}</td>
                <td>{share(values.draw)}</td>
                <td>{share(values.away)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
