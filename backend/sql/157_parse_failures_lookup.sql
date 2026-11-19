-- The lookup of sources.failure_once (docs/calculs/09-audit-2026-11/FAILURE_MODES.md §46, 46i): ops.parse_failures had
-- only its primary key and is never purged, so each call read the whole table (a refusal a source keeps, a birth-date
-- conflict per player in a club's transaction). One row per (edition, code, message) is looked up by code, edition and
-- the message's digest: the message itself (up to 2 000 characters) could pass btree's row size in a multi-byte script.
-- No relation naming a match is added (open_matchday_restore.REVIEWED_SCHEMAS stays on 160).
SET LOCAL lock_timeout = '3s';

CREATE INDEX parse_failures_once ON ops.parse_failures (error_code, competition_season_id, md5(message));
