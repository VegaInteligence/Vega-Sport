-- The status page's reads (GET /api/ops/status), made cheap and exact.
--
-- api.ops_jobs gave a job's lane and state as text only. A filter on text never matches
-- the partial indexes of ops.fetch_jobs (state = 'pending'; state IN ('done', 'failed')),
-- so each status read went through the whole job table several times and ran into the
-- reader's 8 second limit. The view keeps every column it had, in place: migrations are
-- applied before the API is updated, and the version still running reads them. It gains
-- lane and state under the table's own types; the route filters on those two.
CREATE OR REPLACE VIEW api.ops_jobs AS
SELECT j.id, j.lane::text AS lane, j.family::text AS family, j.state::text AS state,
  j.run_after, j.updated_at, j.attempts, j.priority, j.last_http, j.last_error_code,
  CASE WHEN j.entity_type = 'match' THEN j.entity_id END AS match_id,
  coalesce(m.season_id, cs.season_id) AS season_id,
  CASE
    WHEN j.entity_type = 'match' THEN coalesce(h.name, '?') || ' – ' || coalesce(a.name, '?')
    WHEN j.entity_type = 'team' THEN t.name
    WHEN j.entity_type = 'player' THEN p.name
    WHEN j.entity_type = 'competition' THEN c.name
    WHEN j.competition_season_id IS NOT NULL THEN concat_ws(' ', cc.name, cs.native_label)
    WHEN j.target_date IS NOT NULL THEN to_char(j.target_date, 'YYYY-MM-DD')
    ELSE j.global_key
  END AS target,
  j.lane AS job_lane, j.state AS job_state
FROM ops.fetch_jobs j
LEFT JOIN core.matches m ON j.entity_type = 'match' AND m.id = j.entity_id
LEFT JOIN core.teams h ON h.id = m.home_team_id
LEFT JOIN core.teams a ON a.id = m.away_team_id
LEFT JOIN core.teams t ON j.entity_type = 'team' AND t.id = j.entity_id
LEFT JOIN core.players p ON j.entity_type = 'player' AND p.id = j.entity_id
LEFT JOIN core.competitions c ON j.entity_type = 'competition' AND c.id = j.entity_id
LEFT JOIN core.competition_seasons cs ON cs.id = j.competition_season_id
LEFT JOIN core.competitions cc ON cc.id = cs.competition_id;

-- The jobs a worker holds right now: a handful of rows, read on every status read and
-- by the worker when it takes over an expired lease.
CREATE INDEX fetch_jobs_leased ON ops.fetch_jobs(lease_until) WHERE state = 'leased';

-- families_ok counts the detail families that are settled: collected, or confirmed
-- without data for this match ('unavailable'), which is how the planner counts them
-- too. A match whose provider has no heatmap no longer stays one short for ever.
CREATE OR REPLACE VIEW api.ops_match_watch AS
SELECT w.match_id, w.state::text AS watch_state, w.checks, w.next_check_at,
  m.kickoff_at, m.status::text AS status, m.home_score, m.away_score, m.first_finished_at,
  h.name AS home, a.name AS away, c.name AS competition,
  (SELECT count(*) FROM ops.family_state f
   WHERE f.match_id = w.match_id AND f.status IN ('ok', 'unavailable') AND f.family <> 'summary')::integer AS families_ok
FROM ops.match_watch w
JOIN core.matches m ON m.id = w.match_id
LEFT JOIN core.teams h ON h.id = m.home_team_id
LEFT JOIN core.teams a ON a.id = m.away_team_id
LEFT JOIN core.competition_seasons cs ON cs.id = m.competition_season_id
LEFT JOIN core.competitions c ON c.id = cs.competition_id;

-- last_calc_at also sees the power ranking runs (agg.power_runs): they are model runs
-- like the others. data_warnings is the number of warnings; the route lists the latest.
CREATE OR REPLACE VIEW api.ops_summary AS
SELECT
  (SELECT count(*) FROM ops.v_coverage_gaps)::integer AS coverage_gaps,
  (SELECT count(*) FROM ops.dirty_scopes)::integer AS dirty_scopes,
  (SELECT min(queued_at) FROM ops.dirty_scopes) AS oldest_dirty_at,
  (SELECT max(fetched_at) FROM ops.fetch_log) AS last_fetch_at,
  (SELECT max(last_attempt_at) FROM ops.source_runs) AS last_source_at,
  greatest((SELECT max(coalesce(finished_at, started_at)) FROM agg.calc_runs),
           (SELECT max(coalesce(finished_at, started_at)) FROM agg.power_runs)) AS last_calc_at,
  (SELECT count(*) FROM ops.data_warnings)::integer AS data_warnings;

-- api.ops_backlog is no longer read once the API of this migration runs (the route
-- counts the queue itself, with what is due and what a retry cannot fix); it stays for
-- the version in place and can be dropped by a later migration.
