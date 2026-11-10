-- A player's activity map of one match (legacy /api/read/presence, main's
-- relational-player-presence.js): the 16 x 12 grid in the direction his own team attacks,
-- as collected (core.player_heatmaps, cells[y * 16 + x + 1]). The route adds up the maps
-- of the matches it is asked for; updated_at takes part in its validator.
CREATE VIEW api.player_presence AS
SELECT h.season_id, h.match_id, h.player_id, h.team_id, h.actions, h.cells, h.updated_at
FROM core.player_heatmaps h;
