-- What a club's changes are followed by: for each of its finished matches, the score when it
-- made its first substitution and the final score, and its substitutes' minutes, goals and
-- assists. A goal event carries the score before that goal: the score at the change is the one
-- the next goal starts from, or the final score when no goal follows. A match is `complete`
-- when it has as many goal events as goals. One branch per side, so that a club's rows are
-- read by the matches' club indexes.
CREATE VIEW api.team_change_matches AS
SELECT m.season_id, m.home_team_id AS team_key, m.id AS match_key, m.competition_season_id, f.minute AS change_minute,
  coalesce(g.score_home, m.home_score) AS goals_for_then, coalesce(g.score_away, m.away_score) AS goals_against_then,
  m.home_score AS goals_for, m.away_score AS goals_against,
  z.goals = m.home_score + m.away_score AND (g.score_home IS NOT NULL OR g.goal IS NULL) AS complete
FROM core.matches m
JOIN LATERAL (SELECT e.seq, e.minute FROM core.match_events e
              WHERE e.season_id = m.season_id AND e.match_id = m.id AND e.team_id = m.home_team_id AND e.event_type = 'substitution'
              ORDER BY e.seq LIMIT 1) f ON true
LEFT JOIN LATERAL (SELECT true AS goal, e.score_home, e.score_away FROM core.match_events e
                   WHERE e.season_id = m.season_id AND e.match_id = m.id AND e.event_type = 'goal' AND e.seq > f.seq
                   ORDER BY e.seq LIMIT 1) g ON true
LEFT JOIN LATERAL (SELECT count(*) AS goals FROM core.match_events e
                   WHERE e.season_id = m.season_id AND e.match_id = m.id AND e.event_type = 'goal') z ON true
WHERE m.status = 'finished' AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL
UNION ALL
SELECT m.season_id, m.away_team_id AS team_key, m.id AS match_key, m.competition_season_id, f.minute AS change_minute,
  coalesce(g.score_away, m.away_score) AS goals_for_then, coalesce(g.score_home, m.home_score) AS goals_against_then,
  m.away_score AS goals_for, m.home_score AS goals_against,
  z.goals = m.home_score + m.away_score AND (g.score_home IS NOT NULL OR g.goal IS NULL) AS complete
FROM core.matches m
JOIN LATERAL (SELECT e.seq, e.minute FROM core.match_events e
              WHERE e.season_id = m.season_id AND e.match_id = m.id AND e.team_id = m.away_team_id AND e.event_type = 'substitution'
              ORDER BY e.seq LIMIT 1) f ON true
LEFT JOIN LATERAL (SELECT true AS goal, e.score_home, e.score_away FROM core.match_events e
                   WHERE e.season_id = m.season_id AND e.match_id = m.id AND e.event_type = 'goal' AND e.seq > f.seq
                   ORDER BY e.seq LIMIT 1) g ON true
LEFT JOIN LATERAL (SELECT count(*) AS goals FROM core.match_events e
                   WHERE e.season_id = m.season_id AND e.match_id = m.id AND e.event_type = 'goal') z ON true
WHERE m.status = 'finished' AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL;

CREATE VIEW api.team_substitute_matches AS
SELECT m.season_id, m.home_team_id AS team_key, s.player_id AS player_key, s.match_id,
  s.minutes_played AS minutes, coalesce(s.goals, 0) AS goals, coalesce(s.assists, 0) AS assists
FROM core.matches m
JOIN core.lineup_players lp ON lp.season_id = m.season_id AND lp.match_id = m.id AND lp.team_id = m.home_team_id AND lp.is_starter IS FALSE
JOIN core.player_match_stats s ON s.season_id = m.season_id AND s.match_id = m.id AND s.player_id = lp.player_id AND s.minutes_played > 0
WHERE m.status = 'finished'
UNION ALL
SELECT m.season_id, m.away_team_id AS team_key, s.player_id AS player_key, s.match_id,
  s.minutes_played AS minutes, coalesce(s.goals, 0) AS goals, coalesce(s.assists, 0) AS assists
FROM core.matches m
JOIN core.lineup_players lp ON lp.season_id = m.season_id AND lp.match_id = m.id AND lp.team_id = m.away_team_id AND lp.is_starter IS FALSE
JOIN core.player_match_stats s ON s.season_id = m.season_id AND s.match_id = m.id AND s.player_id = lp.player_id AND s.minutes_played > 0
WHERE m.status = 'finished';

GRANT SELECT ON api.team_change_matches, api.team_substitute_matches TO vega_read;
