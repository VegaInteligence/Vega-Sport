"use client";
import React, { useMemo } from "react";
import { useFootball } from "../hooks/FootballContext.jsx";
import { useResource } from "../services/resources.js";
import { loadPlayerHistory } from "../services/scouting-history.js";
import { playerSeasonGroups } from "../services/player-season-history.js";
import { seasonMetric } from "../services/season-player.js";
import { date, number } from "../services/format.js";
import { AsyncState, Media } from "./UI.jsx";

const METRICS = [
  ["goals", 0],
  ["assists", 0],
  ["xg", 2],
];

function ObservedValue({ value, count, total, decimals = 0 }) {
  return (
    <>
      {number(value, decimals)}
      {count > 0 && count < total && (
        <span
          className="player-history-partial"
          title={`${count} matchs renseignés sur ${total}`}
        >
          *
        </span>
      )}
    </>
  );
}

function ProfileCells({ profile }) {
  const total = profile.matches + profile.unknownMinutes;
  return (
    <>
      <td>
        <ObservedValue
          value={profile.matches || null}
          count={profile.matches}
          total={total}
        />
      </td>
      <td>
        <ObservedValue
          value={profile.minutes || null}
          count={profile.matches}
          total={total}
        />
      </td>
      {METRICS.map(([metric, decimals]) => {
        const { value, count } = seasonMetric(profile, metric);
        return (
          <td key={metric}>
            <ObservedValue
              value={value}
              count={count}
              total={total}
              decimals={decimals}
            />
          </td>
        );
      })}
      <td>
        <ObservedValue
          value={profile.rating}
          count={profile.ratingCount}
          total={total}
          decimals={2}
        />
      </td>
    </>
  );
}

function hasCoverageGaps(profile) {
  return (
    profile.unknownMinutes > 0 ||
    profile.ratingCount < profile.matches ||
    METRICS.some(([metric]) => {
      const { count } = seasonMetric(profile, metric);
      return count < profile.matches;
    })
  );
}

function SeasonRows({ seasons, id }) {
  const groups = useMemo(() => playerSeasonGroups(seasons, id), [seasons, id]);
  if (!groups.length)
    return (
      <p className="club-note">Aucune saison disponible pour ce joueur.</p>
    );
  return (
    <>
      <div className="table-scroll player-season-history-table">
        <table className="data-table player-season-group-table">
          <caption className="sr-only">
            Totaux par équipe et détail par compétition
          </caption>
          <thead>
            <tr>
              {[
                "Saison",
                "Équipe",
                "Compétition",
                "MJ",
                "Min",
                "Buts",
                "Passes",
                "xG",
                "Note",
              ].map((column) => (
                <th key={column} scope="col">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          {groups.map(({ key, season, team, profile, competitions }) => (
            <tbody key={key}>
              <tr className="player-season-total">
                <th
                  scope="rowgroup"
                  rowSpan={competitions.length + 1}
                  className="player-season-group-heading"
                >
                  {season}
                </th>
                <th
                  scope="rowgroup"
                  rowSpan={competitions.length + 1}
                  className="player-season-group-heading"
                >
                  <span className="player-history-identity">
                    <Media
                      name={team.name}
                      url={team.imageUrl}
                      className="player-history-crest"
                    />
                    <strong>{team.name}</strong>
                  </span>
                </th>
                <th scope="row">Total équipe</th>
                <ProfileCells profile={profile} />
              </tr>
              {competitions.map(({ key, competition, profile }) => (
                <tr key={key} className="player-season-competition">
                  <th scope="row">
                    <span className="player-history-identity">
                      {competition.imageUrl && (
                        <Media
                          name={competition.name}
                          url={competition.imageUrl}
                          className="player-history-crest player-history-competition"
                        />
                      )}
                      {competition.name}
                    </span>
                    {competition.sourceUrl && (
                      <a
                        className="player-season-source"
                        href={competition.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {competition.sourceLabel}
                        {competition.snapshotAt
                          ? ` · ${date(competition.snapshotAt)}`
                          : ""}
                      </a>
                    )}
                  </th>
                  <ProfileCells profile={profile} />
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
      {groups.some(
        ({ profile, competitions }) =>
          hasCoverageGaps(profile) ||
          competitions.some(({ profile }) => hasCoverageGaps(profile)),
      ) && (
        <p className="player-history-footnote">
          — Donnée indisponible. * Valeur partielle.
        </p>
      )}
    </>
  );
}

export default function PlayerSeasonStats({ id }) {
  const f = useFootball();
  const history = useResource(
    `player-history:${id}:${f.manifest.scouting?.sourceDigest}`,
    () => loadPlayerHistory(f.manifest, id),
  );
  return (
    <section className="player-season-history">
      <div className="season-section-heading">
        <h3>Statistiques par saison</h3>
        <span>Totaux et détail par équipe</span>
      </div>
      <AsyncState resource={history}>
        {(seasons) => <SeasonRows seasons={seasons} id={id} />}
      </AsyncState>
    </section>
  );
}
