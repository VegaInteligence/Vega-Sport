#!/usr/bin/env python3
"""Stage profiles referenced by World Cup match documents, without replacing known successful profiles."""
import collections,concurrent.futures,datetime,json,pathlib,re,time,urllib.request,urllib.error
ROOT=pathlib.Path(__file__).resolve().parents[2];OUT=ROOT/'data/staging/pitchapi-world-cup-profiles';OUT.mkdir(parents=True,exist_ok=True);ids=collections.defaultdict(set)
def walk(x):
 if isinstance(x,dict):
  for v in x.values():
   if isinstance(v,str) and re.fullmatch('[ptl]_[A-Za-z0-9]{6}',v):ids[v[0]].add(v)
   else:walk(v)
 elif isinstance(x,list):
  for v in x:walk(v)
for f in (ROOT/'data/staging/pitchapi-world-cup').rglob('*.json'):walk(json.loads(f.read_text()))
index=json.loads((ROOT/'data/raw/profile-index.json').read_text())['entities'];jobs=[]
for prefix,group in [('p','players'),('t','teams'),('l','leagues')]:
 for id in sorted(ids[prefix]):
  if group+':'+id not in index:jobs.append((group,id))
def worker(job):
 kind,id=job;target=OUT/kind/(id+'--'+id.encode().hex()+'.json');target.parent.mkdir(parents=True,exist_ok=True)
 if target.exists():
  old=json.loads(target.read_text())
  if old.get('status') in (200,404):return old['status']
 for attempt in range(3):
  try:
   time.sleep(1)
   with urllib.request.urlopen(f'https://orion-football-ranking.vercel.app/api/pitchapi/{kind}/{id}',timeout=30) as response:status=response.status;body=json.load(response)
  except urllib.error.HTTPError as e:
   status=e.code
   try:body=json.load(e)
   except Exception:body={}
  except (urllib.error.URLError,TimeoutError):status=None;body={}
  if status!=429:break
  time.sleep(2**attempt)
 record={'status':status,'data':body.get('data'),'error':body.get('error'),'resource_id':id,'retrieved_at_utc':datetime.datetime.now(datetime.timezone.utc).isoformat()};target.write_text(json.dumps(record,ensure_ascii=False,separators=(',',':'))+'\n');return status
counts=collections.Counter()
with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
 for n,status in enumerate(ex.map(worker,jobs),1):
  counts[str(status)]+=1
  if n%100==0:print('Profiles',n,'/',len(jobs),flush=True)
report={'setup':'World Cup match IDs vs existing profile index; live Orion PitchAPI proxy.','command':'python3 dashboard/scripts/recover_world_cup_profiles.py','expected':'Record provider status for every referenced profile missing a previously successful observation.','referenced':{k:len(v) for k,v in ids.items()},'requested':len(jobs),'statuses':dict(counts),'staged':True}
(ROOT/'dashboard/outputs/pitchapi-coverage/world-cup-profiles.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
