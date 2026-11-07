"use client";
import React, { useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useFootball } from "../hooks/FootballContext.jsx";
import { useResource } from "../services/resources.js";
import { loadPlayerHistory } from "../services/scouting-history.js";
import { playerSeasonGroups } from "../services/player-season-history.js";
import { seasonMetric } from "../services/season-player.js";
import { number } from "../services/format.js";
import { nationalTeamName } from "../services/national-flags.js";
import { isNationalTeamCompetition } from "../services/player-team-seasons.js";
import { AsyncState, Media } from "./UI.jsx";
import NationalFlag from "./NationalFlag.jsx";

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

function ProfileCells({ profile, matchLabel, matchHref }) {
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
          <Link
            className="player-season-match-count"
            aria-label={matchLabel}
            href={matchHref}
            prefetch={false}
          >
            {played}
          </Link>
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

function SeasonTable({ groups, id, params, caption }) {
  const sources = new Map();
  for (const { season, competitions } of groups)
    for (const { competition } of competitions)
      if (competition.sourceUrl)
        sources.set(
          competition.sourceUrl,
          `${competition.sourceLabel} · ${competition.name} · ${season}`,
        );
  return (
    <>
      <div className="table-scroll player-season-history-table">
        <table className="data-table player-season-group-table">
          <caption className="sr-only">{caption}</caption>
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
            const matchProps = (selected, label, competitionKey) => {
              const query = new URLSearchParams(params.toString());
              query.delete("playerView");
              query.set("id", id);
              query.set("matchGroup", key);
              query.delete("matchCompetition");
              if (competitionKey !== undefined)
                query.set("matchCompetition", JSON.stringify(competitionKey));
              return {
                profile: selected,
                matchLabel: `Voir les ${number(selected.matches)} matchs de ${label} (${season})`,
                matchHref: `/joueurs/matchs/?${query}`,
              };
            };
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
                      {national ? (
                        <NationalFlag name={team.name} season={season} />
                      ) : team.imageUrl ? (
                        <Media
                          name={name}
                          url={team.imageUrl}
                          className="player-history-crest"
                        />
                      ) : null}
                      <strong>{name}</strong>
                    </span>
                  </th>
                  <th scope="row">Total équipe</th>
                  <ProfileCells {...matchProps(profile, name)} />
                </tr>
                {competitions.map(({ key, competition, profile }) => (
                  <tr key={key} className="player-season-competition">
                    <th scope="row">{competition.name}</th>
                    <ProfileCells
                      {...matchProps(
                        profile,
                        `${name} · ${competition.name}`,
                        key,
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
    </>
  );
}

function SeasonRows({ seasons, id }) {
  const params = useSearchParams();
  const groups = useMemo(() => playerSeasonGroups(seasons, id), [seasons, id]);
  if (!groups.length)
    return (
      <p className="club-note">Aucune saison disponible pour ce joueur.</p>
    );

  const latest = groups[0].season;
  const latestGroups = groups.filter(({ season }) => season === latest);
  const earlierGroups = groups.filter(({ season }) => season !== latest);
  return (
    <>
      <SeasonTable
        groups={latestGroups}
        id={id}
        params={params}
        caption={`Totaux par équipe et détail par compétition · ${latest}`}
      />
      {earlierGroups.length > 0 && (
        <details className="player-season-history-more">
          <summary aria-label="Voir les statistiques détaillées des saisons précédentes">
            Voir les statistiques détaillées
          </summary>
          <SeasonTable
            groups={earlierGroups}
            id={id}
            params={params}
            caption="Totaux par équipe et détail par compétition des saisons précédentes"
          />
        </details>
      )}
    </>
  );
}

export default function PlayerSeasonStats({ id }) {
  const f = useFootball();
  const history = useResource(
    `player-history:${id}:${f.manifest.scouting?.sourceDigest}`,
    ({ signal }) => loadPlayerHistory(f.manifest, id, { signal }),
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
