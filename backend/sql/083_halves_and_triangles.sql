-- Two more readings of data already held. A player's season by half (the statistics the
-- source gives per half), for "does he fade or finish strongly"; and a club's pass network
-- edges over a season, for its most used passing triangle. The network covers a match up to
-- its first substitution. One branch per side, so that a club's rows are read by the
-- matches' club indexes.
CREATE VIEW api.player_half_totals AS
SELECT h.season_id, h.player_id AS player_key, h.period::text AS period, count(*)::integer AS matches,
  sum(h.minutes_played)::integer AS minutes, sum(coalesce(h.goals, 0))::integer AS goals,
  sum(coalesce(h.total_shots, 0))::integer AS shots, sum(coalesce(h.xg, 0))::float8 AS xg,
  sum(coalesce(h.chances_created, 0))::integer AS chances_created, sum(coalesce(h.accurate_passes, 0))::integer AS passes,
  sum(coalesce(h.touches, 0))::integer AS touches, sum(coalesce(h.duels_won, 0))::integer AS duels_won,
  sum(coalesce(h.recoveries, 0))::integer AS recoveries
FROM core.player_match_half_stats h
WHERE h.minutes_played > 0
GROUP BY h.season_id, h.player_id, h.period;

CREATE VIEW api.team_pass_edges AS
SELECT m.season_id, m.home_team_id AS team_key, e.match_id, e.from_player_id, e.to_player_id, coalesce(e.passes, 0) AS passes
FROM core.matches m
JOIN core.pass_network_edges e ON e.season_id = m.season_id AND e.match_id = m.id AND e.team_id = m.home_team_id
UNION ALL
SELECT m.season_id, m.away_team_id AS team_key, e.match_id, e.from_player_id, e.to_player_id, coalesce(e.passes, 0) AS passes
FROM core.matches m
JOIN core.pass_network_edges e ON e.season_id = m.season_id AND e.match_id = m.id AND e.team_id = m.away_team_id;

GRANT SELECT ON api.player_half_totals, api.team_pass_edges TO vega_read;
