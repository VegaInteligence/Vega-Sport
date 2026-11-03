"use client";
import Link from "next/link";
import React, { useId, useState } from "react";
import Icon from "./Icon.jsx";
import { Media } from "./UI.jsx";
import { useFootball } from "../hooks/FootballContext.jsx";
import { number } from "../services/format.js";
import {
  leagueOf,
  matchWeight,
  shortCompetition,
  shotMapPoints,
  xgTimeline,
} from "../services/home-insights.js";
import {
  ChartTip,
  FormDots,
  Kicker,
  lastName,
  matchHref,
  openPerformance,
  ordinal,
  shortDay,
} from "./HomeCommon.jsx";

/** Scores of the week, newest day first: each club opens its page, the score opens the match. */
export function HomeTicker({ results, ranks, competitions }) {
  const f = useFootball();
  const byDay = new Map();
  for (const match of results) {
    const day = match.date.slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(match);
  }
  const days = [...byDay.keys()].sort().reverse().slice(0, 4);
  if (!days.length) return null;
  return (
    <nav className="home-ticker" aria-label="Résultats de la semaine">
      {days.map((day) => (
        <React.Fragment key={day}>
          <span className="home-ticker-day">{shortDay(day)}</span>
          {byDay
            .get(day)
            .sort((a, b) => matchWeight(b, ranks) - matchWeight(a, ranks))
            .slice(0, 8)
            .map((m) => {
              const hx = Number.isFinite(m.home.xg) ? m.home.xg : null,
                ax = Number.isFinite(m.away.xg) ? m.away.xg : null,
                total = (hx || 0) + (ax || 0),
                competition = competitions.get(leagueOf(m)),
                href = matchHref(f, m);
              return (
                <div key={m.id} className="home-tick">
                  <Link className="home-tick-top" href={href} prefetch={false}>
                    <span>
                      {shortCompetition(
                        leagueOf(m),
                        competition?.name || m.league,
                      )}
                    </span>
                    <span>Terminé</span>
                  </Link>
                  {[m.home, m.away].map((team, i) => {
                    const other = i ? m.home : m.away;
                    return (
                      <Link
                        key={i}
                        className={`home-tick-team${team.score < other.score ? " is-lost" : ""}`}
                        href={f.href("/clubs/", { id: team.id })}
                        prefetch={false}
                      >
                        <Media
                          name={team.name}
                          url={team.imageUrl}
                          className="crest home-crest-xs"
                        />
                        <span>{team.name}</span>
                        <b>{team.score}</b>
                      </Link>
                    );
                  })}
                  <Link
                    className="home-tick-foot"
                    href={href}
                    prefetch={false}
                    aria-label={`Voir ${m.home.name} – ${m.away.name}`}
                  >
                    {total > 0 && (
                      <>
                        <span className="home-tick-xg" aria-hidden="true">
                          <i style={{ width: `${(hx / total) * 100}%` }} />
                          <i style={{ width: `${(ax / total) * 100}%` }} />
                        </span>
                        <span className="home-tick-cap">
                          <span>{number(hx, 2)} xG</span>
                          <span>{number(ax, 2)}</span>
                        </span>
                      </>
                    )}
                  </Link>
                </div>
              );
            })}
        </React.Fragment>
      ))}
    </nav>
  );
}

const W = 560,
  H = 215,
  P = { l: 30, r: 12, t: 18, b: 22 };
/** Expected goals over the match; hovering follows the minute and the nearest shot. */
function XgRace({ match, timeline, active, onActive }) {
  const id = useId().replace(/:/g, "");
  const [hover, setHover] = useState(null);
  const { lines, total, goals, events, end } = timeline;
  const top = Math.max(1, total.home, total.away) * 1.15;
  const X = (m) => P.l + (m / end) * (W - P.l - P.r),
    Y = (v) => H - P.b - (v / top) * (H - P.t - P.b);
  const path = (pts) =>
    pts
      .map(
        (p, i) => `${i ? "L" : "M"}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`,
      )
      .join("");
  const area = (pts) =>
    `${path(pts)}L${X(end).toFixed(1)},${Y(0)}L${X(0)},${Y(0)}Z`;
  const ticks = [0, 1, 2, 3, 4, 5, 6].filter((v) => v <= top);
  const valueAt = (side, minute) => {
    let value = 0;
    for (const [m, v] of lines[side]) if (m <= minute) value = v;
    return value;
  };
  function move(event) {
    const rect = event.currentTarget.getBoundingClientRect(),
      vx = ((event.clientX - rect.left) / rect.width) * W,
      minute = Math.max(0, Math.min(end, ((vx - P.l) / (W - P.l - P.r)) * end));
    const near = events.reduce(
      (best, e) =>
        Math.abs(e.minute - minute) <= 2.5 &&
        (!best || Math.abs(e.minute - minute) < Math.abs(best.minute - minute))
          ? e
          : best,
      null,
    );
    setHover({ minute: near ? near.minute : Math.round(minute), shot: near });
    onActive(near?.id || null);
  }
  const shown =
    hover ||
    (active && events.some((e) => e.id === active)
      ? {
          minute: events.find((e) => e.id === active).minute,
          shot: events.find((e) => e.id === active),
        }
      : null);
  const goalOf = (shot) => goals.find((g) => g.shotId && g.shotId === shot?.id);
  return (
    <div className="home-viz">
      <svg
        className="home-xg-race"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`xG cumulés : ${match.home.name} ${number(total.home, 2)}, ${match.away.name} ${number(total.away, 2)}`}
        onPointerMove={move}
        onPointerLeave={() => {
          setHover(null);
          onActive(null);
        }}
      >
        <defs>
          <linearGradient id={`${id}h`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--home)" stopOpacity=".3" />
            <stop offset="1" stopColor="var(--home)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`${id}a`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--away)" stopOpacity=".24" />
            <stop offset="1" stopColor="var(--away)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <rect x="0" y="0" width={W} height={H} fill="transparent" />
        {ticks.map((v) => (
          <g key={v}>
            <line
              x1={P.l}
              x2={W - P.r}
              y1={Y(v)}
              y2={Y(v)}
              className="home-grid"
            />
            <text
              x={P.l - 8}
              y={Y(v) + 3.5}
              textAnchor="end"
              className="home-axis"
            >
              {v}
            </text>
          </g>
        ))}
        {[0, 15, 30, 45, 60, 75, 90].map((m) => (
          <text
            key={m}
            x={X(m)}
            y={H - 6}
            textAnchor="middle"
            className="home-axis"
          >
            {m}′
          </text>
        ))}
        <line
          x1={X(45)}
          x2={X(45)}
          y1={P.t}
          y2={H - P.b}
          className="home-grid home-grid-dash"
        />
        <path d={area(lines.home)} fill={`url(#${id}h)`} />
        <path d={area(lines.away)} fill={`url(#${id}a)`} />
        <path d={path(lines.home)} className="home-line home-line-home" />
        <path d={path(lines.away)} className="home-line home-line-away" />
        {events.map((e) => (
          <circle
            key={e.id || e.minute + e.side}
            cx={X(e.minute)}
            cy={Y(e.total)}
            r={e.id === shown?.shot?.id ? 4 : 2}
            className={`home-shot-tick home-goal-${e.side}`}
          />
        ))}
        {shown && (
          <line
            x1={X(shown.minute)}
            x2={X(shown.minute)}
            y1={P.t}
            y2={H - P.b}
            className="home-guide"
          />
        )}
        {goals.map((g, i) => {
          const x = X(g.minute),
            y = Y(g.xg);
          return (
            <g key={i}>
              <circle
                cx={x}
                cy={y}
                r={g.shotId && g.shotId === shown?.shot?.id ? 6.5 : 5}
                className={`home-goal-dot home-goal-${g.side}`}
              />
              <text
                x={x}
                y={y - 9}
                textAnchor={x > W - 80 ? "end" : x < 70 ? "start" : "middle"}
                className="home-goal-label"
              >
                {lastName(g.player)} {g.minute}′
                {g.ownGoal ? " (csc)" : g.penalty ? " (p)" : ""}
              </text>
            </g>
          );
        })}
      </svg>
      {shown && (
        <ChartTip
          x={(X(shown.minute) / W) * 100}
          y={
            (Y(
              shown.shot
                ? shown.shot.total
                : Math.max(
                    valueAt("home", shown.minute),
                    valueAt("away", shown.minute),
                  ),
            ) /
              H) *
            100
          }
        >
          <b>{shown.minute}′</b>
          <span className="home-tip-row">
            <i className="is-home" />
            {match.home.name}
            <b>{number(valueAt("home", shown.minute), 2)} xG</b>
          </span>
          <span className="home-tip-row">
            <i className="is-away" />
            {match.away.name}
            <b>{number(valueAt("away", shown.minute), 2)} xG</b>
          </span>
          {shown.shot && (
            <span className="home-tip-shot">
              {goalOf(shown.shot) ? "But" : "Tir"} de <b>{shown.shot.player}</b>{" "}
              · {number(shown.shot.xg, 2)} xG · {shown.shot.outcome}
            </span>
          )}
        </ChartTip>
      )}
    </div>
  );
}

/** Every shot on one pitch; hover for the shooter and the chance, click for his match card. */
function ShotMap({ match, active, onActive }) {
  const f = useFootball();
  const points = shotMapPoints(match);
  const shown = points.find((s) => s.id && s.id === active);
  return (
    <div className="home-viz">
      <svg
        className="home-shot-map"
        viewBox="-1 -1 107 70"
        role="img"
        aria-label={`Carte des ${points.length} tirs du match`}
        onPointerLeave={() => onActive(null)}
      >
        <g className="home-pitch">
          <rect x="0" y="0" width="105" height="68" rx="1.5" />
          <line x1="52.5" y1="0" x2="52.5" y2="68" />
          <circle cx="52.5" cy="34" r="9.15" />
          <rect x="0" y="13.85" width="16.5" height="40.3" />
          <rect x="88.5" y="13.85" width="16.5" height="40.3" />
          <rect x="0" y="24.85" width="5.5" height="18.3" />
          <rect x="99.5" y="24.85" width="5.5" height="18.3" />
        </g>
        {points.map((s, i) => {
          const r = Math.min(3.6, 1.1 + Math.sqrt(s.xg) * 3.2),
            on = s.id && s.id === active;
          return (
            <g
              key={s.id || i}
              className="home-shot-hit"
              onPointerEnter={() => onActive(s.id)}
              onClick={() => openPerformance(f, match.id, s.playerId)}
            >
              <circle
                cx={s.x}
                cy={s.y}
                r={Math.max(r, 2.6)}
                fill="transparent"
              />
              <circle
                cx={s.x}
                cy={s.y}
                r={on ? r + 0.8 : r}
                className={`home-shot home-shot-${s.side}${s.goal ? " is-goal" : ""}${on ? " is-active" : ""}`}
              />
            </g>
          );
        })}
      </svg>
      {shown && (
        <ChartTip
          x={((shown.x + 1) / 107) * 100}
          y={((shown.y + 1) / 70) * 100}
        >
          <b>{shown.player}</b>
          <span>
            {shown.minute}′ · {number(shown.xg, 2)} xG
            {shown.body ? ` · ${shown.body}` : ""}
          </span>
          <span>
            {shown.situation ? `${shown.situation} · ` : ""}
            <b>{shown.outcome}</b>
          </span>
        </ChartTip>
      )}
    </div>
  );
}

function StatBar({ label, home, away, format = (v) => number(v) }) {
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
  const total = home + away || 1;
  return (
    <div className="home-stat-bar">
      <b>{format(home)}</b>
      <span className="home-stat-track is-home">
        <i style={{ width: `${(home / total) * 100}%` }} />
      </span>
      <span>{label}</span>
      <span className="home-stat-track is-away">
        <i style={{ width: `${(away / total) * 100}%` }} />
      </span>
      <b>{format(away)}</b>
    </div>
  );
}
function verdict(match) {
  const h = match.home,
    a = match.away;
  if (!Number.isFinite(h.xg) || !Number.isFinite(a.xg)) return null;
  const leader = h.xg > a.xg ? h : a,
    other = leader === h ? a : h,
    gap = Math.abs(h.xg - a.xg);
  if (gap >= 1.2 && leader.score <= other.score)
    return (
      <>
        <b>{leader.name}</b> a créé {number(leader.xg, 1)} xG contre{" "}
        {number(other.xg, 1)}, mais{" "}
        {leader.score === other.score ? "repart avec un nul" : "s’incline"}.
      </>
    );
  if (gap >= 1.2)
    return (
      <>
        <b>{leader.name}</b> a dominé les occasions : {number(leader.xg, 1)} xG
        contre {number(other.xg, 1)}.
      </>
    );
  return (
    <>
      Match équilibré dans les occasions : {number(h.xg, 1)} xG contre{" "}
      {number(a.xg, 1)}.
    </>
  );
}

/** The match of the week told by its data: score, expected goals over time, shots and key figures. */
export function MatchOfTheWeek({ match, ranks, competition, bestPlayer }) {
  const f = useFootball(),
    h = match.home,
    a = match.away;
  const [active, setActive] = useState(null);
  const timeline = xgTimeline(match);
  const scorers = (side) =>
    timeline.goals
      .filter((g) => g.side === side)
      .map((g, i) => (
        <React.Fragment key={i}>
          {i > 0 && " · "}
          <button
            type="button"
            className={`home-scorer${g.shotId && g.shotId === active ? " is-active" : ""}`}
            onPointerEnter={() => setActive(g.shotId || null)}
            onPointerLeave={() => setActive(null)}
            onFocus={() => setActive(g.shotId || null)}
            onBlur={() => setActive(null)}
            onClick={() => openPerformance(f, match.id, g.playerId)}
          >
            {lastName(g.player)} {g.minute}′
            {g.ownGoal ? " (csc)" : g.penalty ? " (p)" : ""}
          </button>
        </React.Fragment>
      ));
  const team = (t, side) => {
    const rank = ranks.get(t.id);
    return (
      <Link
        className={`home-match-side is-${side}`}
        href={f.href("/clubs/", { id: t.id })}
        prefetch={false}
      >
        <Media name={t.name} url={t.imageUrl} className="crest home-crest-lg" />
        <span>
          <strong>{t.name}</strong>
          {rank && (
            <small>
              {ordinal(rank.rank)} · <FormDots form={rank.form} />
            </small>
          )}
        </span>
      </Link>
    );
  };
  const hasShots = match.shots?.some((s) => Number.isFinite(s.xg));
  const text = verdict(match);
  return (
    <article className="card home-motw">
      <div className="home-motw-top">
        <Kicker>Le choc de la semaine</Kicker>
        <span className="home-meta">
          <Media
            name={competition?.name || match.league}
            url={competition?.imageUrl}
            className="crest home-crest-xs"
          />
          {competition?.name || match.league} · {shortDay(match.date)}
        </span>
      </div>
      <div className="home-score">
        {team(h, "home")}
        <Link
          className="home-score-value"
          href={matchHref(f, match)}
          aria-label={`Score ${h.score} à ${a.score}, voir le match`}
        >
          {h.score}
          <i>–</i>
          {a.score}
        </Link>
        {team(a, "away")}
      </div>
      <div className="home-scorers">
        <span>{scorers("home")}</span>
        <span className="home-scorers-status">Terminé</span>
        <span>{scorers("away")}</span>
      </div>
      {text && <p className="home-verdict">{text}</p>}
      {hasShots && (
        <div className="home-motw-viz">
          <figure>
            <figcaption>
              <span>xG cumulés</span>
              <span className="home-legend">
                <span>
                  <i className="is-home" />
                  {h.name}
                </span>
                <span>
                  <i className="is-away" />
                  {a.name}
                </span>
              </span>
            </figcaption>
            <XgRace
              match={match}
              timeline={timeline}
              active={active}
              onActive={setActive}
            />
          </figure>
          <figure>
            <figcaption>
              <span>Carte des tirs</span>
              <span className="home-legend">
                <span>● but</span>
                <span>○ tir · taille = xG</span>
              </span>
            </figcaption>
            <ShotMap match={match} active={active} onActive={setActive} />
          </figure>
        </div>
      )}
      <div className="home-motw-foot">
        <div className="home-stat-bars">
          <StatBar
            label="Possession"
            home={h.possession}
            away={a.possession}
            format={(v) => `${number(v)} %`}
          />
          <StatBar label="Tirs" home={h.shots} away={a.shots} />
          <StatBar
            label="Cadrés"
            home={h.shotsOnTarget}
            away={a.shotsOnTarget}
          />
          <StatBar
            label="xG"
            home={h.xg}
            away={a.xg}
            format={(v) => number(v, 2)}
          />
          {[
            ["big_chance", "Grosses occasions"],
            ["duel_won", "Duels gagnés"],
            ["corners", "Corners"],
            ["keeper_saves", "Arrêts"],
          ].map(([key, label]) => {
            const stat = match.stats?.find((s) => s.key === key);
            return stat ? (
              <StatBar
                key={key}
                label={label}
                home={stat.home}
                away={stat.away}
              />
            ) : null;
          })}
        </div>
        <div className="home-motw-actions">
          {bestPlayer && (
            <button
              type="button"
              className="home-motm"
              onClick={() => f.setPlayer(bestPlayer.id)}
            >
              <Media
                name={bestPlayer.name}
                url={bestPlayer.imageUrl}
                className="player-avatar"
              />
              <span>
                <small>Meilleure note du match</small>
                <strong>{bestPlayer.name}</strong>
                <span>{bestPlayer.team}</span>
              </span>
              <b>{number(bestPlayer.rating, 2)}</b>
            </button>
          )}
          <Link className="button button-primary" href={matchHref(f, match)}>
            Analyse complète du match <Icon name="arrow" />
          </Link>
        </div>
      </div>
    </article>
  );
}

export function NumberOfTheWeek({ win, competition }) {
  const f = useFootball();
  if (!win) return null;
  const m = win.match;
  return (
    <Link className="card home-number" href={matchHref(f, m)} prefetch={false}>
      <span className="home-number-value">{win.margin}</span>
      <span>
        <Kicker>Le chiffre de la semaine</Kicker>
        <span className="home-number-copy">
          buts d’écart :{" "}
          <b>
            {m.home.name} {m.home.score}–{m.away.score} {m.away.name}
          </b>
          {competition?.name ? ` en ${competition.name}` : ""}. Le plus large
          score de la semaine.
        </span>
      </span>
    </Link>
  );
}
