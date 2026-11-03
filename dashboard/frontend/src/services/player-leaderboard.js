/** Shared, season-scoped ranking definitions for home cards and the directory. */
export const PLAYER_RANKINGS = {
  goals: {
    label: "Buteurs",
    sort: { key: "goals", direction: "desc" },
    columns: ["goals", "xg"],
    eligible: (p) => Number.isFinite(p.goals) && p.goals > 0,
    compare: (a, b) => b.goals - a.goals || (b.xg || 0) - (a.xg || 0),
  },
  assists: {
    label: "Passeurs",
    sort: { key: "assists", direction: "desc" },
    columns: ["assists", "xa"],
    eligible: (p) => Number.isFinite(p.assists) && p.assists > 0,
    compare: (a, b) => b.assists - a.assists || (b.xa || 0) - (a.xa || 0),
  },
  clinical: {
    label: "Efficaces",
    sort: { key: "finishingDelta", direction: "desc" },
    columns: ["finishingDelta", "goals", "xg"],
    eligible: (p) => p.goals >= 4 && Number.isFinite(p.xg),
    compare: (a, b) => b.goals - b.xg - (a.goals - a.xg),
  },
  wasteful: {
    label: "Maladroits",
    sort: { key: "finishingDelta", direction: "asc" },
    columns: ["finishingDelta", "goals", "xg"],
    eligible: (p) => p.xg >= 3 && Number.isFinite(p.goals),
    compare: (a, b) => a.goals - a.xg - (b.goals - b.xg),
  },
};

export const playerRankingKey = (value) =>
  Object.hasOwn(PLAYER_RANKINGS, value) ? value : "";

export const playerLeagueIds = (value = "") =>
  [
    ...new Set(
      String(value)
        .split(",")
        .filter((id) => /^l_[A-Za-z0-9]+$/.test(id)),
    ),
  ].slice(0, 200);

export function rankSeasonPlayers(rows, key) {
  const ranking = PLAYER_RANKINGS[playerRankingKey(key)];
  return ranking
    ? rows
        .filter((row) => ranking.eligible(row.totals || row))
        .sort(ranking.compare)
    : rows;
}

export function playerLeaderboardHref(f, ranking, scopeIds) {
  const ids = scopeIds || [];
  return f.href("/joueurs/", {
    ranking: playerRankingKey(ranking),
    playersView: "table",
    basis: "total",
    season: f.season,
    league: ids.length === 1 ? ids[0] : "",
    leagues: ids.length > 1 ? ids.join(",") : "",
    minutes: "1",
    id: "",
    q: "",
    pos: "",
    role: "",
    venue: "",
    result: "",
    rmin: "",
    from: "",
    to: "",
    stats: "",
  });
}
