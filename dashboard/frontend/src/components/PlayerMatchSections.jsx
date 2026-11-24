"use client";
/* A player's match inside his performance dialog: when he played and what happened to him
 * (goals, assists, cards, his substitution), his shots on half a pitch with their xG, and where
 * he touched the ball. Read from the match's families (events, shots, heatmaps), only while the
 * dialog is open; a family that is missing or fails hides its section and nothing else. */
import React, { useMemo } from "react";
import useMatchSection from "../hooks/useMatchSection.js";
import { normalizeShots } from "./MatchSections.jsx";
import { ZonePitch } from "./MatchAnalyses.jsx";
import { number } from "../services/format.js";
import s from "./PlayerMatch.module.css";

const CARDS = { yellowcard: "yellow", yellow_card: "yellow", secondyellow: "red", second_yellow: "red", redcard: "red", red_card: "red" };
const plural = (n, word) => `${number(n)} ${word}${n > 1 ? "s" : ""}`;

/** His moments of the match, in order: goals, cards, the minute he came on or went off. */
export function playerMoments(events, playerId) {
  const out = [];
  for (const e of events || []) {
    const minute = e.minute ?? null;
    const added = e.minute_added ? `+${e.minute_added}` : "";
    const at = minute == null ? "" : `${minute}${added}′`;
    if (e.event_type === "goal" && e.player?.id === playerId)
      out.push({ minute, at, kind: e.is_own_goal ? "own" : "goal", text: e.is_own_goal ? "But contre son camp" : e.is_penalty ? "But sur penalty" : "But" });
    else if (CARDS[e.event_type] && e.player?.id === playerId)
      out.push({ minute, at, kind: CARDS[e.event_type], text: CARDS[e.event_type] === "yellow" ? "Carton jaune" : "Carton rouge" });
    else if (e.event_type === "substitution" && e.player?.id === playerId)
      out.push({ minute, at, kind: "off", text: e.sub_in_player?.name ? `Remplacé par ${e.sub_in_player.name}` : "Remplacé" });
    else if (e.event_type === "substitution" && e.sub_in_player?.id === playerId)
      out.push({ minute, at, kind: "on", text: e.player?.name ? `Entré à la place de ${e.player.name}` : "Entré en jeu" });
  }
  return out.sort((a, b) => (a.minute ?? 0) - (b.minute ?? 0));
}

const ICON = { goal: "⚽", own: "⚽", on: "▲", off: "▼" };

function Moments({ events, row }) {
  const moments = useMemo(() => playerMoments(events, row.playerId), [events, row.playerId]);
  const lastMinute = Math.max(90, ...(events || []).map((e) => e.minute || 0));
  const on = moments.find((m) => m.kind === "on")?.minute ?? (row.starter === false ? null : 0);
  const sentOff = moments.find((m) => m.kind === "red")?.minute;
  const off = moments.find((m) => m.kind === "off")?.minute ?? sentOff ?? lastMinute;
  const pct = (m) => `${Math.min(100, Math.max(0, (100 * m) / lastMinute))}%`;
  const assists = row.assists > 0 ? row.assists : 0;
  return (
    <section className={s.moments} aria-label="Son match minute par minute">
      <div className={s.timeline}>
        {on != null && <i className={s.played} style={{ left: pct(on), width: `calc(${pct(off)} - ${pct(on)})` }} />}
        <i className={s.half} />
        {moments.map((m, i) => (
          <span key={i} className={`${s.mark} ${s[m.kind] || ""}`} style={{ left: pct(m.minute ?? 0) }} title={`${m.at} ${m.text}`}>
            {ICON[m.kind] || <b />}
          </span>
        ))}
      </div>
      <div className={s.scale} aria-hidden="true">
        <span>0′</span>
        <span>45′</span>
        <span>{lastMinute}′</span>
      </div>
      {(moments.length > 0 || assists > 0) && (
        <ul className={s.momentList}>
          {moments.map((m, i) => (
            <li key={i}>
              <span className={`${s.icon} ${s[m.kind] || ""}`}>{ICON[m.kind] || <b />}</span>
              <b>{m.at}</b>
              {m.text}
            </li>
          ))}
          {assists > 0 && (
            <li>
              <span className={s.icon}>🅰</span>
              <b>{number(assists)}</b>
              {assists > 1 ? "passes décisives" : "passe décisive"}
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

// The pitch standing up, the goal he attacks at the top, 68 m wide and as deep as his
// farthest shot needs (30 m at least, half the pitch at most).
function ShotPitch({ shots, side }) {
  const color = side === "away" ? "var(--away)" : "var(--home)";
  const depth = Math.min(52.5, Math.max(30, 105 - Math.min(...shots.map((shot) => shot.x)) + 5));
  const at = (shot) => ({ cx: 68 - Math.min(68, Math.max(0, shot.y)), cy: Math.min(depth, Math.max(0, 105 - shot.x)) });
  return (
    <svg className={s.shotPitch} viewBox={`-1 -3 70 ${depth + 4}`} role="img" aria-label={`${plural(shots.length, "tir")} sur le terrain`}>
      <rect x="0" y="0" width="68" height={depth} className={s.line} />
      <rect x="13.85" y="0" width="40.3" height="16.5" className={s.line} />
      <rect x="24.85" y="0" width="18.3" height="5.5" className={s.line} />
      <rect x="30.34" y="-2" width="7.32" height="2" className={s.line} />
      <path d="M 26.7 16.5 A 9.15 9.15 0 0 0 41.3 16.5" className={s.line} />
      {depth >= 52.5 && <path d="M 24.85 52.5 A 9.15 9.15 0 0 1 43.15 52.5" className={s.line} />}
      {shots.map((shot) => {
        const r = 0.9 + Math.sqrt(Math.max(0, shot.xg || 0)) * 3.2;
        return (
          <circle
            key={shot.id}
            {...at(shot)}
            r={r}
            fill={shot.isGoal ? color : "none"}
            stroke={shot.isGoal || shot.isOnTarget ? color : "var(--muted)"}
            strokeWidth={0.45}
            fillOpacity={shot.isGoal ? 0.9 : 0}
          >
            <title>{`${shot.minute}′ · ${number(shot.xg, 2)} xG${shot.isGoal ? " · but" : shot.isOnTarget ? " · cadré" : ""}`}</title>
          </circle>
        );
      })}
    </svg>
  );
}

function Shots({ shots, side }) {
  const xg = shots.reduce((t, shot) => t + (shot.xg || 0), 0);
  const onTarget = shots.filter((shot) => shot.isOnTarget || shot.isGoal).length;
  const goals = shots.filter((shot) => shot.isGoal).length;
  return (
    <section className={s.block}>
      <h4>Tirs</h4>
      <p className={s.figures}>
        <strong>{number(xg, 2)}</strong> xG
        <span>{plural(shots.length, "tir")}</span>
        <span>{plural(onTarget, "cadré")}</span>
        {goals > 0 && <span>{plural(goals, "but")}</span>}
      </p>
      <ShotPitch shots={shots} side={side} />
    </section>
  );
}

function Zone({ map }) {
  return (
    <section className={s.block}>
      <h4>Zone d’activité</h4>
      <p className={s.figures}>
        <strong>{number(map.actions)}</strong> {map.actions > 1 ? "actions" : "action"}
      </p>
      <ZonePitch cells={map.cells} side={map.side} label={`Zone d’activité de ${map.player?.name || "ce joueur"}`} className={s.zonePitch}>
        <path d="M 304 30 H 354 M 344 22 L 354 30 L 344 38" className={s.arrow} aria-hidden="true" />
      </ZonePitch>
    </section>
  );
}

export default function PlayerMatchSections({ match, row }) {
  const subject = useMemo(() => ({ id: match?.id || row.matchId }), [match?.id, row.matchId]);
  const events = useMatchSection(subject, "events");
  const shotsFamily = useMatchSection(subject, "shots");
  const heat = useMatchSection(subject, "heatmaps");
  const shots = useMemo(
    () => (shotsFamily.data ? normalizeShots(shotsFamily.data).filter((shot) => shot.playerId === row.playerId && !shot.isOwnGoal && Number.isFinite(shot.x) && Number.isFinite(shot.y)) : []),
    [shotsFamily.data, row.playerId],
  );
  const zone = (heat.data?.players || []).find((p) => p.player?.id === row.playerId && p.cells?.length);
  const side = match?.away?.id && row.teamId === match.away.id ? "away" : zone?.side || "home";
  if (!events.data?.events && !shots.length && !zone) return null;
  // Shots and zone side by side under his moments; one of them alone sits beside them.
  const both = shots.length > 0 && zone;
  return (
    <div className={`${s.sections} ${both ? "" : s.single}`}>
      {events.data?.events && <Moments events={events.data.events} row={row} />}
      {shots.length > 0 && <Shots shots={shots} side={side} />}
      {zone && <Zone map={zone} />}
    </div>
  );
}
