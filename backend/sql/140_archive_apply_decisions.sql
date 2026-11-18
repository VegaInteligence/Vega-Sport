-- Archive applies, durable and serialized (VI-27, docs/calculs/09-audit-2026-11/FAILURE_MODES.md §23). 136 to 139 are
-- reserved by the other audit tracks; 134 is kept as applied on the rehearsal clones.
--
-- 1. ops.archive_plan_seasons: each season's decision under a stored plan, written in the transaction that applies it
--    (or alone, for a drift or a refusal): a run resumes after a crash, a subset never stamps the others.
-- 2. ops.archive_lock_match_references(): the SHARE locks an archive deletion takes, until its commit, on every relation
--    naming a match without a foreign key to it (no writer can add a reference between its last check and its commit).
--    It runs as its owner: vega_collect gains no table privilege. Writers with a foreign key wait on the match row lock.
SET LOCAL lock_timeout = '3s';

CREATE TABLE ops.archive_plan_seasons (
  sha256 text NOT NULL REFERENCES ops.archive_plans(sha256),
  label text NOT NULL CHECK (label ~ '^[0-9]{4}/[0-9]{4}$'),
  outcome text NOT NULL CHECK (outcome IN ('applied', 'partial', 'drift', 'refused')),
  decided_at timestamptz NOT NULL DEFAULT now(),
  receipt jsonb NOT NULL,
  PRIMARY KEY (sha256, label)
);
COMMENT ON TABLE ops.archive_plan_seasons IS
  'One decision per season of a stored archive plan, committed with the season it applies (VI-27, FAILURE_MODES.md §23).';
REVOKE ALL ON ops.archive_plan_seasons FROM PUBLIC;
GRANT SELECT, INSERT ON ops.archive_plan_seasons TO vega_collect;
REVOKE UPDATE, DELETE, TRUNCATE ON ops.archive_plan_seasons FROM vega_collect;

CREATE FUNCTION ops.archive_lock_match_references()
RETURNS text[] LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  ref record;
  locked text[] := '{}';
BEGIN
  FOR ref IN
    SELECT DISTINCT n.nspname AS schema_name, c.relname AS table_name
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('core', 'agg', 'ops') AND c.relkind IN ('r', 'p') AND NOT c.relispartition
      AND (EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
                     AND a.atttypid IN ('integer'::regtype, 'bigint'::regtype)
                     AND (a.attname = 'match_id' OR a.attname LIKE '%\_match\_id' ESCAPE '\')
                     AND NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = c.oid AND k.contype = 'f'
                                       AND k.confrelid = 'core.matches'::regclass AND a.attnum = ANY(k.conkey)))
           OR (EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'entity_type' AND NOT a.attisdropped)
               AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'entity_id' AND NOT a.attisdropped))
           OR (n.nspname = 'ops' AND c.relname = 'resource_versions'))
    ORDER BY 1, 2
  LOOP
    EXECUTE format('LOCK TABLE %I.%I IN SHARE MODE', ref.schema_name, ref.table_name);
    locked := locked || (ref.schema_name || '.' || ref.table_name);
  END LOOP;
  RETURN locked;
END $$;
REVOKE ALL ON FUNCTION ops.archive_lock_match_references() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.archive_lock_match_references() TO vega_collect;
