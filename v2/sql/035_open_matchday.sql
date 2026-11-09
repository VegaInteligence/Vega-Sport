-- The complementary competitions of open-matchday (vega_v2/sources/open_matchday.py) are
-- cup-source editions too; the site reads them as main's catalogue does (legacy
-- /api/cup-index?kind=supplemental and /api/cup-table), rebuilt from typed rows.
ALTER TABLE core.competition_seasons DROP CONSTRAINT IF EXISTS competition_seasons_cup_key_check;
ALTER TABLE core.competition_seasons ADD CONSTRAINT competition_seasons_cup_key_check
  CHECK (cup_key ~ '^(open-cups|openligadb|nations-results|open-matchday):[A-Za-z0-9_-]+:\d{4}(/\d{4})?$');

CREATE OR REPLACE VIEW api.cup_editions AS
SELECT cs.id AS competition_season_id, split_part(cs.cup_key, ':', 1) AS kind, split_part(cs.cup_key, ':', 2) AS competition,
  cs.native_label AS season, cs.cup_name AS name, cs.cup_source_url AS source_url, cs.cup_data_url AS data_url,
  cs.cup_checked_at AS checked_at, cs.cup_updated_at AS updated_at,
  api.public_id('competition', cs.competition_id) AS competition_id,
  CASE split_part(cs.cup_key, ':', 1) WHEN 'open-cups' THEN 'matches-v1' WHEN 'openligadb' THEN 'rounds-v1'
    WHEN 'open-matchday' THEN 'table-v1' ELSE 'results-v1' END AS format,
  cs.competition_id AS internal_competition_id
FROM core.competition_seasons cs WHERE cs.cup_key IS NOT NULL;

-- One row per match of a table-format edition, with the team statistics the source gave.
CREATE VIEW api.cup_table_rows AS
SELECT m.competition_season_id, split_part(cs.cup_key, ':', 2) AS competition, cs.native_label AS season, m.archive_position AS position,
  m.status::text AS status, r.name AS gw, m.match_date AS date,
  coalesce(m.home_team_name, ht.name) AS home, coalesce(m.away_team_name, awt.name) AS away,
  m.home_score, m.away_score, m.home_score_ht, m.away_score_ht,
  h.total_shots AS home_shots, a.total_shots AS away_shots, h.shots_on_target AS home_target, a.shots_on_target AS away_target,
  h.fouls AS home_fouls, a.fouls AS away_fouls, h.corners AS home_corners, a.corners AS away_corners,
  h1.corners AS home_corners_1h, a1.corners AS away_corners_1h, h2.corners AS home_corners_2h, a2.corners AS away_corners_2h,
  h.yellow_cards AS home_yellow, a.yellow_cards AS away_yellow, h.red_cards AS home_red, a.red_cards AS away_red
FROM core.matches m
JOIN core.competition_seasons cs ON cs.id = m.competition_season_id AND cs.cup_key LIKE 'open-matchday:%'
LEFT JOIN core.rounds r ON r.id = m.round_id
LEFT JOIN core.teams ht ON ht.id = m.home_team_id
LEFT JOIN core.teams awt ON awt.id = m.away_team_id
LEFT JOIN core.team_match_stats h ON h.season_id = m.season_id AND h.match_id = m.id AND h.team_id = m.home_team_id AND h.period = 'all'
LEFT JOIN core.team_match_stats a ON a.season_id = m.season_id AND a.match_id = m.id AND a.team_id = m.away_team_id AND a.period = 'all'
LEFT JOIN core.team_match_stats h1 ON h1.season_id = m.season_id AND h1.match_id = m.id AND h1.team_id = m.home_team_id AND h1.period = 'first_half'
LEFT JOIN core.team_match_stats a1 ON a1.season_id = m.season_id AND a1.match_id = m.id AND a1.team_id = m.away_team_id AND a1.period = 'first_half'
LEFT JOIN core.team_match_stats h2 ON h2.season_id = m.season_id AND h2.match_id = m.id AND h2.team_id = m.home_team_id AND h2.period = 'second_half'
LEFT JOIN core.team_match_stats a2 ON a2.season_id = m.season_id AND a2.match_id = m.id AND a2.team_id = m.away_team_id AND a2.period = 'second_half';
