/**
 * The page of a match to come (FAILURE_MODES § 81): what its blocks read from the reads the page already makes (the
 * forecast and its grid, the competition's table, the two clubs' seasons before the kick-off, their absents).
 * Pure functions, and the table's read.
 */
import { json, useResource } from "./resources.js";
import { gradeOf } from "./grades.js";
import { isNumber } from "./format.js";
import { plainLeagueTable, resultDerived } from "./competition-standings.js";

/**
 * The competition's table as the API serves it, if the page may show it: the season in play, and a table computed from
 * the results only for a plain league phase, the Classement tab's own rule (split and play-off formats are withheld).
 */
export function previewTable(value, match) {
  if (!value?.tables?.length || (value.season && match?.season && String(value.season) !== String(match.season))) return null;
  if (resultDerived(value) && !plainLeagueTable({ id: match?.leagueId }, value.tables, match?.season)) return null;
  return value;
}

/** The competition's table for the match's page (`previewTable`); null while it loads, or without one. */
export function useCompetitionTable(match, enabled = true) {
  const id = match?.leagueId;
  const on = Boolean(enabled && id && match?.season);
  const resource = useResource(
    "preview-table:" + (id || "none"),
    () => json("/api/standings?" + new URLSearchParams({ competition: id })).catch(() => null),
    on,
  );
  return on ? previewTable(resource.value, match) : null;
}

/** A club's row of the table (its place, points…), or null. */
export function tableRow(table, clubId) {
  for (const t of table?.tables || []) {
    const row = t.rows?.find((r) => r.id === clubId);
    if (row && Number.isFinite(row.position)) return { ...row, table: t };
  }
  return null;
}

/** « 17ᵉ », « 1er ». */
export const place = (n) => (n === 1 ? "1er" : `${n}ᵉ`);

/** How long until the kick-off: « dans 35 min », « dans 4 h 55 », « dans 2 j »; null once it has passed. */
export function countdown(kickoff, now) {
  const at = Date.parse(kickoff || "");
  if (!Number.isFinite(at) || !Number.isFinite(now) || at <= now) return null;
  const minutes = Math.ceil((at - now) / 60000);
  if (minutes < 60) return `dans ${Math.max(1, minutes)} min`;
  if (minutes < 24 * 60) return `dans ${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")}`;
  return `dans ${Math.floor(minutes / (24 * 60))} j`;
}

/** A side's xG in a match: its statistic, else its own field. */
export function matchXg(match, side) {
  const row = match?.stats?.find((stat) => stat.key === "expected_goals");
  const value = row?.[side] ?? match?.[side]?.xg;
  return isNumber(value) ? value : null;
}

/**
 * A club's last `n` finished matches before the kick-off (newest first), with its xG for and against; none from a match
 * whose team statistics are flagged unreliable, which keeps its result (as `clubSummary` leaves it out of the season's).
 */
export function formMatches(club, n = 10) {
  return (club?.forms || []).slice(0, n).map((form) => {
    const other = form.side === "home" ? "away" : "home";
    const reliable = form.match.coverage?.teamStatsReliable !== false;
    return {
      ...form,
      opponent: form.match[other],
      xgFor: reliable ? matchXg(form.match, form.side) : null,
      xgAgainst: reliable ? matchXg(form.match, other) : null,
    };
  });
}

const mean = (values) => {
  const known = values.filter(isNumber);
  return known.length ? known.reduce((a, b) => a + b, 0) / known.length : null;
};

/** Means over a club's form: xG for and against, goals for and against. */
export function formMeans(rows) {
  return {
    xgFor: mean(rows.map((r) => r.xgFor)),
    xgAgainst: mean(rows.map((r) => r.xgAgainst)),
    goalsFor: mean(rows.map((r) => r.scoreFor)),
    goalsAgainst: mean(rows.map((r) => r.scoreAgainst)),
  };
}

const rowGrade = (row) => (isNumber(row.grade) ? row.grade : isNumber(row.gradeZ) ? gradeOf(row.gradeZ) : null);

/**
 * A club's player in form (§ 81.3): the best mean grade over his last five matches of the season played 30 minutes or
 * more before the kick-off, three such matches at least; ties to the most minutes. Null without one.
 */
export function inForm(data, club) {
  const valid = new Map((club?.games || []).filter((m) => m.status === "finished").map((m) => [m.id, m]));
  const byPlayer = new Map();
  for (const row of data?.appearances || []) {
    if (row.teamId !== club?.id || !valid.has(row.matchId) || !(row.minutes >= 30) || rowGrade(row) === null) continue;
    if (!byPlayer.has(row.playerId)) byPlayer.set(row.playerId, []);
    byPlayer.get(row.playerId).push(row);
  }
  let best = null;
  for (const [playerId, rows] of byPlayer) {
    const last = rows.sort((a, b) => String(b.date || "").localeCompare(String(a.date || ""))).slice(0, 5);
    if (last.length < 3) continue;
    const grade = mean(last.map(rowGrade));
    const minutes = last.reduce((t, r) => t + r.minutes, 0);
    if (!best || grade > best.grade || (grade === best.grade && minutes > best.minutes))
      best = { id: playerId, name: last[0].name || "Joueur", imageUrl: last[0].imageUrl, grade, minutes, matches: last.length };
  }
  return best;
}

export const SEASON_MINUTES = 300;

/** A season profile's goals or assists, when every match counted knows them. */
export const profileCount = (profile, key) => {
  const stat = profile?.stats?.[key];
  return stat && isNumber(stat.sum) ? stat.sum : null;
};

/** The model's grid read (§ 81.1): over 2.5 goals, both sides scoring, each side's goals 0 to 4 and 5+, the likeliest cell. */
export function gridReading(grid) {
  if (!Array.isArray(grid) || grid.length < 2 || !grid.every((row) => Array.isArray(row) && row.length === grid.length)) return null;
  let over = 0, both = 0, likely = [0, 0], top = -1;
  const home = grid.map((row) => row.reduce((a, b) => a + b, 0));
  const away = grid[0].map((_, j) => grid.reduce((t, row) => t + row[j], 0));
  grid.forEach((row, i) =>
    row.forEach((v, j) => {
      if (i + j > 2) over += v;
      if (i > 0 && j > 0) both += v;
      if (v > top) {
        top = v;
        likely = [i, j];
      }
    }),
  );
  return { over, both, home, away, likely, top, last: grid.length - 1 };
}

/** The table's rows around each club: two above, two below, the two slices joined when they meet. */
export function tableSlices(rows, ids, reach = 2) {
  const ordered = [...(rows || [])].filter((r) => Number.isFinite(r.position)).sort((a, b) => a.position - b.position);
  const marks = ids.map((id) => ordered.findIndex((r) => r.id === id)).filter((i) => i >= 0).sort((a, b) => a - b);
  const spans = [];
  for (const at of marks) {
    const lo = Math.max(0, at - reach), hi = Math.min(ordered.length - 1, at + reach);
    const last = spans.at(-1);
    if (last && lo <= last[1] + 1) last[1] = Math.max(last[1], hi);
    else spans.push([lo, hi]);
  }
  return spans.map(([lo, hi]) => ordered.slice(lo, hi + 1));
}
