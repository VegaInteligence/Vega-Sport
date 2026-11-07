import { isNumber } from "../model.js";
import { aggregateSeason } from "./season-player.js";
import { isNationalTeamCompetition } from "./player-team-seasons.js";
import {
  COUNTRY_NAMES,
  FEATURED_EUROPE_IDS,
  FEATURED_LEAGUE_IDS,
} from "./competition-selector.js";

const CLUB_IDS = new Set([
  ...FEATURED_EUROPE_IDS,
  ...FEATURED_LEAGUE_IDS,
  "open-cup:club-world-cup",
]);
function competitionKind(id, meta) {
  if (isNationalTeamCompetition(id)) return "selection";
  if (CLUB_IDS.has(id)) return "club";
  const country = String(
    meta?.providerCountry || meta?.country || "",
  ).toUpperCase();
  return /^[A-Z]{3}$/.test(country) &&
    country !== "INT" &&
    Object.hasOwn(COUNTRY_NAMES, country)
    ? "club"
    : "unknown";
}

/** One candidate per match across editions, preferring a played observation. */
export function playerCareerObservations(history, playerId) {
  const observed = new Map();
  for (const { season, data, profile } of history) {
    if (!profile) continue;
    const teamMeta = new Map((data?.teams || []).map((v) => [v.id, v]));
    const competitionMeta = new Map(
      (data?.competitions || []).map((v) => [v.id, v]),
    );
    const unknown = new Set(profile.unknownMatches || []);
    const rows = [...(profile.rows || [])];
    for (const row of data?.appearances || [])
      if (
        row.playerId === playerId &&
        !isNumber(row.minutes) &&
        unknown.delete(row.matchId)
      )
        rows.push(row);
    for (const row of rows) {
      if (row.playerId !== playerId || !row.matchId) continue;
      const candidate = {
        row,
        season,
        team: teamMeta.get(row.teamId) || { name: row.team },
        competition: competitionMeta.get(row.leagueId) || { name: row.league },
      };
      const previous = observed.get(row.matchId);
      const played = isNumber(row.minutes) && row.minutes > 0;
      const previousPlayed =
        previous && isNumber(previous.row.minutes) && previous.row.minutes > 0;
      if (!previous || (played && !previousPlayed))
        observed.set(row.matchId, candidate);
    }
  }
  return [...observed.values()];
}

/** Career groups preserve provider identities and deduplicate across editions. */
export function playerCareerGroups(history, playerId) {
  const teams = new Map(),
    competitions = new Map(),
    kinds = new Map();
  function append(map, key, meta, row, season) {
    if (!map.has(key))
      map.set(key, {
        key,
        name: meta.name || "Inconnu",
        imageUrl: meta.imageUrl || null,
        rows: [],
        seasons: new Set(),
      });
    const value = map.get(key);
    if (value.name === "Inconnu" && meta.name) value.name = meta.name;
    if (!value.imageUrl && meta.imageUrl) value.imageUrl = meta.imageUrl;
    value.rows.push(row);
    if (season) value.seasons.add(season);
  }
  for (const { row, season, team, competition } of playerCareerObservations(
    history,
    playerId,
  )) {
    if (row.teamId) {
      append(teams, row.teamId, team, row, season);
      if (!kinds.has(row.teamId)) kinds.set(row.teamId, new Set());
      const kind = competitionKind(row.leagueId, competition);
      if (kind !== "unknown") kinds.get(row.teamId).add(kind);
    }
    if (row.leagueId)
      append(competitions, row.leagueId, competition, row, season);
  }
  function finish(value) {
    return {
      key: value.key,
      name: value.name,
      imageUrl: value.imageUrl,
      seasons: [...value.seasons].sort().reverse(),
      profile: aggregateSeason(value.rows, playerId),
    };
  }
  const result = {
    clubs: [],
    competitions: [...competitions.values()].map(finish),
    selections: [],
    unknown: [],
  };
  for (const team of teams.values()) {
    const values = kinds.get(team.key);
    const kind = values?.size === 1 ? [...values][0] : "unknown";
    result[
      kind === "club"
        ? "clubs"
        : kind === "selection"
          ? "selections"
          : "unknown"
    ].push(finish(team));
  }
  for (const values of Object.values(result))
    values.sort(
      (a, b) =>
        b.profile.matches - a.profile.matches ||
        a.name.localeCompare(b.name, "fr") ||
        a.key.localeCompare(b.key),
    );
  return result;
}
