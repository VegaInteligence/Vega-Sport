// Official UEFA match statistics snapshot, retrieved 6 November 2026.
// https://matchstats.uefa.com/v1/player-statistics/{matchId}
// UEFA lineup identity 250176450 (2007-07-13, Spain 122) is matched to
// PitchAPI player p_2e0FPo and Spain t_486gYN in the AWS World Cup partition.
export const UEFA_NATIONS_ID = "uefa:2014";
const PLAYER = "p_2e0FPo";
const TEAM = "t_486gYN";
const fixtures = {
  "2026/2027": [
    ["2048018", "2026-09-26", 90, 1, 0],
    ["2047999", "2026-09-29", 68, 2, 1],
    ["2047971", "2026-10-03", 45, 1, 0],
    ["2047946", "2026-10-06", 78, 0, 0],
  ],
  "2024/2025": [
    ["2044949", "2025-06-08", 105, 0, 0],
    ["2043065", "2025-06-05", 90, 2, 0],
    ["2043060", "2025-03-23", 120, 1, 0],
    ["2043056", "2025-03-20", 66, 0, 0],
    ["2040116", "2024-10-12", 89, 0, 0],
    ["2040076", "2024-09-08", 45, 0, 1],
    ["2040049", "2024-09-05", 90, 0, 0],
  ],
};
const matchDetails = {
  2048018: ["39", "Angleterre", "122", "Espagne", 2, 3],
  2047999: ["122", "Espagne", "56370", "Croatie", 4, 1],
  2047971: ["122", "Espagne", "58837", "Tchéquie", 3, 1],
  2047946: ["56370", "Croatie", "122", "Espagne", 1, 2],
  2044949: ["110", "Portugal", "122", "Espagne", 2, 2],
  2043065: ["122", "Espagne", "43", "France", 5, 4],
  2043060: ["122", "Espagne", "95", "Pays-Bas", 3, 3],
  2043056: ["95", "Pays-Bas", "122", "Espagne", 2, 2],
  2040116: ["122", "Espagne", "35", "Danemark", 1, 0],
  2040076: ["128", "Suisse", "122", "Espagne", 1, 4],
  2040049: ["147", "Serbie", "122", "Espagne", 0, 0],
};
const teamId = (id) => (id === "122" ? TEAM : `uefa:${id}`);

export const uefaSnapshotSeasons = (id) =>
  id === PLAYER ? Object.keys(fixtures) : [];

function isNations(name) {
  return /\bnations\s+league\b|\bligue\s+des\s+nations\b/i.test(
    String(name || ""),
  );
}

/** Merge a dated, partial UEFA supplement; provider observations win per match date. */
export function addUefaNationsSnapshot(data, playerId, season) {
  if (playerId !== PLAYER || !Object.hasOwn(fixtures, season)) return data;
  const value = data || {
    appearances: [],
    competitions: [],
    teams: [],
    matches: [],
    fixtures: [],
  };
  const appearances = value.appearances || [];
  const competitions = value.competitions || [];
  const nationsCompetitions = competitions.filter((item) =>
    isNations(item.name),
  );
  const competitionIds = new Set(nationsCompetitions.map((item) => item.id));
  const playerRows = appearances.filter(
    (row) =>
      row.playerId === PLAYER &&
      row.teamId === TEAM &&
      (competitionIds.has(row.leagueId) || isNations(row.league)),
  );
  const native = nationsCompetitions.find((item) =>
    playerRows.some((row) => row.leagueId === item.id),
  );
  const selectedId = native?.id || UEFA_NATIONS_ID;
  const observedDates = new Set(
    playerRows
      .filter((row) => Number.isFinite(row.minutes) && row.minutes > 0)
      .map((row) => row.date),
  );
  const rows = fixtures[season]
    .filter(([, date]) => !observedDates.has(date))
    .map(([match, date, minutes, goals, assists]) => ({
      id: `uefa:${match}:250176450`,
      playerId: PLAYER,
      name: "Lamine Yamal",
      matchId: `uefa:${match}`,
      date,
      teamId: TEAM,
      team: "Espagne",
      leagueId: selectedId,
      league: native?.name || "Ligue des Nations",
      season,
      minutes,
      goals,
      assists,
    }));
  if (!rows.length) return value;
  const competition = {
    ...native,
    id: selectedId,
    name: native?.name || "Ligue des Nations",
    country: native?.country || "INT",
    sourceLabel: "UEFA",
    sourceUrl:
      season === "2024/2025"
        ? "https://www.uefa.com/news-media/mediaservices/informationkits/competitions/uefanationsleague/2025/match/2044949/"
        : "https://www.uefa.com/uefanationsleague/teams/players/250176450--lamine-yamal/",
    snapshotAt: "2026-11-06",
    partial: true,
  };
  const suppliedDates = new Set(rows.map((row) => row.date));
  const unresolved = new Set(
    playerRows.filter((row) => suppliedDates.has(row.date)),
  );
  return {
    ...value,
    appearances: [
      ...appearances.filter((row) => !unresolved.has(row)),
      ...rows,
    ],
    matches: [
      ...(value.matches || []),
      ...rows
        .filter(
          (row) =>
            !(value.matches || []).some((match) => match.id === row.matchId),
        )
        .map((row) => {
          const id = row.matchId.slice(5);
          const [homeId, homeName, awayId, awayName, homeScore, awayScore] =
            matchDetails[id];
          return {
            id: row.matchId,
            date: row.date,
            season,
            leagueId: selectedId,
            league: native?.name || "Ligue des Nations",
            sourceUrl: `https://www.uefa.com/uefanationsleague/match/${id}/`,
            home: { id: teamId(homeId), name: homeName, score: homeScore },
            away: { id: teamId(awayId), name: awayName, score: awayScore },
          };
        }),
    ],
    competitions: [
      ...competitions.filter((item) => item.id !== selectedId),
      competition,
    ],
    teams: (value.teams || []).some((team) => team.id === TEAM)
      ? value.teams
      : [...(value.teams || []), { id: TEAM, name: "Espagne" }],
  };
}
