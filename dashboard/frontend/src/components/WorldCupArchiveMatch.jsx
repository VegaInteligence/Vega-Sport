"use client";
/* An archived World Cup match's page (mock-up validated 18 Nov 2026): the head as a collected match's (teams, score,
 * managers), its stadium and referee, the match's thread (home left, away right), the line-ups with each player's
 * marks, the shoot-out's kicks, and the credit the licence asks for. From the Fjelstul World Cup Database
 * (GET /api/worldcup/matches/{key}); line-ups exist from 1970. */
import React from "react";
import BackLink from "./BackLink.jsx";
import { Empty, Skeleton } from "./UI.jsx";
import NationalFlag from "./NationalFlag.jsx";
import { useFootball } from "../hooks/FootballContext.jsx";
import { nationalTeamLabel } from "../services/national-flags.js";
import { WORLD_CUP_ARCHIVE_ID, WORLD_CUP_ID } from "../services/cup-catalog.js";
import {
  matchThread,
  playerMarks,
  stageLabel,
  useWorldCupMatch,
} from "../services/worldcup-matches.js";

const LINE = {
  GK: "G",
  DF: "D",
  CB: "D",
  RB: "D",
  LB: "D",
  SW: "D",
  RWB: "D",
  LWB: "D",
  WB: "D",
  MF: "M",
  CM: "M",
  DM: "M",
  AM: "M",
  RM: "M",
  LM: "M",
};
const line = (position) => (position ? LINE[position] || "A" : "");
const NOTE = {
  penalty: "sur penalty",
  own_goal: "contre son camp",
  second_yellow: "second avertissement",
  red: "exclusion",
};
const day = (value) =>
  new Date(`${value}T12:00:00Z`).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

function Icon({ kind }) {
  if (kind === "yellow" || kind === "red" || kind === "second_yellow")
    return (
      <i
        className={`wcm-card wcm-card-${kind}`}
        aria-label={NOTE[kind] || "avertissement"}
      />
    );
  if (kind === "off")
    return (
      <i className="wcm-ico wcm-off" aria-label="sorti">
        ↓
      </i>
    );
  if (kind === "on" || kind === "change")
    return (
      <i className="wcm-ico wcm-on" aria-label="entré">
        ↑
      </i>
    );
  return (
    <i className="wcm-ico" aria-label={NOTE[kind] || "but"}>
      ⚽
    </i>
  );
}

function Team({ name, edition, side }) {
  return (
    <span className={`wcm-team wcm-${side}`}>
      <NationalFlag name={name} season={String(edition)} className="wcm-flag" />
      <span>{nationalTeamLabel(name)}</span>
    </span>
  );
}

function Thread({ match }) {
  const lines = matchThread(match.events);
  if (!lines.length)
    return <p className="wcm-empty">Aucun but dans ce match.</p>;
  return (
    <div className="wcm-thread">
      {lines.map((l, i) =>
        l.half ? (
          <div key={i} className="wcm-half">
            Mi-temps
          </div>
        ) : (
          <div key={i} className="wcm-event">
            {["home", "away"]
              .map((side) =>
                l.side === side ? (
                  <div key={side} className={`wcm-what wcm-${side}`}>
                    <Icon kind={l.kind} />
                    <span>
                      <b>{l.name}</b>
                      {l.kind === "change" ? (
                        <small> ↓ {l.off}</small>
                      ) : NOTE[l.kind] ? (
                        <small> {NOTE[l.kind]}</small>
                      ) : null}
                    </span>
                  </div>
                ) : (
                  <div key={side} className={`wcm-what wcm-${side}`} />
                ),
              )
              .reduce(
                (acc, node, idx) =>
                  idx === 0
                    ? [
                        node,
                        <div key="min" className="wcm-min">
                          {l.minute}
                        </div>,
                      ]
                    : [...acc, node],
                [],
              )}
          </div>
        ),
      )}
    </div>
  );
}

function Marks({ events, person }) {
  return (
    <span className="wcm-marks">
      {playerMarks(events, person).map((m, i) => (
        <span key={i}>
          <Icon kind={m.kind} />
          {m.kind === "yellow" || m.kind === "red" || m.kind === "second_yellow"
            ? null
            : (m.kind === "own_goal" ? "c.s.c. " : "") + m.minute}
        </span>
      ))}
    </span>
  );
}

function Lineup({ match, side }) {
  const players = match.lineups[side];
  const row = (p) => (
    <div key={p.person} className="wcm-player">
      <span className="wcm-num">{p.number ?? ""}</span>
      <span className="wcm-pos">{line(p.position)}</span>
      <span className="wcm-name">{p.name}</span>
      <Marks events={match.events} person={p.person} />
    </div>
  );
  const bench = players.filter((p) => !p.starter);
  return (
    <div className="wcm-lineup">
      <h3>
        <Team name={match[side].name} edition={match.edition} side="left" />
      </h3>
      {players.filter((p) => p.starter).map(row)}
      {bench.length > 0 && <h4>Entrés en jeu</h4>}
      {bench.map(row)}
    </div>
  );
}

export default function WorldCupArchiveMatch({ matchKey }) {
  const f = useFootball();
  const resource = useWorldCupMatch(matchKey);
  const match = resource.value;
  if (resource.loading && !match)
    return (
      <Skeleton data-page-loading="" label="Chargement du match…" lines={6} />
    );
  if (resource.error || !match)
    return <Empty>Ce match n’est pas disponible.</Empty>;
  const edition = String(match.edition);
  const back = f.href("/competitions/", {
    id: edition > "2018" ? WORLD_CUP_ID : WORLD_CUP_ARCHIVE_ID,
    edition,
    view: "tableau",
  });
  const stage = stageLabel(match.stage, match.group);
  const result = match.penalties
    ? `Tirs au but ${match.penalties[0]}–${match.penalties[1]}`
    : match.extraTime
      ? "Après prolongation"
      : "Terminé";
  const lineups = match.lineups.home.length + match.lineups.away.length > 0;
  return (
    <div className="wcm">
      <nav className="wcm-crumb" aria-label="Fil d’Ariane">
        <BackLink href={back} label={`Coupe du monde ${edition}`} />
        <span aria-hidden="true">›</span>
        <span>{stage}</span>
      </nav>
      <section className="card wcm-head">
        <div className="wcm-head-top">
          <h1>
            Coupe du monde {edition} · {stage}
          </h1>
          <span>
            {day(match.date)}
            {match.time ? ` · ${match.time}` : ""}
          </span>
        </div>
        <div className="wcm-score">
          {["home", "away"]
            .map((side) => (
              <div key={side} className={`wcm-side wcm-side-${side}`}>
                <NationalFlag
                  name={match[side].name}
                  season={edition}
                  className="wcm-big-flag"
                />
                <div>
                  <strong>{nationalTeamLabel(match[side].name)}</strong>
                  {match[side].manager && <small>{match[side].manager}</small>}
                </div>
              </div>
            ))
            .reduce(
              (acc, node, idx) =>
                idx === 0
                  ? [
                      node,
                      <div key="result" className="wcm-result">
                        <strong>
                          {match.score ? (
                            <>
                              {match.score[0]}
                              <i>–</i>
                              {match.score[1]}
                            </>
                          ) : (
                            "–"
                          )}
                        </strong>
                        <small>{result}</small>
                      </div>,
                    ]
                  : [...acc, node],
              [],
            )}
        </div>
        <dl className="wcm-facts">
          <div>
            <dt>Stade</dt>
            <dd>
              {match.stadium.name}
              {match.stadium.city && <small>{match.stadium.city}</small>}
            </dd>
          </div>
          <div>
            <dt>Arbitre</dt>
            <dd>
              {match.referee ? (
                <>
                  {match.referee.name}
                  {match.referee.country && (
                    <small>{nationalTeamLabel(match.referee.country)}</small>
                  )}
                </>
              ) : (
                "—"
              )}
            </dd>
          </div>
        </dl>
      </section>
      <div className={"wcm-grid" + (lineups ? "" : " wcm-grid-single")}>
        <div>
          <section className="card wcm-card-box">
            <h2>Le fil du match</h2>
            <Thread match={match} />
          </section>
          {match.kicks.length > 0 && (
            <section className="card wcm-card-box">
              <h2>Tirs au but</h2>
              <div className="wcm-kicks">
                {["home", "away"].map((side) => (
                  <div key={side}>
                    <h3>
                      <Team
                        name={match[side].name}
                        edition={match.edition}
                        side="left"
                      />
                    </h3>
                    {match.kicks
                      .filter((k) => k.side === side)
                      .map((k, i) => (
                        <div key={i} className="wcm-kick">
                          <i
                            className={k.converted ? "wcm-in" : "wcm-out"}
                            aria-label={k.converted ? "réussi" : "manqué"}
                          >
                            {k.converted ? "✓" : "✕"}
                          </i>
                          {k.name}
                        </div>
                      ))}
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
        {lineups && (
          <section className="card wcm-card-box">
            <h2>Compositions</h2>
            <div className="wcm-lineups">
              <Lineup match={match} side="home" />
              <Lineup match={match} side="away" />
            </div>
          </section>
        )}
      </div>
      {match.credit && (
        <p className="wcm-credit">
          Détails du match :{" "}
          <a href={match.credit.url}>The Fjelstul World Cup Database</a>, © 2023
          Joshua C. Fjelstul, Ph.D., sous licence{" "}
          <a href="https://creativecommons.org/licenses/by-sa/4.0/legalcode">
            CC-BY-SA 4.0
          </a>
          .
        </p>
      )}
    </div>
  );
}
