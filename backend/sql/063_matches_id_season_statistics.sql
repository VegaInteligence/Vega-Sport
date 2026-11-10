-- A match belongs to one season: planner statistics that say so.
--
-- The reads that name matches by id also name their season, which keeps the partitioned
-- tables they join to their partitions (the season partitions, the home, the appearance
-- reads: match_id = ANY(...) AND season_id = ...). As for an edition and its season
-- (062), the planner multiplied the two shares: on 10 November 2026 it expected 50
-- matches for 50 ids, 3 once their season was named too, and 1 where the ids come from a
-- subquery (10 without the season). The season partition of the Premier League
-- 2026/2027 was planned on one fixture where it reads 50: it compared their 1,400
-- appearances to every edition by a nested loop, 1.3 s of its 1.7 s.
--
-- The dependency statistics tell the planner that id determines season_id. They are
-- kept with the table's own: every ANALYZE of core.matches refreshes them.
CREATE STATISTICS core.matches_id_season (dependencies) ON id, season_id FROM core.matches;

ANALYZE core.matches;
