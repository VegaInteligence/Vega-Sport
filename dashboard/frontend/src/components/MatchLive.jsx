"use client";
import React, { useMemo } from "react";
import { Card, Empty } from "./UI.jsx";
import { StatRows } from "./StatRows.jsx";
import MatchWinProbability from "./MatchWinProbability.jsx";
import useMatchSection from "../hooks/useMatchSection.js";
import { liveFeed, liveShootout, liveStatRows, liveStatus } from "../services/match-live.js";
import s from "./MatchLive.module.css";

/** Player id → name, from the two line-ups: the feed names some players by id only. */
function useLineupNames(match) {
  const lineups = useMatchSection(match, "lineups");
  return useMemo(() => {
    const names = new Map();
    for (const side of ["home", "away"])
      for (const list of ["starters", "subs"])
        for (const p of lineups.data?.[side]?.[list] || []) if (p.player_id && p.name) names.set(p.player_id, p.name);
    return names;
  }, [lineups.data]);
}

function EventIcon({ type, cancelled }) {
  if (type === "yellow_card" || type === "red_card") return <i className={`${s.cardIcon} ${type === "red_card" ? s.red : s.yellow}`} aria-hidden="true" />;
  if (type === "substitution")
    return (
      <svg className={s.icon} viewBox="0 0 16 16" aria-hidden="true">
        <path d="M5 2 1.5 6.5h2.5V10h2V6.5h2.5z" className={s.subIn} />
        <path d="M11 14l3.5-4.5H12V6h-2v3.5H7.5z" className={s.subOut} />
      </svg>
    );
  if (type === "var") return <span className={s.var} aria-hidden="true">VAR</span>;
  // A goal, or one that does not count (a penalty missed, a goal cancelled): the same ball, dimmed.
  return (
    <span className={`${s.ball}${type === "missed_penalty" || cancelled ? ` ${s.missed}` : ""}`} aria-hidden="true">
      ⚽
    </span>
  );
}

function FeedRow({ row }) {
  if (row.marker)
    return (
      <li className={s.marker} data-marker={row.marker}>
        <span>{row.label}</span>
        {row.score && <b>{row.score}</b>}
      </li>
    );
  const note = row.cancelled
    ? `${row.label} · ${row.detail}`
    : row.goal
      ? row.detail || (row.name ? "But" : null)
      : row.type === "substitution"
        ? row.detail || (row.name ? row.label : null)
        : row.name
          ? row.label
          : null;
  return (
    <li className={`${s.row} ${row.side === "away" ? s.away : s.home}${row.cancelled ? ` ${s.cancelled}` : ""}${row.goal && !row.cancelled ? ` ${s.goal}` : ""}`} data-event={row.type}>
      <span className={s.minute}>{row.minute}</span>
      <span className={s.entry}>
        <EventIcon type={row.type} cancelled={row.cancelled} />
        <span className={s.body}>
          <span className={s.what}>
            <strong>{row.name || row.label}</strong>
            {row.score && <b className={s.score}>{row.score}</b>}
          </span>
          {note && <small>{note}</small>}
        </span>
      </span>
    </li>
  );
}

function Shootout({ shootout, match }) {
  const side = (key) => (
    <div>
      <span className={s.shootTeam}>{match[key].name}</span>
      <ol>
        {shootout[key].map((k) => (
          <li key={k.seq} className={k.scored ? s.scored : s.missedKick} title={k.name || undefined}>
            <span className="sr-only">{`${k.name || "Tireur"} : ${k.scored ? "marqué" : "manqué"}`}</span>
          </li>
        ))}
      </ol>
    </div>
  );
  return (
    <Card title="Tirs au but" action={<b className={s.shootScore}>{shootout.score}</b>}>
      <div className={s.shootout}>
        {side("home")}
        {side("away")}
      </div>
    </Card>
  );
}

/**
 * A match while it is played: the feed's events as they come, the chances of each result
 * carried on with them, and the feed's team statistics. `live`: the state of
 * hooks/useLiveMatch.js (the page reads it once, for its scoreboard too).
 */
export default function MatchLive({ match, live }) {
  const names = useLineupNames(match);
  const feed = useMemo(() => liveFeed(live, match, names), [live, match, names]);
  const stats = liveStatRows(live, match);
  const shootout = liveShootout(live, match, names);
  const status = liveStatus(live);
  if (!status) return null;
  return (
    <div className={s.live} data-live-view="">
      <Card
        title="Fil du match"
        className={s.feedCard}
        action={
          <span className={`${s.state} ${s[status.tone]}`}>
            <i aria-hidden="true" />
            {status.clock}
            {status.period && <em>{status.period}</em>}
          </span>
        }
      >
        <ol className={s.feed} aria-live="polite" aria-label="Fil du match, du plus récent au plus ancien">
          {feed.map((row) => (
            <FeedRow key={row.marker || row.seq} row={row} />
          ))}
        </ol>
      </Card>
      <div className={s.side}>
        {shootout && <Shootout shootout={shootout} match={match} />}
        <MatchWinProbability match={match} live={live} />
        <Card title="Statistiques">{stats ? <StatRows match={match} stats={stats} /> : <Empty>Statistiques non reçues.</Empty>}</Card>
      </div>
    </div>
  );
}
