"use client";
import React, { useMemo } from "react";
import { useFootball } from "../hooks/FootballContext.jsx";
import { useResource } from "../services/resources.js";
import { loadPlayerHistory } from "../services/scouting-history.js";
import { playerSeasonRows } from "../services/player-season-history.js";
import { seasonMetric } from "../services/season-player.js";
import { number } from "../services/format.js";
import { AsyncState, Media } from "./UI.jsx";

function MetricValue({ profile, metric, decimals = 0 }) {
  const value = seasonMetric(profile, metric);
  return (
    <>
      {number(value.value, decimals)}
      {value.count > 0 && value.count < profile.matches && (
        <span
          className="player-history-partial"
          title={`${value.count} matchs renseignés sur ${profile.matches}`}
        >
          *
        </span>
      )}
    </>
  );
}

function SeasonRows({ seasons, id }) {
  const rows = useMemo(() => playerSeasonRows(seasons, id), [seasons, id]);
  if (!rows.length)
    return (
      <p className="club-note">Aucune saison disponible pour ce joueur.</p>
    );
  return (
    <div className="table-scroll player-season-history-table">
      <table className="data-table">
        <thead>
          <tr>
            <th>Saison</th>
            <th>Équipe</th>
            <th>Compétition</th>
            <th>MJ</th>
            <th>Min</th>
            <th>Buts</th>
            <th>Passes</th>
            <th>xG</th>
            <th>Note</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ season, team, competition, profile }) => (
            <tr
              key={JSON.stringify([
                season,
                team.id || team.name,
                competition.id || competition.name,
              ])}
            >
              <th scope="row">{season}</th>
              <td>
                <span className="player-history-identity">
                  <Media
                    name={team.name}
                    url={team.imageUrl}
                    className="player-history-crest"
                  />
                  <strong>{team.name}</strong>
                </span>
              </td>
              <td>
                <span className="player-history-identity">
                  <Media
                    name={competition.name}
                    url={competition.imageUrl}
                    className="player-history-crest player-history-competition"
                  />
                  <span>{competition.name}</span>
                </span>
              </td>
              <td>{number(profile.matches)}</td>
              <td>{number(profile.minutes)}</td>
              <td>
                <MetricValue profile={profile} metric="goals" />
              </td>
              <td>
                <MetricValue profile={profile} metric="assists" />
              </td>
              <td>
                <MetricValue profile={profile} metric="xg" decimals={2} />
              </td>
              <td>
                {number(profile.rating, 2)}
                {profile.ratingCount > 0 &&
                  profile.ratingCount < profile.matches && (
                    <span
                      className="player-history-partial"
                      title={`${profile.ratingCount} matchs renseignés sur ${profile.matches}`}
                    >
                      *
                    </span>
                  )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.some(
        ({ profile }) =>
          (profile.ratingCount > 0 && profile.ratingCount < profile.matches) ||
          ["goals", "assists", "xg"].some((metric) => {
            const { count } = seasonMetric(profile, metric);
            return count > 0 && count < profile.matches;
          }),
      ) && (
        <p className="player-history-footnote">
          * Valeur partielle selon les matchs renseignés.
        </p>
      )}
    </div>
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
        <span>Une ligne par équipe et compétition</span>
      </div>
      <AsyncState resource={history}>
        {(seasons) => <SeasonRows seasons={seasons} id={id} />}
      </AsyncState>
    </section>
  );
}
