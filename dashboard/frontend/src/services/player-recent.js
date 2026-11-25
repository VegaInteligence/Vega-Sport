/* A player's last matches for the bubble of « Compositions » before the kick-off (FAILURE_MODES § 71): his season
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

export const recentKey = (params, matchId = "") => `player-recent:${params.player}:${params.season}:${params.generation}:${matchId}`;

// The read pages by date without looking at minutes: a reserve's newest entries can all be benches. At most four
// pages (48 matches, most of a season).
export const RECENT_PAGES = 4;

const playedIn = (appearances, matchId) =>
  appearances.filter((a) => a.matchId !== matchId && has(a.minutes) && a.minutes > 0).length;

/**
 * The season read, page after page, until RECENT_MATCHES matches played (the match itself left out), the last page,
 * or RECENT_PAGES. `read(params, { signal, recover })` answers one page (readCompact). The pages after the first are
 * pinned to the publication that answered it and never recovered alone: a publication change between pages moves
 * their boundaries, so it restarts the whole read, once.
 */
export async function readRecent(read, params, { matchId, signal } = {}) {
  try {
    return await readPages(read, params, { matchId, signal });
  } catch (error) {
    if (error?.status !== 409 || signal?.aborted) throw error;
    return readPages(read, params, { matchId, signal });
  }
}

async function readPages(read, params, { matchId, signal }) {
  const first = await read(params, { signal });
  const data = first?.data || first || {};
  const appearances = [...(data.appearances || [])];
  const competitions = new Map((data.competitions || []).map((c) => [c.id, c]));
  const pages = Number.isInteger(first?.pagination?.pages) ? first.pagination.pages : 1;
  // The publication that answered page 1, even when the read recovered from an older pin.
  const generation =
    first?.meta?.servedGeneration || first?.pagination?.generation || first?.meta?.generation || params.generation;
  const seen = new Set(appearances.map((a) => a.id).filter(Boolean));
  for (let page = 2; page <= Math.min(pages, RECENT_PAGES) && playedIn(appearances, matchId) < RECENT_MATCHES; page += 1) {
    signal?.throwIfAborted?.();
    const next = await read({ ...params, generation, page }, { signal, recover: false });
    const more = next?.data || next || {};
    for (const a of more.appearances || []) {
      if (a.id && seen.has(a.id)) continue;
      if (a.id) seen.add(a.id);
      appearances.push(a);
    }
    for (const c of more.competitions || []) if (!competitions.has(c.id)) competitions.set(c.id, c);
  }
  return { ...first, data: { ...data, appearances, competitions: [...competitions.values()] } };
}

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
  const accurate = total(matches, "passesAccurate"), attempted = total(matches, "passesAttempted");
  const passes = accurate == null || attempted == null ? "–" : share(accurate, attempted);
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
      // A share needs both parts: an unknown half is never read as zero.
      { label: "Duels gagnés", value: won == null || lost == null ? "–" : share(won, won + lost) },
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
      { label: "Buts · passes d.", value: goals == null || assists == null ? "–" : `${goals} · ${assists}` },
    ];
  }
  if (line === "A") {
    const xg = total(matches, "xg"), shots = total(matches, "shots"), onTarget = total(matches, "shotsOnTarget");
    return [
      { label: "Buts", value: count(total(matches, "goals")) },
      { label: "Passes d.", value: count(total(matches, "assists")) },
      { label: "xG", value: xg == null ? "–" : fr(xg, 1) },
      { label: "Tirs cadrés", value: shots == null || onTarget == null ? "–" : `${onTarget} / ${shots}` },
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
