// The merges of the account sync (VI-38, site side). Written before
// dashboard/frontend/src/services/account-merge.js, from docs/COMPTES_SITE.md sections 3 and 4:
//  M1 per key, the account's « not chosen » value takes the browser's, any other value of the account wins.
//  M2 onboarded is true if either is.
//  M3 lists united by id, the account's first; entries by kind + id, the account's first; an untouched default list
//     is not a choice; bounds kept.
//  M4 views and templates united by id, the account's first, 50 each.
//  M5 activeList: the account's unless its lists are the untouched default; always one of the merged lists.
//  M6 a result the contract would alter or refuse: the account's contract kept, the problem reported.
//  T1 three-way per top-level key: changed here since the base → local, else remote.
//  T2 additions of both sides kept (lists, entries, views, templates).
//  T3 an item of the base missing on either side is gone.
//  T4 an item edited on both sides: local when it changed since the base, else remote; a list's name too.
//  T5 activeList of a deleted list falls back to the first; no list at all gives the default list.
import test from "node:test";
import assert from "node:assert/strict";
import {
  NOT_CHOSEN,
  mergeFirstSignIn,
  mergeThreeWay,
} from "../dashboard/frontend/src/services/account-merge.js";
import { LIMITS, validateContract } from "../dashboard/frontend/src/services/user-preferences.js";

const contract = (values = {}) => validateContract({ v: 1, ...values });
const club = (id, extra = {}) => ({ id, kind: "clubs", name: id, season: "", imageUrl: "", ...extra });
const player = (id, extra = {}) => ({
  id,
  kind: "players",
  name: id,
  season: "",
  imageUrl: "",
  scope: { league: "all", focus: "all", role: "all", venue: "all", result: "all", from: "", to: "" },
  ...extra,
});
const main = (entries, name = "Ma sélection") => ({ id: "main", name, entries });
const view = (id, name = id) => ({ id, name, query: "pos=F", settings: NOT_CHOSEN.researchSettings });
const template = (id, name = id) => ({ id, name, groups: [], minMinutes: 450, weights: [{ key: "xg", direction: "max", weight: 1 }] });
const ids = (items) => items.map((item) => item.id);

test("NOT_CHOSEN is the contract with nothing chosen", () => {
  assert.deepEqual(NOT_CHOSEN, contract());
  assert.ok(Object.isFrozen(NOT_CHOSEN));
});

test("M1 the account's value wins, its « not chosen » values take the browser's", () => {
  const account = contract({ focus: "all", country: "FRA", theme: null, leagues: [], competition: "l_A1" });
  const browser = contract({ focus: "europe", country: "BRA", theme: "light", leagues: ["l_B1"], competition: "l_B2", homePriority: "location", defaultSeason: "2025/2026" });
  const { contract: merged } = mergeFirstSignIn(account, browser);
  assert.equal(merged.focus, "all"); // the account chose « all »
  assert.equal(merged.country, "FRA");
  assert.equal(merged.competition, "l_A1");
  assert.equal(merged.theme, "light"); // account at null → browser
  assert.deepEqual(merged.leagues, ["l_B1"]); // account at [] → browser
  assert.equal(merged.homePriority, "location");
  assert.equal(merged.defaultSeason, "2025/2026");
  // "europe" is the account's « not chosen » focus: the browser's "all" would take it.
  assert.equal(mergeFirstSignIn(contract(), contract({ focus: "all" })).contract.focus, "all");
  // The comparison and the research settings follow the same rule.
  const compared = [player("p_c1", { season: "2026/2027" })];
  assert.deepEqual(mergeFirstSignIn(contract(), contract({ comparison: compared })).contract.comparison, compared);
  assert.deepEqual(
    mergeFirstSignIn(contract({ comparison: [player("p_c2", { season: "2026/2027" })] }), contract({ comparison: compared })).contract.comparison.map((e) => e.id),
    ["p_c2"],
  );
});

test("M2 onboarded is true if either is", () => {
  assert.equal(mergeFirstSignIn(contract({ onboarded: true }), contract()).contract.onboarded, true);
  assert.equal(mergeFirstSignIn(contract(), contract({ onboarded: true })).contract.onboarded, true);
  assert.equal(mergeFirstSignIn(contract(), contract()).contract.onboarded, false);
});

test("M3 lists united by id, entries by kind + id, the account's first; the untouched default list is no choice", () => {
  const account = contract({
    lists: [main([club("t_a1", { name: "Compte" }), player("p_a1")]), { id: "scouting", name: "Pistes", entries: [club("t_s1")] }],
  });
  const browser = contract({
    lists: [main([club("t_a1", { name: "Navigateur" }), club("t_b1")]), { id: "list-2", name: "Autre", entries: [player("p_b2")] }],
  });
  const { contract: merged } = mergeFirstSignIn(account, browser);
  assert.deepEqual(ids(merged.lists), ["main", "scouting", "list-2"]);
  assert.deepEqual(ids(merged.lists[0].entries), ["t_a1", "p_a1", "t_b1"]);
  assert.equal(merged.lists[0].entries[0].name, "Compte"); // the account's version of a shared entry
  // A player and a club may share no id, but the key is kind + id: same id of two kinds would both stay.
  // The account's untouched default list does not hide the browser's lists.
  const fromBrowser = mergeFirstSignIn(contract(), contract({ lists: [{ id: "favs", name: "Favoris", entries: [club("t_f1")] }] })).contract;
  assert.deepEqual(ids(fromBrowser.lists), ["favs"]);
  assert.equal(fromBrowser.activeList, "favs");
  // The browser's untouched default list adds nothing to the account's.
  const fromAccount = mergeFirstSignIn(contract({ lists: [{ id: "favs", name: "Favoris", entries: [] }] }), contract()).contract;
  assert.deepEqual(ids(fromAccount.lists), ["favs"]);
  // Two untouched defaults: the default.
  assert.deepEqual(mergeFirstSignIn(contract(), contract()).contract.lists, NOT_CHOSEN.lists);
  // A renamed or filled « main » is a choice.
  assert.deepEqual(ids(mergeFirstSignIn(contract({ lists: [{ id: "x", name: "X", entries: [] }] }), contract({ lists: [main([], "Renommée")] })).contract.lists), ["x", "main"]);
});

test("M3 the bounds hold: 50 lists, 5000 entries", () => {
  const many = (prefix, n) => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, name: `${prefix}${i}`, entries: [club(`t_${prefix}${i}`)] }));
  const { contract: merged } = mergeFirstSignIn(contract({ lists: many("a", 40) }), contract({ lists: many("b", 40) }));
  assert.equal(merged.lists.length, LIMITS.lists);
  assert.equal(merged.lists[0].id, "a0");
  const entries = (prefix, n) => Array.from({ length: n }, (_, i) => club(`t_${prefix}${i}`));
  const big = mergeFirstSignIn(contract({ lists: [main(entries("a", 4000))] }), contract({ lists: [main(entries("b", 4000))] })).contract;
  assert.equal(big.lists[0].entries.length, LIMITS.entries);
  assert.equal(big.lists[0].entries[0].id, "t_a0");
});

test("M4 views and templates united by id, the account's first, 50 each", () => {
  const account = contract({ views: [view("v1", "Compte"), view("v2")], templates: [template("t1")] });
  const browser = contract({ views: [view("v1", "Navigateur"), view("v3")], templates: [template("t2"), template("t1", "Autre")] });
  const { contract: merged } = mergeFirstSignIn(account, browser);
  assert.deepEqual(ids(merged.views), ["v1", "v2", "v3"]);
  assert.equal(merged.views[0].name, "Compte");
  assert.deepEqual(ids(merged.templates), ["t1", "t2"]);
  const fifty = (prefix) => Array.from({ length: 50 }, (_, i) => view(`${prefix}${i}`));
  assert.equal(mergeFirstSignIn(contract({ views: fifty("a") }), contract({ views: fifty("b") })).contract.views.length, LIMITS.views);
});

test("M5 activeList is the account's unless its lists are the untouched default, and always a merged list", () => {
  const lists = [main([club("t_1")]), { id: "two", name: "Deux", entries: [] }];
  assert.equal(mergeFirstSignIn(contract({ lists, activeList: "two" }), contract({ lists: [{ id: "b", name: "B", entries: [club("t_2")] }], activeList: "b" })).contract.activeList, "two");
  assert.equal(mergeFirstSignIn(contract(), contract({ lists, activeList: "two" })).contract.activeList, "two");
});

test("M6 a merge the contract would alter is refused: the account's contract, reported", () => {
  const account = contract({ country: "FRA" });
  const out = mergeFirstSignIn(account, contract(), { check: () => ({ ...account, country: "XXX!" }) });
  assert.deepEqual(out.contract, account);
  assert.ok(out.error instanceof Error);
  const ok = mergeFirstSignIn(account, contract({ theme: "light" }));
  assert.equal(ok.error, null);
  assert.deepEqual(ok.contract, validateContract(ok.contract));
});

test("T1 per top-level key: changed here since the base keeps the local value, else the remote's", () => {
  const base = contract({ focus: "europe", country: "FRA", theme: "dark", onboarded: false });
  const local = { ...base, country: "BRA" };
  const remote = { ...base, theme: "light", onboarded: true };
  const merged = mergeThreeWay(base, local, remote);
  assert.equal(merged.country, "BRA");
  assert.equal(merged.theme, "light");
  assert.equal(merged.onboarded, true);
  // Changed on both sides: the local value.
  assert.equal(mergeThreeWay(base, { ...base, country: "ESP" }, { ...base, country: "ITA" }).country, "ESP");
  // No base (never loaded): every remote key not changed from « not chosen » here.
  assert.equal(mergeThreeWay(null, contract({ country: "ESP" }), contract({ theme: "light" })).country, "ESP");
});

test("T2 T3 additions of both sides kept, deletions of either side applied", () => {
  const base = contract({
    lists: [main([club("t_keep"), club("t_gonehere"), club("t_gonethere")]), { id: "old", name: "Ancienne", entries: [] }],
    views: [view("v_keep"), view("v_gone")],
    templates: [template("t_keep"), template("t_gone")],
  });
  const local = contract({
    lists: [main([club("t_keep"), club("t_gonethere"), club("t_newhere")]), { id: "old", name: "Ancienne", entries: [] }, { id: "mine", name: "Ici", entries: [] }],
    views: [view("v_keep"), view("v_here")],
    templates: [template("t_keep"), template("t_gone")],
  });
  const remote = contract({
    lists: [main([club("t_keep"), club("t_gonehere"), club("t_newthere")]), { id: "theirs", name: "Là-bas", entries: [] }],
    views: [view("v_keep"), view("v_gone"), view("v_there")],
    templates: [template("t_keep"), template("t_there")],
  });
  const merged = mergeThreeWay(base, local, remote);
  assert.deepEqual(ids(merged.lists), ["main", "theirs", "mine"]); // « old » deleted there
  assert.deepEqual(ids(merged.lists[0].entries), ["t_keep", "t_newthere", "t_newhere"]);
  assert.deepEqual(ids(merged.views), ["v_keep", "v_there", "v_here"]);
  assert.deepEqual(ids(merged.templates), ["t_keep", "t_there"]);
});

test("T4 an item edited on both sides: local when it changed since the base", () => {
  const base = contract({ lists: [main([player("p_1")], "Base")], views: [view("v1", "Base")] });
  const local = contract({ lists: [main([player("p_1", { replaces: true })], "Ici")], views: [view("v1", "Base")] });
  const remote = contract({ lists: [main([player("p_1", { name: "Renommé" })], "Là-bas")], views: [view("v1", "Là-bas")] });
  const merged = mergeThreeWay(base, local, remote);
  assert.equal(merged.lists[0].name, "Ici");
  assert.equal(merged.lists[0].entries[0].replaces, true);
  assert.equal(merged.views[0].name, "Là-bas"); // unchanged here
});

test("T5 activeList of a deleted list falls back; no list gives the default", () => {
  const base = contract({ lists: [main([club("t_1")]), { id: "two", name: "Deux", entries: [] }], activeList: "two" });
  const local = { ...base, activeList: "two" };
  const remote = contract({ lists: [main([club("t_1")])], activeList: "main" });
  const merged = mergeThreeWay(base, local, remote);
  assert.deepEqual(ids(merged.lists), ["main"]);
  assert.equal(merged.activeList, "main");
  const gone = mergeThreeWay(contract({ lists: [{ id: "x", name: "X", entries: [] }] }), contract({ lists: [{ id: "x", name: "X", entries: [] }] }), contract({ lists: [{ id: "y", name: "Y", entries: [] }] }));
  assert.deepEqual(ids(gone.lists), ["y"]);
  assert.deepEqual(validateContract(gone), gone);
});
