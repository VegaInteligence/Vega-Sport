import { clubMatchHistory } from "./club-matches.js";

const finished = (match) =>
  match.status === "finished" || (!match.status && match.finished === true);

/** Use the scoped player rows and the team's recorded calendar. */
export function playerPlayingTime(calendar, rows, teamId, filters = {}) {
  if (!calendar || !teamId) return null;
  const { from, to, league, leagues, competition = "all", matchId } = filters;
  const leagueIds = new Set(leagues);
  const games = clubMatchHistory(
    (calendar.matches || []).filter(finished),
    calendar.fixtures,
    teamId,
  ).filter(
    (game) =>
      (!matchId || matchId === "all" || game.id === matchId) &&
      (!league || league === "all" || game.leagueId === league) &&
      (!leagueIds.size || leagueIds.has(game.leagueId)) &&
      (competition === "all" || game.league === competition),
  );
  const dated = games.filter((game) => {
    const day = game.date?.slice(0, 10);
    return (!from || (day && day >= from)) && (!to || (day && day <= to));
  });
  if (!dated.length) return null;

  const scheduled = new Set(
    [...(calendar.matches || []), ...(calendar.fixtures || [])].map(
      (game) => game.id,
    ),
  );
  const byMatch = new Map();
  let missingMatch = false;
  for (const row of rows) {
    if (row.teamId !== teamId || !row.matchId) continue;
    const previous = byMatch.get(row.matchId);
    const minutes =
      Number.isFinite(row.minutes) &&
      row.minutes >= 0 &&
      row.statsReliable !== false
        ? row.minutes
        : null;
    if (minutes > 0 && !scheduled.has(row.matchId)) missingMatch = true;
    if (previous == null) byMatch.set(row.matchId, minutes);
    else if (minutes != null && previous !== minutes)
      byMatch.set(row.matchId, NaN);
  }

  let minutes = 0;
  let covered = 0;
  for (const game of dated) {
    if (byMatch.has(game.id)) {
      const played = byMatch.get(game.id);
      // A recorded duration above 90 cannot be compared to a 90-minute game.
      if (!Number.isFinite(played) || played > 90) continue;
      minutes += played;
    } else {
      const side = game.home?.id === teamId ? game.home : game.away;
      const coverage = game.coverage;
      if (
        side?.lineupConfirmed !== true ||
        coverage?.players !== true ||
        coverage?.playerStats !== true ||
        !(coverage.playedPlayers >= 22)
      )
        continue;
    }
    covered++;
  }

  const matches = dated.length;
  const totalMinutes = 90 * matches;
  const incompleteCalendar =
    missingMatch || Boolean((from || to) && games.some((game) => !game.date));
  return {
    minutes,
    totalMinutes,
    covered,
    matches,
    incompleteCalendar,
    percentage:
      covered === matches && !incompleteCalendar
        ? (100 * minutes) / totalMinutes
        : null,
  };
}
