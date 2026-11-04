"""Read-only inventories of both logical application databases; never exports bodies."""
import datetime
import json
from pathlib import Path
import subprocess
import sys
import psycopg
from psycopg import sql

ROOT = Path(__file__).resolve().parents[4]
OUT = Path(__file__).resolve().parents[1] / "evidence"
HOST = 'statarena-postgres.clcy2iqyajbl.us-east-2.rds.amazonaws.com'
def aws(*args):
    return json.loads(subprocess.check_output(['aws','--profile','statarena','--region','us-east-2',*args,'--output','json'],text=True))
secret = {'host':HOST,'database':'statarena_prod','username':'statarena_ingest'} if '--pgpass' in sys.argv else json.loads(aws('ssm','get-parameter','--name','/statarena/app/rds-ingest','--with-decryption')['Parameter']['Value'])
assert secret['host'] == HOST and secret['database'] == 'statarena_prod'
def connect(name):
    return psycopg.connect(host=HOST,dbname=name,user=secret['username'],password=secret.get('password'),sslmode='verify-full',sslrootcert=str(ROOT/'dashboard/backend/certs/rds-us-east-2.pem'),connect_timeout=7,autocommit=True,options='-c default_transaction_read_only=on -c statement_timeout=20000 -c lock_timeout=1000 -c max_parallel_workers_per_gather=0',application_name='statarena-architecture-audit')
report = {'atUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'command':'PYTHONPATH=/tmp/statarena-publication-test-python python3 docs/architecture/orion-plan-20261104/tools/audit_aws.py --pgpass','setup':'Existing RDS host, ingestion identity held only in memory, read-only repeatable snapshots, verified TLS,20s statement deadline. Only catalogs/counts/keys; no row bodies, secrets, schema or data writes.','databases':{},'errors':[]}
exact = {
    'statarena': ['fixtures','objects','resources','observations','shards','projections','jobs','assets','dirty_partitions','file_documents','file_document_sources'],
    'statarena_app': ['players','teams','matches','fixtures','competitions','competition_seasons','team_seasons','appearances','shots','team_statistics','match_resources','match_families','match_players','assets','catalog_editions','support_projection','publication_jobs','partition_bootstrap_sources','appearance_shirt_numbers'],
}
try:
    with connect('statarena_prod') as db:
        report['databaseCatalog'] = db.execute("SELECT datname,pg_get_userbyid(datdba),datallowconn FROM pg_database WHERE NOT datistemplate ORDER BY datname").fetchall()
    try:
        report['rds'] = aws('rds','describe-db-instances','--db-instance-identifier','statarena-postgres','--query','DBInstances[0].{Identifier:DBInstanceIdentifier,Host:Endpoint.Address,InitialDBName:DBName,Engine:Engine,Version:EngineVersion,Class:DBInstanceClass,AllocatedGiB:AllocatedStorage,Status:DBInstanceStatus,Pending:PendingModifiedValues}')
    except subprocess.CalledProcessError as error:
        report['rds']={'unverified':'AWS CLI session expired; SQL connection remains available','exitCode':error.returncode}

    for name in ('statarena','statarena_prod'):
        result = {'atUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'name':name,'counts':{},'errors':[]}
        report['databases'][name] = result
        try:
            with connect(name) as db:
                db.execute('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
                identity=db.execute("SELECT current_database(),current_user,current_setting('transaction_read_only'),(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid())").fetchone()
                assert identity[0] == name and identity[2:] == ('on',True)
                result['identity'] = identity
                result['serverVersion'] = db.execute("SELECT current_setting('server_version')").fetchone()[0]
                result['bytes'] = db.execute('SELECT pg_database_size(current_database())').fetchone()[0]
                result['schemas'] = db.execute("SELECT nspname,pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname<>'information_schema' ORDER BY nspname").fetchall()
                result['relations'] = [dict(zip(['schema','name','kind','owner','mainBytes','tableBytes','totalBytes','rowsEstimate','rowSecurity'],r)) for r in db.execute("""SELECT n.nspname,c.relname,c.relkind,pg_get_userbyid(c.relowner),
                    CASE WHEN c.relkind IN ('r','p','m') THEN pg_relation_size(c.oid) ELSE 0 END,
                    CASE WHEN c.relkind IN ('r','p','m') THEN pg_table_size(c.oid) ELSE 0 END,
                    CASE WHEN c.relkind IN ('r','p','m') THEN pg_total_relation_size(c.oid) ELSE 0 END,
                    s.n_live_tup,c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                    LEFT JOIN pg_stat_user_tables s ON s.relid=c.oid
                    WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','v','m') ORDER BY n.nspname,c.relname""")]
                result['columns'] = [dict(zip(['schema','table','column','type','nativeType','nullable','hasDefault'],r)) for r in db.execute("SELECT table_schema,table_name,column_name,data_type,udt_name,is_nullable,column_default IS NOT NULL FROM information_schema.columns WHERE table_schema NOT LIKE 'pg_%' AND table_schema<>'information_schema' ORDER BY table_schema,table_name,ordinal_position")]
                result['constraints'] = [dict(zip(['schema','table','name','kind','definition'],r)) for r in db.execute("SELECT n.nspname,c.relname,k.conname,k.contype,pg_get_constraintdef(k.oid) FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('statarena','statarena_app','public') ORDER BY n.nspname,c.relname,k.conname")]
                result['indexes'] = db.execute("SELECT schemaname,tablename,indexname,indexdef FROM pg_indexes WHERE schemaname IN ('statarena','statarena_app','public') ORDER BY schemaname,tablename,indexname").fetchall()
                available={(r['schema'],r['name']) for r in result['relations'] if r['kind'] in ('r','p','m')}
                targets=[(schema,table) for schema,tables in exact.items() for table in tables if (schema,table) in available]
                for schema,table in targets:
                    try:
                        with db.transaction():
                            result['counts'][schema+'.'+table] = db.execute(sql.SQL('SELECT count(*) FROM {}.{}').format(sql.Identifier(schema),sql.Identifier(table))).fetchone()[0]
                    except psycopg.Error as e:
                        result['errors'].append({'count':schema+'.'+table,'error':type(e).__name__,'code':e.sqlstate})
                result['semanticQueries'] = {}
                semantic = {
                    'resourceFamilies': "SELECT regexp_replace(regexp_replace(endpoint,'[a-z]_[A-Za-z0-9]{6}','{id}','g'),'/date/[0-9-]+','/date/{day}') family,count(*) FROM statarena.resources GROUP BY 1 ORDER BY 1",
                    'projectionFamilies': "SELECT name,count(*) FROM statarena.projections GROUP BY 1 ORDER BY 1",
                    'fixtureScopes': "SELECT count(DISTINCT league_id),count(*) FROM (SELECT DISTINCT league_id,season FROM statarena.fixtures) q",
                    'fixtureStatuses': "SELECT status,count(*) FROM statarena.fixtures GROUP BY status ORDER BY status",
                    'objectClasses': "SELECT CASE WHEN path ~ '\\.(webp|png|jpg|jpeg|svg|gif|avif)$' THEN 'images' WHEN path ~ '\\.json(l)?(\\.gz)?$' THEN 'structured-files' ELSE 'other' END kind,count(*),sum(size),count(body) FROM statarena.objects GROUP BY kind ORDER BY kind",
                    'objectPrefixes': "SELECT split_part(path,'/',1) prefix,count(*),sum(size) FROM statarena.objects GROUP BY prefix ORDER BY prefix",
                    'documentReadiness': "SELECT status,count(*) FROM statarena.file_document_sources GROUP BY status ORDER BY status",
                    'playerIdentityVersions': "SELECT count(*) rows,count(DISTINCT player_id) provider_ids FROM statarena_app.players",
                    'appearancePartitionMismatch': "SELECT count(*) FROM statarena_app.appearances a JOIN statarena_app.matches m ON m.id=a.match_id WHERE a.season IS DISTINCT FROM m.season OR a.league_id IS DISTINCT FROM m.league_id",
                    'fixtureMatchPartitionMismatch': "SELECT count(*) FROM statarena_app.fixtures f JOIN statarena_app.matches m ON m.id=f.id WHERE f.season IS DISTINCT FROM m.season OR f.league_id IS DISTINCT FROM m.league_id",
                    'workflowState': "SELECT workflow,status,remaining,started_at,completed_at,updated_at FROM statarena_app.workflow_state ORDER BY workflow",
                    'workerInputKinds': "SELECT kind,count(*) FROM statarena_app.worker_inputs GROUP BY kind ORDER BY kind",
                    'matchResourcesCoreCoverage': "SELECT count(*),count(m.id) FROM statarena_app.match_resources r LEFT JOIN statarena_app.matches m ON m.id=r.match_id",
                }
                for key,query in semantic.items():
                    try:
                        with db.transaction():
                            result['semanticQueries'][key]={'sql':query,'rows':db.execute(query).fetchall()}
                    except psycopg.Error as e:
                        result['semanticQueries'][key]={'sql':query,'error':type(e).__name__,'code':e.sqlstate}
                db.execute('ROLLBACK')
        except Exception as e:
            result['errors'].append({'error':type(e).__name__,'detail':str(e)[:300]})
        (OUT/'databases.json').write_text(json.dumps(report,indent=2,default=str)+'\n')
        print(json.dumps({'database':name,'bytes':result.get('bytes'),'tables':len(result.get('relations',[])),'counts':result['counts'],'errors':result['errors']}),flush=True)
finally:
    report['finishedUtc']=datetime.datetime.now(datetime.timezone.utc).isoformat()
    (OUT/'databases.json').write_text(json.dumps(report,indent=2,default=str)+'\n')
