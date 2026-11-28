-- The DBA creates vega_panna_fixture_daily with LOGIN, CONNECTION LIMIT 1, no memberships
-- and no elevated attributes. Set its password outside SQL history and provision only its SSM DSN.
BEGIN;
GRANT CONNECT ON DATABASE vega_v2 TO vega_panna_fixture_daily;
GRANT USAGE ON SCHEMA panna, panna_data TO vega_panna_fixture_daily;
GRANT SELECT ON panna.datasets, panna.columns, panna.runs, panna.receipts, panna.streams,
  panna.loads, panna.segments, panna.chunks, panna.manifest, panna.scope, panna.current_segments,
  panna.current_generations, panna_data.opta_fixtures, panna_data.opta_fixtures_ext TO vega_panna_fixture_daily;
GRANT INSERT ON panna.runs, panna.receipts, panna.streams, panna.loads, panna.segments, panna.chunks,
  panna.manifest, panna.scope, panna_data.opta_fixtures, panna_data.opta_fixtures_ext TO vega_panna_fixture_daily;
GRANT UPDATE ON panna.runs, panna.loads, panna.scope TO vega_panna_fixture_daily;
GRANT USAGE ON SEQUENCE panna.segments_segment_id_seq TO vega_panna_fixture_daily;
COMMIT;
