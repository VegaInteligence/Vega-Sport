import { rankMetric } from "./scouting.js";
import { percentile } from "./player-profile.js";

const OUTFIELD = [
  ["goals", "Buts"],
  ["assists", "Passes décisives"],
  ["chancesCreated", "Occasions créées"],
  ["shotsOnTarget", "Tirs cadrés"],
  ["duelsWon", "Duels gagnés"],
  ["recoveries", "Récupérations"],
];
const KEEPER = [
  ["saves", "Arrêts"],
  ["goalsPrevented", "Buts évités"],
  ["passesAccurate", "Passes réussies"],
  ["recoveries", "Récupérations"],
  ["clearances", "Dégagements"],
  ["touches", "Ballons touchés"],
];
export function overviewRadarValues(profile, cohorts) {
  const axes = profile?.role?.group === "G" ? KEEPER : OUTFIELD;
  return axes.map(([key, label]) => {
    const rank = rankMetric(profile, key, cohorts);
    const values =
      cohorts.groups.get(profile?.role?.group)?.distributions[key] || [];
    const enoughPeers = values.length >= cohorts.minPeers;
    const hasPeers = values.length > 0;
    const ownAvailable =
      Number.isFinite(rank.value) &&
      profile.minutes >= cohorts.minMinutes &&
      rank.count === profile.matches &&
      rank.minutes === profile.minutes;
    const value = ownAvailable ? rank.value : null;
    const mean = hasPeers
      ? values.reduce((sum, item) => sum + item, 0) / values.length
      : null;
    const minimum = hasPeers ? Math.min(0, values[0], value ?? 0) : null;
    const maximum = hasPeers ? Math.max(0, values.at(-1), value ?? 0) : null;
    return {
      key,
      label,
      value,
      mean,
      percentile: rank.percentile,
      meanPercentile: enoughPeers ? percentile(values, mean) : null,
      minimum,
      maximum,
      peers: rank.peers,
    };
  });
}
