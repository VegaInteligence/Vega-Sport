"use client";
import Link from "next/link";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Card, Media } from "./UI.jsx";
import { useFootball } from "../hooks/FootballContext.jsx";
import { date } from "../services/format.js";
import { kickoffFormatter, validDay } from "../services/fixtures.js";
import {
  competitionHighlights,
  highlightKickoff,
  highlightScore,
  highlightTeam,
  recentResultCapacity,
} from "../services/competition-highlights.js";
import { leagueStrength, useLeagueLevels } from "../services/league-levels.js";
import LeagueStrengthCard from "./LeagueStrengthCard.jsx";

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
  const [recentLimit, setRecentLimit] = useState(5);
  const highlightsRef = useRef(null);
  const { upcoming: allUpcoming, recent: allRecent } = useMemo(
    () => competitionHighlights(matches, now, Math.max(4, recentLimit)),
    [matches, now, recentLimit],
  );
  const upcoming = allUpcoming.slice(0, 4);
  const recent = allRecent.slice(0, recentLimit);
  const levels = useLeagueLevels();
  const strength = useMemo(() => leagueStrength(levels, competition.id), [levels, competition.id]);
  useEffect(() => {
    const aside = highlightsRef.current;
    const standings = aside?.closest(".competition-detail-layout--overview")?.querySelector(".competition-detail");
    const nextCard = aside?.querySelector(".competition-highlights-upcoming");
    const levelCard = aside?.querySelector(".competition-level");
    const resultsCard = aside?.querySelector(".competition-highlights-results");
    const header = resultsCard?.querySelector(".card-header");
    if (!aside || !standings || !nextCard || !resultsCard || !header) return;
    const update = () => {
      if (!window.matchMedia("(min-width: 1051px)").matches) {
        setRecentLimit(5);
        return;
      }
      const row = resultsCard.querySelector(".competition-highlight-match");
      if (!row) return;
      const gap = Number.parseFloat(window.getComputedStyle(aside).rowGap) || 0;
      const limit = recentResultCapacity({
        standingsHeight: standings.getBoundingClientRect().height,
        // The league's level card stands above the two others: its height and its gap are theirs to give.
        upcomingHeight: nextCard.getBoundingClientRect().height + (levelCard ? levelCard.getBoundingClientRect().height + gap : 0),
        headerHeight: header.getBoundingClientRect().height,
        rowHeight: row.getBoundingClientRect().height,
        gap,
      });
      setRecentLimit((previous) => previous === limit ? previous : limit);
    };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(standings);
    observer?.observe(nextCard);
    if (levelCard) observer?.observe(levelCard);
    observer?.observe(header);
    window.addEventListener("resize", update);
    update();
    return () => { observer?.disconnect(); window.removeEventListener("resize", update); };
  }, [competition.id, season, matches, upcoming.length, Boolean(strength)]);
  return (
    <aside ref={highlightsRef} className={"competition-highlights" + (strength ? " competition-highlights--level" : "")} aria-label="Matchs de la compétition">
      <LeagueStrengthCard strength={strength} />
      <Card title="Prochains matchs" className="competition-highlights-card competition-highlights-upcoming" action={
        <button type="button" className="competition-highlights-more" onClick={() => onShowMatches("not_started")}>Voir tout</button>
      }>
        {upcoming.length ? <>
          {upcoming.some((match) => highlightKickoff(match) !== null) && <p className="competition-highlights-caption">Heures de Paris</p>}
          {upcoming.map((match) => <HighlightMatch key={match.id} match={match} competition={competition} season={season} upcoming />)}
        </> : <p className="competition-highlights-empty">Aucune rencontre à venir pour cette saison.</p>}
      </Card>
      <Card title="Derniers résultats" className="competition-highlights-card competition-highlights-results" action={
        <button type="button" className="competition-highlights-more" onClick={() => onShowMatches("finished")}>Voir tout</button>
      }>
        {recent.length ? recent.map((match) => <HighlightMatch key={match.id} match={match} competition={competition} season={season} />)
          : <p className="competition-highlights-empty">Aucun résultat disponible pour cette saison.</p>}
      </Card>
    </aside>
  );
}
