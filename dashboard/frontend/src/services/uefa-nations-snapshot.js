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
    competitions: [
      ...competitions.filter((item) => item.id !== selectedId),
      competition,
    ],
    teams: (value.teams || []).some((team) => team.id === TEAM)
      ? value.teams
      : [...(value.teams || []), { id: TEAM, name: "Espagne" }],
  };
}
