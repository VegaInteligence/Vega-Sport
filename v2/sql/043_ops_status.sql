-- Operations views of the private status page (Vega Status, GET /api/ops/status).
-- The read role reads them like every api view, as their owner; only the ops route,
-- behind its own key, queries them. They carry ids, labels, states, codes and times:
-- no provider payload, no provider key, no secret.

-- Every queued, leased, failed or finished job with a readable target.
CREATE VIEW api.ops_jobs AS
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
  END AS target
FROM ops.fetch_jobs j
LEFT JOIN core.matches m ON j.entity_type = 'match' AND m.id = j.entity_id
LEFT JOIN core.teams h ON h.id = m.home_team_id
LEFT JOIN core.teams a ON a.id = m.away_team_id
LEFT JOIN core.teams t ON j.entity_type = 'team' AND t.id = j.entity_id
LEFT JOIN core.players p ON j.entity_type = 'player' AND p.id = j.entity_id
LEFT JOIN core.competitions c ON j.entity_type = 'competition' AND c.id = j.entity_id
LEFT JOIN core.competition_seasons cs ON cs.id = j.competition_season_id
LEFT JOIN core.competitions cc ON cc.id = cs.competition_id;

-- The status page reads the jobs finished in the last 24 hours; finished jobs are kept
-- two weeks (planner._prune), so without this every read scanned them all.
CREATE INDEX fetch_jobs_finished ON ops.fetch_jobs(updated_at) WHERE state IN ('done', 'failed');

CREATE VIEW api.ops_backlog AS
SELECT lane, family, state, jobs::integer AS jobs, oldest_run_after FROM ops.v_backlog;

-- Watched matches with their teams, competition and detail families collected.
CREATE VIEW api.ops_match_watch AS
SELECT w.match_id, w.state::text AS watch_state, w.checks, w.next_check_at,
  m.kickoff_at, m.status::text AS status, m.home_score, m.away_score, m.first_finished_at,
  h.name AS home, a.name AS away, c.name AS competition,
  (SELECT count(*) FROM ops.family_state f
   WHERE f.match_id = w.match_id AND f.status = 'ok' AND f.family <> 'summary')::integer AS families_ok
FROM ops.match_watch w
JOIN core.matches m ON m.id = w.match_id
LEFT JOIN core.teams h ON h.id = m.home_team_id
LEFT JOIN core.teams a ON a.id = m.away_team_id
LEFT JOIN core.competition_seasons cs ON cs.id = m.competition_season_id
LEFT JOIN core.competitions c ON c.id = cs.competition_id;

-- Finished matches: kickoff, first final score and last detail family (freshness).
-- A filter on first_finished_at reaches core.matches, unlike ops.v_freshness's grouping.
CREATE VIEW api.ops_finished_matches AS
SELECT m.id AS match_id, m.kickoff_at, m.first_finished_at,
  (SELECT max(f.last_success_at) FROM ops.family_state f WHERE f.match_id = m.id) AS last_family_at
FROM core.matches m
WHERE m.first_finished_at IS NOT NULL;

CREATE VIEW api.ops_source_runs AS
SELECT source::text AS source, scope, last_attempt_at, last_success_at, status, error_code, rows_written, unmatched
FROM ops.source_runs;

-- Model runs (agg.calc_runs) and power ranking runs (agg.power_runs) in one list.
CREATE VIEW api.ops_calc_runs AS
SELECT 'calc' AS origin, id, kind::text AS kind, model_version AS version, cohort_definition AS scope,
  started_at, finished_at, status::text AS status
FROM agg.calc_runs
UNION ALL
SELECT 'power', id, 'power_' || kind, method_version, coalesce('season:' || season_id, 'all'), started_at, finished_at, status
FROM agg.power_runs;

-- Provider calls (no ids, no request ids): family, outcome, duration, time.
CREATE VIEW api.ops_fetch_log AS
SELECT family::text AS family, http_status, error_code, duration_ms, fetched_at FROM ops.fetch_log;

CREATE VIEW api.ops_data_warnings AS
SELECT w.match_id, w.kind::text AS kind, w.detail, w.detected_at,
  coalesce(h.name, '?') || ' – ' || coalesce(a.name, '?') AS match_label
FROM ops.data_warnings w
JOIN core.matches m ON m.id = w.match_id
LEFT JOIN core.teams h ON h.id = m.home_team_id
LEFT JOIN core.teams a ON a.id = m.away_team_id;

CREATE VIEW api.ops_collection_progress AS
SELECT p.source::text AS source, p.competition_season_id, cs.season_id, c.name AS competition,
  cs.native_label AS season, p.family::text AS family, p.expected, p.done, p.empty, p.failed,
  p.last_success_at, p.updated_at
FROM ops.collection_progress p
JOIN core.competition_seasons cs ON cs.id = p.competition_season_id
JOIN core.competitions c ON c.id = cs.competition_id;

CREATE VIEW api.ops_parse_failures AS
SELECT family::text AS family, error_code, at FROM ops.parse_failures;

CREATE VIEW api.ops_unknown_fields AS
SELECT family::text AS family, field_path, occurrences, first_seen_at, last_seen_at FROM ops.unknown_fields;

-- One row: what waits for the calculator, the coverage gaps, and the worker's last writes
-- (its liveness: a provider call, a source run, a model run).
CREATE VIEW api.ops_summary AS
SELECT
  (SELECT count(*) FROM ops.v_coverage_gaps)::integer AS coverage_gaps,
  (SELECT count(*) FROM ops.dirty_scopes)::integer AS dirty_scopes,
  (SELECT min(queued_at) FROM ops.dirty_scopes) AS oldest_dirty_at,
  (SELECT max(fetched_at) FROM ops.fetch_log) AS last_fetch_at,
  (SELECT max(last_attempt_at) FROM ops.source_runs) AS last_source_at,
  (SELECT max(coalesce(finished_at, started_at)) FROM agg.calc_runs) AS last_calc_at;
