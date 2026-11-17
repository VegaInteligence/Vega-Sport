-- Domestic knockout cups projected (VI-19, VI-21, 17 November 2026; forecast.py simulate_knockout):
-- the rounds of 64 and of 32 join the stages of agg.cup_stage_odds (122), and each club's opponent of
-- the round in play (its first match still to play in the edition) is read by /api/forecasts/season.
ALTER TABLE agg.cup_stage_odds DROP CONSTRAINT cup_stage_odds_stage_check;
ALTER TABLE agg.cup_stage_odds ADD CONSTRAINT cup_stage_odds_stage_check
  CHECK (stage IN ('top8','playoff','out','r64','r32','r16','qf','sf','final','win'));

CREATE VIEW api.cup_round_opponents AS
SELECT m.competition_season_id, v.team_key, coalesce(m.match_date, m.kickoff_at::date) AS day,
  coalesce(tp.provider_key, 't_v' || lpad(v.opponent::text, 7, '0')) AS opponent_id, t.name AS opponent_name,
  cr.source_url AS opponent_image, v.home
FROM core.matches m
CROSS JOIN LATERAL (VALUES (m.home_team_id, m.away_team_id, true), (m.away_team_id, m.home_team_id, false)) v(team_key, opponent, home)
JOIN core.teams t ON t.id = v.opponent
LEFT JOIN core.assets cr ON cr.id = t.crest_asset_id
LEFT JOIN core.provider_ids tp ON tp.entity_type = 'team' AND tp.entity_id = v.opponent AND tp.provider = 'pitchapi' AND tp.is_current
WHERE m.status = 'not_started' AND m.home_team_id IS NOT NULL AND m.away_team_id IS NOT NULL
  AND m.competition_season_id IN (SELECT DISTINCT competition_season_id FROM agg.cup_stage_odds);
GRANT SELECT ON api.cup_round_opponents TO vega_read;
