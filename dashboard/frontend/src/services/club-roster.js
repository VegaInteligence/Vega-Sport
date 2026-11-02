import { positionOf } from "./player-profile.js";

export const ROSTER_GROUPS = [
  ["G", "Gardiens"],
  ["D", "Défenseurs"],
  ["M", "Milieux"],
  ["A", "Attaquants"],
  ["unknown", "Poste non renseigné"],
];

/** Keep the most recent documented position for each player in this club. */
export function clubRoster(appearances, clubId) {
  const latest = new Map();
  for (const row of appearances) {
    if (row.teamId !== clubId || !row.playerId) continue;
    const previous = latest.get(row.playerId);
    const role = positionOf(row);
    if (
      !previous ||
      (role && !previous.role) ||
      (Boolean(role) === Boolean(previous.role) &&
        (row.date || "").localeCompare(previous.row.date || "") > 0)
    )
      latest.set(row.playerId, { row, role });
  }
  const groups = Object.fromEntries(ROSTER_GROUPS.map(([key]) => [key, []]));
  for (const entry of latest.values()) {
    const label = entry.role?.label;
    const group =
      label === "Gardien"
        ? "G"
        : label === "Défenseur"
          ? "D"
          : label === "Milieu" || label === "Milieu offensif"
            ? "M"
            : label === "Attaquant"
              ? "A"
              : "unknown";
    groups[group].push(entry);
  }
  for (const rows of Object.values(groups))
    rows.sort((a, b) =>
      (a.row.name || "").localeCompare(b.row.name || "", "fr"),
    );
  return groups;
}
