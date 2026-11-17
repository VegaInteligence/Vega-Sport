import { isNumber } from "../model.js";
import { aggregateSeason, finishedAppearances } from "./season-player.js";
import { advancedTest, EMPTY_ADVANCED } from "./advanced-filters.js";

export function playerDateTest({ from = "", to = "" } = {}) {
  const test = advancedTest({ ...EMPTY_ADVANCED, from, to }, new Map());
  return (value) =>
    !test ||
    test({
      date: typeof value === "string" ? value.slice(0, 10) : undefined,
    });
}

/**
 * The publication cache stays complete; dates only narrow its displayed copy. The narrowed summary
 * counts finished matches only, their status read from the season's whole read; the narrowed read
 * keeps every observation for the logs (VI-23 stage 5, §14.2).
 */
export function playerHistoryInPeriod(history, playerId, period = {}) {
  if (!period.from && !period.to) return history;
  const inPeriod = playerDateTest(period);
  return history.map((entry) => {
    const byId = new Map(
      (entry.data?.matches || []).map((match) => [match.id, match]),
    );
    const appearances = (entry.data?.appearances || entry.profile.rows).filter(
      (row) =>
        row.playerId === playerId &&
        inPeriod(row.date || byId.get(row.matchId)?.date),
    );
    const ids = new Set(appearances.map((row) => row.matchId));
    const data = entry.data && {
      ...entry.data,
      appearances,
      matches: (entry.data.matches || []).filter(
        (match) => ids.has(match.id) || inPeriod(match.date),
      ),
      fixtures: (entry.data.fixtures || []).filter((match) =>
        inPeriod(match.date),
      ),
    };
    const summary = entry.data
      ? finishedAppearances(entry.data, appearances)
      : appearances;
    return { ...entry, data, profile: aggregateSeason(summary, playerId) };
  });
}

function groupRows(rows, keyFor) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyFor(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return groups;
}

function seasonAppearances(data, profile, playerId) {
  const rows = [...profile.rows];
  const missingMinutes = new Set(profile.unknownMatches);
  if (!missingMinutes.size) return rows;

  for (const row of data?.appearances || []) {
    if (
      row.playerId === playerId &&
      !isNumber(row.minutes) &&
      missingMinutes.delete(row.matchId)
    ) {
      rows.push(row);
      if (!missingMinutes.size) break;
    }
  }
  return rows;
}

/**
 * A season's played observations as its match log lists them, whatever the match's status: the
 * entry's read (narrowed by competition or dates), else its profile. The entry's own profile is
 * its summary, finished matches only (VI-23 stage 5, §14.2).
 */
export function playerSeasonLog(entry, playerId) {
  return entry.data
    ? aggregateSeason(entry.data.appearances || [], playerId)
    : entry.profile;
}

/**
 * Group a season by team identity, then calculate totals from its appearances: the summary's
 * (finished matches), or with `log` every played observation (PlayerMatchesPage).
 */
export function playerSeasonGroups(seasons, playerId, { log = false } = {}) {
  return seasons.flatMap((entry) => {
    const { season, data } = entry;
    const profile = log ? playerSeasonLog(entry, playerId) : entry.profile;
    const teams = new Map((data?.teams || []).map((item) => [item.id, item]));
    const competitions = new Map(
      (data?.competitions || []).map((item) => [item.id, item]),
    );
    const groups = groupRows(
      seasonAppearances(data, profile, playerId),
      (row) => row.teamId || row.team || "",
    );
    return [...groups].map(([teamKey, rows]) => {
      const first = rows[0];
      const byCompetition = groupRows(
        rows,
        (row) => row.leagueId || row.league || "",
      );
      return {
        key: JSON.stringify([season, teamKey]),
        season,
        team: teams.get(first.teamId) || {
          id: first.teamId,
          name: first.team || "Équipe inconnue",
        },
        profile: aggregateSeason(rows, playerId),
        competitions: [...byCompetition].map(([key, appearances]) => {
          const { leagueId, league } = appearances[0];
          return {
            key,
            competition: competitions.get(leagueId) || {
              id: leagueId,
              name: league || "Compétition inconnue",
            },
            profile: aggregateSeason(appearances, playerId),
          };
        }),
      };
    });
  });
}

/** Missing years interrupt the line instead of connecting distant seasons. */
export function seasonTrendPoints(seasons, valueFor) {
  const chronological = [...seasons].reverse();
  const years = chronological.map((s) => Number(String(s.season).slice(0, 4)));
  if (
    !years.length ||
    years.some((year) => !Number.isInteger(year)) ||
    new Set(years).size !== years.length ||
    Math.max(...years) - Math.min(...years) > 50
  )
    return chronological.map((s) => ({
      label: s.season,
      value: valueFor(s.profile),
    }));
  const byYear = new Map(chronological.map((s, index) => [years[index], s]));
  const formatAsSeason = chronological.some((s) =>
    String(s.season).includes("/"),
  );
  return Array.from(
    { length: Math.max(...years) - Math.min(...years) + 1 },
    (_, index) => {
      const year = Math.min(...years) + index;
      const season = byYear.get(year);
      return {
        label:
          season?.season ||
          (formatAsSeason ? `${year}/${year + 1}` : String(year)),
        value: season ? valueFor(season.profile) : null,
      };
    },
  );
}
