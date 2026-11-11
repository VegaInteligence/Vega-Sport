/**
 * The manifest as the pages read it.
 *
 * Since its schema 5 the API no longer repeats, in each league's entry of a season, the
 * competition its catalogue already describes, nor the publication's date: that was half
 * of a document every page waits for. Both are put back here, once per manifest received,
 * so the pages keep the entries they have always read. A manifest that still carries them
 * is returned as it is.
 */
const expanded = new WeakMap();

export function expandManifest(manifest) {
  if (
    !manifest ||
    typeof manifest !== "object" ||
    !Array.isArray(manifest.seasons)
  )
    return manifest;
  if (expanded.has(manifest)) return expanded.get(manifest);
  const catalogue = new Map(
    (manifest.competitions || []).map((item) => [item.id, item]),
  );
  let changed = false;
  const seasons = manifest.seasons.map((season) => {
    if (!Array.isArray(season?.chunks)) return season;
    let touched = false;
    const chunks = season.chunks.map((chunk) => {
      const competitions = !Array.isArray(chunk?.competitions),
        published =
          Boolean(manifest.publishedAt) &&
          Boolean(chunk?.meta) &&
          !("publishedAt" in chunk.meta);
      if (!chunk || (!competitions && !published)) return chunk;
      touched = true;
      const entry = catalogue.get(chunk.leagueId),
        count = chunk.meta?.matchCount ?? 0;
      return {
        ...chunk,
        ...(published && {
          meta: { ...chunk.meta, publishedAt: manifest.publishedAt },
        }),
        ...(competitions && {
          competitions: entry
            ? [
                {
                  ...entry,
                  sampleMatches: count,
                  sampleSeasons: count ? [season.id] : [],
                },
              ]
            : [],
        }),
      };
    });
    if (!touched) return season;
    changed = true;
    return { ...season, chunks };
  });
  const result = changed ? { ...manifest, seasons } : manifest;
  expanded.set(manifest, result);
  return result;
}
