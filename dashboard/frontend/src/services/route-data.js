import { pages } from "../../../shared/pages.js";
import { accountsOn } from "./account-switch.js";

const routePath = (pathname) => (pathname || "/").replace(/\/$/, "") || "/";
const pageRoutes = new Set([
  ...pages.map((page) => routePath(page.path)),
  "/joueurs/matchs",
]);
/**
 * Whether a URL is one of the site's pages. Any other URL shows the 404 page,
 * which reads no data and must not wait behind the data providers.
 */
export function routeExists(pathname) {
  const path = routePath(pathname);
  // The account pages exist only with accounts on (VI-38, account-switch.js); off, they are the 404 page.
  return pageRoutes.has(path) || (accountsOn() && ACCOUNT_ROUTES.has(path));
}
const ACCOUNT_ROUTES = new Set(["/connexion", "/compte"]);

/** Pages with their own readers must not download a season before mounting. */
export function routeNeedsSeason(pathname, params) {
  const path = routePath(pathname);
  if (
    [
      "/competitions",
      "/archives",
      "/classement-joueurs",
      "/power-ranking",
      "/nations",
      "/rapport",
      "/calendrier",
      "/joueurs/matchs",
      "/connexion",
      "/compte",
    ].includes(path)
  )
    return false;
  if (
    path === "/clubs" &&
    params.get("clubLeague") &&
    params.get("clubTeam") &&
    !params.get("id")
  )
    return false;
  return true;
}

/** Counts come from published metadata, never from a partial page of rows. */
export function seasonCoverage(manifest, season) {
  const chunks = manifest?.seasons?.find((item) => item.id === season)?.chunks;
  if (!chunks?.length) return { matches: null, appearances: null };
  const total = (key) =>
    chunks.every((chunk) => Number.isFinite(chunk.meta?.[key]))
      ? chunks.reduce((sum, chunk) => sum + chunk.meta[key], 0)
      : null;
  return {
    matches: total("matchCount"),
    appearances: total("appearanceCount"),
  };
}
