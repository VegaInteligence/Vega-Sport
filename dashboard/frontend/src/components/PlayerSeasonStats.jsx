"use client";
import React, { useMemo, useState } from "react";
import { useFootball } from "../hooks/FootballContext.jsx";
import { useResource } from "../services/resources.js";
import { loadPlayerHistory } from "../services/scouting-history.js";
import { playerSeasonGroups } from "../services/player-season-history.js";
import { seasonMetric } from "../services/season-player.js";
import { number } from "../services/format.js";
import { nationalTeamName } from "../services/national-flags.js";
import { isNationalTeamCompetition } from "../services/player-team-seasons.js";
import { AsyncState, Modal } from "./UI.jsx";
import NationalFlag from "./NationalFlag.jsx";
import PlayerFixture from "./PlayerFixture.jsx";

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

function ProfileCells({ profile, matchLabel, onMatches }) {
  const total = profile.matches + profile.unknownMinutes;
  const played = (
    <ObservedValue
      value={profile.matches || null}
      count={profile.matches}
      total={total}
    />
  );
  return (
    <>
      <td>
        {profile.matches ? (
          <button
            type="button"
            className="player-season-match-count"
            aria-label={matchLabel}
            onClick={onMatches}
          >
            {played}
          </button>
        ) : (
          played
        )}
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
  const [matchList, setMatchList] = useState(null);
  if (!groups.length)
    return (
      <p className="club-note">Aucune saison disponible pour ce joueur.</p>
    );
  const sources = new Map();
  for (const { season, competitions } of groups)
    for (const { competition } of competitions)
      if (competition.sourceUrl)
        sources.set(
          competition.sourceUrl,
          `${competition.sourceLabel} · ${competition.name} · ${season}`,
        );
  const matchProps = (profile, season, label) => ({
    profile,
    matchLabel: `Voir les ${number(profile.matches)} matchs de ${label} (${season})`,
    onMatches: () =>
      setMatchList({
        label: `${number(profile.matches)} matchs · ${label} · ${season}`,
        rows: profile.rows,
        matches: new Map(
          (
            seasons.find((entry) => entry.season === season)?.data?.matches ||
            []
          ).map((match) => [match.id, match]),
        ),
      }),
  });
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
                "Passes déc.",
                "xG",
                "Note",
              ].map((column) => (
                <th key={column} scope="col">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          {groups.map(({ key, season, team, profile, competitions }) => {
            const national = competitions.some(({ competition }) =>
              isNationalTeamCompetition(competition.id),
            );
            const name = national
              ? nationalTeamName(team.name, season)
              : team.name;
            return (
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
                      {national && (
                        <NationalFlag name={team.name} season={season} />
                      )}
                      <strong>{name}</strong>
                    </span>
                  </th>
                  <th scope="row">Total équipe</th>
                  <ProfileCells {...matchProps(profile, season, name)} />
                </tr>
                {competitions.map(({ key, competition, profile }) => (
                  <tr key={key} className="player-season-competition">
                    <th scope="row">{competition.name}</th>
                    <ProfileCells
                      {...matchProps(
                        profile,
                        season,
                        `${name} · ${competition.name}`,
                      )}
                    />
                  </tr>
                ))}
              </tbody>
            );
          })}
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
      {sources.size > 0 && (
        <details className="player-profile-source">
          <summary>Sources des statistiques</summary>
          <ul>
            {[...sources].map(([url, label]) => (
              <li key={url}>
                <a href={url} target="_blank" rel="noreferrer">
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}
      {matchList && (
        <Modal title={matchList.label} onClose={() => setMatchList(null)}>
          <ul className="player-fixture-list">
            {matchList.rows.map((row) => (
              <li key={row.matchId}>
                <PlayerFixture
                  row={row}
                  match={matchList.matches.get(row.matchId)}
                />
                <span>{number(row.minutes)} min</span>
              </li>
            ))}
          </ul>
        </Modal>
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
        {(seasons) => <SeasonRows key={id} seasons={seasons} id={id} />}
      </AsyncState>
    </section>
  );
}
