import { normalizeText } from "./archive-text.js";
import {
  historicalPair,
  historicalScore,
  historicalScoreNotes,
} from "./openfootball-history.js";

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

export function parseGoalMatch(label) {
  const found = MATCH_LABEL.exec(String(label || "").trim());
  if (!found) return null;
  return {
    team1: found[1],
    team2: found[2],
    score: [Number(found[3]), Number(found[4])],
    suffix: (found[5] || "").trim(),
  };
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

function goalGroups(goals) {
  const groups = [];
  for (const league of goals?.competitions || []) {
    const byMatch = new Map();
    for (const event of league.events || []) {
      const parsed = parseGoalMatch(event.match);
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

function groupScore(group) {
  const last = group.events[group.events.length - 1]?.score;
  const suffix = group.parsed?.suffix || "";
  // "i.E." scores include the shoot-out: the last goal event is the match score.
  if (/i\.?\s*E\.?/i.test(suffix) && Array.isArray(last)) return last;
  return group.parsed?.score || (Array.isArray(last) ? last : [null, null]);
}

function groupNotes(group) {
  const suffix = group.parsed?.suffix || "";
  const notes = [];
  if (/n\.?\s*V\.?/i.test(suffix)) notes.push("après prolongation");
  if (/i\.?\s*E\.?/i.test(suffix)) notes.push("tirs au but");
  return notes;
}

export function buildArchiveSeason(results, goals) {
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

  const groups = goalGroups(goals);
  const byDate = new Map();
  for (const group of groups) {
    if (!byDate.has(group.date)) byDate.set(group.date, []);
    byDate.get(group.date).push(group);
  }
  const used = new Set();
  const leagueVotes = new Map();
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
    if (!best) continue;
    used.add(best);
    match.goals = best.events;
    const votes = leagueVotes.get(best.league.id) || new Map();
    votes.set(match.competitionId, (votes.get(match.competitionId) || 0) + 1);
    leagueVotes.set(best.league.id, votes);
  }

  // Goal leagues already covered by a results competition stay under it.
  const leagueTarget = new Map();
  for (const [leagueId, votes] of leagueVotes) {
    const [target] = [...votes].sort((a, b) => b[1] - a[1])[0] || [];
    if (target) leagueTarget.set(leagueId, target);
  }
  groups.forEach((group, index) => {
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
      key: `g:${group.league.id}:${group.date}:${index}`,
      competitionId: id,
      competition: competition.name,
      country: competition.country,
      date: group.date || "",
      dateNote: false,
      round: "",
      team1: group.team1,
      team2: group.team2,
      score: groupScore(group).map((value) =>
        Number.isInteger(value) ? value : null,
      ),
      notes: groupNotes(group),
      goals: group.events,
      raw: null,
    });
  });

  matches.sort(
    (a, b) =>
      String(b.date).localeCompare(String(a.date)) ||
      a.key.localeCompare(b.key),
  );
  return {
    season: results?.season || goals?.season || "",
    competitions: [...competitions.values()],
    matches,
  };
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
