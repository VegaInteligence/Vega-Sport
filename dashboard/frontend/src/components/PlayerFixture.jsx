import Link from "next/link";
import React from "react";
import { useFootball } from "../hooks/FootballContext.jsx";
import { date, isNumber } from "../services/format.js";

export function playerOpponent(match, teamId) {
  if (!teamId) return null;
  if (match?.home?.id === teamId) return match.away;
  if (match?.away?.id === teamId) return match.home;
  return null;
}

export default function PlayerFixture({ match, row }) {
  const f = useFootball();
  const opponent = playerOpponent(match, row.teamId);
  const home = match?.home;
  const away = match?.away;
  const teams = home?.name && away?.name ? `${home.name} – ${away.name}` : null;
  const score =
    isNumber(home?.score) && isNumber(away?.score)
      ? `${home.score}–${away.score}`
      : null;
  const day = date(match?.date || row.date);
  const href = /^m_[A-Za-z0-9]{6}$/.test(row.matchId || "")
    ? f.href("/matchs/", {
        id: row.matchId,
        tab: "results",
        competition: match?.leagueId || row.leagueId || "",
        sourceSeason: match?.season || row.season || "",
      })
    : null;
  const sourceUrl = href ? null : match?.sourceUrl;
  const venue =
    opponent && !sourceUrl
      ? home.id === row.teamId
        ? "Domicile"
        : "Extérieur"
      : null;
  const label = [teams || opponent?.name || "Match", score, day]
    .filter(Boolean)
    .join(", ");
  const name = (sourceUrl && teams) || opponent?.name || teams || "Match";
  const content = (
    <>
      <strong>{name}</strong>
      {score && <span className="player-fixture-score">{score}</span>}
    </>
  );
  return (
    <div className="player-fixture">
      {sourceUrl ? (
        <a
          className="player-fixture-link"
          href={sourceUrl}
          target="_blank"
          rel="noreferrer"
          aria-label={label}
        >
          {content}
        </a>
      ) : href ? (
        <Link
          className="player-fixture-link"
          href={href}
          prefetch={false}
          aria-label={label}
        >
          {content}
        </Link>
      ) : (
        <span className="player-fixture-link">{content}</span>
      )}
      <small>{venue ? `${day} · ${venue}` : day}</small>
    </div>
  );
}
