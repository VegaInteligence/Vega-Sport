import Link from "next/link";
import React from "react";
import { useFootball } from "../hooks/FootballContext.jsx";
import { number, date } from "../services/format.js";
import Icon from "./Icon.jsx";
import { Media } from "./UI.jsx";
export function MatchLink({ match }) {
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
  const Tag = m.id ? Link : "div";
  return (
    <Tag
      className="match-row"
      {...(m.id ? { prefetch: false } : {})}
      href={
        m.id
          ? f.href("/matchs/", {
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
          <span>{m.home?.name}</span>
          <Media name={m.home?.name} url={m.home?.imageUrl} />
        </span>
        <strong className="score">
          {m.status === "not_started"
            ? "À venir"
            : `${number(m.home?.score)} – ${number(m.away?.score)}`}
        </strong>
        <span className="team-name">
          <Media name={m.away?.name} url={m.away?.imageUrl} />
          <span>{m.away?.name}</span>
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
