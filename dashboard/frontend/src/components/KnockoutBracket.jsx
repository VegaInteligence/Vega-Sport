"use client";
/* A cup's bracket on one screen (mock-up validated 18 Nov 2026): both halves towards the final in the middle, the
 * champion above it, the third-place match below; as tall as the screen leaves, so nothing scrolls. A phone shows one
 * round a screen. A bracket whose crossings the source does not give lists its rounds one by one. */
import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Empty, Media } from "./UI.jsx";
import { date } from "../services/format.js";
import { normalizeText } from "../model.js";
import { bracketSides, bracketTeamLabel, bracketWinner, buildKnockoutBracket } from "../services/knockout-bracket.js";
import { nationalFlagCode, nationalTeamLabel, sameNationalTeam } from "../services/national-flags.js";
import NationalFlag from "./NationalFlag.jsx";

const SHORT = { round64: "32es", round32: "16es", round16: "8es", quarter: "Quarts", semi: "Demies", final: "Finale" };
const teamKey = (name) => normalizeText(name).trim().replace(/\s+/g, " ");

function MatchCard({ match, view }) {
  const { hrefForMatch, nationalTeams, season, follows, hover, onHover } = view;
  const winner = bracketWinner(match);
  const href = match.id && hrefForMatch ? hrefForMatch(match.id, match.status) : null;
  const Tag = href ? Link : "div";
  const teams = [
    { name: match.home, image: match.homeImage },
    { name: match.away, image: match.awayImage },
  ];
  const label = (name) => bracketTeamLabel(nationalTeams ? nationalTeamLabel(name) : name);
  const canceled = match.status === "canceled";
  const tag = canceled ? "Annulé" : match.penalties ? "t.a.b." : match.notes?.includes("après prolongation") ? "a.p." : null;
  const followed = teams.some((team) => follows(team.name));
  const dimmed = hover && !teams.some((team) => teamKey(team.name) === hover);
  return (
    <Tag
      className={"knockout-match" + (href ? " knockout-match-link" : "") + (followed ? " knockout-followed" : "") + (dimmed ? " knockout-dimmed" : "")}
      title={[match.date ? date(match.date) : "", canceled ? "Annulé" : match.penalties ? "tirs au but" : tag ? "après prolongation" : "", ...(match.notes?.includes("match rejoué") ? ["match rejoué"] : [])].filter(Boolean).join(" · ") || undefined}
      {...(href ? { href, prefetch: false } : {})}
    >
      {tag && <span className="knockout-tag">{tag}</span>}
      {teams.map((team, index) => {
        const key = teamKey(team.name);
        const state = !winner ? "" : winner === key ? " knockout-winner" : " knockout-loser";
        return (
          <div
            key={index}
            className={"knockout-team" + state + (follows(team.name) ? " knockout-own" : "")}
            onMouseEnter={() => onHover(key)}
            onMouseLeave={() => onHover("")}
          >
            {nationalTeams && nationalFlagCode(team.name, season || match.date) ? (
              <NationalFlag name={team.name} season={season || match.date} />
            ) : team.image ? (
              <Media name={team.name} url={team.image} className="knockout-crest" />
            ) : null}
            <span className="knockout-team-name" title={label(team.name)}>{label(team.name)}</span>
            {match.score ? (
              <strong>{match.score[index]}</strong>
            ) : index === 0 && match.date && !canceled ? (
              <span className="knockout-when">{date(match.date)}</span>
            ) : (
              <strong>–</strong>
            )}
            {match.penalties && <small aria-label={match.penalties[index] + " tirs au but"}>({match.penalties[index]})</small>}
          </div>
        );
      })}
      {match.legs?.length > 0 && (
        <div className="knockout-legs" aria-label="Scores des matchs aller et retour dans l’ordre des équipes affichées">
          {match.legs.map((leg, index) => {
            const text = (index === 0 ? "Aller" : "Retour") + (leg.score ? " " + leg.score.join("–") : " à venir");
            const legHref = leg.id && hrefForMatch ? hrefForMatch(leg.id, leg.status) : null;
            return legHref ? <Link key={leg.id} href={legHref} prefetch={false}>{text}</Link> : <span key={index}>{text}</span>;
          })}
        </div>
      )}
    </Tag>
  );
}

function Champion({ sides, view, trophy }) {
  if (!sides.champion) return null;
  const { nationalTeams, season } = view;
  const image = teamKey(sides.final.home) === teamKey(sides.champion) ? sides.final.homeImage : sides.final.awayImage;
  return (
    <div className="knockout-champion">
      {trophy && <img src={trophy} alt="" />}
      <b>
        {nationalTeams && nationalFlagCode(sides.champion, season || sides.final.date) ? (
          <NationalFlag name={sides.champion} season={season || sides.final.date} />
        ) : image ? (
          <Media name={sides.champion} url={image} className="knockout-crest" />
        ) : null}
        {bracketTeamLabel(nationalTeams ? nationalTeamLabel(sides.champion) : sides.champion)}
      </b>
    </div>
  );
}

const ThirdPlace = ({ match, view }) =>
  match ? (
    <div className="knockout-third">
      <small>3e place</small>
      <MatchCard match={match} view={view} />
    </div>
  ) : null;

/** The round a phone opens on: the first one still to be played, else the final. */
function openRound(rounds) {
  const pending = rounds.findIndex((round) => round.matches.some((match) => !["finished", "canceled"].includes(match.status)));
  return pending === -1 ? rounds.length - 1 : pending;
}

export default function KnockoutBracket({ matches, hrefForMatch, nationalTeams = false, season, highlight = "", trophy = null }) {
  const bracket = useMemo(() => buildKnockoutBracket(matches), [matches]);
  const early = bracket.rounds.length > 1 && bracket.rounds[0].key === "round64" ? bracket.rounds[0] : null;
  const rounds = early ? bracket.rounds.slice(1) : bracket.rounds;
  const sides = useMemo(() => bracketSides({ ...bracket, rounds }), [bracket, early]);
  const [hover, setHover] = useState("");
  const [phoneRound, setPhoneRound] = useState(null);
  // The bracket takes the height the screen leaves under its own top edge.
  const grid = useRef(null);
  useEffect(() => {
    const node = grid.current;
    if (!node) return undefined;
    const measure = () => node.style.setProperty("--knockout-top", Math.round(node.getBoundingClientRect().top + window.scrollY) + "px");
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [sides]);
  const view = {
    hrefForMatch,
    nationalTeams,
    season,
    hover,
    onHover: setHover,
    follows: (name) => Boolean(highlight) && (nationalTeams ? sameNationalTeam(name, highlight) : teamKey(name) === teamKey(highlight)),
  };
  if (!bracket.rounds.length && !bracket.preliminary && !bracket.thirdPlace.length)
    return <Empty>Le tableau apparaîtra lorsque les matchs à élimination directe seront disponibles.</Empty>;
  const started = rounds.some((round) => round.matches.some((match) => match.status === "finished"));
  const legs = rounds.some((round) => round.matches.some((match) => match.legs?.length));
  const current = phoneRound == null ? openRound(rounds) : Math.min(phoneRound, rounds.length - 1);
  const column = (round, index, side) => (
    <div key={side + round.key} className={"knockout-column knockout-" + side + (index === 0 ? " knockout-first" : "") + (index === sides.rounds.length - 1 ? " knockout-last" : "")}>
      {round[side].map((match) => (
        <div className="knockout-slot" key={match.key} style={{ gridRow: "span " + 2 ** index }}>
          <MatchCard match={match} view={view} />
        </div>
      ))}
    </div>
  );
  return (
    <section className={"knockout-section" + (legs ? " knockout-two-legged" : "")} aria-label="Tableau éliminatoire">
      {early && (
        <details className="knockout-early">
          <summary>Trente-deuxièmes de finale · {early.matches.length} matchs</summary>
          <div className="knockout-list">{early.matches.map((match) => <MatchCard key={match.key} match={match} view={view} />)}</div>
        </details>
      )}
      {bracket.preliminary && (
        <details className="knockout-early" open={!started}>
          <summary>{bracket.preliminary.label} · {bracket.preliminary.matches.length} confrontations</summary>
          <div className="knockout-list">{bracket.preliminary.matches.map((match) => <MatchCard key={match.key} match={match} view={view} />)}</div>
        </details>
      )}
      {sides ? (
        <>
          <div className="knockout-bracket" style={{ "--knockout-columns": sides.rounds.length * 2 + 1, "--knockout-half": sides.half }}>
            <div className="knockout-labels" aria-hidden="true">
              {sides.rounds.map((round) => <span key={"left" + round.key}>{round.label}</span>)}
              <span className="knockout-label-final">Finale</span>
              {[...sides.rounds].reverse().map((round) => <span key={"right" + round.key}>{round.label}</span>)}
            </div>
            <div className="knockout-grid" ref={grid}>
              {sides.rounds.map((round, index) => column(round, index, "left"))}
              <div className="knockout-centre">
                <Champion sides={sides} view={view} trophy={trophy} />
                <div className="knockout-final"><MatchCard match={sides.final} view={view} /></div>
                <ThirdPlace match={sides.third} view={view} />
              </div>
              {sides.rounds.map((round, index) => column(round, index, "right")).reverse()}
            </div>
          </div>
          <div className="knockout-phone">
            <div className="segmented-control knockout-rounds" aria-label="Tour du tableau">
              {rounds.map((round, index) => (
                <button key={round.key} type="button" aria-pressed={index === current} onClick={() => setPhoneRound(index)}>
                  {SHORT[round.key] || round.label}
                </button>
              ))}
            </div>
            {rounds[current].key === "final" && <Champion sides={sides} view={view} trophy={trophy} />}
            <div className={"knockout-list" + (rounds[current].matches.length < 3 ? " knockout-list-single" : "")}>
              {rounds[current].matches.map((match) => <MatchCard key={match.key} match={match} view={view} />)}
            </div>
            {rounds[current].key === "final" && <ThirdPlace match={sides.third} view={view} />}
          </div>
        </>
      ) : (
        <div className="knockout-rows">
          {rounds.map((round) => (
            <section key={round.key}>
              <h3>{round.label}</h3>
              <div className="knockout-list">{round.matches.map((match) => <MatchCard key={match.key} match={match} view={view} />)}</div>
            </section>
          ))}
          {bracket.thirdPlace.length > 0 && (
            <section>
              <h3>Match pour la troisième place</h3>
              <div className="knockout-list">{bracket.thirdPlace.map((match) => <MatchCard key={match.key} match={match} view={view} />)}</div>
            </section>
          )}
        </div>
      )}
    </section>
  );
}
