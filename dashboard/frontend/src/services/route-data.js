import { pages } from "../../../shared/pages.js";

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
  return (
    pageRoutes.has(path) ||
    path === "/maquettes" ||
    path.startsWith("/maquettes/")
  );
}

/** Pages with their own readers must not download a season before mounting. */
export function routeNeedsSeason(pathname, params) {
  const path = routePath(pathname);
  // Design mock-ups render their own fictitious data.
  if (path === "/maquettes" || path.startsWith("/maquettes/")) return false;
  if (
    [
      "/competitions",
      "/archives",
      "/methode",
      "/classement-joueurs",
      "/calendrier",
      "/joueurs/matchs",
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
