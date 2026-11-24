// The shared user-preferences contract (site side; the account API of VI-38 stores and returns it as-is:
// GET / PUT /account/preferences). Written before dashboard/frontend/src/services/user-preferences.js.
//
// Failure modes and expected outcomes:
//  U1 A round-trip loses or changes a field → stores → contract → stores gives the same stores, and contract → stores
//     → contract the same contract, for every field of orion.preferences.v1, statarena.research.v1, the theme and the
//     preferred competition.
//  U2 A corrupted value (wrong type, bad id, unknown kind, null) breaks the contract or reaches the stores → it is
//     dropped to its "not chosen" value, the rest kept; a non-object or a missing `v` is refused.
//  U3 An oversized store or contract floods the account → the site's bounds: 50 lists, 5000 entries a list, 200
//     chosen leagues, 50 saved views, 50 templates, 4 compared players.
//  U4 A newer client's contract is half-read → an unknown `v` is refused; unknown keys of version 1 are dropped.
//  U5 "none" and "not chosen" are mixed up for the country → "none" (the visitor chose no country) and null (no
//     manual choice: detection applies) stay distinct both ways; the store's "" is null.
//  U6 homePriority is lost or applied → carried both ways ("location" | "importance" | null), stored in the
//     preferences store; the home does not read it (home-priority.js keeps its constant).
//  U7 The derived favourites are stored or sent → favouritesOf(contract) only: the clubs and players of every list,
//     once each, sorted, 100 per type (what the home sends to home-favourites); a `favourites` key is dropped, and
//     toContract never writes one.
//  Y1 Without an adapter, a change makes a network call or schedules work → nothing at all: no read, no timer.
//  Y2 Every change saves → saves are debounced: three quick changes, one save, of the latest state.
//  Y3 Two saves overlap and the older one lands last → never concurrent: a change during a save saves again after
//     it, with the latest state (last write wins).
//  Y4 The account's contract is applied twice, or echoed back as a save → applied once (validated) per adapter; the
//     change it causes in the stores is not saved again.
//  Y5 A failed save blocks the UI, throws, or is lost → nothing throws; it is retried on the next change.
//  Y6 Local data overwrites the account before its contract is read → no save before load answers; a failed load
//     is tried again on the next change; null (no account data) or an invalid contract writes nothing.
//  Y7 A removed adapter keeps saving → setAdapter(null) cancels the pending save and stops.
//  S1 The contract a save hands back (VI-38's 409 merge) is ignored, or applied twice → save resolving with an object
//     validates it and writes it once, exactly as after load (unknown keys dropped).
//  S2 Writing the returned contract echoes back as a save → no save follows it while nothing changes locally.
//  S3 undefined or null from save re-applies something → nothing is written (the behaviour before this extension).
//  S4 An invalid or other-version contract from save is written, throws, or stops the sync → ignored, reported to
//     `report` as a bad load is, and the next change still saves.
//  S5 A local change made while that save was in flight is lost under the returned contract → per top-level key, a
//     key whose local value changed since the save was sent keeps the local value, the others take the returned
//     contract's; that is written, then saved next (debounced), on top of the returned contract.
import test from "node:test";
import assert from "node:assert/strict";
import {
  CONTRACT_VERSION,
  LIMITS,
  createPreferencesSync,
  favouritesOf,
  fromContract,
  toContract,
  validateContract,
} from "../dashboard/frontend/src/services/user-preferences.js";
import { cleanResearch, EMPTY_RESEARCH } from "../dashboard/frontend/src/services/research-storage.js";

const entry = (kind, id, extra = {}) => ({ kind, id, name: id, season: "", imageUrl: "", ...(kind === "players" ? { scope: { league: "all", focus: "all", role: "all", venue: "all", result: "all", from: "", to: "" } } : {}), ...extra });
const STORES = {
  preferences: { focus: "all", defaultSeason: "2026/2027", favoriteLeagueIds: ["l_3FJFUl", "l_4WFCIZ"], onboardingComplete: true, homeCountry: "BRA", homePriority: "importance" },
  research: cleanResearch({
    version: 1,
    activeList: "scouting",
    lists: [
      { id: "main", name: "Ma sélection", entries: [entry("clubs", "t_aaaaa1"), entry("players", "p_aaaab1", { replaces: true, season: "2026/2027" })] },
      { id: "scouting", name: "Pistes", entries: [entry("nations", "t_bbbbb1"), entry("matches", "m_ccccc1"), entry("clubs", "t_aaaaa1")] },
    ],
    views: [{ id: "v1", name: "Ailiers", query: "pos=F&minutes=900" }],
    templates: [{ id: "t1", name: "Mon indice", groups: ["F"], minMinutes: 600, weights: [{ key: "xg", direction: "max", weight: 2 }] }],
    comparison: [entry("players", "p_aaaab1", { season: "2026/2027" })],
    settings: { columns: ["matches", "xg"] },
  }),
  theme: "light",
  competition: "l_3FJFUl",
};

test("U1 lossless round-trip, both ways", () => {
  const contract = toContract(STORES);
  assert.equal(contract.v, CONTRACT_VERSION);
  assert.deepEqual(fromContract(contract), STORES);
  assert.deepEqual(toContract(fromContract(contract)), contract);
  assert.deepEqual(validateContract(JSON.parse(JSON.stringify(contract))), contract);
  // The defaults round-trip too: nothing chosen.
  const empty = toContract({ preferences: {}, research: EMPTY_RESEARCH, theme: null, competition: null });
  assert.deepEqual(
    { focus: empty.focus, theme: empty.theme, leagues: empty.leagues, country: empty.country, homePriority: empty.homePriority, defaultSeason: empty.defaultSeason, onboarded: empty.onboarded, competition: empty.competition, activeList: empty.activeList },
    { focus: "europe", theme: null, leagues: [], country: null, homePriority: null, defaultSeason: null, onboarded: false, competition: null, activeList: "main" },
  );
  assert.deepEqual(toContract(fromContract(empty)), empty);
});

test("U2 corrupted values fall to « not chosen », the rest kept; non-objects refused", () => {
  const contract = validateContract({
    v: 1, focus: "everything", theme: "blue", leagues: ["l_3FJFUl", 42, "x", "l_3FJFUl"], country: "fra", homePriority: "both",
    defaultSeason: "2026", onboarded: "yes", competition: "../x", activeList: "nope",
    lists: [{ id: "main", name: "Ma sélection", entries: [{ kind: "clubs", id: "p_wrong" }, { kind: "teams", id: "t_aaaaa1" }, entry("clubs", "t_aaaaa1")] }, null, { id: "bad id!", entries: [] }],
  });
  assert.equal(contract.focus, "europe");
  assert.equal(contract.theme, null);
  assert.deepEqual(contract.leagues, ["l_3FJFUl"]);
  assert.equal(contract.country, null);
  assert.equal(contract.homePriority, null);
  assert.equal(contract.defaultSeason, null);
  assert.equal(contract.onboarded, false);
  assert.equal(contract.competition, null);
  assert.deepEqual(contract.lists.map((l) => [l.id, l.entries.map((e) => e.id)]), [["main", ["t_aaaaa1"]]]);
  assert.equal(contract.activeList, "main");
  for (const bad of [null, "x", [], 1, {}]) assert.throws(() => validateContract(bad), /préférences/i, JSON.stringify(bad));
  // toContract never throws on a damaged store: the store's own normalizers are bypassed here on purpose.
  const damaged = toContract({ preferences: null, research: null, theme: 7, competition: {} });
  assert.equal(damaged.v, 1);
  assert.deepEqual(damaged.lists.map((l) => l.id), ["main"]);
});

test("U3 the site's bounds", () => {
  assert.deepEqual({ ...LIMITS }, { lists: 50, entries: 5000, leagues: 200, views: 50, templates: 50, comparison: 4, favourites: 100 });
  const many = (n, f) => Array.from({ length: n }, (_, i) => f(i));
  const contract = validateContract({
    v: 1,
    leagues: many(300, (i) => `l_x${i}`),
    lists: many(60, (i) => ({ id: `list${i}`, name: `L${i}`, entries: i ? [] : many(6000, (j) => entry("clubs", `t_x${j}`)) })),
  });
  assert.equal(contract.leagues.length, 200);
  assert.equal(contract.lists.length, 50);
  assert.equal(contract.lists[0].entries.length, 5000);
});

test("U4 an unknown version is refused, unknown keys dropped", () => {
  assert.throws(() => validateContract({ ...toContract(STORES), v: 2 }), /version/i);
  assert.throws(() => validateContract({ ...toContract(STORES), v: undefined }), /version/i);
  const kept = validateContract({ ...toContract(STORES), widgets: [1], favourites: { clubs: ["t_zzzzz9"] } });
  assert.deepEqual(kept, toContract(STORES));
  assert.ok(!("widgets" in kept) && !("favourites" in kept));
});

test("U5 country: « none » and « not chosen » stay apart", () => {
  const withCountry = (homeCountry) => toContract({ ...STORES, preferences: { ...STORES.preferences, homeCountry } }).country;
  assert.equal(withCountry("none"), "none");
  assert.equal(withCountry(""), null);
  assert.equal(withCountry("FRA"), "FRA");
  assert.equal(withCountry("FR"), null);
  assert.equal(fromContract({ ...toContract(STORES), country: "none" }).preferences.homeCountry, "none");
  assert.equal(fromContract({ ...toContract(STORES), country: null }).preferences.homeCountry, "");
});

test("U6 homePriority is carried, never applied here", () => {
  const priority = (homePriority) => toContract({ ...STORES, preferences: { ...STORES.preferences, homePriority } }).homePriority;
  assert.equal(priority("location"), "location");
  assert.equal(priority("importance"), "importance");
  assert.equal(priority(""), null);
  assert.equal(priority("weird"), null);
  assert.equal(fromContract({ ...toContract(STORES), homePriority: null }).preferences.homePriority, "");
});

test("U7 the favourites are derived from every list, never stored", () => {
  const contract = toContract(STORES);
  assert.ok(!("favourites" in contract));
  assert.deepEqual(favouritesOf(contract), { clubs: ["t_aaaaa1"], players: ["p_aaaab1"] });
  const many = validateContract({ v: 1, lists: [{ id: "a", name: "A", entries: Array.from({ length: 150 }, (_, i) => entry("clubs", `t_${String(i).padStart(5, "0")}x`)) }] });
  const fav = favouritesOf(many);
  assert.equal(fav.clubs.length, 100);
  assert.deepEqual(fav.clubs, [...fav.clubs].sort());
  const back = fromContract(contract);
  assert.ok(!("favourites" in back.preferences) && !("favourites" in back.research));
});

// ---------- The sync seam ----------
function harness({ contract = toContract(STORES) } = {}) {
  const timers = [], log = { reads: 0, writes: [], saves: [], reports: [] };
  let state = contract;
  const sync = createPreferencesSync({
    read: () => (log.reads++, state),
    write: (value) => {
      log.writes.push(value);
      state = value;
    },
    delay: 1000,
    setTimer: (fn, ms) => (timers.push({ fn, ms, live: true }), timers.length - 1),
    clearTimer: (id) => timers[id] && (timers[id].live = false),
    report: (error) => log.reports.push(error),
  });
  const fire = () => {
    for (const t of timers.splice(0)) if (t.live) t.fn();
  };
  const set = (patch) => (state = { ...state, ...patch });
  return { sync, timers, log, fire, set, get: () => state };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => ((resolve = a), (reject = b)));
  return { promise, resolve, reject };
}

test("Y1 no adapter: nothing happens", () => {
  const h = harness();
  h.sync.changed();
  h.sync.changed();
  assert.equal(h.log.reads, 0);
  assert.equal(h.timers.length, 0);
});

test("Y2–Y3 debounced, serialized, last write wins", async () => {
  const h = harness(), saving = [];
  let active = 0, peak = 0;
  h.sync.setAdapter({
    load: async () => null,
    save: (value) => {
      active++, (peak = Math.max(peak, active));
      const d = deferred();
      saving.push({ value, done: () => (active--, d.resolve()) });
      return d.promise;
    },
  });
  await tick();
  h.set({ theme: "dark" }), h.sync.changed();
  h.set({ theme: "light" }), h.sync.changed();
  h.set({ focus: "europe" }), h.sync.changed();
  assert.equal(saving.length, 0); // debounced
  h.fire();
  await tick();
  assert.equal(saving.length, 1);
  assert.equal(saving[0].value.focus, "europe");
  // A change during the save: no second save until the first ends, then the latest.
  h.set({ country: "FRA" }), h.sync.changed(), h.fire();
  h.set({ country: "ESP" }), h.sync.changed(), h.fire();
  await tick();
  assert.equal(saving.length, 1);
  saving[0].done();
  await tick();
  await tick();
  assert.equal(saving.length, 2);
  assert.equal(saving[1].value.country, "ESP"); // STORES is BRA: a value different from the first save
  saving[1].done();
  await tick();
  assert.equal(peak, 1);
  // Nothing changed since: no save.
  h.sync.changed(), h.fire();
  await tick();
  assert.equal(saving.length, 2);
});

test("Y4 the account's contract is applied once, without an echo", async () => {
  const h = harness(), saves = [];
  const account = { ...toContract(STORES), country: "FRA", extra: 1 };
  let loads = 0;
  h.sync.setAdapter({ load: async () => (loads++, account), save: async (v) => saves.push(v) });
  await tick();
  await tick();
  assert.equal(loads, 1);
  assert.equal(h.log.writes.length, 1);
  assert.equal(h.log.writes[0].country, "FRA");
  assert.ok(!("extra" in h.log.writes[0])); // validated
  h.sync.changed(), h.fire(); // the stores' change caused by the write
  await tick();
  assert.equal(saves.length, 0);
  h.sync.changed(), h.fire();
  await tick();
  assert.equal(loads, 1);
  assert.equal(h.log.writes.length, 1);
});

test("Y5 a failed save never throws and is retried on the next change", async () => {
  const h = harness();
  let calls = 0, fail = true;
  h.sync.setAdapter({ load: async () => null, save: async () => { calls++; if (fail) throw new Error("offline"); } });
  await tick();
  h.set({ theme: "dark" });
  assert.doesNotThrow(() => (h.sync.changed(), h.fire()));
  await tick();
  await tick();
  assert.equal(calls, 1);
  fail = false;
  h.sync.changed(), h.fire(); // same state, but the last save failed: tried again
  await tick();
  await tick();
  assert.equal(calls, 2);
  h.sync.changed(), h.fire();
  await tick();
  assert.equal(calls, 2);
});

test("Y6 no save before load; a failed load retried; null or invalid writes nothing", async () => {
  let h = harness(), saves = 0, loads = 0;
  const pending = deferred();
  h.sync.setAdapter({ load: () => (loads++, pending.promise), save: async () => saves++ });
  h.set({ theme: "dark" }), h.sync.changed(), h.fire();
  await tick();
  assert.equal(saves, 0);
  pending.resolve(null);
  await tick();
  await tick();
  assert.equal(h.log.writes.length, 0);
  // The change made while loading is saved once the load has answered.
  h.fire();
  await tick();
  assert.equal(saves, 1);
  // A failed load: tried again on the next change, no save meanwhile.
  h = harness(), (saves = 0), (loads = 0);
  let first = true;
  h.sync.setAdapter({ load: async () => { loads++; if (first) { first = false; throw new Error("down"); } return { v: 9 }; }, save: async () => saves++ });
  await tick();
  await tick();
  h.set({ theme: "dark" }), h.sync.changed(), h.fire();
  await tick();
  await tick();
  assert.equal(loads, 2);
  assert.equal(h.log.writes.length, 0); // v 9: refused, nothing written
});

test("Y7 removing the adapter stops everything", async () => {
  const h = harness();
  let saves = 0;
  h.sync.setAdapter({ load: async () => null, save: async () => saves++ });
  await tick();
  h.set({ theme: "dark" }), h.sync.changed();
  h.sync.setAdapter(null);
  h.fire();
  h.sync.changed(), h.fire();
  await tick();
  assert.equal(saves, 0);
});

// ---------- A contract handed back by save (VI-38: 409, reload, merge, rewrite) ----------
test("S1–S2 the returned contract is applied once, without an echo", async () => {
  const h = harness(), sent = [];
  h.sync.setAdapter({ load: async () => null, save: async (v) => (sent.push(v), { ...v, country: "ITA", extra: 1 }) });
  await tick();
  h.set({ theme: "dark" }), h.sync.changed(), h.fire();
  await tick();
  await tick();
  assert.equal(sent.length, 1);
  assert.equal(h.log.writes.length, 1);
  assert.equal(h.log.writes[0].country, "ITA");
  assert.equal(h.log.writes[0].theme, "dark");
  assert.ok(!("extra" in h.log.writes[0]));
  h.sync.changed(), h.fire(); // the stores' change caused by the write
  await tick();
  await tick();
  assert.equal(sent.length, 1);
  assert.equal(h.log.writes.length, 1);
});

test("S3 undefined or null from save: nothing re-applied", async () => {
  for (const answer of [undefined, null]) {
    const h = harness();
    let saves = 0;
    h.sync.setAdapter({ load: async () => null, save: async () => (saves++, answer) });
    await tick();
    h.set({ theme: "dark" }), h.sync.changed(), h.fire();
    await tick();
    await tick();
    assert.equal(saves, 1);
    assert.equal(h.log.writes.length, 0);
    h.sync.changed(), h.fire();
    await tick();
    assert.equal(saves, 1, "saved state is not saved again");
  }
});

test("S4 an invalid returned contract is ignored and reported, like a bad load", async () => {
  for (const answer of [{ v: 2, focus: "all" }, { focus: "all" }, "x"]) {
    const h = harness();
    let saves = 0;
    h.sync.setAdapter({ load: async () => null, save: async () => (saves++, answer) });
    await tick();
    h.set({ theme: "dark" }), h.sync.changed(), h.fire();
    await tick();
    await tick();
    assert.equal(h.log.writes.length, 0, JSON.stringify(answer));
    assert.equal(h.log.reports.length, 1);
    h.set({ theme: "light" }), h.sync.changed(), h.fire();
    await tick();
    await tick();
    assert.equal(saves, 2, "the sync keeps working");
  }
  // A bad load is reported the same way.
  const h = harness();
  h.sync.setAdapter({ load: async () => ({ v: 9 }), save: async () => {} });
  await tick();
  await tick();
  assert.equal(h.log.reports.length, 1);
});

test("S5 a change made during the in-flight save is saved next, on top of the returned contract", async () => {
  const h = harness(), saving = [];
  h.sync.setAdapter({
    load: async () => null,
    save: (value) => {
      const d = deferred();
      saving.push({ value, answer: d.resolve });
      return d.promise;
    },
  });
  await tick();
  h.set({ theme: "dark" }), h.sync.changed(), h.fire();
  await tick();
  assert.equal(saving.length, 1);
  // Local change while the save is in flight.
  h.set({ focus: "europe" }), h.sync.changed(), h.fire();
  // Another device changed the country and the theme; the merge hands this back.
  saving[0].answer({ ...saving[0].value, country: "ITA", theme: "light" });
  await tick();
  await tick();
  assert.equal(h.log.writes.length, 1);
  assert.deepEqual([h.log.writes[0].country, h.log.writes[0].theme, h.log.writes[0].focus], ["ITA", "light", "europe"]);
  assert.equal(saving.length, 1, "not at once: the stores apply the write first");
  h.sync.changed(), h.fire();
  await tick();
  assert.equal(saving.length, 2);
  assert.deepEqual([saving[1].value.country, saving[1].value.theme, saving[1].value.focus], ["ITA", "light", "europe"]);
  saving[1].answer(undefined);
  await tick();
  await tick();
  h.sync.changed(), h.fire();
  await tick();
  assert.equal(saving.length, 2);
  assert.equal(h.log.writes.length, 1);
});
