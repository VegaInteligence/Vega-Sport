/**
 * The player's previous season for the comparison: his role group's players of that season
 * in the same competitions, read as the page reads this season's (the cohort read), only
 * once the comparison asks for it. His percentiles are then worked out against them, with
 * the same indicators and the same minutes floor as this season's.
 */
import { useMemo } from "react";
import { useFootball } from "./FootballContext.jsx";
import useCompactRead from "./useCompactRead.js";
import { cohortGroupParams, compactGeneration, playerReadParams } from "../services/compact-reads.js";
import { buildCohorts } from "../services/scouting.js";
import { previousSeason } from "../services/previous-season.js";

/**
 * His percentiles of the previous season on `keys`, `percentileOf(profile, key, cohorts)`
 * giving one: null while nothing is asked, else the read's state and, once read, his
 * profile of that season (absent: he was not in that group there).
 */
export default function usePreviousSeason({ profile, group, keys, minMinutes, enabled, percentileOf }) {
  const f = useFootball();
  const season = previousSeason(f.season, (f.manifest?.seasons || []).map((item) => item.id));
  const params = useMemo(() => {
    if (!season) return null;
    const context = Object.assign(Object.create(f), { season });
    return { ...playerReadParams(context, { cohort: true, limit: 100 }), ...cohortGroupParams(f.manifest, group) };
  }, [season, f, group]);
  const read = useCompactRead("players", params || {}, {
    enabled: Boolean(enabled && params),
    allPages: true,
    parallelPages: true,
    refreshManifest: f.refreshManifest,
    clock: params?.generation ? "" : compactGeneration(f.manifest),
  });
  const players = read.value?.data?.players;
  const result = useMemo(() => {
    if (!players) return null;
    const profiles = players.map((row) => row.profile);
    const own = profiles.find((item) => item.id === profile.id);
    if (!own) return { missing: true };
    const cohorts = buildCohorts(profiles, minMinutes);
    return {
      profile: own,
      enough: own.minutes >= minMinutes,
      values: Object.fromEntries(keys.map((key) => [key, percentileOf(own, key, cohorts)])),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [players, profile.id, minMinutes, keys.join()]);
  return { season, loading: read.loading, error: read.error, result };
}
