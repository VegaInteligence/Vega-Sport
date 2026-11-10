-- The status page's score delay (GET /api/ops/status, freshness), over followed matches.
--
-- The time from kickoff to the first final score only measures the collection for a
-- match the worker was already following at kickoff: its first check is then planned
-- 105 minutes after kickoff (jobs.FIRST_SCORE_CHECK). A match first seen once played
-- (the days before the worker started, a late entry in a calendar, the backfill's
-- history) gets its final score when it is met, and that time is the age of the match.
--
-- api.ops_finished_matches gains watched_since, the time the match's watch was opened
-- (ops.match_watch rows are never removed), NULL for a match that never had one. The
-- route counts the matches watched since before their kickoff. The view keeps every
-- column it had, in place: migrations are applied before the API is updated, and the
-- version still running reads them.
CREATE OR REPLACE VIEW api.ops_finished_matches AS
SELECT m.id AS match_id, m.kickoff_at, m.first_finished_at,
  (SELECT max(f.last_success_at) FROM ops.family_state f WHERE f.match_id = m.id) AS last_family_at,
  w.created_at AS watched_since
FROM core.matches m
LEFT JOIN ops.match_watch w ON w.match_id = m.id
WHERE m.first_finished_at IS NOT NULL;
