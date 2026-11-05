#!/usr/bin/env python3
"""Pre-code actual-router catalogue SQL-budget RED and typed-media E2E."""
from __future__ import annotations
import argparse
from datetime import datetime,timezone
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
from urllib.parse import urlencode,urlparse
from urllib.request import Request,urlopen

ROOT=Path(__file__).resolve().parents[1]
BASE=ROOT/'docs/verification/orion-pro-entity-batch-media-20261105'
FIRST=ROOT/'docs/verification/orion-pro-entities-20261105'
PILOT=ROOT/'docs/verification/orion-pro-pilot-20261104'
MODEL=ROOT/'docs/architecture/orion-plan-20261104/target-schema.proposed.json'
PRODUCT=ROOT/'dashboard/backend/services/orion-pro-entities.js'
FROZEN_SHA='01346dd19d64ca0f09b34828427bb7eda83a42696a7b3ed465166176586d5bd9'
ORIGIN='https://cdn.fixture.invalid/'
CASES=['B01_setup','B02_SQL_budget','B03_validators','B04_pages','M01_media_input','M02_linked_profile',
       'M03_linked_catalogue','M04_asset_correction','M05_historical_profile','M06_invalid_media','M07_provenance_URL','M08_boundary']
CONTENT=re.compile(r'/\*orion:entity(?:content|list|routes)\*/')
FORBIDDEN=re.compile(r'\bstatarena(?:_app)?\.|\b(?:football|ingest)\.\w+_current\b|\bplayer_search\b',re.I)
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--label',default='entity-batch-media')
    p.add_argument('--compare-red',type=Path)
    p.add_argument('--pg-bin',type=Path,default=Path('/tmp/statarena-cache-test-tools/node_modules/@embedded-postgres/darwin-arm64/native/bin'))
    args=p.parse_args()
    if not re.fullmatch('[A-Za-z0-9][A-Za-z0-9-]{0,70}',args.label):p.error('Simple label required')
    run=BASE/'runs'/(datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')+'-'+args.label)
    inputs=run/'inputs';inputs.mkdir(parents=True)
    report={'kind':'source_free_entity_catalogue_batch_and_media_http_e2e','startedAt':datetime.now(timezone.utc).isoformat(),
            'command':[sys.executable,'tests/orion_pro_entity_batch_media_local.py',*sys.argv[1:]],
            'expected':'PROTOCOL.md pre-code12-case matrix; catalogue GET<=3SQL,HEAD/304<=2SQL with unchanged semantic bytes',
            'setup':'Exact frozen first-lot EntityFixture/012-014/94tables; one owned PG18.6; actual AWS app/Bun; local PNGs only',
            'sourceSha256':{},'cases':[],'requests':[],'controls':[],'remoteActions':[],
            'authorizedBudget':{'seconds':90,'ownedClusters':1,'typedRows':5000,'HTTP':200,'sqlStatementMs':8000,'lockMs':1000},
            'limitations':['Source-free backend fixture only; no S3/cloud/hosted binary media delivery or production latency claim',
                           'This lot does not remove the inherited2048-build publication metadata ceiling']}
    paths=[Path(__file__),BASE/'PROTOCOL.md',BASE/'media_fixture.py',BASE/'http_server.mjs',PRODUCT,ROOT/'dashboard/backend/aws-app.js',
           FIRST/'BUNDLE_FILE_MANIFEST.json',FIRST/'entity_fixture.py']
    for path in paths:
        target=inputs/path.relative_to(ROOT);target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(path,target)
        report['sourceSha256'][str(path.relative_to(ROOT))]=sha(path)
    sys.path[:0]=[str(BASE),str(FIRST),str(PILOT),str(ROOT/'dashboard/scripts')]
    import psycopg
    from harness import LocalPostgres
    from media_fixture import MediaFixture
    from orion_pro_migrate import bootstrap
    from orion_pro_integrity import role_grants_sql
    pg=None;admin=None;server=None;out=None;err=None;origin=None;blocked=None;transport_http=0;counter=0;values={}
    def budget_expired(signum,frame):raise TimeoutError('ROOT90second budget reached; cleanup now')
    signal.signal(signal.SIGALRM,budget_expired);signal.setitimer(signal.ITIMER_REAL,85)
    def qs(**values):return urlencode({k:v for k,v in values.items() if v is not None})
    def path(route,**values):return route+'?'+qs(**values)
    def open_http(request):
        nonlocal transport_http
        assert transport_http<200,'ROOT200 actual HTTP transport cap reached'
        transport_http+=1
        try:return urlopen(request,timeout=15)
        except HTTPError as exc:return exc
    def http(route,method='GET',headers=None):
        nonlocal counter
        counter+=1;rid=f'b{counter:03d}'
        r=open_http(Request(origin+route,method=method,headers={'x-e2e-id':rid,**(headers or {})}))
        body=r.read().decode()
        traces=json.load(open_http(origin+'/__e2e__/traces'))
        trace=next(t for t in traces['requests'] if t['id']==rid)
        record={'id':rid,'path':route,'method':method,'requestHeaders':headers or {},'status':r.status,
                'headers':{k.lower():v for k,v in r.headers.items()},'body':body,'bytes':len(body.encode()),'sql':trace['sql']}
        report['requests'].append(record)
        return {**record,'value':json.loads(body) if body else None}
    def metadata(r):assert not any(CONTENT.search(q['sql'] or '') for q in r['sql']),r['sql']
    def okay(r):assert r['status']==200,(r['status'],r['body'])
    def unavailable(r):
        assert r['status']==503 and r['headers']['cache-control']=='no-store',r
        metadata(r)
    def manifest():
        r=http('/api/dashboard/manifest');okay(r);return r['value']
    def token(m):return next(e['representationToken'] for e in m['editions'] if e['leagueId']=='l_000001' and e['season']=='2024/2025')
    def profile(v,method='GET',headers=None):return http(path('/api/pitchapi/players/p_000001',v=v),method,headers)
    def validators(route,expected,get_budget,meta_budget):
        okay(expected);assert len(expected['sql'])<=get_budget,expected['sql']
        tag=expected['headers']['etag']
        h=http(route,method='HEAD');assert h['status']==200 and h['bytes']==0 and h['headers']['etag']==tag,h
        metadata(h);assert len(h['sql'])<=meta_budget,h['sql']
        for request_headers in [{'If-None-Match':tag},{'If-None-Match':'W/"other", '+tag}]:
            r=http(route,headers=request_headers)
            assert r['status']==304 and r['bytes']==0 and r['headers']['etag']==tag,r
            metadata(r);assert len(r['sql'])<=meta_budget,r['sql']
    def media_origin(value):
        result=json.load(open_http(origin+'/__e2e__/media-origin?'+qs(value=value)))
        report['controls'].append({'kind':'owned_loopback_media_configuration','value':value,'result':result})
    try:
        frozen_path=FIRST/'BUNDLE_FILE_MANIFEST.json';assert sha(frozen_path)==FROZEN_SHA
        frozen=json.loads(frozen_path.read_text());verified=[]
        for entry in frozen['files']:
            if entry['path']=='dashboard/backend/services/orion-pro-entities.js':continue
            current=ROOT/entry['path'];assert current.is_file() and sha(current)==entry['sha256'],entry['path']
            verified.append(entry['path'])
        report['frozenHistoricalFilesVerified']=len(verified)
        report['frozenManifestSha256']=FROZEN_SHA
        red=None
        if args.compare_red:
            red=json.loads(args.compare_red.read_text())
            assert red['kind']==report['kind'] and red['baselineCatalogue']['SQL']>3
            report['comparedRed']={'path':str(args.compare_red),'sha256':sha(args.compare_red)}
        model=json.loads(MODEL.read_text());assert sha(MODEL)=='18da43f940870b7a3a3cb49323c847dd5e5174e5eea1f8ff0c8a159cf373cb08'
        pg=LocalPostgres(args.pg_bin,run);pg.start();admin=psycopg.connect(pg.dsn,autocommit=True)
        assert admin.info.server_version==180006;report['serverVersion']=admin.info.server_version
        artifacts=[(v,ROOT/'dashboard/backend/migrations'/n,(ROOT/'dashboard/backend/migrations'/n).read_text()) for v,n in [('012','012_orion_pro_domain.sql'),('013','013_orion_pro_integrity.sql'),('014','014_orion_pro_membership_nonnull.sql')]]
        with admin.transaction():
            for version,file,sql in artifacts:
                admin.execute(sql,prepare=False)
                admin.execute('INSERT INTO ingest.schema_migrations(version,content_sha256,applied_at,code_commit) VALUES(%s,%s,CURRENT_TIMESTAMP,%s)',(version,sha(file),'source-free-entity-batch-e2e'))
            report['bootstrap']=bootstrap(admin,model,artifacts)
            for role in ['statarena_ingest','statarena_runtime']:admin.execute(f'CREATE ROLE {role} LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS')
            admin.execute(role_grants_sql(model,ingest_role='statarena_ingest',runtime_role='statarena_runtime'),prepare=False)
        child_env={'PATH':os.defpath+':'+str(Path(shutil.which('bun')).parent),
                   'DATABASE_URL':f'postgresql://statarena_runtime@127.0.0.1:{pg.port}/postgres?sslmode=disable',
                   'STATARENA_DATA_PROVIDER':'aws','STATARENA_TEST_DATABASE':'1','STATARENA_PRO_API':'1',
                   'STATARENA_CLOUDFRONT_URL':ORIGIN,'STATARENA_METRICS_SAMPLE_RATE':'1','STATARENA_SERVER_TIMING':'1'}
        report['childEnvironmentKeys']=sorted(child_env);report['sourceCredentialsPresent']=False
        out=(run/'http-server.stdout.log').open('w');err=(run/'http-server.stderr.log').open('w')
        server=subprocess.Popen([shutil.which('bun'),str(BASE/'http_server.mjs')],cwd=ROOT,env=child_env,stdout=subprocess.PIPE,stderr=err,text=True,bufsize=1)
        deadline=time.monotonic()+15
        while time.monotonic()<deadline:
            ready,_,_=select.select([server.stdout],[],[],0.2)
            if ready:
                line=server.stdout.readline();out.write(line);out.flush()
                if not line and server.poll() is not None:raise RuntimeError('HTTP server exited before ready')
                try:info=json.loads(line)
                except ValueError:continue
                if info.get('event')=='ready':origin=f"http://127.0.0.1:{info['port']}";report['runtimeIdentity']=info['identity'];break
        assert origin,'HTTP startup timeout'
        fixture=MediaFixture(admin,pg.dsn,run,psycopg)
        for case in CASES:
            if blocked:
                report['cases'].append({'case':case,'status':'unverified','reason':blocked});continue
            started=time.monotonic()
            try:
                if case=='B01_setup':
                    assert report['runtimeIdentity']==[{'role':'statarena_runtime','readonly':'on'}]
                    report['fixture']=fixture.prepare_entities()
                    tables=[t['qualified_name'] for s in model['schemas'] for t in s['tables'] if t['phase']!='models']
                    count=sum(admin.execute('SELECT count(*) FROM '+table).fetchone()[0] for table in tables)
                    assert count==213;report['initialTypedRows']=count
                    values['oldToken']=token(manifest())
                    values['historical']=profile(values['oldToken']);okay(values['historical'])
                elif case=='B02_SQL_budget':
                    r=http('/api/pitchapi/leagues?limit=100');okay(r)
                    assert [item['id'] for item in r['value']['data']['leagues']]==['l_000001','l_000002']
                    baseline={'path':r['path'],'body':r['body'],'etag':r['headers']['etag'],'bytes':r['bytes'],'SQL':len(r['sql'])}
                    report['baselineCatalogue']=baseline;values['catalogue']=r
                    if red:
                        old=red['baselineCatalogue']
                        assert all(baseline[key]==old[key] for key in ['path','body','etag','bytes']),{'old':old,'after':baseline}
                        report['SQLComparison']={'before':old['SQL'],'after':baseline['SQL'],'responseBytes':baseline['bytes'],'sameBodyAndETag':True}
                    assert len(r['sql'])<=3,f"Catalogue SQL budget exceeded: {len(r['sql'])}>3"
                elif case=='B03_validators':validators(values['catalogue']['path'],values['catalogue'],3,2)
                elif case=='B04_pages':
                    one=http('/api/pitchapi/leagues?limit=1');okay(one)
                    two=http(path('/api/pitchapi/leagues',limit=1,cursor=one['value']['pagination']['nextCursor']));okay(two)
                    assert [r['id'] for r in one['value']['data']['leagues']+two['value']['data']['leagues']]==['l_000001','l_000002']
                    assert two['value']['pagination']['nextCursor'] is None
                    filtered=http(path('/api/pitchapi/leagues',q='Entity second'));okay(filtered)
                    assert [r['id'] for r in filtered['value']['data']['leagues']]==['l_000002']
                elif case=='M01_media_input':
                    report['linkedMedia']=fixture.link_media()
                    for item in fixture.media.values():
                        file=run/item['path'];assert sha(file)==item['sha256'] and file.read_bytes().startswith(b'\x89PNG\r\n\x1a\n')
                    asset=admin.execute('SELECT storage_bucket,storage_key,content_sha256,content_type,source_url,author,license_code FROM ingest.media_assets WHERE id=%s',(fixture.asset_id,)).fetchone()
                    assert asset==('source-free-no-cloud',fixture.media['A']['key'],fixture.media['A']['sha256'],'image/png',fixture.media['A']['sourceUrl'],'Synthetic E2E fixture','CC0'),asset
                    values['linkedToken']=token(manifest());assert values['linkedToken']!=values['oldToken']
                elif case=='M02_linked_profile':
                    r=profile(values['linkedToken']);okay(r)
                    assert r['value']['data']['image_url']==ORIGIN+'data/'+fixture.media['A']['key']
                    parsed=urlparse(r['value']['data']['image_url']);assert parsed.scheme=='https' and parsed.netloc==urlparse(ORIGIN).netloc
                    assert 'max-age=0' in r['headers']['cache-control'] and 'immutable' not in r['headers']['cache-control']
                    assert r['headers']['x-orion-representation']==values['linkedToken'] and r['headers']['x-data-source']=='AWS'
                    assert fixture.media['A']['sourceUrl'] not in r['body']
                    validators(r['path'],r,5,4);values['linkedProfile']=r
                elif case=='M03_linked_catalogue':
                    r=http('/api/pitchapi/leagues?limit=100');okay(r)
                    assert r['value']['data']['leagues'][0]['image_url']==ORIGIN+'data/'+fixture.media['A']['key']
                    validators(r['path'],r,3,2);values['linkedCatalogue']=r
                elif case=='M04_asset_correction':
                    report['assetCorrection']=fixture.change_asset('B')
                    assert token(manifest())==values['linkedToken']
                    old=values['linkedProfile'];r=profile(values['linkedToken'],headers={'If-None-Match':old['headers']['etag']});okay(r)
                    assert r['headers']['etag']!=old['headers']['etag'] and r['value']['data']['image_url']==ORIGIN+'data/'+fixture.media['B']['key']
                    assert {k:v for k,v in r['value']['data'].items() if k!='image_url'}=={k:v for k,v in old['value']['data'].items() if k!='image_url'}
                    validators(r['path'],r,5,4);values['correctedProfile']=r
                    catalogue=http(values['linkedCatalogue']['path'],headers={'If-None-Match':values['linkedCatalogue']['headers']['etag']});okay(catalogue)
                    assert catalogue['headers']['etag']!=values['linkedCatalogue']['headers']['etag']
                    assert catalogue['value']['pagination']['generation']==values['linkedCatalogue']['value']['pagination']['generation']
                    validators(catalogue['path'],catalogue,3,2)
                elif case=='M05_historical_profile':
                    r=profile(values['oldToken']);okay(r)
                    assert r['body']==values['historical']['body'] and r['headers']['etag']==values['historical']['headers']['etag']
                    assert r['value']['data']['image_url'] is None
                elif case=='M06_invalid_media':
                    fixture.change_asset('B',storage_key='raw/media/not-content-addressed.png')
                    unavailable(profile(values['linkedToken']))
                    fixture.change_asset('B',content_type='image/jpeg');unavailable(profile(values['linkedToken']))
                    fixture.change_asset('B')
                    for invalid in ['http://cdn.fixture.invalid/','https://cdn.fixture.invalid/subpath']:
                        media_origin(invalid);unavailable(profile(values['linkedToken']))
                    media_origin(ORIGIN)
                elif case=='M07_provenance_URL':
                    fixture.change_asset('B',source_url='https://untrusted.fixture.invalid/redirect.png')
                    r=profile(values['linkedToken']);okay(r)
                    assert r['body']==values['correctedProfile']['body'] and r['headers']['etag']==values['correctedProfile']['headers']['etag']
                    assert 'untrusted.fixture.invalid' not in r['body']
                elif case=='M08_boundary':
                    traces=json.load(open_http(origin+'/__e2e__/traces'));assert traces['externalAttempts']==0
                    for request in report['requests']:
                        for q in request['sql']:assert not FORBIDDEN.search(q['sql'] or ''),q['sql']
                    with psycopg.connect(f'host=127.0.0.1 port={pg.port} dbname=postgres user=statarena_runtime',autocommit=True) as runtime:
                        try:runtime.execute('UPDATE ingest.media_assets SET author=%s WHERE id=%s',('forbidden',fixture.asset_id))
                        except psycopg.Error as exc:assert exc.sqlstate in ('42501','25006')
                        else:raise AssertionError('Runtime media write was accepted')
                    report['externalAttempts']=traces['externalAttempts']
                    report['finalTypedRows']=sum(admin.execute('SELECT count(*) FROM '+table).fetchone()[0] for table in tables)
                    assert report['finalTypedRows']<=5000
                report['cases'].append({'case':case,'status':'passed','elapsedMs':round((time.monotonic()-started)*1000,3)})
            except Exception as exc:
                blocked=f'{case}: {type(exc).__name__}: {exc}'
                report['cases'].append({'case':case,'status':'failed','reason':blocked});(run/'failure.log').write_text(blocked+'\n')
    except Exception as exc:
        blocked=f'setup: {type(exc).__name__}: {exc}';report['setupFailure']=blocked
        done={c['case'] for c in report['cases']}
        report['cases'] += [{'case':case,'status':'unverified','reason':blocked} for case in CASES if case not in done]
        (run/'failure.log').write_text(blocked+'\n')
    finally:
        signal.setitimer(signal.ITIMER_REAL,0)
        if server:
            server.terminate()
            try:server.wait(timeout=10)
            except subprocess.TimeoutExpired:server.kill();server.wait(timeout=5)
        if out:out.close()
        if err:err.close()
        if admin:admin.close()
        report['cleanup']=pg.cleanup() if pg else {'ownedProcesses':0,'databaseStarted':False}
        report['cleanup'].update(serverStopped=server is None or server.poll() is not None,adminClosed=admin is None or admin.closed)
        report['actualTransportHTTP']=transport_http
        report['counts']={status:sum(c['status']==status for c in report['cases']) for status in ['passed','failed','unverified']}
        report['codePinsUnchanged']=all((ROOT/f).exists() and sha(ROOT/f)==digest for f,digest in report['sourceSha256'].items())
        report['finishedAt']=datetime.now(timezone.utc).isoformat();report['fullAcceptance']=False
        (run/'result.json').write_text(json.dumps(report,indent=2,default=str)+'\n')
    print(json.dumps({'run':str(run),'counts':report['counts'],'cleanup':report['cleanup'],'actualTransportHTTP':transport_http,'codePinsUnchanged':report['codePinsUnchanged']}))
    return 0 if report['counts']=={'passed':12,'failed':0,'unverified':0} and report['codePinsUnchanged'] else 1

if __name__=='__main__':raise SystemExit(main())
