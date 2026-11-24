// The account tables and their role (backend/account/sql/001_accounts.sql), on a disposable local
// database. Failure modes pinned here: backend/account/FAILURE_MODES.md, section 3 (S1 to S14).
//
//   VEGA_V2_ACCOUNT_TEST_DSN=postgresql://<owner>@127.0.0.1:5432/vega_v2_account_test npm test
//
// The migration names no football table, so it is applied alone, as the owner; the other
// group roles are created empty to check that they hold nothing on the schema.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import pg from "pg";

const DSN = process.env.VEGA_V2_ACCOUNT_TEST_DSN;
const skip = !DSN && "requires VEGA_V2_ACCOUNT_TEST_DSN (local vega_v2_account_test)";
const MIGRATION = readFileSync(new URL("../sql/001_accounts.sql", import.meta.url), "utf8");
const TABLES = ["accounts", "preferences", "follows", "lists", "list_entries", "stripe_customers", "subscriptions", "stripe_events"];
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
  await db.query(MIGRATION);
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
    await db.query("INSERT INTO account.lists (account_id, client_id, name) VALUES ('s2', 'main', 'Mes joueurs')");
    assert.equal(await one("SELECT account.level_of('s2')"), 1);
    await db.query("DELETE FROM account.accounts WHERE account_id = 's2'");
    await refused("CREATE TABLE account.extra (x int)", [], DENIED);
    await refused("ALTER TABLE account.accounts ADD COLUMN email text", [], DENIED);
  });
});

test("S3: deleting an account erases every row that names it", { skip }, async () => {
  const id = await account("s3"),
    other = await account("s3-other");
  await db.query("INSERT INTO account.preferences (account_id, theme) VALUES ($1, 'dark'), ($2, 'light')", [id, other]);
  await db.query("INSERT INTO account.follows (account_id, kind, entity_id) VALUES ($1, 'competition', 'l_abc123'), ($2, 'competition', 'l_abc123')", [id, other]);
  for (const owner of [id, other]) {
    const list = await one("INSERT INTO account.lists (account_id, client_id, name) VALUES ($1, 'main', 'Liste') RETURNING list_id", [owner]);
    await db.query("INSERT INTO account.list_entries (list_id, kind, entity_id) VALUES ($1, 'players', 'p_abc123')", [list]);
  }
  await db.query("INSERT INTO account.stripe_customers (account_id, customer_id) VALUES ($1, 'cus_s3')", [id]);
  await subscribe("sub_s3", id, 2, "active", "2099-01-01", "2026-11-23");
  await db.query("DELETE FROM account.accounts WHERE account_id = $1", [id]);
  for (const table of ["preferences", "follows", "lists", "stripe_customers", "subscriptions"])
    assert.equal(await one(`SELECT count(*)::int FROM account.${table} WHERE account_id = $1`, [id]), 0, table);
  assert.equal(await one("SELECT count(*)::int FROM account.list_entries"), 1); // the other account's entry stays
  assert.equal(await one("SELECT count(*)::int FROM account.follows WHERE account_id = $1", [other]), 1);
  // Every table but the list of handled events hangs from an account.
  const hanging = await rows(
    "SELECT c.relname FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid WHERE k.contype = 'f' AND k.confdeltype = 'c' AND c.relnamespace = 'account'::regnamespace",
  );
  assert.deepEqual([...new Set(hanging.map((r) => r.relname))].sort(), TABLES.filter((t) => !["accounts", "stripe_events"].includes(t)).sort());
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

test("S8: the same entity is followed once and listed once per list", { skip }, async () => {
  const id = await account("s8");
  const follow = "INSERT INTO account.follows (account_id, kind, entity_id) VALUES ($1, 'competition', 'l_abc123') ON CONFLICT DO NOTHING";
  assert.equal((await db.query(follow, [id])).rowCount, 1);
  assert.equal((await db.query(follow, [id])).rowCount, 0);
  const first = await one("INSERT INTO account.lists (account_id, client_id, name) VALUES ($1, 'main', 'A') RETURNING list_id", [id]);
  const second = await one("INSERT INTO account.lists (account_id, client_id, name, position) VALUES ($1, 'list-1795000000000', 'B', 1) RETURNING list_id", [id]);
  await refused("INSERT INTO account.lists (account_id, client_id, name) VALUES ($1, 'main', 'again')", [id], UNIQUE);
  const add = "INSERT INTO account.list_entries (list_id, kind, entity_id, season) VALUES ($1, 'players', 'p_abc123', '2025/2026') ON CONFLICT DO NOTHING";
  assert.equal((await db.query(add, [first])).rowCount, 1);
  assert.equal((await db.query(add, [first])).rowCount, 0);
  assert.equal((await db.query(add, [second])).rowCount, 1); // another list may hold the same player
});

test("S9: only public Vega ids of the right kind are stored", { skip }, async () => {
  const id = await account("s9");
  const list = await one("INSERT INTO account.lists (account_id, client_id, name) VALUES ($1, 'main', 'A') RETURNING list_id", [id]);
  const entry = "INSERT INTO account.list_entries (list_id, kind, entity_id) VALUES ($1, $2, $3)";
  for (const [kind, entity] of [["players", "t_abc123"], ["clubs", "p_abc123"], ["matches", "l_abc123"], ["players", "12345"], ["players", "p_"], ["players", "p_abc 123"], ["players", "p_abc123'; --"], ["players", "p_" + "a".repeat(25)], ["coaches", "p_abc123"]])
    await refused(entry, [list, kind, entity], CHECK);
  for (const [kind, entity] of [["players", "p_abc123"], ["players", "p_v1234567"], ["clubs", "t_abc123"], ["matches", "m_abc123"]]) await db.query(entry, [list, kind, entity]);
  const follow = "INSERT INTO account.follows (account_id, kind, entity_id) VALUES ($1, $2, $3)";
  for (const [kind, entity] of [["competition", "t_abc123"], ["nation", "l_abc123"], ["player", "p_abc123"], ["competition", "l_"]]) await refused(follow, [id, kind, entity], CHECK);
  await db.query(follow, [id, "nation", "t_abc123"]);
  for (const bad of ["", "a b", "é", "x".repeat(65), "a.b"]) await refused("INSERT INTO account.accounts (account_id) VALUES ($1)", [bad], CHECK);
  await db.query("INSERT INTO account.accounts (account_id) VALUES ('0f3c9a52-7b1e-4c7a-9d4e-2a6b8c1d5e90')");
});

test("S10: positions and names are bounded", { skip }, async () => {
  const id = await account("s10");
  await refused("INSERT INTO account.lists (account_id, client_id, name, position) VALUES ($1, 'a', 'A', 50)", [id], CHECK);
  await refused("INSERT INTO account.lists (account_id, client_id, name, position) VALUES ($1, 'a', 'A', -1)", [id], CHECK);
  await refused("INSERT INTO account.lists (account_id, client_id, name) VALUES ($1, 'a', '')", [id], CHECK);
  await refused("INSERT INTO account.lists (account_id, client_id, name) VALUES ($1, 'a', $2)", [id, "n".repeat(61)], CHECK);
  await refused("INSERT INTO account.lists (account_id, client_id, name) VALUES ($1, 'a b', 'A')", [id], CHECK);
  const list = await one("INSERT INTO account.lists (account_id, client_id, name, position) VALUES ($1, 'a', $2, 49) RETURNING list_id", [id, "n".repeat(60)]);
  await refused("INSERT INTO account.list_entries (list_id, kind, entity_id, position) VALUES ($1, 'players', 'p_abc123', 5000)", [list], CHECK);
  await refused("INSERT INTO account.list_entries (list_id, kind, entity_id, season) VALUES ($1, 'players', 'p_abc123', 'last year')", [list], CHECK);
  await db.query("INSERT INTO account.list_entries (list_id, kind, entity_id, position, season) VALUES ($1, 'players', 'p_abc123', 4999, '2026')", [list]);
});

test("S11: preferences are typed and checked; no column holds JSON or unchecked text", { skip }, async () => {
  const id = await account("s11");
  await db.query("INSERT INTO account.preferences (account_id) VALUES ($1)", [id]);
  assert.deepEqual(await rows("SELECT focus, theme, country, preferred_competition, onboarding_complete FROM account.preferences WHERE account_id = $1", [id]), [
    { focus: "europe", theme: null, country: null, preferred_competition: null, onboarding_complete: false },
  ]);
  for (const [column, value] of [["focus", "world"], ["theme", "blue"], ["country", "fra"], ["preferred_competition", "t_abc123"]])
    await refused(`UPDATE account.preferences SET ${column} = $2 WHERE account_id = $1`, [id, value], CHECK);
  await db.query("UPDATE account.preferences SET focus = 'all', theme = 'dark', country = 'BRA', preferred_competition = 'l_abc123', onboarding_complete = true WHERE account_id = $1", [id]);
  const columns = await rows(
    `SELECT c.table_name, c.column_name, c.data_type,
            EXISTS (SELECT 1 FROM pg_constraint k JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = ANY (k.conkey)
                    WHERE k.conrelid = format('account.%I', c.table_name)::regclass AND k.contype IN ('c', 'f') AND a.attname = c.column_name) AS constrained
     FROM information_schema.columns c WHERE c.table_schema = 'account'`,
  );
  assert.ok(columns.length > 20);
  for (const column of columns) {
    assert.ok(!["json", "jsonb", "ARRAY", "bytea", "USER-DEFINED"].includes(column.data_type), `${column.table_name}.${column.column_name}: ${column.data_type}`);
    if (column.data_type === "text") assert.ok(column.constrained, `${column.table_name}.${column.column_name}: text without a check`);
    // Identity stays at Neon: no column for an e-mail, a person's name, a phone, an address or a password.
    assert.doesNotMatch(column.column_name, /^(e_?mail|(first|last|full|display|user)_?name|phone|address|ip(_address)?|password|birth.*)$/i, `${column.table_name}.${column.column_name}: personal data`);
  }
});

test("S12: the chosen country is the base's three-letter code or « none », as in the browser", { skip }, async () => {
  const id = await account("s12");
  await db.query("INSERT INTO account.preferences (account_id) VALUES ($1)", [id]);
  const set = "UPDATE account.preferences SET country = $2 WHERE account_id = $1";
  assert.equal(await one("SELECT country FROM account.preferences WHERE account_id = $1", [id]), null); // no choice: the detected country applies
  for (const bad of ["FR", "BR", "fra", "Fra", "FRAN", "NONE", "None", "", "INT-2", "F1A", " FRA"]) await refused(set, [id, bad], CHECK);
  for (const good of ["FRA", "ENG", "BRA", "none"]) {
    await db.query(set, [id, good]);
    assert.equal(await one("SELECT country FROM account.preferences WHERE account_id = $1", [id]), good);
  }
  await db.query(set, [id, null]); // back to no choice
});

test("S13: the home priority is « location » or « importance », and unset until the person chooses", { skip }, async () => {
  const id = await account("s13");
  await db.query("INSERT INTO account.preferences (account_id) VALUES ($1)", [id]);
  const set = "UPDATE account.preferences SET home_priority = $2 WHERE account_id = $1";
  assert.equal(await one("SELECT home_priority FROM account.preferences WHERE account_id = $1", [id]), null); // the site's fixed value applies
  for (const bad of ["", "local", "Location", "IMPORTANCE", "both", "location "]) await refused(set, [id, bad], CHECK);
  for (const good of ["location", "importance"]) {
    await db.query(set, [id, good]);
    assert.equal(await one("SELECT home_priority FROM account.preferences WHERE account_id = $1", [id]), good);
  }
});

test("S14: favourite clubs and players have one source, the lists; follows hold competitions and national teams only", { skip }, async () => {
  const id = await account("s14");
  const follow = "INSERT INTO account.follows (account_id, kind, entity_id) VALUES ($1, $2, $3)";
  for (const [kind, entity] of [["club", "t_abc123"], ["clubs", "t_abc123"], ["player", "p_abc123"], ["players", "p_abc123"], ["match", "m_abc123"]]) await refused(follow, [id, kind, entity], CHECK);
  await db.query(follow, [id, "competition", "l_abc123"]);
  await db.query(follow, [id, "nation", "t_abc123"]);
  const list = await one("INSERT INTO account.lists (account_id, client_id, name) VALUES ($1, 'main', 'A') RETURNING list_id", [id]);
  await db.query("INSERT INTO account.list_entries (list_id, kind, entity_id) VALUES ($1, 'clubs', 't_abc123'), ($1, 'players', 'p_abc123')", [list]);
  // What the home page reads as favourites: the clubs and players of the account's lists.
  assert.deepEqual(
    await rows("SELECT e.kind, e.entity_id FROM account.list_entries e JOIN account.lists l USING (list_id) WHERE l.account_id = $1 AND e.kind IN ('clubs', 'players') ORDER BY e.kind", [id]),
    [{ kind: "clubs", entity_id: "t_abc123" }, { kind: "players", entity_id: "p_abc123" }],
  );
});
