-- A player's page gives his rank in Vega's power ranking "among N at his position": the
-- number of ranked players of each role in a season, counted from the ranking's rows.
CREATE VIEW api.power_role_counts AS
SELECT p.season_id, p.role, (count(*) FILTER (WHERE p.role_rank IS NOT NULL))::integer AS ranked
FROM agg.player_power p
GROUP BY p.season_id, p.role;
GRANT SELECT ON api.power_role_counts TO vega_read;
