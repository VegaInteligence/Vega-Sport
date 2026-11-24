/**
 * Which preference acts where (#69; doc docs/PREFERENCES_UTILISATEUR.md, « Quelle préférence agit où »). The owner's
 * twelve effects of 24 Nov 2026, numbered as he has them. Pages call these functions; none re-implements the order.
 *
 * One rule wherever two preferences meet: the visitor's favourites first, then their country, then the importance of
 * the match (HOME_PRIORITY keeps its meaning between country and importance: home-priority.js). A URL parameter or a
 * filter the visitor chose on the page always beats a preference. Nothing here adds an element: only an order, an
 * opening tab, the value an existing control starts on, or the highlight standings already give saved clubs.
 *
 * Favourites are the contract's (user-preferences.js, favouritesOf): the clubs and players of every list, sorted by
 * id. « The first favourite club » is the first of that order: the order the home cookie carries too, so the server's
 * render and the browser's agree (no jump).
 */
import { favouritesOf } from "./user-preferences.js";
import { HOME_PRIORITIES, priorityOf } from "./home-priority.js";
import { initialTitleRace } from "./home-country.js";
import { COUNTRY_LEAGUES, preferredCompetition } from "./competition-standings.js";

const EMPTY = Object.freeze({ clubs: [], players: [] });

/** The favourites of the research lists: { clubs: Set, players: Set, order: { clubs: [...], players: [...] } }. */
export function favouriteSets(lists) {
  const order = Array.isArray(lists) ? favouritesOf({ lists }) : { ...EMPTY };
  return { clubs: new Set(order.clubs), players: new Set(order.players), order };
}

/** The club ids of a result, a fixture or a billboard record. */
export function clubIdsOf(record) {
  const r = record?.fixture || record || {};
  return [
    r.home?.id ?? r.home_team?.id ?? r.teams?.home?.id ?? record?.home?.id,
    r.away?.id ?? r.away_team?.id ?? r.teams?.away?.id ?? record?.away?.id,
  ].filter(Boolean);
}
/** A match one of whose clubs is a favourite. */
export const involvesFavourite = (record, clubs) =>
  Boolean(clubs?.size) && clubIdsOf(record).some((id) => clubs.has(id));

const leagueOf = (record) =>
  record?.leagueId || record?.league?.id || record?.fixture?.league?.id || "";

/**
 * Effect 1 (and the rule): favourite first, then HOME_PRIORITY's order of country (`local`) and importance (`weight`,
 * a comparator). Unchanged semantics of the priority: "location" = local then weight, "importance" = weight then local.
 */
export function preferenceOrder({ favourite = () => false, local = () => false, weight = () => 0, priority } = {}) {
  const fav = (a, b) => Number(Boolean(favourite(b))) - Number(Boolean(favourite(a)));
  const loc = (a, b) => Number(Boolean(local(b))) - Number(Boolean(local(a)));
  return priorityOf(priority) === HOME_PRIORITIES.IMPORTANCE
    ? (a, b) => fav(a, b) || weight(a, b) || loc(a, b)
    : (a, b) => fav(a, b) || loc(a, b) || weight(a, b);
}

/** Favourites first, the rest in their order (stable). */
export function favouritesFirst(items, isFavourite) {
  const list = items || [];
  return [...list.filter((x) => isFavourite(x)), ...list.filter((x) => !isFavourite(x))];
}

/** Effect 3: favourites first within each run of the same day; the days and everything else keep their order. */
export function favouritesFirstWithinDay(items, dayOf, isFavourite) {
  return liftFavourites(items, dayOf, isFavourite);
}

/** Effect 7 (and 3): within each run of consecutive items of equal `keyOf`, favourites first; runs keep their order. */
export function liftFavourites(items, keyOf, isFavourite) {
  const out = [];
  let run = [],
    key;
  const flush = () => out.push(...favouritesFirst(run, isFavourite));
  for (const item of items || []) {
    const k = keyOf(item);
    if (run.length && k !== key) flush(), (run = []);
    key = k;
    run.push(item);
  }
  flush();
  return out;
}

/** The first division of a country (a base code: FRA, ENG…) in a catalogue of { id, name, country }; else null. */
export function countryLeague(catalog, country) {
  if (!country || !/^[A-Z]{3}$/.test(country)) return null;
  const local = (catalog || []).filter((c) => c?.country === country);
  if (!local.length) return null;
  const big = new Set(Object.values(COUNTRY_LEAGUES));
  return (
    local.find((c) => big.has(c.id)) ||
    local.find((c) => /(?:league|liga|division|ligue|série|serie)\s*(?:1|one|a)\b/i.test(c.name || "")) ||
    local[0]
  ).id;
}

/**
 * The league of the first favourite club (favourites order) found among `leagues` (Set of ids): the table holding
 * it, else a result / fixture of it in one of them (a cup match does not count), else its country's league
 * (`clubCountries`, the manifest's, through `countryLeagueOf`). null when none.
 */
export function favouriteClubLeague(
  clubs,
  { tables = [], matches = [], clubCountries = {}, leagues = null, countryLeagueOf = () => null } = {},
) {
  const among = leagues || new Set(tables.map((t) => t.leagueId));
  for (const club of clubs || []) {
    const table = tables.find((t) => (t.rows || []).some((row) => (row.id ?? row.teamId) === club));
    if (table && among.has(table.leagueId)) return table.leagueId;
    const match = (matches || []).find((m) => among.has(leagueOf(m)) && clubIdsOf(m).includes(club));
    if (match) return leagueOf(match);
    const byCountry = countryLeagueOf(clubCountries?.[club]);
    if (byCountry && among.has(byCountry)) return byCountry;
  }
  return null;
}

/** Effect 2: « Course au titre » opens on the favourite club's league, else the country's (as before), else the default. */
export function titleRaceOpening(tables = [], competitions = new Map(), { favouriteClubs = [], matches = [], clubCountries = {}, country = null } = {}) {
  const byCountry = (code) => tables.find((t) => code && competitions.get(t.leagueId)?.country === code)?.leagueId || null;
  return (
    favouriteClubLeague(favouriteClubs, { tables, matches, clubCountries, countryLeagueOf: byCountry }) ||
    initialTitleRace(tables, competitions, country)
  );
}

/**
 * Effects 4 and 11: the competition /competitions opens on. The visitor's saved choice, else the first favourite
 * club's league (its country's first division), else homeCountry's (not "none"), else as before (the detected
 * country / browser language, `detected`, ISO two letters).
 */
export function openingCompetition(catalog, { saved = null, favouriteClubs = [], clubCountries = {}, homeCountry = "", detected = null } = {}) {
  const available = new Set((catalog || []).map((c) => c.id));
  if (saved && available.has(saved)) return saved;
  for (const club of favouriteClubs || []) {
    const id = countryLeague(catalog, clubCountries?.[club]);
    if (id) return id;
  }
  const home = countryLeague(catalog, clubsCountry(homeCountry));
  if (home) return home;
  return preferredCompetition(catalog || [], null, detected);
}

/** Effect 8: the nations page opens on « Mes sélections » when a nation is saved. */
export const nationsOpeningScope = (savedCount) => (savedCount > 0 ? "saved" : "ranked");

/** Effect 9: the matches page's league filter starts on the first followed league. */
export const matchesLeague = (followed) => (Array.isArray(followed) && followed[0]) || null;
/** Effect 10: the players' league filter starts on the followed league when exactly one is followed. */
export const playersLeague = (followed) => (Array.isArray(followed) && followed.length === 1 ? followed[0] : null);
/** Effect 12: the visitor's country as a filter value; « Aucun pays » and no choice give none. */
export const clubsCountry = (homeCountry) =>
  typeof homeCountry === "string" && /^[A-Z]{3}$/.test(homeCountry) ? homeCountry : null;

/**
 * Effects 9, 10, 12: the value to preselect, or null. Never over a URL value, never after the visitor changed a
 * preselected value this visit, only a value the control offers (`options`, a Set; absent: any).
 */
export function preselect({ inUrl = false, cleared = false, candidate = null, options = null } = {}) {
  if (inUrl || cleared || !candidate) return null;
  if (options && !options.has(candidate)) return null;
  return candidate;
}

/**
 * The visit's memory of preselections ({ [key]: { applied, cleared } }, kept in sessionStorage by the hook):
 * `applied` records a preselection; a `current` value different from it marks the key cleared for the visit.
 */
export function preselectMemory(memory = {}, { key, applied, current } = {}) {
  const entry = memory[key];
  if (applied !== undefined) return { ...memory, [key]: { applied } };
  if (entry && !entry.cleared && current !== undefined && current !== entry.applied)
    return { ...memory, [key]: { ...entry, cleared: true } };
  return memory;
}

/** Effect 12, Power Ranking: the first club of the visitor's country (the page scrolls to it), else null. */
export function powerRankingTarget(rows, homeCountry) {
  const code = clubsCountry(homeCountry);
  if (!code) return null;
  return (rows || []).find((r) => r?.country === code)?.teamId || null;
}
