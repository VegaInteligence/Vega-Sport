#!/usr/bin/env python3
"""End-to-end verification of the JSON database and local HTTP backend."""
import argparse, gzip, hashlib, json, socket, subprocess, tarfile, time, urllib.error, urllib.request
from pathlib import Path
from build_json_database import DATA, ROOT, read, restore_part

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--evidence',default='dashboard/outputs/json-database/evidence.json');args=ap.parse_args()
    evidence={'setup':'Python 3, Node.js, generated data/raw and original data/sources plus data/staging views. No provider network or API credentials.','command':'python3 dashboard/scripts/verify_json_database.py --evidence '+args.evidence,'expected':'Every original partition reassembles exactly, identity references resolve, source files retain their hashes, detailed routes reconstruct representative original documents and profiles.','status':'failed'}
    proc=None;out=ROOT/args.evidence;out.parent.mkdir(parents=True,exist_ok=True)
    try:
        manifest=read(DATA/'raw/index.json');old=read(DATA/'staging/dashboard/football-manifest.json');counts={};parts=0
        for season in manifest['seasons']:
            prior=next(s for s in old['seasons'] if s['id']==season['id'])
            for chunk in season['chunks']:
                p=restore_part(chunk);original=next(c for c in prior['chunks'] if c['leagueId']==chunk['leagueId'])
                assert p==read(DATA/'staging/dashboard'/original['path'])
                matches={m['id'] for m in p['matches']}
                teams={t['id'] for t in p['teams']}
                assert all(a['matchId'] in matches for a in p['appearances'])
                assert all(a.get('teamId') is None or a['teamId'] in teams for a in p['appearances'])
                assert len({a['id'] for a in p['appearances']})==len(p['appearances'])
                for name,ref in chunk['tables'].items():
                    body=(DATA/ref['path']).read_bytes();assert hashlib.sha256(body).hexdigest()==ref['sha256']
                    counts[name]=counts.get(name,0)+ref['rows']
                parts+=1
        # Before-relocation inventories include the old source paths; all bytes remain.
        source_count=0
        before=ROOT/'dashboard/outputs/data-organization/before.json'
        if before.exists():
            for row in read(before):
                p=row['path'].replace('data/pitchapi_bundles','data/sources/pitchapi/bundles').replace('data/open_matchday_2026_2027','data/sources/open_matchday/2026-2027')
                assert hashlib.sha256((ROOT/p).read_bytes()).hexdigest()==row['sha256'];source_count+=1
        # Check a real local backend against source archive objects.
        with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
        log=(out.parent/'backend.log').open('w');proc=subprocess.Popen([str(Path.home()/'.bun/bin/bun'),'dashboard/backend/server.js','--port',str(port)],cwd=ROOT,stdout=log,stderr=log)
        def get(path):return urllib.request.urlopen(f'http://127.0.0.1:{port}'+path,timeout=60).read()
        for _ in range(100):
            try:get('/');break
            except OSError:time.sleep(.05)
        assert json.loads(get('/data/football-manifest.json'))==manifest
        samples=[]
        for archive in sorted((DATA/'sources/pitchapi/bundles').iterdir()):
            info=read(archive/'manifest.json');bundle=next(x for x in info['bundles'] if x['path'].startswith('matches/'))
            with tarfile.open(archive/bundle['path']) as tar:
                member=next(m for m in tar if m.isfile());expected=json.load(tar.extractfile(member));mid=expected['fixture']['id']
            actual=json.loads(get('/api/archive/matches/'+mid));assert actual==expected
            samples.append({'matchId':mid,'archive':archive.name,'endpoints':len(actual['endpoints'])})
        profiles=read(DATA/'raw/profile-index.json')['entities'];key=next(k for k in profiles if k.startswith('players:'));ref=profiles[key][-1]
        expected=read(DATA/ref['path'])[ref['ordinal']]['observation']
        assert json.loads(get('/api/archive/profiles/players/'+key.split(':')[1]))==expected
        supplemental=read(DATA/'raw/supplemental-index.json');supplement=read(DATA/'staging/dashboard/open_matchday.json')
        for item,expected in zip(supplemental['competitions'],supplement['competitions']):
            for kind,ref in item['tables'].items():assert read(DATA/ref['path'])==expected[kind]
        try:get('/data/sources/pitchapi/bundles/europe_2021_2026/manifest.json');raise AssertionError('Sources exposed')
        except urllib.error.HTTPError as exc:assert exc.code==404
        evidence.update(status='passed',actual={'seasons':len(manifest['seasons']),'roundtripped_partitions':parts,'rows':counts,'unchanged_source_files':source_count,'backend_samples':samples,'profile':key,'supplemental_competitions':len(supplemental['competitions'])},logs=['backend.log','checks.log','build.log','import.log'])
    except Exception as exc:evidence['error']=repr(exc);raise
    finally:
        if proc:proc.terminate();proc.wait(timeout=10)
        out.write_text(json.dumps(evidence,indent=2)+'\n')
    print(json.dumps(evidence,indent=2))

if __name__=='__main__':main()
