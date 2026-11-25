import useMatchSection from "./useMatchSection.js";

export default function useMatchPlayerStats(match) {
  const display = useMatchSection(match, "players/display");
  // Older deployments and archived match snapshots can still serve the base family.
  const base = useMatchSection(match, "players", Boolean(display.error));
  return display.error ? base : display;
}
