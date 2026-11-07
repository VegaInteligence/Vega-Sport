"use client";

import React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import Layout from "../components/Layout.jsx";
import { MatchLink } from "../components/MatchLink.jsx";
import { AsyncState, Empty } from "../components/UI.jsx";
import { useFootball } from "../hooks/FootballContext.jsx";
import { date, number } from "../services/format.js";
import { nationalTeamName } from "../services/national-flags.js";
import { playerCareerGroups } from "../services/player-career.js";
import { matchExternalUrl } from "../services/player-competition-matches.js";
import { playerSeasonGroups } from "../services/player-season-history.js";
import { isNationalTeamCompetition } from "../services/player-team-seasons.js";
import { useResource } from "../services/resources.js";
import {
  loadPlayerHistory,
  playerHistoryKey,
} from "../services/scouting-history.js";

function groupSeason(key) {
  if (!key) return null;
  try {
    const group = JSON.parse(key);
    return Array.isArray(group) &&
      group.length === 2 &&
      typeof group[0] === "string" &&
      /^\d{4}(?:\/\d{4})?$/.test(group[0])
      ? group[0]
      : null;
  } catch {
    return null;
  }
}

function MatchResults({ rows, matches, label, season }) {
  const f = useFootball();
  if (!rows.length) return <Empty>Aucun match joué dans ce périmètre.</Empty>;
  const byId = new Map(matches.map((match) => [match.id, match]));
  return (
    <section className="player-match-results" aria-label="Rencontres">
      <h1 className="page-title">Matchs de {rows[0].name || "ce joueur"}</h1>
      <p className="player-match-scope">
        {[
          season && `Saison ${season}`,
          label,
          `${number(rows.length)} matchs joués`,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      <ul className="player-fixture-list">
        {rows.map((row) => {
          const match = byId.get(row.matchId);
          return (
            <li key={row.matchId}>
              {match ? (
                <MatchLink
                  match={match}
                  externalHref={matchExternalUrl(match)}
                  nationalTeams={isNationalTeamCompetition(
                    match.leagueId || row.leagueId,
                  )}
                />
              ) : (
                <div className="match-row">
                  <span className="match-date">{date(row.date)}</span>
                  {/^m_[A-Za-z0-9]{6}$/.test(row.matchId) ? (
                    <Link
                      href={f.href("/matchs/", {
                        id: row.matchId,
                        competition: row.leagueId || "",
                        sourceSeason: row.season || season,
                        tab: "results",
                      })}
                      prefetch={false}
                    >
                      Fiche du match
                    </Link>
                  ) : (
                    "Rencontre indisponible"
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function HistoryMatches({ seasons, id, groupKey, competitionKey, season }) {
  const group = groupKey
    ? playerSeasonGroups(seasons, id).find((item) => item.key === groupKey)
    : null;
  const detail = group?.competitions.find(
    (item) => JSON.stringify(item.key) === competitionKey,
  );
  const entry = seasons.find(
    (item) => item.season === (group?.season || season),
  );
  if (!entry || (groupKey && !group) || (competitionKey !== null && !detail))
    return <Empty>Ce périmètre de matchs est indisponible.</Empty>;
  const national = group?.competitions.some(({ competition }) =>
    isNationalTeamCompetition(competition.id),
  );
  const team = national
    ? nationalTeamName(group.team.name, entry.season)
    : group?.team.name;
  return (
    <MatchResults
      rows={(detail?.profile || group?.profile || entry.profile).rows}
      matches={entry.data?.matches || []}
      label={[team, detail?.competition.name].filter(Boolean).join(" · ")}
      season={entry.season}
    />
  );
}

function CareerMatches({ seasons, id, group, matchKey }) {
  const entry = playerCareerGroups(seasons, id)[group].find(
    (item) => item.key === matchKey,
  );
  if (!entry) return <Empty>Ce périmètre de matchs est indisponible.</Empty>;
  const name =
    group === "selections"
      ? nationalTeamName(entry.name, entry.seasons[0])
      : entry.name;
  return (
    <MatchResults
      rows={entry.profile.rows}
      matches={seasons.flatMap(({ data }) => data?.matches || [])}
      label={`${name} · Cumul des saisons disponibles`}
    />
  );
}

export default function PlayerMatchesPage({ currentRows } = {}) {
  const params = useSearchParams();
  const f = useFootball();
  const id = params.get("id") || "";
  const groupKey = params.get("matchGroup");
  const competitionKey = params.get("matchCompetition");
  const careerGroup = params.get("careerGroup");
  const careerKey = params.get("careerKey");
  const career = careerGroup !== null || careerKey !== null;
  const validCareer =
    ["clubs", "competitions", "selections"].includes(careerGroup) &&
    Boolean(careerKey) &&
    groupKey === null &&
    competitionKey === null;
  const selectedSeason = groupSeason(groupKey);
  const season = selectedSeason || params.get("season") || f.season;
  const valid = /^p_[A-Za-z0-9]{6}$/.test(id);
  const history = useResource(
    playerHistoryKey(f.manifest, id, career ? undefined : season),
    ({ signal }) =>
      loadPlayerHistory(f.manifest, id, {
        signal,
        season: career ? undefined : season,
      }),
    valid && currentRows === undefined && (!career || validCareer),
  );
  const back = new URLSearchParams(params.toString());
  back.delete("matchGroup");
  back.delete("matchCompetition");
  back.delete("careerGroup");
  back.delete("careerKey");
  if (valid) {
    back.set("playerView", "stats");
    if (!career && selectedSeason)
      back.set("performanceSeason", selectedSeason);
  } else {
    back.delete("id");
    back.delete("playerView");
  }
  return (
    <Layout
      path="/joueurs/"
      title="Matchs du joueur"
      hideHeading
      performanceComparison={false}
    >
      <Link
        className="inline-link competition-back"
        href={`/joueurs/${back.size ? `?${back}` : ""}`}
      >
        ← {valid ? "Statistiques du joueur" : "Tous les joueurs"}
      </Link>
      {!valid ? (
        <Empty>Joueur indisponible.</Empty>
      ) : career && !validCareer ? (
        <Empty>Ce périmètre de matchs est indisponible.</Empty>
      ) : currentRows !== undefined ? (
        <MatchResults
          rows={currentRows}
          matches={f.data.matches}
          season={season}
        />
      ) : (
        <AsyncState resource={history}>
          {(seasons) =>
            career ? (
              <CareerMatches
                seasons={seasons}
                id={id}
                group={careerGroup}
                matchKey={careerKey}
              />
            ) : (
              <HistoryMatches
                seasons={seasons}
                id={id}
                groupKey={groupKey}
                competitionKey={competitionKey}
                season={season}
              />
            )
          }
        </AsyncState>
      )}
    </Layout>
  );
}
