import { MIN_RATED_MATCHES } from "../../../shared/player-profile.js";
import { compareText } from "../model.js";

/** Shared, season-scoped ranking definitions for home cards and the directory. */
export const PLAYER_RANKINGS = {
  rating: {
    label: "Meilleures notes",
    sort: { key: "rating", direction: "desc" },
    columns: ["rating", "matches"],
    eligible: (_totals, row) =>
      Number.isFinite(row.rating) &&
      row.profile?.ratingCount >= MIN_RATED_MATCHES,
    compare: (a, b) =>
      b.rating - a.rating ||
      b.profile.ratingCount - a.profile.ratingCount ||
      compareText(a.name, b.name) ||
      compareText(a.playerId, b.playerId),
  },
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
  value === "all" || Object.hasOwn(PLAYER_RANKINGS, value) ? value : "";

export function playerDirectoryRanking(filters, defaults = false) {
  if (filters.ranking) return filters.ranking === "all" ? "" : filters.ranking;
  return defaults &&
    !filters.query?.trim() &&
    filters.match === "all" &&
    filters.league === "all" &&
    !filters.leagues?.length
    ? "rating"
    : "";
}

export const playerDirectoryView = (value) =>
  ["explore", "indices", "lists"].includes(value) ? value : "table";

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
        .filter((row) => ranking.eligible(row.totals || row, row))
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
