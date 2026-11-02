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

// Clubs with broad followings, identified by stable PitchAPI IDs. The list
// includes the seven featured European leagues and can be extended centrally.
export const FEATURED_CLUB_IDS = new Set([
  "t_1gkhxH", // Arsenal
  "t_4R934X", // Chelsea
  "t_0BrMnM", // Liverpool
  "t_0UCNPX", // Manchester City
  "t_2I313i", // Manchester United
  "t_2eQl9k", // Newcastle United
  "t_4A7FfD", // Tottenham Hotspur
  "t_41iFW3", // Paris Saint-Germain
  "t_2s2eyG", // Marseille
  "t_0xMlRV", // Lyon
  "t_13gLEF", // Monaco
  "t_0tnX1I", // Lille
  "t_4NZcri", // Real Madrid
  "t_32jSEF", // Barcelona
  "t_3NIiXl", // Atlético Madrid
  "t_1cpjqO", // Bayern München
  "t_386iz1", // Borussia Dortmund
  "t_2lHR8t", // Bayer Leverkusen
  "t_4ZwKDn", // Juventus
  "t_3CPHHF", // Inter
  "t_1DYf1D", // Milan
  "t_2toJRF", // Napoli
  "t_0RhqmW", // Roma
  "t_0Mzm1V", // Benfica
  "t_0dVrhE", // FC Porto
  "t_1TAfIz", // Sporting CP
  "t_3t08JG", // Ajax
  "t_1jOgDP", // PSV Eindhoven
  "t_4KvHFN", // Feyenoord
]);
export const FEATURED_CLUB_DAYS = 7;

function featuredClubCount(match) {
  return (
    Number(FEATURED_CLUB_IDS.has(match.home?.id)) +
    Number(FEATURED_CLUB_IDS.has(match.away?.id))
  );
}

function matchTime(match) {
  const value = match.timeUtc || match.time_utc;
  const time =
    typeof value === "string" && /T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value)
      ? Date.parse(value)
      : NaN;
  return Number.isFinite(time)
    ? time
    : Date.parse(match.date.slice(0, 10) + "T00:00:00Z");
}

/** Select from the already-filtered scope, prioritising recently played major clubs. */
export function selectFeaturedMatch(matches, now) {
  const eligible = recentFinishedMatches(matches, now).filter(
    (match) => !match.status || match.status === "finished",
  );
  const highInterest = recentRecords(eligible, now, FEATURED_CLUB_DAYS).filter(
    (match) => featuredClubCount(match) > 0,
  );
  const candidates = highInterest.length ? highInterest : eligible;
  let best = null,
    bestTime = -Infinity,
    bestClubCount = 0;
  for (const match of candidates) {
    const time = matchTime(match),
      clubCount = featuredClubCount(match);
    if (
      !best ||
      time > bestTime ||
      (time === bestTime && clubCount > bestClubCount)
    ) {
      best = match;
      bestTime = time;
      bestClubCount = clubCount;
    }
  }
  return best;
}
