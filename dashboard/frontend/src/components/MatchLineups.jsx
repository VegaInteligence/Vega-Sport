"use client";
/* The « Compositions » tab: one pitch with both teams facing each other, every starter with his
 * photo, number, Vega grade, goals, cards and the minute he went off (hovered: his match in a
 * few figures; clicked: his performance of the match); beside it (under it on narrower screens),
 * each side's coach, substitutes with the minute they came on and whom they replaced, then those
 * who stayed on the bench, each opening his performance too. On a phone the pitch stands up.
 * Before the kick-off each side shows the provider's line-up (official, or « prévisionnelle »),
 * else our probable XI (outlined markers, its absents in place of the bench); from 90 minutes
 * before the kick-off the line-ups are read again every minute until both are official. */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ClubCrest, Empty, Media, Skeleton } from "./UI.jsx";
import { useHoverBubble } from "./HoverCard.jsx";
import { AbsenceGlyph, AbsentRows } from "./Absences.jsx";
import { useFootball } from "../hooks/FootballContext.jsx";
import useMatchSection from "../hooks/useMatchSection.js";
import { useMatchGrades } from "../services/match-grades.js";
import {
  LINEUPS_WATCH, lineupSides, lineupView, lineupsBeforeKickoff, lineupsWatched, playerRows, probableImages, probableView, probableWanted,
} from "../services/match-tabs.js";
import { absenceDate } from "../services/team-absences.js";
import { number } from "../services/format.js";
import { GRADE_HIGH } from "../services/grades.js";
import s from "./MatchTabs.module.css";
import o from "./MatchPlayerOpen.module.css";

// A surname's particle stays with it: « Théo Le Bris » → « Le Bris », « Kevin De Bruyne » → « De Bruyne ».
const PARTICLES = new Set(["de", "da", "di", "do", "dos", "du", "del", "der", "van", "von", "le", "la", "ter", "ten", "el", "al", "ben"]);
const shortName = (name) => {
  const parts = String(name || "").trim().split(/\s+/);
  if (parts.length < 2 || parts.at(-1).length <= 2) return name;
  return parts.length > 2 && PARTICLES.has(parts.at(-2).toLowerCase()) ? parts.slice(-2).join(" ") : parts.at(-1);
};
const gradeTone = (grade) => (grade == null ? "" : grade >= GRADE_HIGH ? s.gradeHigh : grade < 45 ? s.gradeLow : "");

/** The time, read again every minute: the watch starts while the page stays open. */
function useMinute() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), LINEUPS_WATCH.every);
    return () => clearInterval(timer);
  }, []);
  return now;
}

const STATE = {
  official: "Composition officielle",
  forecast: "Composition prévisionnelle",
  probable: "Composition probable",
};
const shortDay = (iso) => absenceDate(iso, iso);
function BasisLine({ basis }) {
  if (!basis?.lineups) return null;
  const span = basis.from && basis.to ? ` · ${shortDay(basis.from)} – ${shortDay(basis.to)}` : "";
  return (
    <p className={s.bubbleNote}>
      D’après les {basis.lineups} derniers matchs{span}
    </p>
  );
}
/** A side's state beside its name: official, the provider's forecast, or ours (its basis when hovered). */
function SideState({ data, bubble }) {
  if (!data?.state) return null;
  const hover =
    data.state === "probable" && data.basis
      ? {
          tabIndex: 0,
          onMouseEnter: (event) => bubble.show(event.currentTarget, <BasisLine basis={data.basis} />),
          onMouseLeave: bubble.hide,
          onFocus: (event) => bubble.show(event.currentTarget, <BasisLine basis={data.basis} />),
          onBlur: bubble.hide,
        }
      : {};
  return (
    <span className={s.sideState} data-state={data.state} {...hover}>
      <i aria-hidden="true" />
      {STATE[data.state]}
    </span>
  );
}
/** Before the kick-off: each side's crest, name, formation and state, facing each other over the pitch. */
function SidesHead({ match, sides, bubble }) {
  return (
    <div className={s.sidesHead}>
      {["home", "away"].map((side) => {
        const team = match[side];
        return (
          <div key={side} className={s.sideHead} data-side={side} data-lineup-state={sides[side]?.state || "none"}>
            <ClubCrest club={team} size={28} />
            <span className={s.sideName}>
              <strong>{team.name}</strong>
              {sides[side]?.formation && <span className={s.sideFormation}>{sides[side].formation}</span>}
            </span>
            {sides[side] ? <SideState data={sides[side]} bubble={bubble} /> : <span className={s.sideState} data-state="none">Non renseignée</span>}
          </div>
        );
      })}
    </div>
  );
}

/** Phones get a standing pitch: home at the foot attacking up, away at the top. */
function useStanding() {
  const [standing, setStanding] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 760px)");
    const update = () => setStanding(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return standing;
}

/** Where a starter stands, in % of the pitch box: his side attacks to the right (or up). */
function spot(p, side, standing) {
  const depth = 3 + p.x * 46, across = 8 + p.y * 84;
  if (standing)
    return side === "home" ? { left: across, top: 100 - depth } : { left: 100 - across, top: depth };
  return side === "home" ? { left: depth, top: across } : { left: 100 - depth, top: 100 - across };
}

/** A probable starter: how often he started in the basis, whom he replaces. */
function ProbableLine({ p, basis }) {
  const starts = p.share != null && basis?.lineups ? Math.round(p.share * basis.lineups) : null;
  return (
    <>
      <p className={s.bubbleHead}>{p.name}</p>
      {starts != null && (
        <p className={s.bubbleNote}>
          Titulaire {starts} fois sur {basis.lineups}
        </p>
      )}
      {p.replaces && (
        <p className={`${s.bubbleNote} ${s.bubbleReplaces}`}>
          <AbsenceGlyph kind={p.replaces.kind || "unknown"} />
          Remplace {p.replaces.name}
        </p>
      )}
    </>
  );
}

function PlayerLine({ p, row }) {
  const facts = [
    p.minutes != null && `${number(p.minutes)} min`,
    p.goals.length && `${p.goals.length} but${p.goals.length > 1 ? "s" : ""} (${p.goals.map((m) => `${m}′`).join(", ")})`,
    row?.assists > 0 && `${row.assists} passe${row.assists > 1 ? "s" : ""} décisive${row.assists > 1 ? "s" : ""}`,
    row?.xg != null && `${number(row.xg, 2)} xG`,
    row?.passes != null && row?.passesTotal && `${row.passes}/${row.passesTotal} passes`,
    row?.duelsWon != null && `${row.duelsWon} duels gagnés`,
    row?.saves != null && `${row.saves} arrêt${row.saves > 1 ? "s" : ""}`,
  ].filter(Boolean);
  return (
    <>
      <p className={s.bubbleHead}>
        {p.name}
        {p.grade != null && <span className={`${s.grade} ${gradeTone(p.grade)}`}>{number(p.grade, 0)}</span>}
      </p>
      <p className={s.bubbleNote}>{facts.join(" · ") || "Aucune statistique."}</p>
      {p.cards.map((c, i) => (
        <p key={i} className={s.bubbleNote}>
          <i className={`${s.cardIcon} ${c.kind === "yellow" ? s.yellow : s.red}`} /> {c.minute}′
        </p>
      ))}
      {p.off && <p className={s.bubbleNote}>▼ Remplacé à la {p.off.minute}′{p.off.by?.name ? ` par ${p.off.by.name}` : ""}</p>}
      {p.on && <p className={s.bubbleNote}>▲ Entré à la {p.on.minute}′{p.on.for?.name ? ` à la place de ${p.on.for.name}` : ""}</p>}
    </>
  );
}

function Marker({ p, side, standing, bubble, row, basis, onOpen }) {
  const at = spot(p, side, standing);
  const line = p.probable ? <ProbableLine p={p} basis={basis} /> : <PlayerLine p={p} row={row} />;
  const body = (
    <>
      <span className={s.markerPhoto}>
        <Media name={p.name} url={p.imageUrl} className={`player-avatar ${s.markerAvatar} ${side === "home" ? s.homeRing : s.awayRing}`} />
        {p.shirt && <span className={s.markerNumber}>{p.shirt}</span>}
        {p.grade != null && <span className={`${s.markerGrade} ${gradeTone(p.grade)}`}>{number(p.grade, 0)}</span>}
      </span>
      <span className={s.markerName}>
        {shortName(p.name)}
        {p.captain ? " ©" : ""}
      </span>
      {(p.goals.length > 0 || p.ownGoals.length > 0 || p.cards.length > 0 || p.off) && (
        <span className={s.markerTags}>
          {p.goals.map((m) => <span key={`g${m}`} title={`But à la ${m}′`}>⚽</span>)}
          {p.ownGoals.map((m) => <span key={`o${m}`} title={`But contre son camp à la ${m}′`} className={s.ownGoal}>⚽</span>)}
          {p.cards.map((c, i) => <i key={i} className={`${s.cardIcon} ${c.kind === "yellow" ? s.yellow : s.red}`} title={`${c.minute}′`} />)}
          {p.off && <span className={s.off}>▼ {p.off.minute}′</span>}
        </span>
      )}
    </>
  );
  const style = { left: `${at.left}%`, top: `${at.top}%` };
  const hover = {
    onMouseEnter: (event) => bubble.show(event.currentTarget, line),
    onMouseLeave: bubble.hide,
    onFocus: (event) => bubble.show(event.currentTarget, line),
    onBlur: bubble.hide,
  };
  return p.id ? (
    <button
      type="button"
      className={`${s.marker} ${o.marker} ${p.probable ? s.probable : ""}`}
      style={style}
      data-marker={p.probable ? "probable" : "lineup"}
      aria-label={`${p.name}${p.shirt ? `, n° ${p.shirt}` : ""}${p.replaces ? `, remplace ${p.replaces.name}` : ""}`}
      onClick={() => {
        bubble.hide();
        onOpen(p.id);
      }}
      {...hover}
    >
      {body}
    </button>
  ) : (
    <span className={`${s.marker} ${p.probable ? s.probable : ""}`} style={style} data-marker={p.probable ? "probable" : "lineup"}>
      {body}
    </span>
  );
}

function PitchLines({ standing }) {
  return standing ? (
    <svg className={s.pitchLines} viewBox="0 0 68 105" preserveAspectRatio="none" aria-hidden="true">
      <rect x=".5" y=".5" width="67" height="104" />
      <line x1=".5" y1="52.5" x2="67.5" y2="52.5" />
      <circle cx="34" cy="52.5" r="9" />
      <rect x="14" y=".5" width="40" height="16" />
      <rect x="14" y="88.5" width="40" height="16" />
    </svg>
  ) : (
    <svg className={s.pitchLines} viewBox="0 0 105 68" preserveAspectRatio="none" aria-hidden="true">
      <rect x=".5" y=".5" width="104" height="67" />
      <line x1="52.5" y1=".5" x2="52.5" y2="67.5" />
      <circle cx="52.5" cy="34" r="9" />
      <rect x=".5" y="14" width="16" height="40" />
      <rect x="88.5" y="14" width="16" height="40" />
    </svg>
  );
}

function BenchChips({ players, onOpen }) {
  return (
    <div className={o.chips}>
      {players.map((p) => {
        const text = `${p.shirt ? `${p.shirt} · ` : ""}${p.name}`;
        return p.id ? (
          <button type="button" key={p.id} className={`${o.open} ${o.chip}`} onClick={() => onOpen(p.id)}>
            {text}
          </button>
        ) : (
          <span key={p.name} className={o.chip}>
            {text}
          </span>
        );
      })}
    </div>
  );
}

function SideBench({ side, team, data, before, asOf, onOpen }) {
  if (!data) return <p className={o.none}>Composition absente : {team?.name || side}</p>;
  const head = (
    <div className={o.benchHead}>
      <Media name={team?.name} url={data.team?.image_url || team?.imageUrl} size={20} kind="club" />
      <h3>{team?.name}</h3>
      {data.formation && <strong>{data.formation}</strong>}
    </div>
  );
  // Our probable XI: its absents in place of the bench.
  if (data.state === "probable")
    return (
      <section className={`${o.bench} ${side === "away" ? o.away : ""}`} aria-label={`Absents de ${team?.name || side}`} data-lineup-state="probable">
        {head}
        <p className={o.label}>Absents</p>
        {data.absent.length ? <AbsentRows rows={data.absent} asOf={asOf} /> : <p className={o.none}>Aucun absent</p>}
      </section>
    );
  // Before the kick-off: the substitutes, nobody has come on yet.
  if (before)
    return (
      <section className={`${o.bench} ${side === "away" ? o.away : ""}`} aria-label={`Banc de ${team?.name || side}`} data-lineup-state={data.state}>
        {head}
        {data.coach && (
          <p className={o.coach}>
            Entraîneur : <b>{data.coach}</b>
          </p>
        )}
        <p className={o.label}>Remplaçants</p>
        {data.bench.length ? <BenchChips players={data.bench} onOpen={onOpen} /> : <p className={o.none}>Non renseignés</p>}
      </section>
    );
  return (
    <section className={`${o.bench} ${side === "away" ? o.away : ""}`} aria-label={`Banc de ${team?.name || side}`}>
      {head}
      <p className={o.coach}>
        Entraîneur : <b>{data.coach || "non renseigné"}</b>
        {data.confirmed === false ? " · composition prévisionnelle" : ""}
      </p>
      <p className={o.label}>Entrés en jeu</p>
      {data.entered.length ? (
        data.entered.map((p) => {
          const content = (
            <>
              <span className={o.subMinute}>▲ {p.on.minute}′</span>
              <Media name={p.name} url={p.imageUrl} className={`player-avatar ${o.avatar}`} />
              <span className={o.who}>
                <span className={o.name}>{p.name}</span>
                <small>pour {p.on.for?.name || "—"}</small>
              </span>
              {p.grade != null ? <span className={`${s.grade} ${gradeTone(p.grade)}`}>{number(p.grade, 0)}</span> : <span />}
            </>
          );
          return p.id ? (
            <button type="button" className={`${o.open} ${o.sub}`} key={p.id} onClick={() => onOpen(p.id)}>
              {content}
            </button>
          ) : (
            <div className={o.sub} key={p.name}>
              {content}
            </div>
          );
        })
      ) : (
        <p className={o.none}>Aucun changement.</p>
      )}
      {data.bench.length > 0 && (
        <>
          <p className={o.label}>Restés sur le banc</p>
          <BenchChips players={data.bench} onOpen={onOpen} />
        </>
      )}
    </section>
  );
}

export default function MatchLineups({ match }) {
  const f = useFootball();
  const now = useMinute();
  const before = lineupsBeforeKickoff(match, now);
  const lineupsSeen = useRef(null);
  // Watched until both sides are official, from 90 min before the kick-off to 30 min after it.
  const watch = lineupsWatched(match, lineupsSeen.current, now);
  const lineups = useMatchSection(match, "lineups", true, { every: watch ? LINEUPS_WATCH.every : 0 });
  if (lineups.data) lineupsSeen.current = lineups.data;
  const settled = useRef(false);
  if (lineups.data || lineups.error) settled.current = true;
  // Ours only while a side lacks the provider's eleven; a 404 or a failed read leaves the other states.
  const wanted = probableWanted(before, lineups.data);
  const probable = useMatchSection(match, "lineups/probable", settled.current && wanted);
  const events = useMatchSection(match, "events", !before);
  const players = useMatchSection(match, "players", !before);
  const grades = useMatchGrades(match.id);
  const standing = useStanding();
  const bubble = useHoverBubble({ width: 280 });
  const rows = useMemo(() => playerRows(players.data), [players.data]);
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const images = useMemo(() => probableImages(probable.data), [probable.data]);
  const view = useMemo(
    () => lineupView(lineups.data, events.data?.events, rows, grades, images),
    [lineups.data, events.data, rows, grades, images],
  );
  const sides = useMemo(() => lineupSides(view, probableView(probable.data)), [view, probable.data]);
  if (!settled.current || (wanted && probable.loading && !probable.data))
    return <Skeleton label="Chargement des compositions…" lines={4} />;
  if (!sides.home && !sides.away) return <Empty>Compositions non renseignées.</Empty>;
  const open = (id) => f.setPlayer(`${match.id}:${id}`);
  const asOf = probable.data?.computedAt?.slice(0, 10) || null;
  const happened = ["home", "away"].some((side) =>
    (sides[side]?.starters || []).some((p) => p.goals.length || p.ownGoals.length || p.cards.length || p.off),
  );
  return (
    <section className={`card ${s.panel}`} data-lineups={before ? "before" : "played"}>
      {before ? (
        <SidesHead match={match} sides={sides} bubble={bubble} />
      ) : (
        <div className={s.lineupHead}>
          <h3>
            {match.home.name} <span className={s.muted}>{sides.home?.formation || ""}</span> · {match.away.name}{" "}
            <span className={s.muted}>{sides.away?.formation || ""}</span>
          </h3>
          {happened && (
            <div className={s.legend}>
              <span>⚽ but</span>
              <span>
                <i className={`${s.cardIcon} ${s.yellow}`} /> carton
              </span>
              <span className={s.off}>▼ sorti</span>
            </div>
          )}
        </div>
      )}
      <div className={o.lineups}>
        <div className={o.pitchCol}>
          <div className={`${s.pitch} ${standing ? s.pitchStanding : ""}`} data-lineup-pitch="">
            <PitchLines standing={standing} />
            {["home", "away"].flatMap((side) =>
              (sides[side]?.starters || [])
                .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
                .map((p) => (
                  <Marker
                    key={`${side}:${p.id || p.name}`}
                    p={p}
                    side={side}
                    standing={standing}
                    bubble={bubble}
                    row={byId.get(p.id)}
                    basis={sides[side]?.basis}
                    onOpen={open}
                  />
                )),
            )}
          </div>
        </div>
        <div className={o.benches}>
          <SideBench side="home" team={match.home} data={sides.home} before={before} asOf={asOf} onOpen={open} />
          <SideBench side="away" team={match.away} data={sides.away} before={before} asOf={asOf} onOpen={open} />
        </div>
      </div>
      {bubble.bubble}
    </section>
  );
}
