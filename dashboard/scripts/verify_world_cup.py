#!/usr/bin/env python3
"""E2E verify the World Cup canonical partition and match archive route."""
import hashlib,json,os,socket,subprocess,time,urllib.request,tarfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];DATA=ROOT/'data';OUT=ROOT/'dashboard/outputs/pitchapi-coverage/world-cup-e2e.json'
report={'setup':'Bun local backend, canonical JSON database, World Cup source bundles and saved recovery receipt.','command':'python3 dashboard/scripts/verify_world_cup.py','expected':'The 2026 World Cup appears in the 2026/27 manifest, all 104 staged fixtures are represented by canonical match rows and 13 source families, with valid table checksums and a working match archive endpoint. Unavailable families remain 404.','status':'failed'}
proc=None
try:
 manifest=json.loads((DATA/'raw/index.json').read_text());season=next(x for x in manifest['seasons'] if x['id']=='2026/2027');chunk=next(x for x in season['chunks'] if x['leagueId']=='l_1XLtP0')
 for ref in chunk['tables'].values():assert hashlib.sha256((DATA/ref['path']).read_bytes()).hexdigest()==ref['sha256']
 import gzip
 matches=json.load(gzip.open(DATA/chunk['tables']['matches']['path'],'rt'));receipt=json.loads((OUT.parent/'world-cup-recovery.json').read_text());assert len(matches)==receipt['matches']==104
 lookup=json.loads((DATA/'raw/match-observations.json').read_text());shards=json.loads((DATA/'raw/observation-shards.json').read_text());required={'match','events','players','shots','stats','lineups','momentum','h2h','player_halves','advanced_teams','advanced_players','pass_networks','heatmaps'}
 for row in receipt['results']:
  mid=row['id'];versions=lookup[mid];assert any(required.issubset(shards[v['shard']]['tables']) for v in versions),mid
 profile_index=json.loads((DATA/'raw/profile-index.json').read_text())['entities'];profile_ok=profile_missing=0
 bundle=DATA/'sources/pitchapi/bundles/world_cup_2026';source_manifest=json.loads((bundle/'manifest.json').read_text())
 for item in source_manifest['bundles']:
  if not item['path'].startswith('profiles/'):continue
  with tarfile.open(bundle/item['path'],'r:gz') as tar:
   for member in tar:
    observation=json.load(tar.extractfile(member));kind=member.name.split('/')[1];ident=observation['resource_id']
    if observation['status']==200:
     assert kind+':'+ident in profile_index,(kind,ident);profile_ok+=1
    elif observation['status']==404:profile_missing+=1
    else:raise AssertionError(f'Unresolved profile status {observation["status"]}')
 assert profile_ok==411 and profile_missing==7
 with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
 log=(OUT.parent/'world-cup-backend.log').open('w');proc=subprocess.Popen([str(Path.home()/'.bun/bin/bun'),'dashboard/backend/server.js','--port',str(port)],cwd=ROOT,stdout=log,stderr=log)
 for _ in range(100):
  try: data=json.load(urllib.request.urlopen(f'http://127.0.0.1:{port}/api/archive/matches/{receipt["results"][0]["id"]}',timeout=3));break
  except OSError:time.sleep(.1)
 else:raise RuntimeError('Backend did not start')
 assert data['fixture']['id']==receipt['results'][0]['id'];assert required.issubset(data['endpoints'])
 report.update(status='passed',actual={'matches':len(matches),'endpoint_families':len(required),'profiles_indexed':profile_ok,'profiles_not_found':profile_missing,'sample_match':data['fixture']['id']},logs=['world-cup-backend.log'])
except Exception as exc:
 report['error']=repr(exc);raise
finally:
 if proc:proc.terminate();proc.wait(timeout=10)
 OUT.write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
