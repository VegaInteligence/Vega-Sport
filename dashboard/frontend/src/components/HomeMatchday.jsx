"use client";
import Link from "next/link";
import React, { useId } from "react";
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
  FormDots,
  Kicker,
  lastName,
  matchHref,
  ordinal,
  shortDay,
} from "./HomeCommon.jsx";

/** Scores of the week, newest day first, each with the share of expected goals. */
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
                competition = competitions.get(leagueOf(m));
              return (
                <Link
                  key={m.id}
                  className="home-tick"
                  href={matchHref(f, m)}
                  prefetch={false}
                >
                  <span className="home-tick-top">
                    <span>
                      {shortCompetition(
                        leagueOf(m),
                        competition?.name || m.league,
                      )}
                    </span>
                    <span>Terminé</span>
                  </span>
                  {[m.home, m.away].map((team, i) => {
                    const other = i ? m.home : m.away;
                    return (
                      <span
                        key={i}
                        className={`home-tick-team${team.score < other.score ? " is-lost" : ""}`}
                      >
                        <Media
                          name={team.name}
                          url={team.imageUrl}
                          className="crest home-crest-xs"
                        />
                        <span>{team.name}</span>
                        <b>{team.score}</b>
                      </span>
                    );
                  })}
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
              );
            })}
        </React.Fragment>
      ))}
    </nav>
  );
}

function XgRace({ match }) {
  const id = useId().replace(/:/g, "");
  const { lines, total, goals, end } = xgTimeline(match);
  const W = 560,
    H = 215,
    P = { l: 30, r: 12, t: 18, b: 22 };
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
  return (
    <svg
      className="home-xg-race"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`xG cumulés : ${match.home.name} ${number(total.home, 2)}, ${match.away.name} ${number(total.away, 2)}`}
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
      {goals.map((g, i) => {
        const x = X(g.minute),
          y = Y(g.xg);
        return (
          <g key={i}>
            <circle
              cx={x}
              cy={y}
              r="5"
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
  );
}
function ShotMap({ match }) {
  const points = shotMapPoints(match);
  return (
    <svg
      className="home-shot-map"
      viewBox="-1 -1 107 70"
      role="img"
      aria-label={`Carte des ${points.length} tirs du match`}
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
      {points.map((s, i) => (
        <circle
          key={i}
          cx={s.x}
          cy={s.y}
          r={Math.min(3.6, 1.1 + Math.sqrt(s.xg) * 3.2)}
          className={`home-shot home-shot-${s.side}${s.goal ? " is-goal" : ""}`}
        >
          <title>{`${s.player} · ${s.minute}′ · ${number(s.xg, 2)} xG${s.goal ? " · but" : ""}`}</title>
        </circle>
      ))}
    </svg>
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
  const goals = xgTimeline(match).goals;
  const scorers = (side) =>
    goals
      .filter((g) => g.side === side)
      .map(
        (g) => `${lastName(g.player)} ${g.minute}′${g.ownGoal ? " (csc)" : ""}`,
      )
      .join(" · ");
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
        <div
          className="home-score-value"
          aria-label={`Score ${h.score} à ${a.score}`}
        >
          {h.score}
          <i>–</i>
          {a.score}
        </div>
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
            <XgRace match={match} />
          </figure>
          <figure>
            <figcaption>
              <span>Carte des tirs</span>
              <span className="home-legend">
                <span>● but</span>
                <span>○ tir · taille = xG</span>
              </span>
            </figcaption>
            <ShotMap match={match} />
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
