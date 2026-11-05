#!/usr/bin/env python3
"""Pre-code PG18.6 -> actual Node24 HTTP -> existing consumer workflow."""
from __future__ import annotations
import argparse
from datetime import datetime,timezone
from decimal import Decimal
import hashlib
import json
import os
from pathlib import Path
from orion_node24_runtime import verify_node24_runtime
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
BASE=ROOT/'docs/verification/orion-pro-appearances-regression-20261105'
FIRST=ROOT/'docs/verification/orion-pro-entities-20261105'
BATCH=ROOT/'docs/verification/orion-pro-entity-batch-media-20261105'
PILOT=ROOT/'docs/verification/orion-pro-pilot-20261104'
MODEL=ROOT/'docs/architecture/orion-plan-20261104/target-schema.proposed.json'
PRODUCT=ROOT/'dashboard/backend/services/orion-pro-appearances.js'
DEFAULT_NODE=Path('/tmp/statarena-node24-runtime/v24.22.2/node-v24.22.2-darwin-arm64/bin/node')
CONTRACT='normalized-season-v1-native31'
CONTENT=re.compile(r'/\*orion:appearance:(?:facts|native|stats|shots)\*/')
FORBIDDEN=re.compile(r'\bstatarena(?:_app)?\.|\b(?:football|ingest)\.\w+_current\b|\bplayer_search\b',re.I)
CASES=['A01_runtime_setup','A02_actual_route','A03_traversal','A04_scalar_wire','A05_packed',
       'A06_validators','A07_validation','A08_cursor_scope','A09_native_gap','A10_coverage_gap',
       'A11_decoys','A12_correction','A13_cohort','A14_rating','A15_similarity','A16_filter_scope',
       'A17_threshold','A18_observed_profile','A19_media','A20_numeric_safety','A21_Node24','A22_boundary']
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def size(path):return sum(p.stat().st_size for p in path.rglob('*') if p.is_file()) if path.exists() else 0
def decode_packed(data):
    tables={}
    for name,table in data['tables'].items():
        rows=[]
        for index,values in enumerate(table['rows']):
            row=dict(table.get('constants',{}));missing=table.get('missing',{}).get(str(index),[])
            for column,key in enumerate(table['keys']):
                if column in missing:continue
                value=values[column];dictionary=table.get('dictionaries',{}).get(str(column))
                row[key]=dictionary[int(value)] if dictionary is not None and value is not None else value
            rows.append(row)
        tables[name]=rows
    shot=stat=0
    for match in tables['matches']:
        match['players']=[tables['appearances'][int(ref)]['id'] if isinstance(ref,(int,Decimal)) else ref for ref in match['players']]
        ns,nt=int(match['shots']),int(match['stats']);match['shots']=tables['shots'][shot:shot+ns];match['stats']=tables['stats'][stat:stat+nt];shot+=ns;stat+=nt
    assert shot==len(tables['shots']) and stat==len(tables['stats'])
    return {'meta':data['meta'],'metrics':data['metrics'],**{k:v for k,v in tables.items() if k not in ['shots','stats']}}

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--label',default='captured-profile-original22-regression')
    parser.add_argument('--node24',type=Path,default=DEFAULT_NODE)
    parser.add_argument('--pg-bin',type=Path,default=Path('/tmp/statarena-cache-test-tools/node_modules/@embedded-postgres/darwin-arm64/native/bin'))
    args=parser.parse_args()
    if not re.fullmatch('[A-Za-z0-9][A-Za-z0-9-]{0,70}',args.label):parser.error('Simple label required')
    run=BASE/'runs'/(datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')+'-'+args.label);inputs=run/'inputs';inputs.mkdir(parents=True)
    report={'kind':'source_free_actual_Node24_typed_appearance_consumer_e2e','startedAt':datetime.now(timezone.utc).isoformat(),
        'command':[sys.executable,'tests/orion_pro_appearances_regression_local.py',*sys.argv[1:]],'expected':'PROTOCOL.md pre-code22-case matrix',
        'setup':'One owned PG18.6/012-014/94tables,32players/12clubs/36matches/192performances/5952native states; actual Node24 AWS handler',
        'authorizedBudget':{'seconds':600,'externalSQL':4000,'actualHTTP':200,'typedRows':8000,'evidenceBytes':96*1024*1024,'ownedDiskBytes':1024**3,'connections':5,'copyBatchRows':1000},
        'cases':[],'requests':[],'sourceSha256':{},'missingSources':[],'adminSQL':[],'remoteActions':[],
        'sqlCountingRule':'External execute/COPY calls; internal stored-function statements are not counted separately',
        'limitations':['Synthetic local backend/consumer acceptance only, not hosted/real-data/full-source/production latency acceptance',
                       'Existing partition form only; efficient server aggregate endpoint delivery is a later product']}
    paths=[Path(__file__),ROOT/'tests/orion_node24_runtime.py',ROOT/'docs/verification/orion-pro-appearances-20261105/runtime/SHASUMS256.txt',ROOT/'dashboard/backend/services/orion-pro-fixture-aliases.js',BASE/'PROTOCOL.md',BASE/'appearance_fixture.py',BASE/'http_server.mjs',BASE/'consumer_oracle.mjs',BASE/'runtime/DOWNLOAD.json',
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
    from appearance_fixture import AppearanceFixture
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
    def alarm(signum,frame):raise TimeoutError('ROOT600second campaign budget reached; cleanup')
    signal.signal(signal.SIGALRM,alarm);signal.setitimer(signal.ITIMER_REAL,590)
    def qs(**params):return urlencode({k:v for k,v in params.items() if v is not None})
    def route(v=None,**extra):return '/api/seasons/partition?'+qs(league='l_000001',season='2023/2024',v=v or values.get('initialToken'),**extra)
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
        return next(e['representationToken'] for e in r['value']['editions'] if e['season']=='2023/2024' and e['leagueId']=='l_000001')
    def decimal_value(r):return json.loads(r['body'],parse_float=Decimal,parse_int=Decimal,parse_constant=lambda value:(_ for _ in ()).throw(ValueError('Nonfinite JSON token '+value)))
    def check_rows(actual):
        byid={row['id']:row for row in actual};assert len(byid)==192
        descriptors=json.loads((run/report['fixture']['sourceDescriptors']).read_text())['rows']
        for descriptor in descriptors:
            found=byid[descriptor['structural']['id']]
            for field,kind,value in descriptor['native']:
                if kind=='absent':assert field not in found,(field,found)
                elif kind=='number':assert type(found[field]) is Decimal and found[field]==Decimal(value),(field,found[field],value)
                elif kind=='boolean':assert type(found[field]) is bool and found[field] is value,(field,found[field],value)
                elif kind=='string':assert type(found[field]) is str and found[field]==value
                else:assert found[field] is None
            for field,value in descriptor['structural'].items():assert found.get(field)==value,(field,found.get(field),value)
            for key in ['positionId','shirtNumber','statsReliable']:
                if key not in descriptor['structural']:assert key not in found,(key,found)
    try:
        runtime=json.loads(subprocess.check_output([str(args.node24),'-p','JSON.stringify({version:process.version,arch:process.arch,platform:process.platform,rawJSON:typeof JSON.rawJSON})'],text=True,env=clean_env))
        assert runtime['version']=='v24.22.2' and runtime['rawJSON']=='function';report['nodeRuntime']=runtime
        report['runtimeVerification']=verify_node24_runtime(args.node24,runtime,ROOT/'docs/verification/orion-pro-appearances-20261105/runtime/SHASUMS256.txt')
        report['runtimeArchiveVerified']=True
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
        server=subprocess.Popen([str(args.node24),str(BASE/'http_server.mjs')],cwd=ROOT,env=child_env,stdout=subprocess.PIPE,stderr=err,text=True,bufsize=1)
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
                if case=='A01_runtime_setup':
                    assert report['runtimeIdentity']==[{'role':'statarena_runtime','readonly':'on'}]
                    report['fixture']=fixture.prepare_appearances();count=sum(admin.execute('SELECT count(*) FROM '+table).fetchone()[0] for table in active)
                    assert count<=8000;report['initialTypedRows']=count
                    report['maxCOPYBatchRows']=1000;report['nativeCOPYBatches']=6
                    values['initialToken']=manifest_token()
                    with psycopg.connect(f'host=127.0.0.1 port={pg.port} dbname=postgres user=statarena_runtime',sslmode='disable',gssencmode='disable',passfile=str(empty_passfile),autocommit=True) as role:
                        try:role.execute("INSERT INTO football.players(display_name) VALUES('forbidden')")
                        except psycopg.Error as exc:assert exc.sqlstate=='42501'
                        else:raise AssertionError('Runtime role write was accepted')
                        runtime_sql+=1
                elif case=='A02_actual_route':
                    first=http(route(limit=2));okay(first)
                    assert first['value']['data']['meta']['representationVersion']==CONTRACT
                    assert first['headers']['x-orion-representation']==values['initialToken'];values['first']=first
                elif case=='A03_traversal':
                    pages=[values['first']];cursor=pages[-1]['value']['pagination']['nextCursor'];seen=set()
                    while cursor is not None:
                        assert cursor not in seen;seen.add(cursor)
                        r=http(route(limit=2,cursor=cursor));okay(r);pages.append(r);cursor=r['value']['pagination']['nextCursor']
                    assert len(pages)==18
                    ids=[m['id'] for page in pages for m in page['value']['data']['matches']]
                    assert len(ids)==len(set(ids))==36
                    rows=[row for page in pages for row in page['value']['data']['appearances']];assert len(rows)==len({row['id'] for row in rows})==192
                    assert all(page['value']['pagination']['generation']==values['initialToken'] for page in pages)
                    assert all(len(page['value']['data']['matches'])<=2 for page in pages);values['pages']=pages
                elif case=='A04_scalar_wire':check_rows([row for page in values['pages'] for row in decimal_value(page)['data']['appearances']])
                elif case=='A05_packed':
                    packed=http(route(limit=100,format='columns'));okay(packed)
                    assert packed['value']['data']['format']=='orion-packed-tables-v1'
                    check_rows(decode_packed(decimal_value(packed)['data'])['appearances']);values['packed']=packed
                elif case=='A06_validators':
                    for original in [values['first'],values['pages'][1],values['packed']]:
                        etag=original['headers']['etag'];h=http(original['path'],method='HEAD');assert h['status']==200 and h['bytes']==0 and h['headers']['etag']==etag;metadata(h)
                        r=http(original['path'],headers={'If-None-Match':'W/"other", '+etag});assert r['status']==304 and r['bytes']==0;metadata(r)
                elif case=='A07_validation':
                    for bad in ['/api/seasons/partition','/api/seasons/partition?v=bad','/api/seasons/partition?v=bad&v=bad',
                        route(limit=0),route(limit=101),route(format='bad'),route(unknown='bad'),route().replace('l_000001','l_000002')]:
                        r=http(bad);fail(r,400)
                elif case=='A08_cursor_scope':
                    cursor=values['first']['value']['pagination']['nextCursor']
                    for bad in [route(limit=1,cursor=cursor),route(limit=2,format='columns',cursor=cursor),route(cursor='bad')]:fail(http(bad),400)
                elif case=='A09_native_gap':
                    report['missingNative']=fixture.block_native();bad=manifest_token();fail(http(route(v=bad,limit=2)),503,'NATIVE31_INCOMPLETE')
                    report['restoredNative']=fixture.restore_native()
                elif case=='A10_coverage_gap':
                    report['missingCoverage']=fixture.block_coverage();bad=manifest_token();fail(http(route(v=bad,limit=2)),503,'PERFORMANCE_COVERAGE_UNAVAILABLE')
                    report['restoredCoverage']=fixture.restore_coverage()
                elif case=='A11_decoys':
                    report['decoy']=fixture.add_decoy();decoy=manifest_token();r=http(route(v=decoy,limit=2));okay(r)
                    assert r['value']['data']['appearances']==values['first']['value']['data']['appearances']
                elif case=='A12_correction':
                    report['correction']=fixture.correction();corrected=manifest_token();r=http(route(v=corrected,limit=2));okay(r)
                    assert r['headers']['etag']!=values['first']['headers']['etag']
                    row=next(row for row in decimal_value(r)['data']['appearances'] if row['id']=='performance_1_01');assert row['xg']==Decimal('1.75')
                    old=http(values['first']['path']);okay(old);assert old['body']==values['first']['body'] and old['headers']['etag']==values['first']['headers']['etag']
                elif case=='A13_cohort':
                    oracle_input=run/'consumer-input.json';oracle_output=run/'consumer-report.json'
                    oracle_input.write_text(json.dumps({'sourceDescriptors':str(run/report['fixture']['sourceDescriptors']),
                        'pages':[page['value'] for page in values['pages']],'packed':values['packed']['value']},indent=2)+'\n')
                    command=[str(args.node24),str(BASE/'consumer_oracle.mjs'),str(oracle_input),str(oracle_output)]
                    result=subprocess.run(command,cwd=ROOT,env=clean_env,capture_output=True,text=True,timeout=30)
                    (run/'consumer.stdout.log').write_text(result.stdout);(run/'consumer.stderr.log').write_text(result.stderr);report['consumerCommand']=command
                    assert result.returncode==0,result.stderr;oracle=json.loads(oracle_output.read_text());assert oracle['profileCount']==32 and oracle['groups']['O']['players']==32
                elif case=='A14_rating':assert oracle['target']['rating']==40/6 and oracle['target']['minutes']==495
                elif case=='A15_similarity':assert len(oracle['similar'])==8 and oracle['clubCount']==12 and len(oracle['clubSimilar'])==6
                elif case=='A16_filter_scope':assert oracle['firstPageSimilar']==0 and len(oracle['similar'])==8
                elif case=='A17_threshold':assert oracle['stricterGroups']['O']['players']==30
                elif case=='A18_observed_profile':
                    rows=[row for page in values['pages'] for row in page['value']['data']['appearances']]
                    assert all(row['name'].startswith('Cohort player ') and row['playerRef'].startswith('cohort_observed_') for row in rows)
                    assert not any('WRONG' in row['name'] or 'MUTABLE' in row['name'] for row in rows)
                elif case=='A19_media':
                    report['mediaChange']=fixture.change_media('B');old=values['first'];r=http(old['path'],headers={'If-None-Match':old['headers']['etag']});okay(r)
                    assert r['headers']['etag']!=old['headers']['etag'];p=next(p for p in r['value']['data']['appearances'] if p['playerId']=='p_100001')
                    assert p['imageUrl']=='https://cdn.fixture.invalid/data/'+fixture.media['B']['key'];assert 'immutable' not in r['headers']['cache-control']
                    h=http(old['path'],method='HEAD');assert h['headers']['etag']==r['headers']['etag'] and h['bytes']==0;metadata(h)
                    cached=http(old['path'],headers={'If-None-Match':r['headers']['etag']});assert cached['status']==304 and cached['bytes']==0;metadata(cached)
                elif case=='A20_numeric_safety':
                    report['unsafeInteger']=fixture.correction(Decimal('9007199254740993'));bad=manifest_token();fail(http(route(v=bad,limit=2)),503,'NATIVE_NUMBER_INVALID')
                    fixture.correction(Decimal('1.75'))
                    report['nonfinite']=fixture.invalid_nonfinite();bad=manifest_token();fail(http(route(v=bad,limit=2)),503,'NATIVE_NUMBER_INVALID')
                    report['restoredFinite']=fixture.restore_numbers()
                elif case=='A21_Node24':assert report['actualServerRuntime']['version']=='v24.22.2' and oracle['runtime']['version']=='v24.22.2' and report['runtimeArchiveVerified']
                elif case=='A22_boundary':
                    traces=json.load(open_http(origin+'/__e2e__/traces'));assert traces['externalAttempts']==0
                    for request in report['requests']:
                        for query in request['sql']:assert not FORBIDDEN.search(query['sql'] or ''),query['sql']
                    report['externalAttempts']=traces['externalAttempts'];report['finalTypedRows']=sum(admin.execute('SELECT count(*) FROM '+table).fetchone()[0] for table in active);assert report['finalTypedRows']<=8000
                footprint=size(run)+(size(pg.root) if pg else 0);report['observedOwnedDiskBytes']=max(report.get('observedOwnedDiskBytes',0),footprint)
                assert size(run)<=96*1024*1024 and footprint<=1024**3
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
    return 0 if report['counts']=={'passed':22,'failed':0,'unverified':0} and report['codePinsUnchanged'] else 1

if __name__=='__main__':raise SystemExit(main())
