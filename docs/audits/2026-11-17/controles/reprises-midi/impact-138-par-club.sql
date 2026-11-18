WITH official AS MATERIALIZED (
    SELECT competition_season_id,team_id,max(played) AS played
    FROM core.standings_official WHERE source='sportscore' AND stage IS NULL
    GROUP BY competition_season_id,team_id
), kicked AS MATERIALIZED (
    SELECT m.competition_season_id,s.team_id,count(*) AS kicked
    FROM core.matches m
    LEFT JOIN core.rounds r ON r.id=m.round_id
    CROSS JOIN LATERAL (VALUES(m.home_team_id),(m.away_team_id)) AS s(team_id)
    WHERE m.competition_season_id IN (SELECT competition_season_id FROM official)
      AND m.kickoff_at<=statement_timestamp() AND s.team_id IS NOT NULL
      AND coalesce(r.stage,'regular') IN ('regular','group')
    GROUP BY m.competition_season_id,s.team_id
), summaries AS (
    SELECT o.competition_season_id,count(*) AS teams,
           bool_and(o.played>coalesce(k.kicked,0)+4) AS every_team_ahead_by_max
    FROM official o LEFT JOIN kicked k USING(competition_season_id,team_id) GROUP BY 1
), rendered AS (
    SELECT competition_season_id,source,count(*) AS rows,
           count(DISTINCT team_id) AS teams
    FROM api.standings
    WHERE competition_season_id IN (SELECT DISTINCT competition_season_id FROM core.standings_official)
    GROUP BY competition_season_id,source
)
SELECT e.competition_season_id,s.teams,s.every_team_ahead_by_max,
       (SELECT count(*) FROM agg.standings a WHERE a.competition_season_id=e.competition_season_id) AS vega_rows,
       (SELECT jsonb_object_agg(source,rows ORDER BY source) FROM rendered r WHERE r.competition_season_id=e.competition_season_id) AS currently_served
FROM (SELECT DISTINCT competition_season_id FROM core.standings_official) e
LEFT JOIN summaries s USING(competition_season_id)
ORDER BY 1
