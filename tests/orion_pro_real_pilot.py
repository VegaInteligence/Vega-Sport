#!/usr/bin/env python3
"""Before-code E2E contract: existing AWS sources -> real typed local PostgreSQL."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import sys
import traceback
from decimal import Decimal, localcontext
import os
import pickle
import socket
import subprocess
import shlex
import tempfile

REPO = Path(__file__).resolve().parents[1]
EVIDENCE = REPO / "docs/verification/orion-pro-pilot-20261104"
MODEL = REPO / "docs/architecture/orion-plan-20261104/target-schema.proposed.json"
NORMALIZER = REPO / "dashboard/scripts/orion_pro_normalize.py"
EXPECTED = {"fixtures": 612, "matches": 387, "performances": 15437, "shots": 9795,
            "players": 839, "teams": 20, "player_profile_lookup_gaps": 62}
CASES = ["importer_available", "real_source_import", "exact_typed_key_counts",
         "source_oracle_metrics_aliases", "native_shapes_quality", "noop_reimport",
         "source_correction_retains_snapshot", "local_sql_reads", "mapping_acceptance_boundary"]


def capture_cli_boundary(run):
    base=run/'capture-cli';base.mkdir()
    guard=base/'network-denied-cli.py'
    guard.write_text("import sys,runpy\nfrom pathlib import Path\nimport psycopg\nmodule,attempt=sys.argv[1:3]\nsys.path.insert(0,str(Path(module).parent))\nsys.argv=[module,*sys.argv[3:]]\ndef denied(*args,**kwargs):\n Path(attempt).write_text('source connection attempted\\n')\n raise AssertionError('Source connection forbidden in offline CLI E2E')\npsycopg.connect=denied\nrunpy.run_path(module,run_name='__main__')\n")
    cases=[('current_78',(78,222873283),(78,222873283),True,'capture_checkpoint_valid'),
           ('missing_both',(78,222873283),(None,None),False,'Explicit expected source checkpoint'),
           ('missing_queries',(78,222873283),(None,222873283),False,'Explicit expected source checkpoint'),
           ('missing_bytes',(78,222873283),(78,None),False,'Explicit expected source checkpoint'),
           ('mismatch',(78,222873283),(67,190950214),False,'checkpoint mismatch'),
           ('negative',(78,222873283),(-1,222873283),False,'nonnegative integers'),
           ('missing_ledger',None,(0,0),False,'ledger is missing'),
           ('query_budget',(100,222873283),(100,222873283),False,'remaining source budget'),
           ('byte_budget',(78,268435456),(78,268435456),False,'remaining source budget'),
           ('remaining_after_capture',(89,254796352),(89,254796352),False,'remaining source budget'),
           ('normal_mode_flags',(78,222873283),(78,222873283),False,'only valid with --memory-source-server')]
    outcomes=[]
    for label,ledger,expected,accepted,reason in cases:
        case=base/label;case.mkdir();evidence=case/'real-source-runs'/'check';attempt=case/'connection-attempt.txt'
        ledger_path=case/'real-source-budget.json'
        if ledger is not None:ledger_path.write_text(json.dumps({'queries':ledger[0],'decodedBytes':ledger[1],'runs':[]})+'\n')
        before=ledger_path.read_bytes() if ledger_path.exists() else None
        with tempfile.TemporaryDirectory(prefix='orion-pro-capture-cli-') as private:
            argv=[sys.executable,str(guard),str(NORMALIZER),str(attempt),'--local','--source-scope',str(EVIDENCE/'source_scope.json'),
                  '--phase','families','--evidence',str(evidence),'--memory-source-server','--capture-check-only','--source-socket',str(Path(private)/'source.sock')]
            for flag,value in zip(['--expected-source-queries','--expected-source-bytes'],expected):
                if value is not None:argv.extend([flag,str(value)])
            if label=='normal_mode_flags':argv.remove('--memory-source-server')
            command=subprocess.run(argv,text=True,capture_output=True,timeout=30)
            socket_created=(Path(private)/'source.sock').exists()
        (case/'stdout.log').write_text(command.stdout);(case/'stderr.log').write_text(command.stderr)
        try:actual=json.loads(command.stdout.strip().splitlines()[-1])
        except (ValueError,IndexError):actual={}
        unchanged=before==(ledger_path.read_bytes() if ledger_path.exists() else None)
        ok=(command.returncode==0 if accepted else command.returncode!=0) and reason in str(actual.get('status') if accepted else actual.get('reason'))
        ok=ok and unchanged and not attempt.exists() and not socket_created and not (evidence/'source-queries.json').exists()
        if accepted:ok=ok and actual.get('captureLimits')=={'queries':11,'decodedBytes':32*1024*1024} and actual.get('sourceConnections')==0
        outcomes.append({'case':label,'command':shlex.join(argv),'expectedAccepted':accepted,'exitCode':command.returncode,'actual':actual,
                         'ledgerUnchanged':unchanged,'sourceConnectionAttempted':attempt.exists(),'socketCreated':socket_created,'expectedOutcomeMet':ok})
    return {'awsReads':0,'outcomes':outcomes},all(x['expectedOutcomeMet'] for x in outcomes)


def numeric_boundary(conn, normalizer):
    values = [Decimal('12345678901234567890123456781'),Decimal('12345678901234567890123456782'),
              Decimal('0.123456789012345678901234567891'),123456789012345678901234567891,
              Decimal('10000000000000000000000000000.0000'),Decimal('-0.0000')]
    observations = []
    with localcontext() as context:
        context.prec = 28
        for value in values:
            stored = conn.execute('SELECT %s::numeric',(value,)).fetchone()[0]
            canonical = normalizer.normalized(value)['number']
            exact = Decimal(canonical)==stored
            observations.append({'kind':type(value).__name__,'input':str(value),'postgresNumeric':str(stored),'canonical':canonical,'exact':exact})
        distinct = normalizer.hashed(values[0])!=normalizer.hashed(values[1])
    result={'observations':observations,'lastDigitHashesDistinct':distinct,'decimalContextPrecision':28}
    return result, all(r['exact'] for r in observations) and distinct


def collection_boundary(conn, normalizer, evidence):
    class RollbackFixture(Exception):pass
    outcomes=[]
    passed=True
    try:
        with conn.transaction():
            conn.execute('SET LOCAL ROLE orion_pro_ingest')
            actor=normalizer.TypedCore(conn,evidence,None)
            actor.g=conn.execute("SELECT ingest.begin_generation('review-collection-boundary','real_source_core_v1','real_source_core_v1')").fetchone()[0]
            for name,t in actor.tables.items():
                if t['phase']!='models' and 'relation_code' in t['columns']:
                    conn.execute('INSERT INTO ingest.relation_contracts(relation_code,relation_name,contract_version,grain_definition) VALUES(%s,%s,%s,%s) ON CONFLICT DO NOTHING',
                        (name,name,normalizer.VERSION,t['grain']))
            source=actor.insert('ingest.sources',code='synthetic_review_boundary',name='Explicit synthetic collection boundary')
            actor.ids['source']=source['id']
            dataset=actor.insert('ingest.source_datasets',source_id=source['id'],dataset_key='synthetic-boundary',contract_version=normalizer.VERSION)
            document=actor.insert('ingest.source_documents',source_id=source['id'],dataset_id=dataset['id'],content_sha256='f'*64,
                retrieved_at=datetime.now(timezone.utc),request_fingerprint='e'*64)
            record=actor.insert('ingest.source_records',source_id=source['id'],document_id=document['id'],locator_kind='whole_document',locator='',record_kind='synthetic_boundary')
            competition=actor.insert('football.competitions',slug='synthetic-review-boundary',competition_type='unknown',gender='unknown',source_record_id=record['id'])
            edition=actor.insert('football.competition_seasons',competition_id=competition['id'],competition_revision_id=competition['revision_id'],season_key='synthetic',label='Synthetic',source_record_id=record['id'])
            match=actor.insert('football.matches',competition_season_id=edition['id'],competition_season_revision_id=edition['revision_id'],kickoff_precision='unknown',status='unknown',source_record_id=record['id'])
            actor.matches['synthetic_match']=match
            for family,key in [('events','events'),('momentum','points'),('h2h','recent_matches')]:
                for label,value in [('missing',None),('null',None),('object',{}),('number',0),('string',''),('invalid_member',[0]),('empty',[])]:
                    data={} if label=='missing' else {key:value}
                    try:
                        with conn.transaction():
                            actor.transform_family(family,'synthetic_match',data,record['id'],f'review:{family}:{label}')
                            actual=conn.execute('SELECT coverage_state,collection_state,observed_row_count FROM ingest.match_coverage WHERE match_id=%s AND feature_code=%s AND variant_key=%s',
                                (match['id'],family,f'review:{family}:{label}')).fetchone()
                            ok=label=='empty' and actual==('empty_response','empty',0)
                            outcomes.append({'family':family,'form':label,'accepted':True,'coverage':actual,'expectedOutcomeMet':ok})
                            passed=passed and ok
                            raise RollbackFixture()
                    except RollbackFixture:pass
                    except normalizer.MappingError:
                        ok=label!='empty'
                        outcomes.append({'family':family,'form':label,'accepted':False,'expectedOutcomeMet':ok})
                        passed=passed and ok
                    except Exception as error:
                        outcomes.append({'family':family,'form':label,'accepted':False,'errorType':type(error).__name__,'expectedOutcomeMet':False})
                        passed=False
            raise RollbackFixture()
    except RollbackFixture:pass
    return {'syntheticFixtureRolledBack':True,'outcomes':outcomes},passed


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


class FixtureMemorySource:
    """Only source inputs cross the inherited socket; importer state never does."""
    def __init__(self,snapshot):self.__dict__.update(snapshot)
    def documents(self,expected,batch_size=16):
        for path,digest in expected.items():
            assert self.meta[path]['physicalSha256']==digest
        return {path:self.cache[path] for path in expected}


def fresh_worker():
    fd=int(sys.argv[sys.argv.index('--worker-fd')+1])
    with socket.socket(fileno=fd) as channel:
        with channel.makefile('rb') as stream:payload=pickle.load(stream)
    sys.path.insert(0,str(REPO/'dashboard/scripts'))
    import orion_pro_normalize as normalizer
    import psycopg
    report={'pid':os.getpid(),'mode':payload['mode'],'awsReads':0}
    try:
        with psycopg.connect(os.environ['ORION_PILOT_DATABASE_URL'],autocommit=True) as conn:
            if payload['mode'].startswith('real-'):
                if payload['mode']=='real-reimport':
                    source=normalizer.MemorySource.from_socket(payload['sourceSocket'])
                    result=normalizer.run_real_pilot(conn,Path(payload['evidence']),Path(payload['sourceScope']),'families',source_provider=source)
                    assert result['import']['reused'] and result['families']['reused'] and result['fullProfiles']['reused']
                    assert result['demoCorrectionExecuted'] is False and 'correction' not in result
                    assert result['rehydration']['fromSql'] and result['rehydration']['matches']==612 and result['rehydration']['players']==839 and result['rehydration']['performances']==15437
                    assert result['sourceBudget']['runQueries']==0
                    aliases=next(x for x in result['oracleComparisons'] if x['kind']=='public_aliases')
                    assert aliases['sourceRows']==aliases['typedRows'] and aliases['sourceSha256']==aliases['typedSha256'],'Unrelated aliases contaminated the scoped source oracle'
                    report.update(status='pass',rehydration=result['rehydration'],coreReceipt=result['import']['phaseReceipt'],familiesReceipt=result['families']['phaseReceipt'],profilesReceipt=result['fullProfiles']['phaseReceipt'],demoCorrectionExecuted=False,sourceBudget=result['sourceBudget'])
                else:
                    source=normalizer.MemorySource.from_socket(payload['sourceSocket'])
                    scope=json.loads(Path(payload['sourceScope']).read_text())
                    parts=normalizer.load_parts(source,scope);source.profile_gaps=source.profile_versions(parts,scope)
                    conn.execute('SET ROLE orion_pro_ingest')
                    actor=normalizer.TypedCore(conn,Path(payload['evidence']),source);actor.import_core(parts)
                    if payload['mode']=='real-changed-family-source':
                        path=scope['archiveShapeChoices'][0]['path']
                        row=next(r for q in scope['queries'] if q['name']=='archive_relation_source_versions' for r in q['rows'] if r['path']==path)
                        row['sha256']='b'*64
                        action=lambda:actor.import_original_families(scope)
                    elif payload['mode']=='real-changed-profile-selector':
                        source.profile_metadata[0]['ordinal']+=1
                        action=lambda:actor.import_source_profiles(scope)
                    else:raise AssertionError('Unknown negative replay mode')
                    try:action()
                    except normalizer.MappingError as error:
                        report.update(status='pass',rejectedChangedBinding=True,reason=str(error),sourceBudget=source.budget())
                    else:raise AssertionError('Changed source binding was incorrectly reused')
                print(json.dumps(report,default=str),flush=True)
                return 0
            conn.execute('SET ROLE orion_pro_ingest')
            actor=normalizer.TypedCore(conn,Path(payload['evidence']),FixtureMemorySource(payload['snapshot']))
            result=actor.import_core(payload['parts'])
            assert result['reused'],'Core was not reused'
            source=conn.execute("SELECT id FROM ingest.sources WHERE code='pitchapi_saved'").fetchone()[0]
            assert actor.ids.get('source')==source,'Fresh core retry did not rehydrate its source/run/identity maps'
            family=actor.import_original_families(payload['scope'])
            profile=actor.import_source_profiles(payload['scope'])
            resumed=payload['mode']=='synthetic-resume-after-core'
            assert bool(family.get('reused')) is (not resumed) and bool(profile.get('reused')) is (not resumed),'Wrong phase receipt reuse after process restart'
            report.update(status='pass',core=result,familiesReused=bool(family.get('reused')),profilesReused=bool(profile.get('reused')),hydratedIds=sorted(actor.ids))
    except Exception as error:
        report.update(status='fail',errorType=type(error).__name__,reason=str(error) if isinstance(error,(AssertionError,normalizer.MappingError)) else None,
                      sqlstate=getattr(error,'sqlstate',None))
    print(json.dumps(report,default=str),flush=True)
    return 0 if report['status']=='pass' else 1


def database_fingerprint(dsn):
    import psycopg
    with psycopg.connect(dsn,autocommit=True,options='-c default_transaction_read_only=on') as db:
        tables=[r[0] for r in db.execute("SELECT n.nspname||'.'||c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('ingest','football','analytics') AND c.relkind IN ('r','p') ORDER BY 1")]
        output=[]
        for table in tables:
            sql="SELECT count(*),encode(sha256(convert_to(coalesce(string_agg(h,'' ORDER BY h),''),'UTF8')),'hex') FROM (SELECT encode(sha256(convert_to(t::text,'UTF8')),'hex') h FROM "+table+" t) r"
            count,digest=db.execute(sql).fetchone();output.append((table,count,digest))
        sequences=list(db.execute("SELECT schemaname,sequencename,last_value FROM pg_sequences WHERE schemaname IN ('ingest','football','analytics') ORDER BY 1,2"))
    encoded=json.dumps({'tables':output,'sequences':sequences},sort_keys=True,separators=(',',':'))
    return {'tableCount':len(tables),'tables':output,'sequences':sequences,'sha256':hashlib.sha256(encoded.encode()).hexdigest()}


def seed_foreign_identity(conn,normalizer,run,label):
    """Explicit synthetic unrelated graph, committed after the scoped core."""
    with conn.transaction():
        conn.execute('SET LOCAL ROLE orion_pro_ingest')
        actor=normalizer.TypedCore(conn,run,None)
        actor.g=conn.execute('SELECT ingest.begin_generation(%s,%s,%s)',('synthetic-unrelated-identity:'+label,normalizer.VERSION,normalizer.VERSION)).fetchone()[0]
        player=actor.insert('football.players',display_name='Explicit synthetic unrelated identity')
        alias=actor.insert('ingest.public_aliases',route_kind='player',public_key='synthetic_unrelated_'+label,player_id=player['id'])
        conn.execute('SELECT ingest.seal_generation(%s,%s)',(actor.g,normalizer.hashed({'label':label,'playerId':player['id'],'publicKey':alias['public_key']})))
    return {'synthetic':True,'playerId':player['id'],'publicKey':alias['public_key'],'generation':actor.g}


def foreign_identity_fingerprint(conn,fixture):
    rows=[conn.execute("SELECT encode(sha256(convert_to(t::text,'UTF8')),'hex') FROM football.players t WHERE id=%s",(fixture['playerId'],)).fetchone()[0],
          conn.execute("SELECT encode(sha256(convert_to(t::text,'UTF8')),'hex') FROM ingest.public_aliases t WHERE route_kind='player' AND public_key=%s AND recorded_from_gen=%s",(fixture['publicKey'],fixture['generation'])).fetchone()[0]]
    return hashlib.sha256(json.dumps(rows).encode()).hexdigest()


def execute_worker(pg,run,payload,label):
    parent,child=socket.socketpair()
    env=os.environ.copy();env.update(ORION_PILOT_DATABASE_URL=pg.dsn,STATARENA_TEST_DATABASE='1')
    command=[sys.executable,str(Path(__file__).resolve()),'--worker-fd',str(child.fileno())]
    process=subprocess.Popen(command,env=env,pass_fds=(child.fileno(),),stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    child.close()
    with parent:
        with parent.makefile('wb') as stream:pickle.dump(payload,stream,protocol=5)
    stdout,stderr=process.communicate(timeout=180)
    (run/(label+'.stdout.log')).write_text(stdout);(run/(label+'.stderr.log')).write_text(stderr)
    result=json.loads(stdout.strip().splitlines()[-1])
    return {'argv':command,'exitCode':process.returncode,'result':result,'pidDistinct':process.pid!=os.getpid()}


def real_fresh_reimports(pg,run,args,conn,normalizer):
    foreign=seed_foreign_identity(conn,normalizer,run,'real-replay')
    foreign_before=foreign_identity_fingerprint(conn,foreign)
    before=database_fingerprint(pg.dsn)
    results=[]
    for index,mode in enumerate(['real-reimport','real-reimport','real-changed-family-source','real-changed-profile-selector']):
        evidence=run/('fresh-'+str(index));evidence.mkdir()
        payload={'mode':mode,'evidence':str(evidence),'sourceSocket':str(args.source_socket),'sourceScope':str(args.source_scope)}
        worker=execute_worker(pg,run,payload,'fresh-worker-'+str(index))
        after=database_fingerprint(pg.dsn)
        results.append({'worker':worker,'beforeSha256':before['sha256'],'afterSha256':after['sha256'],'unchanged':before==after})
    foreign_after=foreign_identity_fingerprint(conn,foreign)
    return {'before':before,'results':results,'parentPid':os.getpid(),'foreignIdentity':foreign,'foreignBeforeSha256':foreign_before,'foreignAfterSha256':foreign_after},foreign_before==foreign_after and all(x['worker']['exitCode']==0 and x['worker']['pidDistinct'] and x['unchanged'] for x in results)


def fresh_process_boundary(conn,pg,run,normalizer):
    conn.execute('SET ROLE orion_pro_ingest')
    path='computed/synthetic-fresh-process.json.gz'
    snapshot={'meta':{path:{'path':path,'physicalSha256':'d'*64,'bytes':17,'updatedAt':datetime.now(timezone.utc)}},
              'cache':{},'profile_gaps':[],'profile_metadata':[]}
    source=FixtureMemorySource(snapshot)
    parts=[{'path':path,'season':'synthetic/one','tables':{name:[] for name in ['players','teams','fixtures','matches','performances','shots','competitions']}}]
    scope={'archiveShapeChoices':[],'queries':[{'name':'archive_relation_source_versions','rows':[]},{'name':'all_scoped_player_team_profile_source_versions','rows':[]}]}
    actor=normalizer.TypedCore(conn,run,source)
    actor.import_core(parts)
    foreign=seed_foreign_identity(conn,normalizer,run,'synthetic-resume')
    foreign_before=foreign_identity_fingerprint(conn,foreign)
    before=normalizer.fact_counts(conn)
    resumed=execute_worker(pg,run,{'mode':'synthetic-resume-after-core','evidence':str(run),'snapshot':snapshot,'parts':parts,'scope':scope},'fresh-process-resume')
    after_resume=normalizer.fact_counts(conn)
    full_after_resume=database_fingerprint(pg.dsn)
    worker=execute_worker(pg,run,{'mode':'synthetic-fresh-process','evidence':str(run),'snapshot':snapshot,'parts':parts,'scope':scope},'fresh-process-boundary')
    after=normalizer.fact_counts(conn)
    full_after=database_fingerprint(pg.dsn)
    foreign_after=foreign_identity_fingerprint(conn,foreign)
    correct_resume=after_resume['ingest.dataset_snapshots']==before['ingest.dataset_snapshots']+2 and all(after_resume[k]==v for k,v in before.items() if k!='ingest.dataset_snapshots')
    return {'synthetic':True,'awsReads':0,'resumeWorker':resumed,'worker':worker,'countsBefore':before,'countsAfterResume':after_resume,'countsAfter':after,
            'foreignIdentity':foreign,'foreignBeforeSha256':foreign_before,'foreignAfterSha256':foreign_after,'fullAfterResume':full_after_resume,'fullAfterRetry':full_after},resumed['exitCode']==0 and correct_resume and worker['exitCode']==0 and worker['pidDistinct'] and after_resume==after and full_after_resume==full_after and foreign_before==foreign_after


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--pg-bin", type=Path, default=Path("/tmp/statarena-cache-test-tools/node_modules/@embedded-postgres/darwin-arm64/native/bin"))
    parser.add_argument("--label", default="real-source")
    parser.add_argument("--phase", choices=["core", "families"], default="core")
    parser.add_argument("--source-scope", type=Path, default=EVIDENCE / "source_scope.json")
    parser.add_argument('--preflight-only',action='store_true',help='Local synthetic/process boundary E2E only; never read AWS')
    parser.add_argument('--capture-cli-only',action='store_true',help='Offline operational capture CLI E2E; deny every database connection')
    parser.add_argument('--source-socket',type=Path,help='Use the existing memory-only capture; never perform an additional real-source read')
    args = parser.parse_args()
    cases = list(CASES)
    cases.insert(1,'fresh_process_reimport_boundary')
    cases.insert(1,'native_boundary_counterexamples')
    cases.insert(1,"common_native_contract_available")
    cases.append("common_native_projection_consistency")
    if args.phase == "families":
        cases.insert(1,"family_normalizer_available")
        cases.append("original_family_typed_dispositions")
        cases.append("full_profile_members_exact")
        cases.append('fresh_real_reimports_and_bindings')
    if args.preflight_only:
        cases=cases[:cases.index('real_source_import')]
    run = EVIDENCE / "real-source-runs" / (datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ") + "-" + args.label)
    run.mkdir(parents=True)
    inputs = run / "inputs"
    inputs.mkdir()
    # Code/spec metadata only. Never copy AWS documents or a PostgreSQL dump.
    for source in [Path(__file__), EVIDENCE / "REAL_SOURCE_PROTOCOL.md", EVIDENCE / "harness.py", EVIDENCE / "model-amendments.json", EVIDENCE / "approval.json", MODEL, NORMALIZER]:
        if source.exists():
            shutil.copy2(source, inputs / source.name)
    if args.capture_cli_only:
        actual,ok=capture_cli_boundary(run)
        report={'status':'pass' if ok else 'fail','environment':'offline actual CLI subprocesses; all psycopg connections denied',
                'command':'PYTHONPATH=/tmp/statarena-publication-test-python '+shlex.join([sys.executable,*sys.argv]),'actual':actual,
                'expected':'Exact explicit checkpoint accepted offline; omitted/mismatched/absent/over-budget inputs rejected before source connection',
                'normalizerSha256':sha(NORMALIZER),'testSha256':sha(Path(__file__)),'rawSourceCopies':[],'remoteWrites':[]}
        (run/'result.json').write_text(json.dumps(report,indent=2)+'\n')
        print(json.dumps({'status':report['status'],'evidence':str(run)}),flush=True)
        return 0 if ok else 1
    sys.path.insert(0, str(EVIDENCE))
    sys.path.insert(0, str(REPO / "dashboard/scripts"))
    from harness import LocalPostgres
    import psycopg
    pg = LocalPostgres(args.pg_bin, run)
    report = {"startedAt": datetime.now(timezone.utc).isoformat(), "environment": "owned disposable LOCAL PostgreSQL18.6",
              "command": "PYTHONPATH=/tmp/statarena-publication-test-python "+shlex.join([sys.executable,*sys.argv]),
              "argv": [sys.executable,*sys.argv],
              "modelSha256": sha(MODEL), "sourceScopeSha256": sha(args.source_scope), "expected": EXPECTED,
              "limits": {"awsIndexedQueries":100,"awsDecodedBytes":256*1024*1024,"awsStatementMs":8000,"awsLockMs":1000},
              "cases": [], "remoteWrites": [], "rawSourceCopies": [], "phase": args.phase,'preflightOnly':args.preflight_only}
    conn = None
    pilot = None
    blocked = None
    try:
        from orion_pro_metric_states_postgres import validate_model_gate
        _,report["modelGate"] = validate_model_gate(EVIDENCE / "model-amendments.json")
        pg.start()
        pg.migration(REPO)
        conn = psycopg.connect(pg.dsn, autocommit=True)
        for case in cases:
            if blocked:
                report["cases"].append({"case":case,"status":"unverified","reason":blocked})
                continue
            try:
                if case == "importer_available":
                    assert NORMALIZER.is_file(), "real-source normalizer does not exist (expected initial RED)"
                    spec = importlib.util.spec_from_file_location("orion_pro_normalize", NORMALIZER)
                    normalizer = importlib.util.module_from_spec(spec)
                    spec.loader.exec_module(normalizer)
                    assert callable(getattr(normalizer, "run_real_pilot", None)), "normalizer interface missing"
                    actual = {"normalizerSha256":sha(NORMALIZER)}
                elif case=='fresh_process_reimport_boundary':
                    actual,ok=fresh_process_boundary(conn,pg,run,normalizer)
                    report['freshProcessPrecodeBoundary']=actual
                    assert ok,'Fresh interpreter failed SQL rehydration/idempotent phase receipts; see fresh-process-boundary.stdout.log'
                    conn.close();conn=None
                    pg.migration(REPO,rollback_to='empty');pg.migration(REPO)
                    conn=psycopg.connect(pg.dsn,autocommit=True)
                elif case=='native_boundary_counterexamples':
                    numeric,numeric_ok=numeric_boundary(conn,normalizer)
                    collections,collections_ok=collection_boundary(conn,normalizer,run)
                    capture_cli,capture_cli_ok=capture_cli_boundary(run)
                    actual={'numeric':numeric,'collections':collections,'captureCli':capture_cli,'awsReads':0}
                    report['reviewBoundaryCounterexamples']=actual
                    assert numeric_ok and collections_ok and capture_cli_ok,'Review counterexamples failed: numeric exact='+str(numeric_ok)+', collection shapes='+str(collections_ok)+', capture CLI='+str(capture_cli_ok)
                elif case == "family_normalizer_available":
                    assert callable(getattr(normalizer.TypedCore,"import_original_families",None)), "original13-family normalizer does not exist (expected family-phase RED)"
                    assert callable(getattr(normalizer.TypedCore,"import_source_profiles",None)), "exact full-profile normalizer does not exist (expected profile-phase RED)"
                    actual = {"interface":"TypedCore.import_original_families"}
                elif case == "common_native_contract_available":
                    assert callable(getattr(normalizer.TypedCore,"insert_common_native_states",None)), "common metric native-state normalizer does not exist (expected native-state RED)"
                    actual = {"interface":"TypedCore.insert_common_native_states"}
                elif case == "real_source_import":
                    if args.source_socket is None:raise AssertionError('This bounded restart lot requires --source-socket; no automatic AWS reread')
                    pilot = normalizer.run_real_pilot(conn, run, args.source_scope, args.phase,
                        source_provider=normalizer.MemorySource.from_socket(args.source_socket),exercise_demo=True)
                    assert pilot["sourceBudget"]["queries"] <= 100
                    assert pilot["sourceBudget"]["decodedBytes"] <= 256*1024*1024
                    assert pilot["role"] == "orion_pro_ingest"
                    actual = pilot["import"]
                elif case == "exact_typed_key_counts":
                    sqls = {
                        "fixtures":"SELECT count(*) FROM football.matches_current",
                        "matches":"SELECT count(*) FROM football.matches_current WHERE status='finished'",
                        "performances":"SELECT count(*) FROM football.match_players_current",
                        "shots":"SELECT count(*) FROM football.shots_current",
                        "players":"SELECT count(*) FROM football.players",
                        "teams":"SELECT count(*) FROM football.teams",
                    }
                    actual = {k:conn.execute(sql).fetchone()[0] for k,sql in sqls.items()}
                    assert actual == {k:EXPECTED[k] for k in actual}, actual
                elif case == "source_oracle_metrics_aliases":
                    actual = pilot["oracleComparisons"]
                    assert actual and all(x["sourceSha256"]==x["typedSha256"] and x["sourceRows"]==x["typedRows"] for x in actual), actual
                    assert {x["kind"] for x in actual} >= {"fixtures","performances","shots","public_aliases"}
                elif case == "native_shapes_quality":
                    actual = pilot["nativeShapes"]
                    assert actual["missingProfileResourceCount"] == 62
                    assert actual["missingToZeroCoercions"] == 0
                    assert actual["opaqueSourceBodiesStored"] == 0
                    assert actual["numericRoundingCoercions"] == 0
                elif case == "noop_reimport":
                    actual = pilot["noop"]
                    assert actual["duplicateRows"] == 0 and actual["newFactRevisions"] == 0
                elif case == "source_correction_retains_snapshot":
                    actual = pilot["correction"]
                    assert actual["throughActualNormalizer"] and actual["newValue"] != actual["oldValue"]
                    assert actual["oldSnapshotValue"] == actual["oldValue"]
                    assert actual["newSnapshotValue"] == actual["newValue"]
                elif case == "local_sql_reads":
                    actual = pilot["reads"]
                    assert {x["kind"] for x in actual} >= {"list","player","club","match"}
                    assert all(x["rows"] > 0 and x["environment"] == "local" for x in actual)
                elif case == "mapping_acceptance_boundary":
                    actual = pilot["mapping"]
                    assert actual["dispositions"] and actual["unknownUsefulFieldsSilentlyDropped"] == 0
                    if actual["rejected"] or actual["unverified"]:
                        assert not pilot["fullAcceptance"]
                        actual = {**actual,"fullAcceptance":False,"scope":"Explicit mapping gaps remain; this is not global migration acceptance"}
                elif case == "original_family_typed_dispositions":
                    actual = pilot["families"]
                    expected_families = {"match","shots","momentum","events","players","player_halves","lineups","h2h","stats","advanced_teams","advanced_players","pass_networks","heatmaps"}
                    assert {x["family"] for x in actual["dispositions"]} == expected_families
                    assert actual["sourceMembers"]==26 and actual["uniqueMemberFailures"]==0
                    assert actual["opaqueSourceBodiesStored"]==0
                    assert actual["typedRows"]>0 and actual["leafDispositions"]
                elif case == "full_profile_members_exact":
                    actual = pilot["fullProfiles"]
                    assert actual["candidatePlayerResourceRows"]==777 and actual["selectedTeamObservations"]==20
                    assert actual["selectedPlayerObservations"]==776 and actual["mismatchedIds"]==1
                    assert actual["rejectedProviderIds"]==["p_1JuxKR"] and actual["missingPlayerResourceKeys"]==62
                    assert actual["opaqueSourceBodiesStored"]==0
                    assert conn.execute("SELECT count(*) FROM football.player_profile_versions p JOIN ingest.public_aliases_current a ON a.player_id=p.player_id AND a.route_kind='player' WHERE a.public_key='p_1JuxKR' AND p.profile_context='provider_global'").fetchone()[0]==0
                    assert conn.execute("SELECT count(*) FROM ingest.quality_issues WHERE rule_code='profile_resource_member_identity_conflict'").fetchone()[0]==1
                elif case == "common_native_projection_consistency":
                    actual = pilot["commonNativeProjection"]
                    assert actual["sourceRows"]==EXPECTED["performances"]*4 and actual["typedRows"]==actual["sourceRows"]
                    assert actual["sourceSha256"]==actual["typedSha256"]
                    assert actual["unknownMissingRows"]==0 and actual["bindingOrCohortMismatchRows"]==0
                    correction = pilot["correction"]["nativeStateOracleAfter"]
                    assert correction["sourceSha256"]==correction["typedSha256"] and correction["bindingOrCohortMismatchRows"]==0
                    assert pilot["correction"]["newNativeStates"]=={"xg":"number","xa":"null","xgot":"absent","minutes":"number"}
                elif case=='fresh_real_reimports_and_bindings':
                    actual,ok=real_fresh_reimports(pg,run,args,conn,normalizer)
                    report['freshRealReimports']=actual
                    assert ok,'Fresh real-source process changed rows/identities/generation receipts or reused a changed source binding'
                report["cases"].append({"case":case,"status":"pass","actual":actual})
                print("PASS " + case, flush=True)
            except Exception as error:
                # Never dump a row/source body or connection detail into evidence.
                safe = str(error) if (isinstance(error, AssertionError) or type(error).__name__=="MappingError") and not getattr(error, "sqlstate", None) else type(error).__name__
                report["cases"].append({"case":case,"status":"fail","error":safe,"sqlstate":getattr(error,"sqlstate",None)})
                print("FAIL " + case + ": " + safe, flush=True)
                if case in {"importer_available","fresh_process_reimport_boundary","native_boundary_counterexamples","family_normalizer_available","common_native_contract_available","real_source_import"}:
                    blocked = "prerequisite " + case + " failed"
    except Exception as error:
        report["setupError"] = {"type":type(error).__name__,"reason":str(error) if isinstance(error, RuntimeError) else None}
    finally:
        if conn is not None:
            conn.close()
        report["cleanup"] = pg.cleanup()
        report["finishedAt"] = datetime.now(timezone.utc).isoformat()
        report["counts"] = {status:sum(c["status"]==status for c in report["cases"]) for status in ("pass","fail","unverified")}
        report["status"] = "pass" if report["counts"]["pass"]==len(cases) and not report.get("setupError") else "fail"
        (run / "result.json").write_text(json.dumps(report, indent=2, default=str)+"\n")
        print(json.dumps({"status":report["status"],"counts":report["counts"],"evidence":str(run)}),flush=True)
    return 0 if report["status"]=="pass" else 1


if __name__ == "__main__":
    raise SystemExit(fresh_worker() if '--worker-fd' in sys.argv else main())
