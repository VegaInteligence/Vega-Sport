-- One scoring per match (VI-23 stage 8, docs/calculs/09-audit-2026-11/FAILURE_MODES.md §17): the
-- own goals in each side's score and each side's penalty attempts, read by the calculator (the
-- club indicators finishing, keeper, conversion and xG per shot) and, through api.match_scoring,
-- by every match record of the read API, so the site measures every club of a league alike.
--
-- Measured on production (17 November 2026, read-only):
--   - a goal shot's own-goal flag is TRUE or NULL, never FALSE (2026: 991 TRUE, 31,632 NULL), so
--     the shots cannot say a goal is ordinary;
--   - goal events carry an explicit flag since 2021, and their team is the side credited, own goals
--     included (16,879 of 16,880 goals and 475 of 475 own goals where the running score shows it);
--   - their running score is sometimes the score after the goal, sometimes the score before it
--     (16,880 and 15,898 goals in 2026): it is not read.
--
-- Own goals: classified when the events were read and the match's goal events outside the shoot-out
-- each carry their flag, each belong to the home or the away team, and count exactly each side's
-- score; a side's own goals are its credited events flagged TRUE. Otherwise both are NULL. A
-- goalless match whose events were read classifies 0 and 0.
--
-- Penalty attempts of a side: known when the own goals are, the shots were read and, the shoot-out
-- left out, every shot is the home or the away team's, each side's shots other than own goals number
-- its total_shots, the goal shots reproduce both scores (an own-goal shot carries its scorer's team and
-- counts for the other side), the own-goal shots agree with the events' own goals, and every attempt
-- of that side has a situation. Otherwise NULL. NULL is unknown; 0 is established none.
--
-- A plain view over core.matches: each match's three aggregates are correlated subqueries, so a read
-- of one match (or of one competition's matches) touches only their events, shots and statistics.
SET LOCAL lock_timeout = '3s';

CREATE VIEW agg.match_scoring AS
SELECT m.season_id, m.id AS match_id,
  CASE WHEN ev.classified THEN ev.own_home END AS own_goals_for_home,
  CASE WHEN ev.classified THEN ev.own_away END AS own_goals_for_away,
  CASE WHEN ev.classified AND sh.reconciled AND sh.unclassified_home = 0 THEN sh.penalties_home END AS penalties_home,
  CASE WHEN ev.classified AND sh.reconciled AND sh.unclassified_away = 0 THEN sh.penalties_away END AS penalties_away
FROM core.matches m
LEFT JOIN core.match_coverage c ON c.season_id = m.season_id AND c.match_id = m.id
CROSS JOIN LATERAL (
  SELECT g.*,
    (c.events = 'ok' AND g.unflagged = 0 AND g.other_teams = 0
     AND g.home_goals = m.home_score AND g.away_goals = m.away_score) IS TRUE AS classified
  FROM (
    SELECT count(*) FILTER (WHERE e.is_own_goal IS NULL) AS unflagged,
      count(*) FILTER (WHERE e.team_id IS DISTINCT FROM m.home_team_id AND e.team_id IS DISTINCT FROM m.away_team_id) AS other_teams,
      count(*) FILTER (WHERE e.team_id = m.home_team_id) AS home_goals,
      count(*) FILTER (WHERE e.team_id = m.away_team_id) AS away_goals,
      (count(*) FILTER (WHERE e.team_id = m.home_team_id AND e.is_own_goal))::integer AS own_home,
      (count(*) FILTER (WHERE e.team_id = m.away_team_id AND e.is_own_goal))::integer AS own_away
    FROM core.match_events e
    WHERE e.season_id = m.season_id AND e.match_id = m.id AND e.event_type = 'goal'
      AND e.period IS DISTINCT FROM 'penalties'  -- shoot-out kicks are not goals
  ) g
) ev
CROSS JOIN LATERAL (
  SELECT s.penalties_home::integer, s.penalties_away::integer, s.unclassified_home, s.unclassified_away,
    (c.shots = 'ok' AND s.other_teams = 0
     AND s.shots_home = t.total_home AND s.shots_away = t.total_away
     AND s.goals_home = m.home_score AND s.goals_away = m.away_score
     AND s.own_shots_for_home = ev.own_home AND s.own_shots_for_away = ev.own_away) IS TRUE AS reconciled
  FROM (
    SELECT count(*) FILTER (WHERE x.team_id IS DISTINCT FROM m.home_team_id AND x.team_id IS DISTINCT FROM m.away_team_id) AS other_teams,
      count(*) FILTER (WHERE x.team_id = m.home_team_id AND x.is_own_goal IS NOT TRUE) AS shots_home,
      count(*) FILTER (WHERE x.team_id = m.away_team_id AND x.is_own_goal IS NOT TRUE) AS shots_away,
      count(*) FILTER (WHERE x.outcome = 'goal' AND ((x.team_id = m.home_team_id AND x.is_own_goal IS NOT TRUE)
                                                  OR (x.team_id = m.away_team_id AND x.is_own_goal))) AS goals_home,
      count(*) FILTER (WHERE x.outcome = 'goal' AND ((x.team_id = m.away_team_id AND x.is_own_goal IS NOT TRUE)
                                                  OR (x.team_id = m.home_team_id AND x.is_own_goal))) AS goals_away,
      count(*) FILTER (WHERE x.team_id = m.away_team_id AND x.is_own_goal) AS own_shots_for_home,
      count(*) FILTER (WHERE x.team_id = m.home_team_id AND x.is_own_goal) AS own_shots_for_away,
      count(*) FILTER (WHERE x.team_id = m.home_team_id AND x.is_own_goal IS NOT TRUE AND x.situation = 'penalty') AS penalties_home,
      count(*) FILTER (WHERE x.team_id = m.away_team_id AND x.is_own_goal IS NOT TRUE AND x.situation = 'penalty') AS penalties_away,
      count(*) FILTER (WHERE x.team_id = m.home_team_id AND x.is_own_goal IS NOT TRUE AND x.situation IS NULL) AS unclassified_home,
      count(*) FILTER (WHERE x.team_id = m.away_team_id AND x.is_own_goal IS NOT TRUE AND x.situation IS NULL) AS unclassified_away
    FROM core.shots x
    WHERE x.season_id = m.season_id AND x.match_id = m.id AND x.period IS DISTINCT FROM 'penalties'
  ) s
  CROSS JOIN (
    SELECT max(ts.total_shots) FILTER (WHERE ts.team_id = m.home_team_id) AS total_home,
      max(ts.total_shots) FILTER (WHERE ts.team_id = m.away_team_id) AS total_away
    FROM core.team_match_stats ts
    WHERE ts.season_id = m.season_id AND ts.match_id = m.id AND ts.period = 'all'
  ) t
) sh
WHERE m.status = 'finished' AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL;

COMMENT ON VIEW agg.match_scoring IS
  'One scoring per match (VI-23 stage 8): own goals in each side''s score from the goal events (their team is the side credited), penalty attempts per side from the reconciled shot set; NULL when not established.';

CREATE VIEW api.match_scoring AS
SELECT season_id, match_id, own_goals_for_home, own_goals_for_away, penalties_home, penalties_away
FROM agg.match_scoring;

GRANT SELECT ON agg.match_scoring TO vega_calc;
GRANT SELECT ON api.match_scoring TO vega_read;
