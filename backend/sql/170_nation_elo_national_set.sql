-- 24 Nov 2026 (FAILURE_MODES.md §55): « Italie » and « Grèce » (OpenLigaDB, flagged national) were merged into the
-- « Italy » and « Greece » the internationals created (identity.nation_twins keeps the English row), and the kept rows
-- had no national flag: the Elo of 24 Nov ranked 143 nations, without them. A merge now carries the flag
-- (identity.merge_teams), the marking repairs a merge that lost it (curated.national_teams), and a new team re-arms
-- both passes (cups._team).
--
-- Each Elo run keeps the national teams it read (power.NATION_SET: their count and the md5 of their ids), so that the
-- worker runs it again once when they change (worker.elo_due). A run from before this migration has none: it differs.
SET LOCAL lock_timeout = '3s';

ALTER TABLE agg.nation_elo_runs ADD COLUMN national_teams integer, ADD COLUMN national_teams_md5 text;

-- The marking and the identity pass run at the worker's next round instead of tomorrow's (as 121 for the identity
-- pass): the marking flags « Italy », « Greece » and the members of FIFA only International Results names, then the
-- Elo is due (its run has no national set).
UPDATE ops.source_runs SET last_success_at = NULL WHERE source = 'vega' AND scope IN ('national_teams', 'team_identity');
