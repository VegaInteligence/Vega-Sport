/**
 * Database access of the read API: the "lecture" role reads the api schema only
 * (its views read the rest with their owner's rights). Every statement runs in a
 * read-only transaction with a timeout.
 */
import pg from "pg";

const DATE_OID = 1082;
const TIMESTAMPTZ_OID = 1184;
// A calendar date stays the text PostgreSQL sends: parsed as a Date it would be local
// midnight, one day off once serialised in UTC from a server east of Greenwich.
export const types = {
  getTypeParser: (oid, format) => (oid === DATE_OID ? (value) => value : pg.types.getTypeParser(oid, format)),
};

/** A timestamp read inside JSON as its text (`column::text`: the text the column would
 * have sent), parsed as the reader parses a timestamp column: the same Date, to the
 * millisecond, the session's offset applied. JSON's own rendering has six digits and the
 * offset (GH141). */
export const timestamp = (text) => (text == null ? null : types.getTypeParser(TIMESTAMPTZ_OID, "text")(text));
/** A real or double read inside JSON: a finite one is the shortest text PostgreSQL writes,
 * the number the reader parses from that same text; NaN and ±Infinity come as strings
 * (JSON has no such numbers) and are made the numbers the reader gives (GH141). */
export const float = (value) => (typeof value === "string" ? Number(value) : value);

/** `role`: a group role to read as (vega_read in production, see 017_roles.sql). */
/** `Pool`: the pool's class (tests give their own). */
/** `idleSessionMs`: the base closes a session of this reader left idle that long (none by
 * default). The function gives it: a copy of the function that sleeps is frozen, the
 * pool's own idle limit does not run, and the connection it kept counted against the
 * login for as long as the copy lived (20 November 2026: the login ran out, 53300). */
export function createReader(connectionString, { max = 4, timeoutMs = 8000, role = null, ca = null, idleSessionMs = null, Pool = pg.Pool } = {}) {
  if (role !== null && !/^[a-z_][a-z0-9_]{0,62}$/.test(role)) throw new Error("invalid role");
  if (idleSessionMs !== null && !(Number.isInteger(idleSessionMs) && idleSessionMs > 0)) throw new Error("invalid idle session limit");
  const pool = new Pool({
    connectionString,
    max,
    types,
    // A connection is kept five minutes (pg closes an idle one after 10 s): the first
    // statement after a pause opened a new one, 30 to 75 ms each time and for each
    // statement run together (measured on 11 November 2026).
    idleTimeoutMillis: 300_000,
    keepAlive: true,
    // RDS: TLS verified against the bundled regional CA, never disabled.
    ...(ca && { ssl: { ca, rejectUnauthorized: true } }),
    // jit=off: the reads' plans are costly enough to trigger JIT, whose compile time was
    // half of a league's player list (measured: 650 ms of 1.37 s) and saves nothing here.
    // No parallel query: the reads touch a few hundred rows, and on the 2-vCPU instance
    // starting the workers cost more than the work (measured on the home: a Gather's first
    // row after 14 s for 0.8 s of work).
    options: `-c default_transaction_read_only=on -c statement_timeout=${timeoutMs} -c jit=off -c max_parallel_workers_per_gather=0 -c search_path=api${idleSessionMs ? ` -c idle_session_timeout=${idleSessionMs}` : ""}${role ? ` -c role=${role}` : ""}`,
  });
  // An idle connection the base or the network closed: the pool drops it. Unheard, the
  // event would end the process.
  pool.on("error", () => {});
  // The connections opened (GH140, FAILURE_MODES_OPTIMISATIONS.md): pg-pool says "connect"
  // for a client it has just opened, then gives that client to the checkout that asked for
  // one, in the same call. The client carries a mark until that checkout takes it and tells
  // its own statement (`opened`); a client given back before any checkout took it loses
  // it. Never the async context here: a queued request's connection is opened inside
  // another request's callback.
  const opening = new WeakMap();
  let openings = 0;
  pool.on("connect", (client) => opening.set(client, openings++ === 0));
  pool.on("release", (_error, client) => opening.delete(client));
  const taken = (client, opened) => {
    if (!opening.has(client)) return;
    const first = opening.get(client);
    opening.delete(client);
    try {
      opened?.(first);
    } catch {
      /* a count that fails takes no statement with it */
    }
  };
  // A statement that found its connection closed is sent once more, on another one: the
  // reads change nothing, so asking again is safe. A statement the base refused is not;
  // one sent on a session the base had closed for being idle (57P05) never ran.
  const lost = (error) =>
    error.code === "57P05" ||
    (!error.severity && (["ECONNRESET", "EPIPE", "ETIMEDOUT"].includes(error.code) || /Connection terminated|connection.*(closed|ended)/i.test(error.message || "")));
  // A statement as pg-pool's own pool.query sends it (pg-pool 3.14, index.js): a connection
  // taken for it alone and given back after it; dropped when the statement failed, whatever
  // the failure, or when the connection reported an error while it ran.
  const ordinary = (sql, values, opened) =>
    new Promise((resolve, reject) =>
      pool.connect((error, client) => {
        if (error) return reject(error);
        taken(client, opened);
        let released = false;
        const done = (failure, result) => {
          if (released) return;
          released = true;
          client.removeListener("error", done);
          client.release(failure || undefined);
          if (failure) reject(failure);
          else resolve(result.rows);
        };
        client.on("error", done);
        try {
          client.query(sql, values, done);
        } catch (failure) {
          done(failure);
        }
      }),
    );
  // A statement with planner settings of its own (PLANNER_SETTINGS): they are set for
  // its transaction alone, on one connection, and gone when it ends. pg-pool hears a
  // client's errors only while it is idle in the pool: an error the connection reports while
  // held is kept here (unheard, it ended the process), the statement fails as the
  // connection's queries do, and the connection is dropped.
  const planned = (sql, values, settings, opened) =>
    new Promise((resolve, reject) =>
      pool.connect((error, client) => {
        if (error) return reject(error);
        taken(client, opened);
        let reported = null;
        const heard = (failure) => {
          reported ??= failure;
        };
        client.on("error", heard);
        const give = (failure) => {
          client.removeListener("error", heard);
          // A connection that was lost is not given back to the pool.
          client.release(reported ?? (failure && lost(failure) ? failure : undefined));
        };
        resolve(
          transaction(client, sql, values, settings).then(
            (rows) => (give(null), rows),
            (failure) => {
              give(failure);
              throw failure;
            },
          ),
        );
      }),
    );
  const transaction = async (client, sql, values, settings) => {
    try {
      await client.query("BEGIN");
      for (const name of settings) await client.query(`SET LOCAL ${PLANNER_SETTINGS[name]}`);
      const { rows } = await client.query(sql, values);
      await client.query("COMMIT");
      return rows;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    }
  };
  return {
    /** `plan`: names of PLANNER_SETTINGS the statement is planned with. `opened(first)`:
     * told of each connection a checkout for the statement opened, `first` for the pool's
     * first one (GH140; the retry's checkout included). */
    read: async (sql, values = [], { plan = [], opened = null } = {}) => {
      if (plan.some((name) => !Object.hasOwn(PLANNER_SETTINGS, name))) throw new Error("unknown planner setting");
      const run = plan.length ? () => planned(sql, values, plan, opened) : () => ordinary(sql, values, opened);
      try {
        return await run();
      } catch (error) {
        if (!lost(error)) throw error;
        return run();
      }
    },
    end: () => pool.end(),
  };
}

/**
 * What a statement may ask of the planner, by name.
 *
 * hashJoins: no nested loop. The players list read on the appearances joins small
 * tables it has just computed, which the planner expects to hold one row: it compared
 * them row by row (55 million comparisons for one league's home matches, 12.6 s on
 * 11 November 2026; over 120 s for the ten leagues of the European scope, so the list
 * answered 503 at the 8 s limit). Without nested loops: 1.5 s and 2.4 s at most, the
 * same players and totals (the decimal sums are added in another order: they differ
 * at their last digit).
 */
export const PLANNER_SETTINGS = { hashJoins: "enable_nestloop = off" };
