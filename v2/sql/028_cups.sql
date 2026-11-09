-- Reads of the cup editions (facts in 015b_cup_facts.sql): legacy /api/open-cups,
-- /api/openligadb, /api/nations-results and /api/cup-snapshot.
CREATE VIEW api.cup_editions AS
SELECT cs.id AS competition_season_id, split_part(cs.cup_key, ':', 1) AS kind, split_part(cs.cup_key, ':', 2) AS competition,
  cs.native_label AS season, cs.cup_name AS name, cs.cup_source_url AS source_url, cs.cup_data_url AS data_url,
  cs.cup_checked_at AS checked_at, cs.cup_updated_at AS updated_at
FROM core.competition_seasons cs WHERE cs.cup_key IS NOT NULL;

CREATE VIEW api.cup_matches AS
SELECT m.competition_season_id, m.id AS match_id, m.archive_position AS position, k.provider_key AS key, m.source::text AS provider,
  m.match_date AS date, m.status::text AS status, r.name AS round, m.group_name, m.match_number,
  ht.name AS home, hk.provider_key AS home_key, awt.name AS away, ak.provider_key AS away_key,
  m.home_score, m.away_score, m.home_score_90, m.away_score_90, m.home_score_ht, m.away_score_ht,
  m.home_score_et, m.away_score_et, m.home_penalty_score, m.away_penalty_score
FROM core.matches m
JOIN core.competition_seasons cs ON cs.id = m.competition_season_id AND cs.cup_key IS NOT NULL
LEFT JOIN core.provider_ids k ON k.entity_type = 'match' AND k.entity_id = m.id AND k.provider = m.source
LEFT JOIN core.rounds r ON r.id = m.round_id
LEFT JOIN core.teams ht ON ht.id = m.home_team_id
LEFT JOIN core.teams awt ON awt.id = m.away_team_id
LEFT JOIN core.provider_ids hk ON hk.entity_type = 'team' AND hk.entity_id = m.home_team_id AND hk.provider = m.source
LEFT JOIN core.provider_ids ak ON ak.entity_type = 'team' AND ak.entity_id = m.away_team_id AND ak.provider = m.source;
