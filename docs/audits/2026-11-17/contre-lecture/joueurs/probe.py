"""Group all graded participations by actual observed blocks and inspect the earliest award plus PSL lineage."""
support_sql="""
SELECT g.award_season, g.role,
  CASE WHEN g.role='goalkeeper' THEN num_nonnulls(pm.shot_stopping,pm.aerial,pm.depth,pm.distribution)
       ELSE num_nonnulls(pm.finishing,pm.creation,pm.progression,pm.defence,pm.retention) END AS measured_blocks,
  count(*) AS graded, count(*) FILTER(WHERE pm.role IS DISTINCT FROM g.role) AS missing_or_wrong_power,
  count(*) FILTER(WHERE g.role='goalkeeper' AND pm.shot_stopping IS NULL) AS no_stopping,
  count(*) FILTER(WHERE s.player_id IS NULL) AS no_stats_row,
  count(*) FILTER(WHERE s.player_id IS NOT NULL AND s.touches IS NULL) AS unmeasured_touches
FROM agg.player_match_grades g
LEFT JOIN agg.player_power_matches pm ON pm.season_id=g.award_season AND pm.match_id=g.match_id AND pm.player_id=g.player_id
LEFT JOIN core.player_match_stats s ON s.season_id=%s AND s.match_id=g.match_id AND s.player_id=g.player_id
WHERE g.season_id=%s GROUP BY 1,2,3 ORDER BY 1,2,3
"""
def collect(db):
    def table(q,args=()):
        c=db.execute(q,args);return dict(columns=[x.name for x in c.description],rows=c.fetchall())
    with db.transaction():
        db.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        db.execute("SET LOCAL statement_timeout = '180s'")
        meta=db.execute("SELECT current_database(),transaction_timestamp()::text,pg_current_snapshot()::text,current_setting('transaction_read_only')").fetchone()
        assert meta[0]=='vega_v2' and meta[-1]=='on'
        runs=table("""SELECT id,season_id,method_version,status,started_at::text,finished_at::text,matches,players FROM agg.power_runs
                WHERE kind='players' AND ((season_id=2020 AND status='published') OR id IN (2095,2096,2098)) ORDER BY id""")
        historic=table("""SELECT (SELECT count(*) FROM core.player_match_stats WHERE season_id=2020) AS stats_in_partition_2020,
           (SELECT count(*) FROM agg.player_power_matches WHERE season_id=2020) AS intermediate_award2020,
           (SELECT count(*) FROM agg.player_match_grades WHERE award_season=2020) AS grades_award2020,
           (SELECT count(*) FROM agg.player_power WHERE season_id=2020) AS year_rank_2020""")
        psl=table("""SELECT m.id AS match_id,m.season_id,m.match_date,s.player_id,s.team_id,s.position_id AS stats_pos,
           s.updated_at::text AS stats_last_changed,l.position_id AS lineup_pos,l.updated_at::text AS lineup_last_changed,g.role,g.award_season,g.run_id AS grade_run,
           pm.run_id AS power_run,s.minutes_played,p.shirt_name
           FROM core.matches m JOIN core.player_match_stats s ON s.season_id=m.season_id AND s.match_id=m.id
           JOIN core.players p ON p.id=s.player_id
           LEFT JOIN core.lineup_players l ON l.season_id=m.season_id AND l.match_id=s.match_id AND l.player_id=s.player_id
           LEFT JOIN agg.player_match_grades g ON g.season_id=m.season_id AND g.match_id=s.match_id AND g.player_id=s.player_id
           LEFT JOIN agg.player_power_matches pm ON pm.season_id=extract(year FROM m.match_date-interval '7 months')::int AND pm.match_id=s.match_id AND pm.player_id=s.player_id
           WHERE m.competition_season_id=911 AND m.status='finished' AND s.minutes_played>0 ORDER BY m.id,s.player_id""".replace(',p.shirt_name','').replace('JOIN core.players p ON p.id=s.player_id',''))
        input_columns=table("""SELECT table_schema,table_name,string_agg(column_name,',' ORDER BY ordinal_position) AS fields FROM information_schema.columns WHERE table_schema IN ('raw','ops') AND (table_name ~ '(raw|fetch|ingest|job|bundle|task|collection|attempt|resource)') GROUP BY 1,2 ORDER BY 1,2""")
        grouped={}
        for year in range(2021,2027):
            grouped[str(year)]=table(support_sql,(year,year))
        return dict(snapshot=meta,runs=runs,historic=historic,psl=psl,support=grouped,trace_schema=input_columns)
