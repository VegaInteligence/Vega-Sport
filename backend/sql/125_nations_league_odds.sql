-- The Nations League projected (VI-19, 17 November 2026; forecast.py simulate_nations): each nation's chance of
-- each place of its group joins the stages of agg.cup_stage_odds (122, 124), and each nation's group is read by
-- /api/forecasts/season (League A: « 1 » to « 4 »; Leagues B to D: « B1 » to « D2 »).
ALTER TABLE agg.cup_stage_odds DROP CONSTRAINT cup_stage_odds_stage_check;
ALTER TABLE agg.cup_stage_odds ADD CONSTRAINT cup_stage_odds_stage_check
  CHECK (stage IN ('top8','playoff','out','first','second','third','fourth','r64','r32','r16','qf','sf','final','win'));

CREATE VIEW api.cup_team_groups AS
SELECT DISTINCT m.competition_season_id, v.team_key, m.group_name
FROM core.matches m
CROSS JOIN LATERAL (VALUES (m.home_team_id), (m.away_team_id)) v(team_key)
WHERE m.group_name IS NOT NULL AND v.team_key IS NOT NULL
  AND m.competition_season_id IN (SELECT DISTINCT competition_season_id FROM agg.cup_stage_odds);
GRANT SELECT ON api.cup_team_groups TO vega_read;
