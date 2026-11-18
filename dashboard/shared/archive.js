import { normalizeText } from "./archive-text.js";
import {
  historicalPair,
  historicalScore,
  historicalScoreNotes,
} from "./openfootball-history.js";
// The published reading: the baseline's own files (8018e0836c), byte for byte (FAILURE_MODES.md §22).
import {
  buildArchiveSeason as legacyBuildArchiveSeason,
  teamSimilarity as legacyTeamSimilarity,
} from "./legacy-8018e08/archive.js";

/**
 * One archive per season: the results archive gives the match list, the goals
 * archive is attached to each match it can be matched to (same day ±1, both
 * team names compatible). Goal-only matches (seasons or competitions absent
 * from the results archive) are kept as their own rows.
 */

const STOPWORDS = new Set(
  "fc sc sv ac as afc cf cd ud sd rc rcd ss us ssc vfb vfl vfr tsg bsc fk sk nk if bk ff club de la le les el du der des di do da real sporting athletic atletico calcio united city town".split(
    " ",
  ),
);

const tokenCache = new Map();
function teamTokens(name) {
  const key = String(name || "");
  let tokens = tokenCache.get(key);
  if (tokens) return tokens;
  if (tokenCache.size > 50000) tokenCache.clear();
  tokens = normalizeText(key)
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(
      (token) =>
        token.length > 1 && !/^\d+$/.test(token) && !STOPWORDS.has(token),
    );
  tokenCache.set(key, tokens);
  return tokens;
}

function tokenMatch(a, b) {
  if (a === b) return 2;
  const short = a.length < b.length ? a : b,
    long = a.length < b.length ? b : a;
  return short.length >= 3 && long.startsWith(short) ? 1 : 0;
}

/** 0 when the two team names cannot be the same club, higher when closer. */
function rawTokens(name) {
  return normalizeText(name)
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((token) => token.length > 1 && !/^\d+$/.test(token));
}

export function teamSimilarity(left, right) {
  let a = teamTokens(left),
    b = teamTokens(right);
  // "Athletic Club" only has generic words: compare them as written.
  if (!a.length || !b.length) {
    a = rawTokens(left);
    b = rawTokens(right);
  }
  if (!a.length || !b.length) {
    const x = normalizeText(left).replace(/[^a-z0-9]/g, ""),
      y = normalizeText(right).replace(/[^a-z0-9]/g, "");
    return x && x === y ? 2 : 0;
  }
  if (a.join(" ") === b.join(" ")) return 3;
  let best = 0;
  for (const x of a) for (const y of b) best = Math.max(best, tokenMatch(x, y));
  if (!best) {
    const x = a.join(""),
      y = b.join("");
    if (x.length >= 4 && y.length >= 4 && (x.includes(y) || y.includes(x)))
      best = 1;
  }
  return best;
}

const MATCH_LABEL = /^(.*?) vs\. (.*?) (\d+):(\d+)(?: (.*))?$/;

function readLabel(text) {
  const found = MATCH_LABEL.exec(text);
  if (!found) return null;
  return {
    team1: found[1],
    team2: found[2],
    score: [Number(found[3]), Number(found[4])],
    suffix: (found[5] || "").trim(),
  };
}

/** A goal label's sides, score and suffix, whatever its layout whitespace (tabs, line breaks, NBSP). */
export function parseGoalMatch(label) {
  return readLabel(String(label || "").replace(/\s+/g, " ").trim());
}

/**
 * The reading the published goal-only keys were numbered with (whitespace kept): it numbers
 * groups forever, so a key never moves (FAILURE_MODES.md §20).
 */
export function legacyParseGoalMatch(label) {
  return readLabel(String(label || "").trim());
}

function shiftDay(day, delta) {
  const value = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(value.getTime())) return null;
  value.setUTCDate(value.getUTCDate() + delta);
  return value.toISOString().slice(0, 10);
}

function minuteValue(minute) {
  const [base, extra] = String(minute || "")
    .split("+")
    .map(Number);
  return (
    (Number.isFinite(base) ? base : 999) +
    (Number.isFinite(extra) ? extra / 100 : 0)
  );
}

export function orderedGoals(events) {
  return [...events].sort(
    (a, b) =>
      minuteValue(a.minute) - minuteValue(b.minute) ||
      (a.score?.[0] ?? 0) +
        (a.score?.[1] ?? 0) -
        ((b.score?.[0] ?? 0) + (b.score?.[1] ?? 0)),
  );
}

function goalGroups(goals, read = (event) => legacyParseGoalMatch(event.match)) {
  const groups = [];
  for (const league of goals?.competitions || []) {
    const byMatch = new Map();
    for (const event of league.events || []) {
      const parsed = read(event);
      // A match captured twice (e.g. mid-game then final) shares its teams.
      const id = parsed
        ? `${event.date}|${parsed.team1}|${parsed.team2}`
        : `${event.date}|${event.match}`;
      let group = byMatch.get(id);
      if (!group) {
        group = {
          league,
          date: event.date,
          label: event.match,
          team1: parsed?.team1 || event.match,
          team2: parsed?.team2 || "",
          parsed,
          events: [],
          sources: [],
          seen: new Set(),
        };
        byMatch.set(id, group);
        groups.push(group);
      } else if (
        parsed &&
        group.parsed &&
        parsed.score[0] + parsed.score[1] >
          group.parsed.score[0] + group.parsed.score[1]
      ) {
        group.parsed = parsed;
        group.label = event.match;
      }
      group.sources.push(event);
      const goal = `${event.minute}|${event.player}|${event.team}|${event.score?.join(":")}`;
      if (group.seen.has(goal)) continue;
      group.seen.add(goal);
      group.events.push(event);
    }
  }
  for (const group of groups) {
    group.events = orderedGoals(group.events);
    delete group.seen;
  }
  return groups;
}

// The German suffixes « n.V. » (after extra time) and « i.E. » (on penalties), as words: read
// case-insensitively without their dots they also matched the « ie » of « (Hinspiel 0:3) ».
const EXTRA_TIME = /(?<![A-Za-z])n\.\s?V\./;
const SHOOT_OUT = /(?<![A-Za-z])i\.\s?E\./;

function groupScore(group) {
  const last = group.events[group.events.length - 1]?.score;
  const suffix = group.parsed?.suffix || "";
  // "i.E." scores include the shoot-out: the last goal event is the match score.
  if (SHOOT_OUT.test(suffix) && Array.isArray(last)) return last;
  return group.parsed?.score || (Array.isArray(last) ? last : [null, null]);
}

function groupNotes(group) {
  const suffix = group.parsed?.suffix || "";
  const notes = [];
  if (EXTRA_TIME.test(suffix)) notes.push("après prolongation");
  if (SHOOT_OUT.test(suffix)) notes.push("tirs au but");
  return notes;
}

const folded = (name) =>
  normalizeText(name)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * The side a goal's team designates: the side named exactly (case, accents and punctuation folded),
 * else the closer by similarity; null when they tie (FAILURE_MODES.md §22).
 */
// OpenFootball's UEFA club competitions name each club with its association, « Real Madrid (ESP) » (FAILURE_MODES.md
// §23): in those rows only, a goal's team is compared with each name without that suffix, after the exact names.
const UEFA_RESULTS = /^\d{4}-\d{2}\/uefa\./;
const ASSOCIATION = /^(.*\S)\s+\(([A-Z]{3})\)$/;
const withoutAssociation = (name) => {
  const found = ASSOCIATION.exec(String(name || ""));
  return found ? folded(found[1]) : null;
};

export function goalSide(goal, match) {
  const team = folded(goal.team);
  if (team) {
    const home = team === folded(match.team1),
      away = team === folded(match.team2);
    if (home !== away) return home ? "home" : "away";
    if (!home && UEFA_RESULTS.test(match.competitionId || "")) {
      const h = withoutAssociation(match.team1) === team,
        a = withoutAssociation(match.team2) === team;
      if (h !== a) return h ? "home" : "away";
      if (h) return null; // one base name on both sides: unknown
    }
  }
  const h = teamSimilarity(goal.team, match.team1),
    a = teamSimilarity(goal.team, match.team2);
  return h > a ? "home" : a > h ? "away" : null;
}

/** The side the baseline's edition.mjs gave a goal: similarity alone. */
function legacySide(goal, match) {
  const h = legacyTeamSimilarity(goal.team, match.team1),
    a = legacyTeamSimilarity(goal.team, match.team2);
  return h > a ? "home" : a > h ? "away" : null;
}

/** The season as the corrected reading builds it, its goal-only keys numbered by the legacy groups. */
function correctedSeason(results, goals) {
  const competitions = new Map();
  const matches = [];
  for (const league of results?.competitions || []) {
    competitions.set(league.id, {
      id: league.id,
      name: league.name,
      country: league.country,
    });
    (league.matches || []).forEach((match, index) => {
      matches.push({
        key: `r:${league.id}:${index}`,
        competitionId: league.id,
        competition: league.name,
        country: league.country,
        date: match.date || "",
        dateNote: Boolean(match.dateNote),
        round: match.round || "",
        team1: match.team1 || "",
        team2: match.team2 || "",
        score: historicalScore(match),
        notes: historicalScoreNotes(match).filter(
          (note) => !note.startsWith("Source"),
        ),
        goals: null,
        raw: match,
      });
    });
  }
  // The legacy reading's groups number the keys; the corrected one reads a label laid out on several lines.
  const legacy = goalGroups(goals, (event) => legacyParseGoalMatch(event.match));
  const legacyOf = new Map();
  legacy.forEach((group, index) => {
    for (const event of group.sources) legacyOf.set(event, index);
  });
  const groups = goalGroups(goals, (event) => legacyParseGoalMatch(event.match) || parseGoalMatch(event.match));
  const used = attachGroups(matches, groups);
  const leagueVotes = new Map();
  for (const [group, match] of used) {
    match.goals = group.events;
    const votes = leagueVotes.get(group.league.id) || new Map();
    votes.set(match.competitionId, (votes.get(match.competitionId) || 0) + 1);
    leagueVotes.set(group.league.id, votes);
  }
  // A group's key: the legacy index of the constituent the legacy reading understood, else of its earliest.
  const keyOf = (group) => {
    const parts = [...new Set(group.sources.map((event) => legacyOf.get(event)))].sort((x, y) => x - y);
    const understood = parts.filter((index) => legacy[index].parsed);
    return `g:${group.league.id}:${group.date}:${(understood.length ? understood : parts)[0]}`;
  };
  const leagueTarget = new Map();
  for (const [leagueId, votes] of leagueVotes) {
    const [target] = [...votes].sort((a, b) => b[1] - a[1])[0] || [];
    if (target) leagueTarget.set(leagueId, target);
  }
  groups.forEach((group) => {
    if (used.has(group)) return;
    const target = leagueTarget.get(group.league.id);
    const id = target || `g:${group.league.id}`;
    if (!competitions.has(id))
      competitions.set(id, {
        id,
        name: group.league.calendarYear
          ? `${group.league.name} ${group.league.calendarYear}`
          : group.league.name,
        country: group.league.country,
      });
    const competition = competitions.get(id);
    matches.push({
      key: keyOf(group),
      competitionId: id,
      competition: competition.name,
      country: competition.country,
      date: group.date || "",
      dateNote: false,
      round: "",
      // A label no reading understands names no team: its raw text is shown instead.
      team1: group.parsed ? group.team1 : "",
      team2: group.parsed ? group.team2 : "",
      ...(!group.parsed && { unparsedLabel: group.label }),
      score: groupScore(group).map((value) =>
        Number.isInteger(value) ? value : null,
      ),
      notes: groupNotes(group),
      goals: group.events,
      raw: null,
    });
  });
  return { competitions: [...competitions.values()], matches };
}

const sameScore = (a, b) => (a?.[0] ?? null) === (b?.[0] ?? null) && (a?.[1] ?? null) === (b?.[1] ?? null);

/** Why the corrected rows of a unit whose keys did not move cannot replace the legacy ones; null when they can. */
function unitConflict(pairs) {
  for (const [old, now] of pairs) {
    const goalOnly = old.key.startsWith("g:");
    if (goalOnly && !sameScore(old.score, now.score)) return "score_change";
    if (goalOnly && old.notes.some((note) => !now.notes.includes(note))) return "note_removed";
    if ((now.goals?.length ?? 0) < (old.goals?.length ?? 0)) return "goals_lost";
    const sides = new Map((now.goals || []).map((goal) => [goal, goalSide(goal, now)]));
    for (const goal of old.goals || []) {
      const before = legacySide(goal, old);
      if (!before) continue;
      if (!sides.has(goal) || !sides.get(goal)) return "goal_side_lost";
      // A side read against a whole unread label is no established team: only a readable label's side is kept.
      if (old.team2 && sides.get(goal) !== before) return "goal_side_changed";
    }
  }
  return null;
}

/**
 * The season: the corrected rows where they keep the published keys, scores, notes and goal sides; otherwise
 * the unit's published rows, held with the reason (FAILURE_MODES.md §22). A unit is the rows of both readings
 * that share a goal event or a key. Nothing is absorbed: a merge the legacy reading did not make is held.
 */
export function buildArchiveSeason(results, goals) {
  const legacy = legacyBuildArchiveSeason(results, goals);
  const candidate = correctedSeason(results, goals);
  const parent = new Map();
  const find = (x) => {
    while (parent.get(x) !== x) x = parent.get(x);
    return x;
  };
  const join = (a, b) => {
    for (const x of [a, b]) if (!parent.has(x)) parent.set(x, x);
    const [ra, rb] = [find(a), find(b)];
    if (ra !== rb) parent.set(ra, rb);
  };
  const legacyRow = new Map();
  for (const m of legacy.matches) {
    join(m.key, m.key);
    for (const goal of m.goals || []) legacyRow.set(goal, m.key);
  }
  for (const m of candidate.matches) {
    join(m.key, m.key);
    for (const goal of m.goals || []) if (legacyRow.has(goal)) join(legacyRow.get(goal), m.key);
  }
  const units = new Map();
  const unit = (key) => {
    const root = find(key);
    if (!units.has(root)) units.set(root, { legacy: [], candidate: [] });
    return units.get(root);
  };
  for (const m of legacy.matches) unit(m.key).legacy.push(m);
  for (const m of candidate.matches) unit(m.key).candidate.push(m);

  const rows = [];
  const held = [];
  const withSides = (row, side) => ({ ...row, goals: row.goals && row.goals.map((goal) => ({ ...goal, side: side(goal, row) })) });
  for (const { legacy: old, candidate: now } of units.values()) {
    const oldKeys = old.map((m) => m.key).sort(),
      nowKeys = now.map((m) => m.key).sort();
    const byKey = new Map(now.map((m) => [m.key, m]));
    const reason = oldKeys.join("\n") !== nowKeys.join("\n")
      ? "absorption"
      : unitConflict(old.map((m) => [m, byKey.get(m.key)]));
    if (!reason) {
      for (const m of now) rows.push(withSides(m, goalSide));
      continue;
    }
    // The published rows stay. A results row keeps its own (results file) values and its published goals.
    for (const m of old) {
      if (m.key.startsWith("r:")) {
        rows.push({ ...withSides({ ...byKey.get(m.key), goals: m.goals }, legacySide), heldGoals: reason });
        continue;
      }
      const corrected = byKey.get(m.key);
      rows.push({
        ...withSides(m, legacySide),
        held: reason,
        ...(corrected && { candidate: { team1: corrected.team1, team2: corrected.team2, score: corrected.score, notes: corrected.notes } }),
      });
    }
    const events = [...old, ...now].flatMap((m) => m.goals || []);
    held.push({
      reason,
      legacy: oldKeys,
      candidate: nowKeys,
      labels: [...new Set(events.map((event) => event.match))].sort(),
      sources: [...new Set(events.filter((event) => event.sourceRow != null).map((event) => `${event.sourceFile}:${event.sourceRow}`))].sort(),
    });
  }
  // The published editions first, in their order, then any the corrected rows add.
  const competitions = new Map(legacy.competitions.map((c) => [c.id, c]));
  for (const c of candidate.competitions) if (!competitions.has(c.id)) competitions.set(c.id, c);
  const usedCompetitions = new Set(rows.map((m) => m.competitionId));
  rows.sort(
    (a, b) =>
      String(b.date).localeCompare(String(a.date)) ||
      a.key.localeCompare(b.key),
  );
  held.sort((a, b) => a.legacy[0].localeCompare(b.legacy[0]));
  return {
    season: results?.season || goals?.season || "",
    competitions: [...competitions.values()].filter((c) => usedCompetitions.has(c.id) || (results?.competitions || []).some((l) => l.id === c.id)),
    matches: rows,
    absorbed: [],
    held,
  };
}

/** {group: results match} of the goal groups each results match takes (same day or the next, teams and score). */
function attachGroups(matches, groups) {
  const byDate = new Map();
  for (const group of groups) {
    if (!byDate.has(group.date)) byDate.set(group.date, []);
    byDate.get(group.date).push(group);
  }
  const used = new Map();
  for (const match of matches) {
    if (!match.date) continue;
    let best = null,
      bestScore = 0;
    for (const delta of [0, -1, 1]) {
      const day = delta ? shiftDay(match.date, delta) : match.date;
      for (const group of byDate.get(day) || []) {
        if (used.has(group)) continue;
        const home = teamSimilarity(match.team1, group.team1);
        const away = teamSimilarity(match.team2, group.team2);
        if (!home || !away) continue;
        const [h, a] = groupScore(group);
        const sameScore = h === match.score[0] && a === match.score[1];
        // Partial name overlaps ("Wiener" / "Wien") need the score to agree.
        if (!sameScore && (home < 2 || away < 2)) continue;
        let score = home + away + (delta ? 0 : 1) + (sameScore ? 3 : 0);
        if (score > bestScore) {
          best = group;
          bestScore = score;
        }
      }
    }
    if (best) used.set(best, match);
  }
  return used;
}

export function archiveRows(season, competition = "all", query = "") {
  const needle = normalizeText(query).trim();
  return (season?.matches || []).filter((match) => {
    if (competition !== "all" && match.competitionId !== competition)
      return false;
    if (!needle) return true;
    if (normalizeText(`${match.team1} ${match.team2}`).includes(needle))
      return true;
    return Boolean(
      match.goals?.some((goal) => normalizeText(goal.player).includes(needle)),
    );
  });
}

/** Seasons from both archives, newest first, with the files each one needs. */
export function archiveSeasons(resultsIndex, goalsIndex) {
  const seasons = new Map();
  for (const entry of resultsIndex?.seasons || [])
    seasons.set(entry.id, { id: entry.id, results: entry, goals: null });
  for (const entry of goalsIndex?.seasons || []) {
    const current = seasons.get(entry.id) || {
      id: entry.id,
      results: null,
      goals: null,
    };
    current.goals = entry;
    seasons.set(entry.id, current);
  }
  return [...seasons.values()].sort((a, b) => b.id.localeCompare(a.id));
}

export const ARCHIVE_CSV_FIELDS = [
  "date",
  "competition",
  "round",
  "home",
  "home_goals",
  "away_goals",
  "away",
  "notes",
  "goal_events",
];

export function archiveCsvRow(match) {
  const [home, away] = match.score;
  return [
    match.date,
    match.competition,
    match.round,
    match.team1,
    home,
    away,
    match.team2,
    match.notes.join(" · "),
    match.goals?.length ?? "",
  ];
}

export { historicalPair };
