#!/usr/bin/env python3
"""Pre-code complete local streaming E2E; no PG until separate ROOT hash release."""
from __future__ import annotations
import argparse
from datetime import datetime,timezone,timedelta
from decimal import Decimal
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import threading
import tempfile
import _thread
import time
import traceback
import types
from orion_e2e_process import run_bounded

sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[1]
BASE=ROOT/'docs/verification/orion-pro-bulk-stream-v2-local-20261105'
SCRIPTS=ROOT/'dashboard/scripts'
PILOT=ROOT/'docs/verification/orion-pro-pilot-20261104'
WRITER=SCRIPTS/'orion_pro_bulk_stream_v2.py'
FIXTURE=ROOT/'tests/orion_pro_bulk_stream_local.py'
MODEL=ROOT/'docs/architecture/orion-plan-20261104/target-schema.proposed.json'
SQL=[ROOT/'dashboard/backend/migrations'/n for n in ['012_orion_pro_domain.sql','013_orion_pro_integrity.sql']]
SQL14=ROOT/'dashboard/backend/migrations/014_orion_pro_membership_nonnull.sql'
VERSION='source_free_stream_v2_fixture_v1'
CASES=['implementation_available','campaign_release','owned_setup_and_compact_fixture','offline_default',
       'exact_policy_pair_and_ownership','endpoint_runtime_and_route_refusals','source_and_binding_drift',
       'target_bootstrap_collision','policy_catalogue_drift','unowned_and_forward_source','reservation_bounds','bounded_self_graph_and_native_cycle',
       'metadata_and_encoded_row_bounds','compact_default_readonly','wrong_control_component',
       'corruption_phase_oracle','compact_mid_copy_rollback_gaps','compact_deadline_rollback',
       'compact_control_receipt_corruption','compact_lost_commit_ack','closed_history_refusal','compact_exact_native_oracle',
       'dense_fixture_once','dense_core_commit_interruption','dense_families_rollback_and_resume',
       'dense_native94_and_controls','dense_noop_next_identity','no_publish_source_or_legacy_cleanup',
       'frozen_inputs_and_owned_cleanup']
CLOSED_ATTEMPT={'docs/verification/orion-pro-bulk-stream-v2-local-20261105/campaign.json': 'b745827156ffdcca511f204e026d59eb770f04c164be3a0b3babb12dea4b8fa2', 'docs/verification/orion-pro-bulk-stream-v2-local-20261105/ROOT_CAMPAIGN_AUTHORIZATION.json': 'df8020bcffe1f78bbc7d8f8cffc2000f0708f103ff14cabb5a664bc662e955fb', 'docs/verification/orion-pro-bulk-stream-v2-local-20261105/attempt-1-closed/HASHES.json': '8cdc5ee9b07595cd4e514a15a1e3256212c0ef5667ae7acc01e452191f0b355e', 'docs/verification/orion-pro-bulk-stream-v2-local-20261105/runs/20261105T092838120236Z-root-exact-controls-compact-then-dense/result.json': '04e9ea78f01f3e44790e0fc3fbc50cb446c2883be815ccd9067bf4df44e1a896', 'docs/verification/orion-pro-bulk-stream-v2-local-20261105/campaign-continuation-v2.json': '1cdc77a2935ede9689dbb5a4427114ec4fbbde151d73386db7d452b63a1a7909', 'docs/verification/orion-pro-bulk-stream-v2-local-20261105/ROOT_CAMPAIGN_CONTINUATION_V2.json': 'c75e6a835b106f7018f386dc039172cd6054e827dc0c32a1b394c7ef8ea0a8b2', 'docs/verification/orion-pro-bulk-stream-v2-local-20261105/attempt-2-closed/HASHES.json': '103e6bd83df70d2ef85c0f95345d4d0f28af4d99aa12ffa77f8998655a5b0f0a', 'docs/verification/orion-pro-bulk-stream-v2-local-20261105/runs/20261105T094145641492Z-root-owned-fixture-restoration-continuation-v2/result.json': 'b3e577198af609291d05843d2dd3bee8423f8b7843abe26c7ad6e4b7eaaed5ab', 'docs/verification/orion-pro-bulk-stream-v2-local-20261105/campaign-continuation-v3.json': '5c03b262a99cdfbd6e7ae91ebc23c4f32426b9cc1a54413131895d86218285cd', 'docs/verification/orion-pro-bulk-stream-v2-local-20261105/ROOT_CAMPAIGN_CONTINUATION_V3.json': 'ff6fd508d296ffae9726b4092e34bd726842a99bec7404160ccc4e261872a2ae', 'docs/verification/orion-pro-bulk-stream-v2-local-20261105/attempt-3-closed/HASHES.json': '1ddf3fa9d7a5619eee8ba8af2a1225ed3290099c95aafc0ab3ce8f4a1cde4b8e', 'docs/verification/orion-pro-bulk-stream-v2-local-20261105/runs/20261105T094747460304Z-root-bootstrap-aware-compact-and-dense-v3/result.json': '30c4e7fd6e85b3cb2c84808f09f69c30a4fe1c0722780a9649a9a1fa0b6a47d3'}
CONTROL={'ingest.dataset_snapshots','ingest.import_runs','ingest.schema_migrations'}
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def hashed(x):return hashlib.sha256(json.dumps(x,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
def save(p,x):p.write_text(json.dumps(x,indent=2,ensure_ascii=False,default=str)+'\n')
def load(p,name):
    s=importlib.util.spec_from_file_location(name,p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
def q(x):return '"'+x+'"'

class Budget:
    def __init__(self,pg,run):
        self.pg,self.run=pg,run;self.start=time.monotonic();self.stop=threading.Event();self.reason=None;self.samples=[]
        self.path=BASE/'campaign-continuation-v4.json';assert not self.path.exists(),'Single campaign already consumed'
        self.data={'maximumPgStarts':1,'pgStarts':1,'denseSourceConstructions':0,'denseCoreCopies':0,'startedAt':datetime.now(timezone.utc).isoformat()};save(self.path,self.data)
        self.thread=threading.Thread(target=self.watch,daemon=True);self.thread.start()
    def watch(self):
        while not self.stop.wait(2):
            disk=int(subprocess.check_output(['du','-sk',str(self.pg.root)],text=True).split()[0])*1024;proof=sum(p.stat().st_size for p in BASE.rglob('*') if p.is_file());elapsed=time.monotonic()-self.start
            self.samples.append({'seconds':round(elapsed,3),'ownedBytes':disk,'proofBytes':proof})
            if disk>=7*1024**3 or proof>=64*1024**2 or elapsed>=1200:self.reason='campaign_resource_limit';_thread.interrupt_main();return
    def close(self,ok):
        self.stop.set();self.thread.join(4);self.data.update(status='pass' if ok else 'STOP_FOR_ROOT',elapsedSeconds=round(time.monotonic()-self.start,3),reason=self.reason);save(self.path,self.data);save(self.run/'resources.json',self.samples);return self.data

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--label',default='stream-v2');ap.add_argument('--precode-only',action='store_true');ap.add_argument('--run-compact-and-dense',action='store_true');ap.add_argument('--pg-bin',type=Path,default=Path('/tmp/statarena-cache-test-tools/node_modules/@embedded-postgres/darwin-arm64/native/bin'));args=ap.parse_args()
    for key in tuple(os.environ):
        if key.startswith('PG'):os.environ.pop(key)
    os.environ['PGHOSTADDR']='127.0.0.1'
    sys.path[:0]=[str(SCRIPTS),str(PILOT),str(ROOT/'tests'),'/tmp/statarena-publication-test-python']
    run=BASE/'runs'/(datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')+'-'+args.label);(run/'inputs').mkdir(parents=True)
    model=json.loads(MODEL.read_text());tables={t['qualified_name']:t for s in model['schemas'] for t in s['tables'] if t['phase']!='models'}
    report={'kind':'source_free_stream_v2_local_e2e','startedAt':datetime.now(timezone.utc).isoformat(),'command':['python3','tests/orion_pro_bulk_stream_v2_local.py',*sys.argv[1:]],'expected':'PROTOCOL.md','cases':[],'invocations':[],'sourceSha256':{},'remoteActions':[],'sourceRamReads':0,'fullAcceptance':False,'denseSourceConstructions':0}
    paths=[Path(__file__),ROOT/'tests/orion_e2e_process.py',WRITER,BASE/'ROOT_REVISION_PROTOCOL.md',BASE/'ROOT_CAMPAIGN_CONTINUATION_V4.json',BASE/'PROTOCOL.md',BASE/'BINDINGS_V2.json',FIXTURE,ROOT/'tests/orion_pro_bulk_local.py',MODEL,*SQL,SQL14,SCRIPTS/'orion_pro_policy.py',SCRIPTS/'orion_pro_upgrade.py',SCRIPTS/'orion_pro_bulk.py',SCRIPTS/'orion_pro_schema.py',SCRIPTS/'orion_pro_integrity.py',SCRIPTS/'orion_pro_migrate.py',PILOT/'harness.py']
    for path in paths:
        if path.exists():
            dest=run/'inputs'/path.relative_to(ROOT);dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(path,dest);report['sourceSha256'][str(path.relative_to(ROOT))]=sha(path)
    pg=budget=admin=source=target=None;blocker=None;pair_path=acceptance_path=marker=None;producer=None;phases=[];dense=False
    env={k:v for k,v in os.environ.items() if k in ['PATH','HOME','USER','TMPDIR','LANG']};env.update(PYTHONDONTWRITEBYTECODE='1',PYTHONPATH='/tmp/statarena-publication-test-python',PGHOSTADDR='203.0.113.77')
    def connect(database,actor='policy_owner'):
        import psycopg
        return psycopg.connect(host='127.0.0.1',hostaddr='127.0.0.1',port=pg.port,dbname=database,user=actor,autocommit=True,options='-c statement_timeout=8000 -c lock_timeout=1000 -c timezone=UTC -c datestyle=ISO,YMD')
    def close_owners():
        nonlocal source,target
        for c in [source,target]:
            if c is not None:c.close()
        source=target=None
    def open_owners():
        nonlocal source,target
        source=connect('policy_facts');target=connect('policy_empty')
    def independent(conn):
        from orion_pro_bulk_local import oracle
        return oracle(conn,tables)
    def state(conn):
        from orion_pro_bulk_local import sequences
        return {'tables':independent(conn),'sequences':sequences(conn)}
    def install(conn):
        import orion_pro_policy as policy
        from orion_pro_migrate import bootstrap
        from orion_pro_integrity import role_grants_sql
        with conn.transaction():
            artifacts=[(v,p,p.read_text()) for v,p in zip(['012','013'],SQL)]
            for v,p,body in artifacts:conn.execute(body,prepare=False);conn.execute('INSERT INTO ingest.schema_migrations(version,content_sha256,applied_at,code_commit) VALUES(%s,%s,CURRENT_TIMESTAMP,%s)',(v,sha(p),'local-stream-v2-fixture'))
            bootstrap(conn,model,artifacts);conn.execute(role_grants_sql(model,'policy_ingest','policy_runtime'),prepare=False)
        # Owner setup only: source becomes an explicitly described overlay; target is journalled014.
        with conn.transaction():
            conn.execute(SQL14.read_text(),prepare=False)
            if conn.info.dbname=='policy_empty':conn.execute('INSERT INTO ingest.schema_migrations(version,content_sha256,applied_at,code_commit) VALUES(%s,%s,CURRENT_TIMESTAMP,%s)',('014',sha(SQL14),'local-stream-v2-fixture'))
    def make_fixture(large=False):
        nonlocal producer,phases,dense
        from orion_pro_bulk_local import hashed as fixture_hashed
        fm=load(FIXTURE,'frozen_stream_native_fixture');shape={'APPEARANCES':15437 if large else 40,'SCALARS':478547 if large else 1240,'MATCHES':612 if large else 4,'PLAYERS':800 if large else 40,'VERSION':VERSION}
        producer=fixture_hashed({'frozenFixtureSha256':sha(FIXTURE),'e2eSha256':sha(Path(__file__)),'version':VERSION,'shape':shape});fn=types.FunctionType(fm.fixture.__code__,{**fm.fixture.__globals__,**shape});evidence=run/('dense-source' if large else 'compact-source-'+str(len(list(run.glob('compact-source-*')))));evidence.mkdir()
        # Supplement the frozen producer only before its native first seal.
        # Exact supplemental bytes live in this E2E hash, never in the old fixture.
        class FixtureConnection:
            def __init__(self,conn):self.conn=conn;self.core=True
            def __getattr__(self,key):return getattr(self.conn,key)
            def execute(self,sql,params=None,**kw):
                if sql=='SELECT ingest.seal_generation(%s,%s)' and self.core:
                    self.core=False;generation=params[0];edition=self.conn.execute('SELECT revision_id FROM football.competition_seasons WHERE id=101').fetchone()[0]
                    stages=([(500,10,None,None),(400,2,500,10)] if large else
                            [(5000,2000,None,None),*[(10000+i,i,None,None) for i in range(3,1011)],(400,2,5000,2000)])
                    for identifier,revision,parent,parent_revision in stages:
                        self.conn.execute('''INSERT INTO football.competition_stages(id,revision_id,competition_season_id,competition_season_revision_id,parent_stage_id,parent_stage_revision_id,stage_key,stage_type,name,recorded_from_gen,variant_key,is_canonical,contract_version,transform_version,transform_code_sha256,provenance_kind)
                          OVERRIDING SYSTEM VALUE VALUES(%s,%s,101,%s,%s,%s,%s,'league',%s,%s,'stream:primary',true,%s,%s,%s,'manual')''',(identifier,revision,edition,parent,parent_revision,'stage-'+str(identifier),'Stage '+str(identifier),generation,VERSION,VERSION,producer))
                return self.conn.execute(sql,params,**kw)
        with connect('policy_facts','policy_ingest') as writer:phases=fn(FixtureConnection(writer),model,producer,evidence)
        dense=large
        if large:
            report['denseSourceConstructions']+=1;assert report['denseSourceConstructions']==1;budget.data['denseSourceConstructions']=1;save(budget.path,budget.data)
    def bind():
        nonlocal pair_path,acceptance_path
        import orion_pro_policy as policy
        loaded=policy.load_policy(policy.P1);assert loaded['manifestSha256']=='6ecdf33f7084eba21eb31198621a50cd01a53309c303d8c221908c07503e2a92'
        native=independent(source);cat=policy.catalogue(source);target_cat=policy.catalogue(target)
        source_descriptor={'kind':'exact_local_typed_p1_overlay_v1','modelSha256':sha(MODEL),'catalogueSha256':cat['sha256'],'functionSqlSha256':'30f86fa262fd4cf10307e78431350f25b9d7a5b353d0c76abc0594340edb5d20','functionProperties':policy.function_properties(source),'journal':list(source.execute('SELECT version,content_sha256,code_commit FROM ingest.schema_migrations ORDER BY version')),'producerSha256':producer,'producerVersion':VERSION,'producerOrigin':'owned_source_free_fixture','fixtureCodeSha256':sha(FIXTURE),'fixtureE2eSha256':sha(Path(__file__))}
        target_descriptor={'kind':'exact_local_guard_v2_p1_journal_v1','manifestSha256':loaded['manifestSha256'],'catalogueSha256':target_cat['sha256'],'journal':list(target.execute('SELECT version,content_sha256,code_commit FROM ingest.schema_migrations ORDER BY version')),'functionProperties':policy.function_properties(target),'sourceRole':'policy_runtime','targetRole':'policy_ingest'}
        for descriptor,connection in [(source_descriptor,source),(target_descriptor,target)]:
            descriptor['journalNativeSha256']=independent(connection)['ingest.schema_migrations']['sha256']
            descriptor['bootstrapNativeText']=connection.execute("SELECT ROW(s.*)::text FROM ingest.dataset_snapshots s WHERE transform_version='bootstrap_v1'").fetchone()[0]
        pair={'kind':'explicit_stream_v2_local_policy_pair_v1','localOnly':True,'source':source_descriptor,'target':target_descriptor,'writerSha256':sha(WRITER),'bindingSha256':sha(BASE/'BINDINGS_V2.json')}
        pair_path=run/('pair-'+str(len(list(run.glob('pair-*.json'))))+'.json');save(pair_path,pair)
        accepted={'kind':'orion_pro_bulk_stream_v2_local_acceptance_v1','localOnly':True,'writerSha256':sha(WRITER),'modelSha256':sha(MODEL),'bindingsSha256':sha(BASE/'BINDINGS_V2.json'),'pairSha256':sha(pair_path),'sourceNativeSha256':hashed(native),'sourceTables':native,'sourceRows':sum(v['rows'] for v in native.values()),'sourcePhases':phases,'producerSha256':producer,'producerVersion':VERSION,'fixtureOrigin':'owned_source_free_fixture','fixtureShape':{'scalarRows':478547 if dense else 1240,'appearances':15437 if dense else 40,'metrics':31,'matches':612 if dense else 4}}
        acceptance_path=run/('acceptance-'+str(len(list(run.glob('acceptance-*.json'))))+'.json');save(acceptance_path,accepted);return accepted
    def reset(target_only=False,large=False):
        close_owners()
        for db in (['policy_empty'] if target_only else ['policy_facts','policy_empty']):
            with connect(db) as c:
                for schema in ['analytics','football','ingest']:c.execute('DROP SCHEMA IF EXISTS '+q(schema)+' CASCADE')
                install(c)
        open_owners()
        if not target_only:make_fixture(large)
        # Legal gaps are deliberate and never reset by the writer.
        with connect('policy_empty','policy_ingest') as c:
            c.execute("SELECT nextval('ingest.dataset_snapshots_id_seq')")
            c.execute('BEGIN');c.execute("SELECT ingest.begin_generation('rolled-back-gap','test_gap','test_gap')");c.rollback()
        return bind()
    def invoke(apply=False,fault=None,expected=None,mutated=None):
        nonlocal source,target
        path=acceptance_path
        if mutated:
            body=json.loads(path.read_text());body.update(mutated);path=run/('mutated-'+str(len(report['invocations']))+'.json');save(path,body)
        output=run/('writer-'+str(len(report['invocations']))+'.json');cmd=['python3',str(WRITER),'--marker',str(marker),'--pair',str(pair_path),'--pair-sha256',sha(pair_path),'--acceptance',str(path),'--acceptance-sha256',sha(path),'--report',str(output),'--apply-local' if apply else '--preflight-local']
        if fault:cmd+=['--fault',fault]
        close_owners();start=time.monotonic()
        try:
            got=run_bounded(cmd,cwd=ROOT,env=env,deadline=budget.start+1200,stop_reason=lambda:budget.reason);data=json.loads(output.read_text()) if output.exists() else json.loads(got.stdout)
        finally:open_owners()
        report['invocations'].append({'command':cmd,'exitCode':got.returncode,'elapsedMs':round((time.monotonic()-start)*1000,3),'report':output.name,'result':data})
        if expected:assert got.returncode!=0 and data.get('reasonCode') in expected,(data.get('reasonCode'),expected)
        else:assert got.returncode==0,data
        return data
    def original_compact():return reset(False,False)
    try:
        for name in CASES:
            if blocker or (args.precode_only and name!='implementation_available'):
                report['cases'].append({'case':name,'status':'unverified','reason':blocker or 'No campaign authorized/executed'});continue
            started=time.monotonic()
            try:
                actual={}
                if name=='implementation_available':assert WRITER.is_file(),'Streaming v2 implementation is absent';actual={'writerSha256':sha(WRITER)}
                elif name=='campaign_release':
                    assert args.run_compact_and_dense,'Only pre-code mode is allowed without explicit --run-compact-and-dense'
                    assert all(sha(ROOT/p)==h for p,h in CLOSED_ATTEMPT.items()),'Closed first campaign changed'
                    release=json.loads((BASE/'ROOT_CAMPAIGN_CONTINUATION_V4.json').read_text());assert release['previousAttempt']==CLOSED_ATTEMPT;assert release['status']=='approved_one_dense_campaign' and release['approvedBy']=='ROOT' and release['writerSha256']==sha(WRITER) and release['e2eSha256']==sha(Path(__file__)) and release['bindingsSha256']==sha(BASE/'BINDINGS_V2.json') and release['processHelperSha256']==sha(ROOT/'tests/orion_e2e_process.py');actual=release
                elif name=='owned_setup_and_compact_fixture':
                    import psycopg
                    from harness import LocalPostgres
                    tempfile.tempdir='/tmp' # Keep the owned Unix socket under the platform path limit.
                    pg=LocalPostgres(args.pg_bin,run);budget=Budget(pg,run);pg.command([pg.binaries/'initdb','-D',pg.data,'--auth=trust','--no-locale','--encoding=UTF8'],name='initdb')
                    with (pg.data/'postgresql.conf').open('a') as f:f.write('\nstatement_timeout=8000\nlock_timeout=1000\ntemp_file_limit=512MB\nlog_error_verbosity=terse\nlog_min_error_statement=panic\nlog_parameter_max_length_on_error=0\n')
                    pg.start();admin=connect('postgres',os.environ.get('USER','postgres'));assert admin.info.server_version==180006
                    for role in ['policy_owner','policy_ingest','policy_runtime']:admin.execute('CREATE ROLE '+role+' LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS')
                    for db in ['policy_facts','policy_empty']:admin.execute('CREATE DATABASE '+db+' OWNER policy_owner')
                    for db in ['policy_facts','policy_empty']:
                        with connect(db) as c:c.execute("CREATE TABLE public.stream_v2_legacy_sentinel(id integer PRIMARY KEY,value text NOT NULL)");c.execute("INSERT INTO public.stream_v2_legacy_sentinel VALUES(1,'legacy unchanged')")
                    marker=pg.root/'stream-v2-marker.json';save(marker,{'kind':'orion_owned_stream_v2_pg18','ownedRoot':str(pg.root),'port':pg.port,'postmasterStartedAt':admin.execute('SELECT pg_postmaster_start_time()::text').fetchone()[0],'sourceDatabase':'policy_facts','targetDatabase':'policy_empty'});marker.chmod(0o600);original_compact();actual={'version':VERSION,'producerSha256':producer,'phases':phases}
                elif name=='offline_default':
                    got=run_bounded(['python3',str(WRITER)],cwd=ROOT,env=env,deadline=min(budget.start+1200,time.monotonic()+10),stop_reason=lambda:budget.reason);data=json.loads(got.stdout);assert got.returncode==0 and data['status']=='offline_plan' and data['connections']==0;actual=data
                elif name=='exact_policy_pair_and_ownership':
                    data=invoke();assert data['controlComponents']==106 and data['copyRelations']==74 and data['regeneratedControls']==3 and data['forcedEmptyRelations']==17 and data['ownershipDictionaryRows']==0
                    assert data['plans'] and all(p['mode']=='EXPLAIN_ANALYZE_OWNERSHIP' and p['actualRows']<=500000 and p['tempBlocks']<=65536 for p in data['plans']);assert data['selfGraphTables']==3;actual=data
                elif name=='endpoint_runtime_and_route_refusals':
                    import psycopg
                    old=marker.read_text();body=json.loads(old);body['port']+=1;save(marker,body)
                    try:bad=invoke(expected={'LOCAL_ONLY'})
                    finally:marker.write_text(old);marker.chmod(0o600)
                    with connect('policy_empty','policy_runtime') as c:
                        try:
                            with c.cursor().copy('COPY ingest.sources(id,code,name) FROM STDIN') as cp:cp.write(b'999\tdenied\tdenied\n')
                        except psycopg.Error as e:assert e.sqlstate=='42501'
                        else:raise AssertionError('Runtime COPY must be denied')
                    actual={'markerRefusal':bad,'nativeRuntimeSqlstate':'42501','poisonEnvTargetRouteStillOwned':True}
                elif name=='source_and_binding_drift':
                    a=invoke(expected={'BINDING'},mutated={'producerSha256':'0'*64});source.execute("UPDATE ingest.sources SET name=name||':drift' WHERE id=2")
                    try:c=invoke(expected={'SOURCE_DRIFT'})
                    finally:source.execute("UPDATE ingest.sources SET name=left(name,length(name)-6) WHERE id=2")
                    source.execute(SQL[1].read_text()[SQL[1].read_text().index('CREATE OR REPLACE FUNCTION "ingest"."validate_generation"('):].split('$orion_pro$;',1)[0]+'$orion_pro$;',prepare=False)
                    try:policy=invoke(expected={'SOURCE_POLICY'})
                    finally:source.execute(SQL14.read_text(),prepare=False)
                    actual={'wrongProducer':a,'sourceValue':c,'P0BodyUnqualified':policy}
                elif name=='target_bootstrap_collision':
                    target.execute("INSERT INTO ingest.sources(id,code,name) OVERRIDING SYSTEM VALUE VALUES(999,'foreign','foreign')")
                    data=invoke(expected={'TARGET_DRIFT'});reset(True);actual=data
                elif name=='policy_catalogue_drift':
                    import orion_pro_policy as policy
                    view=next(r[1] for r in policy.catalogue(target)['rows'] if r[0]=='view');target.execute('ALTER VIEW '+'.'.join(map(q,view.split('.')))+' SET (security_barrier=true)')
                    try:data=invoke(expected={'TARGET_POLICY'})
                    finally:reset(True)
                    actual=data
                elif name=='unowned_and_forward_source':
                    source.execute("INSERT INTO ingest.import_runs(id,mode,transform_version,code_commit) OVERRIDING SYSTEM VALUE VALUES(99,'backfill',%s,%s)",(VERSION,producer));bind();a=invoke(expected={'SOURCE_RECEIPT'});source.execute('DELETE FROM ingest.import_runs WHERE id=99')
                    source.execute("INSERT INTO ingest.document_lineage(derived_document_id,parent_document_id,transform_version) VALUES(11,31,%s)",(VERSION,));bind();b=invoke(expected={'PHASE_OWNERSHIP'});original_compact();actual={'unownedRun':a,'futureParent':b,'restore':'Recreate the two owned compact fixture schemas; immutable source guard remains enabled'}
                elif name=='reservation_bounds':
                    source.execute("INSERT INTO ingest.sources(id,code,name) OVERRIDING SYSTEM VALUE VALUES(1000001,'bound','bound')");bind();before=state(target);data=invoke(expected={'RESERVATION_BOUND'});assert state(target)==before;original_compact();actual=data
                elif name=='bounded_self_graph_and_native_cycle':
                    import psycopg
                    try:source.execute('UPDATE ingest.sources SET upstream_source_id=2 WHERE id=10')
                    except psycopg.Error as e:assert e.sqlstate=='23514'
                    else:raise AssertionError('Native source cycle must reject')
                    source.execute("INSERT INTO ingest.sources(id,code,name) OVERRIDING SYSTEM VALUE SELECT i,'bound_'||i,'bound' FROM generate_series(3000,7100) i");bind();data=invoke(expected={'SELF_GRAPH_BOUND'});original_compact();actual={'nativeCycleSqlstate':'23514','graphBound':data}
                elif name=='metadata_and_encoded_row_bounds':
                    source.execute("UPDATE ingest.sources SET name=repeat('x',1048577) WHERE id=2");bind();data=invoke(expected={'SOURCE_BOUND'});original_compact();actual=data
                elif name=='compact_default_readonly':
                    before=state(target);data=invoke();assert data['copyCommands']==0 and data['nextvalCalls']==0 and state(target)==before;actual=data
                elif name in ['wrong_control_component','corruption_phase_oracle','compact_mid_copy_rollback_gaps','compact_deadline_rollback']:
                    reset(True);before=state(target);fault={'wrong_control_component':'wrong-generation-map','corruption_phase_oracle':'corrupt-first-fact','compact_mid_copy_rollback_gaps':'after-copy-batches:2','compact_deadline_rollback':'before-seal-timeout'}[name];expected={'wrong_control_component':{'NATIVE_FK','PHASE_ORACLE'},'corruption_phase_oracle':{'PHASE_ORACLE'},'compact_mid_copy_rollback_gaps':{'INJECTED_FAILURE'},'compact_deadline_rollback':{'NATIVE_TIMEOUT'}}[name]
                    data=invoke(True,fault,expected);after=state(target);assert after['tables']==before['tables'];assert all(after['sequences'][s][0]>=v[0] for s,v in before['sequences'].items());actual={'failed':data,'rollbackNativeTablesExact':True,'sequenceGapsNotReset':True}
                elif name=='compact_control_receipt_corruption':
                    reset(True);done=invoke(True);before=state(target)
                    row=target.execute("SELECT checkpoint::text,counters::text,started_at,finished_at FROM ingest.import_runs WHERE id=7").fetchone()
                    checkpoint=json.loads(row[0]);counters=json.loads(row[1]);sid=checkpoint['snapshot_id']
                    snap=target.execute('SELECT manifest_sha256,created_at,sealed_at FROM ingest.dataset_snapshots WHERE id=%s',(sid,)).fetchone()
                    def install_control(cp,ct,clocks,manifest):
                        # Owner-corruption fixture only; restore exact guard before the real worker observes it.
                        with target.transaction():
                            target.execute('ALTER TABLE ingest.dataset_snapshots DISABLE TRIGGER pro_typed_guard')
                            target.execute('UPDATE ingest.import_runs SET checkpoint=%s::jsonb,counters=%s::jsonb,started_at=%s,finished_at=%s WHERE id=7',(json.dumps(cp),json.dumps(ct),clocks[0],clocks[1]))
                            target.execute('UPDATE ingest.dataset_snapshots SET manifest_sha256=%s,created_at=%s,sealed_at=%s WHERE id=%s',(manifest,clocks[2],clocks[3],sid))
                            target.execute('ALTER TABLE ingest.dataset_snapshots ENABLE TRIGGER pro_typed_guard')
                    failures={}
                    for variant in ['bad_checksum','unknown_checkpoint_field','fabricated_count','missing_clock','ordered_unequal_clocks']:
                        cp=dict(checkpoint);ct=dict(counters);clocks=[row[2],row[3],snap[1],snap[2]]
                        if variant=='unknown_checkpoint_field':cp['unexpected_field']='synthetic_owner_corruption'
                        elif variant=='fabricated_count':cp['copied_rows']+=1;ct['copied_rows']=cp['copied_rows']
                        elif variant=='missing_clock':cp.pop('transaction_started_at')
                        elif variant=='ordered_unequal_clocks':
                            clocks=[row[2]-timedelta(microseconds=3),row[3]-timedelta(microseconds=2),snap[1]-timedelta(microseconds=4),snap[2]-timedelta(microseconds=1)]
                            assert clocks[2]<clocks[0]<clocks[1]<clocks[3]
                        cp.pop('receipt_sha256',None);cp['receipt_sha256']=hashed(cp)
                        if variant=='bad_checksum':cp['receipt_sha256']='bad'
                        try:
                            install_control(cp,ct,clocks,hashed(cp));failures[variant]=invoke(expected={'TARGET_DRIFT'})['reasonCode']
                        finally:install_control(checkpoint,counters,[row[2],row[3],snap[1],snap[2]],snap[0])
                        assert state(target)==before
                    noop=invoke(True);assert noop['status']=='noop' and noop['copyCommands']==noop['nextvalCalls']==0 and state(target)==before
                    matrix=json.loads((ROOT/'docs/verification/orion-pro-bulk-stream-v2-20261105/OWNERSHIP_MATRIX.json').read_text())
                    source_native=independent(source);source_physical=sum(source_native[n]['rows'] for n in matrix['copiedRelations'])
                    bootstrap_copied=sum(len(rows) for n,rows in model['seed_data'].items() if n in matrix['copiedRelations'])+(len(model['bootstrap']['relation_contracts']) if 'ingest.relation_contracts' in matrix['copiedRelations'] else 0)
                    source_copied=source_physical-bootstrap_copied
                    target_copied=target.execute("SELECT sum((counters->>'copied_rows')::bigint) FROM ingest.import_runs").fetchone()[0]
                    assert target_copied==source_copied
                    actual={'ownerCorruptionRefusals':failures,'restoredNative94AndSequencesExact':True,'noop':noop,'sourcePhysicalRowsInCopiedRelations':source_physical,'bootstrapRowsPreservedWithoutCopy':bootstrap_copied,'sourceCopiedRows':source_copied,'targetCopiedRows':target_copied}
                elif name=='compact_lost_commit_ack':
                    reset(True);lost=invoke(True,'after-commit-ack',{'COMMIT_ACK_UNKNOWN'});prefix=state(target);assert prefix['tables']['football.player_match_metric_values']['rows']==1240
                    done=invoke(True);assert done['reusedPhases']==1 and done['copiedScalarRows']==0;actual={'unknownAck':lost,'freshNativePrefixResume':done}
                elif name=='closed_history_refusal':
                    import psycopg
                    # One legal retained scalar correction, without a collector or guard bypass.
                    with connect('policy_facts','policy_ingest') as c:
                        with c.transaction():
                            g=c.execute("SELECT ingest.begin_generation('closed-fixture','closed_test','closed_test')").fetchone()[0]
                            row=c.execute("SELECT revision_id FROM football.player_match_metric_values WHERE value_kind='number' AND metric_code<>'a_ratio' LIMIT 1").fetchone()[0]
                            c.execute('UPDATE football.player_match_metric_values SET recorded_to_gen=%s WHERE revision_id=%s',(g,row))
                            columns=[column for column in tables['football.player_match_metric_values']['columns'] if column!='revision_id'];projection=[('%s' if k=='recorded_from_gen' else 'NULL' if k=='recorded_to_gen' else "nextval('football.player_match_metric_values_revision_id_seq')" if k=='revision_id' else 'numeric_value+1' if k=='numeric_value' else q(k)) for k in columns]
                            c.execute('INSERT INTO football.player_match_metric_values('+','.join(map(q,columns))+') SELECT '+','.join(projection)+' FROM football.player_match_metric_values WHERE revision_id=%s',(g,row));c.execute('SELECT ingest.seal_generation(%s,%s)',(g,'f'*64))
                    bind();data=invoke(expected={'CLOSED_HISTORY'});original_compact();actual=data
                elif name=='compact_exact_native_oracle':
                    reset(True);data=invoke(True);expected=independent(source);maps=data['generationMap'];snapmaps=data['snapshotMap'];substitutions={}
                    for relation,components in data['controlColumns'].items():
                        substitutions[relation]={col:'CASE '+q(col)+' '+ ' '.join('WHEN '+str(dst)+' THEN '+str(src) for src,dst in (maps if kind=='generation' else snapmaps).items())+' ELSE '+q(col)+' END' for col,kind in components.items()}
                    from orion_pro_bulk_local import oracle
                    actual_rows=oracle(target,tables,substitutions);assert all(actual_rows[n]==expected[n] for n in tables if n not in CONTROL);assert data['controlContractsVerified']==3 and data['nativeRelationsVerified']==91
                    assert expected['football.competition_stages']['rows']==1010 and data['copyTables']['football.competition_stages']['batches']>=2
                    witness=next(w for w in data['selfRankWitnesses'] if w['relation']=='football.competition_stages' and w['childPk']==['2'] and w['parentPk']==['2000'])
                    windows=[w for w in data['selfCopyWindows'] if w['relation']=='football.competition_stages'];parent_window=next(w for w in windows if w['firstRank']<=witness['parentRank']<=w['lastRank']);child_window=next(w for w in windows if w['firstRank']<=witness['childRank']<=w['lastRank'])
                    assert parent_window['copyCommand']<child_window['copyCommand'] and all(a['lastRank']<b['firstRank'] for a,b in zip(windows,windows[1:]));report['crossBatchSelfDag']={'witness':witness,'windows':windows,'nativeOracleExact':True}
                    precise=target.execute("SELECT numeric_value::text FROM football.player_match_metric_values WHERE metric_code='a_ratio' LIMIT 1").fetchone()[0];assert precise=='12345678901234567890123456789.1234567890123456789';report['compactOracle']={'source':expected,'targetInverse':actual_rows};actual=data
                elif name=='dense_fixture_once':
                    reset(False,True);assert source.execute('SELECT count(*) FROM football.player_match_metric_values').fetchone()[0]==478547;actual={'producerSha256':producer,'sourceAcceptance':str(acceptance_path.relative_to(ROOT)),'policyPair':str(pair_path.relative_to(ROOT)),'sourceConstructionCount':report['denseSourceConstructions']}
                elif name=='dense_core_commit_interruption':
                    data=invoke(True,'after-core-commit',{'INJECTED_FAILURE'});assert target.execute('SELECT count(*) FROM football.player_match_metric_values').fetchone()[0]==478547;report['denseCorePrefix']=state(target);budget.data['denseCoreCopies']=1;save(budget.path,budget.data);actual=data
                elif name=='dense_families_rollback_and_resume':
                    before=state(target);failed=invoke(True,'during-families-after-copy',{'INJECTED_FAILURE'});after=state(target);assert after['tables']==before['tables'];done=invoke(True);assert done['reusedPhases']==1 and done['copiedScalarRows']==0 and done['status']=='applied';report['denseFinalImport']=done;actual={'familyFailure':failed,'freshWorkerResume':done}
                elif name=='dense_native94_and_controls':
                    data=report['denseFinalImport'];expected=independent(source);from orion_pro_bulk_local import oracle
                    substitutions={n:{c:'CASE '+q(c)+' '+' '.join('WHEN '+str(dst)+' THEN '+str(src) for src,dst in (data['generationMap'] if kind=='generation' else data['snapshotMap']).items())+' ELSE '+q(c)+' END' for c,kind in columns.items()} for n,columns in data['controlColumns'].items()};got=oracle(target,tables,substitutions);assert all(got[n]==expected[n] for n in tables if n not in CONTROL);assert len(got)==94 and data['controlContractsVerified']==3 and data['ownershipDictionaryRows']==0
                    assert any(str(src)!=str(dst) for src,dst in data['generationMap'].items() if str(src)!='1');assert any(str(data['generationMap'][s])!=str(data['snapshotMap'][s]) for s in set(data['generationMap'])&set(data['snapshotMap']) if str(s)!='1');report['denseOracle']={'source':expected,'targetInverse':got};actual={'nativeRelations':91,'explicitControlContracts':3,'full94Accounted':True}
                elif name=='dense_noop_next_identity':
                    before=state(target);data=invoke(True);assert data['status']=='noop' and data['copyCommands']==0 and data['nextvalCalls']==0 and state(target)==before
                    with connect('policy_empty','policy_ingest') as c:
                        value=c.execute("SELECT nextval('ingest.source_records_id_seq')").fetchone()[0];assert value>200001
                    actual={'noop':data,'nextSourceRecordIdentity':value}
                elif name=='no_publish_source_or_legacy_cleanup':
                    assert target.execute('SELECT count(*) FROM analytics.catalog_publication').fetchone()[0]==0 and target.execute('SELECT count(*) FROM analytics.publication_versions').fetchone()[0]==0
                    for c in [source,target]:assert list(c.execute('SELECT * FROM public.stream_v2_legacy_sentinel'))==[(1,'legacy unchanged')]
                    assert not list(run.rglob('*.dump')) and not list(run.rglob('*.csv'));assert all(x['result']['externalRequests']==0 and x['result']['temporaryTablesCreated']==0 for x in report['invocations']);actual={'publicationPointersEmpty':True,'legacySentinelsExact':True,'rawBodiesOrCollectorCalls':0,'sourceRamCalls':0}
                elif name=='frozen_inputs_and_owned_cleanup':
                    assert all(sha(ROOT/path)==h for path,h in report['sourceSha256'].items()) and all(sha(ROOT/path)==h for path,h in CLOSED_ATTEMPT.items());assert report['denseSourceConstructions']==1;assert report['denseFinalImport']['maxMetadataBytes']<=32*1024**2 and report['denseFinalImport']['maxBufferedBytes']<=16*1024**2;actual={'allInputsUnchanged':True,'singleDenseSourceConstruction':True,'boundsRespected':True}
                report['cases'].append({'case':name,'status':'pass','elapsedMs':round((time.monotonic()-started)*1000,3),'actual':actual})
            except BaseException as e:
                blocker=name;report['cases'].append({'case':name,'status':'fail','error':{'type':type(e).__name__,'sqlstate':getattr(e,'sqlstate',None),'message':str(e) if isinstance(e,AssertionError) else 'Owned workflow failed; inspect traceback'}});(run/'failure-traceback.txt').write_text(traceback.format_exc())
    finally:
        close_owners()
        if admin:admin.close()
        if budget:report['resourceBudget']=budget.close(not blocker)
        try:report['cleanup']=pg.cleanup() if pg else {'server_stopped':True,'owned_directory_removed':True,'pgStarted':False}
        except BaseException as error:
            report['cleanup']={'server_stopped':False,'owned_directory_removed':False,'errorType':type(error).__name__,'owned_root':str(pg.root) if pg else None};blocker=blocker or 'owned_cleanup'
        report['counts']={s:sum(c['status']==s for c in report['cases']) for s in ['pass','fail','unverified']}
        passed=report['counts']=={'pass':29,'fail':0,'unverified':0} and report['cleanup']['server_stopped'] and report['cleanup']['owned_directory_removed'] and (budget is None or budget.reason is None)
        report['status']='pass' if passed else 'static_only' if args.precode_only and not blocker else 'fail'
        report['finishedAt']=datetime.now(timezone.utc).isoformat();save(run/'result.json',report);print(json.dumps({'status':report['status'],'counts':report['counts'],'receipt':str((run/'result.json').relative_to(ROOT)),'sha256':sha(run/'result.json'),'pgStarted':pg is not None,'remoteActions':[]}))
    return 0 if report['status']=='pass' else 1

if __name__=='__main__':raise SystemExit(main())
