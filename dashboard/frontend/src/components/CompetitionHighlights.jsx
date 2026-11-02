"use client";
import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";
import { Card, Media } from "./UI.jsx";
import { useFootball } from "../hooks/FootballContext.jsx";
import { date } from "../services/format.js";
import { kickoffFormatter, validDay } from "../services/fixtures.js";
import {
  competitionHighlights,
  highlightKickoff,
  highlightScore,
  highlightTeam,
} from "../services/competition-highlights.js";

function HighlightMatch({ match, competition, season, upcoming }) {
  const f = useFootball();
  const kickoff = highlightKickoff(match);
  const dateValue = kickoff !== null ? new Date(kickoff).toISOString() : validDay(match.date) ? match.date : "";
  const label = dateValue ? date(dateValue) : "Date à confirmer";
  const hour = upcoming && kickoff !== null ? kickoffFormatter.format(new Date(kickoff)) : null;
  const home = highlightTeam(match, "home"), away = highlightTeam(match, "away");
  return (
    <Link
      className="competition-highlight-match"
      prefetch={false}
      href={f.href("/matchs/", {
        tab: "results",
        id: match.id,
        competition: match.league?.id || competition.id,
        sourceSeason: match.season || season,
      })}
    >
      <time dateTime={dateValue || undefined} className="competition-highlight-date">
        {label}{hour ? " · " + hour : ""}
      </time>
      {[home, away].map((team, index) => (
        <span key={index} className="competition-highlight-team">
          <Media name={team.name} url={team.image_url || team.imageUrl} />
          <span className="competition-highlight-name">{team.name}</span>
          {!upcoming && <strong>{highlightScore(match, index === 0 ? "home" : "away")}</strong>}
        </span>
      ))}
    </Link>
  );
}

export default function CompetitionHighlights({ matches, competition, season, onShowMatches }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  const { upcoming, recent } = useMemo(() => competitionHighlights(matches, now), [matches, now]);
  return (
    <aside className="competition-highlights" aria-label="Matchs de la compétition">
      <Card title="Prochains matchs" className="competition-highlights-card" action={
        <button type="button" className="competition-highlights-more" onClick={() => onShowMatches("not_started")}>Voir tout</button>
      }>
        {upcoming.length ? <>
          {upcoming.some((match) => highlightKickoff(match) !== null) && <p className="competition-highlights-caption">Heures de Paris</p>}
          {upcoming.map((match) => <HighlightMatch key={match.id} match={match} competition={competition} season={season} upcoming />)}
        </> : <p className="competition-highlights-empty">Aucune rencontre à venir pour cette saison.</p>}
      </Card>
      <Card title="Derniers résultats" className="competition-highlights-card" action={
        <button type="button" className="competition-highlights-more" onClick={() => onShowMatches("finished")}>Voir tout</button>
      }>
        {recent.length ? recent.map((match) => <HighlightMatch key={match.id} match={match} competition={competition} season={season} />)
          : <p className="competition-highlights-empty">Aucun résultat disponible pour cette saison.</p>}
      </Card>
    </aside>
  );
}
