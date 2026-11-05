#!/usr/bin/env python3
"""Pre-code owned PG18.6 -> actual Node24 AWS HTTP operations E2E."""
from __future__ import annotations
import argparse
from datetime import datetime,timezone
import hashlib,json,os,re,select,shutil,subprocess,sys,time
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request,HTTPRedirectHandler,ProxyHandler,build_opener
ROOT=Path(__file__).resolve().parents[1]
BASE=ROOT/'docs/verification/orion-pro-operations-20261105'
MODEL=ROOT/'docs/architecture/orion-plan-20261104/target-schema.proposed.json'
CASES=['O01_runtime','O02_pending','O03_status','O04_bad_input','O05_health_ready','O06_conditional','O07_settings','O08_settings_pages','O09_settings_head','O10_media','O11_media_correction','O12_media_invalid','O13_media_origin','O14_readonly_boundary']
class NoRedirect(HTTPRedirectHandler):
 def redirect_request(self,*a,**k):return None

def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--label',default='operations');parser.add_argument('--node',type=Path,default=Path(shutil.which('node')));parser.add_argument('--pg-bin',type=Path,default=Path('/tmp/statarena-cache-test-tools/node_modules/@embedded-postgres/darwin-arm64/native/bin'));args=parser.parse_args()
 assert re.fullmatch('[A-Za-z0-9][A-Za-z0-9-]{0,70}',args.label)
 sys.path[:0]=[str(ROOT/'dashboard/scripts'),str(ROOT/'docs/verification/orion-pro-pilot-20261104'),str(ROOT/'docs/verification/orion-pro-readers-20261104')]
 import psycopg
 from harness import LocalPostgres
 from fixture import ReaderFixture
 from orion_pro_migrate import bootstrap
 from orion_pro_integrity import role_grants_sql
 from orion_e2e_process import run_bounded
 started=time.monotonic();deadline=started+180
 run=BASE/'runs'/(datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')+'-'+args.label);(run/'inputs').mkdir(parents=True)
 sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
 paths=[Path(__file__),BASE/'PROTOCOL.md',BASE/'http_server.mjs',MODEL,ROOT/'dashboard/backend/aws-app.js',ROOT/'dashboard/backend/services/orion-pro-operations.js',ROOT/'docs/verification/orion-pro-readers-20261104/fixture.py',ROOT/'docs/verification/orion-pro-pilot-20261104/harness.py',ROOT/'docs/verification/orion-pro-pilot-20261104/fixtures.py',ROOT/'tests/orion_e2e_process.py']
 paths += list((ROOT/'dashboard/backend/services').glob('*.js'))
 paths += [ROOT/'dashboard/scripts'/n for n in ['orion_pro_migrate.py','orion_pro_integrity.py','orion_pro_schema.py']]
 paths += [ROOT/'dashboard/backend/migrations'/n for n in ['012_orion_pro_domain.sql','013_orion_pro_integrity.sql','014_orion_pro_membership_nonnull.sql']]
 report={'kind':'typed_operations_actual_node24_http_e2e','command':[sys.executable,*sys.argv],'expected':'PROTOCOL.md pre-code failure matrix','setup':'Owned PG18.6 approved012/013/014 only; ordinary runtime, actual aws-app on Node24; no legacy schemas','sourceSha256':{},'missingSources':[],'cases':[],'requests':[],'cloudCalls':0,'sourceCalls':0,'bounds':{'seconds':180,'typedRows':5000,'HTTP':150,'evidenceBytes':96*1024**2},'suggestedCommit':'feat: serve Pro health settings and media from typed SQL'}
 for p in dict.fromkeys(paths):
  if not p.exists():report['missingSources'].append(str(p.relative_to(ROOT)));continue
  d=run/'inputs'/p.relative_to(ROOT);d.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,d);report['sourceSha256'][str(p.relative_to(ROOT))]=sha(p)
 class PG(LocalPostgres):
  def command(self,argv,*,env=None,check=True,name='command'):
   t=time.monotonic();r=run_bounded([str(a) for a in argv],cwd=ROOT,env=env,deadline=(t+30 if name=='postgres-stop' else min(deadline,t+30)),term_seconds=2,drain_seconds=1,output_limit=2*1024**2)
   index=len(self.commands)+1;entry={'argv':[str(a) for a in argv],'exitCode':r.returncode,'elapsedMs':round((time.monotonic()-t)*1000,3)};self.commands.append(entry)
   (run/f'{index:03}-{name}.stdout.log').write_text(r.stdout);(run/f'{index:03}-{name}.stderr.log').write_text(r.stderr)
   if check and r.returncode:raise RuntimeError(name+' failed: '+r.stderr[-1000:])
   return r
 pg=PG(args.pg_bin,run);db=None;server=None;streams=[];origin=None;values={};blocked=None;opener=build_opener(ProxyHandler({}),NoRedirect())
 def raw(path,method='GET',headers=None):
  assert origin and path.startswith('/')
  try:r=opener.open(Request(origin+path,method=method,headers=headers or {}),timeout=min(10,max(.1,deadline-time.monotonic())))
  except HTTPError as e:r=e
  return r.status,{k.lower():v for k,v in r.headers.items()},r.read().decode()
 def http(path,method='GET',headers=None):
  assert len(report['requests'])<150 and time.monotonic()<deadline
  rid=str(len(report['requests'])+1);t=time.monotonic();status,h,body=raw(path,method,{'x-e2e-id':rid,**(headers or {})});trace=json.loads(raw('/__e2e__/traces')[2]);entry=next(x for x in trace['traces'] if x['id']==rid)
  assert trace['externalAttempts']==0
  r={'id':rid,'path':path,'method':method,'status':status,'headers':h,'body':body,'elapsedMs':round((time.monotonic()-t)*1000,3),'sql':entry['sql']};report['requests'].append(r)
  for q in r['sql']:assert not re.search(r'\bstatarena(?:_app)?\.|_current\b',q['sql'],re.I),q
  return {**r,'value':json.loads(body) if body else None}
 def fail(r,status,sql=None):
  assert r['status']==status,r
  assert all(r['headers'].get(k)=='no-store' for k in ['cache-control','cdn-cache-control','vercel-cdn-cache-control']),r
  if sql is not None:assert len(r['sql'])==sql,r
 def asset(url,**kw):return http('/api/assets?'+urlencode({'url':url}),**kw)
 def add_asset(url,key=None,mime='image/png',content='a'*64,source=None):
  return db.execute('INSERT INTO ingest.media_assets(storage_bucket,storage_key,content_sha256,source_url,content_type,retrieved_at,legacy_asset_url) VALUES(%s,%s,%s,%s,%s,CURRENT_TIMESTAMP,%s) RETURNING id',('owned-fixture',key or 'raw/neon/assets/'+content+'.png',content,source,mime,url)).fetchone()[0]
 try:
  pg.start();db=psycopg.connect(pg.dsn,autocommit=True);db.execute("SET statement_timeout='8s';SET lock_timeout='1s'")
  assert db.info.server_version==180006;model=json.loads(MODEL.read_text());assert sha(MODEL)=='18da43f940870b7a3a3cb49323c847dd5e5174e5eea1f8ff0c8a159cf373cb08'
  artifacts=[(v,ROOT/'dashboard/backend/migrations'/n,(ROOT/'dashboard/backend/migrations'/n).read_text()) for v,n in [('012','012_orion_pro_domain.sql'),('013','013_orion_pro_integrity.sql'),('014','014_orion_pro_membership_nonnull.sql')]]
  with db.transaction():
   for version,p,sql in artifacts:db.execute(sql,prepare=False);db.execute('INSERT INTO ingest.schema_migrations VALUES(%s,%s,CURRENT_TIMESTAMP,%s)',(version,sha(p),'owned-operations-e2e'))
   report['bootstrap']=bootstrap(db,model,artifacts)
   for role in ['statarena_ingest','statarena_runtime']:db.execute('CREATE ROLE '+role+' LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS')
   db.execute(role_grants_sql(model,ingest_role='statarena_ingest',runtime_role='statarena_runtime'),prepare=False)
  env={'PATH':os.defpath,'DATABASE_URL':f'postgresql://statarena_runtime@127.0.0.1:{pg.port}/postgres?sslmode=disable','STATARENA_DATA_PROVIDER':'aws','STATARENA_TEST_DATABASE':'1','STATARENA_PRO_API':'1','STATARENA_CLOUDFRONT_URL':'https://media.fixture.invalid','STATARENA_METRICS_SAMPLE_RATE':'1'}
  report['environmentKeys']=sorted(env);report['nodeBinarySha256']=sha(args.node)
  err=(run/'http.stderr.log').open('w');out=(run/'http.stdout.log').open('w');streams=[err,out]
  server=subprocess.Popen([str(args.node),str(BASE/'http_server.mjs')],cwd=ROOT,env=env,stdout=subprocess.PIPE,stderr=err,text=True,bufsize=1)
  ready_deadline=min(deadline,time.monotonic()+12)
  while time.monotonic()<ready_deadline:
   ready,_,_=select.select([server.stdout],[],[],.1)
   if ready:
    line=server.stdout.readline();out.write(line);out.flush()
    if not line and server.poll() is not None:raise RuntimeError('HTTP server startup failed')
    try:j=json.loads(line)
    except ValueError:continue
    if j.get('event')=='ready':report['runtime']=j;origin=f"http://127.0.0.1:{j['port']}";break
  assert origin,'No owned HTTP listener'
  fixture=ReaderFixture(db,pg.dsn,run,psycopg)
  for case in CASES:
   if blocked:report['cases'].append({'case':case,'status':'unverified','reason':blocked});continue
   t=time.monotonic()
   try:
    if case=='O01_runtime':
     assert report['runtime']['node'].startswith('v24.') and report['runtime']['identity']==[{'role':'statarena_runtime','readonly':'on','statement':'8s','lock':'1s'}]
     assert db.execute("SELECT count(*) FROM pg_namespace WHERE nspname IN ('statarena','statarena_app')").fetchone()[0]==0
    elif case=='O02_pending':
     r=http('/api/health');fail(r,503,1);assert r['value']=={'source':'AWS','status':'pending','revision':'1'}
    elif case=='O03_status':
     r=http('/api/status');assert r['status']==200 and r['value']=={'source':'AWS','configured':True,'basePath':'/api/pitchapi'} and not r['sql']
    elif case=='O04_bad_input':
     for path in ['/api/health?v=x','/api/status?x=1','/api/settings?x=1','/api/settings?limit=0','/api/settings?limit=51','/api/settings?cursor=9223372036854775808','/api/settings?limit=1&limit=2','/api/assets?url=bad','/api/assets?url=x&url=y']:
      fail(http(path),400,0)
     r=http('/api/settings',method='POST');fail(r,405,0)
    elif case=='O05_health_ready':
     report['fixture']=fixture.prepare();r=http('/api/health');assert r['status']==200 and r['value']['source']=='AWS' and r['value']['status']=='ok' and isinstance(r['value']['revision'],str) and len(r['sql'])==1;values['health']=r
    elif case=='O06_conditional':
     r=http('/api/health',headers={'If-None-Match':values['health']['headers']['etag']});assert r['status']==304 and r['body']=='' and len(r['sql'])==1
     r=http('/api/health',method='HEAD');assert r['status']==200 and r['body']=='' and r['headers']['etag']==values['health']['headers']['etag'] and len(r['sql'])==1
     fixture.correct();r=http('/api/health');assert r['status']==200 and r['headers']['etag']!=values['health']['headers']['etag']
    elif case=='O07_settings':
     db.execute("INSERT INTO ingest.import_runs(mode,status,transform_version,parameters) SELECT 'daily','running','owned-operation-'||n,jsonb_build_object('private_canary','NOT_PUBLIC') FROM generate_series(1,31) n")
     r=http('/api/settings?limit=20');assert r['status']==200 and len(r['sql'])==1 and len(r['value']['sync'])==20 and r['value']['page']['nextCursor'] and 'NOT_PUBLIC' not in r['body']
     assert r['headers']['cache-control']=='no-store' and r['value']['schedule']['activation']=='unknown' and r['value']['workflowUrl'].endswith('/collect-football.yml');values['settings']=r
     for entry in r['value']['sync']:assert not (set(entry['value']) & {'parameters','counters','checkpoint','error'})
    elif case=='O08_settings_pages':
     a=values['settings'];r=http('/api/settings?'+urlencode({'limit':20,'cursor':a['value']['page']['nextCursor']}));assert r['status']==200 and len(r['value']['sync'])==11 and r['value']['page']['nextCursor'] is None
     ids=[e['value']['id'] for e in a['value']['sync']+r['value']['sync']];assert len(ids)==len(set(ids))==31 and [int(i) for i in ids]==sorted(map(int,ids),reverse=True)
    elif case=='O09_settings_head':
     r=http('/api/settings',method='HEAD');assert r['status']==200 and r['body']=='' and r['headers']['cache-control']=='no-store' and not r['sql']
    elif case=='O10_media':
     values['asset']=add_asset('https://fixture.invalid/player.png');r=asset('https://fixture.invalid/player.png');assert r['status']==307 and r['body']=='' and r['headers']['location']=='https://media.fixture.invalid/data/raw/neon/assets/'+'a'*64+'.png' and len(r['sql'])==1
     values['media']=r;r=asset('https://fixture.invalid/player.png',method='HEAD');assert (r['status'],r['body'],r['headers']['location'])==(307,'',values['media']['headers']['location'])
    elif case=='O11_media_correction':
     db.execute('UPDATE ingest.media_assets SET storage_key=%s,content_sha256=%s WHERE id=%s',('raw/neon/assets/'+'b'*64+'.png','b'*64,values['asset']))
     r=asset('https://fixture.invalid/player.png');assert r['status']==307 and r['headers']['location']!=values['media']['headers']['location']
     add_asset(None,content='c'*64,source='https://fixture.invalid/provenance.png');fail(asset('https://fixture.invalid/provenance.png'),404,1)
     add_asset('https://fixture.invalid/player.png',content='d'*64);fail(asset('https://fixture.invalid/player.png'),503,1)
    elif case=='O12_media_invalid':
     for name,key,mime,content in [('path','raw/../assets/'+'1'*64+'.png','image/png','1'*64),('mime','raw/neon/assets/'+'2'*64+'.png','application/json','2'*64),('hash','raw/neon/assets/'+'3'*64+'.png','image/png','4'*64),('body','raw/neon/assets/'+'5'*64+'.json','application/json','5'*64)]:
      url='https://fixture.invalid/'+name;add_asset(url,key,mime,content);fail(asset(url),503,1)
     fail(asset('https://fixture.invalid/missing'),404,1)
    elif case=='O13_media_origin':
     url='https://fixture.invalid/valid-again';add_asset(url,content='6'*64)
     for bad in ['http://media.fixture.invalid','https://media.fixture.invalid/prefix','https://media.fixture.invalid?x=1','https://user:pass@media.fixture.invalid']:
      raw('/__e2e__/media-origin?'+urlencode({'value':bad}));fail(asset(url),503,1)
     raw('/__e2e__/media-origin?'+urlencode({'value':'https://media.fixture.invalid'}));assert asset(url)['status']==307
    elif case=='O14_readonly_boundary':
     traces=json.loads(raw('/__e2e__/traces')[2]);assert traces['externalAttempts']==0
     with psycopg.connect(f'host=127.0.0.1 port={pg.port} dbname=postgres user=statarena_runtime',autocommit=True,options='-c default_transaction_read_only=on') as readonly:
      try:readonly.execute("INSERT INTO football.players(display_name) VALUES('forbidden')")
      except psycopg.Error as e:assert e.sqlstate in ['25006','42501']
      else:raise AssertionError('Runtime write accepted')
     assert all(not re.search(r'\b(INSERT|UPDATE|DELETE|COPY|CREATE|ALTER|DROP)\b',q['sql'],re.I) for r in report['requests'] for q in r['sql'])
     report['typedRowCount']=sum(db.execute('SELECT count(*) FROM '+t['qualified_name']).fetchone()[0] for s in model['schemas'] for t in s['tables'] if t['phase']!='models');assert report['typedRowCount']<=5000
    report['cases'].append({'case':case,'status':'pass','elapsedMs':round((time.monotonic()-t)*1000,3)})
   except Exception as e:
    blocked=case+': '+type(e).__name__;report['cases'].append({'case':case,'status':'fail','errorType':type(e).__name__,'error':str(e)[:5000]})
 except Exception as e:
  report['setupFailure']={'type':type(e).__name__,'error':str(e)[:5000]};blocked='setup'
 finally:
  if server:
   if server.poll() is None:
    server.terminate()
    try:server.wait(timeout=5)
    except subprocess.TimeoutExpired:server.kill();server.wait(timeout=2)
   report['serverExitCode']=server.returncode
  for s in streams:s.close()
  if db:db.close()
  try:report['cleanup']=pg.cleanup()
  except Exception as e:report['cleanup']={'error':str(e)};blocked='cleanup'
  report['commands']=pg.commands;report['elapsedSeconds']=round(time.monotonic()-started,3)
  report['status']='pass' if not blocked and len(report['cases'])==len(CASES) else 'fail'
  report['summary']={state:sum(c['status']==state for c in report['cases']) for state in ['pass','fail','unverified']}
  report['inputsUnchanged']=all((ROOT/p).is_file() and sha(ROOT/p)==value for p,value in report['sourceSha256'].items())
  assert sum(p.stat().st_size for p in run.rglob('*') if p.is_file())<96*1024**2
  (run/'result.json').write_text(json.dumps(report,indent=2,default=str)+'\n');print(json.dumps({'status':report['status'],'summary':report['summary'],'evidence':str(run/'result.json'),'cleanup':report.get('cleanup')}))
 return 0 if report['status']=='pass' else 1
if __name__=='__main__':raise SystemExit(main())
