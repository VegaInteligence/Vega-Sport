// The account tables and their role (backend/account/sql/001_accounts.sql), on a disposable local
// database. Failure modes pinned here: backend/account/FAILURE_MODES.md, section 3 (S1 to S7, S16, S17;
// S8 to S15 were withdrawn on 24 Nov 2026 with the typed preference tables).
//
//   VEGA_V2_ACCOUNT_TEST_DSN=postgresql://<owner>@127.0.0.1:5432/vega_v2_account_test npm test
//
// The migration names no football table, so it is applied alone, as the owner; the other
// group roles are created empty to check that they hold nothing on the schema.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { migrations } from "./support.mjs";

const DSN = process.env.VEGA_V2_ACCOUNT_TEST_DSN;
const skip = !DSN && "requires VEGA_V2_ACCOUNT_TEST_DSN (local vega_v2_account_test)";
// Every file of sql/, in order: what a deployment applies (001 the tables, 002 the account API's additions).
const MIGRATION = migrations().map((m) => m.sql).join("\n");
const TABLES = ["accounts", "preferences", "stripe_customers", "subscriptions", "stripe_events", "erasures"];
const OTHERS = ["vega_read", "vega_collect", "vega_calc"];
let db;

before(async () => {
  if (skip) return;
  const target = new URL(DSN);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) || target.pathname !== "/vega_v2_account_test")
    throw new Error("dedicated local account test DB required");
  db = new pg.Client({ connectionString: DSN });
  await db.connect();
  await db.query("DROP SCHEMA IF EXISTS account CASCADE");
  for (const role of OTHERS) await db.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN CREATE ROLE ${role} NOLOGIN; END IF; END $$`);
  await db.query("BEGIN");
  for (const file of migrations()) await db.query(file.sql);
  await db.query("COMMIT");
});
after(() => db?.end());

const rows = async (sql, values) => (await db.query(sql, values)).rows;
const one = async (sql, values) => Object.values((await rows(sql, values))[0])[0];
const refused = (sql, values, code) => assert.rejects(db.query(sql, values), (error) => error.code === code, sql);
const CHECK = "23514",
  UNIQUE = "23505",
  DENIED = "42501";
/** Runs `work` as a group role, then comes back to the owner. */
async function as(role, work) {
  await db.query(`SET ROLE ${role}`);
  try {
    return await work();
  } finally {
    await db.query("RESET ROLE");
  }
}
async function account(id) {
  await db.query("INSERT INTO account.accounts (account_id) VALUES ($1) ON CONFLICT DO NOTHING", [id]);
  return id;
}
const subscribe = (sub, id, level, status, end, created, atEnd = false) =>
  one("SELECT account.record_subscription($1, $2, $3::smallint, $4, $5, $6, $7)", [sub, id, level, status, end, atEnd, created]);

test("the schema holds exactly the tables this suite knows", { skip }, async () => {
  const found = await rows("SELECT tablename FROM pg_tables WHERE schemaname = 'account' ORDER BY 1");
  assert.deepEqual(found.map((r) => r.tablename), [...TABLES].sort());
});

test("S1: the read API's role and the worker's roles hold nothing on the account schema", { skip }, async () => {
  for (const role of OTHERS) {
    assert.equal(await one("SELECT has_schema_privilege($1, 'account', 'USAGE')", [role]), false, role);
    for (const table of TABLES)
      assert.equal(await one("SELECT has_table_privilege($1, $2, 'SELECT, INSERT, UPDATE, DELETE')", [role, `account.${table}`]), false, `${role} ${table}`);
    assert.equal(await one("SELECT has_function_privilege($1, 'account.level_of(text, timestamptz)', 'EXECUTE')", [role]), false, role);
    await as(role, () => refused("SELECT * FROM account.accounts", [], DENIED));
  }
  // Nothing either for a login without any group.
  assert.equal(await one("SELECT has_schema_privilege('public', 'account', 'USAGE')"), false);
});

test("S2: the account role is granted the account schema and nothing else", { skip }, async () => {
  const grants = MIGRATION.split(";").map((s) => s.replace(/--.*$/gm, "").trim()).filter((s) => /^GRANT\b/i.test(s));
  assert.ok(grants.length >= 4);
  for (const grant of grants) {
    assert.match(grant, /TO vega_account$/, grant);
    assert.match(grant, /\b(SCHEMA account|account\.[a-z_]+\()/, grant);
    assert.doesNotMatch(grant, /\b(core|agg|ops|api|public)\b/, grant);
  }
  assert.doesNotMatch(MIGRATION, /SECURITY DEFINER/i);
  assert.doesNotMatch(MIGRATION, /REFERENCES (?!account\.)/);
  await as("vega_account", async () => {
    await db.query("INSERT INTO account.accounts (account_id) VALUES ('s2')");
    await db.query("INSERT INTO account.preferences (account_id, document) VALUES ('s2', '{\"v\":1}')");
    assert.equal(await one("SELECT account.level_of('s2')"), 1);
    await db.query("DELETE FROM account.accounts WHERE account_id = 's2'");
    await refused("CREATE TABLE account.extra (x int)", [], DENIED);
    await refused("ALTER TABLE account.accounts ADD COLUMN email text", [], DENIED);
  });
});

test("S3: deleting an account erases every row that names it", { skip }, async () => {
  const id = await account("s3"),
    other = await account("s3-other");
  await db.query("INSERT INTO account.preferences (account_id, document) VALUES ($1, '{\"v\":1,\"theme\":\"dark\"}'), ($2, '{\"v\":1}')", [id, other]);
  await db.query("INSERT INTO account.stripe_customers (account_id, customer_id) VALUES ($1, 'cus_s3')", [id]);
  await subscribe("sub_s3", id, 2, "active", "2099-01-01", "2026-11-23");
  await db.query("DELETE FROM account.accounts WHERE account_id = $1", [id]);
  for (const table of ["preferences", "stripe_customers", "subscriptions"])
    assert.equal(await one(`SELECT count(*)::int FROM account.${table} WHERE account_id = $1`, [id]), 0, table);
  assert.equal(await one("SELECT count(*)::int FROM account.preferences WHERE account_id = $1", [other]), 1); // the other account's stays
  // Every table but the list of handled events and the erasures (S16) hangs from an account.
  const hanging = await rows(
    "SELECT c.relname FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid WHERE k.contype = 'f' AND k.confdeltype = 'c' AND c.relnamespace = 'account'::regnamespace",
  );
  assert.deepEqual([...new Set(hanging.map((r) => r.relname))].sort(), TABLES.filter((t) => !["accounts", "stripe_events", "erasures"].includes(t)).sort());
});

test("S4: a subscription's level is 2 or 3, its status one Stripe knows", { skip }, async () => {
  const id = await account("s4");
  for (const level of [0, 1, 4]) await refused("SELECT account.record_subscription('sub_s4', $1, $2::smallint, 'active', '2099-01-01', false, '2026-11-23')", [id, level], CHECK);
  await refused("SELECT account.record_subscription('sub_s4', $1, 2::smallint, 'gifted', '2099-01-01', false, '2026-11-23')", [id], CHECK);
  await refused("SELECT account.record_subscription('s4', $1, 2::smallint, 'active', '2099-01-01', false, '2026-11-23')", [id], CHECK);
});

test("S5: the level of an account follows its live subscriptions", { skip }, async () => {
  const at = "2026-12-01T00:00:00Z";
  const level = (id, when = at) => one("SELECT account.level_of($1, $2)", [id, when]);
  assert.equal(await level("nobody"), 0);
  const id = await account("s5");
  assert.equal(await level(id), 1);
  await subscribe("sub_s5a", id, 2, "active", "2027-01-01T00:00:00Z", "2026-11-23");
  assert.equal(await level(id), 2);
  assert.equal(await level(id, "2027-01-01T00:00:00Z"), 1); // the period's last instant is already over
  assert.equal(await level(id, "2026-12-31T23:59:59Z"), 2);
  await subscribe("sub_s5b", id, 3, "trialing", "2026-12-15T00:00:00Z", "2026-11-23");
  assert.equal(await level(id), 3);
  assert.equal(await level(id, "2026-12-20T00:00:00Z"), 2); // the trial ended, Plus remains
  for (const [status, expected] of [["past_due", 3], ["unpaid", 2], ["canceled", 2], ["incomplete", 2], ["incomplete_expired", 2], ["paused", 2]]) {
    await subscribe("sub_s5b", id, 3, status, "2026-12-15T00:00:00Z", "2026-11-24");
    assert.equal(await level(id), expected, status);
  }
  // Cancelled at the period's end: the right holds until then.
  await subscribe("sub_s5a", id, 2, "active", "2027-01-01T00:00:00Z", "2026-11-25", true);
  assert.equal(await level(id), 2);
});

test("S6: an event is handled once, and an older event never replaces a newer one", { skip }, async () => {
  const id = await account("s6");
  assert.equal(await subscribe("sub_s6", id, 2, "active", "2027-01-01", "2026-11-23T10:00:00Z"), true);
  assert.equal(await subscribe("sub_s6", id, 3, "active", "2027-01-01", "2026-11-23T11:00:00Z"), true);
  assert.equal(await subscribe("sub_s6", id, 2, "canceled", "2026-12-01", "2026-11-23T10:30:00Z"), false); // late
  assert.deepEqual(await rows("SELECT level, status FROM account.subscriptions WHERE subscription_id = 'sub_s6'"), [{ level: 3, status: "active" }]);
  assert.equal(await subscribe("sub_s6", id, 3, "canceled", "2027-01-01", "2026-11-23T11:00:00Z"), true); // same second: the last received wins
  // A subscription never changes hands.
  const thief = await account("s6-thief");
  assert.equal(await subscribe("sub_s6", thief, 3, "active", "2099-01-01", "2026-11-24T00:00:00Z"), false);
  assert.equal(await one("SELECT account_id FROM account.subscriptions WHERE subscription_id = 'sub_s6'"), id);
  const record = "INSERT INTO account.stripe_events (event_id, type, event_created) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING";
  assert.equal((await db.query(record, ["evt_s6", "customer.subscription.updated", "2026-11-23"])).rowCount, 1);
  assert.equal((await db.query(record, ["evt_s6", "customer.subscription.updated", "2026-11-23"])).rowCount, 0);
  await refused("INSERT INTO account.stripe_events (event_id, type, event_created) VALUES ('s6', 'x', now())", [], CHECK);
});

test("S7: a Stripe customer belongs to one account, an account has one customer", { skip }, async () => {
  const a = await account("s7a"),
    b = await account("s7b");
  await db.query("INSERT INTO account.stripe_customers (account_id, customer_id) VALUES ($1, 'cus_s7')", [a]);
  await refused("INSERT INTO account.stripe_customers (account_id, customer_id) VALUES ($1, 'cus_s7')", [b], UNIQUE);
  await refused("INSERT INTO account.stripe_customers (account_id, customer_id) VALUES ($1, 'cus_other')", [a], UNIQUE);
  await refused("INSERT INTO account.stripe_customers (account_id, customer_id) VALUES ($1, 'sub_wrong')", [b], CHECK);
});

test("S11 (withdrawn), S17: one JSON column, the preference document; every other column typed and checked", { skip }, async () => {
  const columns = await rows(
    `SELECT c.table_name, c.column_name, c.data_type,
            EXISTS (SELECT 1 FROM pg_constraint k JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = ANY (k.conkey)
                    WHERE k.conrelid = format('account.%I', c.table_name)::regclass AND k.contype IN ('c', 'f') AND a.attname = c.column_name) AS constrained
     FROM information_schema.columns c WHERE c.table_schema = 'account'`,
  );
  assert.ok(columns.length > 20);
  for (const column of columns) {
    const where = `${column.table_name}.${column.column_name}`;
    if (where === "preferences.document") assert.equal(column.data_type, "jsonb");
    else assert.ok(!["json", "jsonb", "ARRAY", "bytea", "USER-DEFINED"].includes(column.data_type), `${where}: ${column.data_type}`);
    if (["text", "jsonb"].includes(column.data_type)) assert.ok(column.constrained, `${where}: without a check`);
    // Identity stays at Neon: no column for an e-mail, a person's name, a phone, an address or a password.
    assert.doesNotMatch(column.column_name, /^(e_?mail|(first|last|full|display|user)_?name|phone|address|ip(_address)?|password|birth.*)$/i, `${where}: personal data`);
  }
  assert.deepEqual((await rows("SELECT column_name FROM information_schema.columns WHERE table_schema = 'account' AND table_name = 'preferences' ORDER BY ordinal_position")).map((r) => r.column_name), ["account_id", "document", "revision", "updated_at"]);
});

test("S17: the document is an object of version 1 under 3 MiB of text; the revision starts at 1", { skip }, async () => {
  const id = await account("s17");
  const put = "INSERT INTO account.preferences (account_id, document, revision) VALUES ($1, $2::jsonb, $3) ON CONFLICT (account_id) DO UPDATE SET document = EXCLUDED.document, revision = EXCLUDED.revision";
  for (const bad of ["[]", "null", "1", '"x"', "{}", '{"v":2}', '{"v":"1"}', '{"v":1.5}']) await refused(put, [id, bad, 1], CHECK);
  for (const revision of [0, -1]) await refused(put, [id, '{"v":1}', revision], CHECK);
  await refused(put, [id, JSON.stringify({ v: 1, pad: "x".repeat(3 * 1024 * 1024) }), 1], CHECK);
  await db.query(put, [id, JSON.stringify({ v: 1, pad: "x".repeat(2 * 1024 * 1024) }), 1]);
  await db.query(put, [id, '{"v":1,"nested":{"a":[null,"",1.25]}}', 2]);
  assert.deepEqual(await one("SELECT document FROM account.preferences WHERE account_id = $1", [id]), { v: 1, nested: { a: [null, "", 1.25] } });
  assert.equal(await one("SELECT revision = 2 AND updated_at <= now() FROM account.preferences WHERE account_id = $1", [id]), true);
  await refused("INSERT INTO account.preferences (account_id, document) VALUES ('nobody', '{\"v\":1}')", [], "23503");
});

test("S16: an erasure outlives the account row, holds the id and the instant, and the account role can write it", { skip }, async () => {
  const id = await account("s16");
  await as("vega_account", async () => {
    await db.query("INSERT INTO account.erasures (account_id) VALUES ($1)", [id]);
    await db.query("DELETE FROM account.accounts WHERE account_id = $1", [id]);
  });
  assert.equal(await one("SELECT count(*)::int FROM account.erasures WHERE account_id = $1 AND erased_at <= now()", [id]), 1);
  await refused("INSERT INTO account.erasures (account_id) VALUES ($1)", [id], UNIQUE);
  await refused("INSERT INTO account.erasures (account_id) VALUES ($1)", ["a b"], CHECK);
  for (const role of OTHERS) assert.equal(await one("SELECT has_table_privilege($1, 'account.erasures', 'SELECT')", [role]), false, role);
});
