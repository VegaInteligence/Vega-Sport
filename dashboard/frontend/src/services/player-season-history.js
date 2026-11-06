import { isNumber } from "../model.js";
import { aggregateSeason } from "./season-player.js";

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

/** Group a season by team identity, then calculate totals from its appearances. */
export function playerSeasonGroups(seasons, playerId) {
  return seasons.flatMap(({ season, data, profile }) => {
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
