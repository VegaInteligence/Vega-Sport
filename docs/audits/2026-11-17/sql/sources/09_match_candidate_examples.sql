WITH m AS (
 SELECT m.id,m.competition_season_id AS ed, coalesce(m.match_date,(m.kickoff_at AT TIME ZONE 'UTC')::date) AS day,m.kickoff_at,m.home_team_id h,m.away_team_id a,m.status,m.source,m.home_score,m.away_score,coalesce(cs.cup_key,cs.archive_key,c.name) AS competition
 FROM core.matches m JOIN core.competition_seasons cs ON cs.id=m.competition_season_id JOIN core.competitions c ON c.id=cs.competition_id
 WHERE m.home_team_id IS NOT NULL AND m.away_team_id IS NOT NULL AND m.home_team_id<>m.away_team_id
), g AS (
 SELECT day,least(h,a) AS team1,greatest(h,a) AS team2,string_agg(DISTINCT source::text,'+' ORDER BY source::text) AS sources,count(DISTINCT ed) AS editions,
 count(DISTINCT (CASE WHEN h<a THEN home_score ELSE away_score END,CASE WHEN h<a THEN away_score ELSE home_score END)) FILTER (WHERE home_score IS NOT NULL AND away_score IS NOT NULL)>1 AS scores_conflict,
 string_agg(DISTINCT status::text,'+' ORDER BY status::text) AS statuses,
 count(DISTINCT kickoff_at) AS distinct_kickoffs,
 jsonb_agg(jsonb_build_array(id,competition,status,source,h,a,home_score,away_score,kickoff_at) ORDER BY id) AS witnesses
 FROM m WHERE day IS NOT NULL GROUP BY 1,2,3 HAVING count(*)>1
), ranked AS (
 SELECT *,row_number() OVER (PARTITION BY sources,(editions=1),statuses,scores_conflict ORDER BY day DESC,team1,team2) AS sample_number,
 count(*) OVER (PARTITION BY sources,(editions=1),statuses,scores_conflict) AS group_total FROM g
)
SELECT sources,editions=1 AS same_edition,statuses,scores_conflict,group_total,day,t1.name AS team1,t2.name AS team2,distinct_kickoffs,witnesses
FROM ranked JOIN core.teams t1 ON t1.id=team1 JOIN core.teams t2 ON t2.id=team2 WHERE sample_number<=2 ORDER BY sources,statuses,scores_conflict,day DESC
