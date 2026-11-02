import React from "react";
import Icon from "./Icon.jsx";
import { isNumber } from "../services/format.js";
import { statPercentage, statValue } from "../services/match-data.js";
/** Two-team comparison rows shared by the match overview and its context. */
const SHARE_KEYS = new Set(["BallPossesion"]);
export function StatRow({ match, stat: s }) {
  const home = s.home ?? s.homeValue,
    away = s.away ?? s.awayValue;
  const valid =
    s.reliable !== false &&
    isNumber(home) &&
    isNumber(away) &&
    home >= 0 &&
    away >= 0 &&
    home + away > 0;
  const share = SHARE_KEYS.has(s.key),
    max = Math.max(home, away),
    better = s.lowerIsBetter ? (a, b) => a < b : (a, b) => a > b,
    lead = !valid
      ? null
      : better(home, away)
        ? "home"
        : better(away, home)
          ? "away"
          : "both";
  const value = (side) => (
    <dd
      className={`stat-value ${side}${lead === side || lead === "both" ? " is-lead" : ""}`}
      aria-label={`${match[side].name} : ${statValue(s, side)}${statPercentage(s, side) ? ` (${statPercentage(s, side)})` : ""}`}
    >
      {side === "away" && statPercentage(s, side) && (
        <small>{statPercentage(s, side)}</small>
      )}
      {statValue(s, side)}
      {side === "home" && statPercentage(s, side) && (
        <small>{statPercentage(s, side)}</small>
      )}
    </dd>
  );
  return (
    <div className={`stat-row${share ? " is-share" : ""}`}>
      <dt>
        {s.label}
        {s.reliable === false && (
          <span title="Valeur signalée comme non fiable">
            <Icon name="info" />
          </span>
        )}
      </dt>
      {value("home")}
      {value("away")}
      <dd className={`stat-bars${valid ? "" : " is-empty"}`} aria-hidden="true">
        {share ? (
          <span className="stat-track">
            <i
              className="home"
              style={{ width: valid ? `${(home / (home + away)) * 100}%` : 0 }}
            />
            <i
              className="away"
              style={{ width: valid ? `${(away / (home + away)) * 100}%` : 0 }}
            />
          </span>
        ) : (
          ["home", "away"].map((side) => (
            <span className={`stat-track ${side}`} key={side}>
              <i
                className={
                  lead && lead !== side && lead !== "both" ? "is-trailing" : ""
                }
                style={{
                  width: valid
                    ? `${((side === "home" ? home : away) / max) * 100}%`
                    : 0,
                }}
              />
            </span>
          ))
        )}
      </dd>
    </div>
  );
}
export function StatRows({ match, stats }) {
  return (
    <div className="comparison-stats">
      <div className="comparison-teams">
        <span>
          <i className="team-dot home" />
          {match.home.name}
        </span>
        <span>
          <i className="team-dot away" />
          {match.away.name}
        </span>
      </div>
      <dl className="stat-rows">
        {stats.map((s, i) => (
          <StatRow key={`${s.key}:${i}`} match={match} stat={s} />
        ))}
      </dl>
    </div>
  );
}
