"use client";
import React from "react";
import Link from "next/link";
import { useFootball } from "../hooks/FootballContext.jsx";
import { useResource } from "../services/resources.js";
import { loadSeason } from "../season_data.js";
import {
  historicalFixtures,
  playerRoutes,
} from "../services/scouting-history.js";
import {
  beforeMatch,
  clubMetric,
  clubSquad,
  clubSummary,
  normalizedFixture,
} from "../services/club-analysis.js";
import { date, isNumber, number, seasonLabel } from "../services/format.js";
import { AsyncState, Card, Empty, Media } from "./UI.jsx";
import { MatchLink } from "./MatchLink.jsx";
import { StatRows } from "./StatRows.jsx";

async function contextData(f, match) {
  const season = seasonLabel(match.season || f.season);
  const index = await playerRoutes(f.manifest);
  const home = index.clubRoutes?.[match.home.id] || {},
    away = index.clubRoutes?.[match.away.id] || {};
  const leagues = new Set(
    [match.leagueId, ...(home[season] || []), ...(away[season] || [])].filter(
      Boolean,
    ),
  );
  const loaded = new Set(f.data.competitions.map((c) => c.id));
  const shared = new Set([match.leagueId].filter(Boolean));
  for (const year of Object.keys(home))
    for (const id of home[year]) if (away[year]?.includes(id)) shared.add(id);
  const [data, histories] = await Promise.all([
    season === f.season && [...leagues].every((id) => loaded.has(id))
      ? f.data
      : loadSeason(f.manifest, season, fetch, leagues),
    Promise.all([...shared].map((id) => historicalFixtures(f.manifest, id))),
  ]);
  const fixtures = [
    ...new Map(
      histories.flat().map((raw) => {
        const m = normalizedFixture(raw);
        return [m.id, m];
      }),
    ).values(),
  ];
  return { data, season, fixtures };
}
function restDays(club, match) {
  const latest = club.forms[0]?.match;
  if (!latest) return null;
  const current = Date.parse(match.timeUtc || match.date),
    previous = Date.parse(latest.timeUtc || latest.date);
  return Number.isFinite(current) && Number.isFinite(previous)
    ? Math.floor((current - previous) / 86400000)
    : null;
}
const RESULT = { V: "Victoire", N: "Nul", D: "Défaite" };
function TeamForm({ club, match, side }) {
  const f = useFootball();
  const rest = restDays(club, match);
  return (
    <section className={`context-team context-team--${side}`}>
      <header>
        <Media name={club.name} url={match[side].imageUrl || club.imageUrl} />
        <div>
          <strong>{club.name}</strong>
          <span>
            {club.matches
              ? `${club.matches} matchs · ${club.wins}V ${club.draws}N ${club.losses}D`
              : "Aucun résultat antérieur collecté"}
            {isNumber(rest) && ` · ${rest} j de repos`}
          </span>
        </div>
      </header>
      {club.forms.length > 0 && (
        <ol className="context-results">
          {club.forms.slice(0, 5).map((form) => {
            const opponent =
              form.side === "home" ? form.match.away : form.match.home;
            return (
              <li key={form.match.id}>
                <Link
                  href={f.href("/matchs/", {
                    tab: "results",
                    id: form.match.id,
                    competition: form.match.leagueId,
                    sourceSeason: form.match.season,
                  })}
                  title={`${RESULT[form.result]} · ${form.match.league || ""}`}
                >
                  <span className="context-date">{date(form.match.date)}</span>
                  <span className="context-venue">
                    {form.side === "home" ? "Dom." : "Ext."}
                  </span>
                  <span className="context-opponent">
                    <Media name={opponent.name} url={opponent.imageUrl} />
                    {opponent.name}
                  </span>
                  <span className="context-score" data-result={form.result}>
                    {form.scoreFor}–{form.scoreAgainst}
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
function Content({ match, value }) {
  const f = useFootball();
  const home = clubSummary(value.data, match.home.id, { before: match }),
    away = clubSummary(value.data, match.away.id, { before: match });
  const h2h = value.fixtures
    .filter(
      (m) =>
        m.status === "finished" &&
        beforeMatch(m, match) &&
        [match.home.id, match.away.id].includes(m.home.id) &&
        [match.home.id, match.away.id].includes(m.away.id) &&
        isNumber(m.home.score) &&
        isNumber(m.away.score),
    )
    .sort((a, b) =>
      String(b.timeUtc || b.date).localeCompare(String(a.timeUtc || a.date)),
    );
  const h2hRecord = { [match.home.id]: 0, [match.away.id]: 0, draws: 0 };
  for (const m of h2h)
    if (m.home.score === m.away.score) h2hRecord.draws++;
    else h2hRecord[m.home.score > m.away.score ? m.home.id : m.away.id]++;
  const stat = (key, label, get, format = "double", lowerIsBetter = false) => ({
    key,
    label,
    format,
    lowerIsBetter,
    home: home.matches ? get(home) : null,
    away: away.matches ? get(away) : null,
  });
  const stats = [
    stat(
      "points",
      "Points / match",
      (c) => clubMetric(c, "pointsPerMatch").value,
    ),
    stat(
      "goalsFor",
      "Buts marqués / match",
      (c) => clubMetric(c, "goalsFor").value,
    ),
    stat(
      "goalsAgainst",
      "Buts encaissés / match",
      (c) => clubMetric(c, "goalsAgainst").value,
      "double",
      true,
    ),
    stat(
      "expected_goals_for",
      "xG pour / match",
      (c) => clubMetric(c, "xgFor").value,
    ),
    stat(
      "expected_goals_against",
      "xG contre / match",
      (c) => clubMetric(c, "xgAgainst").value,
      "double",
      true,
    ),
    stat("shots", "Tirs / match", (c) => clubMetric(c, "shotsFor").value),
    // Season averages of two teams are not shares of one match: no split bar.
    stat(
      "possession",
      "Possession moyenne (%)",
      (c) => clubMetric(c, "possession").value,
      "integer",
    ),
  ];
  const players = [home, away].map((club) =>
    clubSquad(value.data, club)
      .profiles.filter((p) => p.matches > 0)
      .slice(0, 5),
  );
  return (
    <div className="match-context">
      <div className="research-context">
        <strong>Avant le {date(match.timeUtc || match.date)}</strong>
        <span>
          Saison {value.season} · compétitions collectées · seuls les matchs
          antérieurs au coup d’envoi
        </span>
      </div>
      <div className="match-overview-grid">
        <Card title="Forme avant le match">
          <div className="context-teams">
            <TeamForm club={home} match={match} side="home" />
            <TeamForm club={away} match={match} side="away" />
          </div>
        </Card>
        <Card title="Repères de la saison">
          {home.matches || away.matches ? (
            <StatRows match={match} stats={stats} />
          ) : (
            <Empty>Aucun match antérieur collecté pour ces équipes.</Empty>
          )}
        </Card>
        <Card
          title="Confrontations précédentes"
          action={
            h2h.length > 0 && (
              <span className="data-source-tag">
                {match.home.name} {h2hRecord[match.home.id]} · Nuls{" "}
                {h2hRecord.draws} · {match.away.name} {h2hRecord[match.away.id]}
              </span>
            )
          }
        >
          {h2h.length ? (
            <div className="club-match-list">
              {h2h.slice(0, 6).map((m) => (
                <MatchLink key={m.id} match={m} />
              ))}
            </div>
          ) : (
            <Empty>Aucune confrontation antérieure collectée.</Empty>
          )}
        </Card>
        <Card title="Joueurs les plus utilisés">
          <div className="context-players">
            {[home, away].map((club, i) => (
              <section key={club.id}>
                <h3>{club.name}</h3>
                {players[i].length ? (
                  <ol>
                    {players[i].map((player) => (
                      <li key={player.id}>
                        <Link
                          href={f.href("/joueurs/", {
                            id: player.id,
                            season: value.season,
                            league: "",
                            q: "",
                          })}
                        >
                          <Media
                            name={player.name}
                            url={player.imageUrl}
                            className="player-avatar"
                          />
                          <span>
                            <strong>{player.name}</strong>
                            <small>{player.role?.label || "Joueur"}</small>
                          </span>
                          <b>{number(player.minutes)} min</b>
                        </Link>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <Empty>Aucune minute collectée avant le match.</Empty>
                )}
              </section>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
export default function MatchContext({ match }) {
  const f = useFootball();
  const resource = useResource(
    `match-context:${f.client.id}:${match.id}:${match.season}`,
    () => contextData(f, match),
    Boolean(match.leagueId && match.season),
  );
  if (!match.leagueId || !match.season)
    return (
      <Card title="Contexte">
        <Empty>
          La compétition ou la saison de ce match n’est pas renseignée.
        </Empty>
      </Card>
    );
  return (
    <AsyncState resource={resource}>
      {(value) => <Content match={match} value={value} />}
    </AsyncState>
  );
}
