import React, { useMemo } from "react";
import Link from "next/link";
import { useFootball } from "../hooks/FootballContext.jsx";
import { Empty, Media } from "./UI.jsx";
import { normalizeText, number, date } from "../services/format.js";
import { useResource, json } from "../services/resources.js";
import { SPORTSCORE_LEAGUES } from "../services/sportscore-standings.js";
import {
  SIMPLE_LEAGUES,
  standingsFromFixtures,
  hasCompleteHomeAwaySchedule,
} from "../services/competition-standings.js";
const teamKey = (name) => normalizeText(name).replace(/[^a-z0-9]/g, "");
const isMatchTeam = (row, club, teams) =>
  teams.some(
    (team) =>
      (team.id && (team.id === row.id || team.id === club?.id)) ||
      (team.name && teamKey(team.name) === teamKey(row.name)),
  );
function ResultStandings({ matches, source, highlightTeams }) {
  const f = useFootball();
  const table = useMemo(() => standingsFromFixtures(matches), [matches]);
  if (table.complexSchedule)
    return (
      <Empty>
        Ce format de compétition ne permet pas de calculer un classement à
        partir des seuls scores.
      </Empty>
    );
  if (!table.played)
    return (
      <Empty>
        Aucun résultat terminé disponible pour établir le classement.
      </Empty>
    );
  return (
    <div className="competition-standings">
      <div className="standings-meta">
        <span>
          {number(table.played)} matchs pris en compte
          {table.lastDate ? " · dernier match le " + date(table.lastDate) : ""}
        </span>
        <span>
          {source === "api" ? "Résultats PitchAPI" : "Archive PitchAPI"}
        </span>
      </div>
      <div
        className="table-scroll standings-scroll"
        role="region"
        aria-label="Classement de la compétition"
        tabIndex={0}
      >
        <table className="data-table standings-table">
          <caption className="sr-only">
            Classement calculé à partir des résultats disponibles
          </caption>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Équipe</th>
              <th scope="col" title="Points">
                Pts
              </th>
              <th scope="col" title="Matchs joués">
                J
              </th>
              <th scope="col" title="Victoires">
                G
              </th>
              <th scope="col" title="Matchs nuls">
                N
              </th>
              <th scope="col" title="Défaites">
                D
              </th>
              <th scope="col" title="Buts pour">
                BP
              </th>
              <th scope="col" title="Buts contre">
                BC
              </th>
              <th scope="col" title="Différence de buts">
                Diff.
              </th>
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, index) => (
              <tr
                key={row.id}
                data-match-team={
                  isMatchTeam(row, null, highlightTeams) || undefined
                }
              >
                <td>{index + 1}</td>
                <th scope="row">
                  <Link
                    className="standings-team"
                    href={f.href("/clubs/", { id: row.id })}
                  >
                    <Media name={row.name} url={row.imageUrl} />{" "}
                    <span>{row.name}</span>
                  </Link>
                </th>
                <td className="standings-points">{row.points}</td>
                <td>{row.played}</td>
                <td>{row.wins}</td>
                <td>{row.draws}</td>
                <td>{row.losses}</td>
                <td>{row.goalsFor}</td>
                <td>{row.goalsAgainst}</td>
                <td>
                  {row.difference > 0 ? "+" : ""}
                  {row.difference}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="standings-note">
        Classement calculé à partir des résultats disponibles. Les sanctions et
        certains critères de départage ne sont pas pris en compte.
        {table.excluded
          ? " " +
            table.excluded +
            " match(s) terminé(s) sans score exploitable ont été exclus."
          : ""}
      </p>
    </div>
  );
}
function SportscoreTable({ table, index, multiple, matches, highlightTeams }) {
  const f = useFootball();
  const teams = useMemo(() => {
    const result = new Map();
    for (const match of matches) {
      for (const team of [match.home_team, match.away_team]) {
        if (!team?.id || !team.name) continue;
        const key = normalizeText(team.name).replace(/[^a-z0-9]/g, "");
        if (!key) continue;
        if (result.has(key) && result.get(key)?.id !== team.id)
          result.set(key, null);
        else if (!result.has(key)) result.set(key, team);
      }
    }
    return result;
  }, [matches]);
  const display = (value) => (value == null ? "—" : number(value));
  return (
    <section className="standings-group">
      {(table.name || multiple) && (
        <h3>{table.name || "Tableau " + (index + 1)}</h3>
      )}
      <div
        className="table-scroll standings-scroll"
        role="region"
        aria-label={
          table.name
            ? `Classement ${table.name}`
            : "Classement de la compétition"
        }
        tabIndex={0}
      >
        <table className="data-table standings-table">
          <caption className="sr-only">
            Classement SportScore{table.name ? " : " + table.name : ""}
          </caption>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Équipe</th>
              <th scope="col" title="Points">
                Pts
              </th>
              <th scope="col" title="Matchs joués">
                J
              </th>
              <th scope="col" title="Victoires">
                G
              </th>
              <th scope="col" title="Matchs nuls">
                N
              </th>
              <th scope="col" title="Défaites">
                D
              </th>
              <th scope="col" title="Buts pour">
                BP
              </th>
              <th scope="col" title="Buts contre">
                BC
              </th>
              <th scope="col" title="Différence de buts">
                Diff.
              </th>
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, i) => {
              const key = normalizeText(row.name).replace(/[^a-z0-9]/g, "");
              const club = teams.get(key);
              const identity = (
                <>
                  <Media name={row.name} url={row.imageUrl} />
                  <span>{row.name}</span>
                </>
              );
              return (
                <tr
                  key={key + ":" + i}
                  data-match-team={
                    isMatchTeam(row, club, highlightTeams) || undefined
                  }
                >
                  <td>{display(row.position)}</td>
                  <th scope="row">
                    {club ? (
                      <Link
                        className="standings-team"
                        href={f.href("/clubs/", { id: club.id })}
                      >
                        {identity}
                      </Link>
                    ) : (
                      <span className="standings-team">{identity}</span>
                    )}
                  </th>
                  <td className="standings-points">{display(row.points)}</td>
                  <td>{display(row.played)}</td>
                  <td>{display(row.wins)}</td>
                  <td>{display(row.draws)}</td>
                  <td>{display(row.losses)}</td>
                  <td>{display(row.goalsFor)}</td>
                  <td>{display(row.goalsAgainst)}</td>
                  <td>
                    {row.difference == null
                      ? "—"
                      : (row.difference > 0 ? "+" : "") +
                        number(row.difference)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function CompetitionStandings({
  competition,
  season,
  matches,
  source,
  fixturesLoading = false,
  fixturesError,
  onRetry,
  highlightTeams = [],
}) {
  const latest = competition?.seasons?.[0];
  const current = Boolean(latest) && String(latest) === String(season);
  const enabled = current && Boolean(SPORTSCORE_LEAGUES[competition.id]);
  const external = useResource(
    "sportscore-standings:" + competition.id + ":" + season,
    () =>
      json("/api/standings?competition=" + encodeURIComponent(competition.id)),
    enabled,
  );
  if (enabled && external.loading)
    return (
      <div className="loading-state" role="status">
        Chargement du classement…
      </div>
    );
  if (enabled && external.value?.tables?.length) {
    const tables = external.value.tables;
    return (
      <div className="competition-standings">
        {tables.map((table, index) => (
          <SportscoreTable
            key={index}
            table={table}
            index={index}
            multiple={tables.length > 1}
            matches={matches}
            highlightTeams={highlightTeams}
          />
        ))}
        {tables.length > 1 && tables.some((table) => !table.name) && (
          <p className="standings-note">
            La source ne précise pas le nom de toutes les phases.
          </p>
        )}
      </div>
    );
  }
  if (fixturesLoading)
    return (
      <div className="loading-state" role="status">
        Chargement du classement…
      </div>
    );
  if (fixturesError)
    return (
      <div className="standings-unavailable">
        <p role="status">{fixturesError}</p>
        <button className="button button-secondary" onClick={onRetry}>
          Réessayer
        </button>
      </div>
    );
  if (
    SIMPLE_LEAGUES.has(competition.id) ||
    hasCompleteHomeAwaySchedule(matches)
  )
    return (
      <ResultStandings
        matches={matches}
        source={source}
        highlightTeams={highlightTeams}
      />
    );
  if (enabled && external.error)
    return (
      <div className="standings-unavailable">
        <p role="status">Le classement est temporairement indisponible.</p>
        <button className="button button-secondary" onClick={external.retry}>
          Réessayer
        </button>
      </div>
    );
  return (
    <Empty>
      {!current
        ? "Aucun classement de cette saison n’est disponible."
        : "Classement indisponible pour cette compétition pour le moment."}
    </Empty>
  );
}
