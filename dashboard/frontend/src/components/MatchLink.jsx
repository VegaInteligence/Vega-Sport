import Link from "next/link";
import React from "react";
import { useFootball } from "../hooks/FootballContext.jsx";
import { number, date } from "../services/format.js";
import {
  nationalFlagCode,
  nationalTeamName,
} from "../services/national-flags.js";
import Icon from "./Icon.jsx";
import NationalFlag from "./NationalFlag.jsx";
import { Media } from "./UI.jsx";
const kickoffFormatter = new Intl.DateTimeFormat("fr-FR", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Paris",
});
export function MatchLink({
  match,
  week,
  showKickoff = false,
  externalHref,
  nationalTeams = false,
}) {
  const f = useFootball(),
    m = match.home
      ? {
          ...match,
          home: { ...match.home, score: match.home.score ?? match.score_home },
          away: { ...match.away, score: match.away.score ?? match.score_away },
          status:
            match.status ||
            (match.finished === false ? "not_started" : undefined),
        }
      : f.client.normalizedRemote(match);
  const kickoffValue = match.time_utc || match.timeUtc || m.timeUtc;
  const kickoffTime = kickoffValue ? Date.parse(kickoffValue) : NaN;
  const kickoff = Number.isFinite(kickoffTime)
    ? kickoffFormatter.format(new Date(kickoffTime))
    : "Horaire à confirmer";
  const linkable = Boolean(
    m.id &&
    !match.fixtureIdentityUncertain &&
    !String(m.id).startsWith("uefa:"),
  );
  const Tag = externalHref ? "a" : linkable ? Link : "div";
  const teamName = (team) =>
    (nationalTeams ? nationalTeamName(team?.name, m.season) : team?.name) ??
    "Équipe non renseignée";
  const teamLogo = (team) =>
    nationalTeams && nationalFlagCode(team?.name, m.season) ? (
      <NationalFlag name={team.name} season={m.season} />
    ) : (
      <Media name={team?.name} url={team?.imageUrl} />
    );
  return (
    <Tag
      className="match-row"
      {...(externalHref
        ? { target: "_blank", rel: "noreferrer" }
        : linkable
          ? { prefetch: false }
          : {})}
      href={
        externalHref ||
        (linkable
          ? f.href("/matchs/", {
              tab:
                showKickoff && m.status === "not_started"
                  ? "upcoming"
                  : "results",
              ...(showKickoff && m.status === "not_started"
                ? { from: "upcoming" }
                : {}),
              ...(week ? { week } : {}),
              id: m.id,
              competition: match.league?.id || m.leagueId || "",
              sourceSeason: match.season || m.season || "",
            })
          : undefined)
      }
    >
      <span className="match-date">{date(m.date)}</span>
      <span className="match-teams">
        <span className="team-name home-team">
          <span>{teamName(m.home)}</span>
          {teamLogo(m.home)}
        </span>
        <strong className="score">
          {m.status === "not_started"
            ? showKickoff
              ? kickoff
              : "À venir"
            : `${number(m.home?.score)} – ${number(m.away?.score)}`}
        </strong>
        <span className="team-name">
          {teamLogo(m.away)}
          <span>{teamName(m.away)}</span>
        </span>
      </span>
      <span className="match-league">
        {typeof m.league === "string"
          ? m.league
          : m.league?.name || match.league?.name}
      </span>
      <Icon name="arrow" />
    </Tag>
  );
}
