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
        chunk.representationToken ||
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
  if (
    canRetain &&
    !current.data &&
    previous?.data &&
    previous.intent === current.intent &&
    previous.scope === current.scope &&
    previous.key !== current.key
  )
    return { ...previous, retained: true };
  return { ...current, retained: false };
}
