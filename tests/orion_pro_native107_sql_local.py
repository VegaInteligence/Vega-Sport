#!/usr/bin/env python3
"""Owned PG18.6 workflow for the additive approved016 schema, no remote access."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
from decimal import Decimal
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import time
import traceback

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT/'docs/verification/orion-pro-native107-20261105'
PILOT = ROOT/'docs/verification/orion-pro-pilot-20261104'
SCRIPTS = ROOT/'dashboard/scripts'
MIG = ROOT/'dashboard/backend/migrations'
NAMES = ['012_orion_pro_domain.sql','013_orion_pro_integrity.sql','014_orion_pro_membership_nonnull.sql',
         '015_orion_pro_metric_membership_guard.sql','016_orion_pro_native_match_details.sql']
sys.path[:0] = [str(BASE),str(PILOT),str(SCRIPTS)]
from owned_cases import CASES
from layout_reuse_case import D23
from core017_cases import CORE_CASES, MIG as MIG017, MODEL as MODEL017
from owned_fixture import NativeFixture
from harness import LocalPostgres
from orion_pro_integrity import role_grants_sql
from orion_pro_migrate import bootstrap
from orion_pro_native107_delta import compile_migration
from orion_pro_native107_schema import BASE as MODEL103, MODEL as MODEL107
from orion_pro_schema import active_tables, cols, relation


def digest(data):
    return hashlib.sha256(data).hexdigest()


def save(path, value):
    path.write_text(json.dumps(value,indent=2,default=str)+'\n')


class OwnedFixture(NativeFixture):
    omitted = frozenset()
    aggregation_binding = None

    def _insert(self, table, **values):
        if table=='analytics.aggregation_builds' and self.aggregation_binding:
            values['metrics_contract_version'],values['transform_version']=self.aggregation_binding
        return super()._insert(table,**values)

    def put(self, table, tag, **values):
        if tag in self.omitted:
            assert tag in {'summary','event_team_0'}, tag
            return None
        if table in {'football.team_match_metric_values','football.source_metric_mappings'} and values.get('family_code')=='native107':
            # The synthetic value still belongs to the existing standard family.
            values['family_code']='standard'
        if tag=='event_profile_0' and self.overrides.get(tag,{}).get('profile_context')=='provider_global':
            # Reach the exact native context guard without colliding with a real
            # canonical global fixture profile under the older unique index.
            values['is_canonical']=False
        return super().put(table,tag,**values)


class Workflow:
    def __init__(self, owner, ingest, runtime, fixture, old, new, sql, run, driver):
        self.db,self.ingest,self.runtime,self.fx = owner,ingest,runtime,fixture
        self.old,self.new,self.sql,self.run,self.driver = old,new,sql,run,driver
        self.sql_hash = digest(sql.encode())

    def expect_sqlstate(self, label, action, codes, reason=None, conn=None):
        try:
            with (conn or self.db).transaction(force_rollback=True):
                action()
        except self.driver.Error as error:
            assert error.sqlstate in codes,(label,error.sqlstate,str(error))
            assert reason is None or reason in error.diag.message_primary,(label,str(error))
            return {'sqlstate':error.sqlstate,'message':error.diag.message_primary}
        raise AssertionError(label+' unexpectedly accepted')

    def rows(self):
        state={}
        for name,table in self.old.items():
            where=" WHERE version<'016'" if name=='ingest.schema_migrations' else ''
            projection=cols(table['columns'])
            rows=self.db.execute(f'SELECT ROW({projection})::text FROM {relation(name)}{where} ORDER BY '+cols(table['primary_key']['columns'])).fetchall()
            state[name]={'rows':len(rows),'sha256':digest(json.dumps(rows,separators=(',',':')).encode())}
        assert sum(x['rows'] for x in state.values())<20000
        return state

    def catalogue(self):
        names="('football','ingest','analytics')"
        queries=[
            f"SELECT n.nspname,c.relname,c.relkind,c.oid,c.relowner,c.relacl::text,pg_get_viewdef(c.oid,true) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN {names} ORDER BY 1,2",
            f"SELECT n.nspname,c.relname,a.attnum,a.attname,a.atttypid,a.atttypmod,a.attnotnull,a.attacl::text FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN {names} AND a.attnum>0 AND NOT a.attisdropped ORDER BY 1,2,3",
            f"SELECT n.nspname,conrelid,conname,pg_get_constraintdef(c.oid,true) FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname IN {names} ORDER BY 1,2,3",
            f"SELECT n.nspname,p.oid,p.proowner,p.proacl::text,pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN {names} ORDER BY 1,2",
            f"SELECT schemaname,sequencename,last_value,increment_by,cache_size,cycle FROM pg_sequences WHERE schemaname IN {names} ORDER BY 1,2",
        ]
        return {str(i):digest(json.dumps(self.db.execute(q).fetchall(),default=str).encode()) for i,q in enumerate(queries)}

    def view_shape(self):
        return self.db.execute("""SELECT c.oid,c.relacl::text,a.atttypid::regtype::text
          FROM pg_class c JOIN pg_attribute a ON a.attrelid=c.oid
          WHERE c.oid='football.match_players_current'::regclass AND a.attname='raw_pitch_x'""").fetchone()

    def apply(self):
        entries=self.db.execute('SELECT version,content_sha256 FROM ingest.schema_migrations ORDER BY version').fetchall()
        expected=[(name[:3],digest((MIG/name).read_bytes())) for name in NAMES]
        if entries==expected:
            return 'verified_noop'
        assert entries==expected[:4]
        self.db.execute(self.sql,prepare=False)
        self.db.execute("INSERT INTO ingest.schema_migrations VALUES('016',%s,CURRENT_TIMESTAMP,'owned_016_workflow')",(self.sql_hash,))
        return 'applied'

    def migration_rollback(self):
        rows,cat=self.rows(),self.catalogue()
        with self.db.transaction(force_rollback=True):
            assert self.apply()=='applied'
            assert self.db.execute("SELECT to_regclass('football.match_team_stat_items') IS NOT NULL").fetchone()[0]
        assert rows==self.rows() and cat==self.catalogue()
        save(self.run/'D01-before-after-vectors.json',{'oldRows':rows,'catalogueSha256':cat,'identicalAfterRollback':True})
        return {'rowsExact':True,'catalogueExact':True,'tables':len(rows)}

    def upgrade_and_compare(self):
        old_rows=self.rows();view=self.view_shape()
        coordinate=self.db.execute("SELECT raw_pitch_x::text FROM football.match_players WHERE variant_key='owned:roundtrip'").fetchone()[0]
        assert coordinate=='0.8200000000000001'
        with self.db.transaction():
            assert self.apply()=='applied'
        assert self.rows()==old_rows and self.view_shape()==view
        assert self.db.execute("SELECT raw_pitch_x::text FROM football.match_players WHERE variant_key='owned:roundtrip'").fetchone()[0]==coordinate
        assert self.db.execute("SELECT count(*) FROM football.match_players WHERE source_raw_pitch_x_state<>'unrecorded'").fetchone()[0]==0
        totals=self.db.execute("""WITH t AS (SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE c.relkind='r' AND n.nspname IN ('football','ingest','analytics'))
          SELECT (SELECT count(*) FROM t),(SELECT count(*) FROM pg_attribute a JOIN t ON t.oid=a.attrelid WHERE a.attnum>0 AND NOT a.attisdropped),
          (SELECT count(*) FROM pg_constraint c JOIN t ON t.oid=c.conrelid WHERE c.contype='f')""").fetchone()
        assert totals==(98,1823,447),totals
        after=self.catalogue()
        with self.db.transaction():assert self.apply()=='verified_noop'
        assert after==self.catalogue()
        self.fx.bind107()
        return {'nativeTotals':totals,'unchangedOldRows':sum(x['rows'] for x in old_rows.values()),'coordinateText':coordinate,'oldViewShape':view,'journalNoop':True}

    def native_workflow(self, feature, label, *, commit=False, empty=False, overrides=None, omit=(), reject=None):
        result=None;self.fx.omitted=frozenset(omit)
        def operation():
            nonlocal result
            # The generation's xmin must belong to the same top-level transaction.
            # A nested fixture context creates a savepoint with a different xmin.
            previous=self.fx.g
            g=self.fx._begin(label)
            self.fx.g=g
            try:
                graph=self.fx.family(feature,label,overrides,empty=empty)
                self.ingest.execute('SELECT ingest.seal_generation(%s,%s)',(g,digest(f'{label}:{g}'.encode())))
            finally:
                self.fx.g=previous
            self.ingest.execute('SET CONSTRAINTS ALL IMMEDIATE')
            values={}
            if feature=='events':
                rows=self.ingest.execute("""SELECT e.event_type,e.source_event_type_state,p.display_name,e.is_penalty
                    FROM football.match_events e JOIN football.player_profile_versions p ON p.id=e.player_profile_version_id
                    WHERE e.recorded_from_gen=%s ORDER BY e.source_ordinal""",(g,)).fetchall()
                assert rows==[('','value','',False),(None,'null',None,False)],rows;values['events']=rows
            elif feature=='lineups':
                rows=self.ingest.execute('SELECT raw_pitch_x,raw_pitch_y,is_captain FROM football.match_players WHERE recorded_from_gen=%s ORDER BY revision_id',(g,)).fetchall()
                assert rows==[(Decimal('0.8200000000000000001'),None,False)]*2,rows;values['members']=rows
            elif feature=='stats':
                rows=self.ingest.execute("""SELECT x.raw_key,x.title,x.format_type,h.numeric_value,a.text_value
                     FROM football.match_team_stat_items x JOIN football.team_match_metric_values h ON h.revision_id=x.home_metric_revision_id
                     JOIN football.team_match_metric_values a ON a.revision_id=x.away_metric_revision_id
                     WHERE x.recorded_from_gen=%s ORDER BY x.source_record_id""",(g,)).fetchall()
                assert rows==[('repeated','',None,Decimal('9007199254740993'),'')]*2,rows;values['items']=rows
                assert self.ingest.execute('SELECT groups_count FROM football.match_team_stat_periods WHERE recorded_from_gen=%s ORDER BY source_record_id',(g,)).fetchall()==[(1,),(0,)]
            else:
                row=self.ingest.execute('SELECT home_wins,away_wins,draws,total_matches FROM football.match_h2h_summaries WHERE recorded_from_gen=%s',(g,)).fetchone()
                assert row==(Decimal('9007199254740993'),None,Decimal(0),Decimal('9007199254740993')),row
                count=self.ingest.execute('SELECT count(*) FROM football.match_h2h_entries WHERE recorded_from_gen=%s',(g,)).fetchone()[0]
                assert count==(0 if empty else 1);values['totals']=row
            result={'generation':g,'typedGraphRows':len(graph['rows']),'actual':values,'committed':commit}
        try:
            if reject:
                return self.expect_sqlstate(label,operation,{'23514'},reject,self.ingest)
            with self.ingest.transaction(force_rollback=not commit):operation()
            if commit:
                assert self.runtime.execute("SELECT status FROM ingest.dataset_snapshots WHERE generation=%s",(result['generation'],)).fetchone()==('sealed',)
                result['ordinaryRuntimeReadback']=True
            return result
        finally:self.fx.omitted=frozenset()

    def child_immutability_and_roles(self):
        self.native_workflow('stats','role_probe_stats',commit=True)
        table='football.match_team_stat_items'
        assert self.runtime.execute('SELECT count(*) FROM '+table).fetchone()==(2,)
        result={}
        for label,conn,sql,code in [
            ('owner_update',self.db,f'UPDATE {table} SET title=title','55000'),
            ('ingest_update',self.ingest,f'UPDATE {table} SET title=title','42501'),
            ('runtime_insert',self.runtime,f'INSERT INTO {table} SELECT * FROM {table} LIMIT 1','42501'),
            ('late_child',self.ingest,f'INSERT INTO {table} SELECT * FROM {table} LIMIT 1','55000'),
        ]:result[label]=self.expect_sqlstate(label,lambda:conn.execute(sql),{code},conn=conn)
        return result

    def legacy_closed_profile_and_015_guards(self):
        original=self.fx.player_profiles[0]
        self.fx.correct()
        retained=self.runtime.execute('SELECT display_name,recorded_to_gen,source_name_state FROM football.player_profile_versions WHERE id=%s',(original['id'],)).fetchone()
        assert retained==(original['display_name'],self.fx.catalog2,'unrecorded'),retained
        current=self.db.execute("SELECT prosrc FROM pg_proc WHERE oid='ingest.validate_generation(bigint)'::regprocedure").fetchone()[0]
        before=(MIG/NAMES[3]).read_text().split('AS $orion_pro$',1)[1].split('$orion_pro$;',1)[0]
        expected=[l for l in before.splitlines() if 'Identical typed reimport must reuse' not in l]
        observed=[l for l in current.splitlines() if 'Identical typed reimport must reuse' not in l and 'PERFORM ingest.validate_native107_generation' not in l]
        assert expected==observed,'A sealed015 predicate changed'
        return {'retainedPhysicalProfile':original['id'],'closedAt':self.fx.catalog2,'allNonNoop015LinesExact':True,'httpQualification':False}


def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--run-owned',action='store_true');ap.add_argument('--label',required=True)
    ap.add_argument('--layout-reuse',action='store_true')
    ap.add_argument('--core-fields017',action='store_true')
    ap.add_argument('--pg-bin',type=Path,default=Path('/tmp/statarena-cache-test-tools/node_modules/@embedded-postgres/darwin-arm64/native/bin'))
    args=ap.parse_args();assert args.run_owned and re.fullmatch(r'[A-Za-z0-9-]{1,70}',args.label)
    cases=[*CASES,*([D23] if args.layout_reuse or args.core_fields017 else []),*(CORE_CASES if args.core_fields017 else [])]
    assert not any(k.startswith('PG') for k in os.environ)
    run=BASE/'owned-sql-runs'/(datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')+'-'+args.label);run.mkdir(parents=True)
    t=time.monotonic();deadline=t+600
    report={'kind':'owned_016_native_sql_e2e_v1','command':[sys.executable,*sys.argv],
        'expected':'OWNED_SQL_PROTOCOL.md and requested D00–D22 / D23 layout reuse / D24–D28 core017 workflows','cases':[],'sourceCalls':0,'cloudCalls':0,'rdsWrites':[],
        'externalSqlCalls':0,'inputSha256':{},'resourceSamples':[],
        'bounds':{'seconds':600,'sqlCalls':15000,'ownedPg':1,'connections':4,'diskBytes':1024**3,'evidenceBytes':96*1024**2}}
    inputs=[Path(__file__),BASE/'OWNED_SQL_PROTOCOL.md',BASE/'owned_cases.py',BASE/'owned_fixture.py',BASE/'layout_reuse_case.py',BASE/'core017_cases.py',BASE/'PROTOCOL.md',MODEL103,MODEL107,
        *[MIG/n for n in NAMES],*[SCRIPTS/n for n in ['orion_pro_native107_schema.py','orion_pro_native107_delta.py','orion_pro_schema.py','orion_pro_integrity.py','orion_pro_migrate.py','sql/orion_pro_native107_validation.sql']],
        PILOT/'harness.py',PILOT/'fixtures.py',ROOT/'docs/verification/orion-pro-readers-20261104/fixture.py']
    if args.core_fields017:
        inputs.extend([MIG017,MODEL017,SCRIPTS/'orion_pro_native107_core.py',
            ROOT/'docs/verification/orion-pro-match-core-fields-20261105/SQL_PROTOCOL.md',
            ROOT/'docs/verification/orion-pro-match-core-fields-20261105/PUBLICATION_BINDING_017.json'])
    for p in inputs:
        name=str(p.resolve().relative_to(ROOT));target=run/'inputs'/name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,target);report['inputSha256'][name]=digest(p.read_bytes())
    pg=None;clients=[];failed=False
    def budget():
        assert time.monotonic()<deadline and report['externalSqlCalls']<15000,'Owned workflow budget reached'
    def sample(label):
        owned=int(subprocess.check_output(['du','-sk',str(pg.root)],text=True,timeout=3).split()[0])*1024
        proofs=sum(p.stat().st_size for p in run.rglob('*') if p.is_file() and not p.is_symlink())
        report['resourceSamples'].append({'case':label,'ownedDiskBytes':owned,'evidenceBytes':proofs})
        assert owned<1024**3 and proofs<96*1024**2,'Owned disk or proof budget reached'
    class Counted:
        def __init__(self,conn):self.conn=conn
        def __getattr__(self,key):return getattr(self.conn,key)
        def execute(self,*a,**kw):
            budget();report['externalSqlCalls']+=1
            return self.conn.execute(*a,**kw)
    def connect(db,user):
        assert sum(not c.closed for c in clients)<4
        c=psycopg.connect(host='127.0.0.1',port=pg.port,dbname=db,user=user,sslmode='disable',gssencmode='disable',autocommit=True,
            options='-c statement_timeout=8000 -c lock_timeout=1000 -c timezone=UTC -c datestyle=ISO,YMD -c extra_float_digits=3',connect_timeout=5)
        clients.append(c);return Counted(c)
    def stop(signum,frame):raise TimeoutError('Owned016 global deadline')
    signal.signal(signal.SIGALRM,stop);signal.setitimer(signal.ITIMER_REAL,590)
    try:
        import psycopg
        sql=(MIG/NAMES[-1]).read_text();assert compile_migration()==sql.encode()
        old=json.loads(MODEL103.read_text());new=json.loads(MODEL107.read_text())
        pg=LocalPostgres(args.pg_bin,run);pg.start()
        setup=connect('postgres',os.environ.get('USER','postgres'));assert setup.info.server_version==180006
        for role in ['statarena_admin','statarena_ingest','statarena_runtime']:
            setup.execute('CREATE ROLE '+role+' LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS')
        setup.execute('CREATE DATABASE native107_owned OWNER statarena_admin');setup.close()
        owner=connect('native107_owned','statarena_admin')
        with owner.transaction():
            artifacts=[]
            for name in NAMES[:4]:
                path=MIG/name;text=path.read_text();owner.execute(text,prepare=False);artifacts.append((name[:3],path,text))
                owner.execute("INSERT INTO ingest.schema_migrations VALUES(%s,%s,CURRENT_TIMESTAMP,'owned_015_baseline')",(name[:3],digest(text.encode())))
            bootstrap(owner,old,artifacts[:2]);owner.execute(role_grants_sql(old,'statarena_ingest','statarena_runtime'),prepare=False)
        ingest=connect('native107_owned','statarena_ingest');runtime=connect('native107_owned','statarena_runtime')
        fixture=OwnedFixture(ingest,pg.dsn,run,psycopg);fixture.prepare()
        with fixture._generation('legacy_coordinate_precision'):
            m=fixture.match_rows['m_000001'];side=fixture.sides['m_000001']['home']
            fixture._insert('football.match_players',match_id=m['id'],team_id=side['team_id'],player_id=fixture.ids['players'][0]['id'],
               match_team_revision_id=side['revision_id'],profile_version_id=fixture.player_profiles[0]['id'],squad_status='observed',
               source_id=fixture.ids['source'],source_record_id=fixture.ids['record'],raw_pitch_x=0.8200000000000001,coordinate_frame='unknown',variant_key='owned:roundtrip',is_canonical=False)
        workflow=Workflow(owner,ingest,runtime,fixture,active_tables(old),active_tables(new),sql,run,psycopg)
        sample('setup')
        for case in cases:
            budget();start=time.monotonic()
            try:
                actual=case(workflow);report['cases'].append({'case':case.__name__,'status':'pass','seconds':round(time.monotonic()-start,3),'actual':actual})
            except BaseException as error:
                report['cases'].append({'case':case.__name__,'status':'fail','errorType':type(error).__name__,'error':str(error),'sqlstate':getattr(error,'sqlstate',None),'traceback':traceback.format_exc()});failed=True
            sample(case.__name__)
            save(run/'progress.json',report);print(case.__name__,report['cases'][-1]['status'],flush=True)
            if failed:break
    except BaseException as error:
        failed=True;report['setupFailure']={'errorType':type(error).__name__,'error':str(error),'traceback':traceback.format_exc()}
    finally:
        signal.setitimer(signal.ITIMER_REAL,0)
        for c in clients:c.close()
        report['connectionsClosed']=all(c.closed for c in clients)
        if pg:
            try:
                if (pg.data/'postmaster.pid').exists():pg.started=True
                report['cleanup']=pg.cleanup()
            except BaseException as error:
                failed=True;report['cleanup']={'errorType':type(error).__name__,'error':str(error)}
        else:report['cleanup']={'ownedPgStarted':False}
        observed={c['case'] for c in report['cases']}
        report['cases'] += [{'case':c.__name__,'status':'unverified'} for c in cases if c.__name__ not in observed]
        report['counts']={s:sum(x['status']==s for x in report['cases']) for s in ['pass','fail','unverified']}
        report['inputHashesExact']=all(digest((ROOT/n).read_bytes())==h for n,h in report['inputSha256'].items())
        report['elapsedSeconds']=round(time.monotonic()-t,3)
        report['status']='pass_owned_sql_only' if not failed and report['inputHashesExact'] and report['counts']['pass']==len(cases) else 'fail'
        save(run/'result.json',report);print(json.dumps({'status':report['status'],'counts':report['counts'],'evidence':str(run/'result.json')}),flush=True)
    return 0 if report['status']=='pass_owned_sql_only' else 1


if __name__=='__main__':raise SystemExit(main())
