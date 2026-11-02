#!/usr/bin/env python3
"""Historical catch-up using the daily workflow's secret and publication model."""
import argparse
from collections import deque
import gzip
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import time
from collect_pitchapi_world import Worker, DATA, STATE, BLOBS, identities, read
from collect_pitchapi_all import atomic_json

CHECKPOINTS = DATA / 'raw/pitchapi-world/checkpoints'
PROGRESS = DATA / 'raw/pitchapi-world/countries.json'

def compressed(path, value):
    body = gzip.compress(json.dumps(value, ensure_ascii=False, sort_keys=True,
        separators=(',', ':')).encode(), mtime=0)
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists() or path.read_bytes() != body:
        tmp = path.with_suffix('.tmp'); tmp.write_bytes(body); tmp.replace(path)

def export(db):
    buckets = {}
    for row in db.execute('select url,endpoint,params,priority,state,status,ref,error from jobs where state != "pending" order by url'):
        bucket = hashlib.sha256(row[0].encode()).hexdigest()[:2]
        buckets.setdefault(bucket, []).append(list(row))
    for bucket, rows in buckets.items(): compressed(CHECKPOINTS/(bucket+'.json.gz'), rows)
    return sum(map(len, buckets.values()))

def restore(db):
    for path in sorted(CHECKPOINTS.glob('*.json.gz')):
        rows = json.loads(gzip.decompress(path.read_bytes()))
        db.executemany('insert or ignore into jobs(url,endpoint,params,priority,state,status,ref,error) values(?,?,?,?,?,?,?,?)', rows)
    db.commit()

def decode(ref):
    value = read(ref['path'])
    if 'ordinal' in ref:
        row = value[ref['ordinal']]
        return row.get('observation', row.get('response', {})).get('data')
    return value.get('data') if isinstance(value, dict) else None

def publish(country, complete):
    subprocess.run(['git','add','--','data/raw/pitchapi-world'], check=True)
    if subprocess.run(['git','diff','--cached','--quiet']).returncode == 0: return
    title = f'data: {"finish" if complete else "checkpoint"} PitchAPI collection for {country} [skip ci]'
    subprocess.run(['git','commit','-m',title,'-m',
        '- Save historical match, player and team responses without duplicate request keys\n- Persist JSON checkpoints for country-by-country continuation'], check=True)
    for attempt in range(3):
        subprocess.run(['git','fetch','origin','main'], check=True)
        subprocess.run(['git','rebase','origin/main'], check=True)
        if subprocess.run(['git','push','origin','HEAD:main']).returncode == 0: return
        time.sleep(3)
    raise RuntimeError('Checkpoint push rejected; stop before collecting another country')

class CountryWorker(Worker):
    def __init__(self, minutes, publishing):
        super().__init__()
        restore(self.db)
        self.deadline = time.monotonic() + minutes * 60
        self.publishing = publishing
        self.last_save = time.monotonic()
        self.todo, self.seen = deque(), set()
        self.country = 'catalogue'
        self.countries = json.loads(PROGRESS.read_text()) if PROGRESS.exists() else {}

    def add(self, endpoint, params=None, priority=3):
        params = params or {}
        key = endpoint + '?' + json.dumps(params, sort_keys=True, separators=(',', ':'))
        super().add(endpoint, params, priority)
        if key not in self.seen:
            self.seen.add(key); self.todo.append((key, endpoint, params))

    def discover(self, endpoint, value):
        # The current country's fixture indexes define its match universe.
        # H2H references must not recursively pull other countries into it.
        if endpoint.startswith('/leagues/') and endpoint.endswith('/matches'):
            for match in value.get('matches', []):
                if isinstance(match.get('id'),str) and match['id'].startswith('m_'):
                    self.match(match['id'])
        ids = identities(value)
        for identity in sorted(ids):
            kind = {'t':'teams','p':'players'}.get(identity[0])
            if kind: self.add('/'+kind+'/'+identity, priority=4)
        parts = endpoint.strip('/').split('/')
        if len(parts) == 3 and parts[0] == 'matches' and parts[2] in ('players','lineups','shots'):
            for pid in sorted(i for i in ids if i.startswith('p_')):
                for suffix in ('', '/halves', '/shots'):
                    self.add('/matches/'+parts[1]+'/players/'+pid+suffix)
                self.add('/matches/'+parts[1]+'/advanced/players/'+pid)
        if len(parts) == 3 and parts[0] == 'matches' and parts[2] == 'shots':
            for sid in sorted(i for i in ids if i.startswith('s_')):
                self.add('/matches/'+parts[1]+'/shots/'+sid)

    def response(self, key, endpoint, params):
        previous = self.db.execute('select state,status,ref from jobs where url=?', (key,)).fetchone()
        if previous and previous[0] in ('downloaded','reused','unavailable'):
            return decode(json.loads(previous[2])) if previous[1] == 200 else None
        old = self.existing(endpoint, params)
        if old:
            value, ref = old; status, state, error = 200, 'reused', None
        else:
            record = self.client.fetch(endpoint, params)
            status, error, body = record['status'], record.get('error'), record.get('response')
            raw = json.dumps(body, sort_keys=True, ensure_ascii=False, separators=(',',':')).encode()
            digest = hashlib.sha256(raw).hexdigest(); path = BLOBS/(digest+'.json.gz')
            if not path.exists():
                tmp = path.with_suffix('.tmp'); tmp.write_bytes(gzip.compress(raw,mtime=0)); tmp.replace(path)
            ref = {'path':path.relative_to(DATA).as_posix(), 'sha256':digest}
            value = body.get('data') if record['ok'] else None
            state = 'downloaded' if record['ok'] else 'unavailable' if status == 404 else 'blocked' if status == 403 else 'failed'
        self.db.execute('update jobs set state=?,status=?,ref=?,error=? where url=?',
            (state,status,json.dumps(ref),json.dumps(error),key)); self.db.commit()
        if status == 401: raise RuntimeError('PitchAPI authentication refused')
        if state in ('failed','blocked'): self.failures += 1
        return value

    def save(self, complete=False):
        self.db.commit()
        count = export(self.db)
        self.countries[self.country] = {'state':'complete' if complete else 'partial',
            'requestsVisited':self.visited, 'failures':self.failures,
            'updatedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())}
        atomic_json(PROGRESS,self.countries)
        print(json.dumps({'country':self.country, **self.countries[self.country],
            'globalCheckpointRequests':count,'networkRequests':self.client.requests}),flush=True)
        if self.publishing: publish(self.country,complete)
        self.last_save = time.monotonic()

    def run_countries(self, selected=None):
        self.failures, self.visited = 0, 0
        self.add('/leagues',priority=0)
        key,endpoint,params = self.todo.popleft()
        catalog = self.response(key,endpoint,params)
        if not catalog or not isinstance(catalog.get('leagues'),list):
            raise RuntimeError('Catalogue unavailable')
        groups = {}
        for league in catalog['leagues']:
            groups.setdefault(league.get('country_code') or 'INT',[]).append(league)
        for country, leagues in sorted(groups.items()):
            if selected and country != selected: continue
            if self.countries.get(country,{}).get('state') == 'complete': continue
            self.country = country
            self.todo, self.seen = deque(), set()
            self.visited, self.failures = 0, 0
            print('Starting country '+country,flush=True)
            for league in sorted(leagues,key=lambda x:x['id']):
                self.add('/leagues/'+league['id'])
                for season in league.get('seasons',[]):
                    self.add('/leagues/'+league['id']+'/matches',{'season':season,'status':'all'},1)
            while self.todo:
                if time.monotonic() >= self.deadline or shutil.disk_usage(DATA).free < 3*1024**3:
                    self.save(); return False
                key,endpoint,params = self.todo.popleft()
                value = self.response(key,endpoint,params)
                if isinstance(value,(dict,list)): self.discover(endpoint,value)
                self.visited += 1
                if self.visited % 100 == 0:
                    print(f'{country}: {self.visited} requests visited; {len(self.todo)} pending; {self.client.requests} HTTP',flush=True)
                if time.monotonic()-self.last_save > 900: self.save()
            self.save(complete=self.failures == 0)
            if self.failures: return False
        return True

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--export-local',action='store_true')
    parser.add_argument('--minutes',type=float,default=280)
    parser.add_argument('--country')
    parser.add_argument('--publish',action='store_true')
    args = parser.parse_args()
    if args.export_local:
        db=sqlite3.connect(STATE/'queue.sqlite')
        print('Exported completed requests:',export(db)); return
    worker = CountryWorker(args.minutes,args.publish)
    try:
        complete = worker.run_countries(args.country)
    except BaseException:
        if worker.country != 'catalogue': worker.save()
        raise
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'],'a') as stream:
            stream.write('continue='+str(not complete).lower()+'\n')

if __name__ == '__main__': main()
