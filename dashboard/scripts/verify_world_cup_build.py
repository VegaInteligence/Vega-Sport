#!/usr/bin/env python3
"""Exercise the actual multiseason builder with duplicate World Cup inventories."""
import contextlib,io,json,os,tempfile
from pathlib import Path
import build_multiseason_dashboard as b
from restore_europe import restore_archive
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'dashboard/outputs/pitchapi-coverage/world-cup-builder.json'
report={'setup':'Python 3; restore the bundled World Cup data, then construct two temporary archives with different inventory timestamps. No network or credentials.','command':'python3 dashboard/scripts/verify_world_cup_build.py','expected':'The newer source wins, the builder emits exactly one competition-season partition, and all 104 match records are normalized.','status':'failed'};logs=io.StringIO()
try:
 with tempfile.TemporaryDirectory(prefix='orion-world-cup-e2e-') as directory:
  root=Path(directory);source=root/'world_cup_2026';restore_archive(ROOT/'data/sources/pitchapi/bundles/world_cup_2026',source,allowed_archives=('world_cup_2026',));archives=[]
  for name,timestamp in [('older','2026-01-01T00:00:00Z'),('newer','2026-11-01T00:00:00Z')]:
   p=root/name;p.mkdir();inv=json.loads((source/'inventory.json').read_text());inv['retrieved_at_utc']=timestamp;(p/'inventory.json').write_text(json.dumps(inv));(p/'catalogue.json').write_bytes((source/'catalogue.json').read_bytes());os.symlink(source/'matches',p/'matches');archives.append(p)
  b.ARCHIVES=archives;b.DASHBOARD=root/'dashboard';b.MANIFEST=b.DASHBOARD/'football-manifest.json'
  with contextlib.redirect_stdout(logs):assert b.main()==0
  manifest=json.loads(b.MANIFEST.read_text());assert len(manifest['seasons'])==1;chunks=manifest['seasons'][0]['chunks'];assert len(chunks)==1;assert chunks[0]['matchCount']==104;assert chunks[0]['collectedMatches']==104
  import gzip
  with gzip.open(b.DASHBOARD/chunks[0]['path'],'rt') as f: snapshot=json.load(f)
  assert any('/newer/' in path for path in snapshot['meta']['sourceFiles'])
  report.update(status='passed',actual={'season':manifest['seasons'][0]['id'],'partitions':len(chunks),'matches':chunks[0]['matchCount']},log=logs.getvalue())
except Exception as exc:report.update(error=repr(exc),log=logs.getvalue());raise
finally:OUT.write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
