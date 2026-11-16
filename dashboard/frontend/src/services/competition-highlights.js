import { orderCompetitionMatches } from "./competition-matches.js";
import { parisDay, validDay } from "./fixtures.js";

export function highlightTeam(match, side) {
  return match?.[side + "_team"] || match?.[side] || null;
}

export function highlightScore(match, side) {
  return match?.["score_" + side] ?? match?.[side]?.score ?? null;
}

/** Only offset-bearing timestamps have an unambiguous kickoff time. */
export function highlightKickoff(match) {
  const timestamp = match?.time_utc || match?.timeUtc;
  if (typeof timestamp !== "string" || !/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(timestamp)) return null;
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : null;
}

function validScore(value) {
  return Number.isInteger(value) && value >= 0;
}

function isFinished(match) {
  return match.status === "finished" || (!match.status && match.finished === true);
}

function hasScore(match) {
  return validScore(highlightScore(match, "home")) && validScore(highlightScore(match, "away"));
}

/** Return a concise overview from the selected competition and season only. */
export function competitionHighlights(matches, now = Date.now(), limit = 4) {
  const byId = new Map();
  for (const match of matches || []) {
    const home = highlightTeam(match, "home"), away = highlightTeam(match, "away");
    if (!match?.id || !home?.name || !away?.name) continue;
    const previous = byId.get(match.id);
    if (!previous || (isFinished(match) && (!isFinished(previous) || (!hasScore(previous) && hasScore(match)))))
      byId.set(match.id, match);
  }
  const unique = [...byId.values()];
  const recent = orderCompetitionMatches(unique, { status: "finished" })
    .filter(hasScore).slice(0, limit);
  const upcoming = orderCompetitionMatches(unique, { status: "not_started" })
    .filter((match) => {
      const kickoff = highlightKickoff(match);
      if (kickoff !== null) return kickoff > now;
      return validDay(match.date) && match.date >= parisDay(now);
    }).slice(0, limit);
  return { recent, upcoming };
}

/** Number of whole result rows that fit beside the standings on wide screens. */
/** How many result rows fit under the column's other cards beside the table (may be below 2). */
export function recentResultRoom({ standingsHeight, upcomingHeight, headerHeight, rowHeight, gap = 16, padding = 10 }) {
  if (![standingsHeight, upcomingHeight, headerHeight, rowHeight, gap, padding].every(Number.isFinite) || rowHeight <= 0) return null;
  return Math.floor((standingsHeight - upcomingHeight - headerHeight - gap - padding) / rowHeight);
}

export function recentResultCapacity({ max = 20, ...sizes }) {
  const room = recentResultRoom(sizes);
  if (room === null || !Number.isFinite(max)) return 5;
  // At least two results, so the column never runs below a short table (the card stretches to its foot).
  return Math.min(max, Math.max(2, room));
}

/**
 * The next matches to show beside a short table: one fewer while two results do not fit
 * under them (down to one), one more back when an upcoming row's room is free again.
 */
export function nextUpcomingLimit({ limit, room, upcomingRow, resultRow, most = 4 }) {
  if (room === null || !(upcomingRow > 0) || !(resultRow > 0)) return limit;
  if (room < 2 && limit > 1) return limit - 1;
  if (limit < most && room >= 2 + Math.ceil(upcomingRow / resultRow)) return limit + 1;
  return limit;
}
