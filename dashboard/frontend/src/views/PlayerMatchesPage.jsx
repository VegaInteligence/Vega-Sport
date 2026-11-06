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
import { playerSeasonGroups } from "../services/player-season-history.js";
import { isNationalTeamCompetition } from "../services/player-team-seasons.js";
import { useResource } from "../services/resources.js";
import { loadPlayerHistory } from "../services/scouting-history.js";

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
                  externalHref={
                    row.matchId.startsWith("uefa:")
                      ? match.sourceUrl
                      : undefined
                  }
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

export default function PlayerMatchesPage({ currentRows } = {}) {
  const params = useSearchParams();
  const f = useFootball();
  const id = params.get("id") || "";
  const season = params.get("season") || f.season;
  const valid = /^p_[A-Za-z0-9]{6}$/.test(id);
  const history = useResource(
    `player-history:${id}:${f.manifest.scouting?.sourceDigest}`,
    ({ signal }) => loadPlayerHistory(f.manifest, id, { signal }),
    valid && currentRows === undefined,
  );
  const back = new URLSearchParams(params.toString());
  back.delete("matchGroup");
  back.delete("matchCompetition");
  if (valid) back.set("playerView", "stats");
  else {
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
      ) : currentRows !== undefined ? (
        <MatchResults
          rows={currentRows}
          matches={f.data.matches}
          season={season}
        />
      ) : (
        <AsyncState resource={history}>
          {(seasons) => (
            <HistoryMatches
              seasons={seasons}
              id={id}
              groupKey={params.get("matchGroup")}
              competitionKey={params.get("matchCompetition")}
              season={season}
            />
          )}
        </AsyncState>
      )}
    </Layout>
  );
}
