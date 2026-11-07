import { playerCareerObservations } from "./player-career.js";
import { positionOf } from "./player-profile.js";
import { aggregateSeason, seasonMetric } from "./season-player.js";

// The documented formation lines are placed schematically on the pitch.
const LINES = {
  Gardien: { key: "G", shortLabel: "GAR", y: 90 },
  Défenseur: { key: "D", shortLabel: "DÉF", y: 72 },
  Milieu: { key: "M", shortLabel: "MIL", y: 51 },
  "Milieu offensif": { key: "AM", shortLabel: "MO", y: 32 },
  Attaquant: { key: "A", shortLabel: "ATT", y: 14 },
};

export function playerPositionSummary(history, id) {
  const groups = new Map();
  for (const { row } of playerCareerObservations(history, id)) {
    if (
      typeof row.minutes !== "number" ||
      !Number.isFinite(row.minutes) ||
      row.minutes <= 0
    )
      continue;
    const label = positionOf(row)?.label || "Poste inconnu";
    const line = LINES[label] || { key: "unknown", shortLabel: "—", y: null };
    if (!groups.has(line.key))
      groups.set(line.key, { label, ...line, rows: [] });
    groups.get(line.key).rows.push(row);
  }
  return [...groups.values()]
    .map(({ rows, label, key, shortLabel, y }) => {
      const profile = aggregateSeason(rows, id);
      const metric = (name) => {
        const { value, count } = seasonMetric(profile, name);
        return { value, count };
      };
      return {
        key,
        label,
        shortLabel,
        x: y === null ? null : 50,
        y,
        matches: profile.matches,
        goals: metric("goals"),
        assists: metric("assists"),
      };
    })
    .sort((a, b) => (b.y ?? -1) - (a.y ?? -1));
}
