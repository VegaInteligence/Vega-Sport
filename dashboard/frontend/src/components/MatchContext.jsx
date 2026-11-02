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
import { AsyncState, Card, Empty } from "./UI.jsx";
import { MatchLink } from "./MatchLink.jsx";

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
  const sides = [home, away];
  const rows = [
    ["Matchs", (club) => club.matches],
    ["Victoires", (club) => club.wins],
    ["Nuls", (club) => club.draws],
    ["Défaites", (club) => club.losses],
    ["Buts pour / match", (club) => clubMetric(club, "goalsFor").value],
    ["Buts contre / match", (club) => clubMetric(club, "goalsAgainst").value],
    ["xG pour / match", (club) => clubMetric(club, "xgFor").value],
    ["xG contre / match", (club) => clubMetric(club, "xgAgainst").value],
    ["Tirs / match", (club) => clubMetric(club, "shotsFor").value],
    ["Possession (%)", (club) => clubMetric(club, "possession").value],
    ["Jours depuis le dernier match collecté", (club) => restDays(club, match)],
  ];
  return (
    <>
      <div className="research-context">
        <strong>Avant le {date(match.date)}</strong>
        <span>
          Saison {value.season} · compétitions collectées · seuls les matchs
          antérieurs au coup d’envoi
        </span>
      </div>
      <div className="research-two-columns">
        {sides.map((club) => (
          <Card key={club.id} title={club.name}>
            <div
              className="research-form"
              aria-label={`Forme de ${club.name} avant le match`}
            >
              {club.forms.slice(0, 5).map((form) => (
                <Link
                  key={form.match.id}
                  data-result={form.result}
                  title={`${date(form.match.date)} · ${form.match.home.name} ${form.match.home.score}–${form.match.away.score} ${form.match.away.name}`}
                  href={f.href("/matchs/", {
                    id: form.match.id,
                    competition: form.match.leagueId,
                    sourceSeason: form.match.season,
                  })}
                >
                  {form.result}
                </Link>
              ))}
            </div>
            {club.forms.length ? (
              <div className="season-match-list">
                {club.forms.slice(0, 3).map((form) => (
                  <MatchLink key={form.match.id} match={form.match} />
                ))}
              </div>
            ) : (
              <Empty>
                Aucun résultat antérieur collecté pour cette saison.
              </Empty>
            )}
          </Card>
        ))}
      </div>
      <Card title="Repères avant le match">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Indicateur</th>
                <th>{home.name}</th>
                <th>{away.name}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([label, get]) => (
                <tr key={label}>
                  <th>{label}</th>
                  {sides.map((club) => (
                    <td key={club.id}>
                      {club.matches
                        ? number(
                            get(club),
                            label.includes("/") || label.includes("%") ? 2 : 0,
                          )
                        : "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="Confrontations précédentes">
        {h2h.length ? (
          <>
            {h2h.slice(0, 6).map((m) => (
              <MatchLink key={m.id} match={m} />
            ))}
            <span className="research-context">
              {h2h.length} rencontres antérieures dans les archives disponibles
            </span>
          </>
        ) : (
          <Empty>Aucune confrontation antérieure collectée.</Empty>
        )}
      </Card>
      <div className="research-two-columns">
        {sides.map((club) => (
          <Card
            title={`${club.name} · joueurs les plus utilisés`}
            key={club.id}
          >
            <div className="research-saved-list">
              {clubSquad(value.data, club)
                .profiles.filter((p) => p.matches > 0)
                .slice(0, 5)
                .map((player) => (
                  <div className="research-selection" key={player.id}>
                    <Link
                      href={f.href("/joueurs/", {
                        id: player.id,
                        season: value.season,
                        league: "all",
                        q: "",
                        rmin: "",
                        stats: "",
                      })}
                    >
                      {player.name}
                      <small>{player.role?.label} · fiche de saison</small>
                    </Link>
                    <span>{number(player.minutes)} min avant le match</span>
                  </div>
                ))}
            </div>
          </Card>
        ))}
      </div>
    </>
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
