/**
 * A player's injuries (/api/players/{id}/injuries) and his Vega score season by season
 * (/api/rankings/power/history): the career tab's injuries and index, and the rail's
 * availability. A player without any has none (HTTP 404 or an empty list: null).
 */
import { useResource, json } from "./resources.js";
import { injuryLabel } from "./injury-labels.js";

const missing = (error) => (/\bHTTP 404\b/.test(error?.message || "") ? null : Promise.reject(error));
const DAY = 86400000;
const parse = (iso) => Date.parse(`${iso}T00:00:00Z`);

export function usePlayerInjuries(id) {
  return useResource(
    `player-injuries:${id || "none"}`,
    () => json(`/api/players/${id}/injuries`).then((body) => body?.data?.injuries || []).catch(missing),
    Boolean(id),
  );
}

export function usePowerHistory(id) {
  return useResource(
    `power-history:${id || "none"}`,
    () => json("/api/rankings/power/history?" + new URLSearchParams({ player: id })).then((body) => body?.seasons || null).catch(missing),
    Boolean(id),
  );
}

/** « 2025/26 » for the season that starts in 2025. */
export const shortSeason = (year) => `${year}/${String((year + 1) % 100).padStart(2, "0")}`;

/** The injuries as the timeline draws them: an injury still running ends today. */
export function injuryRows(injuries, today = new Date()) {
  const now = today.toISOString().slice(0, 10);
  return (injuries || []).filter((i) => i.start).map((i) => {
    const end = i.end && i.end <= now ? i.end : now;
    const year = Number.isInteger(i.season) ? i.season : Number(i.start.slice(0, 4)) - (Number(i.start.slice(5, 7)) < 7 ? 1 : 0);
    return { season: shortSeason(year), start: i.start, end, ongoing: !i.end || i.end > now, label: injuryLabel(i.label, i.kind),
      type: i.kind === "suspension" ? "suspension" : "injury", missed: i.matchesMissed ?? 0,
      days: Math.round((parse(end) - parse(i.start)) / DAY) + 1 };
  });
}

/** The rail's availability: absences and weeks out over the last twelve months, and the
 * days of an absence still running (null when he is available). */
export function availability(rows, today = new Date()) {
  const since = new Date(today.getTime() - 365 * DAY).toISOString().slice(0, 10);
  const recent = rows.filter((r) => r.end >= since);
  const days = recent.reduce((total, r) => total + Math.round((parse(r.end) - parse(r.start < since ? since : r.start)) / DAY) + 1, 0);
  const running = rows.find((r) => r.ongoing);
  return { count: recent.length, weeks: Math.round(days / 7), current: running ? running.days : null, missed: recent.reduce((t, r) => t + (r.missed || 0), 0) };
}
