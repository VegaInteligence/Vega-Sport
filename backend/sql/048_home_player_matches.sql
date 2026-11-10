-- The home's player rows of a match, lean: the statistics row with the player's name and
-- photo and the team, nothing else (no line-up union, coverage or provider ids per row).
-- The week's performances (about 3,000 rows on the Top 7 scope) and the leaders' latest
-- clubs read it; the full appearance records (api.player_appearances) are read for the
-- dozen selected only. Same casts as api.player_appearances.
CREATE VIEW api.home_player_matches AS
SELECT s.season_id, s.match_id, s.player_id, s.team_id, t.name AS team, t.is_national AS team_is_national,
  p.name AS player_name, ph.source_url AS image_url,
  s.minutes_played::float8 AS minutes, s.rating::numeric::float8 AS rating, s.goals::float8 AS goals,
  s.assists::float8 AS assists, s.xg::numeric::float8 AS xg, s.xa::numeric::float8 AS xa
FROM core.player_match_stats s
JOIN core.players p ON p.id = s.player_id
LEFT JOIN core.assets ph ON ph.id = p.photo_asset_id
LEFT JOIN core.teams t ON t.id = s.team_id;
