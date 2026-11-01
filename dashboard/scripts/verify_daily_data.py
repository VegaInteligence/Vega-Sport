#!/usr/bin/env python3
"""Verify published canonical tables without depending on ignored staging files."""
import hashlib, json
from build_json_database import DATA, read, restore_part

index=read(DATA/'raw/index.json');partitions=matches=appearances=0
for season in index['seasons']:
    ids=set()
    for chunk in season['chunks']:
        for ref in chunk['tables'].values():
            body=(DATA/ref['path']).read_bytes()
            assert hashlib.sha256(body).hexdigest()==ref['sha256'],ref['path']
            assert len(read(DATA/ref['path']))==ref['rows'],ref['path']
        part=restore_part(chunk)
        mids={m['id'] for m in part['matches']};teams={t['id'] for t in part['teams']}
        assert len(mids)==len(part['matches']) and not ids.intersection(mids)
        ids.update(mids)
        assert len({a['id'] for a in part['appearances']})==len(part['appearances'])
        assert all(a['matchId'] in mids and (a.get('teamId') is None or a['teamId'] in teams) for a in part['appearances'])
        partitions+=1;matches+=len(mids);appearances+=len(part['appearances'])
receipt=read(DATA/'raw/sync.json');assert receipt['status']=='success'
print(json.dumps({'status':'passed','seasons':len(index['seasons']),'partitions':partitions,'matches':matches,'appearances':appearances,'sync':receipt['completedAt']}))
