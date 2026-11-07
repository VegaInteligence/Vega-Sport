"use client";
import React, { useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useFootball } from "../hooks/FootballContext.jsx";
import { cachedResource, useResource } from "../services/resources.js";
import {
  loadPlayerHistory,
  playerHistoryKey,
  playerHistorySeasons,
  playerRoutes,
} from "../services/scouting-history.js";
import { loadDisciplineByMatch } from "../services/player-discipline.js";
import { playerSeasonGroups } from "../services/player-season-history.js";
import { seasonMetric } from "../services/season-player.js";
import { currentPlayerSeason } from "../services/actor-reads.js";
import { number } from "../services/format.js";
import { nationalTeamName } from "../services/national-flags.js";
import { isNationalTeamCompetition } from "../services/player-team-seasons.js";
import { AsyncState, Media } from "./UI.jsx";
import NationalFlag from "./NationalFlag.jsx";
import ObservedValue from "./PlayerObservedValue.jsx";
import PlayerCompetitionMatches, {
  CardHeading,
  DISCIPLINE_COLUMNS,
} from "./PlayerCompetitionMatches.jsx";

const METRICS = [
  ["goals", 0],
  ["assists", 0],
  ["xg", 2],
];

function ProfileCells({
  profile,
  matchLabel,
  matchHref,
  linkMatches,
  discipline,
}) {
  const total = profile.matches + profile.unknownMinutes;
  const cards = discipline
    ? profile.rows.flatMap(({ matchId }) =>
        discipline.has(matchId) ? [discipline.get(matchId)] : [],
      )
    : [];
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
        {profile.matches && linkMatches ? (
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
      {discipline &&
        DISCIPLINE_COLUMNS.map(([key]) => (
          <td key={key}>
            <ObservedValue
              value={
                cards.length
                  ? cards.reduce((sum, match) => sum + match[key], 0)
                  : null
              }
              count={cards.length}
              total={total}
            />
          </td>
        ))}
    </>
  );
}

function hasCoverageGaps(profile, discipline) {
  return (
    profile.unknownMinutes > 0 ||
    profile.ratingCount < profile.matches ||
    (discipline &&
      profile.rows.some(({ matchId }) => !discipline.has(matchId))) ||
    METRICS.some(([metric]) => {
      const { count } = seasonMetric(profile, metric);
      return count < profile.matches;
    })
  );
}

function SeasonTable({ groups, id, caption, linkMatches = false, discipline }) {
  const params = useSearchParams();
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
              {discipline &&
                DISCIPLINE_COLUMNS.map(([key, color, label]) => (
                  <th key={key} scope="col">
                    <CardHeading color={color} text={label} />
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
              if (!linkMatches) return { profile: selected, discipline };
              const query = new URLSearchParams(params.toString());
              query.delete("playerView");
              query.set("id", id);
              query.set("performanceSeason", season);
              query.set("matchGroup", key);
              query.delete("matchCompetition");
              if (competitionKey !== undefined)
                query.set("matchCompetition", JSON.stringify(competitionKey));
              return {
                profile: selected,
                linkMatches,
                discipline,
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
          hasCoverageGaps(profile, discipline) ||
          competitions.some(({ profile }) =>
            hasCoverageGaps(profile, discipline),
          ),
      ) && (
        <p className="player-history-footnote">
          — Donnée indisponible. * Valeur partielle.
        </p>
      )}
    </>
  );
}

export default function PlayerSeasonStats({ id, season }) {
  const f = useFootball();
  const history = useResource(
    playerHistoryKey(f.manifest, id, season),
    ({ signal }) =>
      loadPlayerHistory(f.manifest, id, {
        signal,
        season,
        cachedSeason: (value) => currentPlayerSeason(f, id, value),
      }),
    Boolean(f.manifest && id && season),
  );
  const groups = useMemo(
    () => playerSeasonGroups(history.value || [], id),
    [history.value, id],
  );
  return (
    <section className="player-season-history">
      <div className="season-section-heading">
        <h3>Saison {season}</h3>
      </div>
      <AsyncState resource={history}>
        {() =>
          groups.length ? (
            <SeasonTable
              groups={groups}
              id={id}
              caption={`Totaux par équipe et détail par compétition · ${season}`}
            />
          ) : (
            <p className="club-note">
              Aucune statistique disponible pour cette saison.
            </p>
          )
        }
      </AsyncState>
    </section>
  );
}

const NO_DISCIPLINE = new Map();

function PerformanceRows({ id, history, season, hasSeasons, children }) {
  const f = useFootball();
  const entries = history.value;
  const groups = useMemo(
    () => playerSeasonGroups(entries || [], id),
    [entries, id],
  );
  const matches = entries?.[0]?.data?.matches || [];
  const played = useMemo(() => {
    const ids = new Set(
      groups.flatMap(({ profile }) => profile.rows.map((row) => row.matchId)),
    );
    return matches.filter(
      (match) => ids.has(match.id) && /^m_[A-Za-z0-9]{6}$/.test(match.id),
    );
  }, [groups, matches]);
  const discipline = useResource(
    `${playerHistoryKey(f.manifest, id, season)}:cards:${played
      .map(({ id }) => id)
      .sort()
      .join(",")}`,
    ({ signal }) => loadDisciplineByMatch(f.client, played, id, { signal }),
    Boolean(f.client && f.statusKnown && played.length),
  );
  return (
    <>
      {season ? (
        <AsyncState resource={history}>
          {() =>
            groups.length ? (
              <SeasonTable
                groups={groups}
                id={id}
                caption={`Totaux par équipe et détail par compétition · ${season}`}
                discipline={discipline.value || NO_DISCIPLINE}
                linkMatches
              />
            ) : (
              <p className="club-note">
                Aucune statistique disponible pour cette saison.
              </p>
            )
          }
        </AsyncState>
      ) : (
        <p className="club-note">
          {hasSeasons
            ? "Cette saison est indisponible pour ce joueur."
            : "Aucune saison disponible pour ce joueur."}
        </p>
      )}
      {groups.length > 0 && (
        <>
          <PlayerCompetitionMatches
            groups={groups}
            matches={matches}
            disciplineByMatch={discipline.value}
          />
          {children}
        </>
      )}
    </>
  );
}

export function PlayerPerformanceStats({ id, children }) {
  const f = useFootball();
  const params = useSearchParams();
  const routing = useResource(
    `${playerHistoryKey(f.manifest, id)}:routes`,
    async ({ signal }) => {
      const index = await playerRoutes(f.manifest, { players: [id] }, fetch, {
        signal,
      });
      return { index, seasons: playerHistorySeasons(index, id) };
    },
    Boolean(f.manifest && id),
  );
  const seasons = routing.value?.seasons || [];
  const requested = params.get("performanceSeason");
  const preferred =
    requested ??
    (seasons.includes(f.season) || !routing.value ? f.season : seasons[0]);
  const season =
    seasons.includes(preferred) ||
    (!routing.value &&
      f.manifest?.seasons?.some((item) => item.id === preferred))
      ? preferred
      : "";
  const history = useResource(
    playerHistoryKey(f.manifest, id, season),
    ({ signal }) =>
      loadPlayerHistory(f.manifest, id, {
        signal,
        season,
        routing: routing.value?.index,
        cachedSeason: (value) =>
          currentPlayerSeason(f, id, value) ||
          cachedResource(playerHistoryKey(f.manifest, id))?.find(
            (entry) => entry.season === value,
          ),
      }),
    Boolean(season),
  );
  const selectSeason = (event) => {
    const url = new URL(window.location.href);
    url.searchParams.set("performanceSeason", event.target.value);
    window.history.replaceState(null, "", url);
  };
  return (
    <section
      className="player-season-history"
      aria-label="Statistiques par saison"
    >
      <div className="season-section-heading">
        <h3>Statistiques par saison</h3>
        {seasons.length > 0 && (
          <label className="player-performance-season">
            Saison
            <select value={season} onChange={selectSeason}>
              {!season && (
                <option value="" disabled>
                  Saison indisponible
                </option>
              )}
              {seasons.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {routing.error && (
        <p role="alert">
          {routing.error} <button onClick={routing.retry}>Réessayer</button>
        </p>
      )}
      <PerformanceRows
        id={id}
        history={history}
        season={season}
        hasSeasons={seasons.length > 0}
      >
        {season === f.season && children}
      </PerformanceRows>
    </section>
  );
}
