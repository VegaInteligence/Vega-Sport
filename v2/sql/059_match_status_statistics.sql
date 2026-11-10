-- Planner statistics for a match's status as the api views expose it.
--
-- The views give the status as text (m.status::text AS status) and the reads filter on
-- it (GET /api/fixtures?status=played: f.status = 'finished'). The planner keeps
-- statistics of the column, not of the cast: it took its default for an expression it
-- knows nothing about, 0.5 % of the table. On 10 November 2026 it expected 2,978
-- finished matches where 577,576 of 595,570 are, joined the editions by a nested loop
-- that rescanned the matches 304 times, and the fixtures list took 39 s (timed out at
-- 8 s) whenever a status was asked; without the filter the same list took 0.5 s.
--
-- Statistics on the expression give the planner the real shares. They are kept with the
-- table's own: every ANALYZE of core.matches, autovacuum's included, refreshes them.
CREATE STATISTICS core.matches_status_text ON (status::text) FROM core.matches;

ANALYZE core.matches;
