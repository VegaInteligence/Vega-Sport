// The store's commands (src/store.mjs) and the seam the front reaches them through
// (src/store-client.mjs), on the disposable local base. Failure modes: FAILURE_MODES.md,
// section 7 (D1 to D13) and S15, S16.
//
//   VEGA_V2_ACCOUNT_TEST_DSN=postgresql://<owner>@127.0.0.1:5432/vega_v2_account_test npm test
//
// The store runs as the group role vega_account (the production login's group), not as the owner.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createStore, createPool } from "../src/store.mjs";
import { createStoreClient, localInvoker, lambdaInvoker, StoreRefusal, StoreUnavailable, MAX_PAYLOAD } from "../src/store-client.mjs";
import { DSN, skipDb as skip, freshBase, rowsOf, contract } from "./support.mjs";

let db, pool, store;
before(async () => {
  if (skip) return;
  db = await freshBase();
  pool = createPool(DSN, { role: "vega_account" });
  store = createStore({ pool });
});
after(async () => {
  await pool?.end();
  await db?.end();
});
const one = async (sql, values) => Object.values((await db.query(sql, values)).rows[0])[0];
const ok = async (command) => {
  const out = await store.handle(command);
  assert.equal(out.ok, true, JSON.stringify(out));
  return out.value;
};
const refusal = async (command, code) => {
  const out = await store.handle(command);
  assert.equal(out.ok, false, JSON.stringify(out));
  assert.equal(out.code, code, JSON.stringify(out));
  return out;
};

test("D1: an unknown command, a bad account id or extra fields are refused before any statement", { skip }, async () => {
  for (const command of [
    null, "session", {}, { command: "drop", accountId: "d1" }, { command: "session" }, { command: "session", accountId: "a b" },
    { command: "session", accountId: "x".repeat(65) }, { command: "session", accountId: "d1", level: 3 },
    { command: "putPreferences", accountId: "d1" }, { command: "getPreferences", accountId: "d1", preferences: {} }, { command: "__proto__", accountId: "d1" },
  ])
    await refusal(command, "INVALID_COMMAND");
  assert.equal(await one("SELECT count(*)::int FROM account.accounts WHERE account_id = 'd1'"), 0);
});

test("D2: a contract that fails its checks is refused by the store too, nothing written", { skip }, async () => {
  await refusal({ command: "putPreferences", accountId: "d2", preferences: { v: 2 } }, "CONTRACT_VERSION");
  const bad = await refusal({ command: "putPreferences", accountId: "d2", preferences: contract({ extra: 1 }) }, "CONTRACT_INVALID");
  assert.match(bad.message, /extra/);
  await refusal({ command: "mergePreferences", accountId: "d2", preferences: contract({ leagues: Array.from({ length: 201 }, (_, i) => `l_${i}`) }) }, "CONTRACT_LIMIT");
  assert.deepEqual(await rowsOf(db, "d2"), { accounts: 0, preferences: 0, follows: 0, lists: 0, stripe_customers: 0, subscriptions: 0, erasures: 0, list_entries: 0 });
});

test("D3, D4: a session creates the account once, at level 1, and moves last_seen_on at most once a day", { skip }, async () => {
  assert.deepEqual(await ok({ command: "session", accountId: "d3" }), { created: true, level: 1 });
  assert.equal(await one("SELECT last_seen_on = current_date FROM account.accounts WHERE account_id = 'd3'"), true);
  assert.deepEqual(await ok({ command: "session", accountId: "d3" }), { created: false, level: 1 });
  await db.query("UPDATE account.accounts SET last_seen_on = current_date - 3 WHERE account_id = 'd3'");
  const xmin = await one("SELECT xmin::text FROM account.accounts WHERE account_id = 'd3'");
  await ok({ command: "session", accountId: "d3" });
  assert.equal(await one("SELECT last_seen_on = current_date FROM account.accounts WHERE account_id = 'd3'"), true);
  const moved = await one("SELECT xmin::text FROM account.accounts WHERE account_id = 'd3'");
  assert.notEqual(moved, xmin);
  await ok({ command: "session", accountId: "d3" });
  assert.equal(await one("SELECT xmin::text FROM account.accounts WHERE account_id = 'd3'"), moved); // no write the same day
  // The level is account.level_of: a live Plus subscription gives 2.
  await db.query("SELECT account.record_subscription('sub_d3', 'd3', 2::smallint, 'active', now() + interval '10 days', false, now())");
  assert.deepEqual(await ok({ command: "session", accountId: "d3" }), { created: false, level: 2 });
});

test("D5: reading preferences never saved, or of an unknown account, is null and creates nothing", { skip }, async () => {
  assert.equal(await ok({ command: "getPreferences", accountId: "d5-unknown" }), null);
  assert.equal(await one("SELECT count(*)::int FROM account.accounts WHERE account_id = 'd5-unknown'"), 0);
  await ok({ command: "session", accountId: "d5" });
  assert.equal(await ok({ command: "getPreferences", accountId: "d5" }), null);
});

test("D6, D8, S15: a put stores the whole contract in one transaction, creating the account, read back in order", { skip }, async () => {
  const value = contract({ leagues: ["l_Z", "l_A", "l_M"] });
  const stored = await ok({ command: "putPreferences", accountId: "d6", preferences: value });
  assert.deepEqual(stored.leagues, ["l_Z", "l_A", "l_M"]);
  assert.deepEqual(stored.lists, value.lists.map((l) => ({ ...l, entries: l.entries.map((e) => ({ ...e })) })));
  assert.deepEqual(stored.favourites, { clubs: ["t_PSG", "t_OM"], players: ["p_Mbappe"] });
  assert.deepEqual(await ok({ command: "getPreferences", accountId: "d6" }), stored);
  // A fault deep in the lists is caught before the base; a fault the base alone sees rolls back all.
  const brokenStore = createStore({ pool, hooks: { beforeEntries: () => { throw new Error("connection lost"); } } });
  await assert.rejects(brokenStore.handle({ command: "putPreferences", accountId: "d6", preferences: contract({ theme: "light", leagues: [] }) }));
  assert.deepEqual(await ok({ command: "getPreferences", accountId: "d6" }), stored);
});

test("D7: a put deletes what the contract dropped, keeps the dates of what stays, leaves national teams alone", { skip }, async () => {
  await ok({ command: "putPreferences", accountId: "d7", preferences: contract() });
  await db.query("INSERT INTO account.follows (account_id, kind, entity_id) VALUES ('d7', 'nation', 't_FRA')");
  await db.query("UPDATE account.lists SET created_at = '2026-01-01' WHERE account_id = 'd7'");
  await db.query("UPDATE account.list_entries e SET added_at = '2026-01-02' FROM account.lists l WHERE l.list_id = e.list_id AND l.account_id = 'd7'");
  const next = contract({ leagues: ["l_PremierLeague"], lists: [{ id: "main", name: "Renommée", entries: [{ kind: "clubs", id: "t_PSG" }, { kind: "players", id: "p_Neuer" }] }] });
  const stored = await ok({ command: "putPreferences", accountId: "d7", preferences: next });
  assert.deepEqual(stored.lists, next.lists);
  assert.deepEqual(stored.leagues, ["l_PremierLeague"]);
  assert.equal(await one("SELECT count(*)::int FROM account.lists WHERE account_id = 'd7'"), 1);
  assert.equal(await one("SELECT created_at = '2026-01-01' FROM account.lists WHERE account_id = 'd7'"), true);
  const dates = (await db.query("SELECT e.entity_id, e.added_at = '2026-01-02' AS kept FROM account.list_entries e JOIN account.lists l USING (list_id) WHERE l.account_id = 'd7' ORDER BY e.position")).rows;
  assert.deepEqual(dates, [{ entity_id: "t_PSG", kept: true }, { entity_id: "p_Neuer", kept: false }]);
  assert.equal(await one("SELECT count(*)::int FROM account.follows WHERE account_id = 'd7' AND kind = 'nation'"), 1);
});

test("D9: two writes at once for one account: the last one wins whole", { skip }, async () => {
  const a = contract({ theme: "light", lists: [{ id: "a", name: "A", entries: Array.from({ length: 2000 }, (_, i) => ({ kind: "players", id: `p_a${i}` })) }] });
  const b = contract({ theme: "dark", lists: [{ id: "b", name: "B", entries: Array.from({ length: 2000 }, (_, i) => ({ kind: "clubs", id: `t_b${i}` })) }] });
  const second = createStore({ pool: createPool(DSN, { role: "vega_account" }) });
  try {
    await Promise.all([store.handle({ command: "putPreferences", accountId: "d9", preferences: a }), second.handle({ command: "putPreferences", accountId: "d9", preferences: b })]);
  } finally {
    await second.end();
  }
  const read = await ok({ command: "getPreferences", accountId: "d9" });
  assert.ok((read.theme === "light" && read.lists[0].id === "a") || (read.theme === "dark" && read.lists[0].id === "b"), "one contract whole");
  assert.equal(read.lists.length, 1);
  assert.equal(read.lists[0].entries.length, 2000);
});

test("merge: in the store's transaction, the account first, the browser's new lists after (M1, M7)", { skip }, async () => {
  const first = await ok({ command: "mergePreferences", accountId: "dm", preferences: contract() });
  assert.deepEqual(first, await ok({ command: "getPreferences", accountId: "dm" }));
  const other = { v: 1, theme: "light", country: null, lists: [{ id: "main", name: "Autre", entries: [{ kind: "clubs", id: "t_Lyon" }] }, { id: "phone", name: "Téléphone", entries: [] }] };
  const merged = await ok({ command: "mergePreferences", accountId: "dm", preferences: other });
  assert.equal(merged.theme, "dark");
  assert.equal(merged.country, "FRA");
  assert.deepEqual(merged.lists.map((l) => l.id), ["main", "list-1700000000000", "phone"]);
  assert.deepEqual(merged.lists[0].entries.map((e) => e.id), ["p_Mbappe", "t_PSG", "t_Lyon"]);
  assert.deepEqual(await ok({ command: "mergePreferences", accountId: "dm", preferences: other }), merged); // M10
});

test("S16, D10: an erased account is refused by every command but the erasure, which can be repeated", { skip }, async () => {
  await ok({ command: "putPreferences", accountId: "d10", preferences: contract() });
  assert.deepEqual(await ok({ command: "erase", accountId: "d10" }), { erased: true });
  assert.deepEqual(await rowsOf(db, "d10"), { accounts: 0, preferences: 0, follows: 0, lists: 0, stripe_customers: 0, subscriptions: 0, erasures: 1, list_entries: 0 });
  for (const command of ["session", "getPreferences", "export"]) await refusal({ command, accountId: "d10" }, "ACCOUNT_ERASED");
  for (const command of ["putPreferences", "mergePreferences"]) await refusal({ command, accountId: "d10", preferences: contract() }, "ACCOUNT_ERASED");
  assert.deepEqual(await ok({ command: "erase", accountId: "d10" }), { erased: false });
  assert.deepEqual(await rowsOf(db, "d10"), { accounts: 0, preferences: 0, follows: 0, lists: 0, stripe_customers: 0, subscriptions: 0, erasures: 1, list_entries: 0 });
  // The tombstone holds the id and the instant, nothing else.
  assert.deepEqual((await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema = 'account' AND table_name = 'erasures' ORDER BY ordinal_position")).rows.map((r) => r.column_name), ["account_id", "erased_at"]);
});

test("X7: a live subscription blocks the erasure, an ended one does not", { skip }, async () => {
  await ok({ command: "session", accountId: "x7" });
  await db.query("SELECT account.record_subscription('sub_x7', 'x7', 3::smallint, 'past_due', now() + interval '3 days', false, now())");
  await refusal({ command: "erase", accountId: "x7" }, "SUBSCRIPTION_ACTIVE");
  assert.equal((await rowsOf(db, "x7")).accounts, 1);
  await db.query("SELECT account.record_subscription('sub_x7', 'x7', 3::smallint, 'canceled', now() - interval '1 day', false, now())");
  assert.deepEqual(await ok({ command: "erase", accountId: "x7" }), { erased: true });
});

test("export: every row the base holds for the account, nothing of another (X1, X2)", { skip }, async () => {
  assert.deepEqual(await ok({ command: "export", accountId: "xe-unknown" }), { account: null, preferences: null, follows: [], lists: [], stripe: { customer: null, subscriptions: [] } });
  await ok({ command: "putPreferences", accountId: "xe", preferences: contract() });
  await ok({ command: "putPreferences", accountId: "xe-other", preferences: contract({ theme: "light" }) });
  await db.query("INSERT INTO account.follows (account_id, kind, entity_id) VALUES ('xe', 'nation', 't_BRA')");
  await db.query("INSERT INTO account.stripe_customers (account_id, customer_id) VALUES ('xe', 'cus_xe')");
  await db.query("SELECT account.record_subscription('sub_xe', 'xe', 2::smallint, 'canceled', '2026-10-01', false, '2026-09-01')");
  const out = await ok({ command: "export", accountId: "xe" });
  assert.equal(out.account.accountId, "xe");
  assert.equal(out.account.level, 1);
  assert.match(out.account.lastSeenOn, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(!Number.isNaN(Date.parse(out.account.createdAt)));
  assert.deepEqual(out.preferences, await ok({ command: "getPreferences", accountId: "xe" }));
  assert.deepEqual(out.follows.map((f) => [f.kind, f.entityId, f.position]), [["competition", "l_Ligue1", 0], ["competition", "l_PremierLeague", 1], ["nation", "t_BRA", 0]]);
  assert.ok(out.follows.every((f) => !Number.isNaN(Date.parse(f.followedAt))));
  assert.deepEqual(out.lists.map((l) => [l.clientId, l.name, l.position, l.entries.length]), [["main", "Ma sélection", 0, 2], ["list-1700000000000", "Matchs", 1, 2]]);
  assert.deepEqual(Object.keys(out.lists[0]).sort(), ["clientId", "createdAt", "entries", "name", "position", "updatedAt"]);
  assert.deepEqual(Object.keys(out.lists[0].entries[0]).sort(), ["addedAt", "entityId", "kind", "position", "season"]);
  assert.equal(out.stripe.customer.customerId, "cus_xe");
  assert.deepEqual(out.stripe.subscriptions.map((s) => [s.subscriptionId, s.level, s.status]), [["sub_xe", 2, "canceled"]]);
  assert.ok(!JSON.stringify(out).includes("xe-other"));
});

test("D11: the seam refuses a payload beyond 6 MB either way, in both transports", { skip }, async () => {
  assert.equal(MAX_PAYLOAD, 6 * 1024 * 1024);
  const client = createStoreClient(localInvoker(store.handle));
  await assert.rejects(client.call("putPreferences", { accountId: "d11", preferences: { v: 1, pad: "x".repeat(MAX_PAYLOAD) } }), (e) => e instanceof StoreRefusal && e.code === "PAYLOAD_TOO_LARGE");
  const big = createStoreClient(localInvoker(async () => ({ ok: true, value: "x".repeat(MAX_PAYLOAD) })));
  await assert.rejects(big.call("session", { accountId: "d11" }), StoreUnavailable);
  const lambdaBig = createStoreClient(lambdaInvoker({ functionName: "vega-v2-account-store", send: async () => ({ StatusCode: 200, Payload: Buffer.from(JSON.stringify({ ok: true, value: "x".repeat(MAX_PAYLOAD) })) }) }));
  await assert.rejects(lambdaBig.call("session", { accountId: "d11" }), StoreUnavailable);
});

test("D12: a failing store is StoreUnavailable through either transport; a refusal is a StoreRefusal", { skip }, async () => {
  const local = createStoreClient(localInvoker(async () => { throw new Error("relation does not exist"); }));
  await assert.rejects(local.call("session", { accountId: "d12" }), (e) => e instanceof StoreUnavailable && !/relation/.test(e.message));
  for (const send of [
    async () => ({ StatusCode: 200, FunctionError: "Unhandled", Payload: Buffer.from('{"errorMessage":"boom"}') }),
    async () => { const e = new Error("Rate exceeded"); e.name = "TooManyRequestsException"; throw e; },
    async () => { throw new Error("socket hang up"); },
    async () => ({ StatusCode: 200, Payload: Buffer.from("not json") }),
  ])
    await assert.rejects(createStoreClient(lambdaInvoker({ functionName: "f", send })).call("session", { accountId: "d12" }), StoreUnavailable);
  const sent = [];
  const lambda = createStoreClient(lambdaInvoker({ functionName: "vega-v2-account-store", send: async (input) => { sent.push(input); return { StatusCode: 200, Payload: Buffer.from(JSON.stringify(await store.handle(JSON.parse(Buffer.from(input.Payload).toString())))) }; } }));
  assert.deepEqual(await lambda.call("session", { accountId: "d12" }), { created: true, level: 1 });
  assert.equal(sent[0].FunctionName, "vega-v2-account-store");
  assert.equal(sent[0].InvocationType, "RequestResponse");
  await assert.rejects(lambda.call("session", { accountId: "a b" }), (e) => e instanceof StoreRefusal && e.code === "INVALID_COMMAND");
});

test("D13: the store holds nothing beyond its group role", { skip }, async () => {
  const roles = (await pool.query("SELECT current_user, current_setting('role') AS role")).rows[0];
  assert.equal(roles.role, "vega_account");
  await assert.rejects(pool.query("CREATE TABLE account.extra (x int)"), (e) => e.code === "42501");
});
