/**
 * « Remplaçant » on /joueurs (VI-39): the players whose whole season profile is the closest
 * to a reference player, read from /api/players/{id}/similar with the replacement parameters
 * (the whole season's cohort, filtered before the limit; backend/api/src/routes/profiles.mjs).
 */
import { json, useResource } from "./resources.js";

export const REPLACEMENT_LIMIT = 40;
export const AGE_FILTERS = [
  ["all", "Tous"],
  ["25", "≤ 25 ans"],
  ["22", "≤ 22 ans"],
];
export const VALUE_FILTERS = [
  ["all", "Toutes"],
  ["50000000", "≤ 50 M€"],
  ["25000000", "≤ 25 M€"],
];
export const REPLACEMENT_SORTS = [
  ["similarity", "Ressemblance"],
  ["grade", "Note"],
  ["value", "Prix"],
];
export const AXES = [
  ["construction", "Construction"],
  ["creation", "Création"],
  ["percussion", "Percussion"],
  ["defense", "Défense"],
  ["finishing", "Finition"],
];

const PLAYER_ID = /^p_(?:[A-Za-z0-9]{6}|v\d{7})$/;
const SEASON = /^\d{4}\/\d{4}$/;

/** The request for a reference, a season and the two filters ("all" for none). */
export function replacementUrl(
  id,
  season,
  { age = "all", value = "all" } = {},
) {
  const params = new URLSearchParams({
    season,
    limit: String(REPLACEMENT_LIMIT),
  });
  if (age !== "all") params.set("maxAge", age);
  if (value !== "all") params.set("maxValue", value);
  return `/api/players/${encodeURIComponent(id)}/similar?${params}`;
}

/** The candidates in the chosen order: a missing note or price goes last, then by resemblance. */
export function sortCandidates(rows, sort) {
  const missingLast = (a, b, pick, direction) => {
    const x = pick(a),
      y = pick(b);
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return direction * (x - y);
  };
  return [...rows].sort(
    (a, b) =>
      (sort === "grade"
        ? missingLast(a, b, (p) => p.grade, -1)
        : sort === "value"
          ? missingLast(a, b, (p) => p.value_eur, 1)
          : 0) ||
      b.similarity - a.similarity ||
      a.name.localeCompare(b.name, "fr"),
  );
}

/** « 20 M€ », « 800 k€ », « — ». */
export function money(value) {
  if (!Number.isFinite(value)) return "—";
  if (value >= 1e6) {
    const m = value / 1e6;
    return `${m.toLocaleString("fr-FR", { maximumFractionDigits: m < 10 ? 1 : 0 })} M€`;
  }
  return `${Math.round(value / 1e3).toLocaleString("fr-FR")} k€`;
}

/** The read: undefined while it loads, null without a reference or a season. */
export function usePlayerReplacements(id, season, filters) {
  const enabled = Boolean(
    PLAYER_ID.test(id || "") && SEASON.test(season || ""),
  );
  const url = enabled ? replacementUrl(id, season, filters) : "";
  const resource = useResource(
    `player-replacements:${url}`,
    () => json(url).then((body) => body.data || null),
    enabled,
  );
  return { ...resource, enabled };
}
