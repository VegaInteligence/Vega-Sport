#!/usr/bin/env python3
"""Closed validator policy upgrade. Offline by default; owned local PG18 only."""
from __future__ import annotations
import argparse
from datetime import datetime,timezone
import json
import os
from pathlib import Path
import re
import stat
import time
import orion_pro_policy as policy

ROLES={'policy_owner','policy_ingest','policy_runtime'}
DATABASES={'policy_empty','policy_facts'}
ACCEPTANCE_KEYS={'kind','scope','policyId','manifestSha256','helperSha256','runnerSha256','database','beforeStateSha256','releaseCommit','localOnly'}

def state_hash(state):
    semantic={k:v for k,v in state.items() if k!='metadataBytes'}
    semantic['native']={k:v for k,v in state['native'].items() if k!='bufferPeakBytes'}
    return policy.hashed(semantic)

def inspect(conn,loaded):
    model=policy.fixed_inputs();journal=[list(r) for r in conn.execute('SELECT version,content_sha256,applied_at::text,code_commit FROM ingest.schema_migrations ORDER BY version')]
    chains={pid:policy.load_policy(pid)['manifest']['chain'] for pid in policy.PATHS}
    current=None
    for pid,chain in chains.items():
        if [(r[0],r[1]) for r in journal]==[(v['version'],v['sha256']) for v in chain]:current=pid;break
    policy.require(current is not None,'JOURNAL','Target journal is not an exact known chain')
    desired=loaded['manifest']['policyId']
    policy.require(not(desired==policy.P1 and current==policy.P2),'CHAIN','Compensated chain cannot reapply014')
    policy.require(not(desired==policy.P2 and current==policy.P0),'CHAIN','Local099 requires adopted014 parent')
    cat=policy.catalogue(conn);expected=loaded['oracle']['P1' if current==policy.P1 else 'P0']
    policy.require(cat==expected,'CATALOGUE','Actual full catalogue differs from journal policy');policy.nullability(conn)
    base=policy.bootstrap_contract();snap=list(conn.execute('SELECT id,generation,snapshot_key,status,manifest_sha256,transform_version,source_priority_version,knowledge_cutoff_at FROM ingest.dataset_snapshots ORDER BY generation'))
    policy.require(len(snap)==1 and snap[0][1:]==(1,'bootstrap-v1-'+policy.MODEL_SHA[:16],'sealed',base['manifestSha256'],'bootstrap_v1','bootstrap_v1',None),'BOOTSTRAP','One exact sealed B0 generation is required')
    for name,seeds in model['seed_data'].items():
        table=next(t for s in model['schemas'] for t in s['tables'] if t['qualified_name']==name);columns=list(table['columns'])
        got=list(conn.execute('SELECT '+','.join(policy.q(c) for c in columns)+' FROM '+policy.relation(name)+' ORDER BY code'))
        expected_rows=[]
        for seed in sorted(seeds,key=lambda s:s['code']):
            value={c:None for c in columns};value.update(seed,recorded_from_gen=1,transform_code_sha256=base['artifactSha256']);expected_rows.append(tuple(value[c] for c in columns))
        policy.require(got==expected_rows,'BOOTSTRAP','Native B0 seed values differ')
    expected_contracts=sorted(model['bootstrap']['relation_contracts'],key=lambda x:(x['relation_name'],x['contract_version']))
    columns=list(expected_contracts[0]);got=list(conn.execute('SELECT '+','.join(policy.q(c) for c in columns)+' FROM ingest.relation_contracts ORDER BY relation_name,contract_version'))
    policy.require(got==[tuple(x[c] for c in columns) for x in expected_contracts],'BOOTSTRAP','B0 relation contracts differ')
    tables={t['qualified_name']:t for s in model['schemas'] for t in s['tables'] if t['phase']!='models'}
    allowed={'ingest.schema_migrations','ingest.dataset_snapshots','ingest.relation_contracts',*model['seed_data']}
    pieces=["SELECT '"+name+"' AS relation WHERE EXISTS(SELECT 1 FROM "+policy.relation(name)+')' for name in sorted(set(tables)-allowed)]
    found=list(conn.execute(' UNION ALL '.join(pieces)));policy.require(not found,'BUSINESS','First local adoption/compensation requires bootstrap-only target')
    native=policy.native_state(conn)
    sequences=[]
    names=list(conn.execute("SELECT schemaname,sequencename FROM pg_sequences WHERE schemaname IN ('ingest','football','analytics') ORDER BY 1,2"))
    for schema,name in names:
        value=conn.execute('SELECT last_value,is_called FROM '+policy.relation(schema+'.'+name)).fetchone();sequences.append([schema,name,*value])
    props=policy.function_properties(conn)
    state={'currentPolicy':current,'catalogueSha256':cat['sha256'],'journal':journal,'bootstrap':base,'native':native,'sequences':sequences,'functionProperties':props}
    state['metadataBytes']=policy.memory_bytes(model,loaded,state,cat);return state

def local_marker(path):
    path=Path(path).resolve();data=policy.bounded_json(path,16384)
    policy.require(set(data)=={'kind','ownedRoot','port','serverStartedAt'} and data['kind']=='orion_owned_policy_pg18_v1','LOCAL','Invalid owned local marker')
    root=Path(data['ownedRoot']).resolve()
    policy.require(root.name.startswith('orion-pro-e2e-') and root.is_dir() and path.parent==root and path.stat().st_uid==os.getuid() and stat.S_IMODE(path.stat().st_mode)==0o600,'LOCAL','Marker must belong to this owned PG root')
    pid=root/'data/postmaster.pid';policy.require(pid.is_file(),'LOCAL','Owned postmaster is absent');lines=pid.read_text().splitlines()
    policy.require(len(lines)>=4 and Path(lines[1]).resolve()==root/'data' and int(lines[3])==data['port'] and type(data['port']) is int and 1024<=data['port']<=65535,'LOCAL','Owned postmaster directory/port differs')
    try:
        started=datetime.fromisoformat(data['serverStartedAt'])
        policy.require(started.tzinfo is not None and started.utcoffset() is not None,'LOCAL','Owned start time must be timezone-aware')
    except (TypeError,ValueError):raise policy.Refusal('LOCAL','Owned start time is not a parseable aware timestamp') from None
    data['parsedStartTime']=started
    return data

def run_local(marker,database,actor,mode,policy_id,manifest_sha,acceptance_path=None,acceptance_sha=None,*,connection_factory=None):
    loaded=policy.load_policy(policy_id,manifest_sha)
    policy.require(database in DATABASES and actor in ROLES and mode in {'preflight','apply'},'LOCAL','Unknown local target/actor/mode')
    identity=local_marker(marker);accepted=None
    if mode=='apply':
        policy.require(policy_id in {policy.P1,policy.P2},'POLICY','Baseline is not an upgrade target')
        policy.require(acceptance_path is not None and acceptance_sha is not None,'ACCEPTANCE','Separate explicit local acceptance is required')
        path=Path(acceptance_path);accepted=policy.bounded_json(path,65536)
        expected={'kind':'orion_pro_policy_local_acceptance_v1','scope':loaded['manifest']['scope'],'policyId':policy_id,'manifestSha256':loaded['manifestSha256'],'helperSha256':policy.sha(Path(policy.__file__)),'runnerSha256':policy.sha(Path(__file__)),'database':database,'localOnly':True}
        policy.require(policy.sha(path)==acceptance_sha and set(accepted)==ACCEPTANCE_KEYS and all(accepted.get(k)==v for k,v in expected.items()) and isinstance(accepted['releaseCommit'],str) and bool(re.fullmatch('[a-zA-Z0-9_-]{1,80}',accepted['releaseCommit'])),'ACCEPTANCE','Local acceptance/code/manifest/scope binding differs')
    if connection_factory is None:
        import psycopg
        connection_factory=psycopg.connect
    conn=connection_factory(host='127.0.0.1',port=identity['port'],dbname=database,user=actor,autocommit=True,connect_timeout=5,application_name='orion-pro-local-policy-upgrade',options='-c default_transaction_read_only=on -c statement_timeout=8000 -c lock_timeout=1000 -c idle_in_transaction_session_timeout=15000 -c search_path=pg_catalog -c timezone=UTC -c datestyle=ISO,YMD -c extra_float_digits=3')
    try:
        policy.require(conn.info.host=='127.0.0.1' and conn.info.port==identity['port'] and conn.info.server_version==180006,'LOCAL','Connection is not the owned local engine/port')
        row=conn.execute("SELECT current_database(),current_user,pg_postmaster_start_time(),current_setting('transaction_read_only'),rolsuper,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=current_user").fetchone()
        policy.require(row[:2]==(database,actor) and row[2]==identity['parsedStartTime'] and row[3]=='on' and not any(row[4:]),'ROLE','Ordinary owned local role/identity/read-only check failed')
        policy.require(actor=='policy_owner','ROLE','Only the existing ordinary schema owner can inspect/apply this local upgrade')
        with conn.transaction():
            if mode=='apply':
                conn.execute('SET TRANSACTION READ WRITE')
                for key in [2,1]:policy.require(conn.execute('SELECT pg_try_advisory_xact_lock(20261104,%s)',(key,)).fetchone()[0],'LEASE','Migration or generation lease is held')
            else:conn.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
            before=inspect(conn,loaded);state_sha=state_hash(before)
            result={'kind':'orion_pro_owned_local_policy_result_v1','mode':mode,'policyId':policy_id,'manifestSha256':loaded['manifestSha256'],'currentPolicy':before['currentPolicy'],'stateSha256':state_sha,'catalogueSha256':before['catalogueSha256'],'metadataBytes':before['metadataBytes'],'nativeBufferPeakBytes':before['native']['bufferPeakBytes'],'connections':1,'remoteActions':[],'fullAcceptance':False}
            if mode=='preflight':result['status']='ready';return result
            policy.require(accepted['beforeStateSha256']==state_sha,'ACCEPTANCE','Accepted native target state changed')
            if before['currentPolicy']==policy_id:result['status']='reused';return result
            policy.require((policy_id,before['currentPolicy']) in {(policy.P1,policy.P0),(policy.P2,policy.P1)},'CHAIN','Unsupported policy transition')
            chain=loaded['manifest']['chain'];change=chain[-1];sql_path=policy.UPGRADE if policy_id==policy.P1 else policy.RESTORE
            policy.require(policy.sha(sql_path)==change['sha256'],'SQL','Fixed migration SQL changed before application')
            start=time.monotonic();conn.execute(sql_path.read_text(),prepare=False);result['functionReplaceMs']=round((time.monotonic()-start)*1000,3)
            conn.execute('INSERT INTO ingest.schema_migrations(version,content_sha256,applied_at,code_commit) VALUES(%s,%s,CURRENT_TIMESTAMP,%s)',(change['version'],change['sha256'],accepted['releaseCommit']))
            after=inspect(conn,loaded)
            policy.require(after['currentPolicy']==policy_id and before['native']==after['native'] and before['sequences']==after['sequences'] and before['functionProperties']==after['functionProperties'] and before['journal']==after['journal'][:-1],'POSTCONDITION','Policy changed native data/control/property state')
            policy.require(policy.load_policy(policy_id,manifest_sha)['manifest']==loaded['manifest'],'MANIFEST','Policy artifacts changed before commit')
            result.update(status='applied',currentPolicy=policy_id,stateSha256=state_hash(after),catalogueSha256=after['catalogueSha256'],journalVersions=[r[0] for r in after['journal']]);commit_start=time.monotonic()
        result['commitMs']=round((time.monotonic()-commit_start)*1000,3);policy.require(result['commitMs']<8000,'DEADLINE','Commit exceeded8s');return result
    finally:conn.close()

def main():
    p=argparse.ArgumentParser(description=__doc__);m=p.add_mutually_exclusive_group();m.add_argument('--preflight-local',action='store_true');m.add_argument('--apply-local',action='store_true')
    p.add_argument('--marker',type=Path);p.add_argument('--database',choices=sorted(DATABASES),default='policy_empty');p.add_argument('--policy',choices=[policy.P1,policy.P2],default=policy.P1);p.add_argument('--expect-manifest-sha256');p.add_argument('--acceptance',type=Path);p.add_argument('--expect-acceptance-sha256');a=p.parse_args()
    try:
        loaded=policy.load_policy(a.policy,a.expect_manifest_sha256)
        if not a.preflight_local and not a.apply_local:
            out={'kind':'orion_pro_policy_offline_plan_v1','status':'planned','policyId':a.policy,'manifestSha256':loaded['manifestSha256'],'modelSha256':policy.MODEL_SHA,'scope':loaded['manifest']['scope'],'chain':loaded['manifest']['chain'],'connections':0,'remoteActions':[],'fullAcceptance':False}
        else:
            policy.require(a.marker is not None and a.expect_manifest_sha256 is not None,'LOCAL','Owned marker and exact manifest hash are required')
            out=run_local(a.marker,a.database,'policy_owner','apply' if a.apply_local else 'preflight',a.policy,a.expect_manifest_sha256,a.acceptance,a.expect_acceptance_sha256)
        print(json.dumps(out));return 0
    except Exception as e:
        uncertain=a.apply_local and (not isinstance(e,policy.Refusal) or e.code=='DEADLINE')
        out={'status':'apply_outcome_unverified' if uncertain else 'refused','code':e.code if isinstance(e,policy.Refusal) else 'LOCAL_FAILURE','errorType':type(e).__name__,'sqlstate':getattr(e,'sqlstate',None),'remoteActions':[],'fullAcceptance':False}
        if isinstance(e,policy.Refusal):out['reason']=str(e)
        print(json.dumps(out));return 1

if __name__=='__main__':raise SystemExit(main())
