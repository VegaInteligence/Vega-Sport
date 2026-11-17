WITH roster AS (SELECT DISTINCT p.team_id,p.player_id,p.season_id FROM core.player_match_stats p WHERE p.team_id IN(811,5390)
AND p.season_id IN(2024,2025,2026) AND p.minutes_played>0)
SELECT r.team_id,r.season_id,r.player_id,p.name,p.short_name,p.birth_date,p.country_code,
 (SELECT string_agg(k.provider::text||':'||k.provider_key,',' ORDER BY k.provider,k.provider_key) FROM core.provider_ids k WHERE k.entity_type='player' AND k.entity_id=r.player_id) AS known_keys
FROM roster r JOIN core.players p ON p.id=r.player_id ORDER BY r.team_id,r.season_id,p.name
