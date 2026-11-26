-- 26 Nov 2026 (FAILURE_MODES_OPTIMISATIONS.md GH171, GitHub #171): the statements' statistics of this database, read
-- normalized. The server preloads pg_stat_statements since it was created (database.yaml), but no migration created
-- the extension, so nothing read what the module records. Additive: an extension and one view, no table, no lock on
-- anything the worker or the read API uses.
-- vega:online
SET LOCAL lock_timeout = '3s';

CREATE EXTENSION IF NOT EXISTS pg_stat_statements SCHEMA public;

DO $$
DECLARE
  ext text := (SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
               WHERE e.extname = 'pg_stat_statements');
  entry record;
BEGIN
  -- What the module kept before this migration may hold a login's password in clear text: vega/migrate.py set them
  -- with ALTER ROLE "vega_v2_<login>" LOGIN PASSWORD '<password>' (CREATE ROLE the first time) until 179, as the
  -- login that runs the migrations. Those entries alone are reset, one by one: in this database, recorded for that
  -- login, whose text is exactly that statement. Every other entry keeps its history and counters: a read naming a
  -- role, a user or a password, another login's statements, another role's password statement, the other databases of
  -- the server; the module keeps its date of reset (never pg_stat_statements_reset() for the whole server). A query id
  -- of 0 would reset every statement of its login: never asked. A server that does not preload the module (a local
  -- one) has nothing to forget: reading it refuses (55000), and nothing else.
  BEGIN
    FOR entry IN EXECUTE format(
      $q$SELECT s.userid, s.dbid, s.queryid FROM %I.pg_stat_statements(true) s
         WHERE s.dbid = (SELECT d.oid FROM pg_database d WHERE d.datname = current_database())
           AND s.userid = (SELECT r.oid FROM pg_roles r WHERE r.rolname = current_user)
           AND s.queryid IS NOT NULL AND s.queryid <> 0
           AND s.query ~ '^(ALTER|CREATE) ROLE "vega_v2_(collect|calc|read|account)" LOGIN PASSWORD ''.*''$'$q$, ext)
    LOOP
      EXECUTE format('SELECT %I.pg_stat_statements_reset($1, $2, $3)', ext) USING entry.userid, entry.dbid, entry.queryid;
    END LOOP;
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    NULL;
  END;
  -- The module's own views show other logins' statements to their readers; nothing of this base reads them but the
  -- owner (who holds pg_read_all_stats).
  EXECUTE format('REVOKE ALL ON %I.pg_stat_statements, %I.pg_stat_statements_info FROM PUBLIC', ext, ext);
  EXECUTE format('REVOKE ALL ON FUNCTION %I.pg_stat_statements(boolean), %I.pg_stat_statements_info() FROM PUBLIC', ext, ext);
  -- Per normalized statement of this database: who ran it, its command (its first keyword), its counts and times; never
  -- its text, which stays in the module, for the owner. (The module records a statement from its first token: the read
  -- API's leading /*vega:v2:<read>*/ comments are not in it.)
  EXECUTE format($view$
    CREATE VIEW ops.statement_stats AS
    SELECT s.queryid,
           CASE upper(substring(s.query FROM '^\s*([A-Za-z]+)'))
             WHEN 'SELECT' THEN 'SELECT' WHEN 'WITH' THEN 'WITH' WHEN 'INSERT' THEN 'INSERT' WHEN 'UPDATE' THEN 'UPDATE'
             WHEN 'DELETE' THEN 'DELETE' WHEN 'MERGE' THEN 'MERGE' WHEN 'COPY' THEN 'COPY' WHEN 'CALL' THEN 'CALL'
             ELSE 'OTHER' END AS command,
           r.rolname::text AS login,
           s.toplevel,
           s.calls,
           s.rows,
           round(s.total_exec_time::numeric, 1) AS total_ms,
           round(s.mean_exec_time::numeric, 2) AS mean_ms,
           round(s.max_exec_time::numeric, 1) AS max_ms,
           s.shared_blks_hit,
           s.shared_blks_read,
           s.temp_blks_written
    FROM %I.pg_stat_statements(true) s
    JOIN pg_roles r ON r.oid = s.userid
    WHERE s.dbid = (SELECT d.oid FROM pg_database d WHERE d.datname = current_database())
  $view$, ext);
END
$$;

COMMENT ON VIEW ops.statement_stats IS
  'Normalized statements of this database (pg_stat_statements): login, command, counts and times; never the text. Owner only.';
-- ops's default privileges give a new table or view to the collection role (017_roles.sql): not this one.
REVOKE ALL ON ops.statement_stats FROM PUBLIC, vega_collect, vega_calc, vega_read;
