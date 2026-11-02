import { positionOf } from "./player-profile.js";

export const ROSTER_GROUPS = [
  ["G", "Gardiens"],
  ["D", "Défenseurs"],
  ["M", "Milieux"],
  ["A", "Attaquants"],
  ["unknown", "Poste non renseigné"],
];

/** Keep each player's latest documented position and count matches played for this club. */
export function clubRoster(appearances, clubId) {
  const players = new Map();
  for (const row of appearances || []) {
    if (row.teamId !== clubId || !row.playerId) continue;
    const role = positionOf(row);
    let player = players.get(row.playerId);
    if (!player) {
      player = { row, role, matches: new Map() };
      players.set(row.playerId, player);
    } else if (
      (role && !player.role) ||
      (Boolean(role) === Boolean(player.role) &&
        (row.date || "").localeCompare(player.row.date || "") > 0)
    ) {
      player.row = row;
      player.role = role;
    }
    // Unused substitutes also occur in lineups. Count a player only when a
    // positive playing time is recorded, and count each match only once.
    if (
      row.matchId &&
      typeof row.minutes === "number" &&
      Number.isFinite(row.minutes) &&
      row.minutes > 0
    ) {
      const previous = player.matches.get(row.matchId);
      player.matches.set(row.matchId, {
        minutes: Math.max(previous?.minutes || 0, row.minutes),
        starter: Boolean(previous?.starter || row.starter === true),
      });
    }
  }
  const groups = Object.fromEntries(ROSTER_GROUPS.map(([key]) => [key, []]));
  for (const player of players.values()) {
    const label = player.role?.label;
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
    const { matches, ...entry } = player;
    const records = [...matches.values()];
    groups[group].push({
      ...entry,
      played: records.length,
      starts: records.filter((match) => match.starter).length,
      minutes: records.reduce((sum, match) => sum + match.minutes, 0),
    });
  }
  for (const rows of Object.values(groups)) {
    rows.sort(
      (a, b) =>
        b.played - a.played ||
        b.starts - a.starts ||
        b.minutes - a.minutes ||
        (a.row.name || "").localeCompare(b.row.name || "", "fr"),
    );
  }
  return groups;
}
