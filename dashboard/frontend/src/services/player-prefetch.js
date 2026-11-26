/**
 * The player page's first reads (FAILURE_MODES_OPTIMISATIONS.md GH129): the ones that need only the player's id (and
 * the page's season) start with the page, under the keys and loaders of the components that show them, so that each
 * is read once; before, they waited for his season's read. Only the default view's: each of them is read there on a
 * computer and on a phone alike, so nothing is read that the page would not have read. The page holds them, and lets
 * them go when it leaves (GH129-j): a read no component holds is then cancelled, its slot freed.
 */
import { apiUrl } from "../data-url.js";
import { publicApiFetch } from "./public-api-fetch.js";
import { holdResource } from "./resources.js";
import { playerInjuriesResource } from "./player-availability.js";
import { playerPowerResource } from "./ballon-dor.js";
import { playerHonoursResource } from "./player-honours.js";
import { loadPlayerMarketValues, playerMarketValuesKey, servesMarketValues } from "./player-market-values.js";
import { playerRoutes } from "./scouting-history.js";

/** The player's published record (/api/players/{id}, as FootballDataClient.request reads it): null for a player the API
 * does not know. It needs no client: it starts with the page (the client exists once his season is read). */
export const playerRecordResource = (id) => [
  `player-record:${id}`,
  async ({ signal } = {}) => {
    const response = await publicApiFetch(apiUrl(`/api/pitchapi/players/${encodeURIComponent(id)}`), { headers: { Accept: "application/json" }, signal });
    if (response.status === 404) return null;
    let body;
    try {
      body = await response.json();
    } catch {
      const error = new Error("La connexion aux données est momentanément indisponible.");
      error.status = response.status;
      throw error;
    }
    if (!response.ok || body.error) {
      const error = new Error(body.error?.message || "Les données ne sont pas disponibles.");
      error.code = body.error?.code;
      error.status = response.status;
      throw error;
    }
    return body.data;
  },
];

const PLAYER = /^p_[A-Za-z0-9]{6}$/;
const quiet = (promise) => void Promise.resolve(promise).catch(() => {});
// A read started here that fails before its blocks mount (market values a player has none of: 404) is their read's
// failure, not read again, for the page's first readers (GH129-h); « Réessayer » reads again.
const KEEP_FAILURE_MS = 10_000;

/** Starts the page's reads that need only the player's id, held until the returned release (the page leaving). */
export function prefetchPlayerPage(f, id) {
  if (!PLAYER.test(id || "") || !f?.manifest) return () => {};
  const held = [];
  const hold = ([key, loader]) => held.push(holdResource(key, loader, { keepError: KEEP_FAILURE_MS }));
  hold(playerRecordResource(id));
  hold(playerInjuriesResource(id));
  hold(playerHonoursResource(id));
  if (f.season) hold(playerPowerResource(f.season, id));
  if (servesMarketValues(f.manifest)) hold([playerMarketValuesKey(id), ({ signal }) => loadPlayerMarketValues(id, { signal })]);
  // The seasons' routes have their own shared cache (scouting-history.js): held while its read runs, or the page stays.
  const routes = new AbortController();
  quiet(playerRoutes(f.manifest, { players: [id] }, fetch, { signal: routes.signal }));
  let holding = true;
  return () => {
    if (!holding) return;
    holding = false;
    routes.abort();
    for (const release of held) release();
  };
}
