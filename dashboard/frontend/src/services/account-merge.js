/**
 * The merges of the account sync (VI-38). Doc: docs/COMPTES_SITE.md, sections 3 and 4; tests:
 * tests/account-merge.test.mjs. Both take version-1 contracts (user-preferences.js) and give one.
 *
 * mergeFirstSignIn(account, browser): once per account on a browser, when the account already holds a contract.
 *   The account wins key by key unless it holds the « not chosen » value; collections are united, the account's
 *   items first.
 * mergeThreeWay(base, local, remote): after a 409, `base` being the last contract this browser loaded or saved.
 *   A key changed here since the base keeps this browser's value, else the remote's; collections take the additions
 *   of both sides minus what either side deleted since the base.
 */
import { LIMITS, validateContract } from "./user-preferences.js";

const freeze = (value) => {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
/** The contract with nothing chosen. */
export const NOT_CHOSEN = freeze(validateContract({ v: 1 }));

const COLLECTIONS = new Set(["lists", "activeList", "views", "templates", "onboarded"]);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const entryKey = (entry) => `${entry.kind}:${entry.id}`;
const byId = (item) => item.id;
const untouchedDefault = (list) => same(list, NOT_CHOSEN.lists[0]);
const isDefaultLists = (lists) => lists.length === 1 && untouchedDefault(lists[0]);
const clone = (value) => JSON.parse(JSON.stringify(value));

/** The account's items first (each combined with the browser's of the same key), then the browser's others. */
function unite(first, second, keyOf, combine = (a) => a, limit = Infinity) {
  const seconds = new Map(second.map((item) => [keyOf(item), item]));
  const keys = new Set();
  const out = [];
  for (const item of first) {
    const key = keyOf(item);
    keys.add(key);
    out.push(seconds.has(key) ? combine(item, seconds.get(key)) : item);
  }
  for (const item of second) if (!keys.has(keyOf(item))) keys.add(keyOf(item)), out.push(item);
  return out.slice(0, limit);
}

function fallbackActive(lists, wanted) {
  return lists.some((list) => list.id === wanted) ? wanted : lists[0].id;
}

/**
 * { contract, error }: the merged contract, or the account's unchanged with the reason when the result does not
 * survive `check` (validateContract) intact.
 */
export function mergeFirstSignIn(account, browser, { check = validateContract } = {}) {
  const a = validateContract(account);
  const b = validateContract(browser);
  const merged = {};
  for (const key of Object.keys(NOT_CHOSEN)) {
    if (key === "v") merged.v = a.v;
    else if (COLLECTIONS.has(key)) continue;
    else merged[key] = same(a[key], NOT_CHOSEN[key]) ? b[key] : a[key];
  }
  merged.onboarded = a.onboarded || b.onboarded;
  const chosen = (lists) => lists.filter((list) => !untouchedDefault(list));
  let lists = unite(
    chosen(a.lists),
    chosen(b.lists),
    byId,
    (mine, theirs) => ({ ...mine, entries: unite(mine.entries, theirs.entries, entryKey, undefined, LIMITS.entries) }),
    LIMITS.lists,
  );
  if (!lists.length) lists = clone(NOT_CHOSEN.lists);
  merged.lists = lists;
  merged.activeList = fallbackActive(lists, isDefaultLists(a.lists) ? b.activeList : a.activeList);
  merged.views = unite(a.views, b.views, byId, undefined, LIMITS.views);
  merged.templates = unite(a.templates, b.templates, byId, undefined, LIMITS.templates);
  const ordered = Object.fromEntries(Object.keys(NOT_CHOSEN).map((key) => [key, merged[key]]));
  try {
    const checked = check(ordered);
    if (!same(checked, ordered)) throw new Error("La fusion des préférences a donné un résultat non conforme.");
    return { contract: checked, error: null };
  } catch (error) {
    return { contract: a, error: error instanceof Error ? error : new Error(String(error)) };
  }
}

/** The three-way merge of one collection: the remote's order, then this browser's additions. */
function mergeSet(base, local, remote, keyOf, combine) {
  const b = new Map(base.map((item) => [keyOf(item), item]));
  const l = new Map(local.map((item) => [keyOf(item), item]));
  const r = new Map(remote.map((item) => [keyOf(item), item]));
  const out = [];
  for (const item of remote) {
    const key = keyOf(item);
    if (l.has(key)) out.push(combine(b.get(key), l.get(key), item));
    else if (!b.has(key)) out.push(item); // added there
    // else: deleted here since the base
  }
  for (const item of local) {
    const key = keyOf(item);
    if (!r.has(key) && !b.has(key)) out.push(item); // added here; in the base but not there: deleted there
  }
  return out;
}
/** One value: this browser's when it changed since the base, else the remote's. */
const pickValue = (base, local, remote) => (base === undefined || !same(local, base) ? local : remote);

export function mergeThreeWay(base, local, remote) {
  const o = base ? validateContract(base) : NOT_CHOSEN;
  const l = validateContract(local);
  const r = validateContract(remote);
  const merged = {};
  for (const key of Object.keys(NOT_CHOSEN)) {
    if (key === "v") merged.v = r.v;
    else merged[key] = same(l[key], o[key]) ? r[key] : l[key];
  }
  let lists = mergeSet(o.lists, l.lists, r.lists, byId, (b, mine, theirs) => ({
    id: theirs.id,
    name: pickValue(b?.name, mine.name, theirs.name),
    entries: mergeSet(b?.entries ?? [], mine.entries, theirs.entries, entryKey, (be, me, te) => pickValue(be, me, te)).slice(0, LIMITS.entries),
  })).slice(0, LIMITS.lists);
  if (!lists.length) lists = clone(NOT_CHOSEN.lists);
  merged.lists = lists;
  merged.activeList = fallbackActive(lists, merged.activeList);
  merged.views = mergeSet(o.views, l.views, r.views, byId, pickValue).slice(0, LIMITS.views);
  merged.templates = mergeSet(o.templates, l.templates, r.templates, byId, pickValue).slice(0, LIMITS.templates);
  return validateContract(merged);
}
