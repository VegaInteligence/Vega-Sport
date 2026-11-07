"use client";
import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useFootball } from "../hooks/FootballContext.jsx";
import { useResource } from "../services/resources.js";
import {
  loadPlayerHistory,
  playerHistoryKey,
} from "../services/scouting-history.js";
import { nationalTeamName } from "../services/national-flags.js";
import { playerTeamSeasons } from "../services/player-team-seasons.js";
import { profileValue, SCOUT_METRICS } from "../services/scouting.js";
import { seasonMetric } from "../services/season-player.js";
import { date, number } from "../services/format.js";
import { observedMinutes } from "../services/trend-chart.js";
import { seasonTrendPoints } from "../services/player-season-history.js";
import { AsyncState, Empty, Media, Rating, Segments } from "./UI.jsx";
import NationalFlag from "./NationalFlag.jsx";
import PlayerSeasonTrend from "./PlayerSeasonTrend.jsx";
import { ResearchTrend } from "./ResearchCharts.jsx";

const STAT_LABELS = {
  matches: "Matchs",
  goals: "Buts",
  assists: "Passes décisives",
  minutes: "Minutes",
  rating: "Note moyenne",
};

function teamDisplayName({ team, kind, season }) {
  return kind === "selection" ? nationalTeamName(team, season) : team;
}

function SeasonTeam({ row }) {
  const { kind, season, team, teamInfo } = row;
  return (
    <span className="player-history-identity">
      {kind === "selection" ? (
        <NationalFlag
          name={team}
          season={season}
          className="player-evolution-flag"
        />
      ) : (
        <Media
          name={team}
          url={teamInfo?.imageUrl}
          className="player-history-crest"
        />
      )}
      <span className="player-evolution-team-name">
        <strong>{team}</strong>
        {kind !== "unknown" && (
          <small>{kind === "selection" ? "Sélection" : "Club"}</small>
        )}
      </span>
    </span>
  );
}

function ObservedTotal({ statistic, matches }) {
  const partial = statistic.count > 0 && statistic.count < matches;
  return (
    <>
      {number(statistic.value)}
      {partial && <sup className="player-history-partial">*</sup>}
    </>
  );
}

function StatCell({ stat, children }) {
  return (
    <td role="cell" className="player-evolution-stat">
      <span className="player-evolution-stat-label" aria-hidden="true">
        {STAT_LABELS[stat]}
      </span>
      <span className="player-evolution-stat-value">{children}</span>
    </td>
  );
}

export default function PlayerEvolution({ id, profile }) {
  const f = useFootball(),
    [metric, setMetric] = useState("rating"),
    [mode, setMode] = useState("per90"),
    [selectedSeason, setSelectedSeason] = useState("all");
  const history = useResource(playerHistoryKey(f.manifest, id), ({ signal }) =>
    loadPlayerHistory(f.manifest, id, { signal }),
  );
  const teamSeasons = useMemo(
    () =>
      playerTeamSeasons(history.value ?? []).map((row) => ({
        ...row,
        team: teamDisplayName(row),
        goals: seasonMetric(row.profile, "goals"),
        assists: seasonMetric(row.profile, "assists"),
      })),
    [history.value],
  );
  const ratings = useMemo(
    () =>
      teamSeasons.map(({ season, teamKey, team, kind, profile }) => ({
        season,
        teamKey,
        team,
        kind,
        value: profile.rating,
      })),
    [teamSeasons],
  );
  const seasonsForTable = [...new Set(teamSeasons.map(({ season }) => season))];
  const activeSeason = seasonsForTable.includes(selectedSeason)
    ? selectedSeason
    : "all";
  const visibleRows =
    activeSeason === "all"
      ? teamSeasons
      : teamSeasons.filter(({ season }) => season === activeSeason);
  const hasPartialTotals = visibleRows.some(({ profile, goals, assists }) =>
    [goals, assists].some(({ count }) => count > 0 && count < profile.matches),
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
            {metric === "rating" ? (
              <PlayerSeasonTrend points={ratings} />
            ) : (
              <div className="player-evolution-plot">
                <ResearchTrend
                  label={`${metric === "minutes" ? "Minutes jouées" : SCOUT_METRICS[metric].label} · toutes les équipes`}
                  decimals={metric === "minutes" ? 0 : 2}
                  points={seasonTrendPoints(seasons, valueFor)}
                />
              </div>
            )}
            <div className="season-section-heading player-evolution-table-heading">
              <h3 id="player-evolution-table-title">
                Par saison et par équipe
              </h3>
              {seasonsForTable.length > 1 && (
                <div className="research-toolbar">
                  <label>
                    Saison du tableau
                    <select
                      value={activeSeason}
                      onChange={(e) => setSelectedSeason(e.target.value)}
                    >
                      <option value="all">Toutes les saisons</option>
                      {seasonsForTable.map((season) => (
                        <option key={season} value={season}>
                          {season}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
            </div>
            {visibleRows.length ? (
              <>
                <p className="player-history-footnote">
                  Statistiques des matchs collectés.
                </p>
                <div className="table-scroll player-season-history-table player-evolution-table-wrap">
                  <table
                    className="data-table player-evolution-table"
                    role="table"
                    aria-labelledby="player-evolution-table-title"
                  >
                    <thead role="rowgroup">
                      <tr role="row">
                        <th scope="col" role="columnheader">
                          Saison
                        </th>
                        <th scope="col" role="columnheader">
                          Équipe
                        </th>
                        {Object.entries(STAT_LABELS).map(([stat, label]) => (
                          <th key={stat} scope="col" role="columnheader">
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody role="rowgroup">
                      {visibleRows.map((row) => (
                        <tr key={row.key} role="row">
                          <td
                            role="cell"
                            className="player-evolution-season-cell"
                          >
                            {row.season}
                          </td>
                          <th
                            scope="row"
                            role="rowheader"
                            className="player-evolution-team-cell"
                          >
                            <SeasonTeam row={row} />
                          </th>
                          <StatCell stat="matches">
                            {number(row.profile.matches)}
                          </StatCell>
                          <StatCell stat="goals">
                            <ObservedTotal
                              statistic={row.goals}
                              matches={row.profile.matches}
                            />
                          </StatCell>
                          <StatCell stat="assists">
                            <ObservedTotal
                              statistic={row.assists}
                              matches={row.profile.matches}
                            />
                          </StatCell>
                          <StatCell stat="minutes">
                            {number(row.profile.minutes)}
                          </StatCell>
                          <StatCell stat="rating">
                            {row.profile.rating == null ? (
                              "—"
                            ) : (
                              <Rating value={row.profile.rating} />
                            )}
                          </StatCell>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {hasPartialTotals && (
                  <p className="player-history-footnote">
                    * Total des matchs où la statistique est renseignée.
                  </p>
                )}
              </>
            ) : (
              <Empty>
                Aucune apparition collectée par équipe pour ce joueur.
              </Empty>
            )}
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
                    <strong>{opponent?.name || row.league || "Match"}</strong>
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
