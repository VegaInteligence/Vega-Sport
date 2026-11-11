/**
 * Database access of the read API: the "lecture" role reads the api schema only
 * (its views read the rest with their owner's rights). Every statement runs in a
 * read-only transaction with a timeout.
 */
import pg from "pg";

const DATE_OID = 1082;
// A calendar date stays the text PostgreSQL sends: parsed as a Date it would be local
// midnight, one day off once serialised in UTC from a server east of Greenwich.
const types = {
  getTypeParser: (oid, format) => (oid === DATE_OID ? (value) => value : pg.types.getTypeParser(oid, format)),
};

/** `role`: a group role to read as (vega_read in production, see 017_roles.sql). */
/** `Pool`: the pool's class (tests give their own). */
export function createReader(connectionString, { max = 4, timeoutMs = 8000, role = null, ca = null, Pool = pg.Pool } = {}) {
  if (role !== null && !/^[a-z_][a-z0-9_]{0,62}$/.test(role)) throw new Error("invalid role");
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
    options: `-c default_transaction_read_only=on -c statement_timeout=${timeoutMs} -c jit=off -c max_parallel_workers_per_gather=0 -c search_path=api${role ? ` -c role=${role}` : ""}`,
  });
  // An idle connection the base or the network closed: the pool drops it. Unheard, the
  // event would end the process.
  pool.on("error", () => {});
  // A statement that found its connection closed is sent once more, on another one: the
  // reads change nothing, so asking again is safe. A statement the base refused is not.
  const lost = (error) => !error.severity && (["ECONNRESET", "EPIPE", "ETIMEDOUT"].includes(error.code) || /Connection terminated|connection.*(closed|ended)/i.test(error.message || ""));
  return {
    read: async (sql, values = []) => {
      try {
        return (await pool.query(sql, values)).rows;
      } catch (error) {
        if (!lost(error)) throw error;
        return (await pool.query(sql, values)).rows;
      }
    },
    end: () => pool.end(),
  };
}
