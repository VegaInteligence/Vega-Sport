/* A player's last matches for the bubble of « Compositions » before the kick-off (FAILURE_MODES § 70): his season
 * read over every club competition, the matches he played, and four figures chosen by his line. */
import { compactGeneration } from "./compact-reads.js";
import { shortCompetition } from "./home-insights.js";

export const RECENT_MATCHES = 5;
// A few more than five: an appearance on the bench without minutes, and the match itself, are listed too.
export const RECENT_READ = 12;
// A grade is shown from 20 minutes, as on the rest of the site.
const GRADE_MINUTES = 20;
// A clean sheet counts from 60 minutes on the pitch.
const CLEAN_SHEET_MINUTES = 60;

export const LINE_LABEL = { G: "Gardien", D: "Défenseur", M: "Milieu", A: "Attaquant" };

/** The line of a PitchAPI position id (the API's positionLineSql), the attacking midfielder as a forward. */
export function positionLine(id) {
  if (!Number.isInteger(id)) return null;
  if (id === 0 || id === 11) return "G";
  if (id === 1 || (id >= 30 && id < 40) || id === 51 || id === 59) return "D";
  if (id === 2 || (id >= 50 && id < 80)) return "M";
  if (id === 3 || (id >= 80 && id < 120)) return "A";
  return null;
}

/** The season read of one player over every competition, newest first. */
export function recentParams(manifest, id, season) {
  return { season, player: id, leagues: "all", limit: RECENT_READ, generation: compactGeneration(manifest) };
}

export const recentKey = (params) => `player-recent:${params.player}:${params.season}:${params.generation}`;

const fr = (value, digits = 0) =>
  value.toLocaleString("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const has = (value) => typeof value === "number" && Number.isFinite(value);

/** The sum of a figure over the matches, or null when no match carries it. */
function total(matches, ...keys) {
  let seen = false, sum = 0;
  for (const m of matches)
    for (const key of keys)
      if (has(m[key])) {
        seen = true;
        sum += m[key];
      }
  return seen ? sum : null;
}

const count = (value) => (value == null ? "–" : fr(value));
const share = (part, whole) => (part == null || !whole ? "–" : `${fr((100 * part) / whole)} %`);

function tilesOf(line, matches) {
  const passes = share(total(matches, "passesAccurate"), total(matches, "passesAttempted"));
  if (line === "G") {
    const prevented = total(matches, "goalsPrevented");
    const known = matches.filter((m) => has(m.goalsConceded));
    return [
      { label: "Arrêts", value: count(total(matches, "saves")) },
      { label: "Buts encaissés", value: count(total(matches, "goalsConceded")) },
      { label: "Buts évités", value: prevented == null ? "–" : `${prevented >= 0 ? "+" : ""}${fr(prevented, 1)}` },
      {
        label: "Sans encaisser",
        value: known.length
          ? `${known.filter((m) => m.goalsConceded === 0 && m.minutes >= CLEAN_SHEET_MINUTES).length} / ${matches.length}`
          : "–",
      },
    ];
  }
  if (line === "D") {
    const won = total(matches, "duelsWon"), lost = total(matches, "duelsLost");
    return [
      { label: "Duels gagnés", value: share(won, (won ?? 0) + (lost ?? 0)) },
      { label: "Tacles + interc.", value: count(total(matches, "tackles", "interceptions")) },
      { label: "Dégagements", value: count(total(matches, "clearances")) },
      { label: "Passes réussies", value: passes },
    ];
  }
  if (line === "M") {
    const goals = total(matches, "goals"), assists = total(matches, "assists");
    return [
      { label: "Passes réussies", value: passes },
      { label: "Occasions créées", value: count(total(matches, "chancesCreated")) },
      { label: "Récupérations", value: count(total(matches, "recoveries")) },
      { label: "Buts · passes d.", value: goals == null && assists == null ? "–" : `${goals ?? 0} · ${assists ?? 0}` },
    ];
  }
  if (line === "A") {
    const xg = total(matches, "xg"), shots = total(matches, "shots"), onTarget = total(matches, "shotsOnTarget");
    return [
      { label: "Buts", value: count(total(matches, "goals")) },
      { label: "Passes d.", value: count(total(matches, "assists")) },
      { label: "xG", value: xg == null ? "–" : fr(xg, 1) },
      { label: "Tirs cadrés", value: shots == null ? "–" : `${onTarget ?? 0} / ${shots}` },
    ];
  }
  return [];
}

/** The most frequent line of the matches read (a substitute's id 1/2/3 names his line too). */
function usualLine(appearances) {
  const counts = new Map();
  for (const a of appearances) {
    const line = positionLine(a.positionId);
    if (line) counts.set(line, (counts.get(line) || 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

/**
 * The bubble's figures from a /api/read/player answer: the RECENT_MATCHES newest appearances with minutes, the
 * match itself left out; `line` from the line-up's position id, else from his matches.
 */
export function recentForm(body, { playerId, matchId, positionId } = {}) {
  const names = new Map((body?.competitions || []).map((c) => [c.id, c.name]));
  const own = (body?.appearances || []).filter((a) => !playerId || !a.playerId || a.playerId === playerId);
  const line = positionLine(positionId) || usualLine(own);
  const played = own
    .filter((a) => a.matchId !== matchId && has(a.minutes) && a.minutes > 0)
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || String(b.matchId).localeCompare(String(a.matchId)))
    .slice(0, RECENT_MATCHES);
  const matches = played.map((a) => ({
    ...a,
    competition: shortCompetition(a.leagueId, names.get(a.leagueId) || ""),
    grade: has(a.grade) && a.minutes >= GRADE_MINUTES ? a.grade : null,
  }));
  const graded = matches.filter((m) => m.grade != null);
  const weight = graded.reduce((sum, m) => sum + m.minutes, 0);
  return {
    line,
    matches,
    minutes: matches.reduce((sum, m) => sum + m.minutes, 0),
    grade: weight ? graded.reduce((sum, m) => sum + m.grade * m.minutes, 0) / weight : null,
    tiles: matches.length ? tilesOf(line, matches) : [],
  };
}
