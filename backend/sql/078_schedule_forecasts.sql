-- The matches still to play of an edition with the two strengths and the forecast
-- (agg.match_forecasts, 076): what a club's coming opponents are worth, for the
-- schedule difficulty shown beside the season projection.
CREATE VIEW api.schedule_forecasts AS
SELECT m.competition_season_id, coalesce(m.kickoff_at, m.match_date::timestamptz) AS kickoff_at,
  m.home_team_id AS home_key, m.away_team_id AS away_key,
  f.home_elo::numeric::float8 AS home_elo, f.away_elo::numeric::float8 AS away_elo,
  f.home_win::numeric::float8 AS home_win, f.draw::numeric::float8 AS draw, f.away_win::numeric::float8 AS away_win,
  f.match_id AS match_key
FROM agg.match_forecasts f
JOIN core.matches m ON m.id = f.match_id;

GRANT SELECT ON api.schedule_forecasts TO vega_read;
