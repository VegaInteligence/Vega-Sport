-- Versions of what the read API reads, kept by the writers (docs/calculs/09-audit-2026-11/FAILURE_MODES_OPTIMISATIONS.md,
-- GH137A). Every base table an api view or function reads carries four triggers; the first change of a table in a
-- transaction (a change: a row inserted or deleted, a row updated to other bytes, TRUNCATE) inserts one mark into
-- ops.data_changes, visible with the data at commit, gone with it on rollback. No writer updates a shared row: two
-- transactions writing one table never wait on each other for it. The worker folds the committed marks into
-- ops.data_versions, 100 000 at most a call; a table's version is its folded count plus its marks still there, and is
-- unknown while more than 10 000 of them wait (a reader never counts more). The read API reads the versions of a
-- route's tables through api.data_version before anything else.
-- Not marked online: it adds triggers to every table the reads see (a SHARE ROW EXCLUSIVE lock on each), so the
-- services are stopped while it applies.

CREATE TABLE ops.data_changes(
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  relation text NOT NULL
);
CREATE INDEX data_changes_relation ON ops.data_changes(relation);

CREATE TABLE ops.data_versions(
  relation text PRIMARY KEY,
  version bigint NOT NULL CHECK (version >= 0)
);

-- The api relations that can be validated by versions, and what of the clock their answer reads: 'day' (current_date
-- or age()), 'time' (now() and its kin: never validated by versions), or nothing.
CREATE TABLE ops.data_relations(
  relation text PRIMARY KEY,
  clock text CHECK (clock IN ('day', 'time'))
);
-- Each such relation's base tables (a partition counts as its root). `partitioned`: the source is a partitioned table,
-- whose version also names its partition tree (api.data_version).
CREATE TABLE ops.data_sources(
  relation text NOT NULL REFERENCES ops.data_relations ON DELETE CASCADE,
  source text NOT NULL,
  partitioned boolean NOT NULL DEFAULT false,
  PRIMARY KEY (relation, source)
);
CREATE INDEX data_sources_source ON ops.data_sources(source);
-- The schema the map above was made for: the base's last migration and their count when ops.track_data_changes last
-- committed. store.migrate commits each file, then tracks: a migration committed since (a view given another table), or
-- a tracking that failed, leaves every version unknown (api.data_version NULL) until a tracking commits again.
CREATE TABLE ops.data_tracking(
  only_row boolean PRIMARY KEY DEFAULT true CHECK (only_row),
  head text,
  migrations bigint NOT NULL
);

-- Only the functions below write or read these tables (the default privileges of ops gave vega_collect more).
REVOKE ALL ON ops.data_changes, ops.data_versions, ops.data_relations, ops.data_sources, ops.data_tracking FROM PUBLIC, vega_collect, vega_calc, vega_read;
REVOKE ALL ON SEQUENCE ops.data_changes_id_seq FROM PUBLIC, vega_collect, vega_calc, vega_read;

-- The first change of a table in a transaction claims it: a setting of the transaction, read first in the triggers'
-- condition, so every later row of the transaction pays one lookup. A savepoint rolled back takes the claim back.
CREATE FUNCTION ops.claim_data_change(setting text) RETURNS boolean
LANGUAGE plpgsql VOLATILE AS $$
BEGIN
  IF coalesce(pg_catalog.current_setting(setting, true), '') <> '' THEN
    RETURN false;
  END IF;
  PERFORM pg_catalog.set_config(setting, 'claimed', true);
  RETURN true;
END
$$;

-- The mark of a change (TG_ARGV: the table, its setting). A TRUNCATE has no condition: it claims here.
CREATE FUNCTION ops.mark_data_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' AND NOT ops.claim_data_change(TG_ARGV[1]) THEN
    RETURN NULL;
  END IF;
  INSERT INTO ops.data_changes(relation) VALUES (TG_ARGV[0]);
  RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION ops.mark_data_change() FROM PUBLIC;

-- The committed marks folded into the versions, in one statement: a reader sees the count before or after it, never
-- both or neither. A mark of a transaction still open is not seen, and folded after it commits. The oldest 100 000 at
-- most a call: a backlog (a worker stopped) is folded over several rounds, each bounded. Returns the marks folded.
CREATE FUNCTION ops.fold_data_changes() RETURNS bigint
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$
  WITH batch AS (SELECT c.id FROM ops.data_changes c ORDER BY c.id LIMIT 100000),
  gone AS (DELETE FROM ops.data_changes c USING batch b WHERE c.id = b.id RETURNING c.relation),
  counted AS (SELECT relation, count(*) AS n FROM gone GROUP BY relation),
  added AS (
    INSERT INTO ops.data_versions AS v (relation, version) SELECT relation, n FROM counted
    ON CONFLICT (relation) DO UPDATE SET version = v.version + EXCLUDED.version
    RETURNING 1)
  SELECT coalesce(sum(n), 0)::bigint FROM counted
$$;
REVOKE ALL ON FUNCTION ops.fold_data_changes() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.fold_data_changes() TO vega_collect, vega_calc;

-- What the api views and functions read, from the catalog: a view's rule dependencies, a function's dependencies and
-- the schema-qualified names of its body, transitively; then the four triggers on every base table reached that lacks
-- them. A relation that reaches a materialized view, a foreign table, a table outside core, agg and ops, or a plpgsql
-- function running dynamic SQL (EXECUTE) is left out: unknown, never validated by versions. Run by this migration and
-- by store.migrate after every run, so a table a later migration adds to a read is tracked. Returns the triggers made.
CREATE FUNCTION ops.track_data_changes() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  made integer := 0;
  t record;
  setting text;
  own constant text[] := ARRAY['ops.data_changes', 'ops.data_versions', 'ops.data_relations', 'ops.data_sources', 'ops.data_tracking', 'ops.schema_migrations'];
  day constant text := '(?i)\m(current_date|age\s*\()';
  instant constant text := '(?i)(\mnow\s*\(|\mcurrent_timestamp\M|\mlocaltimestamp\M|\mlocaltime\M|\mcurrent_time\M|\mclock_timestamp\M|\mstatement_timestamp\M|\mtransaction_timestamp\M|\mtimeofday\M|''(now|today|tomorrow|yesterday)'')';
BEGIN
  PERFORM pg_advisory_xact_lock(92003);
  DELETE FROM ops.data_sources;
  DELETE FROM ops.data_relations;
  WITH RECURSIVE ours AS (
    SELECT oid, nspname FROM pg_namespace WHERE nspname IN ('api', 'core', 'agg', 'ops')
  ), edges AS (
    -- A view's rule: the relations and functions it names.
    SELECT 'r'::text AS sk, r.ev_class AS so, CASE WHEN d.refclassid = 'pg_class'::regclass THEN 'r' ELSE 'p' END AS dk, d.refobjid AS do
    FROM pg_rewrite r JOIN pg_depend d ON d.classid = 'pg_rewrite'::regclass AND d.objid = r.oid
    WHERE d.refclassid IN ('pg_class'::regclass, 'pg_proc'::regclass) AND d.refobjid <> r.ev_class AND d.deptype = 'n'
    UNION
    -- A function's recorded dependencies (a body in SQL-standard form).
    SELECT 'p', d.objid, CASE WHEN d.refclassid = 'pg_class'::regclass THEN 'r' ELSE 'p' END, d.refobjid
    FROM pg_depend d
    WHERE d.classid = 'pg_proc'::regclass AND d.refclassid IN ('pg_class'::regclass, 'pg_proc'::regclass) AND d.deptype = 'n'
    UNION
    -- A function's body: the relations and functions of our schemas it names.
    SELECT 'p', p.oid, x.kind, x.oid
    FROM pg_proc p JOIN ours o ON o.oid = p.pronamespace
    CROSS JOIN LATERAL regexp_matches(coalesce(p.prosrc, ''), '\m(api|core|agg|ops)\.([a-z_][a-z0-9_]*)', 'g') m
    JOIN ours n ON n.nspname = m[1]
    CROSS JOIN LATERAL (
      SELECT 'r'::text AS kind, c.oid FROM pg_class c WHERE c.relnamespace = n.oid AND c.relname = m[2]
      UNION ALL
      SELECT 'p', f.oid FROM pg_proc f WHERE f.pronamespace = n.oid AND f.proname = m[2]) x
  ), starts AS (
    SELECT 'r'::text AS kind, c.oid, 'api.' || c.relname AS relation
    FROM pg_class c JOIN ours o ON o.oid = c.relnamespace AND o.nspname = 'api' WHERE c.relkind IN ('v', 'm', 'r', 'p', 'f')
    UNION
    SELECT 'p', p.oid, 'api.' || p.proname
    FROM pg_proc p JOIN ours o ON o.oid = p.pronamespace AND o.nspname = 'api' WHERE p.proname <> 'data_version'
  ), walk(relation, kind, oid) AS (
    SELECT relation, kind, oid FROM starts
    UNION
    SELECT w.relation, e.dk, e.do FROM walk w JOIN edges e ON e.sk = w.kind AND e.so = w.oid
  ), nodes AS (
    SELECT w.relation, w.kind, w.oid,
      CASE w.kind
        WHEN 'r' THEN (SELECT CASE
            WHEN c.relkind IN ('r', 'p') AND n.nspname IN ('core', 'agg', 'ops') THEN 'table'
            WHEN c.relkind = 'v' AND n.nspname IN ('api', 'core', 'agg', 'ops') THEN 'view'
            WHEN c.relkind IN ('S', 'i', 'I', 'c') THEN 'neutral'
            ELSE 'untracked' END
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.oid = w.oid)
        ELSE (SELECT CASE
            WHEN n.nspname NOT IN ('api', 'core', 'agg', 'ops') THEN 'neutral'
            WHEN l.lanname = 'plpgsql' AND p.prosrc ~* '\mEXECUTE\M' THEN 'untracked'
            ELSE 'function' END
          FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = w.oid)
      END AS role,
      CASE w.kind
        WHEN 'r' THEN (SELECT CASE WHEN c.relkind = 'v' THEN pg_get_viewdef(c.oid) END FROM pg_class c WHERE c.oid = w.oid)
        ELSE (SELECT CASE WHEN n.nspname IN ('api', 'core', 'agg', 'ops') THEN coalesce(p.prosrc, '') END
          FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE p.oid = w.oid)
      END AS text
    FROM walk w
  ), relations AS (
    SELECT relation,
      CASE WHEN bool_or(text ~ instant) THEN 'time' WHEN bool_or(text ~ day) THEN 'day' END AS clock
    FROM nodes GROUP BY relation
    HAVING NOT bool_or(role = 'untracked' OR role IS NULL)
  ), kept AS (
    INSERT INTO ops.data_relations(relation, clock) SELECT relation, clock FROM relations RETURNING relation
  )
  INSERT INTO ops.data_sources(relation, source, partitioned)
  SELECT DISTINCT n.relation, r.oid::regclass::text, r.relkind = 'p'
  FROM nodes n JOIN kept k ON k.relation = n.relation
  JOIN pg_class r ON r.oid = coalesce(pg_partition_root(n.oid), n.oid)
  WHERE n.role = 'table' AND NOT r.oid::regclass::text = ANY(own);

  FOR t IN SELECT DISTINCT s.source FROM ops.data_sources s ORDER BY 1 LOOP
    setting := 'vega.changed_' || replace(t.source, '.', '__');
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = t.source::regclass AND tgname = 'vega_change_insert' AND NOT tgisinternal) THEN
      EXECUTE format('CREATE TRIGGER vega_change_insert AFTER INSERT ON %s FOR EACH ROW
        WHEN (coalesce(pg_catalog.current_setting(%L, true), %L) = %L AND ops.claim_data_change(%L))
        EXECUTE FUNCTION ops.mark_data_change(%L, %L)', t.source, setting, '', '', setting, t.source, setting);
      made := made + 1;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = t.source::regclass AND tgname = 'vega_change_update' AND NOT tgisinternal) THEN
      EXECUTE format('CREATE TRIGGER vega_change_update AFTER UPDATE ON %s FOR EACH ROW
        WHEN (coalesce(pg_catalog.current_setting(%L, true), %L) = %L AND OLD.* *<> NEW.* AND ops.claim_data_change(%L))
        EXECUTE FUNCTION ops.mark_data_change(%L, %L)', t.source, setting, '', '', setting, t.source, setting);
      made := made + 1;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = t.source::regclass AND tgname = 'vega_change_delete' AND NOT tgisinternal) THEN
      EXECUTE format('CREATE TRIGGER vega_change_delete AFTER DELETE ON %s FOR EACH ROW
        WHEN (coalesce(pg_catalog.current_setting(%L, true), %L) = %L AND ops.claim_data_change(%L))
        EXECUTE FUNCTION ops.mark_data_change(%L, %L)', t.source, setting, '', '', setting, t.source, setting);
      made := made + 1;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = t.source::regclass AND tgname = 'vega_change_truncate' AND NOT tgisinternal) THEN
      EXECUTE format('CREATE TRIGGER vega_change_truncate AFTER TRUNCATE ON %s FOR EACH STATEMENT
        EXECUTE FUNCTION ops.mark_data_change(%L, %L)', t.source, t.source, setting);
      made := made + 1;
    END IF;
  END LOOP;
  -- The schema this map is for, committed with it.
  INSERT INTO ops.data_tracking(only_row, head, migrations)
  SELECT true, max(m.version), count(*) FROM ops.schema_migrations m
  ON CONFLICT (only_row) DO UPDATE SET head = EXCLUDED.head, migrations = EXCLUDED.migrations;
  RETURN made;
END
$$;
REVOKE ALL ON FUNCTION ops.track_data_changes() FROM PUBLIC;

-- Whether the map is older than the schema (ops.data_tracking). store.migrate asks it and tracks only then: a run that
-- applies nothing (GH171's administrator, rotating the logins without the owner's rights) needs no privilege of the
-- owner. Any role may ask; it tells whether a tracking is due, nothing else.
CREATE FUNCTION ops.data_tracking_stale() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT NOT EXISTS (SELECT 1 FROM ops.data_tracking t
    WHERE t.head IS NOT DISTINCT FROM (SELECT max(m.version) FROM ops.schema_migrations m)
      AND t.migrations = (SELECT count(*) FROM ops.schema_migrations))
$$;

-- The version of what `relations` (api views and functions, 'api.name') read: the SHA-256 of the base's head (its last
-- migration and their count), the base's day when one of them reads current_date, and each source table's version:
-- its count of committed changes and, for a partitioned table, its partition tree as the catalog holds it: each
-- member's oid, file and attachment (the pg_inherits row's xmin). A leaf truncated directly gets a new file; a
-- partition attached, detached, or left detaching (DETACH CONCURRENTLY) changes the members; a leaf detached, changed
-- while no trigger of its root sees it, then attached again, keeps its oid and file but is attached by another
-- transaction. `clock`: what the route's own statements read of the clock ('day': the base's current_date, 'time':
-- never validated by versions). NULL when a relation is unknown, a relation or the route reads the time, a source is
-- gone, more than 10 000 marks of a source wait for the fold (none is counted past 10 001: a stopped worker never
-- makes a read longer), or the map is older than the schema (ops.data_tracking). Index lookups only. vega_read runs it.
CREATE FUNCTION api.data_version(relations text[], clock text DEFAULT NULL) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  WITH wanted AS (SELECT DISTINCT r.relation FROM unnest(relations) AS r(relation)),
  known AS (SELECT w.relation, d.relation IS NOT NULL AS tracked, d.clock FROM wanted w LEFT JOIN ops.data_relations d ON d.relation = w.relation),
  sources AS (
    SELECT s.source, bool_or(s.partitioned) AS partitioned, to_regclass(s.source) AS oid
    FROM ops.data_sources s JOIN wanted w ON w.relation = s.relation GROUP BY s.source),
  -- Counted once per source (its value is used twice below).
  pending AS MATERIALIZED (
    SELECT s.source, s.partitioned, s.oid,
      (SELECT count(*) FROM (SELECT 1 FROM ops.data_changes c WHERE c.relation = s.source LIMIT 10001) w) AS waiting
    FROM sources s WHERE s.oid IS NOT NULL),
  counted AS (
    SELECT p.source, p.waiting,
      (coalesce((SELECT v.version FROM ops.data_versions v WHERE v.relation = p.source), 0) + p.waiting)::text
      || CASE WHEN p.partitioned THEN '/' || coalesce((
           SELECT string_agg(t.relid::oid::text || '.' || c.relfilenode::text || '.' || coalesce(i.xmin::text, '-'), ',' ORDER BY t.relid::oid)
           FROM pg_partition_tree(p.oid) t JOIN pg_class c ON c.oid = t.relid LEFT JOIN pg_inherits i ON i.inhrelid = t.relid), '') ELSE '' END AS version
    FROM pending p)
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM known) OR EXISTS (SELECT 1 FROM known k WHERE NOT k.tracked OR k.clock = 'time')
      OR EXISTS (SELECT 1 FROM sources WHERE oid IS NULL) OR data_version.clock IS DISTINCT FROM NULL AND data_version.clock <> 'day'
      OR EXISTS (SELECT 1 FROM counted WHERE waiting > 10000)
      OR NOT EXISTS (SELECT 1 FROM ops.data_tracking t
        WHERE t.head IS NOT DISTINCT FROM (SELECT max(m.version) FROM ops.schema_migrations m)
          AND t.migrations = (SELECT count(*) FROM ops.schema_migrations)) THEN NULL
    ELSE encode(sha256(convert_to(concat_ws('|',
      (SELECT max(m.version) FROM ops.schema_migrations m),
      (SELECT count(*) FROM ops.schema_migrations),
      CASE WHEN data_version.clock = 'day' OR EXISTS (SELECT 1 FROM known k WHERE k.clock = 'day') THEN to_char(current_date, 'YYYY-MM-DD') ELSE '' END,
      coalesce((SELECT string_agg(c.source || ':' || c.version, ',' ORDER BY c.source) FROM counted c), '')), 'UTF8')), 'hex')
  END
$$;
REVOKE ALL ON FUNCTION api.data_version(text[], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.data_version(text[], text) TO vega_read;

SELECT ops.track_data_changes();
