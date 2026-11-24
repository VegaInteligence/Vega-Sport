/**
 * The store: the only code with a connection to the account tables (login vega_v2_account, group
 * vega_account, one connection per copy of the function). It takes typed commands and nothing
 * else, and answers `{ ok: true, value }` or `{ ok: false, code, message }`; an unexpected
 * failure is thrown (the Lambda runtime reports it as a function error). Failure modes:
 * FAILURE_MODES.md, section 7 (D1 to D13), S15, S16 and section 9.
 *
 * Commands: session, getPreferences, putPreferences, mergePreferences, export, erase. Every
 * write of one account runs under a transaction lock on that account, so two writes never mix.
 * The JSON of the preferences is mapped to rows by src/contract.mjs alone.
 */
import pg from "pg";
import { parse, toRows, fromRows, merge, ContractError } from "./contract.mjs";

const ACCOUNT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const DATE_OID = 1082;
// A calendar date stays the text PostgreSQL sends (as in backend/api/src/db.mjs).
const types = { getTypeParser: (oid, format) => (oid === DATE_OID ? (value) => value : pg.types.getTypeParser(oid, format)) };

/**
 * The pool of the store. `role`: the group role to act as (vega_account); `ca`: the RDS CA,
 * TLS verified, never disabled; `idleSessionMs`: the base closes a session left idle that long
 * (a frozen copy of the function keeps its connection otherwise).
 */
export function createPool(connectionString, { max = 1, timeoutMs = 5000, role = null, ca = null, idleSessionMs = null, Pool = pg.Pool } = {}) {
  if (role !== null && !/^[a-z_][a-z0-9_]{0,62}$/.test(role)) throw new Error("invalid role");
  if (idleSessionMs !== null && !(Number.isInteger(idleSessionMs) && idleSessionMs > 0)) throw new Error("invalid idle session limit");
  const pool = new Pool({
    connectionString,
    max,
    types,
    idleTimeoutMillis: 300_000,
    keepAlive: true,
    ...(ca && { ssl: { ca, rejectUnauthorized: true } }),
    options: `-c statement_timeout=${timeoutMs} -c lock_timeout=3000 -c search_path=account${idleSessionMs ? ` -c idle_session_timeout=${idleSessionMs}` : ""}${role ? ` -c role=${role}` : ""}`,
  });
  // An idle connection closed by the base or the network: the pool drops it.
  pool.on("error", () => {});
  return pool;
}

/** Fields each command takes beyond `command` and `accountId`. */
const COMMANDS = { session: [], getPreferences: [], putPreferences: ["preferences"], mergePreferences: ["preferences"], export: [], erase: [] };

class Refusal extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
const refuse = (code, message) => ({ ok: false, code, message });
const lost = (error) =>
  error.code === "57P05" || (!error.severity && (["ECONNRESET", "EPIPE", "ETIMEDOUT"].includes(error.code) || /Connection terminated|connection.*(closed|ended)/i.test(error.message || "")));
const iso = (value) => (value instanceof Date ? value.toISOString() : value);

/** The command if it is one, else null. */
function checked(command) {
  if (command === null || typeof command !== "object" || Array.isArray(command)) return null;
  if (typeof command.command !== "string" || !Object.hasOwn(COMMANDS, command.command)) return null;
  const fields = COMMANDS[command.command];
  if (Object.keys(command).some((key) => !["command", "accountId", ...fields].includes(key))) return null;
  if (fields.some((field) => command[field] === undefined)) return null;
  if (typeof command.accountId !== "string" || !ACCOUNT_ID.test(command.accountId)) return null;
  return command;
}

/** The rows of the preference contract of one account, in their order. */
async function readRows(client, id) {
  const preferences = (await client.query("SELECT focus, theme, country, home_priority, preferred_competition, onboarding_complete FROM account.preferences WHERE account_id = $1", [id])).rows[0] ?? null;
  const leagues = (await client.query("SELECT entity_id FROM account.follows WHERE account_id = $1 AND kind = 'competition' ORDER BY position, entity_id", [id])).rows;
  const lists = (await client.query("SELECT list_id, client_id, name FROM account.lists WHERE account_id = $1 ORDER BY position, list_id", [id])).rows;
  const entries = (
    await client.query(
      "SELECT e.list_id, e.kind, e.entity_id, e.season FROM account.list_entries e JOIN account.lists l ON l.list_id = e.list_id WHERE l.account_id = $1 ORDER BY e.list_id, e.position, e.kind, e.entity_id",
      [id],
    )
  ).rows;
  const byList = new Map(lists.map((list) => [list.list_id, []]));
  for (const entry of entries) byList.get(entry.list_id).push(entry);
  return { preferences, leagues, lists: lists.map((list) => ({ ...list, entries: byList.get(list.list_id) })) };
}

/** Replaces the account's preferences with a normalised contract. Rows that stay keep their dates. */
async function writeContract(client, id, contract, hooks) {
  const rows = toRows(contract);
  await client.query("INSERT INTO account.accounts (account_id) VALUES ($1) ON CONFLICT DO NOTHING", [id]);
  // The columns are the contract's (src/contract.mjs FIELDS), checked as identifiers.
  const columns = Object.keys(rows.preferences);
  if (!columns.every((c) => /^[a-z_]{1,63}$/.test(c))) throw new Error("invalid column");
  await client.query(
    `INSERT INTO account.preferences (account_id, ${columns.join(", ")}) VALUES ($1, ${columns.map((_, i) => `$${i + 2}`).join(", ")})
     ON CONFLICT (account_id) DO UPDATE SET ${columns.map((c) => `${c} = EXCLUDED.${c}`).join(", ")}, updated_at = now()`,
    [id, ...columns.map((c) => rows.preferences[c])],
  );
  // Followed competitions; national teams, which the contract does not carry, are left alone.
  const leagueIds = rows.leagues.map((r) => r.entity_id);
  await client.query("DELETE FROM account.follows WHERE account_id = $1 AND kind = 'competition' AND NOT (entity_id = ANY ($2::text[]))", [id, leagueIds]);
  await client.query(
    `INSERT INTO account.follows (account_id, kind, entity_id, position)
     SELECT $1, 'competition', e, p FROM unnest($2::text[], $3::smallint[]) AS t(e, p)
     ON CONFLICT (account_id, kind, entity_id) DO UPDATE SET position = EXCLUDED.position`,
    [id, leagueIds, rows.leagues.map((r) => r.position)],
  );
  // Lists by client_id, then their entries by (kind, id).
  const clientIds = rows.lists.map((l) => l.client_id);
  await client.query("DELETE FROM account.lists WHERE account_id = $1 AND NOT (client_id = ANY ($2::text[]))", [id, clientIds]);
  const listIds = new Map(
    (
      await client.query(
        `INSERT INTO account.lists (account_id, client_id, name, position)
         SELECT $1, c, n, p FROM unnest($2::text[], $3::text[], $4::smallint[]) AS t(c, n, p)
         ON CONFLICT (account_id, client_id) DO UPDATE SET name = EXCLUDED.name, position = EXCLUDED.position, updated_at = now()
         RETURNING list_id, client_id`,
        [id, clientIds, rows.lists.map((l) => l.name), rows.lists.map((l) => l.position)],
      )
    ).rows.map((r) => [r.client_id, r.list_id]),
  );
  hooks.beforeEntries?.();
  const e = { list: [], kind: [], entity: [], season: [], position: [] };
  for (const list of rows.lists)
    for (const entry of list.entries) {
      e.list.push(listIds.get(list.client_id));
      e.kind.push(entry.kind);
      e.entity.push(entry.entity_id);
      e.season.push(entry.season);
      e.position.push(entry.position);
    }
  await client.query(
    `DELETE FROM account.list_entries x USING account.lists l
     WHERE l.list_id = x.list_id AND l.account_id = $1
       AND (x.list_id, x.kind, x.entity_id) NOT IN (SELECT * FROM unnest($2::bigint[], $3::text[], $4::text[]))`,
    [id, e.list, e.kind, e.entity],
  );
  await client.query(
    `INSERT INTO account.list_entries (list_id, kind, entity_id, season, position)
     SELECT * FROM unnest($1::bigint[], $2::text[], $3::text[], $4::text[], $5::integer[])
     ON CONFLICT (list_id, kind, entity_id) DO UPDATE SET season = EXCLUDED.season, position = EXCLUDED.position`,
    [e.list, e.kind, e.entity, e.season, e.position],
  );
}

/** Everything the base holds for one account (X1), timestamps as ISO text. */
async function exportOf(client, id) {
  const account = (await client.query("SELECT account_id, created_at, last_seen_on, account.level_of(account_id) AS level FROM account.accounts WHERE account_id = $1", [id])).rows[0];
  const follows = (await client.query("SELECT kind, entity_id, position, followed_at FROM account.follows WHERE account_id = $1 ORDER BY kind, position, entity_id", [id])).rows;
  const lists = (await client.query("SELECT list_id, client_id, name, position, created_at, updated_at FROM account.lists WHERE account_id = $1 ORDER BY position, list_id", [id])).rows;
  const entries = (
    await client.query(
      "SELECT e.list_id, e.kind, e.entity_id, e.season, e.position, e.added_at FROM account.list_entries e JOIN account.lists l ON l.list_id = e.list_id WHERE l.account_id = $1 ORDER BY e.list_id, e.position",
      [id],
    )
  ).rows;
  const customer = (await client.query("SELECT customer_id, created_at FROM account.stripe_customers WHERE account_id = $1", [id])).rows[0];
  const subscriptions = (
    await client.query(
      "SELECT subscription_id, level, status, current_period_end, cancel_at_period_end, event_created, updated_at FROM account.subscriptions WHERE account_id = $1 ORDER BY subscription_id",
      [id],
    )
  ).rows;
  return {
    account: account ? { accountId: account.account_id, createdAt: iso(account.created_at), lastSeenOn: account.last_seen_on, level: account.level } : null,
    preferences: fromRows(await readRows(client, id)),
    follows: follows.map((f) => ({ kind: f.kind, entityId: f.entity_id, position: f.position, followedAt: iso(f.followed_at) })),
    lists: lists.map((l) => ({
      clientId: l.client_id,
      name: l.name,
      position: l.position,
      createdAt: iso(l.created_at),
      updatedAt: iso(l.updated_at),
      entries: entries.filter((x) => x.list_id === l.list_id).map((x) => ({ kind: x.kind, entityId: x.entity_id, season: x.season, position: x.position, addedAt: iso(x.added_at) })),
    })),
    stripe: {
      customer: customer ? { customerId: customer.customer_id, createdAt: iso(customer.created_at) } : null,
      subscriptions: subscriptions.map((s) => ({
        subscriptionId: s.subscription_id,
        level: s.level,
        status: s.status,
        currentPeriodEnd: iso(s.current_period_end),
        cancelAtPeriodEnd: s.cancel_at_period_end,
        eventCreated: iso(s.event_created),
        updatedAt: iso(s.updated_at),
      })),
    },
  };
}

/**
 * The store's handler. `pool`: from createPool. `hooks.beforeEntries`: a test's way to fail a
 * write halfway (D6); none in production.
 */
export function createStore({ pool, hooks = {} }) {
  /** Runs `work` in one transaction; a write locks the account, an erased account is refused. */
  async function transaction(id, work, { write, allowErased = false }) {
    const client = await pool.connect();
    let failure = null;
    try {
      await client.query(write ? "BEGIN" : "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      if (write) await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 38))", [id]);
      if (!allowErased && (await client.query("SELECT 1 FROM account.erasures WHERE account_id = $1", [id])).rowCount)
        throw new Refusal("ACCOUNT_ERASED", "this account was erased");
      const value = await work(client);
      await client.query("COMMIT");
      return { ok: true, value };
    } catch (error) {
      failure = error;
      await client.query("ROLLBACK").catch(() => {});
      if (error instanceof Refusal || error instanceof ContractError) return refuse(error.code, error.message);
      throw error;
    } finally {
      client.release(failure && lost(failure) ? failure : undefined);
    }
  }

  const run = {
    session: (id) =>
      transaction(id, async (client) => {
        const created = (await client.query("INSERT INTO account.accounts (account_id) VALUES ($1) ON CONFLICT DO NOTHING", [id])).rowCount === 1;
        // One write a day at most: the day of the last sign-in, not its instant.
        if (!created) await client.query("UPDATE account.accounts SET last_seen_on = current_date WHERE account_id = $1 AND last_seen_on < current_date", [id]);
        const level = (await client.query("SELECT account.level_of($1) AS level", [id])).rows[0].level;
        return { created, level };
      }, { write: true }),
    getPreferences: (id) => transaction(id, async (client) => fromRows(await readRows(client, id)), { write: false }),
    putPreferences: (id, { preferences }) => {
      const contract = parse(preferences);
      return transaction(id, async (client) => {
        await writeContract(client, id, contract, hooks);
        return fromRows(await readRows(client, id));
      }, { write: true });
    },
    mergePreferences: (id, { preferences }) => {
      const browser = parse(preferences);
      return transaction(id, async (client) => {
        const merged = merge(fromRows(await readRows(client, id)), browser);
        await writeContract(client, id, merged, hooks);
        return fromRows(await readRows(client, id));
      }, { write: true });
    },
    export: (id) => transaction(id, (client) => exportOf(client, id), { write: false }),
    // The tombstone first, then the account row and everything that hangs from it (cascade).
    erase: (id) =>
      transaction(id, async (client) => {
        const live = await client.query("SELECT 1 FROM account.subscriptions WHERE account_id = $1 AND status IN ('trialing', 'active', 'past_due') AND current_period_end > now()", [id]);
        if (live.rowCount) throw new Refusal("SUBSCRIPTION_ACTIVE", "a subscription is live: cancel it first");
        await client.query("INSERT INTO account.erasures (account_id) VALUES ($1) ON CONFLICT DO NOTHING", [id]);
        return { erased: (await client.query("DELETE FROM account.accounts WHERE account_id = $1", [id])).rowCount === 1 };
      }, { write: true, allowErased: true }),
  };

  async function handle(command) {
    const valid = checked(command);
    if (!valid) return refuse("INVALID_COMMAND", "not a command of the store");
    try {
      return await run[valid.command](valid.accountId, valid);
    } catch (error) {
      if (error instanceof ContractError) return refuse(error.code, error.message);
      throw error;
    }
  }
  return { handle, end: () => pool.end() };
}
