-- One key per side of a cup match. A team known to a cup source under several spellings
-- holds one key per spelling once sources/identity.py has merged them into one team
-- (core.provider_ids: several keys of one provider, one of them current). api.cup_matches
-- joined every key of the match's source, so such a team's matches came out once per
-- spelling. Each side now takes one key: the one its own spelling makes ('name:' and the
-- name the source gave for that match, 034) when the source keys teams by name, else the
-- team's current key of that source.
CREATE OR REPLACE VIEW api.cup_matches AS
SELECT m.competition_season_id, m.id AS match_id, m.archive_position AS position, k.provider_key AS key, m.source::text AS provider,
  m.match_date AS date, m.status::text AS status, r.name AS round, m.group_name, m.match_number,
  coalesce(m.home_team_name, ht.name) AS home, hk.provider_key AS home_key,
  coalesce(m.away_team_name, awt.name) AS away, ak.provider_key AS away_key,
  m.home_score, m.away_score, m.home_score_90, m.away_score_90, m.home_score_ht, m.away_score_ht,
  m.home_score_et, m.away_score_et, m.home_penalty_score, m.away_penalty_score
FROM core.matches m
JOIN core.competition_seasons cs ON cs.id = m.competition_season_id AND cs.cup_key IS NOT NULL
LEFT JOIN core.provider_ids k ON k.entity_type = 'match' AND k.entity_id = m.id AND k.provider = m.source
LEFT JOIN core.rounds r ON r.id = m.round_id
LEFT JOIN core.teams ht ON ht.id = m.home_team_id
LEFT JOIN core.teams awt ON awt.id = m.away_team_id
LEFT JOIN LATERAL (
  SELECT p.provider_key FROM core.provider_ids p
  WHERE p.entity_type = 'team' AND p.entity_id = m.home_team_id AND p.provider = m.source
  ORDER BY (p.provider_key = 'name:' || m.home_team_name) DESC NULLS LAST, p.is_current DESC, p.provider_key LIMIT 1
) hk ON true
LEFT JOIN LATERAL (
  SELECT p.provider_key FROM core.provider_ids p
  WHERE p.entity_type = 'team' AND p.entity_id = m.away_team_id AND p.provider = m.source
  ORDER BY (p.provider_key = 'name:' || m.away_team_name) DESC NULLS LAST, p.is_current DESC, p.provider_key LIMIT 1
) ak ON true;
