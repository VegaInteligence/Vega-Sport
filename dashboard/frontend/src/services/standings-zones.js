/**
 * Standings zones: European places from the UEFA association ranking, and
 * promotion / relegation from the standings source.
 *
 * European places are never listed per country. They follow the UEFA access
 * list (2024–2027 cycle): a country's rank in the association coefficients
 * decides how many league positions qualify, and for which competition. The
 * standings of season Y/Y+1 lead to the European season Y+1/Y+2, whose places
 * use the association ranking published at the end of Y-1/Y (edition Y). The
 * two associations with the best coefficient over season Y/Y+1 itself earn a
 * European Performance Spot: one more Champions League place.
 *
 * Cup-winner places are not shown: they depend on the cup, not on the table.
 */

import leagueRules from "../../../shared/league-rules.json" with { type: "json" };

const LEAGUE_RULES = leagueRules.leagues || {};

export const ZONES = {
  cl: { label: "Ligue des champions" },
  "cl-q": { label: "Ligue des champions · qualifications" },
  el: { label: "Ligue Europa" },
  "el-q": { label: "Ligue Europa · qualifications" },
  ecl: { label: "Ligue Conférence" },
  promotion: { label: "Montée" },
  "promotion-po": { label: "Barrage de montée" },
  "relegation-po": { label: "Barrage de relégation" },
  relegation: { label: "Relégation" },
  ko: { label: "8es de finale directs" },
  "ko-po": { label: "Barrages" },
};
export const ZONE_ORDER = Object.keys(ZONES);

/**
 * League positions that qualify for Europe for an association rank: the zone
 * of each position, in order (index 0 = 1st place).
 */
export function europeanPlaces(rank, { eps = false } = {}) {
  if (!Number.isInteger(rank) || rank < 1) return [];
  const direct =
    rank <= 4 ? 4 : rank === 5 ? 3 : rank === 6 ? 2 : rank <= 10 ? 1 : 0;
  const qualifying =
    rank <= 4 ? 0 : rank <= 10 ? 1 : rank <= 15 ? 2 : rank <= 55 ? 1 : 0;
  // The performance spot goes to the best-placed club not yet qualified.
  const places = [
    ...Array(direct).fill("cl"),
    ...Array(qualifying).fill("cl-q"),
    ...(eps ? ["cl"] : []),
  ];
  // Europa League, then Conference League, by league position.
  if (rank <= 5) places.push("el", "ecl");
  else if (rank <= 12) places.push("el-q", "ecl");
  else if (rank <= 50) places.push("ecl", "ecl");
  else if (rank <= 55) places.push("ecl");
  return places;
}

/** Ranking position of each association of one UEFA edition. */
export function associationRanks(edition) {
  const ranks = new Map();
  for (const row of edition?.rows || [])
    if (row.countryCode && Number.isInteger(row.position))
      ranks.set(row.countryCode, row.position);
  return ranks;
}

/** The two associations with the best coefficient over one season. */
export function performanceSpots(edition, seasonYear) {
  const scores = [];
  for (const row of edition?.rows || []) {
    const season = row.sourceRow?.seasonRankings?.find(
      (item) => item.seasonYear === seasonYear,
    );
    const points = season?.nationalAssociationPoints ?? season?.totalPoints;
    if (row.countryCode && typeof points === "number")
      scores.push([row.countryCode, points]);
  }
  scores.sort((a, b) => b[1] - a[1]);
  return new Set(scores.slice(0, 2).map(([country]) => country));
}

/** First year of a season label: "2026/2027" → 2026, "2026" → 2026. */
export function seasonStartYear(season) {
  const year = Number(String(season || "").slice(0, 4));
  return Number.isInteger(year) && year > 1900 ? year : null;
}

/**
 * Promotion and relegation zones of a league, by row index, from the places
 * recorded in shared/league-rules.json (refreshed by
 * the previous pipeline's refresh_league_rules.mjs). Only applied to a table of the
 * recorded size.
 */
export function leagueZones(competitionId, rowCount) {
  const rules = LEAGUE_RULES[competitionId];
  const zones = Array(rowCount).fill(null);
  // A league of another size played under other rules (e.g. an older season).
  if (!rules || !rowCount || (rules.teams && rules.teams !== rowCount))
    return zones;
  const fill = (from, count, zone) => {
    for (let i = from; i < from + count; i++)
      if (i >= 0 && i < rowCount && !zones[i]) zones[i] = zone;
  };
  fill(rowCount - rules.relegation, rules.relegation, "relegation");
  fill(
    rowCount - rules.relegation - rules.relegationPlayoff,
    rules.relegationPlayoff,
    "relegation-po",
  );
  fill(0, rules.promotion, "promotion");
  fill(rules.promotion, rules.promotionPlayoff, "promotion-po");
  return zones;
}

/**
 * A UEFA league phase (36 clubs, from 2024/25): the first eight go straight to the round of
 * 16, the next sixteen to the knockout play-offs, the last twelve are out.
 */
export function leaguePhaseZones(rowCount) {
  if (rowCount !== 36) return Array(rowCount).fill(null);
  return Array.from({ length: rowCount }, (_, i) => (i < 8 ? "ko" : i < 24 ? "ko-po" : null));
}

const EUROPEAN = new Set(["cl", "cl-q", "el", "el-q", "ecl"]);

/**
 * A table's zones: the league's recorded rules where they fit the table (with the European
 * places of the association ranking), else, for a finished season, what became of each
 * club the next season (fates, by club id: « observed »), else the European places alone.
 * A season the association ranking does not cover (editions before 2024) takes its
 * European places from the fates, its promotion and relegation still from the rules.
 */
export function standingZones(rows, { european = [], competitionId, fates } = {}) {
  const count = rows.length;
  const league = leagueZones(competitionId, count);
  if (!league.some(Boolean) && fates)
    return { zones: rows.map((row) => fates[row.id] || null), observed: true };
  if (!european.length && fates && rows.some((row) => EUROPEAN.has(fates[row.id]))) {
    const observed = rows.map((row) => (EUROPEAN.has(fates[row.id]) ? fates[row.id] : null));
    return { zones: tableZones(count, { european: [], league }).map((zone, i) => zone || observed[i]), observed: true };
  }
  return { zones: tableZones(count, { european, league }), observed: false };
}

/** European places first, then promotion and relegation (which win). */
export function tableZones(rowCount, { european = [], league = [] } = {}) {
  const zones = Array(rowCount).fill(null);
  european.slice(0, rowCount).forEach((zone, i) => (zones[i] = zone));
  league.forEach((zone, i) => {
    if (zone && i < rowCount && (!zones[i] || zone.startsWith("relegation")))
      zones[i] = zone;
  });
  return zones;
}

/** Zones present in a table, in display order, for its legend. */
export function legendZones(zones) {
  const present = new Set(zones.filter(Boolean));
  return ZONE_ORDER.filter((zone) => present.has(zone));
}
