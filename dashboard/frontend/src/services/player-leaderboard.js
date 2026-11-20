import { MIN_GRADED_MATCHES } from "../../../shared/player-profile.js";
import { compareText } from "../model.js";

/**
 * The finishing gap's own sample (VI-23 B2): a profile's goals and xG on the matches that know
 * both. A total without a profile (home-insights.js) keeps its xG only when it covers every
 * appearance, but counts a missing goal as 0 (the home's convention, older than this branch): a
 * complete xG does not prove complete goals, and such a total's gap is read as given. Null
 * without a sample.
 */
const finishingSample = (row) => {
  if (row.profile) {
    const paired = row.profile.stats?.finishing;
    return paired?.count > 0 ? paired : null;
  }
  return Number.isFinite(row.goals) && Number.isFinite(row.xg)
    ? { goals: row.goals, xg: row.xg }
    : null;
};
const finishingGap = (row) =>
  Number.isFinite(row.finishingDelta) ? row.finishingDelta : row.goals - row.xg;

/** Shared, season-scoped ranking definitions for home cards and the directory. */
export const PLAYER_RANKINGS = {
  // The Vega score of the season (the power ranking): the site's main ranking of players.
  score: {
    label: "Score Vega",
    sort: { key: "score", direction: "desc" },
    columns: ["score", "matches"],
    eligible: (_totals, row) => Number.isFinite(row.score),
    compare: (a, b) =>
      b.score - a.score ||
      (b.matches || 0) - (a.matches || 0) ||
      compareText(a.name, b.name) ||
      compareText(a.playerId, b.playerId),
  },
  grade: {
    label: "Meilleures notes",
    sort: { key: "grade", direction: "desc" },
    columns: ["grade", "matches"],
    eligible: (_totals, row) =>
      Number.isFinite(row.grade) &&
      row.profile?.gradeCount >= MIN_GRADED_MATCHES,
    compare: (a, b) =>
      b.grade - a.grade ||
      b.profile.gradeCount - a.profile.gradeCount ||
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
    eligible: (_totals, row) => finishingSample(row)?.goals >= 4,
    compare: (a, b) => finishingGap(b) - finishingGap(a),
  },
  wasteful: {
    label: "Maladroits",
    sort: { key: "finishingDelta", direction: "asc" },
    columns: ["finishingDelta", "goals", "xg"],
    eligible: (_totals, row) => finishingSample(row)?.xg >= 3,
    compare: (a, b) => finishingGap(a) - finishingGap(b),
  },
};

export const playerRankingKey = (value) =>
  value === "all" || Object.hasOwn(PLAYER_RANKINGS, value) ? value : "";

export function playerDirectoryRanking(
  filters,
  defaults = false,
  compact = true,
) {
  if (filters.ranking) return filters.ranking === "all" ? "" : filters.ranking;
  return defaults &&
    !filters.query?.trim() &&
    filters.match === "all" &&
    filters.league === "all" &&
    !filters.leagues?.length
    ? compact
      ? "score"
      : "grade"
    : "";
}

// Explorer and Indices were replaced by Remplaçant and En forme (VI-39): their old links open
// Performances.
export const playerDirectoryView = (value) =>
  ["replace", "form", "lists"].includes(value) ? value : "table";

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
    gmin: "",
    from: "",
    to: "",
    stats: "",
  });
}
