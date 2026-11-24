/**
 * The preference contract: the JSON the site's module (dashboard/frontend/src/services/
 * user-preferences.js, written by the home page work) reads and writes, and its mapping to the
 * tables of schema `account`. The whole mapping lives here, in two tables: FIELDS (the simple
 * preferences, one column each of account.preferences) and STRUCTURES (the version, the followed
 * competitions, the lists, the favourites). Aligning a key name with the site is one line here.
 * Failure modes: FAILURE_MODES.md, sections 5 (C1 to C13) and 6 (the merge, M1 to M11).
 *
 * The key names are provisional until the site's module lands (24 Nov 2026).
 * Pure: no base, no clock. Used by the front (to refuse early) and by the store (the last check).
 */

export const CONTRACT_VERSION = 1;
/** lists and entriesPerList: those the site applies locally; entries: all lists together, so an
 * account's export and every store call stay far below the 6 MB of a Lambda payload. */
export const LIMITS = { lists: 50, entriesPerList: 5000, entries: 20000, leagues: 200, listName: 60 };

/** codes: CONTRACT_INVALID, CONTRACT_VERSION, CONTRACT_LIMIT; `path` names the faulty value. */
export class ContractError extends Error {
  constructor(code, path, message) {
    super(message);
    this.code = code;
    this.path = path;
  }
}
const invalid = (path, what) => new ContractError("CONTRACT_INVALID", path, `${path || "the contract"}: ${what}`);
const limit = (path, max) => new ContractError("CONTRACT_LIMIT", path, `${path}: ${max} at most`);

// The shapes of sql/001_accounts.sql, so that a bad value is refused here, never by the base.
const IDS = {
  competition: /^l_[A-Za-z0-9]{1,24}$/,
  players: /^p_[A-Za-z0-9]{1,24}$/,
  clubs: /^t_[A-Za-z0-9]{1,24}$/,
  matches: /^m_[A-Za-z0-9]{1,24}$/,
};
const ENTRY_KINDS = ["players", "clubs", "matches"];
const LIST_ID = /^[A-Za-z0-9_-]{1,80}$/;
const SEASON = /^[0-9]{4}(\/[0-9]{4})?$/;
const CONTROL = /[\u0000-\u001f\u007f]/;

const oneOf = (...values) => (v) => values.includes(v);
const shaped = (pattern) => (v) => typeof v === "string" && pattern.test(v);
const isBoolean = (v) => typeof v === "boolean";
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const absent = (v) => v === undefined || v === null;
function onlyKeys(value, known, path) {
  for (const key of Object.keys(value)) if (!known.includes(key)) throw invalid(path ? `${path}.${key}` : key, "unknown key");
}

/**
 * The simple preferences. key: the JSON's; column: account.preferences'; valid: the column's
 * check; empty: the value of an absence (null, or the column's default); merge: "account" (the
 * account's value when it holds one, else the browser's) or "either" (true when one side is).
 */
export const FIELDS = [
  { key: "focus", column: "focus", valid: oneOf("europe", "all"), empty: "europe", merge: "account" },
  { key: "theme", column: "theme", valid: oneOf("light", "dark"), empty: null, merge: "account" },
  // The base's three-letter code, or "none" (« Aucun pays », a choice in itself).
  { key: "country", column: "country", valid: shaped(/^([A-Z]{3}|none)$/), empty: null, merge: "account" },
  { key: "homePriority", column: "home_priority", valid: oneOf("location", "importance"), empty: null, merge: "account" },
  { key: "preferredCompetition", column: "preferred_competition", valid: shaped(IDS.competition), empty: null, merge: "account" },
  { key: "onboardingComplete", column: "onboarding_complete", valid: isBoolean, empty: false, merge: "either" },
];

/** The favourites: every club and every player of the lists, in list then entry order, once each. */
function favouritesOf(lists) {
  const out = { clubs: [], players: [] };
  const seen = new Set();
  for (const list of lists)
    for (const entry of list.entries)
      if (entry.kind in out && !seen.has(`${entry.kind}:${entry.id}`)) {
        seen.add(`${entry.kind}:${entry.id}`);
        out[entry.kind].push(entry.id);
      }
  return out;
}

function parseEntry(entry, path) {
  if (!isObject(entry)) throw invalid(path, "an object is expected");
  onlyKeys(entry, ["kind", "id", "season"], path);
  if (!ENTRY_KINDS.includes(entry.kind)) throw invalid(`${path}.kind`, `one of ${ENTRY_KINDS.join(", ")}`);
  if (!shaped(IDS[entry.kind])(entry.id)) throw invalid(`${path}.id`, `not an id of ${entry.kind}`);
  if (!absent(entry.season) && !shaped(SEASON)(entry.season)) throw invalid(`${path}.season`, "a season such as 2025 or 2025/2026");
  return absent(entry.season) ? { kind: entry.kind, id: entry.id } : { kind: entry.kind, id: entry.id, season: entry.season };
}

function parseList(list, path, ids) {
  if (!isObject(list)) throw invalid(path, "an object is expected");
  onlyKeys(list, ["id", "name", "entries"], path);
  if (!shaped(LIST_ID)(list.id)) throw invalid(`${path}.id`, "letters, digits, - or _, 80 at most");
  if (ids.has(list.id)) throw invalid(`${path}.id`, "two lists have this id");
  ids.add(list.id);
  const length = typeof list.name === "string" ? [...list.name].length : 0;
  if (length < 1 || length > LIMITS.listName || CONTROL.test(list.name)) throw invalid(`${path}.name`, `1 to ${LIMITS.listName} characters, no control character`);
  if (!Array.isArray(list.entries)) throw invalid(`${path}.entries`, "a list is expected");
  if (list.entries.length > LIMITS.entriesPerList) throw limit(`${path}.entries`, LIMITS.entriesPerList);
  const seen = new Set(),
    entries = [];
  list.entries.forEach((entry, j) => {
    const parsed = parseEntry(entry, `${path}.entries[${j}]`);
    // A repeat is kept once, at its first place (C10).
    if (seen.has(`${parsed.kind}:${parsed.id}`)) return;
    seen.add(`${parsed.kind}:${parsed.id}`);
    entries.push(parsed);
  });
  return { id: list.id, name: list.name, entries };
}

/**
 * The structured keys. parse(value, contract): the normalised value; toRows / fromRows: its rows;
 * merge(account, browser): the merged value. `v` and `favourites` have no rows of their own.
 */
export const STRUCTURES = {
  v: {
    parse(value) {
      if (value !== CONTRACT_VERSION) throw new ContractError("CONTRACT_VERSION", "v", `v: version ${CONTRACT_VERSION} expected`);
      return CONTRACT_VERSION;
    },
  },
  // Followed competitions (favoriteLeagueIds in the browser): account.follows, kind competition, in order.
  leagues: {
    parse(value) {
      if (absent(value)) return [];
      if (!Array.isArray(value)) throw invalid("leagues", "a list is expected");
      if (value.length > LIMITS.leagues) throw limit("leagues", LIMITS.leagues);
      const seen = new Set();
      value.forEach((id, i) => {
        if (!shaped(IDS.competition)(id)) throw invalid(`leagues[${i}]`, "not a competition id");
        if (seen.has(id)) throw invalid(`leagues[${i}]`, "followed twice");
        seen.add(id);
      });
      return [...value];
    },
    toRows: (leagues) => leagues.map((entity_id, position) => ({ entity_id, position })),
    fromRows: (rows) => rows.map((row) => row.entity_id),
    // A field: the account's when it follows any, else the browser's (M6).
    merge: (account, browser) => (account.length ? account : browser),
  },
  // Manual lists (statarena.research.v1): account.lists keyed by client_id, account.list_entries.
  lists: {
    parse(value) {
      if (absent(value)) return [];
      if (!Array.isArray(value)) throw invalid("lists", "a list is expected");
      if (value.length > LIMITS.lists) throw limit("lists", LIMITS.lists);
      const ids = new Set();
      const lists = value.map((list, i) => parseList(list, `lists[${i}]`, ids));
      if (lists.reduce((n, list) => n + list.entries.length, 0) > LIMITS.entries) throw new ContractError("CONTRACT_LIMIT", "lists", `lists: ${LIMITS.entries} entries in all at most`);
      return lists;
    },
    toRows: (lists) =>
      lists.map((list, position) => ({
        client_id: list.id,
        name: list.name,
        position,
        entries: list.entries.map((entry, i) => ({ kind: entry.kind, entity_id: entry.id, season: entry.season ?? null, position: i })),
      })),
    fromRows: (rows) =>
      rows.map((row) => ({
        id: row.client_id,
        name: row.name,
        entries: row.entries.map((e) => (e.season === null || e.season === undefined ? { kind: e.kind, id: e.entity_id } : { kind: e.kind, id: e.entity_id, season: e.season })),
      })),
    // United by id; one list's entries united by (kind, id); the account's first (M7, M8).
    merge(account, browser) {
      const theirs = new Map(browser.map((list) => [list.id, list]));
      const merged = account.map((list) => {
        const other = theirs.get(list.id);
        if (!other) return list;
        const held = new Set(list.entries.map((e) => `${e.kind}:${e.id}`));
        return { ...list, entries: [...list.entries, ...other.entries.filter((e) => !held.has(`${e.kind}:${e.id}`))] };
      });
      const mine = new Set(account.map((list) => list.id));
      return [...merged, ...browser.filter((list) => !mine.has(list.id))];
    },
  },
  // Computed from the lists on read; on write only its shape is checked, its content ignored (C12).
  favourites: {
    parse(value) {
      if (absent(value)) return undefined;
      if (!isObject(value)) throw invalid("favourites", "an object is expected");
      onlyKeys(value, ["clubs", "players"], "favourites");
      return undefined;
    },
  },
};

const KNOWN = ["v", ...FIELDS.map((f) => f.key), "leagues", "lists", "favourites"];

/** The normalised contract of a JSON value, or a ContractError. */
export function parse(value) {
  if (!isObject(value)) throw invalid("", "a JSON object is expected");
  if (!Object.hasOwn(value, "v")) throw new ContractError("CONTRACT_VERSION", "v", `v: version ${CONTRACT_VERSION} expected`);
  STRUCTURES.v.parse(value.v);
  onlyKeys(value, KNOWN, "");
  const out = { v: CONTRACT_VERSION };
  for (const field of FIELDS) {
    const given = value[field.key];
    if (absent(given)) out[field.key] = field.empty;
    else if (field.valid(given)) out[field.key] = given;
    else throw invalid(field.key, "value not allowed");
  }
  STRUCTURES.favourites.parse(value.favourites);
  out.leagues = STRUCTURES.leagues.parse(value.leagues);
  out.lists = STRUCTURES.lists.parse(value.lists);
  out.favourites = favouritesOf(out.lists);
  return out;
}

/** The rows of a normalised contract: { preferences: {column: value}, leagues: [...], lists: [...] }. */
export function toRows(contract) {
  return {
    preferences: Object.fromEntries(FIELDS.map((f) => [f.column, contract[f.key]])),
    leagues: STRUCTURES.leagues.toRows(contract.leagues),
    lists: STRUCTURES.lists.toRows(contract.lists),
  };
}

/** The contract the rows hold, in the rows' order; null when the account never saved (no preferences row). */
export function fromRows(rows) {
  if (!rows?.preferences) return null;
  const out = { v: CONTRACT_VERSION };
  for (const field of FIELDS) out[field.key] = absent(rows.preferences[field.column]) ? field.empty : rows.preferences[field.column];
  out.leagues = STRUCTURES.leagues.fromRows(rows.leagues ?? []);
  out.lists = STRUCTURES.lists.fromRows(rows.lists ?? []);
  out.favourites = favouritesOf(out.lists);
  return out;
}

/**
 * The merge at the first sign-in on a device: `account` (null when it never saved) and `browser`,
 * both normalised. Field by field the account's value when it holds one, else the browser's;
 * lists united. The result is checked again (a union may pass a bound: CONTRACT_LIMIT).
 */
export function merge(account, browser) {
  if (!account) return browser;
  const out = { v: CONTRACT_VERSION };
  for (const field of FIELDS)
    out[field.key] = field.merge === "either" ? account[field.key] === true || browser[field.key] === true : absent(account[field.key]) ? browser[field.key] : account[field.key];
  out.leagues = STRUCTURES.leagues.merge(account.leagues, browser.leagues);
  out.lists = STRUCTURES.lists.merge(account.lists, browser.lists);
  return parse(out);
}
