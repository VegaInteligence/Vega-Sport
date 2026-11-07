/** Pages with their own readers must not download a season before mounting. */
export function routeNeedsSeason(pathname, params) {
  const path = (pathname || "/").replace(/\/$/, "") || "/";
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
