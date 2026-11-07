"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { playerCompetitionHref } from "../services/player-competition-navigation.js";
import { useFootball } from "../hooks/FootballContext.jsx";
import useVisibleIntent from "../hooks/useVisibleIntent.js";
import { currentPlayerSeason } from "../services/actor-reads.js";
import { date, number } from "../services/format.js";
import {
  nationalFlagCode,
  nationalTeamName,
} from "../services/national-flags.js";
import { playerCareerGroups } from "../services/player-career.js";
import { playerPositionSummary } from "../services/player-position-summary.js";
import { internationalCareerDetails } from "../services/player-international-career.js";
import {
  cachedResource,
  primeResource,
  useResource,
} from "../services/resources.js";
import {
  loadPlayerHistory,
  playerHistoryKey,
} from "../services/scouting-history.js";
import { seasonMetric } from "../services/season-player.js";
import NationalFlag from "./NationalFlag.jsx";
import ObservedValue from "./PlayerObservedValue.jsx";
import PlayerPositionPitch from "./PlayerPositionPitch.jsx";
import { AsyncState, Media } from "./UI.jsx";

const TABLES = [
  ["clubs", "Performance par club", "Club", "Aucun match en club recensé."],
  [
    "competitions",
    "Performance par compétition",
    "Compétition",
    "Aucune compétition recensée.",
  ],
  [
    "selections",
    "Carrière en sélection",
    "Sélection",
    "Aucun match en sélection recensé.",
  ],
];

function CareerTable({
  group,
  title,
  entity,
  empty,
  entries,
  matchHref,
  competitionHref,
}) {
  const international = group === "selections";
  return (
    <section className="player-career-panel">
      <h4>{title}</h4>
      {entries.length ? (
        <div
          className={`table-scroll player-career-table${international ? " player-career-selections" : ""}`}
        >
          <table className="data-table" aria-label={title}>
            <thead>
              <tr>
                <th scope="col">{entity}</th>
                <th
                  scope="col"
                  className="player-career-stat"
                  title="Matchs joués"
                >
                  MJ
                </th>
                <th scope="col" className="player-career-stat">
                  Buts
                </th>
                <th scope="col" className="player-career-stat">
                  {international ? "1er match recensé" : "Passes déc."}
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const { key, name, imageUrl, profile, seasons } = entry;
                const total = profile.matches + profile.unknownMinutes;
                const display = international
                  ? nationalTeamName(name, seasons[0])
                  : name;
                const detail = international
                  ? internationalCareerDetails(profile.rows)
                  : null;
                const goals = seasonMetric(profile, "goals");
                const assists = seasonMetric(profile, "assists");
                const matches = (
                  <ObservedValue
                    value={profile.matches || null}
                    count={profile.matches}
                    total={total}
                  />
                );
                return (
                  <tr key={key}>
                    <th scope="row">
                      <span className="player-history-identity player-career-identity">
                        {international && nationalFlagCode(name, seasons[0]) ? (
                          <NationalFlag name={name} season={seasons[0]} />
                        ) : imageUrl ? (
                          <Media
                            name={name}
                            url={imageUrl}
                            className="player-history-crest"
                          />
                        ) : null}
                        {group === "competitions" ? (
                          <Link
                            className="player-competition-link"
                            href={competitionHref(key)}
                            prefetch={false}
                          >
                            {display}
                          </Link>
                        ) : (
                          <span>{display}</span>
                        )}
                      </span>
                      {detail && (
                        <span
                          className="player-career-shirt-numbers"
                          title={
                            detail.numberedMatches
                              ? `Numéro renseigné sur ${detail.numberedMatches} des ${profile.matches} matchs joués`
                              : undefined
                          }
                        >
                          N° portés{" "}
                          {detail.shirtNumbers.length
                            ? detail.shirtNumbers.join(", ")
                            : "—"}
                          {detail.numberedMatches > 0 &&
                            detail.numberedMatches < profile.matches && (
                              <span className="player-history-partial">*</span>
                            )}
                        </span>
                      )}
                    </th>
                    <td className="player-career-stat">
                      {profile.matches ? (
                        <Link
                          className="player-season-match-count"
                          aria-label={`Voir les ${number(profile.matches)} matchs recensés pour ${display}`}
                          href={matchHref(group, key)}
                          prefetch={false}
                        >
                          {matches}
                        </Link>
                      ) : (
                        matches
                      )}
                    </td>
                    <td className="player-career-stat">
                      <ObservedValue {...goals} total={total} />
                    </td>
                    {detail ? (
                      <td className="player-career-stat player-career-date">
                        {date(detail.firstMatchDate)}
                      </td>
                    ) : (
                      <td className="player-career-stat">
                        <ObservedValue {...assists} total={total} />
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="club-note">{empty}</p>
      )}
    </section>
  );
}

export default function PlayerCareerStats({
  id,
  routing,
  season,
  overview = false,
}) {
  const f = useFootball();
  const params = useSearchParams();
  const [sectionRef, visible] = useVisibleIntent(
    playerHistoryKey(f.manifest, id),
  );
  const history = useResource(
    playerHistoryKey(f.manifest, id),
    async ({ signal }) => {
      const cachedSeason = (value) =>
        cachedResource(playerHistoryKey(f.manifest, id, value))?.[0] ||
        currentPlayerSeason(f, id, value);
      if (overview && season) {
        // Reuse the selected-season table before loading the remaining career.
        await primeResource(
          playerHistoryKey(f.manifest, id, season),
          ({ signal: seasonSignal }) =>
            loadPlayerHistory(f.manifest, id, {
              signal: seasonSignal,
              season,
              routing,
              cachedSeason,
            }),
        );
        signal?.throwIfAborted();
      }
      return loadPlayerHistory(f.manifest, id, {
        signal,
        routing,
        cachedSeason,
      });
    },
    visible,
  );
  const groups = useMemo(
    () => playerCareerGroups(history.value || [], id),
    [history.value, id],
  );
  const positions = useMemo(
    () => (overview ? playerPositionSummary(history.value || [], id) : []),
    [overview, history.value, id],
  );
  const matchHref = (group, key) => {
    const query = new URLSearchParams(params.toString());
    if (overview) query.set("playerView", "overview");
    else query.delete("playerView");
    query.delete("matchGroup");
    query.delete("matchCompetition");
    query.set("id", id);
    query.set("careerGroup", group);
    query.set("careerKey", key);
    if (season) query.set("performanceSeason", season);
    return `/joueurs/matchs/?${query}`;
  };
  return (
    <section
      className="player-career"
      aria-label="Bilan de carrière"
      ref={sectionRef}
    >
      <div className="player-career-heading">
        <h3>Bilan de carrière</h3>
        <p>Toutes les saisons collectées</p>
      </div>
      <AsyncState resource={history}>
        {() => (
          <>
            <div
              className={`player-career-grid${overview ? " player-career-overview-grid" : ""}`}
            >
              {TABLES.map(([group, title, entity, empty]) => (
                <CareerTable
                  key={group}
                  group={group}
                  title={title}
                  entity={entity}
                  empty={empty}
                  entries={groups[group]}
                  matchHref={matchHref}
                  competitionHref={(competitionId) =>
                    playerCompetitionHref(params, id, competitionId)
                  }
                />
              ))}
              {overview && <PlayerPositionPitch positions={positions} />}
            </div>
            <p className="player-history-footnote">
              — Donnée indisponible. * Valeur partielle.
              {groups.unknown.length > 0 &&
                " Certaines équipes ont un type non renseigné."}
            </p>
          </>
        )}
      </AsyncState>
    </section>
  );
}
