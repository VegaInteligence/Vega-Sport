"""READ ONLY. Every dataset is scoped by edition 911 or its exact foreign keys/award rows."""
def collect(db):
    def query(sql):
        cur=db.execute(sql)
        return {'columns':[c.name for c in cur.description],'rows':cur.fetchall()}
    match="SELECT id FROM core.matches WHERE competition_season_id=911"
    with db.transaction():
        db.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
        db.execute("SET LOCAL statement_timeout='100s'")
        meta=db.execute("SELECT current_database(),transaction_timestamp()::text,pg_current_snapshot()::text,current_setting('transaction_read_only')").fetchone()
        assert meta[0]=='vega_v2' and meta[3]=='on'
        results={'snapshot':meta}
        results['edition']=query("""SELECT cs.*,c.name AS competition_name,s.label AS local_season FROM core.competition_seasons cs
             JOIN core.competitions c ON c.id=cs.competition_id JOIN core.seasons s ON s.id=cs.season_id WHERE cs.id=911""")
        results['match_keys']=query("""SELECT m.id,m.season_id,m.status,m.match_date,m.home_team_id,m.away_team_id,k.provider,k.provider_key,k.is_current
             FROM core.matches m LEFT JOIN core.provider_ids k ON k.entity_type='match' AND k.entity_id=m.id
             WHERE m.competition_season_id=911 ORDER BY m.id,k.provider,k.provider_key""")
        results['fetch_interval']=query(f"""SELECT id,job_id,family,entity_id,http_status,error_code,request_id,duration_ms,fetched_at::text,
             parser_version,response_sha256::text,rows_written,is_empty FROM ops.fetch_log WHERE fetched_at >= '2026-11-17 22:07:47+00'
             AND fetched_at < '2026-11-18 07:12:12+00' AND ((entity_type='match' AND entity_id IN ({match})) OR competition_season_id=911)
             ORDER BY fetched_at,id""")
        results['fetch_counts']=query(f"""SELECT fetched_at::date AS day,family,http_status,count(*) AS n,count(DISTINCT entity_id) AS targets,
             min(fetched_at)::text,max(fetched_at)::text FROM ops.fetch_log WHERE fetched_at>='2026-11-09' AND fetched_at< '2026-11-18 07:12:12+00'
             AND ((entity_type='match' AND entity_id IN ({match})) OR competition_season_id=911)
             AND family IN ('lineups','player_stats','league_matches') GROUP BY 1,2,3 ORDER BY 1,2,3""")
        results['state']=query(f"""SELECT match_id,family,status,fingerprint::text,last_success_at::text,last_attempt_at::text,updated_at::text
             FROM ops.family_state WHERE family IN('lineups','player_stats') AND match_id IN ({match}) ORDER BY match_id,family""")
        results['lineups']=query(f"""SELECT l.match_id,l.updated_at::text,count(*) AS slots,count(*) FILTER(WHERE l.position_id IS NOT NULL) AS known,
                    count(*) FILTER(WHERE l.position_id=11 OR l.position_id BETWEEN 30 AND 119) AS detailed,
                    count(*) FILTER(WHERE l.is_starter) AS starters
             FROM core.lineup_players l WHERE l.season_id=(SELECT season_id FROM core.competition_seasons WHERE id=911) AND l.match_id IN ({match})
             GROUP BY 1,2 ORDER BY 1,2""")
        results['coverage']=query(f"""SELECT cs.id,m.status,count(DISTINCT m.id) AS games,count(s.player_id) AS stats,
            count(s.player_id) FILTER(WHERE s.minutes_played>0) AS played,
            count(s.player_id) FILTER(WHERE s.minutes_played>0 AND s.team_id IS DISTINCT FROM m.home_team_id AND s.team_id IS DISTINCT FROM m.away_team_id) AS outside,
            count(s.player_id) FILTER(WHERE s.minutes_played>0 AND s.team_id IS NULL) AS null_team
            FROM core.competition_seasons cs JOIN core.matches m ON m.competition_season_id=cs.id
            LEFT JOIN core.player_match_stats s ON (s.season_id,s.match_id)=(m.season_id,m.id) WHERE cs.id=911 GROUP BY 1,2 ORDER BY 2""")
        results['runs']=query(f"""WITH ids AS (
            SELECT DISTINCT g.run_id FROM agg.player_match_grades g WHERE g.season_id=(SELECT season_id FROM core.competition_seasons WHERE id=911) AND g.match_id IN ({match})
            UNION SELECT DISTINCT p.run_id FROM agg.player_power_matches p WHERE p.season_id=(SELECT season_id FROM core.competition_seasons WHERE id=911) AND p.match_id IN ({match})
            UNION SELECT id FROM agg.power_runs WHERE kind='players' AND season_id=(SELECT season_id FROM core.competition_seasons WHERE id=911)
                        AND started_at BETWEEN '2026-11-17 14:00:00+00' AND '2026-11-18 07:12:12+00')
            SELECT id,season_id,kind,method_version,status,started_at::text,finished_at::text,matches,players FROM agg.power_runs WHERE id IN (SELECT run_id FROM ids) ORDER BY id""")
        results['pending_current']=query("""SELECT s.season_id,s.match_id,s.player_id,s.team_id,m.match_date,s.minutes_played,s.position_id,l.position_id,s.touches,s.goals_prevented,
            s.updated_at::text,l.updated_at::text FROM core.matches m JOIN core.player_match_stats s ON (s.season_id,s.match_id)=(m.season_id,m.id)
            LEFT JOIN core.lineup_players l ON (l.season_id,l.match_id,l.player_id)=(s.season_id,s.match_id,s.player_id)
            LEFT JOIN agg.player_power_matches pm ON (pm.season_id,pm.match_id,pm.player_id)=(extract(year FROM m.match_date-interval '7 months')::int,s.match_id,s.player_id)
            WHERE m.competition_season_id=911 AND m.status='finished' AND s.minutes_played>0 AND pm.player_id IS NULL ORDER BY s.match_id,s.player_id""")
        return results
