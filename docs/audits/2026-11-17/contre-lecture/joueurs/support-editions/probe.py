"""Read the keeper block and its deployed inputs by edition and physical/award season."""
def collect(db):
    query="""
    SELECT m.competition_season_id,cs.competition_id,c.name AS competition, g.award_season,
           num_nonnulls(pm.shot_stopping,pm.aerial,pm.depth,pm.distribution) AS blocks,
           pm.shot_stopping IS NULL AS missing_block,
           count(*) AS graded, count(s.goals_prevented) AS measured_prevented,
           count(s.saves) AS measured_saves, count(*) FILTER (WHERE s.saves>0) AS positive_saves,
           count(s.xgot_faced) AS measured_xgot_faced,count(s.goals_conceded) AS measured_conceded,
           count(*) FILTER (WHERE s.xgot_faced IS NOT NULL AND s.goals_conceded IS NOT NULL) AS both_primitives,
           count(*) FILTER (WHERE s.xgot_faced IS NOT NULL AND s.goals_conceded IS NOT NULL AND s.goals_prevented IS NOT NULL) AS three_primitives,
           count(*) FILTER (WHERE abs(s.goals_prevented - (s.xgot_faced-s.goals_conceded))<=0.011) AS three_agree_to_cent,
           count(pm.distribution) AS distribution, count(pm.aerial) AS aerial, count(pm.depth) AS depth,
           count(*) FILTER(WHERE s.touches IS NULL) AS touches_missing, min(g.match_id) AS example_match
    FROM agg.player_match_grades g
    JOIN agg.player_power_matches pm ON (pm.season_id,pm.match_id,pm.player_id)=(g.award_season,g.match_id,g.player_id)
    JOIN core.player_match_stats s ON (s.season_id,s.match_id,s.player_id)=(g.season_id,g.match_id,g.player_id)
    JOIN core.matches m ON (m.season_id,m.id)=(g.season_id,g.match_id)
    JOIN core.competition_seasons cs ON cs.id=m.competition_season_id
    JOIN core.competitions c ON c.id=cs.competition_id
    WHERE g.season_id=%s AND g.role='goalkeeper'
    GROUP BY 1,2,3,4,5,6 ORDER BY 1,4,5,6"""
    with db.transaction():
        db.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        db.execute("SET LOCAL statement_timeout = '150s'")
        meta=db.execute("SELECT current_database(),transaction_timestamp()::text,pg_current_snapshot()::text,current_setting('transaction_read_only')").fetchone()
        assert meta[0]=='vega_v2' and meta[-1]=='on'
        grouped={}
        for year in range(2021,2027):
            cur=db.execute(query,(year,))
            grouped[year]={'columns':[v.name for v in cur.description],'rows':cur.fetchall()}
        return dict(snapshot=meta,groups=grouped)
