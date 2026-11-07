-- Derived, rebuildable archive reads. Canonical results/goals stay unchanged.
-- The publisher applies the existing shared JS merger before committing a
-- source publication; public reads return one page or one match's goals.
CREATE TABLE IF NOT EXISTS statarena_app.archive_read_editions (
 season text PRIMARY KEY CHECK(season ~ '^\d{4}(/\d{4})?$'),
 revision integer NOT NULL CHECK(revision > 0),
 source_fence jsonb NOT NULL CHECK(jsonb_typeof(source_fence)='object'),
 version char(64) NOT NULL CHECK(version ~ '^[a-f0-9]{64}$'),
 competitions jsonb NOT NULL CHECK(jsonb_typeof(competitions)='array'),
 summary jsonb NOT NULL CHECK(jsonb_typeof(summary)='object'),
 match_count integer NOT NULL CHECK(match_count >= 0),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((summary->>'matches')::integer=match_count)
);

CREATE TABLE IF NOT EXISTS statarena_app.archive_read_matches (
 season text NOT NULL REFERENCES statarena_app.archive_read_editions ON DELETE CASCADE,
 ordinal integer NOT NULL CHECK(ordinal >= 0),
 match_key text NOT NULL,
 competition_id text,
 search_teams text NOT NULL,
 search_players text NOT NULL,
 listing jsonb NOT NULL CHECK(jsonb_typeof(listing)='object'),
 goals jsonb CHECK(jsonb_typeof(goals)='array'),
 PRIMARY KEY(season,ordinal)
);
CREATE INDEX IF NOT EXISTS archive_read_competition
 ON statarena_app.archive_read_matches(season,competition_id,ordinal);
-- Source keys are positional and may repeat in malformed historical inputs.
-- The original matcher selects the first sorted match with a given key.
CREATE INDEX IF NOT EXISTS archive_read_match_key
 ON statarena_app.archive_read_matches(season,match_key,ordinal);

CREATE OR REPLACE FUNCTION statarena_app.archive_source_fence(target_season text)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,statarena_app AS $fence$
 WITH editions AS (
  SELECT resource_id::text AS resource_id,scope,source_digest::text AS source_digest,
   to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at,response_status
  FROM statarena_app.catalog_editions
  WHERE catalog='archive-season' AND edition=target_season AND scope IN ('results','goals')
 ), expected AS (
  SELECT 'results'::text AS scope FROM statarena_app.catalog_editions idx
  JOIN statarena_app.cat_archive_results_index_seasons s ON s.resource_id=idx.resource_id
  WHERE idx.catalog='archive-index' AND idx.scope='results' AND idx.edition='' AND s.id=target_season
  UNION SELECT 'goals'::text AS scope FROM statarena_app.catalog_editions idx
  JOIN statarena_app.cat_archive_goals_index_seasons s ON s.resource_id=idx.resource_id
  WHERE idx.catalog='archive-index' AND idx.scope='goals' AND idx.edition='' AND s.id=target_season
 )
 SELECT jsonb_build_object(
  'editions',(SELECT coalesce(jsonb_agg(e ORDER BY scope),'[]'::jsonb) FROM editions e),
  'expected_scopes',(SELECT coalesce(jsonb_agg(scope ORDER BY scope),'[]'::jsonb) FROM expected));
$fence$;

REVOKE ALL ON statarena_app.archive_read_editions,statarena_app.archive_read_matches FROM PUBLIC;
REVOKE ALL ON FUNCTION statarena_app.archive_source_fence(text) FROM PUBLIC;
DO $grants$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='statarena_runtime') THEN
  GRANT SELECT ON statarena_app.archive_read_editions,statarena_app.archive_read_matches TO statarena_runtime;
  GRANT EXECUTE ON FUNCTION statarena_app.archive_source_fence(text) TO statarena_runtime;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='statarena_ingest') THEN
  GRANT SELECT,INSERT,UPDATE,DELETE ON statarena_app.archive_read_editions,statarena_app.archive_read_matches TO statarena_ingest;
  GRANT EXECUTE ON FUNCTION statarena_app.archive_source_fence(text) TO statarena_ingest;
 END IF;
END;
$grants$;
