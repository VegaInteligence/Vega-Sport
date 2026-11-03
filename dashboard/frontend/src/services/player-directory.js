import {
  filterAppearances,
  isNumber,
  normalizeText,
  csvString,
  compareText,
} from "../model.js";
import {
  advancedTest,
  EMPTY_ADVANCED,
  CONDITION_METRICS,
} from "./advanced-filters.js";
import { SEASON_METRICS, seasonMetric } from "./season-player.js";

export const DIRECTORY_FIELDS = [
  ["matches", "Matchs"],
  ["minutes", "Min. moy."],
  ["rating", "Note moy."],
  ["goals", "Buts"],
  ["assists", "PD"],
  ["xg", "xG"],
  ["xa", "xA"],
  ["chancesCreated", "Occ. créées"],
  ["defensiveActions", "Défense"],
  ["saves", "Arrêts"],
  ["goalsPrevented", "Buts évités"],
];

/** Contextual criteria define the sample; numeric thresholds never select matches. */
export function playerDirectoryScope(rows, season, filters, matches) {
  const context = {
    ...filters.advanced,
    positions: [],
    rating: null,
    conditions: [],
  };
  const sample = filterAppearances(rows, {
    ...filters,
    season,
    query: "",
    minutes: 0,
    test: advancedTest(context, matches),
  });
  const leagues = new Set(filters.leagues || []);
  return leagues.size
    ? sample.filter((row) => leagues.has(row.leagueId))
    : sample;
}

export function playerAverage(profile, basis) {
  const position = {
    Gardien: 11,
    Défenseur: 31,
    Milieu: 61,
    "Milieu offensif": 81,
    Attaquant: 91,
  }[profile.role?.label];
  return {
    id: profile.id,
    playerId: profile.id,
    name: profile.name,
    imageUrl: profile.imageUrl,
    team: profile.teams.join(" · "),
    league: profile.leagues.join(" · "),
    position: profile.role?.label || "—",
    positionId: position ?? null,
    matches: profile.matches,
    minutes: profile.matches
      ? profile.minutes / profile.matches
      : profile.unknownMinutes
        ? null
        : 0,
    rating: profile.rating,
    ...Object.fromEntries(
      Object.keys(SEASON_METRICS).map((key) => [
        key,
        seasonMetric(profile, key, basis).value,
      ]),
    ),
    profile,
  };
}

export function filterPlayerAverages(rows, filters) {
  const test = advancedTest(
    {
      ...EMPTY_ADVANCED,
      positions: filters.advanced.positions,
    },
    new Map(),
  );
  return rows.filter(
    (row) =>
      (filters.minutes === 0 ||
        (isNumber(row.minutes) && row.minutes >= filters.minutes)) &&
      (!isNumber(filters.advanced.rating) ||
        (isNumber(row.rating) && row.rating >= filters.advanced.rating)) &&
      filters.advanced.conditions.every(
        ({ key, min }) => isNumber(row[key]) && row[key] >= min,
      ) &&
      (!test || test(row)),
  );
}

export function searchPlayerAverages(rows, query) {
  const needle = normalizeText(query).trim();
  return needle
    ? rows.filter((row) =>
        normalizeText([row.name, row.team, row.league].join(" ")).includes(
          needle,
        ),
      )
    : rows;
}

export function sortPlayerAverages(rows, { key, direction }) {
  const sign = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (key === "name")
      return (
        sign * compareText(a.name, b.name) ||
        compareText(a.playerId, b.playerId)
      );
    if (!isNumber(a[key]))
      return isNumber(b[key]) ? 1 : compareText(a.name, b.name);
    if (!isNumber(b[key])) return -1;
    return (
      sign * (a[key] - b[key]) ||
      compareText(a.name, b.name) ||
      compareText(a.playerId, b.playerId)
    );
  });
}

export function directoryCSV(rows, basis, columns) {
  const metrics = [
    ...new Set([
      ...(columns
        ? columns.filter((key) => SEASON_METRICS[key])
        : [
            ...DIRECTORY_FIELDS.slice(3).map(([key]) => key),
            ...CONDITION_METRICS.map(([key]) => key),
          ]),
    ]),
  ];
  const fields = [
    "playerId",
    "name",
    "clubs",
    "position",
    "matches",
    "meanMinutes",
    "meanRating",
    "basis",
    ...metrics.flatMap((key) => [key, key + "_observed_matches"]),
  ];
  return csvString(
    fields,
    rows.map((row) => [
      row.playerId,
      row.name,
      row.team,
      row.position,
      row.matches,
      row.minutes,
      row.rating,
      basis,
      ...metrics.flatMap((key) => [
        row[key],
        row.profile.stats[key]?.count ?? row.profile.ratios[key]?.count ?? 0,
      ]),
    ]),
  );
}
