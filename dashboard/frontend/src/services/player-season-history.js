import { aggregateSeason } from "./season-player.js";

/** Keep separate rows when a player appears for several teams or competitions. */
export function playerSeasonRows(seasons, playerId) {
  return seasons.flatMap(({ season, data, profile }) => {
    const teams = new Map((data?.teams || []).map((item) => [item.id, item]));
    const competitions = new Map(
      (data?.competitions || []).map((item) => [item.id, item]),
    );
    const groups = new Map();
    for (const row of profile.rows) {
      const key = JSON.stringify([
        row.teamId || row.team || "",
        row.leagueId || row.league || "",
      ]);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    return [...groups.values()].map((rows) => {
      const first = rows[0];
      return {
        season,
        team: teams.get(first.teamId) || {
          id: first.teamId,
          name: first.team || "Équipe inconnue",
        },
        competition: competitions.get(first.leagueId) || {
          id: first.leagueId,
          name: first.league || "Compétition inconnue",
        },
        profile: aggregateSeason(rows, playerId),
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
