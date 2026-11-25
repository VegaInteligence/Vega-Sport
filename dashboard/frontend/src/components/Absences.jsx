"use client";
/* A team's absent players (/api/teams/{id}/absences): the squad tab's card with each return on
 * one time scale, the mark beside an absent player's name in a table, and the two sides of a
 * match still to be played. The forecast does not count them: these blocks only show them. */
import React from "react";
import Link from "next/link";
import { Card as MatchCard, ClubCrest, PlayerAvatar, Skeleton } from "./UI.jsx";
import { useFootball } from "../hooks/FootballContext.jsx";
import {
  absenceCompetition,
  absenceDate,
  absenceKind,
  absenceReason,
  absenceRole,
  absenceScale,
  absenceTitle,
  absenceView,
  returnDistance,
  useTeamAbsences,
} from "../services/team-absences.js";
// The chart tokens (--mq-*) are scoped to their class: each root of these blocks carries it.
import { chartTokens } from "./PlayerScoutCharts.jsx";
import s from "./Absences.module.css";

const matches = (n) => `${n} match${n > 1 ? "s" : ""}`;

/** The kind's sign: a cross for an injury or an illness, a card for a suspension, a ring otherwise. */
export function AbsenceGlyph({ kind }) {
  return <i className={s.glyph} data-kind={kind} aria-hidden="true" />;
}

/** Beside a player's name in a table: his sign, the reason and return in its title. */
export function AbsenceMark({ absence, asOf }) {
  if (!absence) return null;
  const title = absenceTitle(absence, asOf);
  // An <i>, not a <span>: the tables lay out their cell's spans as blocks (ClubScout .player span).
  return (
    <i className={`${s.mark} ${chartTokens}`} title={title}>
      <AbsenceGlyph kind={absenceKind(absence)} />
      <span className="sr-only">{title}</span>
    </i>
  );
}

/** How much of the squad was read: one cell per player, the absent ones in their kind's colour,
 *  the players not read left empty. */
function SquadCells({ view }) {
  const { players, read } = view.squad;
  // One cell per player: one out twice (suspended and injured) is one member of the squad.
  const out = [...view.byPlayer.values()].map((a) => absenceKind(a));
  const cells = [
    ...out,
    ...Array.from({ length: Math.max(0, read - out.length) }, () => "available"),
    ...Array.from({ length: Math.max(0, players - read) }, () => "unread"),
  ];
  return (
    <span className={s.cells} aria-hidden="true">
      {cells.map((kind, i) => (
        <i key={i} data-kind={kind} />
      ))}
    </span>
  );
}

/** The card's corner: the squad's cells and how many players were read. */
export function AbsenceCoverage({ view }) {
  if (!view?.squad) return null;
  const { players, read } = view.squad;
  return (
    <span className={`${s.coverage} ${chartTokens}`}>
      <SquadCells view={view} />
      <span>
        <b>
          {read} / {players}
        </b>{" "}
        renseignés
      </span>
    </span>
  );
}

function Lane({ absence, scale }) {
  const kind = absenceKind(absence);
  // A suspension whose matches to serve are not known: the open bar, not a count of cards.
  if (kind === "suspension" && absence.matchesRemaining > 0)
    return (
      <span className={s.lane}>
        <span className={s.cards}>
          {Array.from({ length: Math.min(absence.matchesRemaining, 6) }, (_, i) => (
            <AbsenceGlyph key={i} kind="suspension" />
          ))}
        </span>
      </span>
    );
  if (kind === "suspension" || !absence.expectedReturn)
    return (
      <span className={s.lane}>
        <i className={s.bar} data-kind={kind} data-open="" />
      </span>
    );
  const beyond = scale.beyond(absence.expectedReturn);
  return (
    <span className={s.lane}>
      <i
        className={s.bar}
        data-kind={kind}
        data-beyond={beyond ? "" : undefined}
        style={{ width: `max(4px, ${100 * scale.at(absence.expectedReturn)}%)` }}
      />
    </span>
  );
}

function Back({ absence, asOf }) {
  if (absenceKind(absence) === "suspension")
    return (
      <span className={s.back}>
        <strong>{absence.matchesRemaining ? matches(absence.matchesRemaining) : "—"}</strong>
      </span>
    );
  if (!absence.expectedReturn)
    return (
      <span className={s.back}>
        <strong className={s.unknown}>Inconnu</strong>
      </span>
    );
  const distance = returnDistance(absence.expectedReturn, asOf);
  return (
    <span className={s.back}>
      <strong>{absenceDate(absence.expectedReturn, asOf)}</strong>
      {distance && <small>{distance}</small>}
    </span>
  );
}

function since(absence, asOf) {
  const parts = [];
  if (absenceKind(absence) === "suspension" && absenceCompetition(absence)) parts.push(absenceCompetition(absence));
  if (absence.start) parts.push(`depuis le ${absenceDate(absence.start, asOf)}`);
  if (absence.matchesMissed > 0) parts.push(`${matches(absence.matchesMissed)} manqué${absence.matchesMissed > 1 ? "s" : ""}`);
  return parts.join(" · ");
}

/** While the read runs: the board's head and two rows' height, so that the tab does not move when it arrives. */
function BoardPlaceholder() {
  return (
    <div className={`${s.board} ${chartTokens}`} aria-busy="true">
      <div className={s.head} aria-hidden="true">
        <span>Joueur</span>
        <span>Motif</span>
        <span className={s.axis} />
        <span>Retour</span>
      </div>
      <div className={s.placeholder}>
        <Skeleton label="Chargement des absents…" lines={2} />
      </div>
    </div>
  );
}

/** The squad tab's board: one row per absence, every return on the same time scale. */
export function AbsenceBoard({ view, loading = false }) {
  const f = useFootball();
  if (loading) return <BoardPlaceholder />;
  if (!view?.rows.length) return null;
  const scale = absenceScale(view.rows, view.asOf);
  return (
      <div className={`${s.board} ${chartTokens}`}>
        <div className={s.head} aria-hidden="true">
          <span>Joueur</span>
          <span>Motif</span>
          <span className={s.axis}>
            {scale.ticks.map((t) => (
              <span key={t.at} style={{ left: `${100 * t.at}%` }}>
                {t.label}
              </span>
            ))}
          </span>
          <span>Retour</span>
        </div>
        <ul className={s.rows}>
          {view.rows.map((a) => {
            const kind = absenceKind(a);
            return (
              <li key={a.key} className={s.row} data-kind={kind}>
                <Link className={s.who} href={f.href("/joueurs/", { id: a.player.id, q: "" })} prefetch={false}>
                  <PlayerAvatar player={a.player} size={32} />
                  <span>
                    <strong>{a.player.name}</strong>
                    <small>{absenceRole(a)}</small>
                  </span>
                </Link>
                <span className={s.reason}>
                  <span>
                    <AbsenceGlyph kind={kind} />
                    {absenceReason(a)}
                  </span>
                  <small>{since(a, view.asOf)}</small>
                </span>
                <span className={s.laneCell}>
                  <span className={s.grid} aria-hidden="true">
                    {scale.ticks.map((t) => (
                      <i key={t.at} style={{ left: `${100 * t.at}%` }} />
                    ))}
                  </span>
                  <Lane absence={a} scale={scale} />
                </span>
                <Back absence={a} asOf={view.asOf} />
              </li>
            );
          })}
        </ul>
      </div>
  );
}

/** A side's absent players in a list: portrait, name, reason, return (a match's sides; a probable XI's absents). */
export function AbsentRows({ rows, asOf }) {
  const f = useFootball();
  return (
    <ul className={`${s.sideRows} ${chartTokens}`}>
      {rows.map((a) => {
        const kind = absenceKind(a);
        return (
          <li key={a.key} data-kind={kind}>
            <Link className={s.who} href={f.href("/joueurs/", { id: a.player.id, q: "" })} prefetch={false}>
              <PlayerAvatar player={a.player} size={28} />
              <span>
                <strong>{a.player.name}</strong>
                <small>
                  <AbsenceGlyph kind={kind} />
                  {absenceReason(a)}
                </small>
              </span>
            </Link>
            <Back absence={a} asOf={asOf} />
          </li>
        );
      })}
    </ul>
  );
}

function MatchSide({ team, state, match }) {
  const view = absenceView(state.value, { match });
  let body;
  if (state.loading && !state.value) body = <p className={s.empty}>…</p>;
  else if (!view) body = <p className={s.empty}>Non renseignés</p>;
  else if (!view.rows.length) body = <p className={s.empty}>Aucun absent</p>;
  else body = <AbsentRows rows={view.rows} asOf={view.asOf} />;
  return (
    <section className={s.side}>
      <h3>
        <ClubCrest club={team} size={24} />
        <span>{team.name}</span>
        {view?.rows.length ? <b>{view.rows.length}</b> : null}
      </h3>
      {body}
    </section>
  );
}

/** A match still to be played: each side's absent players, the suspensions of this competition only (by its id),
 *  the injuries and illnesses not over by the kick-off. */
export function MatchAbsences({ match }) {
  const home = useTeamAbsences(match?.home?.id);
  const away = useTeamAbsences(match?.away?.id);
  if (!match?.home?.id || !match?.away?.id) return null;
  // Neither side read: no card rather than two empty halves.
  if (!home.loading && !away.loading && !home.value && !away.value) return null;
  const scope = { competitionId: match.leagueId || null, kickoff: match.timeUtc || match.date || null };
  return (
    <MatchCard title="Absents" className={s.matchCard}>
      <div className={`${s.sides} ${chartTokens}`}>
        <MatchSide team={match.home} state={home} match={scope} />
        <MatchSide team={match.away} state={away} match={scope} />
      </div>
    </MatchCard>
  );
}
