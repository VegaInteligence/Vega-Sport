#!/usr/bin/env python3
"""Local full-workflow E2E for the independent RDS readback; no cloud access."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import traceback

ROOT = Path(__file__).resolve().parents[1]
HERE = ROOT / 'docs/verification/orion-pro-pilot-20261104'
SCRIPT = HERE / 'rds_readback.py'
ORACLE = HERE / 'rds_catalogue.py'
HOST = 'statarena-postgres.clcy2iqyajbl.us-east-2.rds.amazonaws.com'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--label', default='catalogue-guards')
    p.add_argument('--baseline', action='store_true')
    p.add_argument('--pg-bin', type=Path, default=Path('/tmp/statarena-cache-test-tools/node_modules/@embedded-postgres/darwin-arm64/native/bin'))
    args = p.parse_args()
    if not args.label.replace('-', '').isalnum():
        p.error('Use a simple label')
    sys.path[:0] = [str(HERE), str(ROOT / 'dashboard/scripts')]
    import psycopg
    from harness import LocalPostgres
    from orion_pro_integrity import role_grants_sql
    from orion_pro_schema import approved_model, SPEC
    run = HERE / 'rds-readback-local-runs' / (datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ') + '-' + args.label)
    inputs = run / 'inputs'; inputs.mkdir(parents=True)
    sources = [Path(__file__), SCRIPT, HERE/'RDS_READBACK_PROTOCOL.md', SPEC, HERE/'harness.py', HERE/'approval.json', HERE/'model-amendments.json']
    sources += [ROOT/'dashboard/scripts'/n for n in ('orion_pro_schema.py','orion_pro_integrity.py','orion_pro_migrate.py')]
    sources += [ROOT/'dashboard/backend/migrations'/n for n in ('012_orion_pro_domain.sql','013_orion_pro_integrity.sql')]
    if ORACLE.exists():sources.append(ORACLE)
    report = {'kind':'owned_local_rds_readback_e2e','startedAt':datetime.now(timezone.utc).isoformat(),
              'command':['python3','tests/orion_pro_rds_readback_local.py',*sys.argv[1:]],'baseline':args.baseline,
              'setup':'Owned disposable PG18.6; actual TLS and statarena_prod/roles; pinned reader transport mapped only to owned loopback cluster',
              'expected':'RDS_READBACK_PROTOCOL.md correction matrix','sourceSha256':{},'cases':[], 'remoteWrites':[],
              'limits':['No remote TLS/network/CA or AWS behavior is established; all SQL is local']}
    for source in sources:
        shutil.copy2(source, inputs/source.name); report['sourceSha256'][str(source.relative_to(ROOT))]=sha(source)
    pg=LocalPostgres(args.pg_bin,run); admin=None; original_connect=psycopg.connect
    try:
        expected_path=None
        if not args.baseline:
            assert ORACLE.is_file(),'Local catalogue oracle helper is missing'
            command=['python3',str(ORACLE),'--prepare-local','--label',args.label+'-oracle','--pg-bin',str(args.pg_bin)]
            got=subprocess.run(command,cwd=ROOT,text=True,capture_output=True,timeout=120)
            (run/'oracle.stdout.log').write_text(got.stdout);(run/'oracle.stderr.log').write_text(got.stderr)
            report['oracleCommand']={'argv':command,'exitCode':got.returncode}
            assert got.returncode==0,'Owned local catalogue preparation failed'
            summary=json.loads(got.stdout.strip().splitlines()[-1]);expected_path=ROOT/summary['catalogue']
            report['expectedCatalogue']={'path':str(expected_path.relative_to(ROOT)),'sha256':sha(expected_path)}
        pg.start();pg.stop()
        cert=pg.data/'server.crt';key=pg.data/'server.key'
        pg.command(['openssl','req','-x509','-newkey','rsa:2048','-sha256','-nodes','-days','2','-keyout',key,'-out',cert,
                    '-subj','/CN='+HOST,'-addext','subjectAltName=DNS:'+HOST],name='local-tls-certificate')
        key.chmod(0o600)
        with (pg.data/'postgresql.auto.conf').open('a') as f:f.write("\nssl=on\nssl_cert_file='server.crt'\nssl_key_file='server.key'\n")
        pg.start()
        admin=original_connect(pg.dsn,autocommit=True)
        admin.execute('CREATE DATABASE statarena_prod');admin.close()
        pg.dsn=pg.dsn.replace('dbname=postgres','dbname=statarena_prod')
        migration=pg.migration(ROOT)
        migration_report=json.loads(migration.stdout.strip().splitlines()[-1])
        admin=original_connect(pg.dsn,autocommit=True,options='-c search_path=pg_catalog')
        assert admin.info.server_version==180006
        model=approved_model(SPEC)
        for role in ('statarena_ingest','statarena_runtime'):
            admin.execute(f'CREATE ROLE {role} LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS')
        admin.execute(role_grants_sql(model,ingest_role='statarena_ingest',runtime_role='statarena_runtime'),prepare=False)
        for schema in ('statarena','statarena_app'):
            admin.execute(f'CREATE SCHEMA {schema}');admin.execute(f'CREATE TABLE {schema}.readback_source_presence(id integer)')
        journal=admin.execute('SELECT version,content_sha256,code_commit FROM ingest.schema_migrations ORDER BY version').fetchall()
        receipt={'kind':'explicitly_synthetic_owned_local_apply_receipt','mode':'apply','status':'applied',
                 'plan':{'modelSha256':sha(SPEC),'migrationSha256':{r[0]:r[1] for r in journal},'git':{'commit':journal[0][2]}},
                 'apply':{'scope':'schema_and_bootstrap_only','transaction':'atomic_committed','bootstrap':migration_report['bootstrap']}}
        receipt_path=run/'owned-local-apply-receipt.json';receipt_path.write_text(json.dumps(receipt,indent=2)+'\n')
        report['localTls']={'certificateSha256':sha(cert),'verifyFullHostname':HOST,'loopbackPort':pg.port}
        spec=importlib.util.spec_from_file_location('owned_local_readback',SCRIPT);reader=importlib.util.module_from_spec(spec);spec.loader.exec_module(reader)

        def local_connect(*argv,**kwargs):
            assert not argv and kwargs['host']==HOST and kwargs['port']==5432 and kwargs['dbname']=='statarena_prod'
            assert kwargs['user']=='statarena_ingest' and kwargs['sslmode']=='verify-full'
            kwargs.update(hostaddr='127.0.0.1',port=pg.port,sslrootcert=str(cert))
            actual=original_connect(**kwargs)
            class LocalConnection:
                def __getattr__(self,name):return getattr(actual,name)
                def execute(self,sql,params=(),**options):
                    try:return actual.execute(sql,params,**options)
                    except Exception as exc:
                        # Local synthetic metadata only; retain useful SQL error
                        # diagnostics without changing the production sanitizer.
                        with (run/'local-sql-errors.log').open('a') as f:f.write(str(exc)+'\n')
                        raise
            return LocalConnection()

        def read(name):
            from contextlib import redirect_stdout,redirect_stderr
            old_argv=sys.argv
            sys.argv=[str(SCRIPT),'--apply-receipt',str(receipt_path),'--apply-sha256',sha(receipt_path),'--label',args.label+'-'+name]
            if expected_path:sys.argv+=['--expected-catalogue',str(expected_path),'--expected-catalogue-sha256',sha(expected_path)]
            psycopg.connect=local_connect
            try:
                with (run/(name+'.stdout.log')).open('w') as out,(run/(name+'.stderr.log')).open('w') as err:
                    with redirect_stdout(out),redirect_stderr(err):code=reader.main()
                summary=json.loads((run/(name+'.stdout.log')).read_text().strip().splitlines()[-1]);path=ROOT/summary['receipt']
                return code,json.loads(path.read_text()),str(path.relative_to(ROOT))
            finally:psycopg.connect=original_connect;sys.argv=old_argv

        def check(name,target,expected_pass):
            code,data,path=read(name)
            cases={c['case']:c for c in data['cases']}
            observed=cases.get(target,{}).get('status')
            ok=(code==0 and data['status']=='pass' and len(cases)==11) if expected_pass else (code!=0 and observed=='fail' and 'error' not in data)
            report['cases'].append({'case':name,'status':'pass' if ok else 'fail','expected':'all11 pass' if expected_pass else target+' fails',
                                    'actual':{'exitCode':code,'readbackStatus':data['status'],'targetCase':observed,'error':data.get('error'),'queries':len(data['queries']),'receipt':path}})

        check('golden','receipt_model_sql_binding',True)
        admin.execute('GRANT UPDATE(numeric_value) ON football.player_match_metric_values TO statarena_runtime')
        check('column-update','runtime_readonly_effective_grants',False)
        admin.execute('REVOKE UPDATE(numeric_value) ON football.player_match_metric_values FROM statarena_runtime')
        check_name='football_player_match_metric_values_one_value_ck'
        check_def=admin.execute('SELECT pg_get_constraintdef(oid,true) FROM pg_constraint WHERE conrelid=%s::regclass AND conname=%s',('football.player_match_metric_values',check_name)).fetchone()[0]
        admin.execute(f'ALTER TABLE football.player_match_metric_values DROP CONSTRAINT {check_name}')
        admin.execute(f'ALTER TABLE football.player_match_metric_values ADD CONSTRAINT {check_name} CHECK(TRUE)')
        check('check-true','exact_primary_foreign_unique_checks',False)
        admin.execute(f'ALTER TABLE football.player_match_metric_values DROP CONSTRAINT {check_name}')
        admin.execute(f'ALTER TABLE football.player_match_metric_values ADD CONSTRAINT {check_name} {check_def}')
        index='ingest.ingest_source_documents_sv_http_request_content_idx'
        index_def=admin.execute('SELECT pg_get_indexdef(%s::regclass)',(index,)).fetchone()[0]
        admin.execute(f'DROP INDEX {index}')
        admin.execute('CREATE INDEX ingest_source_documents_sv_http_request_content_idx ON ingest.source_documents(dataset_id)')
        check('index-changed','declared_indexes_valid',False)
        admin.execute(f'DROP INDEX {index}');admin.execute(index_def)
        view_def=admin.execute("SELECT pg_get_viewdef('football.periods_current'::regclass,true)").fetchone()[0]
        admin.execute('DROP VIEW football.periods_current')
        check('view-missing','exact_tables_columns_types_nullability',False)
        admin.execute('CREATE VIEW football.periods_current AS '+view_def)
        # Restoring a dropped view requires restoring its intended reader grant.
        admin.execute('GRANT SELECT ON football.periods_current TO statarena_ingest,statarena_runtime')
        # FK/UQ property mutations are chosen from actual constraints and leave
        # names/columns/parents intact, the exact original reader blind spot.
        fk=admin.execute("SELECT n.nspname||'.'||c.relname,con.conname,pg_get_constraintdef(con.oid,true) FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ingest' AND con.contype='f' AND con.confdeltype IN ('a','r') ORDER BY 1,2 LIMIT 1").fetchone()
        assert fk,'Need an approved NO ACTION/RESTRICT FK for the regression'
        import re
        changed_fk=re.sub(r' ON DELETE (?:RESTRICT|NO ACTION)','',fk[2])+' ON DELETE CASCADE'
        admin.execute(f'ALTER TABLE {fk[0]} DROP CONSTRAINT "{fk[1]}"')
        admin.execute(f'ALTER TABLE {fk[0]} ADD CONSTRAINT "{fk[1]}" '+changed_fk)
        check('fk-action','exact_primary_foreign_unique_checks',False)
        admin.execute(f'ALTER TABLE {fk[0]} DROP CONSTRAINT "{fk[1]}"');admin.execute(f'ALTER TABLE {fk[0]} ADD CONSTRAINT "{fk[1]}" '+fk[2])
        uq=admin.execute("SELECT n.nspname||'.'||c.relname,con.conname,pg_get_constraintdef(con.oid,true) FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_index i ON i.indexrelid=con.conindid WHERE con.conrelid='ingest.media_assets'::regclass AND con.contype='u' AND i.indnullsnotdistinct ORDER BY 1,2 LIMIT 1").fetchone()
        assert uq and 'NULLS NOT DISTINCT' in uq[2]
        admin.execute(f'ALTER TABLE {uq[0]} DROP CONSTRAINT "{uq[1]}"')
        admin.execute(f'ALTER TABLE {uq[0]} ADD CONSTRAINT "{uq[1]}" '+uq[2].replace('NULLS NOT DISTINCT ',''))
        check('uq-null-semantics','exact_primary_foreign_unique_checks',False)
        admin.execute(f'ALTER TABLE {uq[0]} DROP CONSTRAINT "{uq[1]}"');admin.execute(f'ALTER TABLE {uq[0]} ADD CONSTRAINT "{uq[1]}" '+uq[2])
        check('restored-golden','receipt_model_sql_binding',True)
    except Exception as exc:
        report['error']={'type':type(exc).__name__,'reason':str(exc),'traceback':traceback.format_exc()}
    finally:
        psycopg.connect=original_connect
        if admin is not None:admin.close()
        report['cleanup']=pg.cleanup()
        report['finishedAt']=datetime.now(timezone.utc).isoformat()
        report['counts']={s:sum(c['status']==s for c in report['cases']) for s in ('pass','fail')}
        report['status']='pass' if len(report['cases'])==8 and report['counts']['fail']==0 and 'error' not in report else 'fail'
        (run/'result.json').write_text(json.dumps(report,indent=2,default=str)+'\n')
        print(json.dumps({'status':report['status'],'counts':report['counts'],'result':str((run/'result.json').relative_to(ROOT))}))
    return 0 if report['status']=='pass' else 1


if __name__=='__main__':
    raise SystemExit(main())
