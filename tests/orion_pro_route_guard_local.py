#!/usr/bin/env python3
"""Pre-code owned PG18.6 -> real HTTP fallback-closure workflow, no cloud."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
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
from urllib.parse import urlencode, urlparse
from urllib.request import Request, HTTPRedirectHandler, ProxyHandler, build_opener

ROOT=Path(__file__).resolve().parents[1]
BASE=ROOT/'docs/verification/orion-pro-api-coverage-20261105'
READERS=ROOT/'docs/verification/orion-pro-readers-20261104'
PILOT=ROOT/'docs/verification/orion-pro-pilot-20261104'
MODEL=ROOT/'docs/architecture/orion-plan-20261104/target-schema.proposed.json'
MODEL_SHA='18da43f940870b7a3a3cb49323c847dd5e5174e5eea1f8ff0c8a159cf373cb08'
SERVICE_NAMES=['orion-pro.js','orion-pro-entities.js','orion-pro-operations.js','orion-pro-appearances.js','orion-pro-fixture-aliases.js','orion-pro-competitions.js','orion-pro-match-details.js','orion-pro-archives.js','orion-pro-player-statistics.js','orion-pro-match-statistics.js','orion-pro-enrichment.js','postgres.js','database-connection.js','metrics.js','cache-policy.js','cache.js',
 'relational-match.js','relational-support.js','relational-catalog.js','cdn.js','relational-core.js','partition-wire.js',
 'catalog-model.json','support-model.json']
WRAPPERS={'relational-core':['manifest','partitionPage','fixturePage','summary','scouting'],
 'relational-match':['relationalResource','relationalMatchObservation'],
 'relational-catalog':['getCatalog','getProfile'],'relational-support':['getSupporting']}
STABLE_HEADERS=['etag','cache-control','cdn-cache-control','vercel-cdn-cache-control','x-orion-representation','content-type','location','allow']
HEAVY=re.compile(r'\bfootball\.(shots|match_heatmaps|match_heatmap_cells|pass_networks|pass_network_nodes|pass_network_edges)\b',re.I)
CASES=['owned_runtime','positive_legacy_off','unsupported_get_remaining9','unsupported_head_remaining9','unsupported_conditional_remaining9','typed_entity_frontier','typed_appearance_frontier','typed_fixture_alias_frontier','typed_competitions_frontier','typed_native_match_detail_frontier','typed_archive_frontier','typed_shot_detail_frontier','typed_player_period_frontier','typed_enrichment_frontier',
 'closed_unknown_and_versioned','generic_path_method','operational_exceptions','media_valid','media_bad_path','media_bad_mime','media_cache_mode_isolation',
 'native_v1_golden_bytes','native_cold_head_304','correction_publication','old_pinned_v1','independent_C_and_stale_cursor','role_readonly','source_access_audit']


def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def qs(**values):return urlencode({k:v for k,v in values.items() if v is not None})


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None


def legacy_fixture(db):
    from test_dashboard_data import synthetic
    from build_dashboard_data import build_snapshot
    from relational_core import publish_snapshot
    from relational_match import publish_match_details
    from relational_catalog import publish_catalog
    from relational_support import publish_supporting
    raw,catalog=synthetic()
    snapshot=build_snapshot(raw,catalog)
    with db.transaction():
        publish_snapshot(db,'2026/2027','l_000001',snapshot)
        sample=raw['samples'][0]
        envelope=lambda value:{'status':value['status'],'data':value['data']}
        publish_match_details(db,'m_000001',{'shots':envelope(sample['shots']),'players':envelope(sample['players']),'lineups':envelope(sample['lineups']),
            'stats':envelope(sample['team_stats']),'match':{'status':200,'data':sample['match']}},
            metadata={'fixture':sample['match'],'competition_id':'l_000001','competition_name':'Example','season':'2026/2027'})
        publish_catalog(db,[('/leagues',{'status':200,**catalog}),('/players/p_000001',{'status':200,'data':{'id':'p_000001','name':'Legacy player'}}),
            ('raw/openfootball/index.json',{'schemaVersion':1,'seasons':[{'id':'2026/2027','matches':2,'competitions':1,'path':'metadata-only','sha256':'a'*64}],
                                          'source':{'name':'Synthetic legacy archive'}})])
        publish_supporting(db,[('stadium',{'id':'Q1'},{'id':'Q1','capacity':12345})])
        assets={
            'valid':('raw/neon/assets/'+'a'*64+'.png','image/png'),
            'valid-jpeg':('raw/neon/assets/'+'1'*64+'.jpeg','image/jpeg'),
            'valid-jpg':('raw/neon/assets/'+'2'*64+'.jpg','image/jpeg'),
            'valid-webp':('raw/neon/assets/'+'3'*64+'.webp','image/webp'),
            'json':('raw/neon/assets/'+'b'*64+'.json','application/json'),
            'json-gz':('raw/neon/assets/'+'b'*64+'.json.gz','application/json'),
            'mutable':('raw/neon/assets/current.png','image/png'),
            'traversal':('raw/../sources/'+'c'*64+'.png','image/png'),
            'url-path':('https://bucket.invalid/'+'c'*64+'.png','image/png'),
            'wrong-mime':('raw/neon/assets/'+'d'*64+'.png','application/json'),
            'mismatch':('raw/neon/assets/'+'4'*64+'.png','image/jpeg'),
            'poison':('raw/neon/assets/'+'e'*64+'.png','application/json'),
        }
        for name,(path,mime) in assets.items():
            db.execute('INSERT INTO statarena_app.assets(url,path,content_type,size,sha256) VALUES(%s,%s,%s,17,%s)',
                       ('https://fixture.invalid/'+name+'.png',path,mime,'f'*64))
            # Typed registration is independent from the historical download map.
            found=re.search(r'([a-f0-9]{64})\.',path)
            content=found.group(1) if found else 'f'*64
            db.execute('INSERT INTO ingest.media_assets(storage_bucket,storage_key,content_type,content_sha256,retrieved_at,legacy_asset_url) VALUES(%s,%s,%s,%s,CURRENT_TIMESTAMP,%s)',
                       ('owned-fixture',path,mime,content,'https://fixture.invalid/'+name+'.png'))
    return {'coreMatches':2,'appearances':2,'shots':1,'profiles':2,'archiveIndexSeasons':1,'supportStadiumCapacity':12345,
            'assets':{k:{'path':v[0],'registeredMime':v[1]} for k,v in assets.items()}}


def export_runtime(run,label,aws_source):
    target=run/'runtime'/label
    backend=target/'dashboard/backend';(backend/'services').mkdir(parents=True)
    shutil.copy2(ROOT/'dashboard/package.json',target/'dashboard/package.json')
    (target/'dashboard/node_modules').symlink_to(ROOT/'dashboard/node_modules',target_is_directory=True)
    for name in SERVICE_NAMES:shutil.copy2(ROOT/'dashboard/backend/services'/name,backend/'services'/name)
    source=aws_source.read_text();rewrites=[]
    for module,names in WRAPPERS.items():
        original=f'"./services/{module}.js"';replacement=f'"./services/guard-{module}.mjs"'
        assert source.count(original)==1,(module,'Unexpected source import')
        source=source.replace(original,replacement)
        exports=['import * as real from "./'+module+'.js";','export * from "./'+module+'.js";']
        exports += [f'export const {name}=(...args)=>globalThis.__orionGuardCall("{name}",real.{name},args);' for name in names]
        (backend/'services'/f'guard-{module}.mjs').write_text('\n'.join(exports)+'\n')
        rewrites.append({'from':original,'to':replacement,'observedFunctions':names})
    (backend/'aws-app.js').write_text(source)
    graph='\n'.join((backend/'services'/n).read_text() for n in SERVICE_NAMES if n.endswith('.js'))+source
    forbidden=['@aws-sdk/','./files.js','./data-store.js','./pitchapi.js','./neon.js']
    assert not any(v in graph for v in forbidden),'Unexpected source/object/provider transport in runtime graph'
    files=[backend/'aws-app.js',target/'dashboard/package.json',*[backend/'services'/n for n in SERVICE_NAMES],
           *[backend/'services'/f'guard-{n}.mjs' for n in WRAPPERS]]
    assert not any(' 2.' in f.name or f.name.startswith('.env') for f in files)
    return target,{'label':label,'awsSourceSha256':sha(aws_source),'awsInstrumentedSha256':sha(backend/'aws-app.js'),
       'importRewrites':rewrites,'files':{str(f.relative_to(target)):sha(f) for f in files},
       'excludedSourceObjectProviderTransports':forbidden,'environmentFilesCopied':0,'untrackedNumberedCopiesCopied':0,
       'dependencyReuse':'Existing dashboard/node_modules symlink; no install/download'}


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--label',default='route-guard-e2e')
    parser.add_argument('--baseline-receipt',type=Path)
    parser.add_argument('--pg-bin',type=Path,default=Path('/tmp/statarena-cache-test-tools/node_modules/@embedded-postgres/darwin-arm64/native/bin'))
    args=parser.parse_args()
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9-]{0,70}',args.label):parser.error('Use a simple label')
    sys.path[:0]=[str(READERS),str(PILOT),str(ROOT/'dashboard/scripts'),str(ROOT/'tests')]
    import psycopg
    from harness import LocalPostgres
    from fixture import ReaderFixture
    from orion_pro_migrate import bootstrap
    from orion_pro_integrity import role_grants_sql
    run=BASE/'runs'/(datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')+'-'+args.label)
    inputs=run/'inputs';inputs.mkdir(parents=True)
    app=ROOT/'dashboard/backend/aws-app.js';baseline=app
    if args.baseline_receipt:
        receipt=args.baseline_receipt.resolve();assert receipt.is_relative_to(BASE/'runs')
        old=json.loads(receipt.read_text());baseline=receipt.parent/'inputs/dashboard/backend/aws-app.js'
        assert sha(baseline)==old['sourceSha256']['dashboard/backend/aws-app.js']
    pathlist=json.loads((BASE/'API_ROUTE_MATRIX.json').read_text())
    blocked=[r['samplePath'] for r in pathlist['rows'] if r['proOnPolicy']=='501_before_legacy_dispatch']
    assert len(blocked)==len(set(blocked))==50
    entity_matrix=ROOT/'docs/verification/orion-pro-operations-20261105/API_ROUTE_MATRIX.json'
    entity_rows=json.loads(entity_matrix.read_text())['rows']
    entity_forms={r['path'] for r in entity_rows if r['status']=='local-entities-v1-E2E-qualified'}
    operational_forms={r['path'] for r in entity_rows if r['status']=='local-operations-v1-E2E-qualified'}
    assert operational_forms=={'/api/health','/api/status','/api/settings','/api/assets'}
    appearance_forms={r['path'] for r in entity_rows if r['status']=='local-appearances-v1-E2E-qualified'}
    assert appearance_forms=={'/api/seasons/partition'}
    fixture_forms={r['path'] for r in entity_rows if r['status']=='local-fixture-aliases-v1-E2E-qualified'}
    assert fixture_forms=={'/api/pitchapi/date/{date}','/api/pitchapi/leagues/{league}/matches'}
    competition_forms={r['path'] for r in entity_rows if r['status']=='local-competitions-v1-E2E-qualified'}
    native_forms={r['path'] for r in entity_rows if r['status']=='local-native-match-details-v1-E2E-qualified'}
    archive_forms={r['path'] for r in entity_rows if r['status']=='local-archives-v1-E2E-qualified'}
    shot_forms={r['path'] for r in entity_rows if r['status']=='local-shot-detail-v1-E2E-qualified'}
    player_period_forms={r['path'] for r in entity_rows if r['status']=='local-player-period-v1-E2E-qualified'}
    enrichment_forms={r['path'] for r in entity_rows if r['status']=='local-enrichment-v1-E2E-qualified'}
    assert len(enrichment_forms)==5 and len(player_period_forms)==4 and len(shot_forms)==2 and len(archive_forms)==4 and len(native_forms)==6 and len(competition_forms)==8 and len(entity_forms)==8 and sum(r['status']=='reader-and-data-contract-required' for r in entity_rows)==9
    entity_samples=[r['samplePath'] for r in pathlist['rows'] if r['path'] in entity_forms]
    blocked=[r['samplePath'] for r in pathlist['rows'] if r['proOnPolicy']=='501_before_legacy_dispatch' and r['path'] not in entity_forms and r['path'] not in operational_forms and r['path'] not in appearance_forms and r['path'] not in fixture_forms and r['path'] not in competition_forms and r['path'] not in native_forms and r['path'] not in archive_forms and r['path'] not in shot_forms and r['path'] not in player_period_forms and r['path'] not in enrichment_forms]
    assert len(blocked)==len(set(blocked))==9 and len(entity_samples)==8
    backend_paths=[app,ROOT/'dashboard/package.json',*[ROOT/'dashboard/backend/services'/n for n in SERVICE_NAMES]]
    helper_paths=[Path(__file__),BASE/'guard_http_server.mjs',BASE/'PRO_ON_ROUTE_POLICY.md',BASE/'GUARD_E2E_PROTOCOL.md',BASE/'API_ROUTE_MATRIX.json',
      MODEL,entity_matrix,ROOT/'docs/verification/orion-pro-player-statistics-20261105/ROOT_SHOT_GUARD_INTEGRATION.md',ROOT/'docs/verification/orion-pro-enrichment-20261105/ROOT_ENRICHMENT_GUARD.md',ROOT/'docs/verification/orion-pro-player-statistics-20261105/ROOT_PLAYER_PERIOD_GUARD.md',ROOT/'docs/verification/orion-pro-archives-20261105/ROOT_GUARD_INTEGRATION.md',ROOT/'docs/verification/orion-pro-match-readers-20261105/ROOT_GUARD_INTEGRATION.md',ROOT/'docs/verification/orion-pro-competitions-20261105/ROOT_GUARD_INTEGRATION.md',ROOT/'docs/verification/orion-pro-fixture-aliases-20261105/GUARD_INTEGRATION.md',ROOT/'docs/verification/orion-pro-operations-20261105/GUARD_INTEGRATION.md',ROOT/'docs/verification/orion-pro-entities-20261105/GUARD_INTEGRATION_PROTOCOL.md',READERS/'fixture.py',PILOT/'harness.py',PILOT/'fixtures.py',ROOT/'tests/test_dashboard_data.py']
    helper_paths += [ROOT/'dashboard/scripts'/n for n in ['orion_pro_migrate.py','orion_pro_integrity.py','orion_pro_schema.py','build_dashboard_data.py',
      'relational_core.py','relational_match.py','relational_match_ddl.py','relational_match_model.py','relational_catalog.py','relational_catalog_keys.py','relational_support.py']]
    migration_paths=[ROOT/'dashboard/backend/migrations'/n for n in ['003_relational_core.sql','004_match_details.sql','005_supporting_models.sql','006_catalog_models.sql',
      '007_match_source_fields.sql','008_match_player_position.sql','009_compact_player_metrics.sql','010_partition_bootstrap_sources.sql','011_appearance_shirt_numbers.sql','012_orion_pro_domain.sql','013_orion_pro_integrity.sql']]
    report={'kind':'OWNED_PG18_REAL_HTTP_CLOSED_PRO_ROUTE_GUARD_E2E','command':['python3','tests/orion_pro_route_guard_local.py',*sys.argv[1:]],
      'requiredEnvironment':'PYTHONPATH=/tmp/statarena-publication-test-python','expected':'GUARD_E2E_PROTOCOL.md pre-code matrix',
      'sourceSha256':{},'cases':[],'requests':[],'runtimeExports':[],'baselineReceipt':str(args.baseline_receipt) if args.baseline_receipt else None,
      'sourceBodyReads':False,'cloudActions':[],'model107ApprovedOrUsed':False,
      'limits':['Synthetic owned PostgreSQL and local HTTP only; no production data, deployment, activation or full feature parity acceptance.',
       'Media validates registered metadata/path, not actual binary contents. No redirect is followed.',
       'Source-access tripwires operate after module/DB initialization; explicit graph excludes object/provider modules, not a complete OS syscall trace.']}
    all_sources=list(dict.fromkeys(backend_paths+helper_paths+migration_paths))
    for path in all_sources:
        dest=inputs/path.relative_to(ROOT);dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(path,dest)
        report['sourceSha256'][str(path.relative_to(ROOT))]=sha(path)
    assert sha(MODEL)==MODEL_SHA
    if args.baseline_receipt:
        shutil.copy2(baseline,run/'baseline-aws-app.js');baseline=run/'baseline-aws-app.js'
    else:baseline=inputs/'dashboard/backend/aws-app.js'
    pg=LocalPostgres(args.pg_bin,run);db=None;processes=[];streams=[];origins={};ready_info={};values={};counter=0
    opener=build_opener(ProxyHandler({}),NoRedirect())
    def raw(url,method='GET',headers=None):
        assert urlparse(url).hostname=='127.0.0.1','Non-loopback HTTP forbidden'
        try:r=opener.open(Request(url,method=method,headers=headers or {}),timeout=15)
        except HTTPError as e:r=e
        body=r.read().decode();return r.status,{k.lower():v for k,v in r.headers.items()},body
    def flag(label,value):
        status,_,body=raw(origins[label]+'/__e2e__/flag?value='+str(value));assert status==200;return json.loads(body)
    def http(path,*,label='candidate',method='GET',headers=None):
        nonlocal counter
        counter+=1;rid=f'{label}-{counter:04d}'
        start=time.monotonic();status,h,body=raw(origins[label]+path,method,{'x-e2e-id':rid,**(headers or {})})
        _,_,trace_body=raw(origins[label]+'/__e2e__/trace?'+qs(id=rid));trace=json.loads(trace_body);assert trace
        try:value=json.loads(body) if body else None
        except ValueError:value=None
        record={'id':rid,'server':label,'path':path,'method':method,'requestHeaders':headers or {},'status':status,
                'headers':h,'body':body,'elapsedMs':round((time.monotonic()-start)*1000,3),**{k:trace[k] for k in ['sql','legacyEntries','legacyMaterializations','sourceAccess']}}
        report['requests'].append(record);return {**record,'value':value}
    def identical(a,b):
        assert (a['status'],a['body'])==(b['status'],b['body']),{'baseline':a,'candidate':b}
        assert {k:a['headers'].get(k) for k in STABLE_HEADERS}=={k:b['headers'].get(k) for k in STABLE_HEADERS},(a['headers'],b['headers'])
    def metadata(r):
        assert not any(HEAVY.search(q['sql'] or '') or re.search(r'/\*orion:(list|summary|shots)\*/',q['sql'] or '') for q in r['sql'])
        assert not r['legacyEntries'] and not r['legacyMaterializations'] and not r['sourceAccess']
    def refused(r):
        assert r['status']==501,r
        for k in ['cache-control','cdn-cache-control','vercel-cdn-cache-control']:assert r['headers'].get(k)=='no-store',r
        assert not r['headers'].get('etag') and not r['headers'].get('last-modified'),r
        assert not r['sql'] and not r['legacyEntries'] and not r['legacyMaterializations'] and not r['sourceAccess'],r
        if r['method']=='HEAD':assert r['body']=='',r
        else:assert r['value'].get('available') is False and r['value']['error']['code']=='PRO_ROUTE_NOT_IMPLEMENTED',r
    def twins(path,**kwargs):
        a=http(path,label='baseline',**kwargs);b=http(path,**kwargs);identical(a,b);return b
    def asset(name):return '/api/assets?'+qs(url='https://fixture.invalid/'+name+'.png')
    critical=None
    try:
        pg.start();db=psycopg.connect(pg.dsn,autocommit=True);assert db.info.server_version==180006
        report['postgresVersion']=db.info.server_version
        model=json.loads(MODEL.read_text());artifacts=[(v,ROOT/'dashboard/backend/migrations'/n,(ROOT/'dashboard/backend/migrations'/n).read_text()) for v,n in [('012','012_orion_pro_domain.sql'),('013','013_orion_pro_integrity.sql')]]
        with db.transaction():
            for path in migration_paths:db.execute(path.read_text(),prepare=False)
            for v,path,_ in artifacts:db.execute('INSERT INTO ingest.schema_migrations(version,content_sha256,applied_at,code_commit) VALUES(%s,%s,CURRENT_TIMESTAMP,%s)',(v,sha(path),'owned-route-guard-e2e'))
            report['bootstrap']=bootstrap(db,model,artifacts)
            for role in ['statarena_ingest','statarena_runtime']:db.execute(f'CREATE ROLE {role} LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS')
            db.execute(role_grants_sql(model,ingest_role='statarena_ingest',runtime_role='statarena_runtime'),prepare=False)
            db.execute('GRANT USAGE ON SCHEMA statarena_app TO statarena_runtime; GRANT SELECT ON ALL TABLES IN SCHEMA statarena_app TO statarena_runtime; GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA statarena_app TO statarena_runtime',prepare=False)
        fixture=ReaderFixture(db,pg.dsn,run,psycopg);report['fixture']=fixture.prepare();report['legacyFixture']=legacy_fixture(db)
        report['proTableCount']=db.execute("SELECT count(*) FROM pg_tables WHERE schemaname IN ('ingest','football','analytics')").fetchone()[0]
        report['legacyTableCount']=db.execute("SELECT count(*) FROM pg_tables WHERE schemaname='statarena_app'").fetchone()[0]
        assert report['proTableCount']==94 and report['legacyTableCount']>100
        for label,source in [('baseline',baseline),('candidate',app)]:
            runtime,export=export_runtime(run,label,source);report['runtimeExports'].append(export)
            env={k:os.environ[k] for k in ['PATH','HOME','TMPDIR','USER','LANG','LC_ALL'] if k in os.environ}
            env.update(DATABASE_URL=f'postgresql://statarena_runtime@127.0.0.1:{pg.port}/postgres?sslmode=disable',STATARENA_DATA_PROVIDER='aws',STATARENA_TEST_DATABASE='1',
              STATARENA_PRO_API='1',STATARENA_CLOUDFRONT_URL='https://cdn.fixture.invalid',STATARENA_METRICS_SAMPLE_RATE='0',
              ORION_GUARD_RUNTIME=str(runtime),ORION_GUARD_RUNTIME_LABEL=label)
            out=(run/f'{label}.stdout.log').open('w');err=(run/f'{label}.stderr.log').open('w');streams.extend([out,err])
            process=subprocess.Popen(['bun','--no-env-file',str(BASE/'guard_http_server.mjs')],cwd=runtime/'dashboard',env=env,stdout=subprocess.PIPE,stderr=err,text=True,bufsize=1);processes.append(process)
            deadline=time.monotonic()+15
            while time.monotonic()<deadline:
                found,_,_=select.select([process.stdout],[],[],0.1)
                if not found:continue
                line=process.stdout.readline();out.write(line);out.flush()
                if not line and process.poll() is not None:raise RuntimeError(label+' server stopped before ready')
                try:info=json.loads(line)
                except ValueError:continue
                if info.get('event')=='ready':origins[label]=f"http://127.0.0.1:{info['port']}";ready_info[label]=info;break
            assert label in origins,label+' startup timeout'
        report['runtimeSetup']=ready_info
        for case in CASES:
            start_index=len(report['requests'])
            try:
                actual={}
                if case=='owned_runtime':
                    assert all(i['identity']==[{'role':'statarena_runtime','readonly':'on'}] and len(i['calibrations'])==6 for i in ready_info.values())
                    actual={'proTables':report['proTableCount'],'legacyTables':report['legacyTableCount'],'runtime':ready_info}
                elif case=='positive_legacy_off':
                    for label in origins:flag(label,0)
                    controls=[('/api/dashboard/manifest',lambda v:len(v['seasons'])>0),
                      ('/api/fixtures?league=l_000001&season=2026%2F2027&limit=2',lambda v:len(v['data']['matches'])==2),
                      ('/api/seasons/partition?season=2026%2F2027&league=l_000001&limit=2',lambda v:len(v['data']['matches'])==2 and len(v['data']['appearances'])==2),
                      ('/api/scouting/routes?player=p_000001',lambda v:bool(v['routes']['p_000001'])),
                      ('/api/pitchapi/leagues',lambda v:len(v['data']['leagues'])==1),
                      ('/api/pitchapi/players/p_000001',lambda v:v['data']['name']=='Legacy player'),
                      ('/api/pitchapi/matches/m_000001/shots',lambda v:len(v['data']['periods'][0]['shots'])==1),
                      ('/api/matches/m_000001/summary',lambda v:v['data']['match']['id']=='m_000001'),
                      ('/api/archive/matches/m_000001',lambda v:v['fixture']['id']=='m_000001' and bool(v['endpoints'])),
                      ('/api/archives/index?kind=results',lambda v:v['seasons'][0]['matches']==2),
                      ('/api/stadium?id=Q1',lambda v:v['capacity']==12345)]
                    for path,check in controls:
                        r=twins(path);assert r['status']==200 and check(r['value']),r
                        assert r['legacyEntries'] and r['sql'],r
                    for label in origins:flag(label,1)
                    actual={'positiveControls':len(controls)}
                elif case in ['unsupported_get_remaining9','unsupported_head_remaining9','unsupported_conditional_remaining9']:
                    flag('candidate',1);failures=[]
                    for path in blocked:
                        method='HEAD' if case=='unsupported_head_remaining9' else 'GET'
                        h={'if-none-match':'*'} if case=='unsupported_conditional_remaining9' else None
                        r=http(path,method=method,headers=h)
                        try:refused(r)
                        except AssertionError:failures.append({'path':path,'id':r['id'],'status':r['status'],'legacyEntries':r['legacyEntries'],'sqlCount':len(r['sql'])})
                    actual={'requests':9,'failures':failures};assert not failures,actual
                elif case=='typed_entity_frontier':
                    for path in entity_samples:
                        for method in ['GET','HEAD']:
                            r=http(path,method=method)
                            assert not r['legacyEntries'] and not r['legacyMaterializations'] and not r['sourceAccess'],r
                            if path.split('?',1)[0]=='/api/pitchapi/leagues':
                                assert r['status']==200 and r['headers'].get('etag'),r
                                if method=='GET':assert r['value']['data']['leagues'],r
                                conditional=http(path,headers={'if-none-match':r['headers']['etag']})
                                assert conditional['status']==304 and conditional['body']=='';metadata(conditional)
                            else:assert r['status']==400 and not r['sql'],r
                            if method=='HEAD':assert r['body']=='',r
                    invalid=http('/api/scouting/routes?player=p_000001&v=bad')
                    assert invalid['status']==400 and not invalid['sql'] and not invalid['legacyEntries'] and not invalid['sourceAccess'],invalid
                    actual={'supportedForms':8,'remainingClosedForms':9,'positiveEntityWorkflow':'tests/orion_pro_entities_local.py'}
                elif case=='typed_appearance_frontier':
                    base='/api/seasons/partition?season=2024%2F2025&league=l_000001&limit=2'
                    for path in [base,base+'&v=bad']:
                        for method in ['GET','HEAD']:
                            r=http(path,method=method);assert r['status']==400 and not r['sql'],r
                            assert not r['legacyEntries'] and not r['sourceAccess'],r
                            if method=='HEAD':assert r['body']=='',r
                    manifest=http('/api/dashboard/manifest')['value']
                    token=next(e['representationToken'] for e in manifest['editions'] if e['season']=='2024/2025')
                    for method,headers in [('GET',None),('HEAD',None),('GET',{'if-none-match':'*'})]:
                        r=http(base+'&'+qs(v=token),method=method,headers=headers)
                        assert r['status']==503 and r['headers']['cache-control']=='no-store' and not r['headers'].get('etag'),r
                        assert not r['legacyEntries'] and not r['legacyMaterializations'] and not r['sourceAccess'],r
                        if method=='HEAD':assert r['body']=='',r
                    actual={'supportedForms':48,'remainingClosedForms':9,'missingNormalizedCoverage':'503,not fabricated empty','positiveWorkflow':'22appearance+8observed-profile cases'}
                elif case=='typed_fixture_alias_frontier':
                    manifest=http('/api/dashboard/manifest')['value']
                    version=next(e['representationToken'] for e in manifest['editions'] if e['season']=='2024/2025')
                    routes=['/api/pitchapi/date/2024-08-01?status=all','/api/pitchapi/leagues/l_000001/matches?season=2024%2F2025&status=all']
                    for route in routes:
                        for suffix in ['', '&v=bad']:
                            for method in ['GET','HEAD']:
                                r=http(route+suffix,method=method)
                                assert r['status']==400 and not r['sql'] and not r['legacyEntries'] and not r['sourceAccess'],r
                        route+='&'+qs(v=version)
                        r=http(route);assert r['status']==200 and r['headers'].get('etag'),r
                        assert not r['legacyEntries'] and not r['legacyMaterializations'] and not r['sourceAccess'],r
                        for method,headers,status in [('HEAD',None,200),('GET',{'if-none-match':r['headers']['etag']},304)]:
                            check=http(route,method=method,headers=headers)
                            assert check['status']==status and check['body']=='',check
                            assert not check['legacyEntries'] and not check['sourceAccess'],check
                            metadata(check)
                    actual={'supportedForms':48,'remainingClosedForms':9,'aliasForms':2,'positiveWorkflow':'16fixture-alias cases','publicationScope':'one explicit edition per v'}
                elif case=='typed_competitions_frontier':
                    for path in sorted(competition_forms):
                        for method in ['GET','HEAD']:
                            r=http(path+'?unexpected=1',method=method)
                            assert r['status']==400 and not r['sql'] and not r['legacyEntries'] and not r['sourceAccess'],r
                    actual={'competitionForms':8,'supportedForms':48,'remainingClosedForms':9,'positiveWorkflow':'actual app C00–C25'}
                elif case=='typed_native_match_detail_frontier':
                    for form in sorted(native_forms):
                        path=form.replace('{match}','m_000001')
                        for method in ['GET','HEAD']:
                            r=http(path+'?unexpected=1',method=method)
                            assert r['status']==400 and not r['sql'] and not r['legacyEntries'] and not r['sourceAccess'],r
                    manifest=http('/api/dashboard/manifest')['value']
                    version=next(e['representationToken'] for e in manifest['editions'] if e['season']=='2024/2025')
                    old=http('/api/pitchapi/matches/m_000001/events?'+qs(v=version,representation='match-native-v1'))
                    assert old['status']==503 and not old['legacyEntries'] and not old['sourceAccess'],old
                    metadata(old)
                    actual={'nativeForms':6,'supportedForms':48,'remainingClosedForms':9,'legacyReadyRefusesNative':True}
                elif case=='typed_archive_frontier':
                    for form in sorted(archive_forms):
                        path=form.replace('{match}','m_000001')
                        for method in ['GET','HEAD']:
                            r=http(path+'?unexpected=1',method=method)
                            assert r['status']==400 and not r['sql'] and not r['legacyEntries'] and not r['sourceAccess'],r
                    r=http('/api/archives/index?kind=results')
                    assert r['status']==503 and not r['legacyEntries'] and not r['sourceAccess'],r
                    metadata(r)
                    actual={'archiveForms':4,'supportedForms':48,'remainingClosedForms':9,'unboundArchiveRefused':True}
                elif case=='typed_shot_detail_frontier':
                    for form in sorted(shot_forms):
                        path=form.replace('{match}','m_000001').replace('{shot}','s_000001').replace('{player}','p_000001')
                        for method in ['GET','HEAD']:
                            r=http(path+'?unexpected=1',method=method)
                            assert r['status']==400 and not r['sql'] and not r['legacyEntries'] and not r['sourceAccess'],r
                    actual={'shotDetailForms':2,'supportedForms':48,'remainingClosedForms':9}
                elif case=='typed_player_period_frontier':
                    for form in sorted(player_period_forms):
                        path=form.replace('{match}','m_000001').replace('{player}','p_000001')
                        for method in ['GET','HEAD']:
                            r=http(path+'?unexpected=1',method=method)
                            assert r['status']==400 and not r['sql'] and not r['legacyEntries'] and not r['sourceAccess'],r
                    manifest=http('/api/dashboard/manifest')['value']
                    version=next(e['representationToken'] for e in manifest['editions'] if e['season']=='2024/2025')
                    r=http('/api/pitchapi/matches/m_000001/players?'+qs(v=version,representation='match-statistics-v1'))
                    assert r['status']==503 and not r['legacyEntries'] and not r['sourceAccess'],r
                    metadata(r)
                    actual={'playerPeriodForms':4,'supportedForms':48,'remainingClosedForms':9,'legacyReadyRefusesStats':True}
                elif case=='typed_enrichment_frontier':
                    for path in sorted(enrichment_forms):
                        for method in ['GET','HEAD']:
                            r=http(path+'?unexpected=1',method=method)
                            assert r['status']==400 and not r['sql'] and not r['legacyEntries'] and not r['sourceAccess'],r
                    actual={'enrichmentForms':5,'supportedForms':48,'remainingClosedForms':9}
                elif case=='closed_unknown_and_versioned':
                    for path in ['/api/future-native-capability',
                      '/api/pitchapi/matches/m_000001/unregistered?'+qs(v='pro1.1.'+'0'*64)]:refused(http(path))
                elif case=='generic_path_method':
                    for path,method,status in [('/api/%zz','GET',400),('/api/.hidden','GET',403),('/api/settings','POST',405),('/data/raw/anything.json','GET',410)]:
                        r=http(path,method=method);assert r['status']==status and not r['sql'],r
                        if status==405:assert r['headers']['allow']=='GET, HEAD'
                elif case=='operational_exceptions':
                    for path in ['/api/health','/api/status','/api/settings']:
                        for method in ['GET','HEAD']:
                            r=http(path,method=method);assert r['status']==200 and not r['sourceAccess'] and not r['legacyEntries'],r
                            assert not any(re.search(r'\bstatarena(?:_app)?\.',q['sql'],re.I) for q in r['sql']),r
                            if method=='HEAD':assert r['body']==''
                            elif path=='/api/health':assert r['value']['status']=='ok'
                            elif path=='/api/status':assert r['value']['configured'] is True
                            else:assert r['value']['provider']=='AWS' and r['value']['schedule']['activation']=='unknown'
                    actual={'paths':['/api/health','/api/status','/api/settings'],'methods':['GET','HEAD'],'typedOperationalContract':True,'legacyServingCompared':False}
                elif case=='media_valid':
                    for name in ['valid','valid-jpeg','valid-jpg','valid-webp']:
                        for method in ['GET','HEAD']:
                            r=http(asset(name),method=method);assert r['status']==307 and r['body']=='',r
                            assert r['headers']['location']=='https://cdn.fixture.invalid/data/'+report['legacyFixture']['assets'][name]['path']
                            assert not r['sourceAccess'] and not r['legacyEntries']
                elif case=='media_bad_path':
                    for name in ['json','json-gz','mutable','traversal','url-path','absent']:
                        r=http(asset(name));assert r['status']==(404 if name=='absent' else 503) and r['headers']['cache-control']=='no-store' and 'location' not in r['headers'] and not r['sourceAccess'],r
                elif case=='media_bad_mime':
                    for name in ['wrong-mime','mismatch']:
                        r=http(asset(name));assert r['status']==503 and 'location' not in r['headers'] and not r['sourceAccess'],r
                elif case=='media_cache_mode_isolation':
                    flag('candidate',0);old=http(asset('poison'));assert old['status']==307,old
                    flag('candidate',1);new=http(asset('poison'));assert new['status']==503 and 'location' not in new['headers'],new
                    actual={'offStatus':old['status'],'onStatus':new['status'],'onSqlCount':len(new['sql'])}
                elif case=='native_v1_golden_bytes':
                    for label in origins:flag(label,1)
                    current=twins('/api/dashboard/manifest');assert current['status']==200
                    values['tokens']={k:next(e['representationToken'] for e in current['value']['editions'] if e['season']==s) for k,s in [('A','2024/2025'),('B','2025/2026'),('C','2026/2027')]}
                    a=values['tokens']['A'];paths=['/api/dashboard/manifest?'+qs(v=a),'/api/fixtures?'+qs(league='l_000001',season='2024/2025',limit=2,v=a),
                      '/api/matches/m_000001/summary?'+qs(v=a),'/api/pitchapi/matches/m_000001/shots?'+qs(v=a)]
                    values['old']={path:twins(path) for path in paths}
                    assert all(r['status']==200 for r in values['old'].values())
                    page=twins('/api/fixtures?league=l_000001&season=2024%2F2025&limit=2');values['cursor']=page['value']['pagination']['nextCursor']
                    values['oldC']=twins('/api/matches/m_000005/summary?'+qs(v=values['tokens']['C']))
                    values['oldCPage']=twins('/api/fixtures?'+qs(league='l_000001',season='2026/2027',limit=1,v=values['tokens']['C']))
                    shot=next(r for p,r in values['old'].items() if '/shots?' in p)['value']['data']['periods'][0]['shots'][0]
                    assert shot['event_type']=='' and shot['is_goal'] is True and shot['x']==52.5 and shot['y']==34
                    actual={'pathsCompared':len(paths),'tokens':values['tokens']}
                elif case=='native_cold_head_304':
                    assert 'old' in values,'Dependent golden case not accepted'
                    for path,old in values['old'].items():
                        for label in origins:
                            head=http(path,label=label,method='HEAD');assert head['status']==200 and head['body']=='' and head['headers']['etag']==old['headers']['etag'];metadata(head)
                            conditional=http(path,label=label,headers={'if-none-match':head['headers']['etag']});assert conditional['status']==304 and conditional['body']=='';metadata(conditional)
                elif case=='correction_publication':
                    assert 'tokens' in values,'Dependent golden case not accepted'
                    report['correction']=fixture.correct();m=twins('/api/dashboard/manifest')['value']
                    values['newTokens']={k:next(e['representationToken'] for e in m['editions'] if e['season']==s) for k,s in [('A','2024/2025'),('B','2025/2026'),('C','2026/2027')]}
                    for k in ['A','B']:assert values['newTokens'][k]!=values['tokens'][k]
                    assert all(e['datasetGeneration']!=e['catalogGeneration'] for e in m['editions'] if e['season'] in ['2024/2025','2025/2026'])
                elif case=='old_pinned_v1':
                    for path,old in values['old'].items():
                        r=twins(path);identical(old,r)
                        r=twins(path,headers={'if-none-match':old['headers']['etag']});assert r['status']==304;metadata(r)
                elif case=='independent_C_and_stale_cursor':
                    assert values['newTokens']['C']==values['tokens']['C']
                    c=twins('/api/matches/m_000005/summary?'+qs(v=values['tokens']['C']));identical(values['oldC'],c)
                    cpage=twins('/api/fixtures?'+qs(league='l_000001',season='2026/2027',limit=1,v=values['tokens']['C']));identical(values['oldCPage'],cpage)
                    stale=twins('/api/fixtures?'+qs(league='l_000001',season='2024/2025',limit=2,cursor=values['cursor']));assert stale['status']==409 and stale['headers']['cache-control']=='no-store'
                elif case=='role_readonly':
                    with psycopg.connect(f'host=127.0.0.1 port={pg.port} dbname=postgres user=statarena_runtime',autocommit=True) as runtime_db:
                        runtime_db.execute('SET default_transaction_read_only=off')
                        try:runtime_db.execute("UPDATE football.players SET display_name='forbidden' WHERE false")
                        except psycopg.Error as e:assert e.sqlstate=='42501';actual={'sqlstate':e.sqlstate}
                        else:raise AssertionError('Runtime acquired write privilege')
                elif case=='source_access_audit':
                    for label in origins:
                        _,_,body=raw(origins[label]+'/__e2e__/all');(run/f'{label}-trace.json').write_text(body+'\n')
                    assert not any(r['sourceAccess'] for r in report['requests'])
                    actual={'sourceAccessCalls':0,'moduleGraphObjectProviderTransports':0,'businessHttpRequests':len(report['requests'])}
                report['cases'].append({'case':case,'status':'pass','actual':actual,'requestIds':[r['id'] for r in report['requests'][start_index:]]})
            except Exception as error:
                report['cases'].append({'case':case,'status':'fail','error':str(error)[:10000],'requestIds':[r['id'] for r in report['requests'][start_index:]]})
            print(json.dumps({'event':'case','case':case,'status':report['cases'][-1]['status']}),flush=True)
    except Exception as error:
        critical=str(error);report['setupError']=critical
    finally:
        for process in reversed(processes):
            if process.poll() is None:
                process.terminate()
                try:process.wait(timeout=8)
                except subprocess.TimeoutExpired:process.kill();process.wait(timeout=5)
        for stream in streams:stream.close()
        if db is not None:db.close()
        report['cleanup']={**pg.cleanup(),'apiStopped':all(p.poll() is not None for p in processes)}
        done={c['case'] for c in report['cases']}
        report['cases'] += [{'case':c,'status':'unverified','reason':critical or 'Prerequisite failed'} for c in CASES if c not in done]
        report['sourceChangesDuringRun']=[str(p.relative_to(ROOT)) for p in all_sources if sha(p)!=report['sourceSha256'][str(p.relative_to(ROOT))]]
        report['counts']={s:sum(c['status']==s for c in report['cases']) for s in ['pass','fail','unverified']}
        report['status']='pass' if report['counts']=={'pass':len(CASES),'fail':0,'unverified':0} and not report['sourceChangesDuringRun'] else 'fail'
        report['finishedAt']=datetime.now(timezone.utc).isoformat();(run/'result.json').write_text(json.dumps(report,indent=2,default=str)+'\n')
        print(json.dumps({'status':report['status'],'counts':report['counts'],'receipt':str((run/'result.json').relative_to(ROOT))}),flush=True)
    return report['status']!='pass'


if __name__=='__main__':raise SystemExit(main())
