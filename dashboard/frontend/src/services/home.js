import { parisDay, shiftDay, validDay } from "./fixtures.js";

export const RECENT_MATCH_DAYS = 14;
export const RECENT_PERFORMANCE_DAYS = 30;

// An empty selection means that every competition is followed.
export function followedRecords(records, favoriteLeagueIds) {
  if (!favoriteLeagueIds?.length) return records;
  const favorites = new Set(favoriteLeagueIds);
  return records.filter((record) => favorites.has(record.leagueId));
}

export function recentRecords(records, now, days) {
  const today = parisDay(now),
    first = shiftDay(today, 1 - days);
  return records.filter((record) => {
    const day = typeof record.date === "string" ? record.date.slice(0, 10) : "";
    return validDay(day) && day >= first && day <= today;
  });
}

export function recentFinishedMatches(matches, now) {
  return recentRecords(matches, now, RECENT_MATCH_DAYS).filter(
    (match) =>
      match.finished !== false &&
      match.home?.score != null &&
      match.away?.score != null,
  );
}
