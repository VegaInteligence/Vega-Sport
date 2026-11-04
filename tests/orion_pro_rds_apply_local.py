#!/usr/bin/env python3
"""Before-code real-PG apply E2E with fake SSM and owned-loopback TLS only."""
from __future__ import annotations

import argparse
from contextlib import redirect_stdout,redirect_stderr
from datetime import datetime,timezone
import hashlib
import importlib.util
import json
from pathlib import Path
import secrets
import shutil
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[1]
BASE=ROOT/'docs/verification/orion-pro-pilot-20261104'
EXPECTED=BASE/'expected-catalogues/20261104T190938014223Z-catalogue-guards-green-oracle/expected-catalogue.json'
EXPECTED_SHA='b6adf85ed582866c435b6e64f01c59cc271488a2df1ba21958131961f8546610'


def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    p=argparse.ArgumentParser()
    p.add_argument('--label',default='historical-admin')
    p.add_argument('--pg-bin',type=Path,default=Path('/tmp/statarena-cache-test-tools/node_modules/@embedded-postgres/darwin-arm64/native/bin'))
    p.add_argument('--expected-catalogue',type=Path,default=EXPECTED)
    p.add_argument('--expected-catalogue-sha256',default=EXPECTED_SHA)
    args=p.parse_args()
    if not args.label.replace('-','').isalnum():p.error('Use a simple label')
    sys.path[:0]=[str(BASE),str(ROOT/'dashboard/scripts')]
    import psycopg
    import orion_pro_rds as wrapper
    from harness import LocalPostgres
    from orion_pro_schema import SPEC,approved_model
    from rds_catalogue import load_expected
    stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    run=BASE/'rds-apply-local-runs'/(stamp+'-'+args.label);inputs=run/'inputs';inputs.mkdir(parents=True)
    source_paths=[Path(__file__),Path(wrapper.__file__),BASE/'RDS_PROTOCOL.md',BASE/'harness.py',BASE/'approval.json',BASE/'model-amendments.json',
                  SPEC,BASE/'rds_readback.py',BASE/'rds_catalogue.py',args.expected_catalogue]
    source_paths += [ROOT/'dashboard/scripts'/n for n in ('orion_pro_schema.py','orion_pro_integrity.py','orion_pro_migrate.py')]
    source_paths += list(wrapper.SQL_PATHS.values())
    report={'kind':'owned_pg18_wrapper_apply_e2e','startedAt':datetime.now(timezone.utc).isoformat(),
            'command':['python3','tests/orion_pro_rds_apply_local.py',*sys.argv[1:]],
            'setup':'Owned PG18.6 statarena_prod; actual local TLS; fake SSM entirely in memory; fixed wrapper targets mapped only to owned loopback',
            'expected':'RDS_PROTOCOL.md admin-parameter failure matrix','sourceSha256':{},'cases':[],
            'realAwsCalls':[],'realRemoteWrites':[],'rawSourceCopies':[],'keyFilesCopiedToEvidence':[],
            'limits':['Functional apply path and readback only; no real account/instance/SSM or network acceptance']}
    for source in source_paths:
        shutil.copy2(source,inputs/source.name);report['sourceSha256'][str(source.relative_to(ROOT))]=sha(source)
    pg=LocalPostgres(args.pg_bin,run);observer=None
    original_connect=psycopg.connect;original_aws=wrapper.aws
    state={'allowConnect':False,'attempts':0,'connections':0,'ssmCalls':0,'ddlCalls':0}
    fake_password=secrets.token_urlsafe(40)
    try:
        load_expected(args.expected_catalogue,args.expected_catalogue_sha256)
        pg.start();pg.stop()
        cert=pg.data/'server.crt';key=pg.data/'server.key'
        pg.command(['openssl','req','-x509','-newkey','rsa:2048','-sha256','-nodes','-days','2','-keyout',key,'-out',cert,
                    '-subj','/CN='+wrapper.HOST,'-addext','subjectAltName=DNS:'+wrapper.HOST],name='owned-local-tls')
        key.chmod(0o600)
        with (pg.data/'postgresql.auto.conf').open('a') as f:f.write("\nssl=on\nssl_cert_file='server.crt'\nssl_key_file='server.key'\n")
        pg.start();observer=original_connect(pg.dsn,autocommit=True)
        for role in ('statarena_admin','statarena_ingest','statarena_runtime'):
            observer.execute(f'CREATE ROLE {role} LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS')
        observer.execute('CREATE DATABASE statarena_prod OWNER statarena_admin');observer.close()
        pg.dsn=pg.dsn.replace('dbname=postgres','dbname=statarena_prod')
        observer=original_connect(pg.dsn,autocommit=True)
        assert observer.info.server_version==180006
        for schema in ('statarena','statarena_app'):
            observer.execute(f'CREATE SCHEMA {schema}');observer.execute(f'CREATE TABLE {schema}.source_presence(id integer)')
        report['tls']={'certificateSha256':sha(cert),'loopbackPort':pg.port,'hostname':wrapper.HOST}
        model=approved_model(SPEC)
        artifacts=[(v,path,path.read_text()) for v,path in wrapper.SQL_PATHS.items()]
        grants=wrapper.role_grants_sql(model,ingest_role=wrapper.WRITER,runtime_role=wrapper.READER)
        commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
        reader_spec=importlib.util.spec_from_file_location('owned_apply_readback',BASE/'rds_readback.py')
        reader=importlib.util.module_from_spec(reader_spec);reader_spec.loader.exec_module(reader)

        def local_connect(*argv,**kwargs):
            if kwargs.get('application_name')=='orion-pro-rds-schema-bootstrap':
                state['attempts']+=1
                assert state['allowConnect'],'Unexpected connection attempt for a rejected parameter shape'
                assert kwargs['user']=='statarena_admin'
                assert kwargs.get('password')==fake_password
                state['connections']+=1
            assert not argv and kwargs['host']==wrapper.HOST and kwargs['port']==5432 and kwargs['dbname']==wrapper.DATABASE
            assert kwargs['sslmode']=='verify-full' and kwargs['user'] in ('statarena_admin','statarena_ingest')
            kwargs.update(hostaddr='127.0.0.1',port=pg.port,sslrootcert=str(cert))
            actual=original_connect(**kwargs)
            class LocalConnection:
                def __getattr__(self,name):return getattr(actual,name)
                def __enter__(self):actual.__enter__();return self
                def __exit__(self,*info):return actual.__exit__(*info)
                def execute(self,sql,params=None,**options):
                    if sql.lstrip().upper().startswith(('CREATE ','ALTER ','DROP ','GRANT ','REVOKE ','INSERT ','UPDATE ','DELETE ')) or sql.startswith('-- Approved Pro'):
                        state['ddlCalls']+=1
                    return actual.execute(sql,params,**options)
            return LocalConnection()

        def shape(payload,kind):
            return {'parameterType':kind,'jsonType':type(payload).__name__,
                    'keys':sorted(payload) if isinstance(payload,dict) else [],
                    'fieldTypes':{k:type(v).__name__ for k,v in payload.items()} if isinstance(payload,dict) else {}}

        def apply_case(name,payload,*,reject=False,kind='SecureString'):
            state['allowConnect']=not reject
            before=dict(state)
            entry={'case':name,'expected':'reject before connection/DDL' if reject else 'atomic schema/bootstrap on fixed target',
                   'parameterShape':shape(payload,kind)}
            local={'kind':'owned_local_wrapper_apply_receipt','executionEnvironment':'owned_loopback_only','mode':'apply','status':'failed',
                   'plan':{'modelSha256':sha(SPEC),'migrationSha256':{v:sha(path) for v,path in wrapper.SQL_PATHS.items()},
                           'grantsSha256':hashlib.sha256(grants.encode()).hexdigest(),'git':{'commit':commit},
                           'sourceSha256':{wrapper.relative(path):sha(path) for path in wrapper.EXECUTION_PATHS}},'remoteWrites':[]}
            def fake_aws(*operation):
                assert operation==('ssm','get-parameter','--name','/statarena/app/rds-admin','--with-decryption')
                state['ssmCalls']+=1
                return {'Parameter':{'Type':kind,'Value':json.dumps(payload)}}
            wrapper.aws=fake_aws;psycopg.connect=local_connect
            error=None
            try:
                wrapper.apply_schema_bootstrap(local,model,artifacts,grants)
                local['status']='applied'
            except Exception as exc:
                error={'type':type(exc).__name__,'sqlstate':getattr(exc,'sqlstate',None)}
                if isinstance(exc,wrapper.GateError):error['reason']=str(exc)
                local['error']=error
            finally:wrapper.aws=original_aws;psycopg.connect=original_connect
            delta={k:state[k]-before[k] for k in ('attempts','connections','ssmCalls','ddlCalls')}
            ok=(error is not None and delta['attempts']==0 and delta['connections']==0 and delta['ddlCalls']==0 and 'remoteWriteAttempt' not in local) if reject else (error is None and local.get('apply',{}).get('transaction')=='atomic_committed')
            entry.update(status='pass' if ok else 'fail',actual={'error':error,'operationCounts':delta,
                         'appliedVersions':local.get('apply',{}).get('applied'),'bootstrapReused':local.get('apply',{}).get('bootstrap',{}).get('reused')})
            path=run/(name+'-apply.json');path.write_text(json.dumps(local,indent=2)+'\n')
            entry['receipt']=str(path.relative_to(ROOT));report['cases'].append(entry)
            return path,ok,local

        base={'database':'statarena','username':'statarena_admin','password':fake_password,'security_group':'owned-local-metadata'}
        modern={**base,'database':'statarena_prod','host':wrapper.HOST}
        invalid=[('not-secure',modern,'String'),('not-object',[], 'SecureString'),
                 ('unknown-database',{**modern,'database':'unknown_database'},'SecureString'),
                 ('missing-database',{k:v for k,v in modern.items() if k!='database'},'SecureString'),
                 ('other-username',{**modern,'username':'other_admin'},'SecureString'),
                 ('missing-username',{k:v for k,v in modern.items() if k!='username'},'SecureString'),
                 ('conflicting-host',{**modern,'host':'contradictory.invalid'},'SecureString'),
                 ('null-host',{**modern,'host':None},'SecureString'),
                 ('empty-password',{**modern,'password':''},'SecureString'),
                 ('nonstr-password',{**modern,'password':123},'SecureString'),
                 ('unknown-key',{**modern,'port':6432},'SecureString')]
        for name,payload,kind in invalid:apply_case(name,payload,reject=True,kind=kind)
        first_path,first_ok,first=apply_case('historical-absent-host',base)

        def readback(name,path,ready):
            if not ready:
                report['cases'].append({'case':name,'status':'unverified','reason':'Its local apply failed'});return
            old_argv=sys.argv;sys.argv=[str(BASE/'rds_readback.py'),'--apply-receipt',str(path),'--apply-sha256',sha(path),
                '--expected-catalogue',str(args.expected_catalogue),'--expected-catalogue-sha256',args.expected_catalogue_sha256,'--label',args.label+'-'+name]
            psycopg.connect=local_connect
            try:
                with (run/(name+'.stdout.log')).open('w') as out,(run/(name+'.stderr.log')).open('w') as err:
                    with redirect_stdout(out),redirect_stderr(err):code=reader.main()
                summary=json.loads((run/(name+'.stdout.log')).read_text().strip().splitlines()[-1]);data=json.loads((ROOT/summary['receipt']).read_text())
                ok=code==0 and data['status']=='pass' and len(data['cases'])==11 and len(data['queries'])==14
                report['cases'].append({'case':name,'status':'pass' if ok else 'fail','expected':'11 cases pass / 14 SELECTs',
                     'actual':{'status':data['status'],'queries':len(data['queries']),'error':data.get('error'),'failedCases':[c['case'] for c in data['cases'] if c['status']!='pass'],'receipt':summary['receipt']}})
            finally:psycopg.connect=original_connect;sys.argv=old_argv

        readback('first-readback',first_path,first_ok)
        # Current-form control also exercises initial DDL on the old wrapper if
        # historical metadata is rejected, making the retained RED diagnostic.
        current_path,current_ok,current=apply_case('target-exact-host',modern)
        readback('current-readback',current_path,current_ok)
        for name,payload in [('target-exact-reapply',modern),('historical-exact-host',{**base,'host':wrapper.HOST}),('target-absent-host',{**base,'database':'statarena_prod'}),('historical-reapply',base)]:
            path,ok,data=apply_case(name,payload)
            if ok:
                report['cases'][-1]['status']='pass' if data['apply']['applied']==[] and data['apply']['bootstrap']['reused'] is True else 'fail'
                report['cases'][-1]['expected']='idempotent: no migrations / same bootstrap'
            if name=='historical-reapply':readback('idempotent-readback',path,ok)
        report['localFinalCatalogue']=observer.execute("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('ingest','football','analytics') AND c.relkind='r'").fetchone()[0]
    except Exception as exc:
        report['error']={'type':type(exc).__name__,'sqlstate':getattr(exc,'sqlstate',None)}
    finally:
        wrapper.aws=original_aws;psycopg.connect=original_connect
        if observer is not None:observer.close()
        report['cleanup']=pg.cleanup();report['finishedAt']=datetime.now(timezone.utc).isoformat()
        report['counts']={s:sum(c['status']==s for c in report['cases']) for s in ('pass','fail','unverified')}
        report['status']='pass' if len(report['cases'])==20 and report['counts']['fail']==report['counts']['unverified']==0 and 'error' not in report else 'fail'
        report['expectedCaseCount']=20
        (run/'result.json').write_text(json.dumps(report,indent=2)+'\n')
        print(json.dumps({'status':report['status'],'counts':report['counts'],'result':str((run/'result.json').relative_to(ROOT))}))
    return 0 if report['status']=='pass' else 1


if __name__=='__main__':raise SystemExit(main())
