#!/usr/bin/env python3
"""E2E serving contract: generated views must reconstruct every canonical table."""
import hashlib,json,subprocess,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'dashboard/outputs/loading-performance';OUT.mkdir(parents=True,exist_ok=True)
report={'setup':'Python 3, Node.js and canonical JSON tables. Build generated dashboard views, decode with the real browser decoder and compare every reconstructed table, including nulls and optional fields.','command':'python3 dashboard/scripts/verify_loading_views.py','expected':'Exactly one compressed file per competition; table contents match raw data for every retained partition; content hashes and compact manifest references are correct. Unchanged input builds reuse byte-identical output.','status':'failed'}
try:
 subprocess.run([sys.executable,str(ROOT/'dashboard/scripts/build_dashboard_views.py')],cwd=ROOT,check=True)
 program="""import fs from 'node:fs';import zlib from 'node:zlib';import assert from 'node:assert/strict';import {decodeTables} from './dashboard/frontend/src/packed_data.js';
const raw=JSON.parse(fs.readFileSync('data/raw/index.json'));const serving=JSON.parse(fs.readFileSync('data/computed/dashboard/index.json'));let partitions=0,rows=0;
for(const season of serving.seasons)for(const chunk of season.chunks){const packed=JSON.parse(zlib.gunzipSync(fs.readFileSync('data/'+chunk.path)));const tables=decodeTables(packed);const original=raw.seasons.find(x=>x.id===season.id).chunks.find(x=>x.leagueId===chunk.leagueId);for(const [name,ref] of Object.entries(original.tables)){const expected=JSON.parse(zlib.gunzipSync(fs.readFileSync('data/'+ref.path)));assert.deepStrictEqual(tables[name],expected,chunk.path+':'+name);rows+=expected.length;}assert.deepStrictEqual(packed.meta,original.meta);assert.deepStrictEqual(packed.metrics,original.metrics);partitions++;}console.log(JSON.stringify({partitions,rows}));"""
 p=subprocess.run(['node','--input-type=module','-e',program],cwd=ROOT,capture_output=True,text=True);assert p.returncode==0,p.stderr
 first={str(x):hashlib.sha256(x.read_bytes()).hexdigest() for x in (ROOT/'data/computed/dashboard').rglob('*') if x.is_file()}
 subprocess.run([sys.executable,str(ROOT/'dashboard/scripts/build_dashboard_views.py')],cwd=ROOT,check=True)
 assert all(hashlib.sha256(Path(p).read_bytes()).hexdigest()==h for p,h in first.items())
 report.update(status='passed',actual=json.loads(p.stdout),idempotent_files=len(first))
except Exception as exc:report['error']=repr(exc);raise
finally:(OUT/'lossless-views.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
