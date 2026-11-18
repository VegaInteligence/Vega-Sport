-- The archive repair's boundary (VI-27, docs/calculs/09-audit-2026-11/FAILURE_MODES.md §22).
--
-- 1. The archive task runs as vega_collect, which never reads agg. Before it removes an archive match it must
--    know whether anything else holds that match. This function answers as its owner and returns only
--    (match id, where): every match_id or *_match_id column of core, agg and ops, every (entity_type,
--    entity_id) naming a match, a match's resource version, and the events the archive does not write. No row
--    content leaves it; vega_collect gains no table privilege.
-- 2. ops.archive_plans keeps a reviewed plan as its exact bytes under its SHA-256. It is applied once by that
--    digest, and the apply's receipt is kept in the same row.
SET LOCAL lock_timeout = '3s';

CREATE FUNCTION ops.archive_match_dependents(match_ids integer[])
RETURNS TABLE(match_id integer, dependency text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  ref record;
BEGIN
  IF match_ids IS NULL OR cardinality(match_ids) > 5000 THEN
    RAISE EXCEPTION 'archive_match_dependents takes at most 5000 match ids';
  END IF;
  FOR ref IN
    SELECT n.nspname AS schema_name, c.relname AS table_name, a.attname AS column_name
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('core', 'agg', 'ops') AND c.relkind IN ('r', 'p') AND NOT c.relispartition
      AND a.attnum > 0 AND NOT a.attisdropped AND a.atttypid IN ('integer'::regtype, 'bigint'::regtype)
      AND (a.attname = 'match_id' OR a.attname LIKE '%\_match\_id' ESCAPE '\')
      AND NOT (n.nspname = 'core' AND c.relname = 'match_events')
    ORDER BY 1, 2, 3
  LOOP
    RETURN QUERY EXECUTE format('SELECT DISTINCT t.%I::integer, %L::text FROM %I.%I t WHERE t.%I = ANY($1)',
      ref.column_name, ref.schema_name || '.' || ref.table_name || '.' || ref.column_name,
      ref.schema_name, ref.table_name, ref.column_name) USING match_ids;
  END LOOP;
  FOR ref IN
    SELECT n.nspname AS schema_name, c.relname AS table_name
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('core', 'agg', 'ops') AND c.relkind IN ('r', 'p') AND NOT c.relispartition
      AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'entity_type' AND NOT a.attisdropped)
      AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'entity_id' AND NOT a.attisdropped)
    ORDER BY 1, 2
  LOOP
    RETURN QUERY EXECUTE format(
      'SELECT DISTINCT t.entity_id::integer, %L::text FROM %I.%I t WHERE t.entity_type::text = ''match'' AND t.entity_id = ANY($1)',
      ref.schema_name || '.' || ref.table_name || '.entity_id', ref.schema_name, ref.table_name) USING match_ids;
  END LOOP;
  RETURN QUERY SELECT DISTINCT v.resource_id::integer, 'ops.resource_versions.resource_id'::text FROM ops.resource_versions v
    WHERE v.resource_kind::text = 'match' AND v.resource_id = ANY(match_ids);
  RETURN QUERY SELECT DISTINCT e.match_id::integer,
      'core.match_events.' || CASE WHEN e.event_type::text <> 'goal' THEN e.event_type::text ELSE 'enriched_goal' END
    FROM core.match_events e WHERE e.match_id = ANY(match_ids)
      AND (e.event_type::text <> 'goal' OR e.player_id IS NOT NULL OR e.related_player_id IS NOT NULL
           OR e.is_own_goal IS NOT NULL OR e.is_penalty IS NOT NULL OR e.period IS NOT NULL);
END $$;

REVOKE ALL ON FUNCTION ops.archive_match_dependents(integer[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.archive_match_dependents(integer[]) TO vega_collect;

CREATE TABLE ops.archive_plans (
  sha256 text PRIMARY KEY CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  plan text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz,
  receipt jsonb,
  CHECK ((applied_at IS NULL) = (receipt IS NULL))
);
COMMENT ON TABLE ops.archive_plans IS
  'Reviewed archive repair plans (python -m vega.archives --plan-store), their exact canonical bytes under their SHA-256; applied once by digest (--apply-stored), with the receipt (VI-27, FAILURE_MODES.md §22).';
REVOKE ALL ON ops.archive_plans FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON ops.archive_plans TO vega_collect;
-- A plan and its receipt are never removed by the task (017's default privileges would grant it).
REVOKE DELETE, TRUNCATE ON ops.archive_plans FROM vega_collect;
