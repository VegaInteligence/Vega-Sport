"use client";
import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useFootball } from "../hooks/FootballContext.jsx";
import { useResource } from "../services/resources.js";
import { loadPlayerHistory } from "../services/scouting-history.js";
import { profileValue, SCOUT_METRICS } from "../services/scouting.js";
import { date, number } from "../services/format.js";
import { observedMinutes } from "../services/trend-chart.js";
import { seasonTrendPoints } from "../services/player-season-history.js";
import { AsyncState, Media, Segments } from "./UI.jsx";
import { ComparePlayerButton } from "./ResearchUI.jsx";
import { ResearchTrend } from "./ResearchCharts.jsx";

function SeasonTeams({ season, compact = false }) {
  const catalog = new Map(
    (season.data?.teams || []).map((team) => [team.id, team]),
  );
  const teams = (season.profile.teamIds || []).map(
    (id, index) =>
      catalog.get(id) || { id, name: season.profile.teams[index] || "Équipe" },
  );
  if (!teams.length)
    return <span>{season.profile.teams.join(" · ") || "—"}</span>;
  return (
    <span className={`player-evolution-teams${compact ? " is-compact" : ""}`}>
      {teams.map((team) => (
        <span
          key={team.id || team.name}
          title={team.name}
          className="player-history-identity"
        >
          <Media
            name={team.name}
            url={team.imageUrl}
            className="player-history-crest"
          />
          {!compact && <span>{team.name}</span>}
        </span>
      ))}
    </span>
  );
}

export default function PlayerEvolution({ id, profile }) {
  const f = useFootball(),
    [metric, setMetric] = useState("rating"),
    [mode, setMode] = useState("per90"),
    [selectedSeason, setSelectedSeason] = useState("all");
  const history = useResource(
    `player-history:${id}:${f.manifest.scouting?.sourceDigest}`,
    () => loadPlayerHistory(f.manifest, id),
  );
  const valueFor = (seasonProfile) =>
    metric === "minutes"
      ? observedMinutes(seasonProfile)
      : profileValue(seasonProfile, metric, mode);
  const recent = useMemo(() => {
    const matches = new Map(
      (f.data.matches || []).map((match) => [match.id, match]),
    );
    return profile.rows.slice(0, 5).map((row) => {
      const match = matches.get(row.matchId);
      const opponent =
        match?.home?.id === row.teamId
          ? match.away
          : match?.away?.id === row.teamId
            ? match.home
            : null;
      return { row, opponent };
    });
  }, [f.data.matches, profile.rows]);
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
            <option value="rating">Note</option>
            <option value="minutes">Minutes jouées</option>
            {Object.entries(SCOUT_METRICS).map(([key, d]) => (
              <option key={key} value={key}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        {!["rating", "minutes"].includes(metric) && (
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
        )}
      </div>
      <AsyncState resource={history}>
        {(seasons) => (
          <>
            <div className="player-evolution-visual">
              <div className="player-evolution-plot">
                <ResearchTrend
                  label={`${metric === "rating" ? "Note" : metric === "minutes" ? "Minutes jouées" : SCOUT_METRICS[metric].label} · saisons collectées`}
                  bounds={metric === "rating" ? [0, 10] : undefined}
                  decimals={metric === "minutes" ? 0 : 2}
                  points={seasonTrendPoints(seasons, valueFor)}
                />
                <p>
                  Les saisons sans données interrompent la courbe.
                  <span className="player-evolution-scroll-hint">
                    {" "}
                    Faites défiler le graphique pour voir toutes les saisons.
                  </span>
                </p>
              </div>
              <div
                className="player-evolution-seasons"
                aria-label="Choisir une saison"
              >
                {[...seasons].reverse().map((s) => (
                  <button
                    type="button"
                    key={s.season}
                    className="player-evolution-season"
                    aria-pressed={selectedSeason === s.season}
                    aria-label={`Filtrer la saison ${s.season}, ${s.profile.teams.join(", ")}, valeur ${number(valueFor(s.profile), metric === "minutes" ? 0 : 2)}`}
                    onClick={() =>
                      setSelectedSeason(
                        selectedSeason === s.season ? "all" : s.season,
                      )
                    }
                  >
                    <span>{s.season}</span>
                    <SeasonTeams season={s} compact />
                    <strong>
                      {number(
                        valueFor(s.profile),
                        metric === "minutes" ? 0 : 2,
                      )}
                    </strong>
                    <small>{number(s.profile.matches)} matchs</small>
                  </button>
                ))}
              </div>
            </div>
            <div className="season-section-heading player-evolution-table-heading">
              <h3>Par saison</h3>
              {selectedSeason !== "all" && (
                <button
                  type="button"
                  className="inline-link"
                  onClick={() => setSelectedSeason("all")}
                >
                  Toutes les saisons
                </button>
              )}
            </div>
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
                  {seasons
                    .filter(
                      (s) =>
                        selectedSeason === "all" || s.season === selectedSeason,
                    )
                    .map((s) => (
                      <tr key={s.season}>
                        <th>{s.season}</th>
                        <td>
                          <SeasonTeams season={s} />
                        </td>
                        <td>
                          {s.profile.matches ? number(s.profile.matches) : "—"}
                        </td>
                        <td>{number(observedMinutes(s.profile))}</td>
                        <td>
                          {number(
                            valueFor(s.profile),
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
          <div className="player-recent-form">
            <ResearchTrend
              label="Notes des dix derniers matchs"
              bounds={[0, 10]}
              points={profile.rows
                .slice(0, 10)
                .reverse()
                .map((row) => ({
                  label: row.date
                    ? row.date.slice(5).split("-").reverse().join("/")
                    : "Match",
                  value: row.rating,
                }))}
            />
            <div className="player-recent-form-list">
              {recent.map(({ row, opponent }) => (
                <Link
                  key={row.id}
                  href={f.href("/matchs/", {
                    id: row.matchId,
                    competition: row.leagueId,
                    sourceSeason: f.season,
                  })}
                >
                  {opponent && (
                    <Media
                      name={opponent.name}
                      url={opponent.imageUrl}
                      className="player-history-crest"
                    />
                  )}
                  <span>
                    <strong>
                      {opponent
                        ? `Contre ${opponent.name}`
                        : row.league || "Match"}
                    </strong>
                    <small>{date(row.date)}</small>
                  </span>
                  <b>{number(row.rating, 2)}</b>
                </Link>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
}
