WITH wanted AS (
 SELECT m.id FROM core.matches m JOIN core.competition_seasons cs ON cs.id=m.competition_season_id
 WHERE split_part(cs.cup_key,':',2) IN ('afcon','copa-america','gold-cup','asian-cup') AND m.source='international_results'
), facts AS (
 SELECT 'grade'::text AS kind,g.match_id,count(*) AS n,NULL::float8 AS lo,NULL::float8 AS hi
 FROM agg.player_match_grades g JOIN wanted w ON w.id=g.match_id GROUP BY g.match_id
 UNION ALL
 SELECT 'power',g.match_id,count(*),min(g.stakes)::float8,max(g.stakes)::float8
 FROM agg.player_power_matches g JOIN wanted w ON w.id=g.match_id GROUP BY g.match_id
)
SELECT * FROM facts ORDER BY kind,match_id
