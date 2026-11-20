/** Only changes to the selected season/scope invalidate its large data cache. */
export function seasonVersion(manifest, season, leagueIds = null) {
  const chunks =
    manifest?.seasons?.find((item) => item.id === season)?.chunks || [];
  return JSON.stringify([
    manifest?.storage,
    season,
    chunks
      .filter((chunk) => !leagueIds || leagueIds.has(chunk.leagueId))
      .map((chunk) => [
        chunk.leagueId,
        chunk.sourceDigest ||
          chunk.sha256 ||
          chunk.meta?.retrievedAt ||
          manifest?.retrievedAt ||
          null,
      ])
      .sort(([a], [b]) => a.localeCompare(b)),
  ]);
}

export function pagedMatchList(manifest, pathname, id) {
  return (
    manifest?.storage === "aws-relational" &&
    manifest.capabilities?.fixturePaginationOrder === true &&
    /^\/matchs\/?$/.test(pathname) &&
    !id
  );
}

/** Keep data and its metadata together while the same scope is being renewed. */
export function selectSeasonSnapshot(previous, current, canRetain = true) {
  // The same read renewed (a new version), or, on the same page, another season: the page and
  // its last tables stay while it loads, and only the tables change (user, 20 Nov 2026: the
  // whole site gave way to the loading screen at each change of season).
  const renewed =
    previous?.intent === current.intent && previous?.scope === current.scope;
  const seasonChange =
    previous?.page !== undefined &&
    previous.page === current.page &&
    previous.season !== current.season;
  if (
    canRetain &&
    !current.data &&
    previous?.data &&
    (renewed || seasonChange) &&
    previous.key !== current.key
  )
    return { ...previous, retained: true };
  return { ...current, retained: false };
}
