-- Match reads of the API (legacy /api/fixtures and /api/matches/{id}/summary), in the
-- legacy field names. Public ids are joined from core.provider_ids (the same rule as
-- api.public_id, written as joins so that lists stay set-based).

CREATE VIEW api.fixtures AS
SELECT m.id AS match_id, m.season_id, m.competition_season_id, m.revision,
  coalesce(mk.provider_key, 'm_v' || lpad(m.id::text, 7, '0')) AS id,
  se.label AS season, cs.native_label AS native_season, m.match_date AS day, m.kickoff_at,
  to_char(m.kickoff_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS time_utc,
  m.status::text AS status, r.name AS round_name, m.has_playoff,
  m.home_team_id AS home_internal_id,
  coalesce(hk.provider_key, 't_v' || lpad(m.home_team_id::text, 7, '0')) AS home_team_id,
  ht.name AS home_name, hc.source_url AS home_image_url,
  m.away_team_id AS away_internal_id,
  coalesce(ak.provider_key, 't_v' || lpad(m.away_team_id::text, 7, '0')) AS away_team_id,
  awt.name AS away_name, ac.source_url AS away_image_url,
  coalesce(ck.provider_key, 'l_v' || lpad(cs.competition_id::text, 7, '0')) AS league_id,
  c.name AS league_name, lg.source_url AS league_image_url, c.country_code AS country,
  m.home_score::float8 AS score_home, m.away_score::float8 AS score_away,
  m.home_penalty_score::float8 AS score_penalty_home, m.away_penalty_score::float8 AS score_penalty_away,
  ref.id AS referee_internal_id, ref.name AS referee, v.id AS venue_internal_id, v.name AS stadium
FROM core.matches m
JOIN core.seasons se ON se.id = m.season_id
JOIN core.competition_seasons cs ON cs.id = m.competition_season_id
JOIN core.competitions c ON c.id = cs.competition_id
LEFT JOIN core.rounds r ON r.id = m.round_id
LEFT JOIN core.teams ht ON ht.id = m.home_team_id
LEFT JOIN core.teams awt ON awt.id = m.away_team_id
LEFT JOIN core.assets hc ON hc.id = ht.crest_asset_id
LEFT JOIN core.assets ac ON ac.id = awt.crest_asset_id
LEFT JOIN core.assets lg ON lg.id = c.logo_asset_id
LEFT JOIN core.referees ref ON ref.id = m.referee_id
LEFT JOIN core.venues v ON v.id = m.venue_id
LEFT JOIN core.provider_ids mk ON mk.entity_type = 'match' AND mk.entity_id = m.id AND mk.provider = 'pitchapi' AND mk.is_current
LEFT JOIN core.provider_ids hk ON hk.entity_type = 'team' AND hk.entity_id = m.home_team_id AND hk.provider = 'pitchapi' AND hk.is_current
LEFT JOIN core.provider_ids ak ON ak.entity_type = 'team' AND ak.entity_id = m.away_team_id AND ak.provider = 'pitchapi' AND ak.is_current
LEFT JOIN core.provider_ids ck ON ck.entity_type = 'competition' AND ck.entity_id = cs.competition_id AND ck.provider = 'pitchapi' AND ck.is_current;

-- Both sides of a match: line-up facts and the team statistics of the summary.
CREATE VIEW api.match_sides AS
SELECT m.season_id, m.id AS match_id, x.side, x.team_id, l.formation, co.name AS coach,
  l.confirmed AS lineup_confirmed, x.score::float8 AS score,
  s.xg::numeric::float8 AS xg, s.total_shots::float8 AS shots, s.shots_on_target::float8 AS shots_on_target,
  s.possession_pct::numeric::float8 AS possession, s.big_chances::float8 AS big_chances, s.corners::float8 AS corners
FROM core.matches m
CROSS JOIN LATERAL (VALUES ('home', m.home_team_id, m.home_score), ('away', m.away_team_id, m.away_score)) AS x(side, team_id, score)
LEFT JOIN core.lineups l ON l.season_id = m.season_id AND l.match_id = m.id AND l.team_id = x.team_id
LEFT JOIN core.coaches co ON co.id = l.coach_id
LEFT JOIN core.team_match_stats s ON s.season_id = m.season_id AND s.match_id = m.id AND s.team_id = x.team_id AND s.period = 'all';

CREATE VIEW api.match_shots AS
SELECT s.season_id, s.match_id, s.shot_no, coalesce(s.provider_shot_key, s.shot_no::text) AS id,
  s.team_id, s.player_id, p.name AS player_name, s.minute::float8 AS minute, s.minute_added::float8 AS minute_added,
  s.period::text AS period, s.xg::numeric::float8 AS xg, (s.outcome = 'goal') AS is_goal, s.is_own_goal
FROM core.shots s LEFT JOIN core.players p ON p.id = s.player_id;

-- Collection state of a match's details (legacy detailCollected and coverage flags).
CREATE VIEW api.match_detail_state AS
SELECT m.season_id, m.id AS match_id,
  coalesce('ok' IN (mc.player_stats::text, mc.team_stats::text, mc.events::text, mc.shots::text, mc.lineups::text), false) AS detail_collected,
  coalesce(mc.shots = 'ok', false) AS shots_ok, coalesce(mc.team_stats = 'ok', false) AS team_stats_ok,
  coalesce(mc.player_stats = 'ok', false) AS player_stats_ok, coalesce(mc.events = 'ok', false) AS events_ok
FROM core.matches m
LEFT JOIN core.match_coverage mc ON mc.season_id = m.season_id AND mc.match_id = m.id;
