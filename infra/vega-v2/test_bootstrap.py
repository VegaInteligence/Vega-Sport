"""Bootstrap safety and grants; PostgreSQL integration requires a throwaway cluster."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from urllib.parse import urlparse
from unittest.mock import patch
import psycopg

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'v2'))
spec=importlib.util.spec_from_file_location('vega_v2_bootstrap',ROOT/'infra/vega-v2/bootstrap.py')
b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)

class ConfigTest(unittest.TestCase):
    def test_strict_target_and_credentials_are_removed_from_env(self):
        with tempfile.NamedTemporaryFile() as ca:
            env={'V2_DB_HOST':'vega-v2-postgres.abc123.us-east-2.rds.amazonaws.com','V2_DB_TARGET_INSTANCE':'vega-v2-postgres','V2_DB_NAME':'vega_v2','AWS_REGION':'us-east-2','PGSSLROOTCERT':ca.name,
                 'V2_MASTER_CREDENTIALS':json.dumps({'username':'vega_v2_admin','password':'synthetic-admin'}),
                 'V2_INGEST_CREDENTIALS':json.dumps({'username':'vega_v2_ingest','password':'synthetic-ingest'}),
                 'V2_READER_CREDENTIALS':json.dumps({'username':'vega_v2_reader','password':'synthetic-reader'})}
            host,path,passwords=b.read_config(env)
            self.assertEqual(host,'vega-v2-postgres.abc123.us-east-2.rds.amazonaws.com')
            self.assertEqual(path,ca.name);self.assertEqual(set(passwords),{'vega_v2_admin','vega_v2_ingest','vega_v2_reader'})
            self.assertFalse(any(key.endswith('_CREDENTIALS') for key in env))
            env['V2_DB_HOST']='old-production.abc123.us-east-2.rds.amazonaws.com'
            with self.assertRaisesRegex(b.BootstrapError,'INVALID_TARGET'):b.read_config(env)
    def test_cli_connects_only_with_verified_tls(self):
        from io import StringIO
        passwords={'vega_v2_admin':'synthetic-admin','vega_v2_ingest':'synthetic-ingest','vega_v2_reader':'synthetic-reader'}
        class ConnectionContext:
            def __enter__(self): return object()
            def __exit__(self,*_): return False
        with patch.object(b,'read_config',return_value=('vega-v2-postgres.abc123.us-east-2.rds.amazonaws.com','/trusted-ca',passwords)), patch.object(b.psycopg,'connect',return_value=ConnectionContext()) as connect, patch.object(b,'provision') as provision, patch('sys.stdout',new_callable=StringIO) as out:
            self.assertEqual(b.main(),0)
            kwargs=connect.call_args.kwargs
            self.assertEqual((kwargs['host'],kwargs['dbname'],kwargs['user']),('vega-v2-postgres.abc123.us-east-2.rds.amazonaws.com','vega_v2','vega_v2_admin'))
            self.assertEqual((kwargs['sslmode'],kwargs['sslrootcert']),('verify-full','/trusted-ca'))
            provision.assert_called_once()
            self.assertEqual(out.getvalue(),'V2_BOOTSTRAP_OK\n')
            self.assertEqual(passwords,{})
    def test_cli_suppresses_database_exception_and_credentials(self):
        with patch.object(b,'read_config',side_effect=RuntimeError('secret SHOULD_NOT_PRINT')):
            from io import StringIO
            with patch('sys.stderr',new_callable=StringIO) as out:
                self.assertEqual(b.main(),1)
                self.assertEqual(out.getvalue(),'V2_BOOTSTRAP_FAILED\n')

DSN=os.environ.get('VEGA_V2_BOOTSTRAP_TEST_DSN')
@unittest.skipUnless(DSN,'requires dedicated throwaway local bootstrap cluster')
class PostgreSQLBootstrapTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        target=urlparse(DSN)
        if target.hostname not in ('127.0.0.1','localhost','::1') or target.port!=55442 or target.path!='/vega_v2' or target.username!='vega_v2_admin':
            raise RuntimeError('dedicated local bootstrap target required')
        cls.db=psycopg.connect(DSN,autocommit=True)
        if cls.db.execute("SELECT to_regnamespace('core') IS NOT NULL OR to_regnamespace('agg') IS NOT NULL OR to_regnamespace('ops') IS NOT NULL").fetchone()[0]:
            raise RuntimeError('test database must be empty')
        cls.passwords={'vega_v2_ingest':'synthetic-ingest','vega_v2_reader':'synthetic-reader'}
        b.provision(cls.db,cls.passwords)
    @classmethod
    def tearDownClass(cls): cls.db.close()
    def test_migration_owner_extensions_and_roles(self):
        self.assertEqual(set(self.db.execute("SELECT extname FROM pg_extension WHERE extname IN ('vector','pg_trgm')").fetchall()),{('vector',),('pg_trgm',)})
        self.assertEqual(self.db.execute("SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname='core'").fetchone()[0],'vega_v2_owner')
        self.assertEqual(self.db.execute("SELECT rolcanlogin FROM pg_roles WHERE rolname='vega_v2_owner'").fetchone()[0],False)
        self.assertEqual(self.db.execute("SELECT count(*) FROM ops.schema_migrations").fetchone()[0],len(list((ROOT/'v2/sql').glob('*.sql'))))
        statements=[]
        class AuditConnection:
            def __getattr__(_, name): return getattr(self.db,name)
            def execute(_, statement, *args):
                text = statement.as_string(self.db) if isinstance(statement,psycopg.sql.Composable) else statement
                statements.append(text)
                return self.db.execute(statement,*args)
        self.db.execute('GRANT INSERT ON core.seasons TO vega_v2_reader')
        self.db.execute('GRANT SELECT ON ops.fetch_jobs TO vega_v2_reader')
        b.provision(AuditConnection(),{'vega_v2_ingest':'synthetic-changed','vega_v2_reader':'synthetic-reader'})
        self.assertFalse(self.db.execute("SELECT has_table_privilege('vega_v2_reader','core.seasons','INSERT')").fetchone()[0])
        self.assertFalse(self.db.execute("SELECT has_table_privilege('vega_v2_reader','ops.fetch_jobs','SELECT')").fetchone()[0])
        self.assertFalse(any('synthetic-changed' in text or 'synthetic-reader' in text for text in statements))
        self.assertTrue(any('SCRAM-SHA-256$' in text for text in statements))
    def test_unsafe_existing_role_aborts_the_whole_transaction(self):
        before=self.db.execute("SELECT rolpassword FROM pg_authid WHERE rolname='vega_v2_ingest'").fetchone()[0]
        self.db.execute('ALTER ROLE vega_v2_reader SUPERUSER')
        try:
            with self.assertRaisesRegex(b.BootstrapError,'UNSAFE_EXISTING_ROLE'):
                b.provision(self.db,{'vega_v2_ingest':'synthetic-rotated','vega_v2_reader':'synthetic-reader'})
            after=self.db.execute("SELECT rolpassword FROM pg_authid WHERE rolname='vega_v2_ingest'").fetchone()[0]
            self.assertEqual(before,after)
        finally:
            self.db.execute('ALTER ROLE vega_v2_reader NOSUPERUSER')
    def test_reader_owner_membership_is_rejected(self):
        self.db.execute('GRANT vega_v2_owner TO vega_v2_reader')
        try:
            with self.assertRaisesRegex(b.BootstrapError,'UNSAFE_EXISTING_MEMBERSHIP'):
                b.provision(self.db,self.passwords)
        finally:
            self.db.execute('REVOKE vega_v2_owner FROM vega_v2_reader')
    def test_future_partitions_readable_and_reader_cannot_write_or_access_ops(self):
        ingest=psycopg.connect('postgresql://vega_v2_ingest@127.0.0.1:55442/vega_v2',autocommit=True)
        reader=psycopg.connect('postgresql://vega_v2_reader@127.0.0.1:55442/vega_v2',autocommit=True)
        try:
            ingest.execute("INSERT INTO core.seasons(id,label) VALUES(42,'fixture')")
            ingest.execute('CREATE TABLE core.shots_s42 PARTITION OF core.shots FOR VALUES IN (42)')
            ingest.execute('CREATE TABLE core.future_ingest_test(id integer)')
            ingest.execute('SET ROLE vega_v2_owner'); ingest.execute('CREATE TABLE core.future_owner_test(id integer)'); ingest.execute('RESET ROLE')
            self.assertEqual(reader.execute('SELECT count(*) FROM core.shots_s42').fetchone()[0],0)
            self.assertEqual(reader.execute('SELECT count(*) FROM core.future_ingest_test').fetchone()[0],0)
            self.assertEqual(reader.execute('SELECT count(*) FROM core.future_owner_test').fetchone()[0],0)
            reader.execute('SELECT * FROM ops.resource_versions')
            self.assertEqual(reader.execute('SHOW default_transaction_read_only').fetchone()[0],'on')
            reader.execute('SET default_transaction_read_only=off')
            with self.assertRaises(psycopg.errors.InsufficientPrivilege):reader.execute("INSERT INTO core.seasons(id,label) VALUES(43,'forbidden')")
            with self.assertRaises(psycopg.errors.InsufficientPrivilege):reader.execute('SELECT * FROM ops.fetch_jobs')
        finally: ingest.close();reader.close()
if __name__=='__main__':unittest.main()
