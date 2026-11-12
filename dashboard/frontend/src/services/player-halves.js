/**
 * A player's season by half (/api/players/{id}/halves): what he produces per 90 minutes
 * in first halves and in second halves, to see whether he fades or finishes strongly.
 */
import { useResource, json } from "./resources.js";

export const HALF_METRICS = [
  ["goals", "Buts", 2],
  ["shots", "Tirs", 2],
  ["xg", "xG", 2],
  ["chances_created", "Occasions créées", 2],
  ["passes", "Passes réussies", 1],
  ["touches", "Ballons touchés", 1],
  ["duels_won", "Duels gagnés", 2],
  ["recoveries", "Récupérations", 2],
];
// Below this, a half's rates say too little to be set beside the other's.
export const MIN_HALF_MINUTES = 180;

const rate = (half, key) => (half?.minutes > 0 && Number.isFinite(half[key]) ? (90 * half[key]) / half.minutes : null);

/** The table's rows: each statistic per 90 minutes of each half; null without both halves. */
export function halfRows(answer) {
  const { first, second } = answer || {};
  if (!(first?.minutes >= MIN_HALF_MINUTES) || !(second?.minutes >= MIN_HALF_MINUTES)) return null;
  return {
    minutes: [first.minutes, second.minutes],
    rows: HALF_METRICS.map(([key, label, decimals]) => ({ key, label, decimals, first: rate(first, key), second: rate(second, key) })),
  };
}

/** A player's halves of a season: null without any, undefined while they load. */
export function usePlayerHalves(season, id) {
  const enabled = Boolean(/^\d{4}\/\d{4}$/.test(season || "") && /^p_(?:[A-Za-z0-9]{6}|v\d{7})$/.test(id || ""));
  const resource = useResource(
    `player-halves:${season || "none"}:${id || "none"}`,
    () =>
      json(`/api/players/${encodeURIComponent(id)}/halves?` + new URLSearchParams({ season }))
        .then((body) => body.data || null)
        .catch((error) => (/\bHTTP 404\b/.test(error?.message || "") ? null : Promise.reject(error))),
    enabled,
  );
  if (!enabled || resource.error) return null;
  return resource.value;
}
