#!/usr/bin/env python3
"""Record and verify the 2024/25 data-retention migration end to end."""
import argparse, gzip, hashlib, json, os, subprocess, time, urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]; DATA=ROOT/'data'; EVIDENCE=ROOT/'dashboard/outputs/season-retention'; EVIDENCE.mkdir(parents=True,exist_ok=True)
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def load(p): return json.loads(p.read_text())
def keep(s): return int(str(s)[:4]) >= 2024
ap=argparse.ArgumentParser();ap.add_argument('--baseline',action='store_true');args=ap.parse_args()
manifest=load(DATA/'raw/index.json')
if args.baseline:
 refs={v['path']:v['sha256'] for s in manifest['seasons'] if keep(s['id']) for c in s['chunks'] for v in c['tables'].values()}
 refs.update({str(p.relative_to(DATA)):sha(p) for p in (DATA/'sources/pitchapi/bundles').glob('*/**/*.tar.gz')})
 (EVIDENCE/'baseline.json').write_text(json.dumps(refs,sort_keys=True)+'\n');print('Baseline:',len(refs),'retained files');raise SystemExit
report={'setup':'Local canonical JSON data and Bun backend; baseline captured before removal. FIFA rankings are calendar editions and kept.','command':'python3 dashboard/scripts/verify_retention.py --baseline (before migration); python3 dashboard/scripts/verify_retention.py (after migration)','expected':'Only seasons from 2024/25 onward; retained table and archive hashes unchanged; metadata excludes seasons before 2024/25 and UEFA rankings exclude seasons before 2023/24; all manifest references resolve; HTTP manifest and representative archive work.','status':'failed'}
proc=None
try:
 assert [s['id'] for s in manifest['seasons']]==['2026/2027','2025/2026','2024/2025']
 assert all(keep(p.name) for p in (DATA/'raw/seasons').iterdir() if p.is_dir())
 refs=load(EVIDENCE/'baseline.json')
 for ref,digest in refs.items(): assert sha(DATA/ref)==digest,ref
 for s in manifest['seasons']:
  for c in s['chunks']:
   for v in c['tables'].values(): assert sha(DATA/v['path'])==v['sha256']
 for name in ('europe_2021_2026','europe_2026_2027'):
  base=DATA/'sources/pitchapi/bundles'/name; m=load(base/'manifest.json')
  for x in m['bundles']:
   assert sha(base/x['path'])==x['sha256']
   if x['path'].startswith(('matches/','fixtures/')): assert keep(x['path'].split('/')[1]),x['path']
  for x in m['metadata']:
   assert sha(base/x['path'])==x['sha256']
   if x['target']=='inventory.json':
    inv=json.load(gzip.open(base/x['path'],'rt')); assert all(keep(c['season']) for c in inv['competitions'])
   if x['target']=='catalogue.json':
    cat=json.load(gzip.open(base/x['path'],'rt')); assert all(keep(s) for l in cat['leagues'] for s in l.get('seasons',[]))
 ranks=load(DATA/'raw/rankings/index.json');assert all(not e['kind'].startswith('uefa') or not e.get('period') or int(e['period'][:4]) >= 2023 for e in ranks['editions'])
 for e in ranks['editions']: assert sha(DATA/e['path'])==e['sha256']
 env=os.environ.copy();env['PORT']='47823'
 log=(EVIDENCE/'backend.log').open('w');proc=subprocess.Popen([str(Path.home()/'.bun/bin/bun'),'dashboard/backend/server.js','--port','47823'],cwd=ROOT,stdout=log,stderr=log,env=env)
 for attempt in range(100):
  try: served=json.load(urllib.request.urlopen('http://127.0.0.1:47823/data/football-manifest.json',timeout=2));break
  except OSError: time.sleep(.1)
 else: raise RuntimeError('Backend did not start')
 assert served==manifest
 for mid in ('m_01FdKs','m_4XOc3a'):
  data=json.load(urllib.request.urlopen('http://127.0.0.1:47823/api/archive/matches/'+mid,timeout=30));assert data['fixture']['id']==mid
 report.update(status='passed',actual={'seasons':[s['id'] for s in manifest['seasons']],'competition_partitions':sum(len(s['chunks']) for s in manifest['seasons']),'unchanged_retained_files':len(refs),'ranking_editions':len(ranks['editions']),'http_matches':['m_01FdKs','m_4XOc3a']},logs=['backend.log','baseline.json'])
except Exception as exc:
 report['error']=repr(exc);raise
finally:
 if proc: proc.terminate();proc.wait(timeout=10)
 (EVIDENCE/'evidence.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
