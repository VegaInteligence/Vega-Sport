-- The directory ranks all actors before selecting one page. Keep its common
-- comparison inputs in a small covering index instead of scanning the wide
-- observation JSON heap for identity, totals and latest appearance separately.
-- These columns derive from the existing rollup automatically; the unchanged
-- 025 publisher still writes only its original columns and owns freshness.
-- A freshly published heap is not necessarily all-visible to index-only scans.
-- Keep the wide JSON values out of that fallback scan as well. Retarget existing
-- metrics once: concatenating an empty object preserves the original jsonb bytes
-- while the guarded type rewrite applies storage policy to a new physical heap.
ALTER TABLE statarena_app.player_season_rollups SET (toast_tuple_target=512);
DO $storage$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_attribute
     WHERE attrelid='statarena_app.player_season_rollups'::regclass
       AND attname='identity_ref' AND attnum>0 AND NOT attisdropped) THEN
  IF EXISTS (SELECT 1 FROM statarena_app.player_season_rollups WHERE jsonb_typeof(metrics) IS DISTINCT FROM 'object') THEN
   RAISE EXCEPTION 'Expected object-valued player rollup metrics before migration 030';
  END IF;
  ALTER TABLE statarena_app.player_season_rollups
   ALTER COLUMN metrics TYPE jsonb USING (metrics || '{}'::jsonb);
 END IF;
END
$storage$;

ALTER TABLE statarena_app.player_season_rollups
 ADD COLUMN IF NOT EXISTS identity_ref text STORAGE PLAIN GENERATED ALWAYS AS (identity->>'player_ref') STORED,
 ADD COLUMN IF NOT EXISTS identity_date text STORAGE PLAIN GENERATED ALWAYS AS (coalesce(identity->>'date','')) STORED,
 ADD COLUMN IF NOT EXISTS identity_source_order bigint GENERATED ALWAYS AS ((identity->>'source_order')::bigint) STORED,
 ADD COLUMN IF NOT EXISTS latest_ref text STORAGE PLAIN GENERATED ALWAYS AS (latest->>'player_ref') STORED,
 ADD COLUMN IF NOT EXISTS latest_date text STORAGE PLAIN GENERATED ALWAYS AS (coalesce(latest->>'date','')) STORED,
 ADD COLUMN IF NOT EXISTS latest_source_order bigint GENERATED ALWAYS AS ((latest->>'source_order')::bigint) STORED,
 ADD COLUMN IF NOT EXISTS latest_present boolean GENERATED ALWAYS AS (latest IS NOT NULL) STORED,
 ADD COLUMN IF NOT EXISTS rank_goals_sum double precision GENERATED ALWAYS AS ((metrics->'goals'->>'sum')::float8) STORED,
 ADD COLUMN IF NOT EXISTS rank_goals_count double precision GENERATED ALWAYS AS ((metrics->'goals'->>'count')::float8) STORED,
 ADD COLUMN IF NOT EXISTS rank_goals_minutes double precision GENERATED ALWAYS AS ((metrics->'goals'->>'minutes')::float8) STORED,
 ADD COLUMN IF NOT EXISTS rank_xg_sum double precision GENERATED ALWAYS AS ((metrics->'xg'->>'sum')::float8) STORED,
 ADD COLUMN IF NOT EXISTS rank_xg_count double precision GENERATED ALWAYS AS ((metrics->'xg'->>'count')::float8) STORED,
 ADD COLUMN IF NOT EXISTS rank_xg_minutes double precision GENERATED ALWAYS AS ((metrics->'xg'->>'minutes')::float8) STORED,
 ADD COLUMN IF NOT EXISTS rank_assists_sum double precision GENERATED ALWAYS AS ((metrics->'assists'->>'sum')::float8) STORED,
 ADD COLUMN IF NOT EXISTS rank_assists_count double precision GENERATED ALWAYS AS ((metrics->'assists'->>'count')::float8) STORED,
 ADD COLUMN IF NOT EXISTS rank_assists_minutes double precision GENERATED ALWAYS AS ((metrics->'assists'->>'minutes')::float8) STORED,
 ADD COLUMN IF NOT EXISTS rank_xa_sum double precision GENERATED ALWAYS AS ((metrics->'xa'->>'sum')::float8) STORED,
 ADD COLUMN IF NOT EXISTS rank_xa_count double precision GENERATED ALWAYS AS ((metrics->'xa'->>'count')::float8) STORED,
 ADD COLUMN IF NOT EXISTS rank_xa_minutes double precision GENERATED ALWAYS AS ((metrics->'xa'->>'minutes')::float8) STORED;

CREATE INDEX IF NOT EXISTS app_player_rollups_directory
 ON statarena_app.player_season_rollups(season,player_id,league_id)
 INCLUDE(matches,total_minutes,unknown_minutes,rating_sum,rating_count,
         identity_ref,identity_date,identity_source_order,
         latest_ref,latest_date,latest_source_order,latest_present,
         rank_goals_sum,rank_goals_count,rank_goals_minutes,
         rank_xg_sum,rank_xg_count,rank_xg_minutes,
         rank_assists_sum,rank_assists_count,rank_assists_minutes,
         rank_xa_sum,rank_xa_count,rank_xa_minutes);
