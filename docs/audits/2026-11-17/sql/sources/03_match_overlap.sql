WITH sides AS (
 SELECT m.id,m.source::text AS provider,m.competition_season_id AS edition,m.date_unverified,
 coalesce(m.match_date,(m.kickoff_at AT TIME ZONE 'UTC')::date) AS played,
 coalesce(h.merged_into,h.id) AS h,coalesce(a.merged_into,a.id) AS a,m.home_score AS hs,m.away_score AS aws
 FROM core.matches m JOIN core.teams h ON h.id=m.home_team_id JOIN core.teams a ON a.id=m.away_team_id
 WHERE coalesce(m.match_date,(m.kickoff_at AT TIME ZONE 'UTC')::date) IS NOT NULL
), grouped AS (
 SELECT played, least(h,a) AS lo, greatest(h,a) AS hi, array_agg(DISTINCT provider ORDER BY provider) AS providers,
 count(*) AS rows, count(DISTINCT edition) AS editions, bool_or(coalesce(date_unverified,false)) AS estimated_date,
 count(DISTINCT (CASE WHEN h<a THEN hs ELSE aws END,CASE WHEN h<a THEN aws ELSE hs END)) FILTER (WHERE hs IS NOT NULL AND aws IS NOT NULL) AS known_score_pairs
 FROM sides WHERE h<>a GROUP BY 1,2,3 HAVING count(*)>1
)
SELECT providers, CASE WHEN editions=1 THEN 'same_edition' ELSE 'different_editions' END AS edition_relation,
 estimated_date,count(*) AS same_day_team_pair_groups,sum(rows) AS candidate_rows,
 count(*) FILTER (WHERE known_score_pairs>1) AS conflicting_score_groups
FROM grouped GROUP BY 1,2,3 ORDER BY same_day_team_pair_groups DESC
