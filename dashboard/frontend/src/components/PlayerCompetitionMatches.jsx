"use client";
import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useFootball } from "../hooks/FootballContext.jsx";
import { date, number } from "../services/format.js";
import { positionOf } from "../services/player-profile.js";
import { isNationalTeamCompetition } from "../services/player-team-seasons.js";
import {
  nationalFlagCode,
  nationalTeamName,
} from "../services/national-flags.js";
import {
  competitionMatchRows,
  matchExternalUrl,
} from "../services/player-competition-matches.js";
import { Media, Segments } from "./UI.jsx";
import NationalFlag from "./NationalFlag.jsx";
import styles from "./PlayerCompetitionMatches.module.css";

function Team({ team, national, season }) {
  if (!team) return <span>Équipe inconnue</span>;
  const name = national ? nationalTeamName(team.name, season) : team.name;
  return (
    <span className={styles.team}>
      {national && nationalFlagCode(team.name, season) ? (
        <NationalFlag
          name={team.name}
          season={season}
          className={styles.crest}
        />
      ) : team.imageUrl ? (
        <Media name={name} url={team.imageUrl} className={styles.crest} />
      ) : null}
      <span>{name || "Équipe inconnue"}</span>
    </span>
  );
}
function Score({ match, f }) {
  if (!match) return <span>—</span>;
  const home = match.home?.score ?? match.score_home;
  const away = match.away?.score ?? match.score_away;
  const value = `${number(home)} – ${number(away)}`;
  const external = matchExternalUrl(match);
  if (external)
    return (
      <a
        href={external}
        target="_blank"
        rel="noreferrer"
        aria-label={`Voir le match, score ${value}`}
      >
        {value}
      </a>
    );
  if (
    !match.id ||
    String(match.id).startsWith("uefa:") ||
    match.fixtureIdentityUncertain
  )
    return <span>{value}</span>;
  return (
    <Link
      prefetch={false}
      href={f.href("/matchs/", {
        id: match.id,
        competition: match.leagueId || match.league?.id || "",
        sourceSeason: match.season || "",
        tab: "results",
      })}
      aria-label={`Voir le match, score ${value}`}
    >
      {value}
    </Link>
  );
}
export const DISCIPLINE_COLUMNS = [
  ["yellow", "yellow", "Cartons jaunes"],
  ["secondYellow", "double", "Deuxièmes jaunes"],
  ["directRed", "red", "Rouges directs"],
];
export const CardHeading = ({ color, text }) => (
  <span className={styles.cardHeading} title={text}>
    <i className={styles[color]} aria-hidden="true" />
    <span className="sr-only">{text}</span>
  </span>
);
export default function PlayerCompetitionMatches({
  groups = [],
  matches = [],
  disciplineByMatch,
}) {
  const f = useFootball(),
    [view, setView] = useState("compact");
  const sections = useMemo(
    () =>
      groups.flatMap((group) =>
        group.competitions.map((entry) => ({
          group,
          entry,
          rows: competitionMatchRows(entry.profile.rows, matches),
        })),
      ),
    [groups, matches],
  );
  if (!sections.length)
    return <p>Aucun match disponible pour cette sélection.</p>;
  return (
    <section className={styles.matches} aria-label="Détail des performances">
      <div className={styles.controls}>
        <h3>Matchs par compétition</h3>
        <Segments
          label="Affichage des performances"
          value={view}
          onChange={setView}
          items={[
            ["compact", "Compact"],
            ["detailed", "Détaillé"],
          ]}
        />
      </div>
      {sections.map(({ group, entry, rows }) => {
        const national = isNationalTeamCompetition(entry.competition.id);
        const teamName = national
          ? nationalTeamName(group.team.name, group.season)
          : group.team.name;
        return (
          <section key={`${group.key}:${entry.key}`} className={styles.section}>
            <h4>
              {teamName} · {entry.competition.name}
            </h4>
            <div className={styles.scroll}>
              <table className={styles.table}>
                <caption className="sr-only">
                  Matchs de {teamName} en {entry.competition.name},{" "}
                  {group.season}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">Domicile</th>
                    <th scope="col">Score</th>
                    <th scope="col">Extérieur</th>
                    <th scope="col">Poste</th>
                    <th scope="col">Buts</th>
                    <th scope="col">Passes déc.</th>
                    <th scope="col">Min.</th>
                    {DISCIPLINE_COLUMNS.map(([key, color, label]) => (
                      <th scope="col" key={key}>
                        <CardHeading color={color} text={label} />
                      </th>
                    ))}
                    {view === "detailed" && (
                      <>
                        <th scope="col">xG</th>
                        <th scope="col">xA</th>
                        <th scope="col">Note</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ row, match }) => {
                    const cards = disciplineByMatch?.get(row.matchId);
                    return (
                      <tr key={row.matchId}>
                        <td>{date(match?.date || row.date)}</td>
                        <td>
                          <Team
                            team={match?.home}
                            national={national}
                            season={group.season}
                          />
                        </td>
                        <td className={styles.score}>
                          <Score match={match} f={f} />
                        </td>
                        <td>
                          <Team
                            team={match?.away}
                            national={national}
                            season={group.season}
                          />
                        </td>
                        <td>{positionOf(row)?.label || "—"}</td>
                        <td>{number(row.goals)}</td>
                        <td>{number(row.assists)}</td>
                        <td>{number(row.minutes)}</td>
                        {DISCIPLINE_COLUMNS.map(([key]) => (
                          <td key={key}>{number(cards?.[key])}</td>
                        ))}
                        {view === "detailed" && (
                          <>
                            <td>{number(row.xg, 2)}</td>
                            <td>{number(row.xa, 2)}</td>
                            <td>{number(row.rating, 2)}</td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {!rows.length && <p>Aucune apparition détaillée disponible.</p>}
          </section>
        );
      })}
    </section>
  );
}
