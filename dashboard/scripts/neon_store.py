"""Shared ingestion store. No repository data directory or Git publication."""
import os,json,gzip,hashlib,base64
from functools import lru_cache
import boto3,psycopg
from botocore.config import Config
from psycopg.types.json import Jsonb

def canonical(params=None):return json.dumps(params or {},sort_keys=True,separators=(',',':'),ensure_ascii=False)
class Store:
 def __init__(self):
  self.db=psycopg.connect(os.environ['NEON_DATABASE_URL'],autocommit=True,application_name='statarena-ingestion',options='-c statement_timeout=120000')
  self.s3=boto3.client('s3',endpoint_url=os.environ['NEON_STORAGE_ENDPOINT'],region_name=os.environ.get('NEON_STORAGE_REGION','us-east-2'),aws_access_key_id=os.environ['NEON_STORAGE_ACCESS_KEY_ID'],aws_secret_access_key=os.environ['NEON_STORAGE_SECRET_ACCESS_KEY'],config=Config(signature_version='s3v4',s3={'addressing_style':'path'},request_checksum_calculation='when_required',response_checksum_validation='when_required',retries={'max_attempts':4}))
  self.bucket=os.environ.get('NEON_STORAGE_BUCKET','statarena-data');self.queue={}
 def bytes(self,path):
  row=self.db.execute('select body,sha256,size from statarena.objects where path=%s',(path,)).fetchone()
  if not row:raise FileNotFoundError(path)
  body=bytes(row[0]) if row[0] is not None else self.s3.get_object(Bucket=self.bucket,Key='data/'+path)['Body'].read()
  if hashlib.sha256(body).digest()!=bytes(row[1]) or len(body)!=row[2]:raise ValueError('Neon object checksum mismatch: '+path)
  return body
 def json(self,path):
  b=self.bytes(path);return json.loads(gzip.decompress(b) if path.endswith('.gz') else b)
 def put(self,path,body,content_type='application/json',hot=False):
  digest=hashlib.sha256(body).digest();etag=hashlib.md5(body).hexdigest()
  old=self.db.execute('select sha256 from statarena.objects where path=%s',(path,)).fetchone()
  if old and bytes(old[0])==digest:return False
  result=self.s3.put_object(Bucket=self.bucket,Key='data/'+path,Body=body,ContentMD5=base64.b64encode(bytes.fromhex(etag)).decode(),ContentType=content_type)
  if result['ETag'].strip('"')!=etag:raise ValueError('Neon server MD5 mismatch')
  self.db.execute('insert into statarena.objects(path,size,sha256,etag,body,content_type) values(%s,%s,%s,%s,%s,%s) on conflict(path) do update set size=excluded.size,sha256=excluded.sha256,etag=excluded.etag,body=excluded.body,content_type=excluded.content_type,updated_at=now()', (path,len(body),digest,etag,body if hot else None,content_type))
  return True
 def put_json(self,path,value,hot=False):
  body=canonical(value).encode();body=gzip.compress(body,mtime=0) if path.endswith('.gz') else body
  self.put(path,body,'application/gzip' if path.endswith('.gz') else 'application/json',hot)
  return {'path':path,'sha256':hashlib.sha256(body).hexdigest()}
 def enqueue(self,endpoint,params=None,priority=3,refresh=False):
  p=canonical(params);key=(endpoint,p)
  old=self.queue.get(key)
  self.queue[key]={'endpoint':endpoint,'params':p,'priority':min(priority,old['priority']) if old else priority,'refresh':refresh or bool(old and old['refresh'])}
 def flush(self):
  for refresh in [False,True]:
   rows=[{k:v for k,v in row.items() if k!='refresh'} for row in self.queue.values() if row['refresh']==refresh]
   if not rows:continue
   condition='' if refresh else 'WHERE NOT EXISTS(SELECT 1 FROM statarena.resources r WHERE r.endpoint=i.endpoint AND r.params=i.params)'
   self.db.execute("INSERT INTO statarena.jobs(endpoint,params,priority) SELECT i.endpoint,i.params,i.priority FROM jsonb_to_recordset(%s) AS i(endpoint text,params text,priority smallint) "+condition+" ON CONFLICT(endpoint,params) DO UPDATE SET priority=least(statarena.jobs.priority,excluded.priority),state=case when %s and statarena.jobs.state!='running' then 'pending' else statarena.jobs.state end,available_at=case when %s then now() else statarena.jobs.available_at end",(Jsonb(rows),refresh,refresh))
  self.queue.clear()
 def state(self,name,value):self.db.execute('insert into statarena.state(name,value) values(%s,%s) on conflict(name) do update set value=excluded.value,updated_at=now()',(name,Jsonb(value)))
 def revision(self):self.db.execute("update statarena.state set value=to_jsonb((value::text::bigint)+1),updated_at=now() where name='revision'")
