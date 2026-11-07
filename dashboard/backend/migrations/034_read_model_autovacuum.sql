-- A table rewrite does not reliably populate the ordinary insert/update
-- counters. After 030/031, deployment must run plain VACUUM (ANALYZE) outside
-- the migration transaction; these thresholds govern subsequent publications.
-- Keep global worker/cost limits, freeze policy and all row data unchanged.
ALTER TABLE statarena_app.appearances SET (
 autovacuum_enabled=true,
 autovacuum_vacuum_threshold=500,
 autovacuum_vacuum_scale_factor=0.01,
 autovacuum_vacuum_insert_threshold=500,
 autovacuum_vacuum_insert_scale_factor=0.005,
 autovacuum_analyze_threshold=250,
 autovacuum_analyze_scale_factor=0.002
);

-- A changed league rebuilds only its rollup scope. Do not wait for 20% of all
-- seasons to be replaced before cleaning those old tuples and visibility bits.
ALTER TABLE statarena_app.player_season_rollups SET (
 autovacuum_enabled=true,
 autovacuum_vacuum_threshold=200,
 autovacuum_vacuum_scale_factor=0.01,
 autovacuum_vacuum_insert_threshold=200,
 autovacuum_vacuum_insert_scale_factor=0.01,
 autovacuum_analyze_threshold=100,
 autovacuum_analyze_scale_factor=0.01
);

-- Consolidating millions of rows makes the default percentage thresholds much
-- larger than an ordinary resource replacement. Use a less frequent policy
-- than the navigation facts above; PostgreSQL's existing shared cost budget
-- still controls background I/O. This does not run VACUUM inside publication.
ALTER TABLE statarena_app.catalog_records SET (
 autovacuum_enabled=true,
 autovacuum_vacuum_threshold=2000,
 autovacuum_vacuum_scale_factor=0.02,
 autovacuum_vacuum_insert_threshold=2000,
 autovacuum_vacuum_insert_scale_factor=0.02,
 autovacuum_analyze_threshold=1000,
 autovacuum_analyze_scale_factor=0.005
);
ALTER TABLE statarena_app.detail_records SET (
 autovacuum_enabled=true,
 autovacuum_vacuum_threshold=2000,
 autovacuum_vacuum_scale_factor=0.02,
 autovacuum_vacuum_insert_threshold=2000,
 autovacuum_vacuum_insert_scale_factor=0.02,
 autovacuum_analyze_threshold=1000,
 autovacuum_analyze_scale_factor=0.005
);
-- support_records is small in the observed inventory; its default thresholds
-- already react to resource replacements without a large percentage floor.
