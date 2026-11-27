/**
 * The calendar's week (FAILURE_MODES § 86, piste A of https://claude.ai/artifact/Uw76VAiFvpWqZoUowgt52o): which week
 * and day an address opens, the reads of one week (/api/fixtures by pages of 50) and how a day is laid out.
 */
import { europeFocusIds, EUROPE_FOCUS } from "../../../shared/competition-scope.js";
import { readFixtureBody } from "./match-pages.js";
import { notifyPublicationChanged } from "./publication-change.js";
import { fixtureWeek, parisDay, shiftDay, validDay } from "./fixtures.js";
import { LIVE_SPAN_MS } from "./live-client.js";

/** Pages of a week read before it is taken as cut (8 × 50 = 400 matches). */
export const WEEK_PAGES = 8;
export const WEEK_LIMIT = 50;

/** The first and last days of a season by its chunks (startDate, endDate), or null. */
export function seasonBounds(manifest, season) {
  const chunks = manifest?.seasons?.find((s) => s.id === season)?.chunks || [];
  let start = null,
    end = null;
  for (const chunk of chunks) {
    const from = chunk.meta?.startDate,
      to = chunk.meta?.endDate;
    if (validDay(from) && (!start || from < start)) start = from;
    if (validDay(to) && (!end || to > end)) end = to;
  }
  return start && end ? { start, end } : null;
}

/**
 * The week and the day an address opens: `day` when valid; else the Monday of `week` (the former address), its day
 * to be the week's first day with matches unless today is in it (`pick`); else today, kept within the season.
 */
export function calendarPlace({ day, week, today, bounds }) {
  const clamp = (value) =>
    bounds ? (value < bounds.start ? bounds.start : value > bounds.end ? bounds.end : value) : value;
  if (validDay(day)) return { week: fixtureWeek(day), day, pick: false };
  if (validDay(week)) {
    const w = fixtureWeek(week);
    return today >= w.start && today <= w.end
      ? { week: w, day: today, pick: false }
      : { week: w, day: null, pick: true };
  }
  const chosen = clamp(today);
  return { week: fixtureWeek(chosen), day: chosen, pick: chosen !== today };
}

/** The read of a week (or of one day: `range`), with the page's scope, search and season. */
export function weekFilters({ manifest, season, focus, league = "all", query = "", range }) {
  const europe = europeFocusIds(manifest);
  if (focus === "europe" && league !== "all" && !europe.has(league)) return null;
  // The provider's day is the UTC date: a Paris Monday can start on Sunday (UTC).
  const filters = {
    season,
    status: "all",
    from: shiftDay(range.start, -1),
    to: range.end,
    limit: String(WEEK_LIMIT),
  };
  if (league !== "all") filters.league = league;
  else if (focus === "europe") filters.leagues = [...europe].sort().join(",");
  if (query.trim()) filters.q = query.trim();
  return filters;
}

/**
 * The matches of a read, its cursors followed up to `pages` pages. A cursor of a former publication refused (409) or
 * a page of another publication: the read starts again from its first page, once (the site re-reads its manifest);
 * refused again → { publicationUnsettled: true }. `complete` false when the pages ran out before the matches;
 * `last` the provider's day of the last match read.
 */
export async function readWeek(filters, { signal, fetcher = fetch, pages = WEEK_PAGES } = {}) {
  if (!filters) return { matches: [], complete: true, generation: null, last: null };
  for (let attempt = 0; attempt < 2; attempt++) {
    const matches = [];
    let cursor = null,
      generation = null,
      complete = false,
      changed = false;
    for (let page = 0; page < pages; page++) {
      const body = await readFixtureBody(filters, cursor, { signal, fetcher });
      if (!body || (generation !== null && body.pagination.generation !== generation)) {
        changed = true;
        break;
      }
      generation = body.pagination.generation;
      matches.push(...body.data.matches);
      cursor = body.pagination.nextCursor;
      if (!cursor) {
        complete = true;
        break;
      }
    }
    if (!changed)
      return {
        matches,
        complete,
        generation,
        last: matches.at(-1)?.date || null,
      };
    notifyPublicationChanged();
  }
  return { publicationUnsettled: true };
}

// The Paris day and kick-off of a fixture (its provider's date without a usable time).
export function fixtureMoment(fixture) {
  const parsed =
    typeof fixture.time_utc === "string" && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(fixture.time_utc)
      ? Date.parse(fixture.time_utc)
      : NaN;
  const kickoff = Number.isFinite(parsed) ? parsed : null;
  return { kickoff, day: kickoff === null ? fixture.date : parisDay(kickoff) };
}

const OVER = new Set(["finished", "postponed", "canceled", "abandoned"]);
/**
 * A row's state at `now`: "over" with a score (finished), "off" for a match postponed, canceled or abandoned, "live"
 * while the feed plays it or, still not started by the feed, during the site's live window (tickState), else "upcoming".
 */
export function fixtureState(fixture, kickoff, now) {
  if (fixture.status === "finished") return "over";
  if (OVER.has(fixture.status)) return "off";
  if (fixture.status === "in_play") return "live";
  if (kickoff !== null && kickoff < now && now <= kickoff + LIVE_SPAN_MS) return "live";
  if (kickoff !== null && kickoff + LIVE_SPAN_MS < now) return "stale";
  return "upcoming";
}

/** The week's matches by Paris day (each a list ordered by kick-off), duplicates and other weeks left out. */
export function byDay(matches, week) {
  const days = new Map(),
    seen = new Set();
  for (const fixture of matches || []) {
    if (!fixture?.id || seen.has(fixture.id)) continue;
    seen.add(fixture.id);
    const { kickoff, day } = fixtureMoment(fixture);
    if (!validDay(day) || day < week.start || day > week.end) continue;
    if (!days.has(day)) days.set(day, []);
    days.get(day).push({ fixture, kickoff, day });
  }
  for (const list of days.values())
    list.sort((a, b) => (a.kickoff ?? Infinity) - (b.kickoff ?? Infinity) || a.fixture.id.localeCompare(b.fixture.id));
  return days;
}

/** The Paris days a cut read covered whole: those before the provider's day of its last match. */
export function coveredDay(day, read) {
  return Boolean(read?.complete || (read?.last && day < read.last));
}

// The UEFA cups first, then the seven leagues, then the others by name (the mock-up's order).
const ORDER = [
  "l_0bfbkO",
  "l_38d9HA",
  "l_2WZ2tt",
  ...EUROPE_FOCUS.filter((c) => c.country !== "UEFA").map((c) => c.id),
];
/**
 * A day's matches by competition: [{ id, entries }], followed competitions (`followed`, a Set) first; within one, a
 * favourite club's match first (`favourite(fixture)`), then by kick-off.
 */
export function groupByCompetition(entries, { followed = new Set(), favourite = () => false, name = (id) => id } = {}) {
  const groups = new Map();
  for (const entry of entries) {
    const id = entry.fixture.league?.id || entry.fixture.leagueId || "";
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(entry);
  }
  const rank = (id) => {
    const i = ORDER.indexOf(id);
    return i < 0 ? ORDER.length : i;
  };
  return [...groups]
    .sort(
      ([a], [b]) =>
        Number(followed.has(b)) - Number(followed.has(a)) ||
        rank(a) - rank(b) ||
        String(name(a)).localeCompare(String(name(b)), "fr"),
    )
    .map(([id, list]) => ({
      id,
      entries: list
        .map((entry, i) => ({ entry, i, lead: favourite(entry.fixture) }))
        .sort((a, b) => Number(b.lead) - Number(a.lead) || a.i - b.i)
        .map(({ entry }) => entry),
    }));
}

/** The matchday a group's matches share (« 13 »), or null. */
export function sharedRound(entries) {
  const rounds = new Set(entries.map((e) => String(e.fixture.round_name || "")));
  const [only] = rounds;
  return rounds.size === 1 && /^\d+$/.test(only) ? only : null;
}

const WEEKDAYS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const SHORT = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];
const MONTHS = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
];
const SHORT_MONTHS = [
  "janv.",
  "févr.",
  "mars",
  "avr.",
  "mai",
  "juin",
  "juil.",
  "août",
  "sept.",
  "oct.",
  "nov.",
  "déc.",
];
const noon = (day) => new Date(`${day}T12:00:00Z`);
const capital = (text) => text.charAt(0).toUpperCase() + text.slice(1);

/** « Vendredi 27 novembre », « Aujourd’hui 27 novembre ». */
export function dayTitle(day, today) {
  const d = noon(day);
  return `${day === today ? "Aujourd’hui" : capital(WEEKDAYS[d.getUTCDay()])} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}
/** « mercredi 2 décembre » (in a sentence). */
export function dayInSentence(day) {
  const d = noon(day);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}
export const shortWeekday = (day) => SHORT[noon(day).getUTCDay()];
export const dayNumber = (day) => String(noon(day).getUTCDate());
/** « 23 – 29 nov. 2026 », « 30 nov. – 6 déc. 2026 ». */
export function weekTitle(week) {
  const a = noon(week.start),
    b = noon(week.end);
  const first =
    a.getUTCMonth() !== b.getUTCMonth() ? `${a.getUTCDate()} ${SHORT_MONTHS[a.getUTCMonth()]}` : `${a.getUTCDate()}`;
  return `${first} – ${b.getUTCDate()} ${SHORT_MONTHS[b.getUTCMonth()]} ${b.getUTCFullYear()}`;
}
export const plural = (n, word) => `${n} ${word}${n > 1 ? "s" : ""}`;
