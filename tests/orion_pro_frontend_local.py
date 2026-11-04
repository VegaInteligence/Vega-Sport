#!/usr/bin/env python3
"""Owned PostgreSQL -> real Pro HTTP -> frontend client workflow; no cloud."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import select
import shutil
import subprocess
import sys
import time
from urllib.request import urlopen

ROOT=Path(__file__).resolve().parents[1]
BASE=ROOT/'docs/verification/orion-pro-frontend-20261104'
READERS=ROOT/'docs/verification/orion-pro-readers-20261104'
PILOT=ROOT/'docs/verification/orion-pro-pilot-20261104'
MODULE=ROOT/'dashboard/frontend/src/services/pro-match-data.js'


def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    p=argparse.ArgumentParser();p.add_argument('--label',default='frontend-client');p.add_argument('--pg-bin',type=Path,default=Path('/tmp/statarena-cache-test-tools/node_modules/@embedded-postgres/darwin-arm64/native/bin'));a=p.parse_args()
    if not a.label.replace('-','').isalnum():p.error('Use a simple label')
    sys.path[:0]=[str(READERS),str(PILOT),str(ROOT/'dashboard/scripts')]
    from harness import LocalPostgres
    run=BASE/'runs'/(datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')+'-'+a.label);inputs=run/'inputs';inputs.mkdir(parents=True)
    paths=[Path(__file__),BASE/'PROTOCOL.md',BASE/'client_workflow.mjs',MODULE,ROOT/'dashboard/frontend/src/data-url.js',READERS/'fixture.py',READERS/'http_server.mjs',ROOT/'dashboard/backend/aws-app.js',ROOT/'dashboard/backend/services/orion-pro.js',PILOT/'harness.py',PILOT/'fixtures.py']
    paths += [ROOT/'dashboard/backend/migrations'/n for n in ('012_orion_pro_domain.sql','013_orion_pro_integrity.sql')]
    report={'kind':'owned_pg_http_frontend_client_e2e','startedAt':datetime.now(timezone.utc).isoformat(),'command':['python3','tests/orion_pro_frontend_local.py',*sys.argv[1:]],'setup':'Owned PG18.6, sealed schema, published synthetic A/B/C, real existing read-only Bun API and separate frontend client process','expected':'PROTOCOL.md pre-code matrix','sourceSha256':{},'cases':[],'remoteActions':[],'limits':['Frontend data-client integration only; React/browser/Vercel and real data remain unverified']}
    for source in paths:
        if source.is_file():
            target=inputs/source.relative_to(ROOT);target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source,target);report['sourceSha256'][str(source.relative_to(ROOT))]=sha(source)
    pg=LocalPostgres(a.pg_bin,run);admin=None;api=None;client=None;streams=[]
    try:
        if not MODULE.is_file():
            report['cases']=[{'case':'client_available','status':'fail','reason':'Missing frontend Pro client (initial RED)'},{'case':'complete_http_client_workflow','status':'unverified','reason':'Client prerequisite missing'}]
            raise RuntimeError('Client prerequisite missing')
        report['cases'].append({'case':'client_available','status':'pass'})
        import psycopg
        from fixture import ReaderFixture
        from orion_pro_migrate import bootstrap
        from orion_pro_integrity import role_grants_sql
        model=json.loads((ROOT/'docs/architecture/orion-plan-20261104/target-schema.proposed.json').read_text())
        pg.start();admin=psycopg.connect(pg.dsn,autocommit=True)
        assert admin.info.server_version==180006
        artifacts=[(v,ROOT/'dashboard/backend/migrations'/n,(ROOT/'dashboard/backend/migrations'/n).read_text()) for v,n in [('012','012_orion_pro_domain.sql'),('013','013_orion_pro_integrity.sql')]]
        with admin.transaction():
            for version,path,sql in artifacts:
                admin.execute(sql,prepare=False);admin.execute('INSERT INTO ingest.schema_migrations(version,content_sha256,applied_at,code_commit) VALUES(%s,%s,CURRENT_TIMESTAMP,%s)',(version,sha(path),'source-free-frontend-e2e'))
            report['bootstrap']=bootstrap(admin,model,artifacts)
            for role in ('statarena_ingest','statarena_runtime'):admin.execute(f'CREATE ROLE {role} LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS')
            admin.execute(role_grants_sql(model,ingest_role='statarena_ingest',runtime_role='statarena_runtime'),prepare=False)
        fixture=ReaderFixture(admin,pg.dsn,run,psycopg);report['fixture']=fixture.prepare()
        env=os.environ.copy();env.pop('NEON_DATABASE_URL',None);env.update(DATABASE_URL=f'postgresql://statarena_runtime@127.0.0.1:{pg.port}/postgres?sslmode=disable',STATARENA_DATA_PROVIDER='aws',STATARENA_TEST_DATABASE='1',STATARENA_PRO_API='1',AWS_EC2_METADATA_DISABLED='true')
        api_err=(run/'api.stderr.log').open('w');streams.append(api_err)
        api=subprocess.Popen(['bun',str(READERS/'http_server.mjs')],cwd=ROOT,env=env,stdout=subprocess.PIPE,stderr=api_err,text=True,bufsize=1)
        origin=None;deadline=time.monotonic()+20
        while time.monotonic()<deadline:
            ready,_,_=select.select([api.stdout],[],[],0.2)
            if not ready:continue
            line=api.stdout.readline()
            with (run/'api.stdout.log').open('a') as f:f.write(line)
            if not line and api.poll() is not None:raise RuntimeError('API exited')
            try:info=json.loads(line)
            except ValueError:continue
            if info.get('event')=='ready':origin=f"http://127.0.0.1:{info['port']}";report['runtimeIdentity']=info['identity'];break
        assert origin,'Local API startup timeout'
        assert report['runtimeIdentity']==[{'role':'statarena_runtime','readonly':'on'}]
        env['NEXT_PUBLIC_API_ORIGIN']=origin
        client_err=(run/'client.stderr.log').open('w');streams.append(client_err)
        client=subprocess.Popen(['bun',str(BASE/'client_workflow.mjs'),'--origin',origin,'--evidence',str(run)],cwd=ROOT,env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=client_err,text=True,bufsize=1)
        deadline=time.monotonic()+90
        while time.monotonic()<deadline:
            ready,_,_=select.select([client.stdout],[],[],0.2)
            if not ready:
                if client.poll() is not None:break
                continue
            line=client.stdout.readline()
            with (run/'client.stdout.log').open('a') as f:f.write(line)
            if not line and client.poll() is not None:break
            try:event=json.loads(line)
            except ValueError:continue
            if event.get('event')=='publish':
                report['correction']=fixture.correct();client.stdin.write('published\n');client.stdin.flush()
            if event.get('event')=='done':break
        client.wait(timeout=10)
        driver=json.loads((run/'client-result.json').read_text());report['cases']+=driver['cases'];report['client']=driver
        traces=json.load(urlopen(origin+'/__e2e__/traces',timeout=5));report['httpSqlTraces']=traces
        report['cases'].append({'case':'no_external_requests','status':'pass' if traces['externalAttempts']==0 else 'fail','actual':traces['externalAttempts']})
        changed=[name for name,expected in report['sourceSha256'].items() if not (ROOT/name).is_file() or sha(ROOT/name)!=expected]
        report['cases'].append({'case':'runtime_sources_stable','status':'pass' if not changed else 'fail','actual':changed})
        if client.returncode:raise RuntimeError('Frontend workflow failed')
    except Exception as exc:report['error']={'type':type(exc).__name__,'reason':str(exc)}
    finally:
        for process in (client,api):
            if process is not None and process.poll() is None:
                process.terminate()
                try:process.wait(timeout=8)
                except subprocess.TimeoutExpired:process.kill();process.wait(timeout=5)
        for stream in streams:stream.close()
        if admin is not None:admin.close()
        report['cleanup']={**pg.cleanup(),'apiStopped':api is None or api.poll() is not None,'clientStopped':client is None or client.poll() is not None}
        report['counts']={s:sum(c['status']==s for c in report['cases']) for s in ('pass','fail','unverified')}
        report['expectedCaseCount']=11
        report['status']='pass' if report['counts']['pass']==11 and report['counts']['fail']==report['counts']['unverified']==0 and 'error' not in report else 'fail'
        report['finishedAt']=datetime.now(timezone.utc).isoformat();(run/'result.json').write_text(json.dumps(report,indent=2,default=str)+'\n')
        print(json.dumps({'status':report['status'],'counts':report['counts'],'receipt':str((run/'result.json').relative_to(ROOT))}))
    return 0 if report['status']=='pass' else 1


if __name__=='__main__':raise SystemExit(main())
