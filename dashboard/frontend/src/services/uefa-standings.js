// PitchAPI competition IDs mapped to UEFA's official competition IDs.
export const UEFA_STANDINGS_COMPETITIONS = Object.freeze({
  l_0bfbkO: { id: "1", name: "Ligue des champions" },
  l_38d9HA: { id: "14", name: "Ligue Europa" },
  l_2WZ2tt: { id: "2019", name: "Ligue Conférence" },
});

export function uefaSeasonYear(season) {
  const match = /^(\d{4})\/(\d{4})$/.exec(String(season || ""));
  if (!match) return null;
  const start = Number(match[1]), end = Number(match[2]);
  return start >= 2021 && end === start + 1 ? end : null;
}

export function hasUefaStandings(competition, season) {
  return Object.hasOwn(UEFA_STANDINGS_COMPETITIONS, competition || "") &&
    uefaSeasonYear(season) !== null;
}

const integer = (value) => Number.isInteger(value) && Number.isFinite(value);

/** Preserve UEFA's official order and tie-breaks; never derive a table from knockout games. */
export function normalizeUefaStandings(payload, competition, season, clubIds = {}) {
  const config = UEFA_STANDINGS_COMPETITIONS[competition],
    year = uefaSeasonYear(season);
  if (!config || !year || !Array.isArray(payload)) return null;
  const groups = payload.filter((item) => item?.group?.phase === "TOURNAMENT");
  const expectedGroups = year >= 2025 ? 1 : 8;
  const expectedRows = year >= 2025 ? 36 : 4;
  if (groups.length !== expectedGroups) return null;
  const tables = [];
  for (const item of groups) {
    if (String(item.group.competitionId) !== config.id ||
        String(item.group.seasonYear) !== String(year) ||
        !Array.isArray(item.items) || item.items.length !== expectedRows)
      return null;
    const positions = new Set();
    const rows = item.items.map((row) => {
      const team = row?.team || {},
        name = team.translations?.displayName?.FR || team.internationalName,
        fields = [row.rank, row.played, row.won, row.drawn, row.lost,
          row.goalsFor, row.goalsAgainst, row.goalDifference, row.points];
      if (typeof name !== "string" || !name.trim() ||
          !fields.every(integer) || row.rank < 1 || row.rank > expectedRows ||
          row.played !== row.won + row.drawn + row.lost ||
          row.goalDifference !== row.goalsFor - row.goalsAgainst ||
          positions.has(row.rank)) return null;
      positions.add(row.rank);
      const uefaId = String(row.teamId || team.id || "");
      return {
        ...(clubIds[uefaId] ? { id: clubIds[uefaId] } : {}),
        uefaId,
        name: name.trim(),
        imageUrl: "",
        position: row.rank,
        played: row.played,
        wins: row.won,
        draws: row.drawn,
        losses: row.lost,
        goalsFor: row.goalsFor,
        goalsAgainst: row.goalsAgainst,
        difference: row.goalDifference,
        points: row.points,
      };
    });
    if (rows.some((row) => !row)) return null;
    rows.sort((a, b) => a.position - b.position);
    const rawName = item.group.metaData?.groupName || "";
    const name = expectedGroups === 1 ? "Phase de ligue" :
      rawName.replace(/^Group\s+/i, "Groupe ");
    tables.push({ name, rows });
  }
  return { competition: config.name, season, source: "UEFA", tables };
}
