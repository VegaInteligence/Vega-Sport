-- The score at a club's first change (082) read from the goals themselves. The running
-- score the source writes on a goal event is the score before the goal in some matches and
-- after it in others; the team a goal event is credited to gives the final score in
-- 98.9 % of the season's matches. The score at the change is therefore the count of the
-- goal events that precede it, by team, and a match is `complete` when the goal events of
-- each side add up to its final score.
CREATE OR REPLACE VIEW api.team_change_matches AS
SELECT m.season_id, m.home_team_id AS team_key, m.id AS match_key, m.competition_season_id, f.minute AS change_minute,
  g.scored::smallint AS goals_for_then, g.conceded::smallint AS goals_against_then,
  m.home_score AS goals_for, m.away_score AS goals_against,
  z.scored = m.home_score AND z.conceded = m.away_score AS complete
FROM core.matches m
JOIN LATERAL (SELECT e.seq, e.minute FROM core.match_events e
              WHERE e.season_id = m.season_id AND e.match_id = m.id AND e.team_id = m.home_team_id AND e.event_type = 'substitution'
              ORDER BY e.seq LIMIT 1) f ON true
CROSS JOIN LATERAL (SELECT count(*) FILTER (WHERE e.team_id = m.home_team_id) AS scored,
                      count(*) FILTER (WHERE e.team_id = m.away_team_id) AS conceded
                    FROM core.match_events e
                    WHERE e.season_id = m.season_id AND e.match_id = m.id AND e.event_type = 'goal' AND e.seq < f.seq) g
CROSS JOIN LATERAL (SELECT count(*) FILTER (WHERE e.team_id = m.home_team_id) AS scored,
                      count(*) FILTER (WHERE e.team_id = m.away_team_id) AS conceded
                    FROM core.match_events e
                    WHERE e.season_id = m.season_id AND e.match_id = m.id AND e.event_type = 'goal') z
WHERE m.status = 'finished' AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL
UNION ALL
SELECT m.season_id, m.away_team_id AS team_key, m.id AS match_key, m.competition_season_id, f.minute AS change_minute,
  g.scored::smallint AS goals_for_then, g.conceded::smallint AS goals_against_then,
  m.away_score AS goals_for, m.home_score AS goals_against,
  z.scored = m.away_score AND z.conceded = m.home_score AS complete
FROM core.matches m
JOIN LATERAL (SELECT e.seq, e.minute FROM core.match_events e
              WHERE e.season_id = m.season_id AND e.match_id = m.id AND e.team_id = m.away_team_id AND e.event_type = 'substitution'
              ORDER BY e.seq LIMIT 1) f ON true
CROSS JOIN LATERAL (SELECT count(*) FILTER (WHERE e.team_id = m.away_team_id) AS scored,
                      count(*) FILTER (WHERE e.team_id = m.home_team_id) AS conceded
                    FROM core.match_events e
                    WHERE e.season_id = m.season_id AND e.match_id = m.id AND e.event_type = 'goal' AND e.seq < f.seq) g
CROSS JOIN LATERAL (SELECT count(*) FILTER (WHERE e.team_id = m.away_team_id) AS scored,
                      count(*) FILTER (WHERE e.team_id = m.home_team_id) AS conceded
                    FROM core.match_events e
                    WHERE e.season_id = m.season_id AND e.match_id = m.id AND e.event_type = 'goal') z
WHERE m.status = 'finished' AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL;
