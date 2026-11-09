"""Shared-instance bootstrap; only a disposable local PostgreSQL cluster is allowed."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from urllib.parse import urlparse
import psycopg

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'v2'))
spec=importlib.util.spec_from_file_location('shared_bootstrap',ROOT/'infra/vega-v2/shared_bootstrap.py')
b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
class ConfigTests(unittest.TestCase):
 def test_fixed_shared_target_and_secret_handling(self):
  with tempfile.NamedTemporaryFile() as ca:
   env={'V2_DB_HOST':b.HOST,'V2_DB_TARGET_INSTANCE':'statarena-postgres','V2_DB_NAME':'vega_v2','AWS_REGION':'us-east-2','PGSSLROOTCERT':ca.name,
        'V2_MASTER_CREDENTIALS':json.dumps({'username':'statarena_admin','password':'synthetic-admin'}),
        'V2_INGEST_CREDENTIALS':json.dumps({'username':'vega_v2_ingest','password':'synthetic-ingest'}),
        'V2_READER_CREDENTIALS':json.dumps({'username':'vega_v2_reader','password':'synthetic-reader'})}
   _,passwords=b.read_config(env)
   self.assertEqual(set(passwords),{'statarena_admin','vega_v2_ingest','vega_v2_reader'})
   self.assertFalse(any(x.endswith('_CREDENTIALS') for x in env))
   for key,value in [('V2_DB_HOST','other.example.com'),('V2_DB_NAME','statarena_prod'),('V2_DB_TARGET_INSTANCE','other')]:
    bad=dict(env);bad[key]=value
    with self.assertRaisesRegex(b.SharedBootstrapError,'INVALID_TARGET'):b.read_config(bad)
 def test_unexpected_error_does_not_print_secrets(self):
  from io import StringIO
  with patch.object(b,'read_config',side_effect=RuntimeError('secret SHOULD_NOT_PRINT')),patch('sys.stderr',new_callable=StringIO) as output:
   self.assertEqual(b.main(),1);self.assertEqual(output.getvalue(),'V2_SHARED_BOOTSTRAP_FAILED\n')

DSN=os.environ.get('VEGA_V2_SHARED_TEST_DSN')
@unittest.skipUnless(DSN,'requires dedicated local shared-instance test cluster')
class SharedDatabaseTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  target=urlparse(DSN)
  if target.hostname not in ('127.0.0.1','localhost','::1') or target.port not in (55444,55445) or target.path!='/postgres' or target.username!='statarena_admin':raise RuntimeError('dedicated local test cluster only')
  cls.port=target.port;cls.admin=psycopg.connect(DSN,autocommit=True)
  if cls.admin.execute("SELECT 1 FROM pg_database WHERE datname='vega_v2'").fetchone():raise RuntimeError('test v2 DB must not exist')
 @classmethod
 def tearDownClass(cls):cls.admin.close()
 def test_new_database_only_collision_retry_and_old_data_unchanged(self):
  self.admin.execute('CREATE ROLE vega_v2_ingest NOLOGIN')
  try:
   with self.assertRaisesRegex(b.SharedBootstrapError,'V2_ROLE_NAME_COLLISION'):
    b.provision_shared(self.admin,lambda:None,{})
   self.assertIsNone(self.admin.execute("SELECT 1 FROM pg_database WHERE datname='vega_v2'").fetchone())
  finally:self.admin.execute('DROP ROLE vega_v2_ingest')
  kwargs={'host':'127.0.0.1','port':self.port,'user':'statarena_admin','autocommit':True}
  target=lambda:psycopg.connect(dbname='vega_v2',**kwargs)
  old=psycopg.connect(dbname='statarena_prod',**kwargs)
  try:
   before=old.execute('SELECT id,value FROM public.keep_old').fetchall()
   role_before=self.admin.execute("SELECT rolsuper,rolcreatedb,rolcreaterole,rolcanlogin FROM pg_roles WHERE rolname='statarena_admin'").fetchone()
   acl_before=self.admin.execute("SELECT datacl,pg_get_userbyid(datdba) FROM pg_database WHERE datname='statarena_prod'").fetchone()
   members_before=self.admin.execute("SELECT parent.rolname FROM pg_auth_members m JOIN pg_roles child ON child.oid=m.member JOIN pg_roles parent ON parent.oid=m.roleid WHERE child.rolname='statarena_admin' ORDER BY 1").fetchall()
   credentials={'vega_v2_ingest':'synthetic-ingest','vega_v2_reader':'synthetic-reader'}
   self.assertEqual(b.provision_shared(self.admin,target,credentials),{'database':'vega_v2','created':True})
   self.assertEqual(b.provision_shared(self.admin,target,credentials),{'database':'vega_v2','created':False})
   self.assertEqual(old.execute('SELECT id,value FROM public.keep_old').fetchall(),before)
   with psycopg.connect(host='127.0.0.1',port=self.port,dbname='vega_v2',user='vega_v2_ingest',autocommit=True) as ingest:
    ingest.execute("INSERT INTO core.seasons(id,label) VALUES(61,'synthetic')")
    ingest.execute('CREATE TABLE core.shots_s61 PARTITION OF core.shots FOR VALUES IN (61)')
   with psycopg.connect(host='127.0.0.1',port=self.port,dbname='vega_v2',user='vega_v2_reader',autocommit=True) as reader:
    self.assertEqual(reader.execute('SHOW default_transaction_read_only').fetchone()[0],'on')
    self.assertEqual(reader.execute('SELECT count(*) FROM core.shots_s61').fetchone()[0],0)
    reader.execute('SET default_transaction_read_only=off')
    with self.assertRaises(psycopg.errors.InsufficientPrivilege):reader.execute("INSERT INTO core.seasons(id,label) VALUES(62,'forbidden')")
    with self.assertRaises(psycopg.errors.InsufficientPrivilege):reader.execute('SELECT * FROM ops.fetch_jobs')
   with target() as db:
    self.assertEqual(db.execute("SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname='core'").fetchone()[0],'vega_v2_owner')
    self.assertTrue(db.execute("SELECT 1 FROM pg_extension WHERE extname='vector'").fetchone())
    db.execute('GRANT vega_v2_owner TO statarena_admin')
    try:
     with self.assertRaisesRegex(b.SharedBootstrapError,'UNMANAGED_V2_ROLE_MEMBERSHIP'):
      b.provision_shared(self.admin,target,credentials)
     self.assertTrue(db.execute("SELECT pg_has_role('statarena_admin','vega_v2_owner','MEMBER')").fetchone()[0])
    finally:db.execute('REVOKE vega_v2_owner FROM statarena_admin')
    before_password=db.execute("SELECT rolpassword FROM pg_authid WHERE rolname='vega_v2_ingest'").fetchone()[0]
    db.execute("UPDATE ops.schema_migrations SET checksum=decode(repeat('00',32),'hex') WHERE version='001_core.sql'")
    with self.assertRaisesRegex(b.SharedBootstrapError,'MIGRATION_MISMATCH'):
     b.provision_shared(self.admin,target,credentials)
    self.assertEqual(db.execute("SELECT rolpassword FROM pg_authid WHERE rolname='vega_v2_ingest'").fetchone()[0],before_password)
   self.assertEqual(old.execute('SELECT id,value FROM public.keep_old').fetchall(),before)
   self.assertEqual(self.admin.execute("SELECT rolsuper,rolcreatedb,rolcreaterole,rolcanlogin FROM pg_roles WHERE rolname='statarena_admin'").fetchone(),role_before)
   self.assertEqual(self.admin.execute("SELECT datacl,pg_get_userbyid(datdba) FROM pg_database WHERE datname='statarena_prod'").fetchone(),acl_before)
   self.assertEqual(self.admin.execute("SELECT parent.rolname FROM pg_auth_members m JOIN pg_roles child ON child.oid=m.member JOIN pg_roles parent ON parent.oid=m.roleid WHERE child.rolname='statarena_admin' ORDER BY 1").fetchall(),members_before)
  finally:old.close()
if __name__=='__main__':unittest.main()
