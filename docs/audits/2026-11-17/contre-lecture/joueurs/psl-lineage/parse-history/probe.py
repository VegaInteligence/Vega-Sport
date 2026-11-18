def collect(db):
    def query(sql):
        c=db.execute(sql)
        return dict(columns=[v.name for v in c.description],rows=c.fetchall())
    with db.transaction():
        db.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
        db.execute("SET LOCAL statement_timeout='90s'")
        meta=db.execute("SELECT current_database(),transaction_timestamp()::text,pg_current_snapshot()::text,current_setting('transaction_read_only')").fetchone()
        assert meta[0]=='vega_v2' and meta[3]=='on'
        tests={'snapshot':meta}
        tests['parse']=query("""SELECT p.id,p.entity_id,p.family,p.error_code,p.at::text FROM ops.parse_failures p
           JOIN core.matches m ON p.entity_type='match' AND m.id=p.entity_id WHERE m.competition_season_id=911 AND p.family IN ('lineups','player_stats')
           AND p.at BETWEEN '2026-11-09 00:00:00+00' AND '2026-11-18 07:12:12+00' ORDER BY p.at,p.id""")
        tests['old_fetch']=query("""SELECT p.id,p.entity_id,p.family,p.http_status,p.error_code,p.fetched_at::text FROM ops.fetch_log p
           JOIN core.matches m ON p.entity_type='match' AND m.id=p.entity_id WHERE m.competition_season_id=911 AND p.family IN ('lineups','player_stats')
           AND p.fetched_at BETWEEN '2026-11-09' AND '2026-11-17 22:07:47+00' ORDER BY p.fetched_at,p.id""")
        return tests
