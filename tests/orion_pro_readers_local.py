#!/usr/bin/env python3
"""Pre-code full PG18.6 -> real HTTP Pro-reader workflow. No external sources."""
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
import subprocess
import sys
import time
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request,urlopen

ROOT=Path(__file__).resolve().parents[1]
BASE=ROOT/'docs/verification/orion-pro-readers-20261104'
PILOT=ROOT/'docs/verification/orion-pro-pilot-20261104'
MODEL=ROOT/'docs/architecture/orion-plan-20261104/target-schema.proposed.json'
HEAVY=re.compile(r'\bfootball\.(?:shots|match_heatmaps|match_heatmap_cells|pass_networks|pass_network_nodes|pass_network_edges)\b',re.I)
CASES=['runtime_readonly','unpublished_unavailable','missing_build','manifest_contract','two_page_traversal','summary_lightweight','profile_context_policy','lazy_shots','native_event_state',
       'empty_unavailable_unknown','validation_and_cross_cursor','cross_edition_variant','coordinate_contract','cold_validators','correction_publication',
       'old_pinned_immutable','mutable_cursor_conflict','new_catalogue_and_dataset','independent_C_unchanged','identical_republication',
       'web_role_permissions','flag_default_legacy','no_external_or_current_reads']


def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    p=argparse.ArgumentParser()
    p.add_argument('--label',default='reader-e2e')
    p.add_argument('--pg-bin',type=Path,default=Path('/tmp/statarena-cache-test-tools/node_modules/@embedded-postgres/darwin-arm64/native/bin'))
    args=p.parse_args()
    if not re.fullmatch('[a-zA-Z0-9][a-zA-Z0-9-]{0,70}',args.label):p.error('Use a simple label')
    sys.path[:0]=[str(BASE),str(PILOT),str(ROOT/'dashboard/scripts')]
    import psycopg
    from harness import LocalPostgres
    from orion_pro_migrate import bootstrap
    from orion_pro_integrity import role_grants_sql
    from fixture import ReaderFixture
    run=BASE/'runs'/(datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')+'-'+args.label);inputs=run/'inputs';inputs.mkdir(parents=True)
    paths=[Path(__file__),BASE/'fixture.py',BASE/'http_server.mjs',BASE/'PROTOCOL.md',PILOT/'harness.py',PILOT/'fixtures.py',MODEL,
           ROOT/'dashboard/backend/aws-app.js',ROOT/'dashboard/backend/services/orion-pro.js',ROOT/'dashboard/backend/services/postgres.js',
           ROOT/'dashboard/backend/services/relational-core.js',ROOT/'dashboard/backend/services/cache-policy.js',
           ROOT/'dashboard/scripts/orion_pro_migrate.py',ROOT/'dashboard/scripts/orion_pro_integrity.py']
    paths += [ROOT/'dashboard/backend/migrations'/n for n in ('012_orion_pro_domain.sql','013_orion_pro_integrity.sql')]
    report={'kind':'owned_pg18_frozen_reader_http_e2e','startedAt':datetime.now(timezone.utc).isoformat(),
            'command':['python3','tests/orion_pro_readers_local.py',*sys.argv[1:]],'expected':'PROTOCOL.md pre-code matrix',
            'setup':'Owned loopback PG18.6, exact sealed 012/013, synthetic complete A/B/C publications, existing read-only role and real Bun HTTP',
            'sourceSha256':{},'missingSources':[],'cases':[],'requests':[],'remoteActions':[],
            'limitations':['Synthetic backend HTTP acceptance only; no browser/Vercel/real data or remote latency gain proof',
                           'Existing production normalizer creates draft matches and no engagements, ready analytical builds or publications']}
    for path in paths:
        if path.exists():
            target=inputs/str(path.relative_to(ROOT));target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(path,target)
            report['sourceSha256'][str(path.relative_to(ROOT))]=sha(path)
        else:report['missingSources'].append(str(path.relative_to(ROOT)))
    pg=LocalPostgres(args.pg_bin,run);admin=None;server=None;server_out=None;server_err=None;origin=None
    values={};blocked=None;request_counter=0
    def http(path,*,method='GET',headers=None):
        nonlocal request_counter
        request_counter+=1;request_id=f'r{request_counter:03d}'
        req=Request(origin+path,method=method,headers={'x-e2e-id':request_id,**(headers or {})})
        start=time.monotonic()
        try:response=urlopen(req,timeout=15)
        except HTTPError as exc:response=exc
        body=response.read().decode();elapsed=round((time.monotonic()-start)*1000,3);data=json.loads(body) if body else None
        traces=json.load(urlopen(origin+'/__e2e__/traces',timeout=5))
        trace=next(x for x in traces['requests'] if x['id']==request_id)
        record={'id':request_id,'path':path,'method':method,'requestHeaders':headers or {},'status':response.status,
                'headers':dict(response.headers),'body':body,'bytes':len(body.encode()),'elapsedMs':elapsed,'sql':trace['sql']}
        report['requests'].append(record)
        return {'record':record,'status':response.status,'value':data,'body':body,'headers':{k.lower():v for k,v in response.headers.items()},'sql':trace['sql']}
    def noheavy(result):assert not any(HEAVY.search(q['sql'] or '') for q in result['sql']),result['sql']
    def metadata_only(result):
        noheavy(result)
        assert not any(re.search(r'/\*orion:(?:list|summary|shots)\*/',q['sql'] or '') for q in result['sql'])
    def qs(**params):return urlencode({k:v for k,v in params.items() if v is not None})
    def edition(manifest,season):return next(e for e in manifest['editions'] if e['season']==season)
    try:
        model=json.loads(MODEL.read_text())
        pg.start();admin=psycopg.connect(pg.dsn,autocommit=True)
        assert admin.info.server_version==180006
        report['serverVersion']=admin.info.server_version
        artifacts=[(v,ROOT/'dashboard/backend/migrations'/filename,(ROOT/'dashboard/backend/migrations'/filename).read_text()) for v,filename in [('012','012_orion_pro_domain.sql'),('013','013_orion_pro_integrity.sql')]]
        with admin.transaction():
            for version,path,sql in artifacts:
                admin.execute(sql,prepare=False);admin.execute('INSERT INTO ingest.schema_migrations(version,content_sha256,applied_at,code_commit) VALUES(%s,%s,CURRENT_TIMESTAMP,%s)',(version,sha(path),'source-free-reader-e2e'))
            report['bootstrap']=bootstrap(admin,model,artifacts)
            for role in ('statarena_ingest','statarena_runtime'):admin.execute(f'CREATE ROLE {role} LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS')
            admin.execute(role_grants_sql(model,ingest_role='statarena_ingest',runtime_role='statarena_runtime'),prepare=False)
        env=os.environ.copy();env.pop('NEON_DATABASE_URL',None)
        env.update(DATABASE_URL=f'postgresql://statarena_runtime@127.0.0.1:{pg.port}/postgres?sslmode=disable',STATARENA_DATA_PROVIDER='aws',STATARENA_TEST_DATABASE='1',STATARENA_PRO_API='1',STATARENA_METRICS_SAMPLE_RATE='1',STATARENA_SERVER_TIMING='1')
        server_out=(run/'http-server.stdout.log').open('w');server_err=(run/'http-server.stderr.log').open('w')
        server=subprocess.Popen(['bun',str(BASE/'http_server.mjs')],cwd=ROOT,env=env,stdout=subprocess.PIPE,stderr=server_err,text=True,bufsize=1)
        deadline=time.monotonic()+15
        while time.monotonic()<deadline:
            ready,_,_=select.select([server.stdout],[],[],0.2)
            if ready:
                line=server.stdout.readline();server_out.write(line);server_out.flush()
                if not line and server.poll() is not None:raise RuntimeError('Local HTTP server exited before ready')
                try:info=json.loads(line)
                except ValueError:continue
                if info.get('event')=='ready':origin=f"http://127.0.0.1:{info['port']}";report['runtimeIdentity']=info['identity'];break
        assert origin,'Local HTTP startup timeout'
        fixture=ReaderFixture(admin,pg.dsn,run,psycopg)
        for name in CASES:
            if blocked:
                report['cases'].append({'case':name,'status':'unverified','reason':blocked});continue
            try:
                if name=='runtime_readonly':
                    assert report['runtimeIdentity']==[{'role':'statarena_runtime','readonly':'on'}]
                elif name=='unpublished_unavailable':
                    r=http('/api/dashboard/manifest');assert r['status']==503 and r['headers']['cache-control']=='no-store';noheavy(r)
                    report['fixture']=fixture.prepare()
                    report['fixtureTableCount']=admin.execute("SELECT count(*) FROM pg_tables WHERE schemaname IN ('ingest','football','analytics')").fetchone()[0]
                    assert report['fixtureTableCount']==94
                elif name=='missing_build':
                    r=http('/api/fixtures?'+qs(v='pro1.999999.'+'0'*64,league='l_000001',season='2024/2025'));assert r['status']==503;noheavy(r)
                elif name=='manifest_contract':
                    r=http('/api/dashboard/manifest');assert r['status']==200,r['body'];m=r['value'];values['manifest1']=m
                    assert m['storage']=='aws-orion-pro' and m['schemaVersion']==4
                    assert m['capabilities']=={'frozenRepresentations':True,'fixturesPagination':True,'matchSummary':True,'lazyShots':True}
                    assert len(m['editions'])==3
                    for key,season in [('A','2024/2025'),('B','2025/2026'),('C','2026/2027')]:
                        e=edition(m,season);assert re.fullmatch(r'pro1\.[1-9][0-9]{0,18}\.[a-f0-9]{64}',e['representationToken']);values[key]=e['representationToken']
                        assert e['sourceDigest']==hashlib.sha256(e['representationToken'].encode()).hexdigest()
                    values['oldPinnedManifest']=http('/api/dashboard/manifest?'+qs(v=values['A']))
                    assert len(values['oldPinnedManifest']['value']['editions'])==1
                    noheavy(r)
                elif name=='two_page_traversal':
                    for pinned in (False,True):
                        params={'league':'l_000001','season':'2024/2025','limit':2,'v':values['A'] if pinned else None}
                        first=http('/api/fixtures?'+qs(**params));assert first['status']==200 and len(first['value']['data']['matches'])==2
                        cursor=first['value']['pagination']['nextCursor'];assert cursor
                        second=http('/api/fixtures?'+qs(**params,cursor=cursor));assert second['status']==200
                        ids=[m['id'] for r in (first,second) for m in r['value']['data']['matches']]
                        assert ids==['m_000001','m_000002','m_000003'] and len(set(ids))==3
                        assert second['value']['data']['matches'][0]['date'] is None
                        noheavy(first);noheavy(second)
                        values['pinnedCursor' if pinned else 'mutableCursor']=cursor
                elif name=='summary_lightweight':
                    for mid,score in [('m_000001',1),('m_000002',0),('m_000003',None)]:
                        r=http(f'/api/matches/{mid}/summary?'+qs(v=values['A']));assert r['status']==200
                        m=r['value']['data']['match'];assert m['summaryVersion']==1 and m['home']['score']==score and m['shots']==[]
                        assert 'coverageStates' in m and len(r['body'])<32000;noheavy(r)
                        if mid=='m_000001':values['oldSummary']=r
                    values['oldC']=http('/api/matches/m_000005/summary')
                    assert values['oldC']['status']==200;noheavy(values['oldC'])
                elif name=='lazy_shots':
                    r=http('/api/pitchapi/matches/m_000001/shots?'+qs(v=values['A']));assert r['status']==200
                    values['oldShots']=r
                    shots=[s for p in r['value']['data']['periods'] for s in p['shots']]
                    assert len(shots)==1 and shots[0]['id']=='s_000001' and shots[0]['expected_goals']==0.82 and shots[0]['expected_goals_on_target']==0
                    assert shots[0]['player']['name']=='Shared striker v1' and shots[0]['x']==52.5 and shots[0]['y']==34
                    assert sum(bool(HEAVY.search(q['sql'] or '')) for q in r['sql'])==1
                    values['oldShots']=r
                elif name=='profile_context_policy':
                    r=http('/api/matches/m_000001/summary?'+qs(v=values['A']));m=r['value']['data']['match']
                    assert m['home']['name']=='Shared team v1' and m['away']['name']=='Team 1 v1','Same-source provider then normalized profiles must beat manual/other-source observations'
                    r=http('/api/matches/m_000004/summary?'+qs(v=values['B']));assert r['value']['data']['match']['away']['name']=='Team 2 v1'
                    for match,v,expected in [('m_000001',values['A'],'Shared striker v1'),('m_000004',values['B'],'Striker 1 v1')]:
                        r=http(f'/api/pitchapi/matches/{match}/shots?'+qs(v=v));s=r['value']['data']['periods'][0]['shots'][0]
                        assert s['player']['name']==expected,'Player profile must follow the selected shot source, never another provider'
                elif name=='native_event_state':
                    r=http('/api/pitchapi/matches/m_000001/shots?'+qs(v=values['A']));s=r['value']['data']['periods'][0]['shots'][0]
                    assert s['event_type']=='' and s['is_goal'] is True,'An observed empty event type must remain empty'
                elif name=='empty_unavailable_unknown':
                    r=http('/api/pitchapi/matches/m_000002/shots?'+qs(v=values['A']));assert r['status']==200 and r['value']['data']['collectionState']=='empty' and r['value']['data']['periods']==[];noheavy(r)
                    for mid,v,state in [('m_000003',values['A'],'unavailable'),('m_000005',values['C'],'unknown')]:
                        r=http(f'/api/pitchapi/matches/{mid}/shots?'+qs(v=v));assert r['status']==404 and r['value']['error']['code']=='NOT_COLLECTED' and r['value']['error']['state']==state and r['headers']['cache-control']=='no-store';noheavy(r)
                elif name=='validation_and_cross_cursor':
                    for path in ['/api/dashboard/manifest?v=bad','/api/fixtures?limit=101','/api/fixtures?limit=1&limit=2','/api/fixtures?league=l_000001,','/api/fixtures?cursor=invalid','/api/matches/m_000001/summary?unknown=x','/api/pitchapi/matches/m_000001/shots?v=bad','/api/dashboard/manifest?v=pro1.9999999999999999999.'+'0'*64]:
                        r=http(path);assert r['status']==400 and len(r['sql'])==0
                    r=http('/api/fixtures?'+qs(league='l_000001',season='2025/2026',limit=2,cursor=values['mutableCursor']));assert r['status']==400;noheavy(r)
                elif name=='cross_edition_variant':
                    r=http('/api/pitchapi/matches/m_000001/shots?'+qs(v=values['B']));assert r['status']==404;noheavy(r)
                    r=http('/api/pitchapi/matches/m_000004/shots?'+qs(v=values['B']));assert r['status']==200
                    assert [s['expected_goals'] for p in r['value']['data']['periods'] for s in p['shots']]==[0.99]
                elif name=='coordinate_contract':
                    r=http('/api/pitchapi/matches/m_000001/shots?'+qs(v=values['A']));s=r['value']['data']['periods'][0]['shots'][0]
                    assert s['x']==52.5 and s['y']==34 and s['coordinate_state']=='available','Legacy map coordinates are metres, not percent'
                    r=http('/api/pitchapi/matches/m_000004/shots?'+qs(v=values['B']));s=r['value']['data']['periods'][0]['shots'][0]
                    assert s['x'] is None and s['y'] is None and s['coordinate_state']=='unsupported_frame'
                    assert s['source_coordinates']=={'x_m':52.5,'y_m':34,'coordinate_frame':'home_ltr','pitch_length_m':105,'pitch_width_m':68}
                elif name=='cold_validators':
                    paths=['/api/dashboard/manifest?'+qs(v=values['A']),'/api/fixtures?'+qs(league='l_000001',season='2024/2025',limit=1,v=values['A']),'/api/matches/m_000002/summary?'+qs(v=values['A']),'/api/pitchapi/matches/m_000001/shots?'+qs(v=values['A'])]
                    for path in paths:
                        head=http(path,method='HEAD');assert head['status']==200 and head['body']=='' and 'immutable' in head['headers']['cache-control'];metadata_only(head)
                        etag=head['headers']['etag'];r=http(path,headers={'if-none-match':etag});assert r['status']==304 and r['body']=='';metadata_only(r)
                elif name=='correction_publication':
                    report['correction']=fixture.correct();r=http('/api/dashboard/manifest');assert r['status']==200
                    values['manifest2']=r['value']
                    for key,season in [('A','2024/2025'),('B','2025/2026')]:
                        e=edition(r['value'],season);values[key+'2']=e['representationToken'];assert values[key+'2']!=values[key]
                        assert e['datasetGeneration']!=e['catalogGeneration']
                elif name=='old_pinned_immutable':
                    pinned_manifest=http('/api/dashboard/manifest?'+qs(v=values['A']))
                    assert pinned_manifest['body']==values['oldPinnedManifest']['body'] and pinned_manifest['headers']['etag']==values['oldPinnedManifest']['headers']['etag']
                    for path,old in [('/api/matches/m_000001/summary?',values['oldSummary']),('/api/pitchapi/matches/m_000001/shots?',values['oldShots'])]:
                        r=http(path+qs(v=values['A']));assert r['body']==old['body'] and r['headers']['etag']==old['headers']['etag']
                        h=http(path+qs(v=values['A']),headers={'if-none-match':old['headers']['etag']});assert h['status']==304;metadata_only(h)
                    r=http('/api/fixtures?'+qs(league='l_000001',season='2024/2025',limit=2,v=values['A'],cursor=values['pinnedCursor']));assert r['status']==200
                elif name=='mutable_cursor_conflict':
                    r=http('/api/fixtures?'+qs(league='l_000001',season='2024/2025',limit=2,cursor=values['mutableCursor']));assert r['status']==409 and r['headers']['cache-control']=='no-store';metadata_only(r)
                elif name=='new_catalogue_and_dataset':
                    r=http('/api/matches/m_000001/summary?'+qs(v=values['A2']));assert r['status']==200
                    assert r['value']['data']['match']['home']['score']==2 and r['value']['data']['match']['home']['name']=='Shared team corrected';noheavy(r)
                    r=http('/api/pitchapi/matches/m_000001/shots?'+qs(v=values['A2']));s=r['value']['data']['periods'][0]['shots'][0]
                    assert s['expected_goals']==0.67 and s['player']['name']=='Shared striker corrected'
                elif name=='independent_C_unchanged':
                    assert edition(values['manifest2'],'2026/2027')['representationToken']==values['C']
                    r=http('/api/matches/m_000005/summary');assert r['body']==values['oldC']['body'] and r['headers']['etag']==values['oldC']['headers']['etag']
                    r=http('/api/matches/m_000005/summary',headers={'if-none-match':r['headers']['etag']});assert r['status']==304;metadata_only(r)
                elif name=='identical_republication':
                    report['republication']=fixture.republish();r=http('/api/dashboard/manifest');assert r['value']==values['manifest2']
                elif name=='web_role_permissions':
                    runtime=psycopg.connect(host='127.0.0.1',port=pg.port,dbname='postgres',user='statarena_runtime',autocommit=True)
                    rejected=[]
                    for sql in ["INSERT INTO ingest.sources(code,name) VALUES('forbidden','forbidden')","SELECT ingest.begin_generation('forbidden','forbidden','forbidden')"]:
                        try:runtime.execute(sql)
                        except psycopg.Error as exc:rejected.append(exc.sqlstate)
                    runtime.close();assert rejected==['42501','42501'];report['runtimeRejections']=rejected
                elif name=='flag_default_legacy':
                    json.load(urlopen(origin+'/__e2e__/flag?value=0',timeout=5))
                    r=http('/api/dashboard/manifest?'+qs(v=values['A']));assert r['status']==400 and not r['sql']
                    json.load(urlopen(origin+'/__e2e__/flag?value=1',timeout=5))
                else:
                    traces=json.load(urlopen(origin+'/__e2e__/traces',timeout=5));assert traces['externalAttempts']==0
                    assert not any(re.search(r'\b(?:football|analytics|ingest)\.[a-z_]+_current\b',q['sql'] or '',re.I) for r in report['requests'] for q in r['sql'])
                    assert all(not re.search(r'\b(?:statarena|statarena_app)\.',q['sql'] or '',re.I) for r in report['requests'] if r['status'] in (200,304) for q in r['sql'])
                report['cases'].append({'case':name,'status':'pass'})
            except Exception as exc:
                report['cases'].append({'case':name,'status':'fail','errorType':type(exc).__name__,'reason':str(exc),'sqlstate':getattr(exc,'sqlstate',None)})
                # Preserve complete fixture/RED setup; failed serving prerequisites
                # leave dependent workflows unverified instead of inventing output.
                if name in ('unpublished_unavailable','manifest_contract'):blocked='Prerequisite failed: '+name
    except Exception as exc:report['error']={'type':type(exc).__name__,'reason':str(exc),'sqlstate':getattr(exc,'sqlstate',None)}
    finally:
        if server is not None:
            server.terminate()
            try:remaining=server.communicate(timeout=10)[0]
            except subprocess.TimeoutExpired:server.kill();remaining=server.communicate(timeout=5)[0]
            if server_out:server_out.write(remaining or '')
            report['httpCleanup']={'returnCode':server.returncode,'processStopped':server.poll() is not None}
        if server_out:server_out.close()
        if server_err:server_err.close()
        if admin is not None:admin.close()
        report['cleanup']=pg.cleanup();report['finishedAt']=datetime.now(timezone.utc).isoformat()
        report['counts']={s:sum(c['status']==s for c in report['cases']) for s in ('pass','fail','unverified')}
        report['status']='pass' if len(report['cases'])==len(CASES) and report['counts']['fail']==report['counts']['unverified']==0 and 'error' not in report else 'fail'
        (run/'result.json').write_text(json.dumps(report,indent=2,default=str)+'\n')
        print(json.dumps({'status':report['status'],'counts':report['counts'],'result':str((run/'result.json').relative_to(ROOT))}))
    return 0 if report['status']=='pass' else 1


if __name__=='__main__':raise SystemExit(main())
