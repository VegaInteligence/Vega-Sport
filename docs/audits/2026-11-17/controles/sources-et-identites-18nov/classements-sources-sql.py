def collect(db):
    def tab(q):
        c=db.execute(q);return {'columns':[x.name for x in c.description],'rows':c.fetchall()}
    with db.transaction():
        db.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        db.execute("SET LOCAL statement_timeout='45s'")
        meta=db.execute("SELECT current_database(),transaction_timestamp()::text,pg_current_snapshot()::text,current_setting('transaction_read_only')").fetchone()
        assert meta[0]=='vega_v2' and meta[-1]=='on'
        sources=tab("""SELECT source::text,count(*) AS rows,count(DISTINCT competition_season_id) AS editions,count(DISTINCT team_id) AS teams FROM core.standings_official GROUP BY 1 ORDER BY 1""")
        editions=tab("""SELECT s.competition_season_id,cs.competition_id,c.name,cs.season_id,count(*) AS rows,count(DISTINCT s.source) AS sources,
                          count(DISTINCT (s.stage,s.group_name)) AS scopes,count(DISTINCT s.team_id) AS teams,
                          min(s.as_of)::text AS min_as_of,max(s.as_of)::text AS max_as_of
                        FROM core.standings_official s JOIN core.competition_seasons cs ON cs.id=s.competition_season_id
                        JOIN core.competitions c ON c.id=cs.competition_id GROUP BY 1,2,3,4 ORDER BY 1""")
        collisions=tab("""WITH k AS (SELECT competition_season_id,stage,group_name,team_id,count(DISTINCT source) AS sources FROM core.standings_official GROUP BY 1,2,3,4)
                          SELECT count(*) AS keys,count(*) FILTER(WHERE sources>1) AS multi_source_keys FROM k""")
        return dict(snapshot=meta,sources=sources,editions=editions,collisions=collisions)
