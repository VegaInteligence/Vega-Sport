#!/usr/bin/env python3
"""Actual Node24 AWS HTTP origin-selection E2E, no cloud or SQL connection."""
from pathlib import Path
from datetime import datetime,timezone
import argparse,hashlib,json,os,re,select,shutil,subprocess,sys,time
from urllib.error import HTTPError
from urllib.request import Request,ProxyHandler,build_opener
ROOT=Path(__file__).resolve().parents[1];BASE=ROOT/'docs/verification/orion-pro-runtime-origin-20261105'
CASES=['N01_neon_only_status','N02_neon_only_health','N03_native_no_fallback','N04_method','N05_non_rds','N06_legacy_off','N07_boundaries']
def main():
 p=argparse.ArgumentParser();p.add_argument('--label',default='runtime-origin');p.add_argument('--node',type=Path,default=Path(shutil.which('node')));args=p.parse_args();assert re.fullmatch('[A-Za-z0-9][A-Za-z0-9-]{0,70}',args.label)
 started=time.monotonic();deadline=started+90;run=BASE/'runs'/(datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')+'-'+args.label);(run/'inputs').mkdir(parents=True)
 sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
 paths=[Path(__file__),BASE/'PROTOCOL.md',BASE/'http_server.mjs',ROOT/'dashboard/backend/aws-app.js',ROOT/'dashboard/backend/services/postgres.js',ROOT/'dashboard/backend/services/orion-pro-operations.js']
 report={'kind':'actual_node24_pro_runtime_origin_e2e','command':[sys.executable,*sys.argv],'expected':'PROTOCOL.md authored before changing runtime origin selection','sourceSha256':{},'cases':[],'requests':[],'children':[],'cloudCalls':0,'sourceCalls':0,'setup':'Actual AWS router on Node24 with DB-driver/fetch tripwires, minimal synthetic configuration','suggestedCommit':'fix: prevent Pro runtime from falling back to Neon configuration'}
 for f in paths:
  d=run/'inputs'/f.relative_to(ROOT);d.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(f,d);report['sourceSha256'][str(f.relative_to(ROOT))]=sha(f)
 process=None;streams=[];origin=None;blocked=None;opener=build_opener(ProxyHandler({}))
 def stop():
  nonlocal process
  if process:
   if process.poll() is None:
    process.terminate()
    try:process.wait(timeout=4)
    except subprocess.TimeoutExpired:process.kill();process.wait(timeout=2)
   report['children'][-1]['exitCode']=process.returncode;report['children'][-1]['stopped']=process.poll() is not None;process=None
  for f in streams:f.close()
  streams.clear()
 def start(mode):
  nonlocal process,origin
  stop();env={'PATH':os.defpath,'STATARENA_PRO_API':'0' if mode=='legacy' else '1','NEON_DATABASE_URL':'postgresql://synthetic@127.0.0.1:9/not_a_source?sslmode=disable'}
  if mode=='invalid_aws':env['DATABASE_URL']='postgresql://synthetic@127.0.0.1:9/not_rds?sslmode=disable';env['STATARENA_DATA_PROVIDER']='aws'
  out=(run/(mode+'.stdout.log')).open('w');err=(run/(mode+'.stderr.log')).open('w');streams.extend([out,err]);report['children'].append({'mode':mode,'environmentKeys':sorted(env),'nodeSha256':sha(args.node),'stopped':False})
  process=subprocess.Popen([str(args.node),str(BASE/'http_server.mjs')],cwd=ROOT,env=env,stdout=subprocess.PIPE,stderr=err,text=True,bufsize=1);origin=None
  while time.monotonic()<min(deadline,started+80):
   ready,_,_=select.select([process.stdout],[],[],.1)
   if ready:
    line=process.stdout.readline();out.write(line);out.flush()
    if not line and process.poll() is not None:raise RuntimeError('HTTP child failed')
    try:j=json.loads(line)
    except ValueError:continue
    if j.get('event')=='ready':assert j['node'].startswith('v24.');origin=f"http://127.0.0.1:{j['port']}";return
  raise TimeoutError('Startup bound')
 def raw(path,method='GET',headers=None):
  try:r=opener.open(Request(origin+path,method=method,headers=headers or {}),timeout=8)
  except HTTPError as e:r=e
  return r.status,dict((k.lower(),v) for k,v in r.headers.items()),r.read().decode()
 def http(path,method='GET'):
  assert time.monotonic()<deadline and len(report['requests'])<30;rid=str(len(report['requests'])+1);status,h,body=raw(path,method,{'x-e2e-id':rid});audit=json.loads(raw('/__e2e__/traces')[2]);trace=next(t for t in audit['traces'] if t['id']==rid)
  record={'path':path,'method':method,'status':status,'headers':h,'body':body,'sql':trace['sql'],'driverAttempts':audit['driverAttempts'],'externalAttempts':audit['externalAttempts'],'mode':report['children'][-1]['mode']};report['requests'].append(record)
  assert audit['driverAttempts']==audit['externalAttempts']==0,record
  return {**record,'value':json.loads(body) if body else None}
 try:
  start('neon_only')
  for case in CASES:
   if blocked:report['cases'].append({'case':case,'status':'unverified','reason':blocked});continue
   try:
    if case=='N01_neon_only_status':
     r=http('/api/status');assert r['status']==200 and r['value']['configured'] is False and not r['sql'],r
    elif case=='N02_neon_only_health':
     for method in ['GET','HEAD']:
      r=http('/api/health',method);assert r['status']==503 and r['headers']['cache-control']=='no-store' and not r['sql'],r
      assert r['body']=='' if method=='HEAD' else r['value']=={'source':'AWS','status':'pending','revision':None}
    elif case=='N03_native_no_fallback':
     r=http('/api/fixtures?limit=2');assert r['status']==503 and r['value']['error']['code']=='DATA_UNAVAILABLE' and r['headers']['cache-control']=='no-store' and not r['sql'],r
    elif case=='N04_method':
     r=http('/api/status','POST');assert r['status']==405 and not r['sql'],r
    elif case=='N05_non_rds':
     start('invalid_aws');r=http('/api/fixtures?limit=2');assert r['status']==503 and r['value']['error']['code']=='DATA_UNAVAILABLE' and not r['sql'],r
    elif case=='N06_legacy_off':
     start('legacy');r=http('/api/status');assert r['status']==200 and r['value']['configured'] is False and not r['sql'],r
     r=http('/api/health');assert r['status']==503 and not r['sql'],r
    elif case=='N07_boundaries':assert all(r['driverAttempts']==r['externalAttempts']==0 and not r['sql'] for r in report['requests'])
    report['cases'].append({'case':case,'status':'pass'})
   except Exception as e:blocked=case;report['cases'].append({'case':case,'status':'fail','error':str(e)[:5000]})
 except Exception as e:blocked='setup';report['setupFailure']={'errorType':type(e).__name__,'error':str(e)}
 finally:
  stop();report['elapsedSeconds']=round(time.monotonic()-started,3);report['inputsUnchanged']=all(sha(ROOT/p)==h for p,h in report['sourceSha256'].items());report['allOwnedChildrenStopped']=all(c['stopped'] for c in report['children']);report['status']='pass' if not blocked and report['inputsUnchanged'] and report['allOwnedChildrenStopped'] else 'fail';report['counts']={s:sum(c['status']==s for c in report['cases']) for s in ['pass','fail','unverified']}
  (run/'result.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'status':report['status'],'counts':report['counts'],'evidence':str(run/'result.json'),'allOwnedChildrenStopped':report['allOwnedChildrenStopped']}))
 return 0 if report['status']=='pass' else 1
if __name__=='__main__':raise SystemExit(main())
