#!/usr/bin/env python3
"""Pre-code local policy adoption E2E. No source or remote client is imported."""
from __future__ import annotations
import argparse
from contextlib import contextmanager
from datetime import datetime, timezone, timedelta
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import threading
import _thread
import time
import traceback
import types

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'docs/verification/orion-validator-adoption-20261105'
SCRIPTS = ROOT / 'dashboard/scripts'
PILOT = ROOT / 'docs/verification/orion-pro-pilot-20261104'
FROZEN = ROOT / 'docs/verification/orion-validator-membership-20261105'
MODEL = ROOT / 'docs/architecture/orion-plan-20261104/target-schema.proposed.json'
SQL = [ROOT / 'dashboard/backend/migrations' / n for n in ['012_orion_pro_domain.sql', '013_orion_pro_integrity.sql']]
MODULES = [SCRIPTS / n for n in ['orion_pro_policy.py', 'orion_pro_upgrade.py']]
NEW_SQL = ROOT / 'dashboard/backend/migrations/014_orion_pro_membership_nonnull.sql'
CASES = ['implementation_available', 'owned_two_database_setup', 'prepare_oracle_and_manifests',
         'offline_and_closed_bindings', 'native_catalogue_and_function_equivalence',
         'ordinary_roles_and_native_denials', 'migration_and_generation_leases',
         'catalogue_journal_and_acceptance_drift', 'mid_transaction_failures',
         'commit_acknowledgement_and_readback', 'independent_process_noop_and_bulk_v1_refusal',
         'populated_target_and_native_values', 'local_099_compensation_and_closed_chain',
         'protected_inputs_and_cleanup']

def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def save(p, x): p.write_text(json.dumps(x, indent=2, ensure_ascii=False, default=str) + '\n')
def load(p, name):
    spec = importlib.util.spec_from_file_location(name, p); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m
def jsonhash(x): return hashlib.sha256(json.dumps(x, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()
def q(x):
    assert re.fullmatch('[a-z_][a-z0-9_]*', x); return '"' + x + '"'

def protected():
    paths = [MODEL, *SQL, *[SCRIPTS / n for n in ['orion_pro_schema.py','orion_pro_integrity.py','orion_pro_migrate.py','orion_pro_bulk.py']],
             ROOT/'tests/orion_pro_bulk_local.py', ROOT/'tests/orion_pro_bulk_stream_local.py',
             FROZEN/'candidate.py', FROZEN/'candidate.sql', FROZEN/'final-hashes.json',
             ROOT/'docs/verification/orion-validator-policy-20261105/final-hashes.json']
    return {str(p.relative_to(ROOT)): sha(p) for p in paths}

class Budget:
    def __init__(self, pg, run):
        self.pg,self.run=pg,run; self.start=time.monotonic(); self.stop=threading.Event(); self.samples=[]; self.reason=None
        p=BASE/'campaign.json'; self.path=p
        self.ledger=json.loads(p.read_text())
        prior=self.ledger['pgStarts'];assert prior<5,'Compact campaign and ROOT continuations exhausted'
        if prior:
            authorization=BASE/('root-run'+str(prior+1)+'-authorization.json');auth=json.loads(authorization.read_text())
            assert prior in [1,2,3,4] and auth['nextPgStart']==prior+1 and auth['authorizedBy']=='ROOT'
            assert auth['codeSha256']=={str(p.relative_to(ROOT)):sha(p) for p in [Path(__file__),*MODULES,NEW_SQL]},'ROOT continuation bytes differ'
            history={k:self.ledger.get(k) for k in ['greenStartedAt','status','elapsedSeconds','budgetStop','stopForROOTBrief']}
            if prior==1:self.ledger['historicalFirstStop']=history
            elif prior==2:self.ledger['historicalSecondStop']={**history,'rootContinuation':self.ledger.get('rootContinuation')}
            else:self.ledger.setdefault('priorRunStates',[]).append({'pgStart':prior,**history,'rootContinuation':self.ledger.get('rootContinuation')})
            self.ledger.pop('stopForROOTBrief',None)
            self.ledger['rootContinuation']={'path':authorization.name,'sha256':sha(authorization)};self.ledger['maximumPgStarts']=prior+1
            pinned=auth.get('preparedArtifactSha256',auth.get('priorPreparedArtifactSha256',{}))
            assert all(sha(ROOT/p)==h for p,h in pinned.items()),'Frozen manifests/oracle changed before continuation'
        self.ledger['pgStarts']=prior+1;self.ledger['activeStopForROOTBrief']=False;self.ledger['greenStartedAt']=datetime.now(timezone.utc).isoformat();save(p,self.ledger)
        self.thread=threading.Thread(target=self.watch,daemon=True);self.thread.start()
    def watch(self):
        while not self.stop.wait(1):
            try:
                disk=int(subprocess.check_output(['du','-sk',str(self.pg.root)],text=True).split()[0])*1024
                proof=sum(p.stat().st_size for p in BASE.rglob('*') if p.is_file())
                elapsed=time.monotonic()-self.start; self.samples.append({'seconds':round(elapsed,3),'ownedBytes':disk,'proofBytes':proof})
                if disk>=7*1024**3 or proof>=64*1024**2 or elapsed>=600:
                    self.reason='owned_disk_or_proof_or_10minute_limit';_thread.interrupt_main();return
            except OSError:
                if not self.stop.is_set():self.reason='resource_monitor_failed';_thread.interrupt_main()
                return
    def close(self, ok):
        self.stop.set();self.thread.join(3)
        self.ledger.update(status='pass' if ok else 'stop_for_ROOT_brief',elapsedSeconds=round(time.monotonic()-self.start,3),budgetStop=self.reason)
        self.ledger['activeStopForROOTBrief']=not ok
        if not ok:self.ledger['stopForROOTBrief']=True
        save(self.path,self.ledger);save(self.run/'resources.json',self.samples)
        return self.ledger

class FaultConnection:
    def __init__(self, conn, fault): self.conn,self.fault,self.fired=conn,fault,False;self.transaction_start=None;self.after_journal=None
    def __getattr__(self,n):return getattr(self.conn,n)
    def execute(self,sql,*a,**kw):
        if str(sql)=='SET TRANSACTION READ WRITE':
            result=self.conn.execute(sql,*a,**kw);self.transaction_start=self.conn.execute('SELECT transaction_timestamp()').fetchone()[0];return result
        if str(sql).startswith('INSERT INTO ingest.schema_migrations') and self.fault in {'before-journal','after-journal'} and not self.fired:
            self.fired=True
            if self.fault=='before-journal':raise RuntimeError('injected_after_function_before_journal')
            result=self.conn.execute(sql,*a,**kw)
            if self.fault=='after-journal':raise RuntimeError('injected_after_journal_before_commit')
            return result
        result=self.conn.execute(sql,*a,**kw)
        if str(sql).startswith('INSERT INTO ingest.schema_migrations'):self.after_journal=self.conn.execute('SELECT clock_timestamp()').fetchone()[0]
        return result
    @contextmanager
    def transaction(self):
        with self.conn.transaction():yield
        if self.fault=='commit-ack' and not self.fired:
            self.fired=True;raise TimeoutError('injected_lost_ack_after_actual_local_commit')

def main():
    a=argparse.ArgumentParser();a.add_argument('--label',default='policy-e2e');a.add_argument('--pg-bin',type=Path,default=Path('/tmp/statarena-cache-test-tools/node_modules/@embedded-postgres/darwin-arm64/native/bin'));args=a.parse_args()
    assert re.fullmatch('[A-Za-z0-9][A-Za-z0-9-]{0,70}',args.label)
    sys.path[:0]=[str(SCRIPTS),str(PILOT),str(ROOT/'tests'),'/tmp/statarena-publication-test-python']
    run=BASE/'runs'/(datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')+'-'+args.label);(run/'inputs').mkdir(parents=True)
    ledger_path=BASE/'campaign.json'
    if not ledger_path.exists():save(ledger_path,{'precodeRuns':0,'pgStarts':0,'maximumPgStarts':1,'maximumSeconds':600})
    report={'kind':'local_owned_validator_policy_adoption_e2e','startedAt':datetime.now(timezone.utc).isoformat(),'command':['python3','tests/orion_pro_validator_policy_local.py',*sys.argv[1:]],'expected':'docs/verification/orion-validator-adoption-20261105/PROTOCOL.md','cases':[],'remoteActions':[],'fullAcceptance':False,'sourceBodiesRead':False,'statementTimeoutMs':8000,'lockTimeoutMs':1000,'protectedBefore':protected()}
    paths=[Path(__file__),BASE/'PROTOCOL.md',*MODULES,NEW_SQL,MODEL,*SQL,PILOT/'harness.py',ROOT/'tests/orion_pro_bulk_stream_local.py',ROOT/'tests/orion_pro_bulk_local.py',FROZEN/'e2e.py',FROZEN/'candidate.py',*map(lambda n:SCRIPTS/n,['orion_pro_schema.py','orion_pro_integrity.py','orion_pro_migrate.py','orion_pro_bulk.py'])]
    report['sourceSha256']={}
    for p in paths:
        if p.is_file():
            dest=run/'inputs'/p.relative_to(ROOT);dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,dest);report['sourceSha256'][str(p.relative_to(ROOT))]=sha(p)
    pg=budget=admin=target=facts=owner=lock=None;blocker=None;policy=upgrade=None;marker=None
    model=json.loads(MODEL.read_text());tables={t['qualified_name']:t for s in model['schemas'] for t in s['tables'] if t['phase']!='models'}
    def state(conn):return {'native':policy.native_state(conn),'journal':list(conn.execute('SELECT version,content_sha256,applied_at::text,code_commit FROM ingest.schema_migrations ORDER BY version')),'sequences':list(conn.execute("SELECT schemaname,sequencename,last_value FROM pg_sequences WHERE schemaname IN ('ingest','football','analytics') ORDER BY 1,2"))}
    def accept(pid,db='policy_empty'):
        loaded=policy.load_policy(pid);before=upgrade.run_local(marker,db,'policy_owner','preflight',pid,loaded['manifestSha256'])
        path=run/('acceptance-'+pid+'-'+str(len(list(run.glob('acceptance-*.json'))))+'.json')
        body={'kind':'orion_pro_policy_local_acceptance_v1','scope':loaded['manifest']['scope'],'policyId':pid,'manifestSha256':loaded['manifestSha256'],'helperSha256':sha(MODULES[0]),'runnerSha256':sha(MODULES[1]),'database':db,'beforeStateSha256':before['stateSha256'],'releaseCommit':'local-policy-adoption-e2e','localOnly':True}
        save(path,body);return loaded,path,sha(path)
    def invoke(pid,mode='apply',db='policy_empty',actor='policy_owner',factory=None,acceptance=None):
        loaded,path,h=acceptance or accept(pid,db)
        return upgrade.run_local(marker,db,actor,mode,pid,loaded['manifestSha256'],path,h,connection_factory=factory)
    def refusal(fn,expected):
        try:fn()
        except policy.Refusal as e:
            assert e.code==expected,(e.code,expected);return {'code':e.code}
        raise AssertionError('Expected refusal '+expected)
    def install(conn):
        from orion_pro_migrate import bootstrap
        from orion_pro_integrity import role_grants_sql
        with conn.transaction():
            artifacts=[(v,p,p.read_text()) for v,p in zip(['012','013'],SQL)]
            for v,p,sql in artifacts:
                conn.execute(sql,prepare=False);conn.execute('INSERT INTO ingest.schema_migrations(version,content_sha256,applied_at,code_commit) VALUES(%s,%s,CURRENT_TIMESTAMP,%s)',(v,sha(p),'local-policy-fixture'))
            bootstrap(conn,model,artifacts);conn.execute(role_grants_sql(model,'policy_ingest','policy_runtime'),prepare=False)
    try:
        for name in CASES:
            if blocker:report['cases'].append({'case':name,'status':'unverified','reason':blocker});continue
            start=time.monotonic()
            try:
                actual={}
                if name=='implementation_available':
                    assert all(p.is_file() for p in MODULES) and NEW_SQL.is_file(),'Policy/upgrade modules and014 are absent'
                    import orion_pro_policy as policy
                    import orion_pro_upgrade as upgrade
                    assert sha(NEW_SQL)=='e0810f8670b2cb627ade2c76e3c8eb527ab31fd595d5cf939fd63bfc5cf649d6'
                    actual={'helperSha256':sha(MODULES[0]),'runnerSha256':sha(MODULES[1])}
                elif name=='owned_two_database_setup':
                    import psycopg
                    from psycopg.conninfo import make_conninfo
                    from harness import LocalPostgres
                    pg=LocalPostgres(args.pg_bin,run);budget=Budget(pg,run)
                    pg.command([pg.binaries/'initdb','-D',pg.data,'--auth=trust','--no-locale','--encoding=UTF8'],name='initdb')
                    with (pg.data/'postgresql.conf').open('a') as f:f.write('\nlog_error_verbosity=terse\nlog_min_error_statement=panic\nlog_parameter_max_length_on_error=0\nstatement_timeout=8000\nlock_timeout=1000\ntemp_file_limit=512MB\n')
                    pg.start();admin=psycopg.connect(pg.dsn,autocommit=True)
                    assert admin.info.server_version==180006
                    for role in ['policy_owner','policy_ingest','policy_runtime']:admin.execute('CREATE ROLE '+q(role)+' LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS')
                    for db in ['policy_empty','policy_facts']:admin.execute('CREATE DATABASE '+q(db)+' OWNER policy_owner')
                    target=psycopg.connect(make_conninfo(pg.dsn,dbname='policy_empty',user='policy_owner'),autocommit=True)
                    facts=psycopg.connect(make_conninfo(pg.dsn,dbname='policy_facts',user='policy_owner'),autocommit=True)
                    for conn in [target,facts]:install(conn)
                    marker=pg.root/'policy-marker.json';save(marker,{'kind':'orion_owned_policy_pg18_v1','ownedRoot':str(pg.root),'port':pg.port,'serverStartedAt':admin.execute('SELECT pg_postmaster_start_time()::text').fetchone()[0]});marker.chmod(0o600)
                    actual={'serverVersion':admin.info.server_version,'databases':2,'roleFlags':list(admin.execute("SELECT rolname,rolsuper,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls FROM pg_roles WHERE rolname LIKE 'policy_%' ORDER BY 1"))}
                    assert not any(any(r[1:]) for r in actual['roleFlags'])
                elif name=='prepare_oracle_and_manifests':
                    before=state(target);props=policy.function_properties(target);p0=policy.catalogue(target)
                    try:
                        with target.transaction():
                            target.execute(NEW_SQL.read_text(),prepare=False);p1=policy.catalogue(target);assert policy.function_properties(target)==props
                            raise RuntimeError('rollback_oracle_overlay')
                    except RuntimeError as e:assert str(e)=='rollback_oracle_overlay'
                    assert state(target)==before and policy.catalogue(target)==p0
                    artifact=policy.build_artifacts(p0,p1)
                    for p,body in artifact.items():
                        authorization=BASE/('root-run'+str(json.loads((BASE/'campaign.json').read_text())['pgStarts'])+'-authorization.json')
                        if authorization.exists() and 'preparedArtifactSha256' in json.loads(authorization.read_text()):
                            pinned=json.loads(authorization.read_text())['preparedArtifactSha256'];assert sha(p)==pinned[str(p.relative_to(ROOT))] and hashlib.sha256(body.encode()).hexdigest()==sha(p),'ROOT-pinned prepared artifact differs'
                        p.parent.mkdir(parents=True,exist_ok=True);p.write_text(body)
                        archived=run/'prepared-artifacts'/p.relative_to(ROOT);archived.parent.mkdir(parents=True,exist_ok=True);archived.write_text(body)
                    for pid in [policy.P0,policy.P1,policy.P2]:
                        loaded=policy.load_policy(pid);assert loaded['manifest']['policyId']==pid
                    report['functionPropertiesBefore']=props;report['oracleSha256']=sha(policy.ORACLE);actual={'artifacts':{str(p.relative_to(ROOT)):sha(p) for p in artifact},'overlayRolledBack':True}
                elif name=='offline_and_closed_bindings':
                    env={k:v for k,v in os.environ.items() if k in ['PATH','HOME','USER','TMPDIR','LANG']};env.update(PYTHONDONTWRITEBYTECODE='1',PYTHONPATH='/tmp/statarena-publication-test-python',DATABASE_URL='poison-unread',AWS_PROFILE='poison-unread',ORION_PILOT_DATABASE_URL='poison-unread')
                    cmd=['python3',str(MODULES[1])];got=subprocess.run(cmd,env=env,cwd=ROOT,capture_output=True,text=True,timeout=10);assert got.returncode==0,got.stdout
                    data=json.loads(got.stdout);assert data['status']=='planned' and data['connections']==0
                    bad=[]
                    for pid,h in [('latest',None),(policy.P1,'0'*64)]:bad.append(refusal(lambda:policy.load_policy(pid,h),'POLICY' if pid=='latest' else 'MANIFEST'))
                    original=NEW_SQL.read_bytes()
                    try:
                        NEW_SQL.write_bytes(original+b'\n');bad.append(refusal(lambda:policy.load_policy(policy.P1),'SQL'))
                    finally:NEW_SQL.write_bytes(original)
                    actual={'defaultPlan':data,'closedRefusals':bad}
                elif name=='native_catalogue_and_function_equivalence':
                    detail=policy.equivalence();assert detail['changed']==139 and detail['retained']==46 and detail['clauses']==81
                    nulls=policy.nullability(target);assert len(nulls)==1709
                    loaded=policy.load_policy(policy.P1);assert upgrade.run_local(marker,'policy_empty','policy_owner','preflight',policy.P1,loaded['manifestSha256'])['currentPolicy']==policy.P0
                    marker_data=json.loads(marker.read_text());instant=datetime.fromisoformat(marker_data['serverStartedAt']);assert instant.tzinfo is not None
                    utc_marker=pg.root/'policy-marker-utc.json';save(utc_marker,{**marker_data,'serverStartedAt':instant.astimezone(timezone.utc).isoformat(sep=' ')});utc_marker.chmod(0o600)
                    assert upgrade.run_local(utc_marker,'policy_empty','policy_owner','preflight',policy.P1,loaded['manifestSha256'])['currentPolicy']==policy.P0
                    changed_marker=pg.root/'policy-marker-wrong-time.json';save(changed_marker,{**marker_data,'serverStartedAt':(instant+timedelta(microseconds=1)).isoformat(sep=' ')});changed_marker.chmod(0o600)
                    mismatch=refusal(lambda:upgrade.run_local(changed_marker,'policy_empty','policy_owner','preflight',policy.P1,loaded['manifestSha256']),'ROLE')
                    invalid=[]
                    for timestamp in [instant.replace(tzinfo=None).isoformat(sep=' '),'not-a-timestamp']:
                        save(changed_marker,{**marker_data,'serverStartedAt':timestamp});changed_marker.chmod(0o600)
                        invalid.append(refusal(lambda:upgrade.run_local(changed_marker,'policy_empty','policy_owner','preflight',policy.P1,loaded['manifestSha256']),'LOCAL'))
                    actual={**detail,'catalogueColumns':len(nulls),'equivalentAwareStartTimes':True,'oneMicrosecondMismatch':mismatch,'naiveAndMalformedRefusals':invalid}
                elif name=='ordinary_roles_and_native_denials':
                    import psycopg
                    from psycopg.conninfo import make_conninfo
                    denied=[]
                    for role in ['policy_ingest','policy_runtime']:
                        accepted=accept(policy.P1);denied.append(refusal(lambda:invoke(policy.P1,actor=role,acceptance=accepted),'ROLE'))
                        with psycopg.connect(make_conninfo(pg.dsn,dbname='policy_empty',user=role),autocommit=True) as c:
                            for sql in [NEW_SQL.read_text(),"INSERT INTO ingest.schema_migrations(version,content_sha256) VALUES('bad',repeat('0',64))"]:
                                try:c.execute(sql,prepare=False)
                                except psycopg.Error as e:assert e.sqlstate=='42501';denied.append({'sqlstate':e.sqlstate})
                                else:raise AssertionError('Native privilege should reject')
                    actual={'denials':denied}
                elif name=='migration_and_generation_leases':
                    before=state(target);denied=[]
                    import psycopg
                    from psycopg.conninfo import make_conninfo
                    lock=psycopg.connect(make_conninfo(pg.dsn,dbname='policy_empty',user='policy_owner'),autocommit=True)
                    for key in [2,1]:
                        accepted=accept(policy.P1);lock.execute('SELECT pg_advisory_lock(20261104,%s)',(key,))
                        try:denied.append(refusal(lambda:invoke(policy.P1,acceptance=accepted),'LEASE'))
                        finally:lock.execute('SELECT pg_advisory_unlock(20261104,%s)',(key,))
                    lock.close();lock=None;assert state(target)==before;actual={'leases':denied}
                elif name=='catalogue_journal_and_acceptance_drift':
                    before=state(target);loaded,path,h=accept(policy.P1);bad=json.loads(path.read_text());bad['beforeStateSha256']='0'*64;badpath=run/'bad-acceptance.json';save(badpath,bad)
                    rejected=[refusal(lambda:upgrade.run_local(marker,'policy_empty','policy_owner','apply',policy.P1,loaded['manifestSha256'],badpath,sha(badpath)),'ACCEPTANCE')]
                    for sql in ['ALTER TABLE football.match_players ALTER COLUMN team_id DROP NOT NULL','ALTER FUNCTION ingest.validate_generation(bigint) COST 123',"INSERT INTO ingest.schema_migrations(version,content_sha256) VALUES('777',repeat('0',64))",NEW_SQL.read_text()]:
                        try:
                            with target.transaction():
                                target.execute(sql,prepare=False)
                                rejected.append(refusal(lambda:upgrade.inspect(target,policy.load_policy(policy.P1)),'CATALOGUE' if not sql.startswith('INSERT') else 'JOURNAL'))
                                raise RuntimeError('rollback_drift')
                        except RuntimeError as e:assert str(e)=='rollback_drift'
                    assert state(target)==before;actual={'driftRefusals':rejected}
                elif name=='mid_transaction_failures':
                    import psycopg
                    before=state(target);events=[]
                    for fault in ['before-journal','after-journal']:
                        accepted=accept(policy.P1)
                        def factory(**kw):return FaultConnection(psycopg.connect(**kw),fault)
                        try:invoke(policy.P1,factory=factory,acceptance=accepted)
                        except RuntimeError as e:assert str(e).startswith('injected_');events.append({'fault':fault,'rollbackVerified':state(target)==before})
                        else:raise AssertionError('Injected failure absent')
                        assert state(target)==before and policy.catalogue(target)['sha256']==policy.load_policy(policy.P0)['oracle']['P0']['sha256']
                    actual={'faults':events}
                elif name=='commit_acknowledgement_and_readback':
                    import psycopg
                    before=state(target);props=policy.function_properties(target);accepted=accept(policy.P1)
                    observed=[]
                    def factory(**kw):
                        proxy=FaultConnection(psycopg.connect(**kw),'commit-ack');observed.append(proxy);return proxy
                    try:invoke(policy.P1,factory=factory,acceptance=accepted)
                    except TimeoutError as e:assert 'after_actual_local_commit' in str(e)
                    else:raise AssertionError('Acknowledgement loss absent')
                    loaded=policy.load_policy(policy.P1);readback=upgrade.run_local(marker,'policy_empty','policy_owner','preflight',policy.P1,loaded['manifestSha256'])
                    after=state(target);assert readback['currentPolicy']==policy.P1 and [r[0] for r in after['journal']]==['012','013','014']
                    assert before['native']==after['native'] and before['sequences']==after['sequences'] and props==policy.function_properties(target)
                    assert before['journal']==after['journal'][:2] and all(row[2] is not None for row in before['journal'])
                    assert after['journal'][-1][2] is not None,'NEW_JOURNAL_CLOCK_NULL'
                    applied=datetime.fromisoformat(after['journal'][-1][2]);assert applied==observed[0].transaction_start and observed[0].transaction_start<=applied<=observed[0].after_journal
                    report['adoptedReadback']=readback;actual={'lostAckAfterRealCommit':True,'readback':readback,'journal':after['journal'],'appliedAt':applied,'transactionStart':observed[0].transaction_start,'observedAfterJournal':observed[0].after_journal,'oldNonNullJournalRowsExact':True}
                elif name=='independent_process_noop_and_bulk_v1_refusal':
                    before=state(target);loaded,path,h=accept(policy.P1)
                    cmd=['python3',str(MODULES[1]),'--apply-local','--marker',str(marker),'--database','policy_empty','--policy',policy.P1,'--expect-manifest-sha256',loaded['manifestSha256'],'--acceptance',str(path),'--expect-acceptance-sha256',h]
                    env={k:v for k,v in os.environ.items() if k in ['PATH','HOME','USER','TMPDIR','LANG']};env.update(PYTHONPATH='/tmp/statarena-publication-test-python',PYTHONDONTWRITEBYTECODE='1')
                    got=subprocess.run(cmd,env=env,capture_output=True,text=True,timeout=30,cwd=ROOT);assert got.returncode==0,got.stdout;data=json.loads(got.stdout);assert data['status']=='reused' and state(target)==before
                    import orion_pro_bulk as old
                    candidate=object.__new__(old.Candidate);candidate.model=model;candidate.tables=tables;candidate.bootstrap={}
                    try:candidate.baseline(target,source=True)
                    except old.Refusal as e:assert e.code=='BASELINE' and 'journal' in str(e);old_refusal={'code':e.code,'reason':str(e)}
                    else:raise AssertionError('Old baseline should reject014')
                    actual={'newProcessCommand':cmd,'newProcessResult':data,'oldV1Guard':old_refusal}
                elif name=='populated_target_and_native_values':
                    import psycopg
                    from psycopg.conninfo import make_conninfo
                    fm=load(ROOT/'tests/orion_pro_bulk_stream_local.py','frozen_native_fixture');small=types.FunctionType(fm.fixture.__code__,{**fm.fixture.__globals__,'APPEARANCES':40,'SCALARS':1240,'MATCHES':4,'PLAYERS':40})
                    evidence=run/'compact-facts';evidence.mkdir();writer=psycopg.connect(make_conninfo(pg.dsn,dbname='policy_facts',user='policy_ingest'),autocommit=True)
                    try:phases=small(writer,model,sha(Path(__file__)),evidence)
                    finally:writer.close()
                    from orion_pro_bulk_local import oracle as independent_oracle
                    before=state(facts);independent_before=independent_oracle(facts,tables);loaded=policy.load_policy(policy.P1)
                    denied=refusal(lambda:upgrade.run_local(marker,'policy_facts','policy_owner','preflight',policy.P1,loaded['manifestSha256']),'BOOTSTRAP')
                    try:
                        with facts.transaction():
                            facts.execute(NEW_SQL.read_text(),prepare=False);assert state(facts)==before and independent_oracle(facts,tables)==independent_before
                            exact=facts.execute("SELECT numeric_value::text,numerator::text FROM football.player_match_metric_values WHERE metric_code='a_ratio' LIMIT 1").fetchone();assert exact==('12345678901234567890123456789.1234567890123456789','12345678901234567890123456789')
                            issue=facts.execute("SELECT context::text,context->'null'='null'::jsonb,(context->>'null') IS NULL,jsonb_typeof(context->'array'),jsonb_typeof(context->'text') FROM ingest.quality_issues LIMIT 1").fetchone()
                            assert '12345678901234567890123456789' in issue[0] and '0.123456789012345678901234567890123456789' in issue[0] and issue[1:]==(True,True,'array','string')
                            raise RuntimeError('rollback_populated_local_overlay')
                    except RuntimeError as e:assert str(e)=='rollback_populated_local_overlay'
                    assert state(facts)==before and independent_oracle(facts,tables)==independent_before;report['factsNativeOracle']=independent_before;actual={'refusal':denied,'phases':phases,'nativeRelations':len(independent_before),'exactDecimal':exact,'nativeTechnicalStates':issue[1:],'overlayAndFactsRestored':True}
                elif name=='local_099_compensation_and_closed_chain':
                    import psycopg
                    before=state(target);p1=accept(policy.P1);p2=policy.load_policy(policy.P2)
                    wrong=refusal(lambda:upgrade.run_local(marker,'policy_empty','policy_owner','apply',policy.P2,p2['manifestSha256'],p1[1],p1[2]),'ACCEPTANCE')
                    observed=[]
                    def factory(**kw):
                        proxy=FaultConnection(psycopg.connect(**kw),'clock-only');observed.append(proxy);return proxy
                    result=invoke(policy.P2,factory=factory);after=state(target);assert result['status']=='applied' and [r[0] for r in after['journal']]==['012','013','014','099']
                    assert before['native']==after['native'] and before['sequences']==after['sequences']
                    assert after['journal'][:-1]==before['journal'] and after['journal'][-1][2] is not None,'NEW_COMPENSATION_CLOCK_NULL'
                    applied=datetime.fromisoformat(after['journal'][-1][2]);assert applied==observed[0].transaction_start and observed[0].transaction_start<=applied<=observed[0].after_journal
                    reused=invoke(policy.P2);assert reused['status']=='reused' and state(target)==after
                    refused=refusal(lambda:upgrade.run_local(marker,'policy_empty','policy_owner','preflight',policy.P1,policy.load_policy(policy.P1)['manifestSha256']),'CHAIN')
                    assert not list((ROOT/'dashboard/backend/migrations').glob('099*')) and not (ROOT/'dashboard/backend/migrations/015_orion_pro_membership_restore.sql').exists()
                    actual={'compensation':result,'noOp':reused,'wrongAcceptance':wrong,'reapply014':refused,'journal':after['journal'],'appliedAt':applied,'transactionStart':observed[0].transaction_start,'observedAfterJournal':observed[0].after_journal,'allOldJournalRowsExact':True}
                elif name=='protected_inputs_and_cleanup':
                    assert protected()==report['protectedBefore'];assert all(sha(ROOT/p)==h for p,h in report['sourceSha256'].items())
                    actual={'oldInputsUnchanged':True,'newInputsUnchangedAfterTamperRestored':True,'noProd099or015':True}
                report['cases'].append({'case':name,'status':'pass','elapsedMs':round((time.monotonic()-start)*1000,3),'actual':actual})
            except BaseException as e:
                blocker=name;report['cases'].append({'case':name,'status':'fail','error':{'type':type(e).__name__,'sqlstate':getattr(e,'sqlstate',None),'message':str(e) if isinstance(e,AssertionError) or type(e).__name__=='Refusal' else 'Owned local workflow failed; inspect safe traceback'}})
                (run/'failure-traceback.txt').write_text(traceback.format_exc())
    finally:
        for c in [lock,owner,facts,target,admin]:
            if c is not None:c.close()
        if budget:report['resourceBudget']=budget.close(not blocker)
        if pg:report['cleanup']=pg.cleanup()
        else:
            report['cleanup']={'server_stopped':True,'owned_directory_removed':True,'pgStarted':False}
            ledger=json.loads(ledger_path.read_text());assert ledger['precodeRuns']==0,'Precode budget exhausted';ledger['precodeRuns']=1;save(ledger_path,ledger)
        report['finishedAt']=datetime.now(timezone.utc).isoformat();report['counts']={s:sum(c['status']==s for c in report['cases']) for s in ['pass','fail','unverified']};report['status']='pass' if not blocker and len(report['cases'])==len(CASES) else 'fail';report['protectedAfter']=protected();save(run/'result.json',report)
        print(json.dumps({'status':report['status'],'counts':report['counts'],'receipt':str((run/'result.json').relative_to(ROOT)),'sha256':sha(run/'result.json'),'remoteActions':[]}))
    return 0 if report['status']=='pass' else 1

if __name__=='__main__':raise SystemExit(main())
