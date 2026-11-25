import { loadSeason } from "../season_data.js";
import { seasonLabel } from "./format.js";

/**
 * The fixtures `scoped.loadFixtures` left for a competition's season; when they are an empty snapshot and the manifest
 * holds that season's partition (a deep-linked match outside the site's season), the partition itself is loaded and
 * read. Shared by the match's table and the competition's block shown in the match's « Classement » (§ 63.7).
 */
export async function seasonSnapshotFixtures(f, scoped, competition, season, { signal } = {}) {
  const key = `${competition.id}:${season}`;
  let value = scoped.fixtures.get(key);
  if (value?.source === "snapshot" && !value.matches?.length) {
    const bucket = seasonLabel(season);
    const available = f.manifest.seasons
      .find((s) => s.id === bucket)
      ?.chunks.some((c) => c.leagueId === competition.id);
    if (available) {
      // A deep-linked match can belong to a season outside the global page
      // filter. Fetch only its competition snapshot, using the shared cache.
      scoped.data = await loadSeason(
        f.manifest,
        bucket,
        fetch,
        new Set([competition.id]),
        { signal },
      );
      value = {
        matches: scoped.localFixtures(competition.id, season),
        source: "snapshot",
      };
      scoped.fixtures.set(key, value);
    }
  }
  return value;
}
