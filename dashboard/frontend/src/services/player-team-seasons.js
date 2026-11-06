import { aggregateSeason } from "./season-player.js";
import {
  FEATURED_EUROPE_IDS,
  FEATURED_LEAGUE_IDS,
} from "./competition-selector.js";

// These IDs are also identified as national-team competitions in CupDirectory.
const NATIONAL_COMPETITIONS = new Set([
  "l_1XLtP0",
  "open-cup:euro",
  "openligadb:nations-league",
  "open-cup:world-cup-history",
]);
const CLUB_COMPETITIONS = new Set([
  ...FEATURED_EUROPE_IDS,
  ...FEATURED_LEAGUE_IDS,
  "open-cup:club-world-cup",
]);
const TEAM_ORDER = { club: 0, selection: 1, unknown: 2 };

function competitionKind(id) {
  if (NATIONAL_COMPETITIONS.has(id)) return "selection";
  if (CLUB_COMPETITIONS.has(id)) return "club";
  return "unknown";
}

/** Group only actual, played appearances by provider team ID and native season. */
export function playerTeamSeasons(history) {
  return history.flatMap(({ season, data, profile }) => {
    const teams = new Map((data?.teams || []).map((team) => [team.id, team]));
    const groups = new Map();
    // profile.rows has already passed aggregateSeason's played-match and duplicate checks.
    for (const row of profile?.rows || []) {
      if (!row.teamId) continue;
      if (!groups.has(row.teamId)) groups.set(row.teamId, []);
      groups.get(row.teamId).push(row);
    }
    return [...groups]
      .map(([teamId, rows]) => {
        const kinds = new Set(
          rows
            .map((row) => competitionKind(row.leagueId))
            .filter((kind) => kind !== "unknown"),
        );
        const kind = kinds.size === 1 ? [...kinds][0] : "unknown";
        const teamInfo = teams.get(teamId) || {
          id: teamId,
          name: rows[0].team || "Équipe inconnue",
        };
        return {
          key: JSON.stringify([season, teamId]),
          season,
          teamKey: teamId,
          teamId,
          team: teamInfo.name || rows[0].team || "Équipe inconnue",
          teamInfo,
          kind,
          profile: aggregateSeason(rows, profile.id),
        };
      })
      .sort((a, b) => {
        return (
          TEAM_ORDER[a.kind] - TEAM_ORDER[b.kind] ||
          a.teamKey.localeCompare(b.teamKey)
        );
      });
  });
}
