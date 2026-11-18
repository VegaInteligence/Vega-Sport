BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL TIME ZONE 'UTC';
SET LOCAL statement_timeout = '12s';

SELECT clock_timestamp(), current_setting('transaction_read_only'),
  (SELECT max(version) FROM ops.schema_migrations) AS latest,
  (SELECT to_jsonb(v) FROM (
    SELECT version, encode(checksum,'hex') AS sha256, applied_at
    FROM ops.schema_migrations WHERE version='134_archive_scores_due.sql'
  ) v) AS score_migration;

SELECT r.scope, r.status, r.error_code, r.last_success_at, r.last_attempt_at, r.rows_written,
       m.id, m.status::text AS match_status, m.home_score, m.away_score, m.revision,
       c.cup_checked_at, c.cup_updated_at
FROM core.matches m JOIN core.competition_seasons c ON c.id=m.competition_season_id
LEFT JOIN ops.source_runs r ON r.source='openfootball' AND r.scope=c.cup_key
WHERE (m.id,c.cup_key) IN ((836,'open-cups:world-cup-history:1982'),(1056,'open-cups:world-cup-history:1998'))
ORDER BY m.id;

ROLLBACK;
