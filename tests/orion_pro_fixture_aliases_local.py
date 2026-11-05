#!/usr/bin/env python3
"""Pre-code typed fixture alias actual AWS HTTP workflow."""
from __future__ import annotations
import argparse
from datetime import datetime,timezone
from decimal import Decimal
import hashlib
import json
import os
from pathlib import Path
import re
import select
import shutil
import signal
import subprocess
import sys
import time
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request,urlopen

ROOT=Path(__file__).resolve().parents[1]
BASE=ROOT/'docs/verification/orion-pro-fixture-aliases-20261105'
ORIGINAL=ROOT/'docs/verification/orion-pro-appearances-20261105'
FIRST=ROOT/'docs/verification/orion-pro-entities-20261105'
BATCH=ROOT/'docs/verification/orion-pro-entity-batch-media-20261105'
PILOT=ROOT/'docs/verification/orion-pro-pilot-20261104'
MODEL=ROOT/'docs/architecture/orion-plan-20261104/target-schema.proposed.json'
PRODUCT=ROOT/'dashboard/backend/services/orion-pro-fixture-aliases.js'
DEFAULT_NODE=Path('/tmp/statarena-node24-runtime/v24.22.2/node-v24.22.2-darwin-arm64/bin/node')
CONTRACT='fixtures-alias-v1'
CONTENT=re.compile(r'/\*orion:(?:list|appearance:(?:facts|native|stats|shots))\*/')
FORBIDDEN=re.compile(r'\bstatarena(?:_app)?\.|\b(?:football|ingest)\.\w+_current\b|\bplayer_search\b',re.I)
CASES=['F01_runtime_setup','F02_actual_date_RED','F03_date_pages','F04_league_pages',
       'F05_status','F06_dto','F07_validators','F08_validation','F09_cursor_scope',
       'F10_edition_scope','F11_correction','F12_unknowns','F13_original_readers',
       'F14_methods','F15_bounds','F16_boundary']
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def size(path):return sum(p.stat().st_size for p in path.rglob('*') if p.is_file()) if path.exists() else 0

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--label',default='typed-fixture-alias-precode')
    parser.add_argument('--node24',type=Path,default=DEFAULT_NODE)
    parser.add_argument('--pg-bin',type=Path,default=Path('/tmp/statarena-cache-test-tools/node_modules/@embedded-postgres/darwin-arm64/native/bin'))
    args=parser.parse_args()
    if not re.fullmatch('[A-Za-z0-9][A-Za-z0-9-]{0,70}',args.label):parser.error('Simple label required')
    run=BASE/'runs'/(datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')+'-'+args.label);inputs=run/'inputs';inputs.mkdir(parents=True)
    report={'kind':'source_free_actual_Node24_fixture_alias_e2e','startedAt':datetime.now(timezone.utc).isoformat(),
        'command':[sys.executable,'tests/orion_pro_fixture_aliases_local.py',*sys.argv[1:]],'expected':'PROTOCOL.md pre-code16-case matrix',
        'setup':'One owned PG18.6/012-014/94tables,213typed-row fixture,4editions/2competitions/same-day ties/unknown date; actual Node24 AWS handler',
        'authorizedBudget':{'seconds':90,'externalSQL':4000,'actualHTTP':200,'typedRows':5000,'evidenceBytes':32*1024*1024,'ownedDiskBytes':1024**3,'connections':5,'copyBatchRows':1000},
        'cases':[],'requests':[],'sourceSha256':{},'missingSources':[],'adminSQL':[],'remoteActions':[],
        'sqlCountingRule':'External execute/COPY calls; internal stored-function statements are not counted separately',
        'limitations':['Synthetic local backend/consumer acceptance only, not hosted/real-data/full-source/production latency acceptance',
                       'Each v names one edition; a global day requires explicit edition traversal; no real-data/hosted cutover acceptance']}
    paths=[Path(__file__),BASE/'PROTOCOL.md',ROOT/'dashboard/backend/services/orion-pro-appearances.js',ORIGINAL/'http_server.mjs',ORIGINAL/'runtime/DOWNLOAD.json',ROOT/'tests/orion_pro_appearances_local.py',
        FIRST/'entity_fixture.py',BATCH/'media_fixture.py',ROOT/'dashboard/backend/aws-app.js',PRODUCT,
        ROOT/'dashboard/backend/services/orion-pro.js',ROOT/'dashboard/backend/services/orion-pro-entities.js',ROOT/'dashboard/backend/services/orion-pro-operations.js',
        ROOT/'dashboard/backend/services/postgres.js',ROOT/'dashboard/backend/services/database-connection.js',ROOT/'dashboard/backend/services/cache.js',
        ROOT/'dashboard/backend/services/cache-policy.js',ROOT/'dashboard/backend/services/cdn.js',ROOT/'dashboard/backend/services/relational-core.js',ROOT/'dashboard/backend/services/metrics.js',
        ROOT/'dashboard/backend/services/partition-wire.js',ROOT/'dashboard/scripts/orion_pro_migrate.py',ROOT/'dashboard/scripts/orion_pro_integrity.py',MODEL,
        PILOT/'harness.py',PILOT/'fixtures.py',ROOT/'docs/verification/orion-pro-readers-20261104/fixture.py']
    paths += [ROOT/'dashboard/backend/migrations'/n for n in ['012_orion_pro_domain.sql','013_orion_pro_integrity.sql','014_orion_pro_membership_nonnull.sql']]
    paths += [ROOT/'dashboard/frontend/src'/name for name in ['model.js','packed_data.js','season_data.js','data-url.js',
        'services/player-profile.js','services/player-aliases.js','services/format.js','services/season-player.js','services/scouting.js','services/club-analysis.js']]
    for path in paths:
        if path.is_file():
            target=inputs/path.relative_to(ROOT);target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(path,target);report['sourceSha256'][str(path.relative_to(ROOT))]=sha(path)
        else:report['missingSources'].append(str(path.relative_to(ROOT)))
    sys.path[:0]=[str(BASE),str(FIRST),str(BATCH),str(PILOT),str(ROOT/'dashboard/scripts')]
    import psycopg
    from harness import LocalPostgres
    from entity_fixture import EntityFixture as AppearanceFixture
    from orion_pro_migrate import bootstrap
    from orion_pro_integrity import role_grants_sql
    empty_passfile=run/'empty.pgpass';empty_servicefile=run/'empty.pg_service.conf'
    for file in [empty_passfile,empty_servicefile]:file.write_text('');file.chmod(0o600)
    os.environ['PGPASSFILE']=str(empty_passfile);os.environ['PGSERVICEFILE']=str(empty_servicefile);os.environ['PGPASSWORD']=''
    if 'PGSERVICE' in os.environ:del os.environ['PGSERVICE']
    clean_env={'PATH':'/usr/bin:/bin:/usr/sbin:/sbin:'+str(args.node24.parent),'PGPASSFILE':str(empty_passfile),'PGSERVICEFILE':str(empty_servicefile),'PGPASSWORD':''}
    class OwnedPG(LocalPostgres):
        def command(self,argv,*,env=None,check=True,name='command'):
            return super().command(argv,env=clean_env if env is None else env,check=check,name=name)
    sql_count=0;runtime_sql=0;http_count=0;counter=0;pg=admin=server=out=err=origin=None;blocked=None;values={};oracle=None
    def tally(sql):
        nonlocal sql_count
        sql_count+=1;assert sql_count+runtime_sql<=4000,'ROOT external SQL budget reached'
        report['adminSQL'].append({'index':sql_count,'sha256':hashlib.sha256(str(sql).encode()).hexdigest(),'kind':'COPY' if str(sql).startswith('COPY ') else 'execute'})
    class BudgetCursor:
        def __init__(self,cursor):self.cursor=cursor
        def copy(self,sql,*a,**k):tally(sql);return self.cursor.copy(sql,*a,**k)
        def __getattr__(self,key):return getattr(self.cursor,key)
    class BudgetConnection:
        def __init__(self,connection):self.connection=connection
        def execute(self,sql,*a,**k):tally(sql);return self.connection.execute(sql,*a,**k)
        def cursor(self,*a,**k):return BudgetCursor(self.connection.cursor(*a,**k))
        def transaction(self,*a,**k):
            transaction=self.connection.transaction(*a,**k)
            class Transaction:
                def __enter__(self):tally('BEGIN_OR_SAVEPOINT');return transaction.__enter__()
                def __exit__(self,*args):
                    try:return transaction.__exit__(*args)
                    finally:tally('COMMIT_OR_ROLLBACK')
            return Transaction()
        def __getattr__(self,key):return getattr(self.connection,key)
    def alarm(signum,frame):raise TimeoutError('ROOT90second campaign budget reached; cleanup')
    signal.signal(signal.SIGALRM,alarm);signal.setitimer(signal.ITIMER_REAL,85)
    def qs(**params):return urlencode({k:v for k,v in params.items() if v is not None})
    def date_route(day='2026-11-04',v=None,**extra):return '/api/pitchapi/date/'+day+'?'+qs(v=v or values.get('initialToken'),**extra)
    def league_route(league='l_000001',v=None,**extra):return '/api/pitchapi/leagues/'+league+'/matches?'+qs(v=v or values.get('initialToken'),**extra)
    def open_http(request):
        nonlocal http_count
        assert http_count<200,'ROOT actual HTTP cap reached';http_count+=1
        try:return urlopen(request,timeout=20)
        except HTTPError as exc:return exc
    def http(path,method='GET',headers=None):
        nonlocal counter,runtime_sql
        counter+=1;rid=f'a{counter:03d}'
        result=open_http(Request(origin+path,method=method,headers={'x-e2e-id':rid,**(headers or {})}));body=result.read().decode()
        traces=json.load(open_http(origin+'/__e2e__/traces'));trace=next(row for row in traces['requests'] if row['id']==rid)
        runtime_sql+=len(trace['sql']);assert runtime_sql+sql_count<=4000,'ROOT SQL cap reached'
        record={'id':rid,'path':path,'method':method,'requestHeaders':headers or {},'status':result.status,
            'headers':{k.lower():v for k,v in result.headers.items()},'body':body,'bytes':len(body.encode()),'sql':trace['sql']}
        report['requests'].append(record)
        return {**record,'value':json.loads(body) if body else None}
    def okay(r):assert r['status']==200,(r['status'],r['body'])
    def metadata(r):assert not any(CONTENT.search(q['sql'] or '') for q in r['sql']),r['sql']
    def fail(r,status,code=None):
        assert r['status']==status,(r['status'],r['body']);assert r['headers']['cache-control']=='no-store';metadata(r)
        if code:assert r['value']['error']['code']==code,r['value']
    def manifest_token():
        r=http('/api/dashboard/manifest');okay(r)
        return next(e['representationToken'] for e in r['value']['editions'] if e['season']=='2024/2025' and e['leagueId']=='l_000001')
    def decimal_value(r):return json.loads(r['body'],parse_float=Decimal,parse_int=Decimal,parse_constant=lambda value:(_ for _ in ()).throw(ValueError('Nonfinite JSON token '+value)))
    try:
        runtime=json.loads(subprocess.check_output([str(args.node24),'-p','JSON.stringify({version:process.version,arch:process.arch,platform:process.platform,rawJSON:typeof JSON.rawJSON})'],text=True,env=clean_env))
        assert runtime['version']=='v24.22.2' and runtime['rawJSON']=='function';report['nodeRuntime']=runtime
        receipt=json.loads((ORIGINAL/'runtime/DOWNLOAD.json').read_text());archive=Path(receipt['binary']).parents[2]/('node-'+runtime['version']+'-darwin-arm64.tar.xz')
        assert sha(archive)==receipt['officialSha256'];report['runtimeArchiveVerified']=True
        model=json.loads(MODEL.read_text());assert sha(MODEL)=='18da43f940870b7a3a3cb49323c847dd5e5174e5eea1f8ff0c8a159cf373cb08'
        pg=OwnedPG(args.pg_bin,run);pg.start()
        admin=BudgetConnection(psycopg.connect(pg.dsn,sslmode='disable',gssencmode='disable',passfile=str(empty_passfile),autocommit=True))
        assert admin.info.server_version==180006;report['serverVersion']=admin.info.server_version
        artifacts=[(v,ROOT/'dashboard/backend/migrations'/n,(ROOT/'dashboard/backend/migrations'/n).read_text()) for v,n in [('012','012_orion_pro_domain.sql'),('013','013_orion_pro_integrity.sql'),('014','014_orion_pro_membership_nonnull.sql')]]
        with admin.transaction():
            for version,path,sql in artifacts:
                admin.execute(sql,prepare=False);admin.execute('INSERT INTO ingest.schema_migrations(version,content_sha256,applied_at,code_commit) VALUES(%s,%s,CURRENT_TIMESTAMP,%s)',(version,sha(path),'source-free-appearance-e2e'))
            report['bootstrap']=bootstrap(admin,model,artifacts)
            for role in ['statarena_ingest','statarena_runtime']:admin.execute(f'CREATE ROLE {role} LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS')
            admin.execute(role_grants_sql(model,ingest_role='statarena_ingest',runtime_role='statarena_runtime'),prepare=False)
        admin.execute('SET statement_timeout=8000');admin.execute('SET lock_timeout=1000')
        child_env={**clean_env,'DATABASE_URL':f'postgresql://statarena_runtime@127.0.0.1:{pg.port}/postgres?sslmode=disable',
            'DATABASE_POOL_MAX':'1','STATARENA_DATA_PROVIDER':'aws','STATARENA_TEST_DATABASE':'1','STATARENA_PRO_API':'1',
            'STATARENA_CLOUDFRONT_URL':'https://cdn.fixture.invalid/','STATARENA_METRICS_SAMPLE_RATE':'1','STATARENA_SERVER_TIMING':'1'}
        report['childEnvironmentKeys']=sorted(child_env);report['sourceCredentialsPresent']=False
        out=(run/'http-server.stdout.log').open('w');err=(run/'http-server.stderr.log').open('w')
        server=subprocess.Popen([str(args.node24),str(ORIGINAL/'http_server.mjs')],cwd=ROOT,env=child_env,stdout=subprocess.PIPE,stderr=err,text=True,bufsize=1)
        end=time.monotonic()+15
        while time.monotonic()<end:
            ready,_,_=select.select([server.stdout],[],[],0.2)
            if ready:
                line=server.stdout.readline();out.write(line);out.flush()
                if not line and server.poll() is not None:raise RuntimeError('Node24 server exited before ready')
                try:info=json.loads(line)
                except ValueError:continue
                if info.get('event')=='ready':origin=f"http://127.0.0.1:{info['port']}";report['runtimeIdentity']=info['identity'];report['actualServerRuntime']=info['runtime'];runtime_sql+=1;break
        assert origin,'Node24 HTTP startup timeout'
        fixture=AppearanceFixture(admin,pg.dsn,run,psycopg);active=[t['qualified_name'] for s in model['schemas'] for t in s['tables'] if t['phase']!='models']
        for case in CASES:
            if blocked:report['cases'].append({'case':case,'status':'unverified','reason':blocked});continue
            started=time.monotonic()
            try:
                if case=='F01_runtime_setup':
                    assert report['runtimeIdentity']==[{'role':'statarena_runtime','readonly':'on'}]
                    report['fixture']=fixture.prepare_entities();count=sum(admin.execute('SELECT count(*) FROM '+table).fetchone()[0] for table in active)
                    assert count==213;report['initialTypedRows']=count;report['nativeCOPYBatches']=0
                    values['initialToken']=manifest_token()
                elif case=='F02_actual_date_RED':
                    r=http(date_route(limit=1));okay(r);values['dateFirst']=r
                    assert r['headers']['x-orion-fixture-alias-contract']==CONTRACT
                    assert r['value']['pagination']['generation']==values['initialToken']
                elif case=='F03_date_pages':
                    pages=[values['dateFirst']];seen=set();cursor=pages[-1]['value']['pagination']['nextCursor']
                    while cursor:
                        assert cursor not in seen;seen.add(cursor);r=http(date_route(limit=1,cursor=cursor));okay(r);pages.append(r);cursor=r['value']['pagination']['nextCursor']
                    assert [m['id'] for r in pages for m in r['value']['data']['matches']]==['m_000001','m_000002'];values['datePages']=pages
                    default=http(date_route());okay(default);assert default['value']['pagination']['limit']==50 and len(default['value']['data']['matches'])==2
                    empty=http(date_route('2026-11-05'));okay(empty);assert empty['value']['data']['matches']==[] and empty['value']['pagination']['nextCursor'] is None
                elif case=='F04_league_pages':
                    pages=[];cursor=None
                    while True:
                        r=http(league_route(season='2024/2025',limit=1,cursor=cursor));okay(r);pages.append(r);cursor=r['value']['pagination']['nextCursor']
                        if cursor is None:break
                        assert len(pages)<10
                    assert [m['id'] for r in pages for m in r['value']['data']['matches']]==['m_000001','m_000002','m_000003'];values['leaguePages']=pages
                elif case=='F05_status':
                    for status,ids in [('played',['m_000001','m_000002']),('upcoming',['m_000003'])]:
                        r=http(league_route(status=status,limit=100));okay(r);assert [m['id'] for m in r['value']['data']['matches']]==ids
                    r=http(date_route(status='upcoming'));okay(r);assert r['value']['data']['matches']==[]
                elif case=='F06_dto':
                    core=http('/api/fixtures?'+qs(v=values['initialToken'],league='l_000001',season='2024/2025',limit=100));okay(core)
                    rows=[m for r in values['leaguePages'] for m in r['value']['data']['matches']];assert rows==core['value']['data']['matches']
                    expected={'id','season','date','time_utc','status','round_name','has_playoff','home_team','away_team','league','score_home','score_away','score_penalty_home','score_penalty_away'}
                    for index,m in enumerate(rows):
                        assert set(m)==expected and m['season']=='2024/2025' and m['home_team']=={'id':'t_000001','name':'Shared team v1','image_url':None}
                        assert m['away_team']=={'id':'t_000002','name':'Team 1 v1','image_url':None}
                        assert m['league']=={'id':'l_000001','name':'Reader league','image_url':None}
                        assert m['score_home']==[1,0,None][index] and m['score_away']==[0,0,None][index]
                    values['baselineRows']=rows
                elif case=='F07_validators':
                    for original in [*values['datePages'],*values['leaguePages'][:2]]:
                        tag=original['headers']['etag'];h=http(original['path'],method='HEAD');assert h['status']==200 and h['bytes']==0 and h['headers']['etag']==tag;metadata(h)
                        cached=http(original['path'],headers={'If-None-Match':'W/"other", '+tag});assert cached['status']==304 and cached['bytes']==0;metadata(cached)
                elif case=='F08_validation':
                    bad=['/api/pitchapi/date/2026-11-04','/api/pitchapi/leagues/l_000001/matches',date_route('2026-02-30'),date_route(v='bad'),date_route(limit=0),date_route(limit=101),date_route(status='bad'),date_route(unknown='bad'),date_route()+'&v=bad',league_route(season='bad'),league_route(limit='01'),league_route(cursor='bad')]
                    for path in bad:fail(http(path),400)
                elif case=='F09_cursor_scope':
                    cursor=values['dateFirst']['value']['pagination']['nextCursor']
                    for path in [date_route(limit=2,cursor=cursor),date_route('2026-11-05',limit=1,cursor=cursor),date_route(limit=1,status='played',cursor=cursor),league_route(limit=1,cursor=cursor)]:fail(http(path),400)
                    replay=http(values['datePages'][1]['path']);okay(replay);assert replay['body']==values['datePages'][1]['body']
                elif case=='F10_edition_scope':
                    for path in [league_route('l_000002'),league_route(season='2025/2026')]:fail(http(path),400)
                elif case=='F11_correction':
                    report['correction']=fixture.correct();corrected=manifest_token();r=http(league_route(v=corrected,limit=1));okay(r)
                    item=r['value']['data']['matches'][0];assert item['score_home']==2 and item['home_team']['name']=='Shared team corrected'
                    previous=values['leaguePages'][0];old=http(previous['path']);okay(old);assert old['body']==previous['body'] and old['headers']['etag']==previous['headers']['etag']
                    assert r['headers']['etag']!=previous['headers']['etag']
                elif case=='F12_unknowns':
                    row=values['baselineRows'][2];assert row['date'] is None and row['time_utc'] is None and row['score_home'] is None and row['score_away'] is None and row['has_playoff'] is None and row['status']=='not_started'
                elif case=='F13_original_readers':
                    for path in ['/api/dashboard/manifest?'+qs(v=values['initialToken']),'/api/fixtures?'+qs(v=values['initialToken']),'/api/matches/m_000001/summary?'+qs(v=values['initialToken']),'/api/pitchapi/matches/m_000001/shots?'+qs(v=values['initialToken'])]:okay(http(path))
                    assert sha(ROOT/'dashboard/backend/services/orion-pro.js')=='4815cdfb184fbae31fa501b50695b235c2ca14b85660db6e6aee8f5fef979616'
                elif case=='F14_methods':
                    for path in [date_route(),league_route()]:
                        r=http(path,method='POST');assert r['status']==405 and r['headers']['allow']=='GET, HEAD';metadata(r)
                elif case=='F15_bounds':
                    first=values['leaguePages'][0];full=http(league_route(season='2024/2025',limit=100));okay(full)
                    assert len(first['sql'])==len(full['sql']) and len(first['sql'])<=4
                    assert all(len(r['sql'])<=4 and len(r['value']['data']['matches'])<=1 for r in values['leaguePages']+values['datePages'])
                elif case=='F16_boundary':
                    traces=json.load(open_http(origin+'/__e2e__/traces'));assert traces['externalAttempts']==0
                    for request in report['requests']:
                        for query in request['sql']:assert not FORBIDDEN.search(query['sql'] or ''),query['sql']
                    report['externalAttempts']=traces['externalAttempts'];report['finalTypedRows']=sum(admin.execute('SELECT count(*) FROM '+table).fetchone()[0] for table in active);assert report['finalTypedRows']<=5000
                footprint=size(run)+(size(pg.root) if pg else 0);report['observedOwnedDiskBytes']=max(report.get('observedOwnedDiskBytes',0),footprint)
                assert size(run)<=32*1024*1024 and footprint<=1024**3
                report['cases'].append({'case':case,'status':'passed','elapsedMs':round((time.monotonic()-started)*1000,3)})
            except Exception as exc:
                blocked=f'{case}: {type(exc).__name__}: {exc}';report['cases'].append({'case':case,'status':'failed','reason':blocked});(run/'failure.log').write_text(blocked+'\n')
    except Exception as exc:
        blocked=f'setup: {type(exc).__name__}: {exc}';report['setupFailure']=blocked;(run/'failure.log').write_text(blocked+'\n')
        done={row['case'] for row in report['cases']};report['cases'] += [{'case':case,'status':'unverified','reason':blocked} for case in CASES if case not in done]
    finally:
        signal.setitimer(signal.ITIMER_REAL,0)
        if server:
            server.terminate()
            try:server.wait(timeout=10)
            except subprocess.TimeoutExpired:server.kill();server.wait(timeout=5)
        if out:out.close()
        if err:err.close()
        if admin:admin.close()
        report['cleanup']=pg.cleanup() if pg else {'databaseStarted':False,'ownedProcesses':0}
        report['cleanup'].update(serverStopped=server is None or server.poll() is not None,adminClosed=admin is None or admin.closed)
        report['actualTransportHTTP']=http_count;report['externalSQLCalls']=sql_count+runtime_sql;report['evidenceBytesBeforeResult']=size(run)
        report['codePinsUnchanged']=all((ROOT/path).exists() and sha(ROOT/path)==digest for path,digest in report['sourceSha256'].items())
        report['counts']={status:sum(row['status']==status for row in report['cases']) for status in ['passed','failed','unverified']}
        report['finishedAt']=datetime.now(timezone.utc).isoformat();report['fullAcceptance']=False
        (run/'result.json').write_text(json.dumps(report,indent=2,default=str)+'\n')
    print(json.dumps({'run':str(run),'counts':report['counts'],'SQL':report['externalSQLCalls'],'HTTP':http_count,'cleanup':report['cleanup'],'codePinsUnchanged':report['codePinsUnchanged']}))
    return 0 if report['counts']=={'passed':16,'failed':0,'unverified':0} and report['codePinsUnchanged'] else 1

if __name__=='__main__':raise SystemExit(main())
