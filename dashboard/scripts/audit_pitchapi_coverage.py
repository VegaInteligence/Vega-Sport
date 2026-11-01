#!/usr/bin/env python3
"""Compare the live PitchAPI catalogue and schedules with saved source records."""
import collections, concurrent.futures, datetime, gzip, json, time, urllib.parse, urllib.request, urllib.error
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]; DATA=ROOT/'data'; OUT=ROOT/'dashboard/outputs/pitchapi-coverage';OUT.mkdir(parents=True,exist_ok=True)
BASE='https://statarena-analytics.vercel.app/api/pitchapi'
def get(path):
 for attempt in range(4):
  try:
   with urllib.request.urlopen(BASE+path,timeout=45) as r:return json.load(r)
  except (urllib.error.URLError,TimeoutError) as e:
   if attempt==3:raise
   time.sleep(2**attempt)
def saved():
 out={}; summary={}
 for base in sorted((DATA/'sources/pitchapi/bundles').iterdir()):
  if not (base/'manifest.json').exists():continue
  def read(n):return json.load(gzip.open(base/'metadata'/f'{n}.json.gz','rt'))
  inv=read('inventory');idx=read('index') if (base/'metadata/index.json.gz').exists() else {'competition_summaries':[]}
  for c in inv['competitions']:out[(c['id'],c['season'])]=c
  for c in idx['competition_summaries']:summary[(c['id'],c['season'])]=c
 return out,summary
catalogue=get('/leagues')['data']['leagues'];local,summaries=saved();known=json.loads((DATA/'raw/match-observations.json').read_text());jobs=[]
countries=set('ALB AND ARM AUT AZE BEL BIH BLR BUL CRO CYP CZE DEN ENG ESP EST FIN FRA FRO GEO GER DEU GIB GRE GRC HUN IRL ISL ISR ITA KAZ KOS XKX LIE LTU LUX LVA MDA MKD MLT MNE NED NLD NIR NOR POL POR ROU RUS SCO SMR SRB SUI CHE SVK SVN SWE TUR UKR WAL'.split())
cups={'Champions League','Europa League','Conference League','1. Lig','World Cup'}
for l in catalogue:
 if not (l.get('country_code') in countries or (l.get('country_code') in ('INT','INT-2') and l.get('name') in cups)):continue
 for s in l.get('seasons',[]):
  if len(s)>=4 and s[:4].isdigit() and int(s[:4])>=2024:jobs.append((l,s))
def check(job):
 l,s=job;key=(l['id'],s);p='/leagues/'+l['id']+'/matches?'+urllib.parse.urlencode({'season':s,'status':'all'});localrow=local.get(key);out={'id':l['id'],'name':l['name'],'country_code':l['country_code'],'season':s,'in_saved_inventory':bool(localrow)}
 try:
  obj=get(p);live=obj['data']['matches'];ids={m['id'] for m in live};old={m['id'] for m in localrow['matches']} if localrow else set();finished={m['id'] for m in live if m.get('status')=='finished'}; row=summaries.get(key,{})
  out.update(live_fixtures=len(ids),live_finished=len(finished),live_finished_ids=sorted(finished),saved_fixtures=len(old),new_fixture_ids=sorted(ids-old),saved_only_fixture_ids=sorted(old-ids),finished_without_observations=sorted(finished-set(known)),saved_downloaded=row.get('downloaded',0))
 except Exception as e:out['error']=f'{type(e).__name__}: {str(e)[:100]}'
 return out
results=[]
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as ex:
 for i,row in enumerate(ex.map(check,jobs),1):
  results.append(row)
  if i%25==0:print(f'Compared {i}/{len(jobs)} competition-seasons',flush=True)
# One saved observation can be an old fixture snapshot with only three families.
# Reconcile the live finished match IDs against all archived versions, per match.
shards=json.loads((DATA/'raw/observation-shards.json').read_text()); grouped=collections.defaultdict(list)
for row in results:
 for mid in row.get('live_finished_ids',[]):
  for version in known.get(mid,[]):grouped[version['shard']].append((mid,version['ordinal']))
covered=collections.defaultdict(set)
for shard, entries in grouped.items():
 with gzip.open(DATA/shards[shard]['document']['path'],'rt') as f: docs=json.load(f)
 for mid,ordinal in entries:covered[mid].update(docs[ordinal]['endpoints'])
required={'match','events','players','shots','stats','lineups','momentum','h2h','player_halves','advanced_teams','advanced_players','pass_networks','heatmaps'}
for row in results:
 row['finished_missing_families']=[{'match_id':mid,'missing':sorted(required-covered[mid])} for mid in row.get('live_finished_ids',[]) if required-covered[mid]]
 row.pop('live_finished_ids',None)
report={'timestamp_utc' :datetime.datetime.now(datetime.timezone.utc).isoformat(),'setup':'Public STATARENA server-side PitchAPI proxy; locally saved source bundle inventories and canonical match-observations index. Scope: European competitions and FIFA World Cup, seasons from 2024 onward. No credentials recorded.','command':'python3 dashboard/scripts/audit_pitchapi_coverage.py','catalogue_leagues':len(catalogue),'catalogue_competition_seasons':len(jobs),'successful':sum('error' not in r for r in results),'failed':sum('error' in r for r in results),'season_competitions_not_in_inventory':sum(not r['in_saved_inventory'] for r in results),'live_finished_without_observations':sum(len(r.get('finished_without_observations',[])) for r in results),'new_fixtures':sum(len(r.get('new_fixture_ids',[])) for r in results),'finished_missing_families':sum(len(r['finished_missing_families']) for r in results),'results':results}
(OUT/'live-catalogue-audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps({k:v for k,v in report.items() if k!='results'},indent=2),flush=True)
