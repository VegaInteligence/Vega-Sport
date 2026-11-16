/**
 * The season before the page's, for the comparison (hooks/usePreviousSeason.js).
 */
/** « 2024/2025 » for « 2025/2026 » when the site publishes it, else null. */
export function previousSeason(season, seasons = []) {
  const m = /^(\d{4})\/(\d{4})$/.exec(season || "");
  if (!m) return null;
  const previous = `${Number(m[1]) - 1}/${Number(m[2]) - 1}`;
  return seasons.includes(previous) ? previous : null;
}

/** « 2024/25 ». */
export const seasonShort = (season) => (season ? season.replace(/^(\d{4})\/\d{2}(\d{2})$/, "$1/$2") : "");
