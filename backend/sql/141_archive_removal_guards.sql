-- Archive removals that stay safe after their commit, and the edition emblem column (VI-27,
-- docs/calculs/09-audit-2026-11/FAILURE_MODES.md §24; 141 is T4's reservation, 134 and 140 stay as applied).
--
-- 1. core.competition_seasons.emblem_asset_id: an edition's own emblem, distinct from its family's logo (the joint
--    edition-emblem arbitration of 18 Nov: storage and writer T4, reader T7). An edition with one is never removed.
-- 2. ops.archive_removals: the tombstone of every archive match, edition or round a reviewed plan deleted, written in the
--    deleting transaction and never removed.
-- 3. ops.reject_removed_archive_reference(): on every relation naming a match or an edition without a foreign key, an
--    insert or update naming a tombstoned id fails with foreign_key_violation. A writer blocked by the deletion's SHARE
--    locks resumes after the commit and is refused; so is one starting later. Writers with a foreign key fail on the row.
-- 4. ops.archive_edition_dependents(): what references an edition or its rounds, with or without a foreign key.
-- 5. ops.archive_lock_references(): the SHARE locks of a deletion, on every relation naming a match or an edition
--    without a foreign key. The functions run as their owner: vega_collect gains no table privilege.
SET LOCAL lock_timeout = '3s';

ALTER TABLE core.competition_seasons ADD COLUMN emblem_asset_id integer REFERENCES core.assets(id);
COMMENT ON COLUMN core.competition_seasons.emblem_asset_id IS
  'The edition''s own emblem (role edition_emblem), never the family logo copied; NULL when none is attested (VI-27).';

CREATE TABLE ops.archive_removals (
  kind text NOT NULL CHECK (kind IN ('match', 'edition', 'round')),
  id integer NOT NULL,
  season_id integer NOT NULL,
  archive_key text,
  plan_sha256 text CHECK (plan_sha256 IS NULL OR plan_sha256 ~ '^[0-9a-f]{64}$'),
  removed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, id)
);
COMMENT ON TABLE ops.archive_removals IS
  'Archive rows a reviewed plan deleted; a reference to one is refused (FAILURE_MODES.md §24).';
REVOKE ALL ON ops.archive_removals FROM PUBLIC;
GRANT SELECT, INSERT ON ops.archive_removals TO vega_collect;
REVOKE UPDATE, DELETE, TRUNCATE ON ops.archive_removals FROM vega_collect;

CREATE FUNCTION ops.reject_removed_archive_reference()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  fields jsonb := to_jsonb(NEW);
  wanted text := TG_ARGV[0];
  ref text := fields ->> TG_ARGV[1];
BEGIN
  IF ref IS NOT NULL AND EXISTS (SELECT 1 FROM ops.archive_removals r WHERE r.kind = wanted AND r.id = ref::bigint) THEN
    RAISE EXCEPTION USING ERRCODE = 'foreign_key_violation',
      MESSAGE = format('%s.%s.%s names archive %s %s, removed by a reviewed plan', TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_ARGV[1], wanted, ref);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION ops.reject_removed_archive_reference() FROM PUBLIC;

DO $$
DECLARE
  ref record;
BEGIN
  -- Columns naming a match or an edition without a foreign key to it.
  FOR ref IN
    SELECT n.nspname AS schema_name, c.relname AS table_name, a.attname AS column_name,
           CASE WHEN a.attname LIKE '%competition\_season\_id' ESCAPE '\' THEN 'edition' ELSE 'match' END AS kind
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('core', 'agg', 'ops') AND c.relkind IN ('r', 'p') AND NOT c.relispartition
      AND a.attnum > 0 AND NOT a.attisdropped AND a.atttypid IN ('integer'::regtype, 'bigint'::regtype)
      AND ((a.attname = 'match_id' OR a.attname LIKE '%\_match\_id' ESCAPE '\')
           AND NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = c.oid AND k.contype = 'f'
                             AND k.confrelid = 'core.matches'::regclass AND a.attnum = ANY(k.conkey))
        OR (a.attname = 'competition_season_id' OR a.attname LIKE '%\_competition\_season\_id' ESCAPE '\')
           AND NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = c.oid AND k.contype = 'f'
                             AND k.confrelid = 'core.competition_seasons'::regclass AND a.attnum = ANY(k.conkey)))
    ORDER BY 1, 2, 3
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF %I ON %I.%I FOR EACH ROW WHEN (NEW.%I IS NOT NULL) '
                   'EXECUTE FUNCTION ops.reject_removed_archive_reference(%L, %L)',
                   'archive_removed_' || ref.column_name, ref.column_name, ref.schema_name, ref.table_name, ref.column_name,
                   ref.kind, ref.column_name);
  END LOOP;
  -- (entity_type, entity_id) references to a match.
  FOR ref IN
    SELECT n.nspname AS schema_name, c.relname AS table_name
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('core', 'agg', 'ops') AND c.relkind IN ('r', 'p') AND NOT c.relispartition
      AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'entity_type' AND NOT a.attisdropped)
      AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'entity_id' AND NOT a.attisdropped)
    ORDER BY 1, 2
  LOOP
    EXECUTE format('CREATE TRIGGER archive_removed_entity_id BEFORE INSERT OR UPDATE OF entity_type, entity_id ON %I.%I FOR EACH ROW '
                   'WHEN (NEW.entity_type::text = ''match'') EXECUTE FUNCTION ops.reject_removed_archive_reference(''match'', ''entity_id'')',
                   ref.schema_name, ref.table_name);
  END LOOP;
END $$;

CREATE TRIGGER archive_removed_match_version BEFORE INSERT OR UPDATE OF resource_kind, resource_id ON ops.resource_versions FOR EACH ROW
  WHEN (NEW.resource_kind::text = 'match') EXECUTE FUNCTION ops.reject_removed_archive_reference('match', 'resource_id');
CREATE TRIGGER archive_removed_edition_version BEFORE INSERT OR UPDATE OF resource_kind, resource_id ON ops.resource_versions FOR EACH ROW
  WHEN (NEW.resource_kind::text = 'competition_season') EXECUTE FUNCTION ops.reject_removed_archive_reference('edition', 'resource_id');

CREATE FUNCTION ops.archive_edition_dependents(edition_ids integer[], round_ids integer[])
RETURNS TABLE(kind text, id integer, dependency text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  ref record;
BEGIN
  IF cardinality(coalesce(edition_ids, '{}')) > 5000 OR cardinality(coalesce(round_ids, '{}')) > 5000 THEN
    RAISE EXCEPTION 'archive_edition_dependents takes at most 5000 ids of each kind';
  END IF;
  -- Every column naming an edition or a round, with or without a foreign key; core.matches is the caller's (it binds
  -- the matches it removes) and core.rounds names its own edition.
  FOR ref IN
    SELECT n.nspname AS schema_name, c.relname AS table_name, a.attname AS column_name,
           CASE WHEN a.attname LIKE '%round\_id' ESCAPE '\' THEN 'round' ELSE 'edition' END AS kind
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('core', 'agg', 'ops') AND c.relkind IN ('r', 'p') AND NOT c.relispartition
      AND a.attnum > 0 AND NOT a.attisdropped AND a.atttypid IN ('integer'::regtype, 'bigint'::regtype)
      AND (a.attname = 'competition_season_id' OR a.attname LIKE '%\_competition\_season\_id' ESCAPE '\'
           OR a.attname = 'round_id' OR a.attname LIKE '%\_round\_id' ESCAPE '\')
      AND NOT (n.nspname = 'core' AND c.relname = 'matches')
      AND NOT (n.nspname = 'core' AND c.relname = 'rounds' AND a.attname = 'competition_season_id')
    ORDER BY 1, 2, 3
  LOOP
    RETURN QUERY EXECUTE format('SELECT DISTINCT %L::text, t.%I::integer, %L::text FROM %I.%I t WHERE t.%I = ANY($1)',
      ref.kind, ref.column_name, ref.schema_name || '.' || ref.table_name || '.' || ref.column_name,
      ref.schema_name, ref.table_name, ref.column_name)
      USING CASE WHEN ref.kind = 'round' THEN round_ids ELSE edition_ids END;
  END LOOP;
  RETURN QUERY SELECT 'edition'::text, v.resource_id::integer, 'ops.resource_versions.resource_id'::text FROM ops.resource_versions v
    WHERE v.resource_kind::text = 'competition_season' AND v.resource_id = ANY(edition_ids);
  RETURN QUERY SELECT 'edition'::text, cs.id, 'core.competition_seasons.emblem_asset_id'::text FROM core.competition_seasons cs
    WHERE cs.id = ANY(edition_ids) AND cs.emblem_asset_id IS NOT NULL;
END $$;
REVOKE ALL ON FUNCTION ops.archive_edition_dependents(integer[], integer[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.archive_edition_dependents(integer[], integer[]) TO vega_collect;

CREATE FUNCTION ops.archive_lock_references()
RETURNS text[] LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  ref record;
  locked text[] := '{}';
BEGIN
  FOR ref IN
    SELECT DISTINCT tgrelid::regclass::text AS relation FROM pg_trigger
    WHERE tgname LIKE 'archive\_removed\_%' ESCAPE '\' AND NOT tgisinternal AND tgparentid = 0
    ORDER BY 1
  LOOP
    EXECUTE format('LOCK TABLE %s IN SHARE MODE', ref.relation);
    locked := locked || ref.relation;
  END LOOP;
  RETURN locked;
END $$;
REVOKE ALL ON FUNCTION ops.archive_lock_references() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.archive_lock_references() TO vega_collect;
