/**
 * The store: the only code with a connection to the account tables (login vega_v2_account, group
 * vega_account, one connection per copy of the function). It takes typed commands and nothing
 * else, and answers `{ ok: true, value }` or `{ ok: false, code, message }`; an unexpected
 * failure is thrown (the Lambda runtime reports it as a function error). Failure modes:
 * FAILURE_MODES.md, section 7 (D1 to D14), S16, S17 and section 9.
 *
 * Commands: session, getPreferences, putPreferences, export, erase. Every write of one account
 * runs under a transaction lock on that account, so two writes never mix. The preferences are one
 * document per account (the site's contract, stored as sent; src/contract.mjs checks it).
 */
import pg from "pg";
import { checkContract, ContractError } from "./contract.mjs";

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

/** Fields each command requires, and may take, beyond `command` and `accountId`. */
const COMMANDS = {
  session: { required: [], optional: [] },
  getPreferences: { required: [], optional: [] },
  putPreferences: { required: ["preferences"], optional: ["ifMatch"] },
  export: { required: [], optional: [] },
  erase: { required: [], optional: [] },
};

class Refusal extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.code = code;
    this.details = details;
  }
}
const refuse = (code, message, details = {}) => ({ ok: false, code, message, ...details });
const lost = (error) =>
  error.code === "57P05" || (!error.severity && (["ECONNRESET", "EPIPE", "ETIMEDOUT"].includes(error.code) || /Connection terminated|connection.*(closed|ended)/i.test(error.message || "")));
const iso = (value) => (value instanceof Date ? value.toISOString() : value);

/** The command if it is one, else null. */
function checked(command) {
  if (command === null || typeof command !== "object" || Array.isArray(command)) return null;
  if (typeof command.command !== "string" || !Object.hasOwn(COMMANDS, command.command)) return null;
  const { required, optional } = COMMANDS[command.command];
  if (Object.keys(command).some((key) => !["command", "accountId", ...required, ...optional].includes(key))) return null;
  if (required.some((field) => command[field] === undefined)) return null;
  if (typeof command.accountId !== "string" || !ACCOUNT_ID.test(command.accountId)) return null;
  if (Object.hasOwn(command, "ifMatch") && !(Number.isSafeInteger(command.ifMatch) && command.ifMatch >= 1)) return null;
  return command;
}

/** The stored document and its revision, both null when the account never saved. */
async function readDocument(client, id) {
  const row = (await client.query("SELECT document, revision, updated_at FROM account.preferences WHERE account_id = $1", [id])).rows[0];
  return row ? { contract: row.document, revision: Number(row.revision), updatedAt: iso(row.updated_at) } : null;
}

/** Everything the base holds for one account (X1), timestamps as ISO text. */
async function exportOf(client, id) {
  const account = (await client.query("SELECT account_id, created_at, last_seen_on, account.level_of(account_id) AS level FROM account.accounts WHERE account_id = $1", [id])).rows[0];
  const customer = (await client.query("SELECT customer_id, created_at FROM account.stripe_customers WHERE account_id = $1", [id])).rows[0];
  const subscriptions = (
    await client.query(
      "SELECT subscription_id, level, status, current_period_end, cancel_at_period_end, event_created, updated_at FROM account.subscriptions WHERE account_id = $1 ORDER BY subscription_id",
      [id],
    )
  ).rows;
  return {
    account: account ? { accountId: account.account_id, createdAt: iso(account.created_at), lastSeenOn: account.last_seen_on, level: account.level } : null,
    preferences: await readDocument(client, id),
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
 * The store's handler. `pool`: from createPool. `hooks.beforeDocument`: a test's way to fail a
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
      if (error instanceof Refusal) return refuse(error.code, error.message, error.details);
      if (error instanceof ContractError) return refuse(error.code, error.message);
      // A string jsonb cannot hold, should one pass the document's check (C5).
      if (error.code === "22P05") return refuse("CONTRACT_INVALID", "the preferences hold text the base cannot store");
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
    getPreferences: (id) =>
      transaction(id, async (client) => {
        const held = await readDocument(client, id);
        return { contract: held?.contract ?? null, revision: held?.revision ?? null };
      }, { write: false }),
    putPreferences: (id, { preferences, ifMatch }) => {
      const text = checkContract(preferences);
      return transaction(id, async (client) => {
        await client.query("INSERT INTO account.accounts (account_id) VALUES ($1) ON CONFLICT DO NOTHING", [id]);
        hooks.beforeDocument?.();
        // One statement each way: with If-Match, written only over the revision named (D14).
        const written =
          ifMatch === undefined
            ? await client.query(
                `INSERT INTO account.preferences AS p (account_id, document) VALUES ($1, $2::jsonb)
                 ON CONFLICT (account_id) DO UPDATE SET document = EXCLUDED.document, revision = p.revision + 1, updated_at = now()
                 RETURNING revision`,
                [id, text],
              )
            : await client.query("UPDATE account.preferences SET document = $2::jsonb, revision = revision + 1, updated_at = now() WHERE account_id = $1 AND revision = $3 RETURNING revision", [id, text, ifMatch]);
        if (!written.rowCount) {
          const held = await readDocument(client, id);
          throw new Refusal("STALE", "the preferences changed since that revision", { revision: held?.revision ?? null });
        }
        return { revision: Number(written.rows[0].revision) };
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
