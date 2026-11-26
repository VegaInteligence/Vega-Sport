import { publicApiFetch } from "./public-api-fetch.js";
import { apiUrl } from "../data-url.js";
import { projectionGroups } from "../../../shared/honour-display.js";
export { projectionGroups };
export const MESSI_ID = "p_1mZO3B";
function wikipediaUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "en.wikipedia.org"
      ? url.href
      : "";
  } catch {
    return "";
  }
}

/** The honours' read: its key and loader, shared by the hook and the page's first reads (player-prefetch.js). */
export const playerHonoursResource = (id, name) => [
  `player-honours:${id}`,
  ({ signal } = {}) => loadPlayerHonours(id, name, fetch, { signal }),
];

/** The honours' read; `signal` ends its request with its last holder (GH129-j). */
export async function loadPlayerHonours(id, _name, fetcher = fetch, { signal } = {}) {
  if (!/^p_[A-Za-z0-9]{6}$/.test(id || ""))
    return { groups: [], partial: true };
  const response = await publicApiFetch(
    apiUrl("/api/player-honours?id=" + encodeURIComponent(id)),
    { signal },
    fetcher,
  );
  if (response.status === 404) return { groups: [], partial: true };
  if (!response.ok) throw new Error("Palmarès momentanément indisponible.");
  const projection = await response.json();
  return {
    groups:
      projection.displayGroups ??
      (projection.available ? projectionGroups(projection.honours) : []),
    partial: true,
    sourceUrl: wikipediaUrl(projection.sourceUrl),
    fetchedAt: projection.fetchedAt || null,
  };
}
