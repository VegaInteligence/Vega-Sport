"use client";
/* The « Compositions » tab: one pitch with both teams facing each other, every starter with his
 * photo, number, Vega grade, goals, cards and the minute he went off (hovered: his match in a
 * few figures; clicked: his performance of the match); beside it (under it on narrower screens),
 * each side's coach, substitutes with the minute they came on and whom they replaced, then those
 * who stayed on the bench, each opening his performance too. On a phone the pitch stands up. */
import React, { useEffect, useMemo, useState } from "react";
import { Empty, Media, Skeleton } from "./UI.jsx";
import { useHoverBubble } from "./HoverCard.jsx";
import { useFootball } from "../hooks/FootballContext.jsx";
import useMatchSection from "../hooks/useMatchSection.js";
import { useMatchGrades } from "../services/match-grades.js";
import { lineupView, playerRows } from "../services/match-tabs.js";
import { number } from "../services/format.js";
import { GRADE_HIGH } from "../services/grades.js";
import s from "./MatchTabs.module.css";
import o from "./MatchPlayerOpen.module.css";

const shortName = (name) => {
  const parts = String(name || "").trim().split(/\s+/);
  return parts.length > 1 && parts.at(-1).length > 2 ? parts.at(-1) : name;
};
const gradeTone = (grade) => (grade == null ? "" : grade >= GRADE_HIGH ? s.gradeHigh : grade < 45 ? s.gradeLow : "");

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

function Marker({ p, side, standing, bubble, row, onOpen }) {
  const at = spot(p, side, standing);
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
    onMouseEnter: (event) => bubble.show(event.currentTarget, <PlayerLine p={p} row={row} />),
    onMouseLeave: bubble.hide,
    onFocus: (event) => bubble.show(event.currentTarget, <PlayerLine p={p} row={row} />),
    onBlur: bubble.hide,
  };
  return p.id ? (
    <button
      type="button"
      className={`${s.marker} ${o.marker}`}
      style={style}
      aria-label={`${p.name}${p.shirt ? `, n° ${p.shirt}` : ""}`}
      onClick={() => {
        bubble.hide();
        onOpen(p.id);
      }}
      {...hover}
    >
      {body}
    </button>
  ) : (
    <span className={s.marker} style={style}>
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

function SideBench({ side, team, data, onOpen }) {
  if (!data) return <p className={o.none}>Composition absente : {team?.name || side}</p>;
  return (
    <section className={`${o.bench} ${side === "away" ? o.away : ""}`} aria-label={`Banc de ${team?.name || side}`}>
      <div className={o.benchHead}>
        <Media name={team?.name} url={data.team?.image_url || team?.imageUrl} size={20} kind="club" />
        <h3>{team?.name}</h3>
        {data.formation && <strong>{data.formation}</strong>}
      </div>
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
          <div className={o.chips}>
            {data.bench.map((p) => {
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
        </>
      )}
    </section>
  );
}

export default function MatchLineups({ match }) {
  const f = useFootball();
  const lineups = useMatchSection(match, "lineups");
  const events = useMatchSection(match, "events");
  const players = useMatchSection(match, "players");
  const grades = useMatchGrades(match.id);
  const standing = useStanding();
  const bubble = useHoverBubble({ width: 280 });
  const rows = useMemo(() => playerRows(players.data), [players.data]);
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const view = useMemo(() => lineupView(lineups.data, events.data?.events, rows, grades), [lineups.data, events.data, rows, grades]);
  if (lineups.loading && !lineups.data) return <Skeleton label="Chargement des compositions…" lines={4} />;
  if (!lineups.data || (!view.home && !view.away)) return <Empty>Compositions non renseignées.</Empty>;
  const open = (id) => f.setPlayer(`${match.id}:${id}`);
  return (
    <section className={`card ${s.panel}`}>
      <div className={s.lineupHead}>
        <h3>
          {match.home.name} <span className={s.muted}>{view.home?.formation || ""}</span> · {match.away.name}{" "}
          <span className={s.muted}>{view.away?.formation || ""}</span>
        </h3>
        <div className={s.legend}>
          <span>⚽ but</span>
          <span>
            <i className={`${s.cardIcon} ${s.yellow}`} /> carton
          </span>
          <span className={s.off}>▼ sorti</span>
        </div>
      </div>
      <div className={o.lineups}>
        <div className={o.pitchCol}>
          <div className={`${s.pitch} ${standing ? s.pitchStanding : ""}`}>
            <PitchLines standing={standing} />
            {["home", "away"].flatMap((side) =>
              (view[side]?.starters || [])
                .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
                .map((p) => (
                  <Marker key={`${side}:${p.id || p.name}`} p={p} side={side} standing={standing} bubble={bubble} row={byId.get(p.id)} onOpen={open} />
                )),
            )}
          </div>
        </div>
        <div className={o.benches}>
          <SideBench side="home" team={match.home} data={view.home} onOpen={open} />
          <SideBench side="away" team={match.away} data={view.away} onOpen={open} />
        </div>
      </div>
      {bubble.bubble}
    </section>
  );
}
