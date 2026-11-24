// The preference contract and its merge (src/contract.mjs). Failure modes: FAILURE_MODES.md,
// sections 5 (C1 to C13) and 6 (M1 to M11). Pure functions: no base.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, toRows, fromRows, merge, ContractError, LIMITS, FIELDS, STRUCTURES, CONTRACT_VERSION } from "../src/contract.mjs";
import { contract } from "./support.mjs";

/** Asserts that `value` is refused with `code`, and that the message names `path` when given. */
function refused(value, code, path) {
  assert.throws(
    () => parse(value),
    (error) => error instanceof ContractError && error.code === code && (!path || error.path === path),
    `${code} ${path ?? ""}`,
  );
}
const EMPTY = {
  v: 1, focus: "europe", theme: null, country: null, homePriority: null, preferredCompetition: null,
  onboardingComplete: false, leagues: [], lists: [], favourites: { clubs: [], players: [] },
};

test("the mapping is one table: every simple key names its column, and the structures are listed", () => {
  assert.equal(CONTRACT_VERSION, 1);
  assert.deepEqual(FIELDS.map((f) => [f.key, f.column]), [
    ["focus", "focus"],
    ["theme", "theme"],
    ["country", "country"],
    ["homePriority", "home_priority"],
    ["preferredCompetition", "preferred_competition"],
    ["onboardingComplete", "onboarding_complete"],
  ]);
  assert.deepEqual(Object.keys(STRUCTURES).sort(), ["favourites", "leagues", "lists", "v"]);
  assert.deepEqual(LIMITS, { lists: 50, entriesPerList: 5000, entries: 20000, leagues: 200, listName: 60 });
});

test("a valid contract is normalised: every key present, favourites computed from the lists (C5, C12)", () => {
  const out = parse(contract({ favourites: { clubs: ["t_Other"], players: [] } }));
  assert.deepEqual(out.favourites, { clubs: ["t_PSG", "t_OM"], players: ["p_Mbappe"] });
  assert.deepEqual(parse({ v: 1 }), EMPTY);
  assert.deepEqual(parse({ v: 1, theme: null, country: null, focus: null, onboardingComplete: null }), EMPTY);
  assert.deepEqual(Object.keys(parse({ v: 1 })), Object.keys(EMPTY));
});

test("C1: the body is a JSON object", () => {
  for (const value of [null, [], "x", 1, true, undefined]) refused(value, "CONTRACT_INVALID");
});

test("C2: v is 1, nothing else", () => {
  for (const v of [undefined, 0, 2, "1", 1.5, null]) refused({ ...contract(), v }, "CONTRACT_VERSION");
  refused({ theme: "dark" }, "CONTRACT_VERSION");
});

test("C3: an unknown key is refused at every level, with its path", () => {
  refused({ ...contract(), email: "a@b.c" }, "CONTRACT_INVALID", "email");
  refused({ ...contract(), favouriteLeagueIds: [] }, "CONTRACT_INVALID", "favouriteLeagueIds");
  const lists = contract().lists;
  refused(contract({ lists: [{ ...lists[0], color: "red" }] }), "CONTRACT_INVALID", "lists[0].color");
  refused(contract({ lists: [lists[0], { ...lists[1], entries: [{ kind: "clubs", id: "t_A", note: "x" }] }] }), "CONTRACT_INVALID", "lists[1].entries[0].note");
  refused(contract({ favourites: { clubs: [], players: [], matches: [] } }), "CONTRACT_INVALID", "favourites.matches");
  refused(contract({ favourites: [] }), "CONTRACT_INVALID", "favourites");
  // Inherited names are not keys of the contract.
  refused(JSON.parse('{"v":1,"__proto__":{"x":1}}'), "CONTRACT_INVALID", "__proto__");
  refused({ v: 1, constructor: "x" }, "CONTRACT_INVALID", "constructor");
});

test("C4: a simple preference outside its column's values is refused before the base", () => {
  for (const [key, value] of [
    ["focus", "world"], ["focus", "Europe"], ["theme", "blue"], ["theme", ""], ["country", "FR"], ["country", "fra"], ["country", "None"],
    ["homePriority", "both"], ["preferredCompetition", "t_1"], ["preferredCompetition", "l_"], ["preferredCompetition", `l_${"a".repeat(25)}`],
    ["onboardingComplete", "yes"], ["onboardingComplete", 1], ["theme", 3], ["country", ["FRA"]],
  ])
    refused({ v: 1, [key]: value }, "CONTRACT_INVALID", key);
  const ok = parse({ v: 1, country: "none", focus: "all", theme: "light", homePriority: "location", preferredCompetition: "l_abc123", onboardingComplete: true });
  assert.deepEqual([ok.country, ok.focus, ok.theme, ok.homePriority, ok.preferredCompetition, ok.onboardingComplete], ["none", "all", "light", "location", "l_abc123", true]);
});

test("C6: leagues are distinct competition ids, 200 at most", () => {
  refused({ v: 1, leagues: ["t_PSG"] }, "CONTRACT_INVALID", "leagues[0]");
  refused({ v: 1, leagues: ["l_A", "l_A"] }, "CONTRACT_INVALID", "leagues[1]");
  refused({ v: 1, leagues: "l_A" }, "CONTRACT_INVALID", "leagues");
  refused({ v: 1, leagues: Array.from({ length: 201 }, (_, i) => `l_${i}`) }, "CONTRACT_LIMIT", "leagues");
  assert.equal(parse({ v: 1, leagues: Array.from({ length: 200 }, (_, i) => `l_${i}`) }).leagues.length, 200);
});

test("C7: a list has a valid id and a name of 1 to 60 characters without control characters", () => {
  const entries = [];
  for (const [list, path] of [
    [{ name: "A", entries }, "lists[0].id"],
    [{ id: "main", entries }, "lists[0].name"],
    [{ id: "a b", name: "A", entries }, "lists[0].id"],
    [{ id: "x".repeat(81), name: "A", entries }, "lists[0].id"],
    [{ id: "main", name: "", entries }, "lists[0].name"],
    [{ id: "main", name: "é".repeat(61), entries }, "lists[0].name"],
    [{ id: "main", name: "a\u0000b", entries }, "lists[0].name"],
    [{ id: "main", name: "a\nb", entries }, "lists[0].name"],
    [{ id: "main", name: "A", entries: "x" }, "lists[0].entries"],
    [{ id: "main", name: "A" }, "lists[0].entries"],
    ["main", "lists[0]"],
  ])
    refused({ v: 1, lists: [list] }, "CONTRACT_INVALID", path);
  // 60 code points, some outside the basic plane: accepted (char_length counts them as one).
  const name = "⚽".repeat(30) + "😀".repeat(30);
  assert.equal(parse({ v: 1, lists: [{ id: "main", name, entries: [] }] }).lists[0].name, name);
});

test("C8: two lists with one id are refused", () => {
  refused({ v: 1, lists: [{ id: "main", name: "A", entries: [] }, { id: "main", name: "B", entries: [] }] }, "CONTRACT_INVALID", "lists[1].id");
});

test("C9: an entry's kind, id and season are checked; nations are refused", () => {
  const list = (entry) => ({ v: 1, lists: [{ id: "main", name: "A", entries: [entry] }] });
  for (const [entry, path] of [
    [{ kind: "nations", id: "t_FRA" }, "lists[0].entries[0].kind"],
    [{ kind: "player", id: "p_A" }, "lists[0].entries[0].kind"],
    [{ kind: "players", id: "t_A" }, "lists[0].entries[0].id"],
    [{ kind: "clubs", id: "p_A" }, "lists[0].entries[0].id"],
    [{ kind: "matches", id: `m_${"a".repeat(25)}` }, "lists[0].entries[0].id"],
    [{ kind: "players", id: "p_A", season: "2025-2026" }, "lists[0].entries[0].season"],
    [{ kind: "players", id: "p_A", season: 2025 }, "lists[0].entries[0].season"],
    [{ id: "p_A" }, "lists[0].entries[0].kind"],
    ["p_A", "lists[0].entries[0]"],
  ])
    refused(list(entry), "CONTRACT_INVALID", path);
  const out = parse(list({ kind: "players", id: "p_A", season: null }));
  assert.deepEqual(out.lists[0].entries, [{ kind: "players", id: "p_A" }]);
  assert.deepEqual(parse(list({ kind: "players", id: "p_A", season: "2026" })).lists[0].entries, [{ kind: "players", id: "p_A", season: "2026" }]);
});

test("C10: the same entry twice in a list is kept once, at its first place and season", () => {
  const out = parse({ v: 1, lists: [{ id: "main", name: "A", entries: [
    { kind: "players", id: "p_A", season: "2025" }, { kind: "clubs", id: "t_B" }, { kind: "players", id: "p_A", season: "2026" }, { kind: "clubs", id: "t_A" },
  ] }] });
  assert.deepEqual(out.lists[0].entries, [{ kind: "players", id: "p_A", season: "2025" }, { kind: "clubs", id: "t_B" }, { kind: "clubs", id: "t_A" }]);
});

test("C11: 50 lists, 5000 entries a list, 20000 in all", () => {
  const entries = (n, prefix = "") => Array.from({ length: n }, (_, i) => ({ kind: "players", id: `p_${prefix}${i}` }));
  const lists = (n, size = 0) => Array.from({ length: n }, (_, i) => ({ id: `l${i}`, name: `L${i}`, entries: entries(size, `x${i}y`) }));
  assert.equal(parse({ v: 1, lists: lists(50) }).lists.length, 50);
  refused({ v: 1, lists: lists(51) }, "CONTRACT_LIMIT", "lists");
  assert.equal(parse({ v: 1, lists: [{ id: "a", name: "A", entries: entries(5000) }] }).lists[0].entries.length, 5000);
  refused({ v: 1, lists: [{ id: "a", name: "A", entries: entries(5001) }] }, "CONTRACT_LIMIT", "lists[0].entries");
  assert.equal(parse({ v: 1, lists: lists(4, 5000) }).lists.length, 4);
  refused({ v: 1, lists: lists(5, 4001) }, "CONTRACT_LIMIT", "lists");
});

test("C12: favourites written by the site are ignored, but must be well formed", () => {
  const out = parse(contract({ favourites: { clubs: ["t_X"], players: ["p_Y"] } }));
  assert.deepEqual(out.favourites, { clubs: ["t_PSG", "t_OM"], players: ["p_Mbappe"] });
  assert.deepEqual(parse({ ...contract(), favourites: undefined }).favourites, out.favourites);
  // A club in two lists is one favourite, at its first place.
  const twice = parse({ v: 1, lists: [
    { id: "a", name: "A", entries: [{ kind: "clubs", id: "t_B" }, { kind: "players", id: "p_A" }] },
    { id: "b", name: "B", entries: [{ kind: "clubs", id: "t_A" }, { kind: "clubs", id: "t_B" }, { kind: "matches", id: "m_A" }] },
  ] });
  assert.deepEqual(twice.favourites, { clubs: ["t_B", "t_A"], players: ["p_A"] });
});

test("C13: rows and back give the normalised contract, in order", () => {
  const value = parse(contract({ leagues: ["l_Z", "l_A", "l_M"] }));
  const rows = toRows(value);
  assert.deepEqual(rows.preferences, { focus: "all", theme: "dark", country: "FRA", home_priority: "importance", preferred_competition: "l_Ligue1", onboarding_complete: true });
  assert.deepEqual(rows.leagues, [{ entity_id: "l_Z", position: 0 }, { entity_id: "l_A", position: 1 }, { entity_id: "l_M", position: 2 }]);
  assert.deepEqual(rows.lists[1], { client_id: "list-1700000000000", name: "Matchs", position: 1, entries: [
    { kind: "matches", entity_id: "m_Final2022", season: null, position: 0 },
    { kind: "clubs", entity_id: "t_OM", season: "2025", position: 1 },
  ] });
  assert.deepEqual(fromRows(rows), value);
  assert.equal(fromRows({ preferences: null, leagues: [], lists: [] }), null);
  // Rows read from the base come sorted by position; fromRows keeps their order as given.
  assert.deepEqual(fromRows(toRows(parse(EMPTY))), EMPTY);
});

test("M1: an account that never saved takes the browser's contract", () => {
  const browser = parse(contract());
  assert.deepEqual(merge(null, browser), browser);
});

test("M2, M3, M4: simple preferences: the account's value when it holds one, else the browser's", () => {
  const account = parse({ v: 1, theme: "light", country: "none", homePriority: null, preferredCompetition: null, focus: "europe" });
  const browser = parse(contract());
  const out = merge(account, browser);
  assert.equal(out.theme, "light");
  assert.equal(out.country, "none"); // « Aucun pays » is a choice
  assert.equal(out.homePriority, "importance");
  assert.equal(out.preferredCompetition, "l_Ligue1");
  assert.equal(out.focus, "europe"); // the account's column always holds one
});

test("M5: onboarding is complete when either side completed it", () => {
  const done = parse({ v: 1, onboardingComplete: true }),
    not = parse({ v: 1 });
  assert.equal(merge(not, done).onboardingComplete, true);
  assert.equal(merge(done, not).onboardingComplete, true);
  assert.equal(merge(not, not).onboardingComplete, false);
});

test("M6: leagues: the account's when not empty, else the browser's", () => {
  assert.deepEqual(merge(parse({ v: 1, leagues: ["l_A"] }), parse({ v: 1, leagues: ["l_B", "l_A"] })).leagues, ["l_A"]);
  assert.deepEqual(merge(parse({ v: 1 }), parse({ v: 1, leagues: ["l_B", "l_A"] })).leagues, ["l_B", "l_A"]);
});

test("M7, M8: lists are united by id, entries by kind and id, the account first", () => {
  const account = parse({ v: 1, lists: [
    { id: "main", name: "Compte", entries: [{ kind: "players", id: "p_A", season: "2025" }, { kind: "clubs", id: "t_A" }] },
    { id: "acc-only", name: "Seulement compte", entries: [] },
  ] });
  const browser = parse({ v: 1, lists: [
    { id: "nav-only", name: "Seulement navigateur", entries: [{ kind: "matches", id: "m_A" }] },
    { id: "main", name: "Navigateur", entries: [{ kind: "clubs", id: "t_B" }, { kind: "players", id: "p_A", season: "2026" }, { kind: "clubs", id: "t_A" }] },
  ] });
  const out = merge(account, browser);
  assert.deepEqual(out.lists, [
    { id: "main", name: "Compte", entries: [{ kind: "players", id: "p_A", season: "2025" }, { kind: "clubs", id: "t_A" }, { kind: "clubs", id: "t_B" }] },
    { id: "acc-only", name: "Seulement compte", entries: [] },
    { id: "nav-only", name: "Seulement navigateur", entries: [{ kind: "matches", id: "m_A" }] },
  ]);
  assert.deepEqual(out.favourites, { clubs: ["t_A", "t_B"], players: ["p_A"] });
});

test("M9: a union beyond a bound is refused", () => {
  const lists = (prefix, n) => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, name: "L", entries: [] }));
  assert.throws(() => merge(parse({ v: 1, lists: lists("a", 30) }), parse({ v: 1, lists: lists("b", 30) })), (e) => e instanceof ContractError && e.code === "CONTRACT_LIMIT");
  const entries = (prefix, n) => Array.from({ length: n }, (_, i) => ({ kind: "players", id: `p_${prefix}${i}` }));
  assert.throws(
    () => merge(parse({ v: 1, lists: [{ id: "main", name: "A", entries: entries("a", 3000) }] }), parse({ v: 1, lists: [{ id: "main", name: "A", entries: entries("b", 3000) }] })),
    (e) => e instanceof ContractError && e.code === "CONTRACT_LIMIT",
  );
});

test("M10: merging the same browser twice changes nothing the second time", () => {
  const account = parse({ v: 1, theme: "light", lists: [{ id: "main", name: "A", entries: [{ kind: "clubs", id: "t_A" }] }] });
  const browser = parse(contract());
  const once = merge(account, browser);
  assert.deepEqual(merge(once, browser), once);
});
