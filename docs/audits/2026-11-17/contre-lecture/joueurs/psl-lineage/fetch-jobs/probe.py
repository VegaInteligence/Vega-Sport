def collect(db):
    def query(sql):
        cur=db.execute(sql)
        return {'columns':[c.name for c in cur.description],'rows':cur.fetchall()}
    with db.transaction():
        db.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        db.execute("SET LOCAL statement_timeout='100s'")
        snapshot=db.execute("SELECT current_database(),transaction_timestamp()::text,pg_current_snapshot()::text,current_setting('transaction_read_only')").fetchone()
        assert snapshot[0]=='vega_v2' and snapshot[3]=='on'
        return {'snapshot':snapshot,
          'jobs':query("""SELECT j.id,j.entity_id,j.lane,j.family,j.state,j.run_after::text,j.updated_at::text,j.attempts,j.priority,j.last_http,j.last_error_code
              FROM ops.fetch_jobs j JOIN core.matches m ON j.entity_type='match' AND m.id=j.entity_id WHERE m.competition_season_id=911 AND j.family='lineups'
              AND (j.updated_at BETWEEN '2026-11-17 22:07:47+00' AND '2026-11-18 07:12:12+00' OR j.run_after BETWEEN '2026-11-17 22:07:47+00' AND '2026-11-18 07:12:12+00')
              ORDER BY j.entity_id,j.id"""),
          'identities':query("""WITH residual AS (
             SELECT DISTINCT s.player_id,s.team_id FROM core.matches m JOIN core.player_match_stats s ON (s.season_id,s.match_id)=(m.season_id,m.id)
             LEFT JOIN agg.player_power_matches p ON(p.season_id,p.match_id,p.player_id)=(extract(year FROM m.match_date-interval '7 months')::int,s.match_id,s.player_id)
             WHERE m.competition_season_id=911 AND m.status='finished' AND s.minutes_played>0 AND p.player_id IS NULL)
             SELECT k.entity_type,k.entity_id,k.provider,k.provider_key,k.is_current FROM core.provider_ids k
             WHERE (k.entity_type='player' AND k.entity_id IN(SELECT player_id FROM residual))
             OR (k.entity_type='team' AND k.entity_id IN(SELECT team_id FROM residual))
             OR (k.entity_type='competition' AND k.entity_id=(SELECT competition_id FROM core.competition_seasons WHERE id=911)) ORDER BY 1,2,3,4""")}
