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
export function createReader(connectionString, { max = 4, timeoutMs = 8000, role = null, ca = null } = {}) {
  if (role !== null && !/^[a-z_][a-z0-9_]{0,62}$/.test(role)) throw new Error("invalid role");
  const pool = new pg.Pool({
    connectionString,
    max,
    types,
    // RDS: TLS verified against the bundled regional CA, never disabled.
    ...(ca && { ssl: { ca, rejectUnauthorized: true } }),
    options: `-c default_transaction_read_only=on -c statement_timeout=${timeoutMs} -c search_path=api${role ? ` -c role=${role}` : ""}`,
  });
  return {
    read: async (sql, values = []) => (await pool.query(sql, values)).rows,
    end: () => pool.end(),
  };
}
