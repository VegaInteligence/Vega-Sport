#!/usr/bin/env python3
"""Stage missing finished European match endpoint observations via the configured STATARENA proxy."""
import collections, concurrent.futures, datetime, json, sys, time, urllib.request, urllib.error, urllib.parse
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];WORLD_CUP='--world-cup' in sys.argv; OUT=ROOT/'data/staging'/('pitchapi-world-cup' if WORLD_CUP else 'pitchapi-audit-recovery');OUT.mkdir(parents=True,exist_ok=True)
BASE='https://statarena-analytics.vercel.app/api/pitchapi'; audit=json.loads((ROOT/'dashboard/outputs/pitchapi-coverage/live-catalogue-audit.json').read_text())
endpoints={'match':'','events':'events','players':'players','shots':'shots','stats':'stats','lineups':'lineups','momentum':'momentum','h2h':'h2h','player_halves':'players/halves','advanced_teams':'advanced','advanced_players':'advanced/players','pass_networks':'advanced/network','heatmaps':'heatmaps'}
def get(path):
 for attempt in range(4):
  try:
   with urllib.request.urlopen(BASE+path,timeout=40) as response:return {'status':response.status,**json.load(response)}
  except urllib.error.HTTPError as e:
   try:body=json.load(e)
   except Exception:body={}
   if e.code not in (429,502,503,504) or attempt==3:return {'status':e.code,**body}
  except (urllib.error.URLError,TimeoutError):
   if attempt==3:return {'status':None,'error':{'code':'NETWORK_ERROR'}}
  time.sleep(2**attempt)
jobs=[]
for c in audit['results']:
 if WORLD_CUP:
  if c['name']!='World Cup' or c['country_code']!='INT':continue
 elif not c['in_saved_inventory'] or not c['finished_missing_families']:continue
 query=urllib.parse.urlencode({'season':c['season'],'status':'all'});result=get('/leagues/'+c['id']+'/matches?'+query)
 if result.get('status')!=200:raise RuntimeError('Could not refresh fixture list for '+c['id'])
 fixtures={x['id']:x for x in result['data']['matches']}
 if WORLD_CUP:
  jobs.extend((c,fixture) for fixture in fixtures.values() if fixture.get('status')=='finished')
 else:
  for row in c['finished_missing_families']:
   mid=row['match_id'];jobs.append((c,fixtures[mid]))
def worker(job):
 c,fixture=job;mid=fixture['id'];target=OUT/c['id']/(mid+'--'+mid.encode().hex()+'.json');target.parent.mkdir(parents=True,exist_ok=True)
 old=json.loads(target.read_text()) if target.exists() else {};responses=old.get('endpoints',{})
 for name,suffix in endpoints.items():
  if responses.get(name,{}).get('status') in (200,404):continue
  r=get('/matches/'+mid+('/'+suffix if suffix else ''));responses[name]={'status':r.get('status'),'data':r.get('data'),'error':r.get('error')}
 complete=all(responses.get(name,{}).get('status') in (200,404) for name in endpoints)
 row={'competition_id':c['id'],'competition_name':c['name'],'country_code':c['country_code'],'season':c['season'],'fixture':fixture,'retrieved_at_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'complete':complete,'endpoints':responses}
 target.write_text(json.dumps(row,ensure_ascii=False,separators=(',',':'))+'\n');return {'id':mid,'complete':complete,'status':{name:v['status'] for name,v in responses.items()}}
results=[]
with concurrent.futures.ThreadPoolExecutor(max_workers=1 if WORLD_CUP else 3) as ex:
 for i,row in enumerate(ex.map(worker,jobs),1):
  results.append(row)
  if i%10==0:print('Recovered',i,'/',len(jobs),flush=True)
report={'setup':'Live STATARENA server-side PitchAPI proxy; staged World Cup matches.' if WORLD_CUP else 'Live STATARENA server-side PitchAPI proxy, matches with missing families from live catalogue audit; staged only.','command':'python3 dashboard/scripts/recover_pitchapi_matches.py'+(' --world-cup' if WORLD_CUP else ''),'expected':'Each identified finished match has all 13 recorded endpoint responses; 404 is preserved as unavailable, not as success.','matches':len(jobs),'complete':sum(r['complete'] for r in results),'incomplete':sum(not r['complete'] for r in results),'results':results}
(ROOT/'dashboard/outputs/pitchapi-coverage'/('world-cup-recovery.json' if WORLD_CUP else 'recovery.json')).write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:v for k,v in report.items() if k!='results'},indent=2))
