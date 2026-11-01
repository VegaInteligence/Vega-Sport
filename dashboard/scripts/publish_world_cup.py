#!/usr/bin/env python3
"""Publish staged World Cup 2026 observations into the canonical JSON database."""
import json,shutil,sys,tempfile,urllib.request,urllib.parse
from collections import Counter
from datetime import datetime,timezone
from pathlib import Path
import build_json_database as db
from build_season_dashboard import build
from bundle_europe import pack_archive
from publish_daily import encode_part
ROOT=Path(__file__).resolve().parents[2];DATA=ROOT/'data';OUT=ROOT/'dashboard/outputs/pitchapi-coverage';NAME='world_cup_2026';LEAGUE='l_1XLtP0';SEASON='2026';LABEL='2026/2027'
receipt=json.loads((OUT/'world-cup-recovery.json').read_text());assert receipt['matches']==104 and receipt['incomplete']==0, 'World Cup responses are not all collected'
archive=DATA/'staging/world-cup-archive'/NAME
if archive.exists():shutil.rmtree(archive)
(archive/'matches'/LEAGUE).mkdir(parents=True)
for file in (DATA/'staging/pitchapi-world-cup'/LEAGUE).glob('*.json'):
 row=json.loads(file.read_text());assert row['complete'] and row['competition_id']==LEAGUE
 shutil.copyfile(file,archive/'matches'/LEAGUE/file.name)
assert len(list((archive/'matches'/LEAGUE).glob('*.json')))==104
profiles=DATA/'staging/pitchapi-world-cup-profiles'
if profiles.exists():shutil.copytree(profiles,archive/'profiles')
base='https://statarena-analytics.vercel.app/api/pitchapi'
def get(path):
 with urllib.request.urlopen(base+path,timeout=30) as response:return json.load(response)['data']
league=next(x for x in get('/leagues')['leagues'] if x['id']==LEAGUE)
league['seasons']=[s for s in league.get('seasons',[]) if int(str(s)[:4])>=2024]
query=urllib.parse.urlencode({'season':SEASON,'status':'all'});fixtures=get('/leagues/'+LEAGUE+'/matches?'+query)['matches'];assert len(fixtures)==104 and all(x['status']=='finished' for x in fixtures)
now=datetime.now(timezone.utc).isoformat();inventory={'retrieved_at_utc':now,'competitions':[{'id':LEAGUE,'name':league['name'],'country_code':league['country_code'],'season':SEASON,'status':200,'response_valid':True,'matches':fixtures}]}
(archive/'inventory.json').write_text(json.dumps(inventory,ensure_ascii=False,separators=(',',':'))+'\n');(archive/'catalogue.json').write_text(json.dumps({'leagues':[league]},ensure_ascii=False,separators=(',',':'))+'\n')
profile_ids={};profile_counts={}
for kind in ('leagues','teams','players'):
 files=list((archive/'profiles'/kind).glob('*.json'));records=[json.loads(file.read_text()) for file in files]
 if any(r.get('status') not in (200,404) for r in records):raise RuntimeError('World Cup profile collection still contains transient failures')
 profile_ids[kind]=[r['resource_id'] for r in records];profile_counts[kind]=len(records)
profile_counts.update(unavailable=sum(1 for file in (archive/'profiles').glob('*/*.json') if json.loads(file.read_text()).get('status')==404),restricted=0,failed=0)
collection={'retrieved_at_utc':now,'competitions':1,'fixtures':104,'finished':104,'considered':104,'completed':104,'incomplete':0,'scope_years':['2026'],'endpoints':['match','events','players','shots','stats','lineups','momentum','h2h','player_halves','advanced_teams','advanced_players','pass_networks','heatmaps'],'other_fixtures':{'total':0,'completed':0,'incomplete':0},'profiles':profile_counts,'profiles_collected':True,'profile_ids':profile_ids}
(archive/'collection.json').write_text(json.dumps(collection,ensure_ascii=False,separators=(',',':'))+'\n')
with tempfile.TemporaryDirectory(prefix='orion-worldcup-') as tmp:
 output=Path(tmp)/'snapshot.json';issues=build(output,archive=archive,display_season=LABEL,include_inventory_only=False,write_issues=False,competition_id=LEAGUE)
 if issues:raise RuntimeError('World Cup normalization failed: '+str(issues[:3]))
 part=db.read(output);assert len(part['matches'])==104
 bundle=DATA/'sources/pitchapi/bundles'/NAME;pack_archive(archive,bundle)
 if '--prepare-only' in sys.argv:
  print(json.dumps({'status':'prepared','matches':len(part['matches']),'source_bundle':str(bundle.relative_to(ROOT))}));sys.exit(0)
 # Normalize a single competition; existing competition partitions are retained.
 item=encode_part(part,LABEL,LEAGUE)
 index=db.read(DATA/'raw/index.json');season=next(s for s in index['seasons'] if s['id']==LABEL)
 season['chunks']=[c for c in season['chunks'] if c['leagueId']!=LEAGUE]+[item];season['chunks'].sort(key=lambda c:c['leagueId'],reverse=True)
 db.build_observations({NAME});db.finalize_indexes()
 # Refresh the human-readable import summary from actual published partitions.
 summary=db.read(DATA/'raw/import-summary.json');counts=Counter()
 for stored_season in index['seasons']:
  for stored_chunk in stored_season['chunks']:
   for table,ref in stored_chunk['tables'].items():counts[table]+=ref['rows']
 for key,value in summary['table_rows'].items():
  if key.startswith('supplemental_'):counts[key]=value
 response_counts=Counter();documents=0
 for file in (DATA/'raw/seasons').glob('*/observations/documents/*.gz'):
  rows=db.read(file);documents+=len(rows)
  for row in rows:response_counts.update(row['endpoints'])
 for file in (DATA/'raw/profiles').glob('*/*.gz'):response_counts[file.parent.name]+=len(db.read(file))
 summary.update(table_rows=dict(counts),seasons=len(index['seasons']),roundtripped_partitions=sum(len(s['chunks']) for s in index['seasons']),observations={'documents':documents,'match_ids':len(db.read(DATA/'raw/match-observations.json')),'response_rows':dict(response_counts)})
 db.write('raw/import-summary.json',summary);db.write('raw/index.json',index)
 from build_dashboard_views import build_views
 build_views(DATA)
print(json.dumps({'status':'published','competition':LEAGUE,'season':LABEL,'matches':len(part['matches']),'appearances':len(part['appearances']),'source_bundle':str(bundle.relative_to(ROOT))},indent=2))
