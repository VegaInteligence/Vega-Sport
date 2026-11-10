-- Search reads of the API (legacy /api/search): who plays in a season, and the
-- editions of a club.

-- A player belongs to a season when he has statistics or a line-up entry in it.
CREATE VIEW api.player_seasons AS
SELECT s.player_id, se.label AS season FROM core.player_match_stats s JOIN core.seasons se ON se.id = s.season_id
UNION ALL
SELECT l.player_id, se.label FROM core.lineup_players l JOIN core.seasons se ON se.id = l.season_id;

-- The editions a club plays, with its match count in each (legacy team_seasons).
CREATE VIEW api.team_editions AS
SELECT ts.team_id, se.label AS season, cs.id AS competition_season_id,
  coalesce(ck.provider_key, 'l_v' || lpad(cs.competition_id::text, 7, '0')) AS league_id,
  c.name AS league, c.country_code AS league_country,
  (SELECT count(*) FROM core.matches m WHERE m.competition_season_id = cs.id
     AND ts.team_id IN (m.home_team_id, m.away_team_id))::int AS matches
FROM core.team_seasons ts
JOIN core.competition_seasons cs ON cs.id = ts.competition_season_id
JOIN core.seasons se ON se.id = cs.season_id
JOIN core.competitions c ON c.id = cs.competition_id
LEFT JOIN core.provider_ids ck ON ck.entity_type = 'competition' AND ck.entity_id = cs.competition_id
  AND ck.provider = 'pitchapi' AND ck.is_current;

-- Public ids of players, without the profile joins of api.players.
CREATE VIEW api.player_keys AS
SELECT p.id AS player_id, api.public_id('player', p.id) AS public_id, p.name, ph.source_url AS image_url
FROM core.players p LEFT JOIN core.assets ph ON ph.id = p.photo_asset_id;
