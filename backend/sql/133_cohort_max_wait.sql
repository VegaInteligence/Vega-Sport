-- A queued cohort keeps the time of its first mark not yet refreshed (VI-26,
-- docs/calculs/09-audit-2026-11/FAILURE_MODES.md §18). models.process_cohorts refreshes a cohort at the earlier of
-- 10 minutes after its last mark (queued_at) and 60 minutes after this one, so a cohort that keeps changing is
-- still refreshed: on 17 Nov 2026 team:2021:europe, re-marked 2,853 times by the 2021 backfill, had not been
-- refreshed since 9 Nov.
--
-- A re-mark (ON CONFLICT … DO UPDATE SET revision, queued_at) leaves the column as it is; the other scope kinds
-- get it by default and do not read it. A non-volatile default: no table rewrite, and the rows queued now take the
-- migration's time.
SET LOCAL lock_timeout = '3s';

ALTER TABLE ops.dirty_scopes ADD COLUMN first_queued_at timestamptz NOT NULL DEFAULT now();

COMMENT ON COLUMN ops.dirty_scopes.first_queued_at IS
  'When the scope was first queued since its last refresh; a re-mark leaves it. A cohort is due at the earlier of queued_at + 10 min and first_queued_at + 60 min (VI-26).';
