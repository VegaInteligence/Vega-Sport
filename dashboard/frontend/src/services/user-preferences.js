/**
 * The shared user-preferences contract, site side (#69). The account API (VI-38, backend/account/**) stores it and
 * returns it as-is: GET / PUT /account/preferences. Doc: docs/PREFERENCES_UTILISATEUR.md.
 *
 * The site keeps its stores; the contract is a view of them:
 *   orion.preferences.v1                 focus, defaultSeason, favoriteLeagueIds, onboardingComplete, homeCountry,
 *                                        homePriority
 *   statarena.research.v1                lists, activeList, views, templates, comparison, settings
 *   statarena.theme                      theme
 *   statarena.preferred-competition.v1   competition
 *
 * Complete example (version 1). Every key is always present; the value after "not chosen" is what it holds when the
 * visitor has chosen nothing.
 *
 * {
 *   "v": 1,                          // CONTRACT_VERSION; any other value is refused
 *   "focus": "all",                  // "europe" | "all"                         not chosen: "europe"
 *   "theme": "light",                // "light" | "dark" | null                  not chosen: null (dark is shown)
 *   "leagues": ["l_3FJFUl"],         // chosen competitions, /^l_[A-Za-z0-9]+$/, in order, at most 200
 *                                    //                                          not chosen: []
 *   "country": "FRA",                // three capitals | "none" | null           not chosen: null (detection applies)
 *                                    //   "none": the visitor chose « Aucun pays »; null: no manual choice
 *   "homePriority": "importance",    // "location" | "importance" | null         not chosen: null (the code's
 *                                    //   HOME_PRIORITY applies; carried, not applied yet: home-priority.js)
 *   "defaultSeason": "2026/2027",    // "YYYY/YYYY" | null                       not chosen: null (no UI writes it)
 *   "onboarded": true,               // the home's competition picker was answered   not chosen: false
 *   "competition": "l_3FJFUl",       // the competition /competitions opens on   not chosen: null (country rule)
 *   "lists": [                       // 1 to 50 lists; ids /^[\w-]{1,80}$/, unique; name at most 60 characters
 *     { "id": "main", "name": "Ma sélection", "entries": [   // at most 5000 entries, one per kind + id
 *       { "id": "t_aaaaa1", "kind": "clubs", "name": "Club", "season": "", "imageUrl": "" },
 *       { "id": "p_aaaab1", "kind": "players", "name": "Joueur", "season": "2026/2027",
 *         "imageUrl": "https://…",
 *         "scope": { "league": "all", "focus": "all", "role": "all", "venue": "all", "result": "all",
 *                    "from": "", "to": "" },          // players only (cleanSample); "leagues": [...] when set
 *         "replaces": true }                         // players only, present only when true
 *     ] }                            // kind: "clubs" t_… | "nations" t_… | "players" p_… | "matches" m_…
 *   ],                               //                                          not chosen: [{ main, « Ma sélection », [] }]
 *   "activeList": "main",            // the id of one of the lists               not chosen: the first list
 *   "views": [{ "id": "v1", "name": "Ailiers", "query": "pos=F&minutes=900", "settings": { … } }],
 *                                    // saved player searches, at most 50        not chosen: []
 *   "templates": [{ "id": "t1", "name": "Mon indice", "groups": ["F"], "minMinutes": 600,
 *                   "weights": [{ "key": "xg", "direction": "max", "weight": 2 }] }],
 *                                    // scouting indices, at most 50             not chosen: []
 *   "comparison": [ /* player entries with a season, at most 4 *\/ ],         not chosen: []
 *   "researchSettings": { "columns": [...], "scatter": { "x": "xg", "y": "xa" }, "comparisonMetrics": [...],
 *                         "index": { … } }   // cleanSettings               not chosen: EMPTY_RESEARCH.settings
 * }
 *
 * Not in the contract: `favourites`. favouritesOf(contract) derives it (the clubs and players of every list, 100 per
 * type, what the home sends to home-favourites); a `favourites` key, like any unknown key, is dropped.
 * Lists, entries, views, templates, comparison and researchSettings follow research-storage.js (cleanResearch), so
 * the site and the contract share one set of rules.
 */
import { cleanResearch } from "./research-storage.js";
import { HOME_PRIORITIES } from "./home-priority.js";

export const CONTRACT_VERSION = 1;
/** sessionStorage keys holding a visit's memory of the preferences (usePreselect.js): forgotten at sign-out. */
export const PRESELECT_KEY = "vega.preselect.v1";
export const VISIT_KEYS = Object.freeze([PRESELECT_KEY]);

/** The site's bounds (research-storage.js, the home's favourites, the API's identifiers()). */
export const LIMITS = Object.freeze({
  lists: 50,
  entries: 5000,
  leagues: 200,
  views: 50,
  templates: 50,
  comparison: 4,
  favourites: 100,
});

const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const LEAGUE = /^l_[A-Za-z0-9]+$/;
const COUNTRY = /^(?:[A-Z]{3}|none)$/;
const SEASON = /^\d{4}\/\d{4}$/;
const COMPETITION = /^[A-Za-z0-9_-]{1,80}$/;
const THEMES = ["light", "dark"];
const PRIORITIES = Object.values(HOME_PRIORITIES);
const pick = (value, pattern) => (typeof value === "string" && pattern.test(value) ? value : null);
const list = (value) => (Array.isArray(value) ? value : []);

function research(value) {
  try {
    return cleanResearch({ ...value, version: 1, lists: list(value.lists) });
  } catch {
    return cleanResearch({ version: 1, lists: [] });
  }
}

/** Any value → a version-1 contract with every key, invalid values at « not chosen ». Never throws. */
function canonical(value) {
  const c = isObject(value) ? value : {};
  const r = research({
    lists: c.lists,
    activeList: c.activeList,
    views: c.views,
    templates: c.templates,
    comparison: c.comparison,
    settings: c.researchSettings,
  });
  return {
    v: CONTRACT_VERSION,
    focus: c.focus === "all" ? "all" : "europe",
    theme: THEMES.includes(c.theme) ? c.theme : null,
    leagues: [...new Set(list(c.leagues).filter((id) => pick(id, LEAGUE)))].slice(0, LIMITS.leagues),
    country: pick(c.country, COUNTRY),
    homePriority: PRIORITIES.includes(c.homePriority) ? c.homePriority : null,
    defaultSeason: pick(c.defaultSeason, SEASON),
    onboarded: c.onboarded === true,
    competition: pick(c.competition, COMPETITION),
    lists: r.lists,
    activeList: r.activeList,
    views: r.views,
    templates: r.templates,
    comparison: r.comparison,
    researchSettings: r.settings,
  };
}

/** The account's value → a contract, or an Error: not an object, or not version 1. */
export function validateContract(value) {
  if (!isObject(value)) throw new Error("Préférences non reconnues.");
  if (value.v !== CONTRACT_VERSION) throw new Error(`Version de préférences non reconnue : ${value.v}.`);
  return canonical(value);
}

/** The site's stores → the contract. Never throws: a damaged store gives its « not chosen » values. */
export function toContract({ preferences, research: stored, theme, competition } = {}) {
  const p = isObject(preferences) ? preferences : {};
  const r = isObject(stored) ? stored : {};
  return canonical({
    focus: p.focus,
    theme,
    leagues: p.favoriteLeagueIds,
    country: p.homeCountry,
    homePriority: p.homePriority,
    defaultSeason: p.defaultSeason,
    onboarded: p.onboardingComplete,
    competition,
    lists: r.lists,
    activeList: r.activeList,
    views: r.views,
    templates: r.templates,
    comparison: r.comparison,
    researchSettings: r.settings,
  });
}

/** The contract → the site's stores, in their own shapes ("" is the stores' « not chosen »). */
export function fromContract(contract) {
  const c = canonical(contract);
  return {
    preferences: {
      focus: c.focus,
      defaultSeason: c.defaultSeason || "",
      favoriteLeagueIds: c.leagues,
      onboardingComplete: c.onboarded,
      homeCountry: c.country || "",
      homePriority: c.homePriority || "",
    },
    research: cleanResearch({
      version: 1,
      lists: c.lists,
      activeList: c.activeList,
      views: c.views,
      templates: c.templates,
      comparison: c.comparison,
      settings: c.researchSettings,
    }),
    theme: c.theme,
    competition: c.competition,
  };
}

/** Derived, read-only: the clubs and players of every list, once each, sorted, 100 per type. Never stored. */
export function favouritesOf(contract) {
  const entries = list(contract?.lists).flatMap((l) => list(l?.entries));
  const of = (kind) =>
    [...new Set(entries.filter((e) => e?.kind === kind && typeof e.id === "string").map((e) => e.id))]
      .sort()
      .slice(0, LIMITS.favourites);
  return { clubs: of("clubs"), players: of("players") };
}

/**
 * The sync seam, no React. `read()` gives the current contract (or null while the stores are not there), `write`
 * applies one to the stores. `changed()` is called on every change of the stores.
 * - No adapter: changed() does nothing (no read, no timer, no request).
 * - setAdapter({ load, save }): load() once; a contract it returns is validated and written once; null (no account
 *   data) writes nothing. Until load answers, nothing is saved; a failed load is tried again on the next change. A
 *   contract the site cannot read (another version) is never overwritten: the sync stops for that adapter.
 * - Saves are debounced (`delay`), never concurrent, of the latest state; a change during a save saves again after
 *   it. Nothing is saved when the state is what was last saved or applied. A failed save is retried on the next
 *   change. Nothing here throws to the caller.
 * - The first-sign-in merge (local data vs the account's) is not here: VI-38's adapter owns it.
 *
 * The adapter's contract (VI-38):
 * - `load()` resolves with the account's contract, or null / undefined when it has none; a rejection is a failed
 *   load (tried again on the next change).
 * - `save(contract)` resolves with undefined / null (saved as sent), or with a contract to re-apply (another device
 *   wrote first: the adapter reloaded, merged and rewrote, and hands the result back); a rejection is a failed save.
 *   A returned contract is validated and written exactly as after load, and becomes the saved state, so writing it
 *   saves nothing again. Rule for a local change made while that save was in flight: per top-level key, a key whose
 *   local value differs from the value sent keeps the local value, every other key takes the returned contract's;
 *   that is written, and saved next (debounced, once the stores hold it), on top of the returned contract.
 * - An invalid or other-version contract, from load or from save, is never written and goes to `report(error)`:
 *   the option given here, and the adapter's own optional `report` (setPreferencesSync({ load, save, report }), so
 *   the account screen can say that sync has stopped). Either may be absent; neither may throw into the sync.
 *   From load it stops the sync (the account's data is never overwritten); from save it is ignored (the save itself
 *   succeeded) and the sync goes on.
 */
export function createPreferencesSync({
  read,
  write,
  delay = 1000,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  report = () => {},
}) {
  let adapter = null, generation = 0, timer = null;
  let phase = "idle"; // idle | loading | ready | stopped
  let pending = false, saving = false, again = false, failed = false, last = null;

  const tell = (current, error) => {
    safely(report, error);
    if (typeof current?.report === "function") safely(current.report, error);
  };
  const cancel = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };
  const schedule = () => {
    cancel();
    timer = setTimer(() => ((timer = null), flush()), delay);
  };
  function load() {
    const run = generation, current = adapter;
    phase = "loading";
    Promise.resolve()
      .then(() => current.load())
      .then(
        (value) => {
          if (run !== generation) return;
          if (value != null) {
            let contract;
            try {
              contract = validateContract(value);
            } catch (error) {
              phase = "stopped";
              tell(current, error);
              return;
            }
            last = JSON.stringify(contract);
            try {
              write(contract);
            } catch {}
          }
          phase = "ready";
          if (pending) (pending = false), schedule();
        },
        () => {
          if (run === generation) phase = "idle";
        },
      );
  }
  // The contract save handed back: applied over the local changes made since `sent`. True when it was written.
  function reapply(answer, sent, current) {
    let contract;
    try {
      contract = validateContract(answer);
    } catch (error) {
      tell(current, error);
      return false;
    }
    let local = null;
    try {
      local = read();
    } catch {}
    const next = { ...contract };
    if (local)
      for (const key of Object.keys(next))
        if (JSON.stringify(local[key]) !== JSON.stringify(sent[key])) next[key] = local[key];
    last = JSON.stringify(contract);
    safely(write, next);
    return true;
  }
  function flush() {
    if (!adapter || phase !== "ready") return;
    if (saving) {
      again = true;
      return;
    }
    let value;
    try {
      value = read();
    } catch {
      return;
    }
    if (value == null) return;
    const json = JSON.stringify(value);
    if (json === last && !failed) return;
    const run = generation, current = adapter;
    saving = true;
    let applied = false;
    Promise.resolve()
      .then(() => current.save(value))
      .then(
        (answer) => {
          if (run !== generation) return;
          (last = json), (failed = false);
          if (answer != null) applied = reapply(answer, value, current);
        },
        () => run === generation && (failed = true),
      )
      .finally(() => {
        if (run !== generation) return;
        saving = false;
        // After a re-applied contract the stores update first: the next save waits for the debounce.
        if (applied) (again = false), schedule();
        else if (again) (again = false), flush();
      });
  }
  return {
    active: () => Boolean(adapter),
    setAdapter(next) {
      cancel();
      generation++;
      adapter = next && typeof next.load === "function" && typeof next.save === "function" ? next : null;
      (phase = "idle"), (pending = saving = again = failed = false), (last = null);
      if (adapter) load();
    },
    changed() {
      if (!adapter || phase === "stopped") return;
      if (phase === "idle") (pending = true), load();
      else if (phase === "loading") pending = true;
      else schedule();
    },
  };
}

function safely(fn, value) {
  try {
    fn(value);
  } catch {}
}

// The site's one controller. PreferencesSync.jsx connects the stores; VI-38 sets the adapter.
let bridge = null, waiting = null;
const site = createPreferencesSync({
  read: () => (bridge ? bridge.read() : null),
  write: (contract) => (bridge ? bridge.write(contract) : (waiting = contract)),
});

/**
 * VI-38: the account's { load, save, report? } once signed in, null when signed out. Without it nothing happens.
 * `report(error)`, optional: an invalid or other-version contract from load (sync stopped) or from save (ignored).
 */
export function setPreferencesSync(adapter) {
  waiting = null;
  site.setAdapter(adapter || null);
}

/** The stores, once both are loaded: { read, write }. A contract loaded before is written then. Returns the undo. */
export function connectPreferences(next) {
  bridge = next;
  if (waiting) {
    const contract = waiting;
    waiting = null;
    try {
      bridge.write(contract);
    } catch {}
  }
  site.changed();
  return () => {
    if (bridge === next) bridge = null;
  };
}

/**
 * VI-38, sign-out: the stores go back to « nothing chosen », so the next person on this browser does not inherit the
 * account's lists. `keep`: contract keys left as this browser has them (default: the theme, the device's look).
 * Only once signed out, after setPreferencesSync(null): with an adapter set nothing is written and false is returned,
 * so an emptied contract is never saved over an account. False too while the stores are not loaded.
 * The visit's memory (VISIT_KEYS, sessionStorage) is forgotten with it: one call puts everything back.
 */
export function clearPreferences({ keep = ["theme"] } = {}) {
  if (site.active() || !bridge) return false;
  waiting = null;
  const next = canonical({});
  try {
    const now = bridge.read();
    if (now) for (const key of list(keep)) if (key !== "v" && Object.hasOwn(next, key)) next[key] = now[key];
    bridge.write(canonical(next));
  } catch {
    return false;
  }
  try {
    for (const key of VISIT_KEYS) window.sessionStorage.removeItem(key);
  } catch {}
  return true;
}

/** Any change of a synced value (the stores' provider, the theme toggle, the competitions page). */
export function preferencesChanged() {
  site.changed();
}
