-- Reference reads of the API (legacy /api/matchdays and /api/standings).

-- Round of each match that has one (legacy matchdays catalogue: name and play-off flag).
CREATE VIEW api.match_rounds AS
SELECT f.match_id, f.id, f.league_id, f.season, f.native_season, f.round_name AS name,
  (coalesce(f.has_playoff, false) OR coalesce(r.stage = 'playoff', false)) AS playoff
FROM api.fixtures f
JOIN core.matches m ON m.id = f.match_id
LEFT JOIN core.rounds r ON r.id = m.round_id
WHERE f.round_name IS NOT NULL;

-- Standing rows: the official table when a source publishes one, else Vega's own
-- (api.standings), with the public ids and crest URL the legacy rows carry.
CREATE VIEW api.standing_rows AS
SELECT s.competition_season_id, se.label AS season, cs.native_label, cs.is_current,
  coalesce(ck.provider_key, 'l_v' || lpad(cs.competition_id::text, 7, '0')) AS league_id, c.name AS league_name,
  s.stage::text AS stage, s.group_name, s.source, s.as_of,
  s.team_public_id AS id, u.provider_key AS uefa_id, cr.source_url AS image_url, s.team_name AS name,
  s.won AS wins, s.drawn AS draws, s.lost AS losses, s.played, s.points, s.goals_for, s.goals_against,
  s.goals_for - s.goals_against AS difference, s.position
FROM api.standings s
JOIN core.competition_seasons cs ON cs.id = s.competition_season_id
JOIN core.seasons se ON se.id = cs.season_id
JOIN core.competitions c ON c.id = cs.competition_id
JOIN core.teams t ON t.id = s.team_id
LEFT JOIN core.assets cr ON cr.id = t.crest_asset_id
LEFT JOIN core.provider_ids u ON u.entity_type = 'team' AND u.entity_id = s.team_id AND u.provider = 'uefa' AND u.is_current
LEFT JOIN core.provider_ids ck ON ck.entity_type = 'competition' AND ck.entity_id = cs.competition_id AND ck.provider = 'pitchapi' AND ck.is_current;
