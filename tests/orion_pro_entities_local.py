#!/usr/bin/env python3
"""Pre-code source-free PG18.6 -> real HTTP entity contract E2E."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import select
import signal
import shutil
import subprocess
import sys
import time
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT=Path(__file__).resolve().parents[1]
BASE=ROOT/'docs/verification/orion-pro-entities-20261105'
PILOT=ROOT/'docs/verification/orion-pro-pilot-20261104'
READERS=ROOT/'docs/verification/orion-pro-readers-20261104'
MODEL=ROOT/'docs/architecture/orion-plan-20261104/target-schema.proposed.json'
PRODUCT=ROOT/'dashboard/backend/services/orion-pro-entities.js'
CASES=['E01_runtime','E02_unpublished','E03_parameters','E04_required_version','E05_token',
       'E06_player','E07_team','E08_player_legacy','E09_team_manual','E10_absent_scalars',
       'E11_competition','E12_archives','E13_cross_edition','E14_missing_profile','E15_unscoped',
       'E16_routing','E17_routing_validation','E18_catalogue_pages','E19_catalogue_validation','E20_cursor_scope',
       'E21_head','E22_revalidation','E23_missing_head','E24_correction','E25_pinned','E26_mutable_cursor',
       'E27_corrected_routing','E28_unsafe_number','E29_ambiguous','E30_closed_boundary']
CONTENT=re.compile(r'/\*orion:entity(?:content|list|routes)\*/')
FORBIDDEN=re.compile(r'\bstatarena(?:_app)?\.|\bfootball\.\w+_current\b|\bingest\.\w+_current\b|\bplayer_search\b',re.I)

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--label',default='entity-contract')
    p.add_argument('--precode',action='store_true')
    p.add_argument('--pg-bin',type=Path,default=Path('/tmp/statarena-cache-test-tools/node_modules/@embedded-postgres/darwin-arm64/native/bin'))
    args=p.parse_args()
    if not re.fullmatch('[A-Za-z0-9][A-Za-z0-9-]{0,70}',args.label):p.error('Simple label required')
    run=BASE/'runs'/(datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')+'-'+args.label)
    inputs=run/'inputs';inputs.mkdir(parents=True)
    paths=[Path(__file__),BASE/'entity_fixture.py',BASE/'http_server.mjs',BASE/'PROTOCOL.md',
           READERS/'fixture.py',PILOT/'harness.py',PILOT/'fixtures.py',MODEL,PRODUCT,
           ROOT/'dashboard/backend/aws-app.js',ROOT/'dashboard/backend/services/orion-pro.js',ROOT/'dashboard/backend/services/postgres.js',
           ROOT/'dashboard/backend/services/relational-core.js',ROOT/'dashboard/backend/services/cache-policy.js',ROOT/'dashboard/backend/services/cdn.js',
           ROOT/'dashboard/scripts/orion_pro_migrate.py',ROOT/'dashboard/scripts/orion_pro_integrity.py']
    paths += [ROOT/'dashboard/backend/migrations'/n for n in ('012_orion_pro_domain.sql','013_orion_pro_integrity.sql','014_orion_pro_membership_nonnull.sql')]
    report={'kind':'source_free_owned_pg_entity_http_e2e','startedAt':datetime.now(timezone.utc).isoformat(),
            'command':[sys.executable,'tests/orion_pro_entities_local.py',*sys.argv[1:]],
            'expected':'PROTOCOL.md E01-E30, authored before product implementation',
            'setup':'One owned loopback PostgreSQL18.6, sealed012/013/014,94active tables, synthetic A/B/C/D, runtime role, opt-in Bun HTTP adapter',
            'sourceSha256':{},'missingSources':[],'cases':[],'requests':[],'remoteActions':[],
            'limits':['Synthetic backend integration only; no real-source/RDS/deployed/browser/performance acceptance',
                      'New helper not activated in aws-app.js; frontend wiring and exhaustive route parity remain open']}
    for path in paths:
        if path.exists():
            target=inputs/path.relative_to(ROOT);target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(path,target)
            report['sourceSha256'][str(path.relative_to(ROOT))]=sha(path)
        else:report['missingSources'].append(str(path.relative_to(ROOT)))
    if args.precode:
        report.update(phase='precode_structural_red',implementationPresent=PRODUCT.exists(),
                      cleanup={'databaseStarted':False,'serverStarted':False,'ownedProcesses':0})
        report['cases']=[{'case':case,'status':'failed' if i==0 else 'unverified',
                          'reason':'Implementation entrypoint absent before code' if i==0 else 'API not executed; PG slot not acquired'} for i,case in enumerate(CASES)]
        (run/'result.json').write_text(json.dumps(report,indent=2)+'\n')
        print(json.dumps({'run':str(run),'phase':report['phase'],'implementationPresent':report['implementationPresent']}))
        return 1
    sys.path[:0]=[str(BASE),str(READERS),str(PILOT),str(ROOT/'dashboard/scripts')]
    import psycopg
    from harness import LocalPostgres
    from entity_fixture import EntityFixture
    from orion_pro_migrate import bootstrap
    from orion_pro_integrity import role_grants_sql
    pg=LocalPostgres(args.pg_bin,run);admin=None;server=None;out=None;err=None;origin=None;blocked=None
    values={};counter=0
    def budget_expired(signum,frame):raise TimeoutError('ROOT 90s campaign budget reached; cleanup now')
    signal.signal(signal.SIGALRM,budget_expired)
    signal.setitimer(signal.ITIMER_REAL,85)
    def qs(**params):return urlencode({k:v for k,v in params.items() if v is not None})
    def url(path,**params):return path+'?'+qs(**params)
    def http(path,method='GET',headers=None):
        nonlocal counter
        assert counter<200,'ROOT200 HTTP cap reached'
        counter+=1;rid=f'e{counter:03d}'
        req=Request(origin+path,method=method,headers={'x-e2e-id':rid,**(headers or {})})
        start=time.monotonic()
        try:r=urlopen(req,timeout=15)
        except HTTPError as exc:r=exc
        body=r.read().decode();traces=json.load(urlopen(origin+'/__e2e__/traces',timeout=5))
        trace=next(t for t in traces['requests'] if t['id']==rid)
        record={'id':rid,'path':path,'method':method,'requestHeaders':headers or {},'status':r.status,
                'headers':{k.lower():v for k,v in r.headers.items()},'body':body,'bytes':len(body.encode()),
                'elapsedMs':round((time.monotonic()-start)*1000,3),'sql':trace['sql'],'matched':trace.get('matched')}
        report['requests'].append(record)
        return {**record,'value':json.loads(body) if body else None}
    def meta(r):assert not any(CONTENT.search(s['sql'] or '') for s in r['sql']),r['sql']
    def no_sql(r):assert r['sql']==[],r['sql']
    def fail(r,status):
        assert r['status']==status,(r['status'],r['body'])
        assert r['headers']['cache-control']=='no-store',r['headers']
        meta(r)
    def manifest():
        r=http('/api/dashboard/manifest');assert r['status']==200,(r['status'],r['body'])
        return r['value']
    def token(m,key):
        season={'A':'2024/2025','B':'2025/2026','C':'2026/2027'}[key]
        return next(e['representationToken'] for e in m['editions'] if e['leagueId']=='l_000001' and e['season']==season)
    def profile(kind,id,v=None,**extra):return http(url('/api/pitchapi/'+kind+'/'+id,v=v,**extra))
    try:
        model=json.loads(MODEL.read_text());assert sha(MODEL)=='18da43f940870b7a3a3cb49323c847dd5e5174e5eea1f8ff0c8a159cf373cb08'
        pg.start();admin=psycopg.connect(pg.dsn,autocommit=True)
        assert admin.info.server_version==180006
        report['serverVersion']=admin.info.server_version
        artifacts=[(v,ROOT/'dashboard/backend/migrations'/name,(ROOT/'dashboard/backend/migrations'/name).read_text()) for v,name in [('012','012_orion_pro_domain.sql'),('013','013_orion_pro_integrity.sql'),('014','014_orion_pro_membership_nonnull.sql')]]
        with admin.transaction():
            for version,path,sql in artifacts:
                admin.execute(sql,prepare=False)
                admin.execute('INSERT INTO ingest.schema_migrations(version,content_sha256,applied_at,code_commit) VALUES(%s,%s,CURRENT_TIMESTAMP,%s)',(version,sha(path),'source-free-entity-e2e'))
            report['bootstrap']=bootstrap(admin,model,artifacts)
            for role in ('statarena_ingest','statarena_runtime'):admin.execute(f'CREATE ROLE {role} LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS')
            admin.execute(role_grants_sql(model,ingest_role='statarena_ingest',runtime_role='statarena_runtime'),prepare=False)
        # Fixed source-free child environment: never copy inherited credentials.
        child_env={'PATH':os.defpath+':/opt/homebrew/bin:/usr/local/bin:'+str(Path(shutil.which('bun')).parent),
                   'DATABASE_URL':f'postgresql://statarena_runtime@127.0.0.1:{pg.port}/postgres?sslmode=disable',
                   'STATARENA_DATA_PROVIDER':'aws','STATARENA_TEST_DATABASE':'1','STATARENA_PRO_API':'1',
                   'STATARENA_METRICS_SAMPLE_RATE':'1','STATARENA_SERVER_TIMING':'1'}
        report['childEnvironmentKeys']=sorted(child_env)
        report['childSourceCredentialsPresent']=False
        report['authorizedBudget']={'seconds':90,'ownedClusters':1,'typedRows':5000,'HTTP':200,'sqlStatementMs':8000,'lockMs':1000}
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
                if info.get('event')=='ready':
                    origin=f"http://127.0.0.1:{info['port']}";report['runtimeIdentity']=info['identity'];report['entrypointPresent']=info['entityRoutePresent'];break
        assert origin,'HTTP startup timed out'
        fixture=EntityFixture(admin,pg.dsn,run,psycopg)
        for case in CASES:
            if blocked:
                report['cases'].append({'case':case,'status':'unverified','reason':blocked});continue
            start=time.monotonic()
            try:
                if case=='E01_runtime':
                    assert report['runtimeIdentity']==[{'role':'statarena_runtime','readonly':'on'}]
                    assert admin.execute("SELECT count(*) FROM pg_tables WHERE schemaname IN ('ingest','football','analytics')").fetchone()[0]==94
                    with psycopg.connect(f'host=127.0.0.1 port={pg.port} dbname=postgres user=statarena_runtime',autocommit=True) as runtime:
                        try:runtime.execute("INSERT INTO football.players(display_name) VALUES('forbidden')")
                        except psycopg.Error as exc:assert exc.sqlstate in ('42501','25006')
                        else:raise AssertionError('Runtime write was accepted')
                elif case=='E02_unpublished':
                    fail(http('/api/pitchapi/leagues'),503)
                    report['fixture']=fixture.prepare_entities();values['manifest1']=manifest()
                    active_tables=[t['qualified_name'] for s in model['schemas'] for t in s['tables'] if t['phase']!='models']
                    report['fixtureTypedRows']=sum(admin.execute('SELECT count(*) FROM '+table).fetchone()[0] for table in active_tables)
                    assert report['fixtureTypedRows']<=5000
                    values.update({key:token(values['manifest1'],key) for key in 'ABC'})
                elif case=='E03_parameters':
                    for path in ['/api/pitchapi/players/p_000001?unknown=x','/api/pitchapi/leagues?limit=1&limit=2','/api/pitchapi/players/p_BAD?v=x']:
                        r=http(path);fail(r,400);no_sql(r)
                elif case=='E04_required_version':
                    for path in ['/api/pitchapi/players/p_000001','/api/pitchapi/teams/t_000001','/api/pitchapi/leagues/l_000001','/api/scouting/routes?player=p_000001']:
                        r=http(path);fail(r,400);no_sql(r)
                elif case=='E05_token':
                    for v in ['bad','pro1.9999999999999999999.'+'0'*64, values['A'][:-1]+('1' if values['A'][-1]!='1' else '2')]:fail(profile('players','p_000001',v),400)
                    fail(profile('players','p_000001','pro1.999999.'+'0'*64),503)
                elif case=='E06_player':
                    r=profile('players','p_000001',values['A']);assert r['status']==200,r
                    assert r['value']['data']=={'id':'p_000001','name':'Shared striker v1','short_name':'','country_code':'','image_url':None,'position_id':'07','shirt_number':None},r['value']
                    values['originalPlayer']=r
                elif case=='E07_team':
                    for id,name in [('t_000001','Shared team v1'),('t_000002','Team 1 v1')]:
                        r=profile('teams',id,values['A']);assert r['status']==200 and r['value']['data']=={'id':id,'name':name,'image_url':None},r
                elif case=='E08_player_legacy':
                    r=profile('players','p_000002',values['B']);assert r['status']==200,r
                    assert r['value']['data']=={'id':'p_000002','name':'Striker 1 v1','short_name':None,'country_code':None,'image_url':None,'position_id':0,'shirt_number':''},r['value']
                elif case=='E09_team_manual':
                    r=profile('teams','t_000003',values['B']);assert r['status']==200 and r['value']['data']['name']=='Team 2 v1',r
                elif case=='E10_absent_scalars':
                    r=profile('players','p_000003',values['C']);assert r['status']==200,r
                    assert 'position_id' not in r['value']['data'] and 'shirt_number' not in r['value']['data']
                elif case=='E11_competition':
                    r=profile('leagues','l_000001',values['A']);assert r['status']==200,r
                    assert r['value']['data']=={'id':'l_000001','name':'Reader league','country_code':None,'image_url':None,'season':'2024/2025'},r['value']
                elif case=='E12_archives':
                    for kind,id in [('players','p_000001'),('teams','t_000001'),('leagues','l_000001')]:
                        expected=profile(kind,id,values['A'])['value']['data']
                        r=http(url('/api/archive/profiles/'+kind+'/'+id,v=values['A']))
                        assert r['status']==200 and r['value']=={'status':200,'data':expected},r
                elif case=='E13_cross_edition':
                    for kind,id in [('players','p_000002'),('teams','t_000003')]:fail(profile(kind,id,values['A']),404)
                elif case=='E14_missing_profile':fail(profile('players','p_000009',values['A']),404)
                elif case=='E15_unscoped':fail(profile('players','p_000008',values['A']),404)
                elif case=='E16_routing':
                    r=http(url('/api/scouting/routes',player='p_000001,p_000002,p_000009',team='t_000001,t_000003',v=values['A']))
                    assert r['status']==200,r
                    assert r['value']=={'routes':{'p_000001':{'2024/2025':['l_000001']},'p_000009':{'2024/2025':['l_000001']}},'clubRoutes':{'t_000001':{'2024/2025':['l_000001']}}},r['value']
                    values['routePath']=r['path'];values['routes']=r['value']
                elif case=='E17_routing_validation':
                    for params in [{},{'player':','.join(f'p_{i:06d}' for i in range(9))},{'player':'p_000001,'},{'team':'t_BAD'},{'player':'p_000001,p_000001'}]:
                        r=http(url('/api/scouting/routes',v=values['A'],**params));fail(r,400);no_sql(r)
                elif case=='E18_catalogue_pages':
                    first=http('/api/pitchapi/leagues?limit=1');assert first['status']==200,first
                    assert len(first['value']['data']['leagues'])==1
                    values['mutableCursor']=first['value']['pagination']['nextCursor'];assert values['mutableCursor']
                    second=http(url('/api/pitchapi/leagues',limit=1,cursor=values['mutableCursor']));assert second['status']==200,second
                    rows=first['value']['data']['leagues']+second['value']['data']['leagues']
                    assert [r['id'] for r in rows]==['l_000001','l_000002']
                    assert second['value']['pagination']['nextCursor'] is None
                    assert rows[0]['seasons']==['2026/2027','2025/2026','2024/2025']
                    assert all('is_free' not in row for row in rows)
                elif case=='E19_catalogue_validation':
                    for path in ['/api/pitchapi/leagues?limit=0','/api/pitchapi/leagues?limit=101','/api/pitchapi/leagues?limit=1.5','/api/pitchapi/leagues?q='+('x'*201),'/api/pitchapi/leagues?wrong=1']:
                        r=http(path);fail(r,400);no_sql(r)
                elif case=='E20_cursor_scope':
                    for params in [{'cursor':'bad'},{'cursor':values['mutableCursor'],'q':'Reader','limit':1},{'cursor':values['mutableCursor'],'limit':2}]:
                        r=http(url('/api/pitchapi/leagues',**params));fail(r,400);meta(r)
                elif case=='E21_head':
                    paths=[url('/api/pitchapi/players/p_000001',v=values['A']),url('/api/pitchapi/teams/t_000001',v=values['A']),url('/api/pitchapi/leagues/l_000001',v=values['A']),url('/api/archive/profiles/players/p_000001',v=values['A']),'/api/pitchapi/leagues?limit=1',values['routePath']]
                    for path in paths:
                        r=http(path,method='HEAD');assert r['status']==200 and r['bytes']==0,r;meta(r)
                    values['validatorPaths']=paths
                elif case=='E22_revalidation':
                    for path in values['validatorPaths']:
                        r=http(path);assert r['status']==200,r
                        etag=r['headers']['etag'];h=http(path,method='HEAD');assert h['headers']['etag']==etag
                        for supplied in [etag,'W/"other", '+etag]:
                            matched=http(path,headers={'If-None-Match':supplied});assert matched['status']==304 and matched['bytes']==0,matched;meta(matched)
                elif case=='E23_missing_head':
                    r=http(url('/api/pitchapi/players/p_999999',v=values['A']),method='HEAD');fail(r,404);assert r['bytes']==0
                elif case=='E24_correction':
                    report['correction']=fixture.correct();values['manifest2']=manifest()
                    values.update({key+'2':token(values['manifest2'],key) for key in 'ABC'})
                    assert values['A2']!=values['A'] and values['B2']!=values['B'] and values['C2']==values['C']
                    r=profile('players','p_000001',values['A2']);assert r['status']==200 and r['value']['data']['name']=='Shared striker corrected',r
                    assert r['headers']['etag']!=values['originalPlayer']['headers']['etag']
                elif case=='E25_pinned':
                    r=profile('players','p_000001',values['A']);assert r['value']==values['originalPlayer']['value'] and r['headers']['etag']==values['originalPlayer']['headers']['etag'],r
                    assert 'immutable' not in r['headers']['cache-control']
                elif case=='E26_mutable_cursor':fail(http(url('/api/pitchapi/leagues',limit=1,cursor=values['mutableCursor'])),409)
                elif case=='E27_corrected_routing':
                    path=values['routePath'].replace(values['A'],values['A2'])
                    # URLSearchParams encodes the token's literal periods unchanged.
                    r=http(path);assert r['status']==200 and r['value']==values['routes'],r
                    assert r['headers']['x-orion-representation']==values['A2']
                elif case=='E28_unsafe_number':
                    report['unsafe']=fixture.unsafe_number();v=token(manifest(),'A')
                    for method in ['GET','HEAD']:
                        r=http(url('/api/pitchapi/players/p_000001',v=v),method=method);fail(r,503)
                elif case=='E29_ambiguous':
                    before=profile('players','p_000003',values['C']);assert before['status']==200
                    report['ambiguous']=fixture.ambiguous()
                    assert report['ambiguous']['rejected']['sqlstate']=='23505'
                    assert report['ambiguous']['rejected']['constraint']=='football_player_profile_versions_sv_canonical_current_idx'
                    assert token(manifest(),'C')==values['C']
                    for method in ['GET','HEAD']:
                        r=http(url('/api/pitchapi/players/p_000003',v=values['C']),method=method)
                        assert r['status']==200 and r['headers']['etag']==before['headers']['etag'],r
                        if method=='GET':assert r['value']==before['value'],r
                        else:assert r['bytes']==0;meta(r)
                elif case=='E30_closed_boundary':
                    path='/api/pitchapi/matches/m_000001/lineups'
                    r=http(url(path+'/unregistered',v=values['A']))
                    assert r['status']==501 and not r['matched'],r
                    no_sql(r)
                    r=http(url(path,v=values['A']))
                    fail(r,400);no_sql(r)
                    assert r['value']['error']['code']=='NATIVE_MATCH_VERSION_INVALID',r
                    r=http(url(path,v=values['A'],representation='match-native-v1'))
                    fail(r,503)
                    assert r['sql'] and all('/*orion:native-match:build-meta*/' in entry['sql'] for entry in r['sql']),r
                    traces=json.load(urlopen(origin+'/__e2e__/traces',timeout=5));assert traces['externalAttempts']==0
                    for r in report['requests']:
                        for entry in r['sql']:assert not FORBIDDEN.search(entry['sql'] or ''),entry['sql']
                    report['externalAttempts']=traces['externalAttempts']
                report['cases'].append({'case':case,'status':'passed','elapsedMs':round((time.monotonic()-start)*1000,3)})
            except Exception as exc:
                blocked=f'{case}: {type(exc).__name__}: {exc}'
                report['cases'].append({'case':case,'status':'failed','reason':blocked})
                (run/'failure.log').write_text(blocked+'\n')
    except Exception as exc:
        blocked=f'setup: {type(exc).__name__}: {exc}'
        report['setupFailure']=blocked
        done={x['case'] for x in report['cases']}
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
        report['cleanup']=pg.cleanup()
        report['cleanup'].update(serverStopped=server is None or server.poll() is not None,adminClosed=admin is None or admin.closed)
        report['finishedAt']=datetime.now(timezone.utc).isoformat()
        report['counts']={status:sum(x['status']==status for x in report['cases']) for status in ['passed','failed','unverified']}
        report['codePinsUnchanged']=all((ROOT/path).exists() and sha(ROOT/path)==digest for path,digest in report['sourceSha256'].items())
        report['fullAcceptance']=False
        (run/'result.json').write_text(json.dumps(report,indent=2,default=str)+'\n')
    print(json.dumps({'run':str(run),'counts':report['counts'],'cleanup':report['cleanup'],'codePinsUnchanged':report['codePinsUnchanged']}))
    return 0 if report['counts']=={'passed':30,'failed':0,'unverified':0} and report['codePinsUnchanged'] else 1

if __name__=='__main__':raise SystemExit(main())
