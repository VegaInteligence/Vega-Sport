#!/usr/bin/env python3
"""Count stored provider response statuses; retry representative failures live."""
import collections,glob,gzip,json,urllib.request,urllib.error
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];DATA=ROOT/'data';counts=collections.Counter();samples={}
for kind in ('player_halves','advanced_teams','advanced_players','pass_networks','heatmaps'):
 for file in glob.glob(str(DATA/'raw/seasons/*/observations'/kind/'*.gz')):
  with gzip.open(file,'rt') as stream:rows=json.load(stream)
  for row in rows:
   r=row['response'];code=(r.get('error') or {}).get('code');counts[(kind,str(r.get('status')),str(code))]+=1
   if r.get('status')==404 and kind not in samples:samples[kind]=row['matchId']
profiles=collections.defaultdict(set);examples={}
for file in glob.glob(str(DATA/'raw/profiles/*/*.gz')):
 kind=file.split('/profiles_')[-1].split('/')[0]
 with gzip.open(file,'rt') as stream:rows=json.load(stream)
 for row in rows:
  r=row['observation'];data=r.get('data');id=r.get('resource_id') or (data.get('id') if isinstance(data,dict) else None);code=(r.get('error') or {}).get('code','OK' if r.get('status')==200 else str(r.get('status')))
  if id:profiles[(kind,id)].add(code);examples.setdefault(code,(kind,id))
retry=[];routes={'player_halves':'players/halves','advanced_teams':'advanced','advanced_players':'advanced/players','pass_networks':'advanced/network','heatmaps':'heatmaps'}
checks=[(kind,id,'/matches/'+id+'/'+routes[kind]) for kind,id in samples.items()]
for code in ('PLAN_UPGRADE_REQUIRED','RESOURCE_NOT_FOUND'):
 if code in examples:
  kind,id=examples[code];checks.append((code,id,'/'+kind+'/'+id))
for kind,id,path in checks:
 try:
  with urllib.request.urlopen('https://statarena-analytics.vercel.app/api/pitchapi'+path,timeout=25) as response:status=response.status;body=json.load(response)
 except urllib.error.HTTPError as e:
  status=e.code
  try:body=json.load(e)
  except Exception:body={}
 except Exception as e:status=None;body={'error':{'code':type(e).__name__}}
 retry.append({'kind':kind,'id':id,'status':status,'error_code':(body.get('error') or {}).get('code')})
summary={}
for code in ('PLAN_UPGRADE_REQUIRED','RESOURCE_NOT_FOUND'):
 entities=[id for id,v in profiles.items() if code in v];summary[code]={'entities':len(entities),'without_any_success':sum('OK' not in profiles[id] for id in entities)}
report={'setup':'Saved raw response versions and profile observations; live representative retries through the deployed STATARENA proxy. Counts describe response versions, not necessarily distinct matches.','command':'python3 dashboard/scripts/audit_saved_responses.py','expected':'Count recorded statuses and distinguish previously denied/absent profiles from entities with a successful version; retry examples without claiming all historic failures remain unavailable.','endpoint_response_versions':[{'family':k[0],'status':k[1],'error_code':k[2],'count':n} for k,n in sorted(counts.items())],'profile_entities':summary,'retry_samples':retry}
out=ROOT/'dashboard/outputs/pitchapi-coverage/saved-responses.json';out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
