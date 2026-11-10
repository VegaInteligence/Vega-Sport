-- Worker loop: planner bookkeeping and the watch states it needs.

-- A watch that reaches +7 days without a final status ends with a warning.
ALTER TYPE ops.warning_kind ADD VALUE IF NOT EXISTS 'score_never_final';

-- Last status and kickoff the score lane saw, so the planner can tell a rescheduled
-- match (new kickoff) from one that is simply late.
ALTER TABLE ops.match_watch
  ADD COLUMN last_status core.match_status,
  ADD COLUMN kickoff_at timestamptz,
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();

-- Only live watches are scanned; stopped and corrected ones are history.
DROP INDEX ops.match_watch_pending;
CREATE INDEX match_watch_pending ON ops.match_watch(next_check_at)
WHERE state IN ('scheduled', 'waiting_final', 'final');
CREATE INDEX match_watch_kickoff ON ops.match_watch(kickoff_at);

-- "Fetched recently?" checks (daily calendar, weekly league refresh) read done jobs.
CREATE INDEX fetch_jobs_done_recent ON ops.fetch_jobs(family, updated_at)
WHERE state = 'done';
