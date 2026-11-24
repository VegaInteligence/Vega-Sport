import React from "react";
import { parisDay } from "../services/fixtures.js";

export const ordinal = (n) => (n === 1 ? "1er" : `${n}e`);
export const lastName = (name = "") =>
  String(name).trim().split(/\s+/).at(-1) || name;
const dayFormat = new Intl.DateTimeFormat("fr-FR", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const weekdayFormat = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  timeZone: "UTC",
});
export const shortDay = (day) =>
  day ? dayFormat.format(new Date(day.slice(0, 10) + "T12:00:00Z")) : "";
/** "Aujourd’hui", "Demain" or the weekday of a kickoff, in Paris time. */
export function relativeDay(time, now) {
  const day = parisDay(time),
    today = parisDay(now),
    tomorrow = parisDay(now + 864e5);
  if (day === today) return "Aujourd’hui";
  if (day === tomorrow) return "Demain";
  return weekdayFormat.format(new Date(day + "T12:00:00Z"));
}
export function countdown(time, now) {
  const hours = Math.round((time - now) / 36e5);
  if (hours < 1) return "Bientôt";
  if (hours < 36) return `Dans ${hours} h`;
  return `Dans ${Math.round(hours / 24)} j`;
}
export function FormDots({ form = [], label = "Forme" }) {
  if (!form.length) return null;
  const words = { W: "victoire", D: "nul", L: "défaite" };
  return (
    <span
      className="home-form"
      aria-label={`${label} : ${form.map((r) => words[r]).join(", ")}`}
    >
      {form.map((r, i) => (
        <i key={i} className={`home-form-${r}`} />
      ))}
    </span>
  );
}
export function Kicker({ children, tone = "" }) {
  return (
    <span className={`home-kicker${tone ? " home-kicker-" + tone : ""}`}>
      {children}
    </span>
  );
}
export function matchHref(f, match) {
  return f.href("/matchs/", {
    tab: "results",
    id: match.id,
    competition: match.leagueId || match.league?.id || "",
    sourceSeason: match.season || "",
  });
}
export function fixtureHref(f, fixture) {
  return f.href("/matchs/", {
    id: fixture.id,
    competition: fixture.league?.id || "",
    sourceSeason: fixture.season || "",
    from: "upcoming",
    tab: "upcoming",
  });
}
/** Tooltip placed in percent of its positioned parent, flipped near the edges. */
export function ChartTip({ x, y, children }) {
  if (x == null) return null;
  const side = x > 65 ? " is-left" : x < 35 ? " is-right" : "";
  return (
    <span
      className={`home-tip${side}${y < 30 ? " is-below" : ""}`}
      style={{ left: `${x}%`, top: `${y}%` }}
      role="status"
    >
      {children}
    </span>
  );
}
/** Opens the performance card of a player in a given match when it is loaded. */
export function openPerformance(f, matchId, playerId) {
  const id = `${matchId}:${playerId}`;
  if (playerId && (f.compactPerformanceAvailable || f.byAppearance.has(id)))
    f.setPlayer(id);
}
