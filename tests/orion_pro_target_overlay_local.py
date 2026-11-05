#!/usr/bin/env python3
"""Owned PostgreSQL 18.6 workflow for the old native COPY and the approved target."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import sys
import time
import traceback
import types

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'docs/verification/orion-pro-target-overlay-20261105'
SCRIPTS = ROOT / 'dashboard/scripts'
PILOT = ROOT / 'docs/verification/orion-pro-pilot-20261104'
PROJECTION = SCRIPTS / 'orion_pro_target_overlay.py'
MODEL = ROOT / 'docs/architecture/orion-plan-20261104/target-schema.proposed.json'
TARGET = ROOT / 'docs/architecture/orion-native-details-107-20261105/target-schema.approved-107-core.json'
MIG = ROOT / 'dashboard/backend/migrations'
MIGRATIONS = [MIG / name for name in (
    '012_orion_pro_domain.sql', '013_orion_pro_integrity.sql',
    '014_orion_pro_membership_nonnull.sql', '015_orion_pro_metric_membership_guard.sql',
    '016_orion_pro_native_match_details.sql', '017_orion_pro_native_match_core_fields.sql')]
PG = '/tmp/statarena-cache-test-tools/node_modules/@embedded-postgres/darwin-arm64/native/bin'
CASES = ('product_available', 'source_target_native_setup', 'adoption_rollback', 'adoption_commit_and_noop',
         'target_contract_drift_refused', 'source_float_loss_refused', 'preflight_and_copy',
         'independent_committed_typed_parity', 'exact_replay')


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save(path, body):
    path.write_text(json.dumps(body, indent=2, default=str) + '\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--precode-red', action='store_true')
    parser.add_argument('--label', default='owned-overlay')
    parser.add_argument('--pg-bin', type=Path, default=PG)
    args = parser.parse_args()
    assert re.fullmatch('[a-z0-9-]{1,60}', args.label) and not sys.flags.optimize
    run = BASE / 'runs' / (datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ') + '-' + args.label)
    (run / 'inputs').mkdir(parents=True)
    started = time.monotonic()
    report = {'kind': 'owned_native_target_overlay_e2e_v1', 'command': [sys.executable, *sys.argv],
              'expected': str(BASE / 'PROTOCOL.md'), 'cases': [], 'inputHashes': {}, 'pgStarts': 0,
              'sourceCalls': 0, 'rdsCalls': 0, 'rawSourceWrites': 0, 'noOtherDatabaseAccepted': True}
    source = target = owner = pg = None
    clients = []
    active = CASES[0]
    try:
        inputs = [Path(__file__), BASE/'PROTOCOL.md', PROJECTION, MODEL, TARGET, *MIGRATIONS,
                  PILOT/'harness.py', PILOT/'fixtures.py', ROOT/'tests/orion_pro_bulk_local.py',
                  ROOT/'tests/orion_pro_bulk_stream_local.py', SCRIPTS/'orion_pro_native_transport.py',
                  SCRIPTS/'orion_pro_bulk_stream_v2.py', SCRIPTS/'orion_pro_bulk.py', SCRIPTS/'orion_pro_policy.py',
                  SCRIPTS/'orion_pro_schema.py', SCRIPTS/'orion_pro_migrate.py', SCRIPTS/'orion_pro_integrity.py']
        for p in inputs:
            if p.is_file():
                rel=p.relative_to(ROOT);dest=run/'inputs'/rel;dest.parent.mkdir(parents=True,exist_ok=True)
                shutil.copy2(p,dest);report['inputHashes'][str(rel)]=sha(dest)
        if args.precode_red:
            assert not PROJECTION.exists(), 'Pre-code candidate already exists'
            raise AssertionError('Missing approved target overlay product (pre-code RED)')
        assert PROJECTION.is_file() and not any(k.startswith('PG') for k in os.environ)
        def passed(**actual):
            report['cases'].append({'case':active,'status':'pass','actual':actual})
            save(run/'progress.json',report)
            print('PASS '+active,flush=True)
        passed(productSha256=sha(PROJECTION))
        sys.path[:0]=[str(SCRIPTS),str(PILOT),str(ROOT/'tests'),'/tmp/statarena-publication-test-python']
        import psycopg
        from harness import LocalPostgres
        from orion_pro_migrate import bootstrap
        from orion_pro_integrity import role_grants_sql
        from orion_pro_bulk_local import oracle, sequences
        from orion_pro_bulk_stream_local import fixture, hashed
        from orion_pro_schema import active_tables
        import orion_pro_native_transport as frozen
        import orion_pro_target_overlay as overlay

        def alarm(_sig,_frame): raise TimeoutError('180-second owned overlay deadline')
        signal.signal(signal.SIGALRM,alarm);signal.setitimer(signal.ITIMER_REAL,175)
        active=CASES[1]
        pg=LocalPostgres(args.pg_bin,run);pg.start();report['pgStarts']=1
        def connect(db,actor,*,readonly=False):
            assert sum(not c.closed for c in clients)<5
            options='-c statement_timeout=8000 -c lock_timeout=1000 -c timezone=UTC -c datestyle=ISO,YMD -c extra_float_digits=3'
            if readonly:options+=' -c default_transaction_read_only=on'
            c=psycopg.connect(host='127.0.0.1',hostaddr='127.0.0.1',port=pg.port,dbname=db,user=actor,
                password='',passfile='/dev/null',sslmode='disable',gssencmode='disable',autocommit=True,
                connect_timeout=5,options=options,application_name='owned-native-target-overlay')
            clients.append(c);assert c.info.server_version==180006
            return c
        with connect('postgres',os.environ['USER']) as admin:
            for actor in ('orion_pro_owner','orion_pro_ingest','orion_pro_runtime','statarena_admin','statarena_ingest','statarena_runtime'):
                admin.execute('CREATE ROLE '+actor+' LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS')
            admin.execute('CREATE DATABASE native_source OWNER orion_pro_owner')
            admin.execute('CREATE DATABASE native_target OWNER statarena_admin')
        old=json.loads(MODEL.read_text()); old_tables=active_tables(old)
        for db, role, prefix, end in [('native_source','orion_pro_owner','orion_pro',2),('native_target','statarena_admin','statarena',4)]:
            with connect(db,role) as admin,admin.transaction():
                batch=[]
                for p in MIGRATIONS[:end]:
                    sql=p.read_text();admin.execute(sql,prepare=False)
                    admin.execute('INSERT INTO ingest.schema_migrations VALUES(%s,%s,CURRENT_TIMESTAMP,%s)',(p.name[:3],sha(p),'owned-overlay-baseline'))
                    batch.append((p.name[:3],p,sql))
                bootstrap(admin,old,batch[:2])
                admin.execute(role_grants_sql(old,prefix+'_ingest',prefix+'_runtime'),prepare=False)
                if db=='native_source':
                    admin.execute(MIGRATIONS[2].read_text(),prepare=False)
                else:
                    admin.execute('CREATE TABLE public.legacy_sentinel(id integer PRIMARY KEY,payload text)')
                    admin.execute("INSERT INTO public.legacy_sentinel VALUES(1,'preserved')")
        shape={'APPEARANCES':40,'SCALARS':1240,'MATCHES':4,'PLAYERS':40,'VERSION':frozen.FIXTURE_VERSION}
        producer=hashed({'fixtureCodeSha256':sha(ROOT/'tests/orion_pro_bulk_stream_local.py'),
                         'testSha256':sha(Path(__file__)),'shape':shape})
        coords=[]
        class PreciseFixture:
            def __init__(self,c):self.c=c
            def __getattr__(self,key):return getattr(self.c,key)
            def execute(self,sql,args=None):
                if sql.startswith('INSERT INTO football.match_players(match_id'):
                    head='transform_code_sha256,provenance_kind)\n'
                    body="'provider'\n                FROM generate_series"
                    assert sql.count(head)==sql.count(body)==1
                    sql=sql.replace(head,'transform_code_sha256,provenance_kind,raw_pitch_x,raw_pitch_y,coordinate_frame)\n')
                    sql=sql.replace(body,"'provider',CASE WHEN i%%3=0 THEN 0.8200000000000001::float8 WHEN i%%3=1 THEN 0::float8 END, -25.01::float8, 'unknown'\n                FROM generate_series")
                    coords.append(sql)
                return self.c.execute(sql,args)
        with connect('native_source','orion_pro_ingest') as writer:
            create=types.FunctionType(fixture.__code__,{**fixture.__globals__,**shape})
            evidence=run/'fixture';evidence.mkdir()
            phases=create(PreciseFixture(writer),old,producer,evidence)
        assert len(coords)==1
        (run/'fixture'/'coordinate-sql.txt').write_text(coords[0])
        source=connect('native_source','orion_pro_runtime',readonly=True)
        owner=connect('native_target','statarena_admin')
        target=connect('native_target','statarena_ingest',readonly=True)
        source_vector=oracle(source,old_tables)
        view_sql="""SELECT c.oid,c.relacl::text,format_type(a.atttypid,a.atttypmod) FROM pg_class c
          JOIN pg_attribute a ON a.attrelid=c.oid WHERE c.oid='football.match_players_current'::regclass AND a.attname='raw_pitch_x'"""
        owner_before=overlay.catalogue(owner, '015')
        b0=oracle(owner,old_tables); seq=sequences(owner); view=owner.execute(view_sql).fetchone()
        passed(sourceRows=sum(v['rows'] for v in source_vector.values()),sourcePhases=phases,targetShape=owner_before['dimensions'],
               sequences=len(seq),view=view,producerSha256=producer)
        active=CASES[2]
        class Abort(Exception):pass
        def abort(version):
            assert version=='016'
            raise Abort()
        try:overlay.adopt(owner,owner_before,release_commit='owned-overlay',after_first=abort)
        except Abort:pass
        else:raise AssertionError('Migration rollback fault was not observed')
        assert overlay.catalogue(owner,'015')==owner_before and oracle(owner,old_tables)==b0 and sequences(owner)==seq
        passed(journalRestored=True,nativePreserved=True,sequencesPreserved=True)
        active=CASES[3]
        before_journal=owner_before['journal']
        adopted=overlay.adopt(owner,owner_before,release_commit='owned-overlay')
        with connect('native_target','statarena_runtime',readonly=True) as runtime:
            independently=overlay.catalogue(runtime,'017')
        assert independently==adopted['after']
        assert independently['journal'][:4]==before_journal
        assert adopted['ddl']==2 and adopted['journalInserts']==2
        assert owner.execute(view_sql).fetchone()==view and sequences(owner)==seq
        assert oracle(owner,old_tables,{'football.match_players':{'raw_pitch_x':'raw_pitch_x::float8','raw_pitch_y':'raw_pitch_y::float8'}}).keys()==b0.keys()
        assert overlay.adopt(owner,independently,release_commit='owned-overlay')['ddl']==0
        passed(migration=adopted,independentActor='statarena_runtime',viewUnchanged=True,sequencesUnchanged=True)
        active=CASES[4]
        with owner.transaction(force_rollback=True):
            owner.execute("ALTER TABLE football.match_observation_details ALTER COLUMN source_referee_state DROP NOT NULL")
            try:overlay.catalogue(owner,'017')
            except overlay.OverlayError:pass
            else:raise AssertionError('Foreign nullability passed approved overlay')
        with owner.transaction(force_rollback=True):
            owner.execute("INSERT INTO ingest.schema_migrations VALUES('099',repeat('a',64),CURRENT_TIMESTAMP,'owned-foreign')")
            try:overlay.catalogue(owner,'017')
            except overlay.OverlayError:pass
            else:raise AssertionError('Foreign journal passed approved overlay')
        assert overlay.catalogue(owner,'017')==independently
        passed(refused=['column','journal'])
        active=CASES[5]
        # An owned, isolated projection of an actual float8 SQL value is used to
        # exercise the exact production test expression without touching source.
        guard=overlay.source_coordinate_guard('candidate')
        witness=owner.execute("SELECT "+guard+" FROM (VALUES('-0'::float8,NULL::float8),(NULL,0::float8),('NaN'::float8,NULL),(0.82::float8,NULL)) candidate(raw_pitch_x,raw_pitch_y)").fetchall()
        assert witness==[(True,),(False,),(True,),(False,)]
        extra=overlay.target_coordinate_guard('candidate')
        assert owner.execute("SELECT "+extra+" FROM (VALUES(0.820000000000000100001::numeric,NULL::numeric),(0.8200000000000001::numeric,NULL)) candidate(raw_pitch_x,raw_pitch_y)").fetchall()==[(True,),(False,)]
        passed(signedZeroAndNonFiniteRefused=True,inventedDecimalRefused=True)
        active=CASES[6]
        class OwnedBridge(overlay.TransportOverlay,frozen.NativeTransport):pass
        accepted={'sourceNativeSha256':frozen.hashed(source_vector),'sourceTables':source_vector,
                  'sourceRows':sum(v['rows'] for v in source_vector.values()),'sourcePhases':phases,
                  'dataOrigin':frozen.FIXTURE_ORIGIN,'producerVersion':frozen.FIXTURE_VERSION,'producerSha256':producer,
                  'writerSha256':sha(PROJECTION),'sourceCheckpointSha256':sha(Path(__file__))}
        pair={'source':frozen.describe_endpoint(source,source=True,origin='owned_source_free_fixture'),
              'target':frozen.describe_endpoint(target,source=False,origin='owned_local_tls_target')}
        def transport():
            record=frozen.new_report()
            bridge=OwnedBridge(source,target,pair,accepted,record,frozen.hashed(pair),frozen.fixed_bindings())
            bridge.policies()
            for c,is_source in [(source,True),(target,False)]:
                with c.transaction():bridge.baseline(c,is_source)
            source.execute('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
            bridge.inspect_source()
            bridge.target_bounds()
            completed=bridge.prefix()
            expected=bridge.business(source,owners={0,*(p['sourceGeneration'] for p in completed)})
            source.commit()
            with target.transaction():bridge.verify_business(expected)
            bridge.apply(completed,None)
            return record
        assert source.execute("SELECT current_user,current_setting('transaction_read_only')").fetchone()==('orion_pro_runtime','on')
        assert target.execute("SELECT current_user,current_setting('transaction_read_only')").fetchone()==('statarena_ingest','on')
        first=transport();save(run/'copy.json',first)
        assert first['status']=='applied' and len(first['completedPhases'])==2 and first['copiedScalarRows']==1240
        assert first['nativeRelationsVerified']==91 and first['sequenceValueSelects']==0
        passed(copies=first['copyCommands'],rows=first['copiedRows'],scalarRows=first['copiedScalarRows'],
               sealMs=first['sealMs'],commitMs=first['commitMs'])
        active=CASES[7]
        # Use an independent native oracle and the source/target committed
        # control rows. No dependence on the writer's inverse projection.
        old_controls=source.execute('SELECT generation,id FROM ingest.dataset_snapshots ORDER BY generation').fetchall()
        new_controls=owner.execute('SELECT generation,id FROM ingest.dataset_snapshots ORDER BY generation').fetchall()
        assert len(old_controls)==len(new_controls)==3
        substitutions={}
        from orion_pro_bulk_stream_v2 import CONTROL
        from orion_pro_schema import ident
        model=old_tables
        components={('ingest.dataset_snapshots','generation'):0,('ingest.dataset_snapshots','id'):1}
        before={}
        while before!=components:
            before=components.copy()
            for name,table in model.items():
                for fk in table['foreign_keys']:
                    for child,parent in zip(fk['columns'],fk['references']['columns']):
                        marker=components.get((fk['references']['table'],parent))
                        if marker is not None:components[name,child]=marker
        assert len(components)==106
        for (name,column),i in components.items():
            col=ident(column)
            clauses=' '.join(f'WHEN {t[i]} THEN {s[i]}' for s,t in zip(old_controls,new_controls))
            substitutions.setdefault(name,{})[column]=f'CASE {col} {clauses} ELSE {col} END'
        substitutions.setdefault('football.match_players',{}).update(raw_pitch_x='raw_pitch_x::float8',raw_pitch_y='raw_pitch_y::float8')
        names={k:v for k,v in old_tables.items() if k not in CONTROL}
        source_business={k:v for k,v in source_vector.items() if k in names}
        got=oracle(owner,names,substitutions)
        assert got==source_business and oracle(source,old_tables)==source_vector
        report['independentNative91Sha256']=frozen.hashed(got)
        assert owner.execute("SELECT payload FROM public.legacy_sentinel WHERE id=1").fetchone()==('preserved',)
        hist=owner.execute("SELECT raw_pitch_x::text,count(*) FROM football.match_players GROUP BY raw_pitch_x ORDER BY raw_pitch_x NULLS LAST").fetchall()
        assert dict(hist)=={'0':14,'0.8200000000000001':13,None:13}
        checked=overlay.verify_core_defaults(owner)
        assert checked['emptyNewTables']==4
        passed(native91=frozen.hashed(got),coordinateCounts=hist,targetDefaults=checked,sourceUnchanged=True,legacyUnchanged=True)
        active=CASES[8]
        state=sequences(owner)
        target.execute('SET default_transaction_read_only=on')
        replay=transport();save(run/'replay.json',replay)
        assert replay['status']=='noop' and replay['copyCommands']==replay['nextvalCalls']==0 and sequences(owner)==state
        passed(status='noop',copyCommands=0,nextvalCalls=0)
    except BaseException as error:
        report['cases'].append({'case':active,'status':'fail','error':str(error),'type':type(error).__name__,'traceback':traceback.format_exc()})
    finally:
        signal.setitimer(signal.ITIMER_REAL,0)
        for c in clients:c.close()
        report['connectionsClosed']=all(c.closed for c in clients)
        if pg:
            report['ownedDiskBytes']=sum(p.stat().st_size for p in pg.root.rglob('*') if p.is_file())
            report['cleanup']=pg.cleanup()
        else:report['cleanup']={'serverStarted':False}
        names={c['case'] for c in report['cases']}
        report['cases'] += [{'case':name,'status':'unverified'} for name in CASES if name not in names]
        report['inputsExact']=all(sha(ROOT/name)==digest for name,digest in report['inputHashes'].items())
        report['counts']={s:sum(c['status']==s for c in report['cases']) for s in ('pass','fail','unverified')}
        report['elapsedSeconds']=round(time.monotonic()-started,3)
        report['status']='pass_owned_only' if report['counts']['pass']==len(CASES) and report['inputsExact'] else 'fail'
        save(run/'result.json',report)
        print(json.dumps({'status':report['status'],'counts':report['counts'],'receipt':str(run/'result.json')}))
    return 0 if report['status']=='pass_owned_only' else 1


if __name__=='__main__':raise SystemExit(main())
