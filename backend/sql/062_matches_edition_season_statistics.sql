-- An edition belongs to one season: planner statistics that say so.
--
-- The reads bind a scope's season and its editions together (publication.mjs
-- idScopeWhere, the clubs list): the season's id keeps the partitioned tables to its
-- partitions, the editions' ids reach core.matches by index. core.matches carries both
-- columns, and the planner multiplied their shares as if they were independent: on
-- 10 November 2026 it expected 261 matches for the edition 904 alone (it holds 380) and
-- 9 once its season was named too. A plan built on 9 rows joins by nested loops over
-- what it takes for a handful of rows: the club analysis of one league of a full season
-- read its scope again for each of its 760 rows and took 21 s (timed out at 8 s).
--
-- The dependency statistics tell the planner that competition_season_id determines
-- season_id, which the foreign key to core.competition_seasons(id, season_id)
-- guarantees. They are kept with the table's own: every ANALYZE of core.matches,
-- autovacuum's included, refreshes them.
CREATE STATISTICS core.matches_edition_season (dependencies) ON competition_season_id, season_id FROM core.matches;

ANALYZE core.matches;
