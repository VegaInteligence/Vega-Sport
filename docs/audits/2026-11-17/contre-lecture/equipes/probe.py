"""Raw database columns, single repeatable-read snapshot, one row per stored Elo match."""
from hashlib import sha256
from inspect import getsource

BASE = """
WITH played AS (
 SELECT e.season_id,e.match_id,count(*) AS sides,
  min(e.run_id) AS run_lo,max(e.run_id) AS run_hi,min(e.stakes) AS stake_lo,max(e.stakes) AS stake_hi
 FROM agg.team_elo e GROUP BY e.season_id,e.match_id
)
SELECT p.season_id,p.match_id,p.sides,p.run_lo,p.run_hi,p.stake_lo::float8,p.stake_hi::float8,
 m.match_date,m.is_neutral,m.source,m.home_team_id,m.away_team_id,m.home_score,m.away_score,
 m.competition_season_id,cs.competition_id,c.name,cs.native_label,cs.cup_key,cs.archive_key,
 m.round_id,r.stage::text,r.name,m.home_team_name,m.away_team_name,h.is_national,a.is_national,
 h.country_code,a.country_code
FROM played p LEFT JOIN core.matches m ON (m.season_id,m.id)=(p.season_id,p.match_id)
LEFT JOIN core.competition_seasons cs ON cs.id=m.competition_season_id
LEFT JOIN core.competitions c ON c.id=cs.competition_id
LEFT JOIN core.rounds r ON r.id=m.round_id
LEFT JOIN core.teams h ON h.id=m.home_team_id LEFT JOIN core.teams a ON a.id=m.away_team_id
ORDER BY p.season_id,p.match_id
"""
PLAYER="""
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
"""
ED="""
SELECT cs.id,c.name,cs.cup_key,cs.native_label,m.source,count(m.id) AS fixtures,
 count(m.id) FILTER(WHERE m.status='finished') AS finished,count(m.round_id) AS rounds
FROM core.competition_seasons cs JOIN core.competitions c ON c.id=cs.competition_id
LEFT JOIN core.matches m ON m.competition_season_id=cs.id
WHERE split_part(cs.cup_key,':',2) IN ('afcon','copa-america','gold-cup','asian-cup')
GROUP BY 1,2,3,4,5 ORDER BY 1,5
"""
FINAL="SELECT e.team_id,e.elo_before::float8,e.elo_after::float8,e.expected::float8,e.result::float8,e.stakes::float8,e.run_id FROM agg.team_elo e WHERE e.match_id=739114 ORDER BY e.team_id"
def collect(db):
    from vega import power,normalize
    from vega.sources import cups,open_matchday
    with db.transaction():
        db.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        assert db.execute("SHOW transaction_read_only").fetchone()[0]=='on'
        stamp=db.execute("select statement_timestamp(),pg_current_snapshot()::text,current_database()").fetchone()
        res={}
        for name,query in [('elo',BASE),('international_editions',ED),('player',PLAYER),('copa_final',FINAL)]:
            cursor=db.execute(query)
            res[name]={'columns':[z.name for z in cursor.description],'rows':cursor.fetchall()}
            print('CHECKPOINT',name,len(res[name]['rows']),flush=True)
        runs=db.execute("select id,method_version,matches,finished_at from agg.power_runs where kind='elo' and status='published' order by id").fetchall()
    return dict(at=stamp,run=runs,hashes={m.__name__:sha256(getsource(m).encode()).hexdigest() for m in [power,normalize,cups,open_matchday]},stakes_constants=dict(cups=power.CUP_PRESTIGE,stage=power.STAGE),**res)
