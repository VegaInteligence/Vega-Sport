-- Group played minutes by the player's age on each match day.
CREATE VIEW api.team_age_minutes AS
SELECT s.season_id, s.team_id, core.age_on(p.birth_date, m.match_date) AS age,
  sum(s.minutes_played)::int AS minutes
FROM core.player_match_stats s
JOIN core.matches m ON m.season_id = s.season_id AND m.id = s.match_id
JOIN core.players p ON p.id = s.player_id
WHERE m.status = 'finished' AND s.minutes_played > 0 AND s.team_id IS NOT NULL
GROUP BY 1, 2, 3;

GRANT SELECT ON api.team_age_minutes TO vega_read;

-- Publish an active expiry only when the stored club and end date agree.
CREATE OR REPLACE VIEW api.player_profiles AS
SELECT p.id AS player_id, api.public_id('player', p.id) AS public_id, p.name, p.short_name, p.position_id, p.country_code,
  p.shirt_number, ph.source_url AS image_url, p.birth_date::text AS birth_date, p.height_cm,
  p.preferred_foot::text AS preferred_foot, contract.end_date::text AS contract_until,
  t.name AS contract_team
FROM core.players p
LEFT JOIN core.assets ph ON ph.id = p.photo_asset_id
LEFT JOIN LATERAL (
  SELECT min(c.team_id) AS team_id, min(c.end_date) AS end_date
  FROM core.player_contracts c
  WHERE c.player_id = p.id AND c.as_of <= current_date
    AND c.start_date <= current_date AND (c.end_date IS NULL OR c.end_date >= current_date)
  HAVING count(DISTINCT c.team_id) = 1 AND count(DISTINCT c.end_date) = 1
    AND count(c.end_date) = count(*)
) contract ON true
LEFT JOIN core.teams t ON t.id = contract.team_id;
