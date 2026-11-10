-- The home's season leaders read agg.player_season_stats (doc "Ce qui change en v2":
-- each block reads a view or an agg table that is already up to date), never every
-- appearance of the season, which made the home read longer than the API's 8 s on the
-- Top 7 scope. One row per player, team and edition, keyed by edition: the read keeps
-- the editions of its scope (api.editions) and sums them.
CREATE VIEW api.home_season_players AS
SELECT s.competition_season_id, s.season_id, s.player_id, s.team_id, s.appearances, s.minutes,
  coalesce(s.goals_sum, 0) AS goals, coalesce(s.assists_sum, 0) AS assists,
  s.xg_sum AS xg, coalesce(s.xg_n, 0) AS xg_matches, s.xa_sum AS xa, coalesce(s.xa_n, 0) AS xa_matches,
  coalesce(s.rating_wsum, 0) AS rating_sum, coalesce(s.rating_w, 0) AS rating_minutes
FROM agg.player_season_stats s;
