// The store's commands (src/store.mjs) and the seam the front reaches them through
// (src/store-client.mjs), on the disposable local base. Failure modes: FAILURE_MODES.md,
// section 7 (D1 to D14), C6, S16, S17 and section 9.
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
const NONE = { accounts: 0, preferences: 0, stripe_customers: 0, subscriptions: 0, erasures: 0 };
const ok = async (command) => {
  const out = await store.handle(command);
  assert.equal(out.ok, true, JSON.stringify(out).slice(0, 300));
  return out.value;
};
const refusal = async (command, code) => {
  const out = await store.handle(command);
  assert.equal(out.ok, false, JSON.stringify(out).slice(0, 300));
  assert.equal(out.code, code, JSON.stringify(out).slice(0, 300));
  return out;
};

test("D1: an unknown command, a bad account id, extra fields or a bad ifMatch are refused before any statement", { skip }, async () => {
  for (const command of [
    null, "session", {}, { command: "drop", accountId: "d1" }, { command: "session" }, { command: "session", accountId: "a b" },
    { command: "session", accountId: "x".repeat(65) }, { command: "session", accountId: "d1", level: 3 },
    { command: "putPreferences", accountId: "d1" }, { command: "getPreferences", accountId: "d1", preferences: {} }, { command: "__proto__", accountId: "d1" },
    { command: "mergePreferences", accountId: "d1", preferences: contract() },
    ...[0, -1, 1.5, "1", null].map((ifMatch) => ({ command: "putPreferences", accountId: "d1", preferences: contract(), ifMatch })),
  ])
    await refusal(command, "INVALID_COMMAND");
  assert.deepEqual(await rowsOf(db, "d1"), NONE);
});

test("D2: a document that fails its checks is refused by the store too, nothing written", { skip }, async () => {
  await refusal({ command: "putPreferences", accountId: "d2", preferences: { ...contract(), v: 2 } }, "CONTRACT_VERSION");
  await refusal({ command: "putPreferences", accountId: "d2", preferences: [] }, "CONTRACT_INVALID");
  await refusal({ command: "putPreferences", accountId: "d2", preferences: { v: 1, pad: "x".repeat(2 * 1024 * 1024) } }, "CONTRACT_LIMIT");
  await refusal({ command: "putPreferences", accountId: "d2", preferences: { v: 1, name: "a\u0000b" } }, "CONTRACT_INVALID");
  assert.deepEqual(await rowsOf(db, "d2"), NONE);
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
  await db.query("SELECT account.record_subscription('sub_d3', 'd3', 2::smallint, 'active', now() + interval '10 days', false, now())");
  assert.deepEqual(await ok({ command: "session", accountId: "d3" }), { created: false, level: 2 });
});

test("D5: reading preferences never saved, or of an unknown account, is null and creates nothing", { skip }, async () => {
  assert.deepEqual(await ok({ command: "getPreferences", accountId: "d5-unknown" }), { contract: null, revision: null });
  assert.deepEqual(await rowsOf(db, "d5-unknown"), NONE);
  await ok({ command: "session", accountId: "d5" });
  assert.deepEqual(await ok({ command: "getPreferences", accountId: "d5" }), { contract: null, revision: null });
});

test("C6, D7, D8: the document comes back deep-equal; the revision starts at 1 and grows by one", { skip }, async () => {
  const value = contract();
  assert.deepEqual(await ok({ command: "putPreferences", accountId: "d7", preferences: value }), { revision: 1 });
  assert.equal((await rowsOf(db, "d7")).accounts, 1);
  const read = await ok({ command: "getPreferences", accountId: "d7" });
  assert.deepEqual(read, { contract: value, revision: 1 });
  // Through the seam (JSON text both ways), as in production.
  const client = createStoreClient(localInvoker(store.handle));
  assert.deepEqual(await client.call("getPreferences", { accountId: "d7" }), { contract: value, revision: 1 });
  const before = await one("SELECT updated_at FROM account.preferences WHERE account_id = 'd7'");
  assert.deepEqual(await ok({ command: "putPreferences", accountId: "d7", preferences: value }), { revision: 2 });
  assert.deepEqual(await ok({ command: "putPreferences", accountId: "d7", preferences: { v: 1 } }), { revision: 3 });
  assert.deepEqual(await ok({ command: "getPreferences", accountId: "d7" }), { contract: { v: 1 }, revision: 3 });
  assert.ok((await one("SELECT updated_at FROM account.preferences WHERE account_id = 'd7'")) >= before);
});

test("D6: a write that fails in the base changes nothing, the account row included", { skip }, async () => {
  const broken = createStore({ pool, hooks: { beforeDocument: () => { throw new Error("connection lost"); } } });
  await assert.rejects(broken.handle({ command: "putPreferences", accountId: "d6", preferences: contract() }));
  assert.deepEqual(await rowsOf(db, "d6"), NONE);
});

test("D9: two writes at once for one account: each its revision, one document whole", { skip }, async () => {
  const a = contract({ theme: "light", lists: [{ id: "a", name: "A", entries: [] }] });
  const b = contract({ theme: "dark", lists: [{ id: "b", name: "B", entries: [] }] });
  const second = createStore({ pool: createPool(DSN, { role: "vega_account" }) });
  let results;
  try {
    results = await Promise.all([store.handle({ command: "putPreferences", accountId: "d9", preferences: a }), second.handle({ command: "putPreferences", accountId: "d9", preferences: b })]);
  } finally {
    await second.end();
  }
  assert.deepEqual(results.map((r) => r.value.revision).sort(), [1, 2]);
  const read = await ok({ command: "getPreferences", accountId: "d9" });
  const last = results.find((r) => r.value.revision === 2) === results[0] ? a : b;
  assert.deepEqual(read, { contract: last, revision: 2 });
});

test("D14: ifMatch writes only over the revision it names; otherwise STALE with the current one", { skip }, async () => {
  const stale = await refusal({ command: "putPreferences", accountId: "d14", preferences: contract(), ifMatch: 1 }, "STALE");
  assert.equal(stale.revision, null); // never saved
  assert.deepEqual(await rowsOf(db, "d14"), NONE);
  await ok({ command: "putPreferences", accountId: "d14", preferences: contract({ theme: "dark" }) });
  assert.deepEqual(await ok({ command: "putPreferences", accountId: "d14", preferences: contract({ theme: "light" }), ifMatch: 1 }), { revision: 2 });
  const again = await refusal({ command: "putPreferences", accountId: "d14", preferences: contract({ theme: null }), ifMatch: 1 }, "STALE");
  assert.equal(again.revision, 2);
  assert.deepEqual(await ok({ command: "getPreferences", accountId: "d14" }), { contract: contract({ theme: "light" }), revision: 2 });
  // The refusal crosses the seam with its revision.
  const client = createStoreClient(localInvoker(store.handle));
  await assert.rejects(client.call("putPreferences", { accountId: "d14", preferences: contract(), ifMatch: 7 }), (e) => e instanceof StoreRefusal && e.code === "STALE" && e.details.revision === 2);
});

test("S16, D10: an erased account is refused by every command but the erasure, which can be repeated", { skip }, async () => {
  await ok({ command: "putPreferences", accountId: "d10", preferences: contract() });
  assert.deepEqual(await ok({ command: "erase", accountId: "d10" }), { erased: true });
  assert.deepEqual(await rowsOf(db, "d10"), { ...NONE, erasures: 1 });
  for (const command of ["session", "getPreferences", "export"]) await refusal({ command, accountId: "d10" }, "ACCOUNT_ERASED");
  await refusal({ command: "putPreferences", accountId: "d10", preferences: contract() }, "ACCOUNT_ERASED");
  assert.deepEqual(await ok({ command: "erase", accountId: "d10" }), { erased: false });
  assert.deepEqual(await rowsOf(db, "d10"), { ...NONE, erasures: 1 });
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
  assert.deepEqual(await ok({ command: "export", accountId: "xe-unknown" }), { account: null, preferences: null, stripe: { customer: null, subscriptions: [] } });
  await ok({ command: "putPreferences", accountId: "xe", preferences: contract() });
  await ok({ command: "putPreferences", accountId: "xe-other", preferences: contract({ theme: "dark", country: "BRA" }) });
  await db.query("INSERT INTO account.stripe_customers (account_id, customer_id) VALUES ('xe', 'cus_xe')");
  await db.query("SELECT account.record_subscription('sub_xe', 'xe', 2::smallint, 'canceled', '2026-10-01', false, '2026-09-01')");
  const out = await ok({ command: "export", accountId: "xe" });
  assert.deepEqual(Object.keys(out), ["account", "preferences", "stripe"]);
  assert.equal(out.account.accountId, "xe");
  assert.equal(out.account.level, 1);
  assert.match(out.account.lastSeenOn, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(!Number.isNaN(Date.parse(out.account.createdAt)));
  assert.deepEqual(out.preferences.contract, contract());
  assert.equal(out.preferences.revision, 1);
  assert.ok(!Number.isNaN(Date.parse(out.preferences.updatedAt)));
  assert.equal(out.stripe.customer.customerId, "cus_xe");
  assert.deepEqual(out.stripe.subscriptions.map((s) => [s.subscriptionId, s.level, s.status]), [["sub_xe", 2, "canceled"]]);
  assert.ok(!JSON.stringify(out).includes("xe-other") && !JSON.stringify(out).includes("BRA"));
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
  const roles = (await pool.query("SELECT current_setting('role') AS role")).rows[0];
  assert.equal(roles.role, "vega_account");
  await assert.rejects(pool.query("CREATE TABLE account.extra (x int)"), (e) => e.code === "42501");
});
