/* Where a player fits: his Vega index against the regulars at his position
 * in every club of a league.
 *
 * Index: the rail's « Indice Vega », the best role index of each player,
 * ranked against every player of the same position group in the cohort read
 * (Top 7 Europe + UEFA by default).
 * Squad level: minutes-weighted index of the club's regulars at that
 * position, the most used players, as many as a usual line-up fields.
 * Clubs come from the published clubs read, players from the cohort read. */
import { EUROPE_FOCUS } from "../../../shared/competition-scope.js";
import { roleAssessments } from "./scouting.js";

/** Index points either side of the squad level that still read « au niveau ». */
export const LEVEL_MARGIN = 5;
/** Below this many minutes a verdict can still move a lot. */
export const SHORT_SAMPLE_MINUTES = 900;
/** Regulars counted per position group in a usual line-up. */
export const REGULARS = { G: 1, D: 4, M: 3, O: 3 };

export const TIERS = [
  { id: "above", label: "Au-dessus du niveau de l’effectif" },
  { id: "level", label: "Au niveau de l’effectif" },
  { id: "below", label: "En dessous du niveau de l’effectif" },
  { id: "unknown", label: "Effectif non mesurable" },
];

/** Best role index of a profile, as shown in the identity rail. */
export function vegaIndex(profile, cohorts) {
  const best = roleAssessments(profile, cohorts).find(
    (role) => role.value != null,
  );
  return best ? { value: best.value, label: best.label, id: best.id } : null;
}

/** The seven Top 7 championships published for the season, in focus order. */
export function projectionLeagues(manifest, season) {
  const published = new Set(
    (manifest?.seasons || [])
      .find((item) => item.id === season)
      ?.chunks?.map((chunk) => chunk.leagueId) || [],
  );
  return EUROPE_FOCUS.filter(
    (league) => league.country !== "UEFA" && published.has(league.id),
  );
}

/** Championship of a club from the clubs read (its counted competitions). */
export function clubLeagueId(club, leagueIds) {
  return (
    Object.keys(club?.competitionCounts || {}).find((id) =>
      leagueIds.has(id),
    ) || null
  );
}

/** Championship of the player: his club's, else the first one he played in. */
export function homeLeagueId(clubs, profile, teamId, leagues) {
  const ids = new Set(leagues.map((league) => league.id));
  const own = clubLeagueId(
    clubs.find((club) => club.id === teamId),
    ids,
  );
  if (own) return own;
  return (profile.leagueIds || []).find((id) => ids.has(id)) || null;
}

const clubOf = (peer) => peer.latest?.teamId || peer.teamIds?.at(-1) || null;

/**
 * The clubs of one championship sorted into tiers, each with its players at
 * the position and the player's place among them.
 */
export function levelCompatibility({ profile, cohorts, clubs, teamId }) {
  const group = profile.role?.group;
  const peers = cohorts.groups.get(group)?.profiles || [];
  const own = vegaIndex(profile, cohorts);
  const value = own?.value ?? null;

  const byClub = new Map();
  for (const peer of peers) {
    if (peer.id === profile.id) continue;
    const club = clubOf(peer);
    if (!club) continue;
    if (!byClub.has(club)) byClub.set(club, []);
    byClub.get(club).push(peer);
  }
  const rows = clubs
    .filter((club) => club.id !== teamId)
    .map((club) => {
      const squad = (byClub.get(club.id) || [])
        .map((peer) => ({
          id: peer.id,
          name: peer.name,
          minutes: peer.minutes,
          index: vegaIndex(peer, cohorts),
        }))
        .filter((row) => row.index)
        .sort((a, b) => b.minutes - a.minutes);
      const regulars = squad.slice(0, REGULARS[group] || 3);
      const weight = regulars.reduce((sum, row) => sum + row.minutes, 0);
      const level = weight
        ? regulars.reduce(
            (sum, row) => sum + row.index.value * row.minutes,
            0,
          ) / weight
        : null;
      const gap = level == null || value == null ? null : value - level;
      return {
        id: club.id,
        name: club.name,
        imageUrl: club.imageUrl,
        squad,
        regulars: new Set(regulars.map((row) => row.id)),
        level,
        gap,
        tier:
          gap == null
            ? "unknown"
            : gap > LEVEL_MARGIN
              ? "above"
              : gap < -LEVEL_MARGIN
                ? "below"
                : "level",
        short:
          regulars.length > 0 &&
          weight / regulars.length < SHORT_SAMPLE_MINUTES,
        place:
          value == null
            ? null
            : squad.filter((row) => row.index.value > value).length + 1,
        depth: squad.length + 1,
      };
    })
    .sort(
      (a, b) =>
        (b.gap ?? -Infinity) - (a.gap ?? -Infinity) ||
        a.name.localeCompare(b.name, "fr"),
    );
  return {
    own,
    group,
    short: profile.minutes < SHORT_SAMPLE_MINUTES,
    clubs: rows,
    tiers: TIERS.map((tier) => ({
      ...tier,
      clubs: rows.filter((club) => club.tier === tier.id),
    })).filter((tier) => tier.clubs.length || tier.id !== "unknown"),
  };
}
