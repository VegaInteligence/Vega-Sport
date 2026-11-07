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
import {
  playerHistoryInPeriod,
  playerSeasonGroups,
} from "../services/player-season-history.js";
import PlayerProfileFilters from "./PlayerProfileFilters.jsx";
import { seasonMetric } from "../services/season-player.js";
import { currentPlayerSeason } from "../services/actor-reads.js";
import { loadPlayerCompetitionFixtures } from "../services/player-competition-fixtures.js";
import { playerCompetitionHistory } from "../services/player-competition-history.js";
import { playerCompetitionHref } from "../services/player-competition-navigation.js";
import { supportsCompactRead } from "../services/compact-reads.js";
import { UEFA_NATIONS_ID } from "../services/uefa-nations-snapshot.js";
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
  cardMatchIds = profile.rows.map((row) => row.matchId),
}) {
  const total = profile.matches + profile.unknownMinutes;
  const cards = discipline
    ? cardMatchIds.flatMap((matchId) =>
        discipline.has(matchId) ? [discipline.get(matchId)] : [],
      )
    : [];
  const played = (
    <ObservedValue
      value={profile.matches || (profile.unknownMinutes ? null : 0)}
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
          value={profile.minutes || (profile.unknownMinutes ? null : 0)}
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
              total={cardMatchIds.length}
            />
          </td>
        ))}
    </>
  );
}

function hasCoverageGaps(
  profile,
  discipline,
  cardMatchIds = profile.rows.map((row) => row.matchId),
) {
  return (
    profile.matches === 0 ||
    profile.unknownMinutes > 0 ||
    profile.ratingCount < profile.matches ||
    (discipline && cardMatchIds.some((matchId) => !discipline.has(matchId))) ||
    METRICS.some(([metric]) => {
      const { count } = seasonMetric(profile, metric);
      return count < profile.matches;
    })
  );
}

function SeasonTable({
  groups,
  id,
  caption,
  linkMatches = false,
  discipline,
  singleCompetition = false,
  totalProfile,
  totalCardMatchIds,
}) {
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
          {groups.map(
            ({ key, season, team, profile, competitions, cardMatchIds }) => {
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
                query.set(
                  "performanceSeason",
                  singleCompetition
                    ? params.get("performanceSeason") || "all"
                    : season,
                );
                query.set("matchGroup", key);
                query.delete("matchCompetition");
                if (competitionKey !== undefined)
                  query.set("matchCompetition", JSON.stringify(competitionKey));
                return {
                  profile: selected,
                  linkMatches,
                  discipline,
                  cardMatchIds: singleCompetition ? cardMatchIds : undefined,
                  matchLabel: `Voir les ${number(selected.matches)} matchs de ${label} (${season})`,
                  matchHref: `/joueurs/matchs/?${query}`,
                };
              };
              return (
                <tbody key={key}>
                  <tr className="player-season-total">
                    <th
                      scope="rowgroup"
                      rowSpan={singleCompetition ? 1 : competitions.length + 1}
                      className="player-season-group-heading"
                    >
                      {season}
                    </th>
                    <th
                      scope="rowgroup"
                      rowSpan={singleCompetition ? 1 : competitions.length + 1}
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
                    <th scope="row">
                      {singleCompetition ? (
                        <Link
                          className="player-competition-link"
                          href={playerCompetitionHref(
                            params,
                            id,
                            competitions[0].competition.id,
                          )}
                          prefetch={false}
                        >
                          {competitions[0].competition.name}
                        </Link>
                      ) : (
                        "Total équipe"
                      )}
                    </th>
                    <ProfileCells
                      {...matchProps(
                        profile,
                        name,
                        singleCompetition ? competitions[0].key : undefined,
                      )}
                    />
                  </tr>
                  {!singleCompetition &&
                    competitions.map(({ key, competition, profile }) => (
                      <tr key={key} className="player-season-competition">
                        <th scope="row">
                          <Link
                            className="player-competition-link"
                            href={playerCompetitionHref(
                              params,
                              id,
                              competition.id,
                            )}
                            prefetch={false}
                          >
                            {competition.name}
                          </Link>
                        </th>
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
            },
          )}
          {totalProfile && (
            <tfoot>
              <tr className="player-season-total">
                <th scope="row" colSpan={3}>
                  Total
                </th>
                <ProfileCells
                  profile={totalProfile}
                  discipline={discipline}
                  cardMatchIds={totalCardMatchIds}
                />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {groups.some(
        ({ profile, competitions, cardMatchIds }) =>
          hasCoverageGaps(profile, discipline, cardMatchIds) ||
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
    () =>
      playerSeasonGroups(
        playerHistoryInPeriod(history.value || [], id, f.filters?.advanced),
        id,
      ),
    [history.value, id, f.filters?.advanced?.from, f.filters?.advanced?.to],
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

function PerformanceRows({
  id,
  history,
  season,
  competition,
  hasSeasons,
  children,
}) {
  const f = useFootball();
  const entries = history.value;
  const from = f.filters?.advanced?.from || "";
  const to = f.filters?.advanced?.to || "";
  const visibleEntries = useMemo(
    () => playerHistoryInPeriod(entries || [], id, { from, to }),
    [entries, id, from, to],
  );
  const baseGroups = useMemo(
    () => playerSeasonGroups(visibleEntries, id),
    [visibleEntries, id],
  );
  const exactCompetition = competition !== "all";
  const fixtureEnabled = Boolean(
    exactCompetition &&
    entries?.length &&
    f.client &&
    f.statusKnown &&
    /^l_[A-Za-z0-9]{6}$/.test(competition) &&
    supportsCompactRead(f.manifest, "club"),
  );
  const fixtures = useResource(
    playerHistoryKey(f.manifest, id, season, competition) +
      ":team-fixtures:" +
      f.client?.id,
    ({ signal }) =>
      loadPlayerCompetitionFixtures(f.manifest, entries, id, competition, {
        client: f.client,
        signal,
      }),
    fixtureEnabled,
  );
  const detail = useMemo(
    () =>
      exactCompetition
        ? playerCompetitionHistory(
            entries || [],
            id,
            competition,
            fixtures.value || [],
            { from, to },
          )
        : null,
    [exactCompetition, entries, id, competition, fixtures.value, from, to],
  );
  const groups = detail?.groups || baseGroups;
  const matches = useMemo(
    () => [
      ...new Map(
        [
          visibleEntries.flatMap(({ data }) => data?.matches || []),
          ...(fixtures.value || []).map(({ match }) => match),
        ].map((match) => [match.id, match]),
      ).values(),
    ],
    [visibleEntries, fixtures.value],
  );
  const cardMatchIds = useMemo(
    () => [
      ...new Set(
        groups.flatMap(
          (group) =>
            group.cardMatchIds || group.profile.rows.map((row) => row.matchId),
        ),
      ),
    ],
    [groups],
  );
  const nativeMatches = useMemo(() => {
    const ids = new Set(cardMatchIds);
    return matches.filter(
      (match) => ids.has(match.id) && /^m_[A-Za-z0-9]{6}$/.test(match.id),
    );
  }, [matches, cardMatchIds]);
  const disciplineEnabled = Boolean(
    f.client &&
    f.statusKnown &&
    nativeMatches.length &&
    (!fixtureEnabled || !fixtures.loading),
  );
  const discipline = useResource(
    playerHistoryKey(f.manifest, id, season, competition) +
      ":cards:" +
      nativeMatches
        .map(({ id }) => id)
        .sort()
        .join(","),
    ({ signal }) =>
      loadDisciplineByMatch(f.client, nativeMatches, id, { signal }),
    disciplineEnabled,
  );
  return (
    <>
      {season ? (
        <AsyncState resource={history}>
          {() =>
            groups.length ? (
              <>
                <SeasonTable
                  groups={groups}
                  id={id}
                  caption={
                    exactCompetition
                      ? "Statistiques du joueur par saison dans cette compétition"
                      : "Totaux par équipe et détail par compétition"
                  }
                  discipline={discipline.value || NO_DISCIPLINE}
                  singleCompetition={exactCompetition}
                  totalProfile={exactCompetition ? detail.profile : undefined}
                  totalCardMatchIds={
                    exactCompetition ? cardMatchIds : undefined
                  }
                  linkMatches
                />
                {fixtureEnabled && fixtures.loading && (
                  <p className="club-note" role="status">
                    Chargement des feuilles de match…
                  </p>
                )}
                {fixtures.error && (
                  <p role="alert">
                    Le complément des feuilles de match est indisponible.{" "}
                    <button onClick={fixtures.retry}>Réessayer</button>
                  </p>
                )}
                {disciplineEnabled && discipline.loading && (
                  <p className="club-note" role="status">
                    Chargement des cartons…
                  </p>
                )}
              </>
            ) : (
              <p className="club-note">
                Aucune statistique disponible pour cette sélection.
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
            sections={detail?.sections}
            disciplineByMatch={discipline.value}
          />
          {exactCompetition && (
            <p className="player-history-footnote">
              Les présences sont établies à partir des apparitions et des
              compositions collectées. Les rencontres sans indication suffisante
              gardent une participation non renseignée.
            </p>
          )}
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
    playerHistoryKey(f.manifest, id) + ":routes",
    async ({ signal }) => {
      const index = await playerRoutes(f.manifest, { players: [id] }, fetch, {
        signal,
      });
      return { index, seasons: playerHistorySeasons(index, id) };
    },
    Boolean(f.manifest && id),
  );
  const competition = params.get("performanceCompetition") || "all";
  const competitionOptions = useMemo(() => {
    const known = new Map(
      (f.manifest?.competitions || []).map((item) => [item.id, item]),
    );
    known.set(UEFA_NATIONS_ID, {
      id: UEFA_NATIONS_ID,
      name: "Ligue des Nations",
    });
    const ids = new Set(
      Object.values(routing.value?.index.routes[id] || {}).flat(),
    );
    if (
      routing.value &&
      playerHistorySeasons(routing.value.index, id, UEFA_NATIONS_ID).length
    )
      ids.add(UEFA_NATIONS_ID);
    return [...ids]
      .map((key) => ({
        id: key,
        name: known.get(key)?.name || "Compétition non nommée",
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "fr"));
  }, [f.manifest, routing.value, id]);
  const validCompetition =
    competition === "all" ||
    competitionOptions.some(({ id }) => id === competition) ||
    (!routing.value &&
      (competition === UEFA_NATIONS_ID ||
        f.manifest?.competitions?.some(({ id }) => id === competition)));
  const selectedCompetitionName =
    competitionOptions.find(({ id }) => id === competition)?.name ||
    f.manifest?.competitions?.find(({ id }) => id === competition)?.name ||
    (competition === UEFA_NATIONS_ID
      ? "Ligue des Nations"
      : "Compétition indisponible");
  const seasons = useMemo(
    () =>
      routing.value
        ? playerHistorySeasons(routing.value.index, id, competition)
        : [],
    [routing.value, id, competition],
  );
  const requested = params.get("performanceSeason");
  const preferred = requested ?? (competition === "all" ? f.season : "all");
  const season =
    preferred === "all"
      ? "all"
      : seasons.includes(preferred) ||
          (!routing.value &&
            f.manifest?.seasons?.some((item) => item.id === preferred))
        ? preferred
        : "";
  const history = useResource(
    playerHistoryKey(f.manifest, id, season, competition),
    ({ signal }) =>
      loadPlayerHistory(f.manifest, id, {
        signal,
        season: season === "all" ? undefined : season,
        competition,
        routing: routing.value?.index,
        cachedSeason: (value) =>
          currentPlayerSeason(f, id, value) ||
          cachedResource(playerHistoryKey(f.manifest, id, value))?.[0] ||
          cachedResource(playerHistoryKey(f.manifest, id))?.find(
            (entry) => entry.season === value,
          ),
      }),
    Boolean(validCompetition && season && (season !== "all" || routing.value)),
  );
  const selectSeason = (event) => {
    const url = new URL(window.location.href);
    url.searchParams.set("performanceSeason", event.target.value);
    window.history.replaceState(null, "", url);
  };
  const selectCompetition = (event) => {
    const url = new URL(window.location.href);
    if (event.target.value === "all")
      url.searchParams.delete("performanceCompetition");
    else url.searchParams.set("performanceCompetition", event.target.value);
    url.searchParams.set("performanceSeason", "all");
    window.history.replaceState(null, "", url);
  };
  return (
    <section
      className="player-season-history"
      aria-label="Statistiques par saison"
    >
      <PlayerProfileFilters>
        <div className="player-performance-filters">
          <label className="player-performance-season">
            Compétition
            <select value={competition} onChange={selectCompetition}>
              <option value="all">Toutes les compétitions</option>
              {competition !== "all" &&
                !competitionOptions.some(({ id }) => id === competition) && (
                  <option value={competition} disabled={!validCompetition}>
                    {selectedCompetitionName}
                  </option>
                )}
              {competitionOptions.map(({ id, name }) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="player-performance-season">
            Saison
            <select value={season} onChange={selectSeason}>
              <option value="all">Toutes les saisons</option>
              {season && season !== "all" && !seasons.includes(season) && (
                <option value={season}>{season}</option>
              )}
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
        </div>
      </PlayerProfileFilters>
      <div className="season-section-heading">
        <h3>Statistiques par saison</h3>
      </div>
      {routing.error && (
        <p role="alert">
          {routing.error} <button onClick={routing.retry}>Réessayer</button>
        </p>
      )}
      {!validCompetition ? (
        <p className="club-note">
          Cette compétition est indisponible pour ce joueur.
        </p>
      ) : (
        <PerformanceRows
          id={id}
          history={history}
          season={season}
          competition={competition}
          hasSeasons={seasons.length > 0}
        >
          {competition === "all" && season === f.season && children}
        </PerformanceRows>
      )}
    </section>
  );
}
