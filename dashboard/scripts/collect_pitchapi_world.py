#!/usr/bin/env python3
"""Worldwide, resumable endpoint crawl; existing JSON observations stay in place."""
import fcntl
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import shutil
import time
from functools import lru_cache
from collect_pitchapi_all import ROOT, PitchClient, load_api_key, atomic_json

DATA = ROOT / 'data'
STATE = DATA / 'computed/pitchapi-world'
BLOBS = DATA / 'raw/pitchapi-world/blobs'
ENDPOINTS = {'match':'', 'shots':'/shots', 'momentum':'/momentum',
             'events':'/events', 'players':'/players', 'player_halves':'/players/halves',
             'lineups':'/lineups', 'h2h':'/h2h', 'stats':'/stats',
             'advanced_teams':'/advanced', 'advanced_players':'/advanced/players',
             'pass_networks':'/advanced/network', 'heatmaps':'/heatmaps'}

@lru_cache(maxsize=2)
def read(path):
    p = DATA / path
    return json.loads(gzip.decompress(p.read_bytes()) if p.suffix == '.gz' else p.read_bytes())

def identities(value):
    found = set()
    def walk(v):
        if isinstance(v, str) and re.fullmatch(r'[ltpms]_[A-Za-z0-9]{6}', v):
            found.add(v)
        elif isinstance(v, dict):
            for x in v.values(): walk(x)
        elif isinstance(v, list):
            for x in v: walk(x)
    walk(value)
    return found

class Worker:
    def __init__(self):
        STATE.mkdir(parents=True, exist_ok=True)
        BLOBS.mkdir(parents=True, exist_ok=True)
        self.lock = (STATE / 'worker.lock').open('w')
        fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        self.db = sqlite3.connect(STATE / 'queue.sqlite')
        self.db.execute('pragma journal_mode=WAL')
        self.db.execute('create table if not exists jobs (url text primary key, endpoint text, params text, priority integer, state text default "pending", status integer, ref text, error text)')
        self.db.execute('create index if not exists pending_jobs on jobs(state,priority)')
        self.client = PitchClient(load_api_key(), interval=.2, max_retries=4)
        self.matches = read('raw/match-observations.json')
        self.shards = read('raw/observation-shards.json')
        self.profiles = read('raw/profile-index.json').get('entities', {})
        self.started = time.time()
        self.processed = 0

    def add(self, endpoint, params=None, priority=3):
        params = json.dumps(params or {}, sort_keys=True, separators=(',', ':'))
        self.db.execute('insert or ignore into jobs(url,endpoint,params,priority) values(?,?,?,?)',
                        (endpoint + '?' + params, endpoint, params, priority))

    def match(self, mid):
        for suffix in ENDPOINTS.values(): self.add('/matches/' + mid + suffix)
        self.add('/matches/' + mid + '/heatmaps', {'frame':'home_ltr'})

    def existing(self, endpoint, params):
        if params: return None
        pieces = endpoint.strip('/').split('/')
        if len(pieces) == 2 and pieces[0] in ('leagues','teams','players'):
            versions = self.profiles.get(':'.join(pieces), [])
            for v in sorted(versions, key=lambda x:x.get('retrievedAt') or '', reverse=True):
                row = read(v['path'])[v['ordinal']]['observation']
                if row.get('status') == 200:
                    return row['data'], {'path':v['path'], 'ordinal':v['ordinal']}
        if len(pieces) >= 2 and pieces[0] == 'matches':
            family = next((k for k,v in ENDPOINTS.items() if v == endpoint[len('/matches/'+pieces[1]):]), None)
            if not family: return None
            for version in self.matches.get(pieces[1], []):
                shard = self.shards.get(version.get('shard'), {})
                ref = shard.get('tables', {}).get(family)
                if not ref: continue
                for i, row in enumerate(read(ref['path'])):
                    response = row.get('response', {})
                    if row.get('matchId') == pieces[1] and response.get('status') == 200:
                        return response.get('data'), {'path':ref['path'], 'ordinal':i}
        return None

    def discover(self, endpoint, value):
        if endpoint == '/leagues':
            for league in value.get('leagues', []):
                for season in league.get('seasons', []):
                    self.add('/leagues/'+league['id']+'/matches', {'season':season, 'status':'all'}, 1)
        ids = identities(value)
        for identity in ids:
            kind = {'l':'leagues','t':'teams','p':'players'}.get(identity[0])
            if kind: self.add('/'+kind+'/'+identity, priority=4)
            elif identity.startswith('m_'): self.match(identity)
        parts = endpoint.strip('/').split('/')
        if len(parts) == 3 and parts[0] == 'matches' and parts[2] in ('players','lineups','shots'):
            for pid in sorted(i for i in ids if i.startswith('p_')):
                for suffix in ('', '/halves', '/shots'):
                    self.add('/matches/'+parts[1]+'/players/'+pid+suffix)
                self.add('/matches/'+parts[1]+'/advanced/players/'+pid)
        if len(parts) == 3 and parts[0] == 'matches' and parts[2] == 'shots':
            for sid in sorted(i for i in ids if i.startswith('s_')):
                self.add('/matches/'+parts[1]+'/shots/'+sid)

    def progress(self, state='running'):
        counts = dict(self.db.execute('select state,count(*) from jobs group by state'))
        atomic_json(STATE/'progress.json', {'state':state, 'pid':os.getpid(),
            'updatedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
            'counts':counts, 'networkRequestsThisRun':self.client.requests,
            'elapsedSeconds':round(time.time()-self.started),
            'scope':'worldwide; every catalogue season; all documented resource families',
            'queue':'data/computed/pitchapi-world/queue.sqlite',
            'blobs':'data/raw/pitchapi-world/blobs'})
        print(json.dumps({'state':state, 'counts':counts, 'http':self.client.requests}), flush=True)

    def run(self):
        self.add('/leagues', priority=0)
        self.db.commit()
        try:
            while True:
                if shutil.disk_usage(DATA).free < 3 * 1024**3:
                    self.progress('paused_storage')
                    return
                job = self.db.execute('select url,endpoint,params from jobs where state="pending" order by priority,rowid limit 1').fetchone()
                if not job: break
                key, endpoint, encoded = job
                params = json.loads(encoded)
                old = self.existing(endpoint, params)
                if old:
                    value, ref = old
                    status, state, error = 200, 'reused', None
                else:
                    record = self.client.fetch(endpoint, params)
                    status, error = record['status'], record.get('error')
                    body = record.get('response')
                    # Hash the response body, not timestamps or request metadata.
                    raw = json.dumps(body, sort_keys=True, ensure_ascii=False, separators=(',',':')).encode()
                    digest = hashlib.sha256(raw).hexdigest()
                    path = BLOBS/(digest+'.json.gz')
                    if not path.exists():
                        tmp = path.with_suffix('.tmp')
                        tmp.write_bytes(gzip.compress(raw, mtime=0))
                        tmp.replace(path)
                    ref = {'path':path.relative_to(DATA).as_posix(), 'sha256':digest}
                    value = body.get('data') if record['ok'] else None
                    state = 'downloaded' if record['ok'] else 'unavailable' if status == 404 else 'blocked' if status == 403 else 'failed'
                if isinstance(value, (dict,list)):
                    self.discover(endpoint, value)
                self.db.execute('update jobs set state=?,status=?,ref=?,error=? where url=?',
                    (state,status,json.dumps(ref),json.dumps(error),key))
                self.db.commit()
                self.processed += 1
                if self.processed % 10 == 0 or status == 401: self.progress()
                if status == 401: raise RuntimeError('Authentication refused; collection stopped')
            counts = dict(self.db.execute('select state,count(*) from jobs group by state'))
            self.progress('partial' if counts.get('failed') or counts.get('blocked') else 'complete')
        except BaseException:
            self.progress('interrupted')
            raise

if __name__ == '__main__':
    Worker().run()
