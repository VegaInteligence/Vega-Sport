"""Run deployed refresh_players and its untouched SQL on a disposable local PG18, first valid then third-team then repaired."""
import argparse
from datetime import date
import hashlib
import io
import json
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import tarfile
import tempfile

import psycopg
sys.dont_write_bytecode=True
root=Path(__file__).resolve().parent
commit='8018e0836ca0f32e8b2eb51fc2847154abff7f13'
p=argparse.ArgumentParser()
p.add_argument('--repo',required=True,type=Path)
p.add_argument('--pg-bin',required=True,type=Path)
p.add_argument('--out',type=Path,default=root/'double-side-run')
a=p.parse_args();out=a.out.resolve()
assert out.is_relative_to(root)
out.mkdir(exist_ok=False)
def report(name,data):
    (out/name).write_text(json.dumps(data,indent=2,default=str,ensure_ascii=False)+'\n')
def dbstate(db):
    data={}
    for key,q in {
       'runs':"SELECT id,status,matches,players FROM agg.power_runs WHERE kind='players' AND season_id=2025 ORDER BY id",
       'intermediates':"SELECT season_id,match_id,player_id,team_id,role,minutes,opponent_elo,run_id FROM agg.player_power_matches WHERE season_id=2025 ORDER BY match_id,player_id",
       'grades':"SELECT season_id,match_id,player_id,role,run_id FROM agg.player_match_grades WHERE season_id=2025 ORDER BY match_id,player_id",
       'year_table':"SELECT season_id,player_id,run_id FROM agg.player_power WHERE season_id=2025 ORDER BY player_id",
    }.items():data[key]=db.execute(q).fetchall()
    # Check every value (including scores and all grade reference tables) in the complete local aggregate schema.
    from psycopg import sql
    hashes={}
    for (rel,) in db.execute("SELECT tablename FROM pg_tables WHERE schemaname='agg' ORDER BY tablename"):
        statement=sql.SQL("SELECT to_jsonb(t)::text FROM agg.{} AS t ORDER BY to_jsonb(t)::text").format(sql.Identifier(rel))
        encoded=[row[0] for row in db.execute(statement)]
        if encoded:
            hashes[rel]={'rows':len(encoded),'sha256':hashlib.sha256(('\n'.join(encoded)+'\n').encode()).hexdigest()}
    data['all_nonempty_aggregate_tables']=hashes
    return data
def project(db,power):
    cur=db.execute(power.PLAYER_MATCHES,([2025,2026],date(2025,8,1),date(2026,8,1)))
    return [{k:r[k] for k in ('edition','match_id','player_id','team_id','position_id','own_elo','opponent_elo')} for v in cur for r in [dict(zip((i.name for i in cur.description),v))] if r['match_id']==500]
def check_projection(v):
    return sorted((r['player_id'],r['own_elo'],r['opponent_elo']) for r in v)
with tempfile.TemporaryDirectory(dir=out) as tmp:
    t=Path(tmp);src=t/'src';src.mkdir();dbfiles=t/'data'
    blob=subprocess.check_output(['git','-C',str(a.repo),'archive',commit,'backend/vega','backend/sql'])
    with tarfile.open(fileobj=io.BytesIO(blob)) as arc:
        arc.extractall(src,filter='data')
    sys.path.insert(0,str(src/'backend'))
    from vega import power,store
    source={str(q.relative_to(src)):hashlib.sha256(q.read_bytes()).hexdigest() for q in [src/'backend/vega/power.py',src/'backend/vega/store.py',src/'backend/sql/032_power_rankings.sql']}
    report('source.json',{'git':commit,'files':source,'reader_sha256':hashlib.sha256(power.PLAYER_MATCHES.encode()).hexdigest()})
    (out/'deployed-reader.sql').write_text(power.PLAYER_MATCHES)
    pwd=t/'pass';secret=secrets.token_hex(32);pwd.write_text(secret+'\n');pwd.chmod(0o600)
    def pg(tool,*params):
        with (out/'pg.log').open('ab') as f:
            subprocess.run([str(a.pg_bin/tool),*map(str,params)],stdout=f,stderr=subprocess.STDOUT,check=True)
    with socket.socket() as sock:
        sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
    pg('initdb','-D',dbfiles,'--auth-local=trust','--auth-host=scram-sha-256','-U','audit','--pwfile',pwd,'--locale=C','-E','UTF8')
    enabled=False
    try:
        pg('pg_ctl','-D',dbfiles,'-l',out/'postgres-server.log','-o',f"-c listen_addresses=127.0.0.1 -p {port} -c unix_socket_directories='' -c fsync=off",'-w','start');enabled=True
        opts=dict(host='127.0.0.1',port=port,user='audit',password=secret,autocommit=True)
        with psycopg.connect(dbname='postgres',**opts) as ctl:
            ctl.execute("CREATE DATABASE psl_lineage_local")
        with psycopg.connect(dbname='psl_lineage_local',**opts) as db:
            version,address,name=db.execute("SELECT current_setting('server_version'),current_setting('listen_addresses'),current_database()").fetchone()
            assert version.startswith('18.') and address=='127.0.0.1' and name=='psl_lineage_local'
            store.migrate(db)
            with db.transaction():
                store.Store(db).season('2025/2026')
                db.execute("INSERT INTO core.competitions(id,name,kind) VALUES (195,'Test league','league')")
                db.execute("INSERT INTO core.competition_seasons(id,competition_id,season_id,native_label) VALUES (911,195,2025,'2025/2026')")
                db.execute("INSERT INTO core.teams(id,name,is_national) VALUES (10,'Home',false),(20,'Away',false),(30,'Third club',false)")
                db.execute("INSERT INTO core.players(id,name) VALUES (1001,'Sample home'),(1002,'Sample away')")
                db.execute("INSERT INTO core.matches(id,competition_season_id,season_id,source,status,home_team_id,away_team_id,home_score,away_score,match_date) VALUES (500,911,2025,'pitchapi','finished',10,20,1,0,'2025-11-09')")
                db.execute("INSERT INTO core.match_coverage(season_id,match_id,player_stats,events) VALUES (2025,500,'ok','ok')")
                db.execute("INSERT INTO core.player_match_stats(season_id,match_id,team_id,player_id,minutes_played,position_id,goals,touches,npxg) VALUES (2025,500,10,1001,90,99,1,50,0.7),(2025,500,20,1002,90,99,0,50,0.4)")
                er=db.execute("INSERT INTO agg.power_runs(kind,method_version,status) VALUES('elo','local-fixture','published') RETURNING id").fetchone()[0]
                db.execute("INSERT INTO agg.team_elo(match_id,team_id,season_id,elo_before,elo_after,expected,result,run_id) VALUES (500,10,2025,1500,1505,0.57,1,%s),(500,20,2025,1440,1435,0.43,0,%s)",(er,er))
                # Fifteen additional fixtures put the two footballers above the deployed 30-match role-reference minimum.
                db.execute("""INSERT INTO core.matches(id,competition_season_id,season_id,source,status,home_team_id,away_team_id,home_score,away_score,match_date)
                    SELECT 500+i,911,2025,'pitchapi','finished',10,20,1,0,'2025-11-09'::date+i FROM generate_series(1,15) i""")
                db.execute("""INSERT INTO core.match_coverage(season_id,match_id,player_stats,events)
                    SELECT 2025,500+i,'ok','ok' FROM generate_series(1,15) i""")
                db.execute("""INSERT INTO core.player_match_stats(season_id,match_id,team_id,player_id,minutes_played,position_id,goals,touches,npxg)
                    SELECT 2025,500+i,t,p,90,99,g,50,base+i*.01 FROM generate_series(1,15) i
                    CROSS JOIN (VALUES(10,1001,1,.7),(20,1002,0,.4)) v(t,p,g,base)""")
                db.execute("""INSERT INTO agg.team_elo(match_id,team_id,season_id,elo_before,elo_after,expected,result,run_id)
                    SELECT 500+i,t,2025,score,score,expected,result,%s FROM generate_series(1,15) i
                    CROSS JOIN (VALUES(10,1500,.57,1),(20,1440,.43,0)) v(t,score,expected,result)""",(er,))
            baseline=project(db,power)
            assert check_projection(baseline)==[(1001,1500,1440),(1002,1440,1500)]
            power.refresh_players(db,2025)
            before=dbstate(db)
            assert len(before['runs'])==1 and len(before['intermediates'])==32 and len(before['grades'])==32 and len(before['year_table'])==2
            db.execute("UPDATE core.player_match_stats SET team_id=30 WHERE season_id=2025 AND match_id=500 AND player_id=1001")
            wrong=project(db,power)
            assert check_projection(wrong)==[(1001,None,1440),(1001,None,1500),(1002,1440,1500)]
            attempts=[]
            for attempt in (1,2):
                try:
                    power.refresh_players(db,2025)
                except psycopg.errors.UniqueViolation as err:
                    failure={'attempt':attempt,'sqlstate':err.sqlstate,'constraint':err.diag.constraint_name,'detail':err.diag.message_detail,'context':err.diag.context}
                    assert failure['sqlstate']=='23505' and '(2025, 500, 1001)' in failure['detail']
                else:
                    raise AssertionError('unexpected publication')
                after=dbstate(db)
                assert before==after and db.execute("SELECT team_id FROM core.player_match_stats WHERE player_id=1001").fetchone()[0]==30
                attempts.append(failure)
            db.execute("UPDATE core.player_match_stats SET team_id=10 WHERE season_id=2025 AND match_id=500 AND player_id=1001")
            power.refresh_players(db,2025)
            repaired=dbstate(db)
            assert len(repaired['intermediates'])==32 and len(repaired['grades'])==32 and len(repaired['year_table'])==2 and len(repaired['runs'])==2 and [r[1] for r in repaired['runs']]==['superseded','published']
            report('result.json',dict(version=version,database=name,method=power.METHOD_VERSION,correct_reader=baseline,third_team_reader=wrong,
                     initial=before,failed_repeats=attempts,preserved_published_state=before==after,after_correction=repaired,production_actions=0))
    finally:
        if enabled:pg('pg_ctl','-D',dbfiles,'-m','fast','-w','stop')
