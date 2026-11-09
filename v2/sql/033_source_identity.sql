-- One team per real team across sources (vega_v2/sources/identity.py): a cup-source team
-- merged into a PitchAPI one keeps the source's spelling as a `source_spelling` name of that
-- source, and the cup reads show it (legacy bodies are the source's own).
CREATE OR REPLACE VIEW api.cup_matches AS
SELECT m.competition_season_id, m.id AS match_id, m.archive_position AS position, k.provider_key AS key, m.source::text AS provider,
  m.match_date AS date, m.status::text AS status, r.name AS round, m.group_name, m.match_number,
  coalesce((SELECT n.name FROM core.entity_names n WHERE n.entity_type = 'team' AND n.entity_id = ht.id AND n.kind = 'source_spelling'
            AND n.source = m.source ORDER BY n.name LIMIT 1), ht.name) AS home,
  hk.provider_key AS home_key,
  coalesce((SELECT n.name FROM core.entity_names n WHERE n.entity_type = 'team' AND n.entity_id = awt.id AND n.kind = 'source_spelling'
            AND n.source = m.source ORDER BY n.name LIMIT 1), awt.name) AS away,
  ak.provider_key AS away_key,
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
