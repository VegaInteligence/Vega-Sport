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
