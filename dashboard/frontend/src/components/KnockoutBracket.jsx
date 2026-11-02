"use client";
import React, { useMemo } from "react";
import Link from "next/link";
import { Empty, Media } from "./UI.jsx";
import { date } from "../services/format.js";
import { normalizeText } from "../model.js";
import { bracketTeamLabel, bracketWinner, buildKnockoutBracket } from "../services/knockout-bracket.js";

function MatchCard({ match, hrefForMatch }) {
  const winner = bracketWinner(match);
  const href = match.id && hrefForMatch ? hrefForMatch(match.id, match.status) : null;
  const Tag = href ? Link : "div";
  const teams = [
    { name: match.home, image: match.homeImage },
    { name: match.away, image: match.awayImage },
  ];
  return (
    <Tag className={"knockout-match" + (href ? " knockout-match-link" : "")} {...(href ? { href, prefetch: false } : {})}>
      <div className="knockout-match-meta">
        <span>{match.date ? date(match.date) : "Date à préciser"}</span>
        {match.penalties ? <span title="Tirs au but">t.a.b.</span> : match.notes?.includes("après prolongation") ? <span title="Après prolongation">a.p.</span> : null}
      </div>
      {teams.map((team, index) => (
        <div key={index} className={"knockout-team" + (winner && winner === normalizeText(team.name).trim().replace(/\s+/g, " ") ? " knockout-winner" : "")}>
          {team.image && <Media name={team.name} url={team.image} className="knockout-crest" />}
          <span className="knockout-team-name" title={bracketTeamLabel(team.name)}>{bracketTeamLabel(team.name)}</span>
          <strong>{match.score ? match.score[index] : "–"}</strong>
          {match.penalties && <small aria-label={match.penalties[index] + " tirs au but"}>({match.penalties[index]})</small>}
        </div>
      ))}
      {match.legs?.length > 0 && (
        <div className="knockout-legs" aria-label="Scores des matchs aller et retour dans l’ordre des équipes affichées">
          {match.legs.map((leg, index) => {
            const label = (index === 0 ? "Aller" : "Retour") + (leg.score ? " " + leg.score.join("–") : " à venir");
            const legHref = leg.id && hrefForMatch ? hrefForMatch(leg.id, leg.status) : null;
            return legHref ? <Link key={leg.id} href={legHref} prefetch={false}>{label}</Link> : <span key={index}>{label}</span>;
          })}
        </div>
      )}
    </Tag>
  );
}

export default function KnockoutBracket({ matches, hrefForMatch }) {
  const bracket = useMemo(() => buildKnockoutBracket(matches), [matches]);
  if (!bracket.rounds.length && !bracket.preliminary && !bracket.thirdPlace.length)
    return <Empty>Le tableau apparaîtra lorsque les matchs à élimination directe seront disponibles.</Empty>;
  return (
    <section className="knockout-section" aria-label="Tableau éliminatoire">
      {bracket.preliminary && <section className="knockout-preliminary"><h3>{bracket.preliminary.label}</h3><div className="knockout-preliminary-grid">{bracket.preliminary.matches.map((match) => <MatchCard key={match.key} match={match} hrefForMatch={hrefForMatch} />)}</div></section>}
      {bracket.rounds.length > 0 && <>
        {!bracket.connected && bracket.rounds.length > 1 && <p className="knockout-note">Les matchs sont regroupés par tour lorsque leurs croisements ne sont pas précisés par la source.</p>}
        <p className="knockout-scroll-hint" aria-hidden="true">Faites défiler pour voir les autres tours.</p>
        <div className="knockout-scroll" role="region" aria-label="Parcourir le tableau éliminatoire" tabIndex="0">
          <div className={"knockout-columns" + (bracket.connected ? " knockout-columns-linked" : "")} style={{ "--knockout-slots": bracket.rounds[0].matches.length }}>
            {bracket.rounds.map((round, index) => (
              <section className="knockout-column" key={round.key}>
                <h3>{round.label}</h3>
                <div className="knockout-track">
                  {round.matches.map((match) => (
                    <div className="knockout-slot" key={match.key} style={bracket.connected ? { gridRow: "span " + 2 ** index } : undefined}>
                      <MatchCard match={match} hrefForMatch={hrefForMatch} />
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      </>}
      {bracket.thirdPlace.length > 0 && <section className="knockout-third"><h3>Match pour la troisième place</h3><div className="knockout-third-grid">{bracket.thirdPlace.map((match) => <MatchCard key={match.key} match={match} hrefForMatch={hrefForMatch} />)}</div></section>}
    </section>
  );
}
