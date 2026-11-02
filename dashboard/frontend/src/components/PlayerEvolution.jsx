"use client";
import React, { useState } from "react";
import { useFootball } from "../hooks/FootballContext.jsx";
import { useResource } from "../services/resources.js";
import { loadPlayerHistory } from "../services/scouting-history.js";
import { profileValue, SCOUT_METRICS } from "../services/scouting.js";
import { number } from "../services/format.js";
import { AsyncState, Segments } from "./UI.jsx";
import { ComparePlayerButton } from "./ResearchUI.jsx";
import { ResearchTrend } from "./ResearchCharts.jsx";
export default function PlayerEvolution({ id, profile }) {
  const f = useFootball(),
    [metric, setMetric] = useState("rating"),
    [mode, setMode] = useState("per90");
  const history = useResource(
    `player-history:${id}:${f.manifest.scouting?.sourceDigest}`,
    () => loadPlayerHistory(f.manifest, id),
  );
  return (
    <>
      <div className="research-toolbar">
        <label>
          Indicateur
          <select
            aria-label="Indicateur de l’évolution"
            value={metric}
            onChange={(e) => setMetric(e.target.value)}
          >
            <option value="rating">Note PitchAPI</option>
            <option value="minutes">Minutes jouées</option>
            {Object.entries(SCOUT_METRICS).map(([key, d]) => (
              <option key={key} value={key}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <Segments
          label="Base de l’évolution"
          value={mode}
          onChange={setMode}
          items={[
            ["per90", "Par 90"],
            ["total", "Totaux"],
            ["perMatch", "Par match"],
          ]}
        />
      </div>
      <AsyncState resource={history}>
        {(seasons) => (
          <>
            <ResearchTrend
              label={`${metric === "rating" ? "Note PitchAPI" : metric === "minutes" ? "Minutes jouées" : SCOUT_METRICS[metric].label} · saisons collectées`}
              points={[...seasons]
                .reverse()
                .map((s) => ({
                  label: s.season,
                  value: profileValue(s.profile, metric, mode),
                }))}
            />
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Saison</th>
                    <th>Clubs</th>
                    <th>Matchs</th>
                    <th>Minutes</th>
                    <th>Valeur</th>
                    <th>Couverture</th>
                    <th>Comparer</th>
                  </tr>
                </thead>
                <tbody>
                  {seasons.map((s) => (
                    <tr key={s.season}>
                      <th>{s.season}</th>
                      <td>{s.profile.teams.join(" · ") || "—"}</td>
                      <td>{number(s.profile.matches)}</td>
                      <td>{number(s.profile.minutes)}</td>
                      <td>
                        {number(
                          profileValue(s.profile, metric, mode),
                          metric === "minutes" ? 0 : 2,
                        )}
                      </td>
                      <td>
                        {metric === "rating"
                          ? s.profile.ratingCount
                          : metric === "minutes"
                            ? s.profile.matches
                            : (s.profile.stats[metric]?.count ??
                              s.profile.ratios[metric]?.count ??
                              0)}
                        /{s.profile.matches}
                      </td>
                      <td>
                        <ComparePlayerButton
                          profile={s.profile}
                          season={s.season}
                          compact
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </AsyncState>
      {profile.rows.length > 1 && (
        <>
          <h3>Forme récente</h3>
          <ResearchTrend
            label="Notes des dix derniers matchs renseignés"
            points={profile.rows
              .slice(0, 10)
              .reverse()
              .map((row) => ({ label: row.date.slice(5), value: row.rating }))}
          />
        </>
      )}
    </>
  );
}
