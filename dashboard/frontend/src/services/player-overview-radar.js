import { rankMetric } from "./scouting.js";

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
  return axes.map(([key, label]) => ({
    key,
    label,
    percentile: rankMetric(profile, key, cohorts).percentile,
  }));
}
