import Link from "next/link";
import React from "react";
import { useFootball } from "../hooks/FootballContext.jsx";
import { number, date } from "../services/format.js";
import Icon from "./Icon.jsx";
import { Media } from "./UI.jsx";
const kickoffFormatter = new Intl.DateTimeFormat("fr-FR", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Paris",
});
export function MatchLink({ match, week, showKickoff = false }) {
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
  const linkable = Boolean(m.id && !match.fixtureIdentityUncertain);
  const Tag = linkable ? Link : "div";
  return (
    <Tag
      className="match-row"
      {...(linkable ? { prefetch: false } : {})}
      href={
        linkable
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
          : undefined
      }
    >
      <span className="match-date">{date(m.date)}</span>
      <span className="match-teams">
        <span className="team-name home-team">
          <span>{m.home?.name ?? "Équipe non renseignée"}</span>
          <Media name={m.home?.name} url={m.home?.imageUrl} />
        </span>
        <strong className="score">
          {m.status === "not_started"
            ? showKickoff
              ? kickoff
              : "À venir"
            : `${number(m.home?.score)} – ${number(m.away?.score)}`}
        </strong>
        <span className="team-name">
          <Media name={m.away?.name} url={m.away?.imageUrl} />
          <span>{m.away?.name ?? "Équipe non renseignée"}</span>
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
