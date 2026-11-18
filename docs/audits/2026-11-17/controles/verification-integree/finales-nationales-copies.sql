WITH eligible AS MATERIALIZED (
  SELECT team_key FROM api.nation_list((SELECT max(season_id)::smallint FROM api.season_keys))
  WHERE regexp_replace(name,'^\s+|\s+$','','g') !~ '^(?:[A-L][1-4]|(?:Winner|Runner-up|Loser|3rd|Third) (?:Group|Match)\y.*)$'
), raw AS MATERIALIZED (
  SELECT m.id, m.season_id, m.competition_season_id, m.source::text AS provider, m.status::text AS status,
    m.home_team_id, m.away_team_id, m.home_score, m.away_score,
    coalesce(m.match_date::text,m.kickoff_at::date::text,'m'||m.id::text) daykey,
    least(m.home_team_id,m.away_team_id) lo, greatest(m.home_team_id,m.away_team_id) hi,
    cs.cup_key IS NULL AND cs.archive_key IS NULL collected
  FROM core.matches m JOIN core.competition_seasons cs ON cs.id=m.competition_season_id
  WHERE m.home_team_id IN (SELECT team_key FROM eligible) OR m.away_team_id IN (SELECT team_key FROM eligible)
), groups AS (
  SELECT daykey,lo,hi,count(*) copies,
    array_agg(id ORDER BY collected DESC,(home_score IS NOT NULL) DESC,id) AS actual_order,
    count(*) FILTER(WHERE status='finished' AND home_score IS NOT NULL AND away_score IS NOT NULL) AS complete_finals
  FROM raw GROUP BY daykey,lo,hi
), records AS (
  SELECT g.daykey,g.lo,g.hi,g.copies,g.complete_finals,g.actual_order,
    p.id,p.status,p.home_score,p.away_score,p.collected,p.provider
  FROM groups g JOIN raw p ON p.id=g.actual_order[1] AND p.daykey=g.daykey AND p.lo=g.lo AND p.hi=g.hi
)
SELECT 'population' AS kind, jsonb_build_object('eligible_nations',(SELECT count(*) FROM eligible),'logical',count(*),
   'multiple',count(*) FILTER(WHERE copies>1),'observations',sum(copies),
   'multiple_with_finished_scores',count(*) FILTER(WHERE copies>1 AND complete_finals>0),
   'native_masks_finished_pair',count(*) FILTER(WHERE copies>1 AND collected AND complete_finals>0 AND
         (status<>'finished' OR home_score IS NULL OR away_score IS NULL))) AS evidence FROM records
UNION ALL
SELECT 'masked_pair',to_jsonb(r) FROM records r WHERE copies>1 AND collected AND complete_finals>0 AND
    (status<>'finished' OR home_score IS NULL OR away_score IS NULL)
UNION ALL
SELECT 'world_cup_final_date',to_jsonb(m) FROM raw m WHERE m.daykey IN ('1982-07-11','1998-07-12')
ORDER BY 1,2
