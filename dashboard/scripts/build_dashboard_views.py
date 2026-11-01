#!/usr/bin/env python3
"""Build lossless, compact serving views from the canonical JSON tables."""
import argparse, hashlib, json
from pathlib import Path
import build_json_database as db


def pack_table(rows):
    keys = list(dict.fromkeys(key for row in rows for key in row))
    values = [[row.get(key) for key in keys] for row in rows]
    missing = {str(i): [j for j, key in enumerate(keys) if key not in row]
               for i, row in enumerate(rows) if len(row) != len(keys)}
    dictionaries = {}
    for j, key in enumerate(keys):
        column = [row[j] for row in values if row[j] is not None]
        if not column or not all(isinstance(value, str) for value in column):
            continue
        unique = list(dict.fromkeys(column))
        if len(unique) * 2 >= len(column):
            continue
        dictionaries[str(j)] = unique
        lookup = {value: i for i, value in enumerate(unique)}
        for row in values:
            if row[j] is not None:
                row[j] = lookup[row[j]]
    return dict(keys=keys, rows=values, dictionaries=dictionaries,
                **({'missing': missing} if missing else {}))


def build_views(data=None):
    if data is not None:
        db.DATA = Path(data)
    source = db.read(db.DATA/'raw/index.json')
    target = db.DATA/'computed/dashboard/index.json'
    previous = db.read(target) if target.is_file() else {'seasons': []}
    cached = {(s['id'], c['leagueId']): c for s in previous['seasons'] for c in s['chunks']}
    manifest = dict(schemaVersion=1, storage='json-packed', defaultSeason=source['defaultSeason'], seasons=[])
    built = reused = raw_bytes = packed_bytes = 0
    for season in source['seasons']:
        out = dict(id=season['id'], chunks=[])
        for chunk in season['chunks']:
            stamp = db.digest(dict(format=1, tables=chunk['tables'], meta=chunk['meta'], metrics=chunk['metrics']))
            old = cached.get((season['id'], chunk['leagueId']))
            raw_bytes += sum((db.DATA/ref['path']).stat().st_size for ref in chunk['tables'].values())
            if old and old.get('sourceDigest') == stamp and (db.DATA/old['path']).is_file():
                out['chunks'].append(old); reused += 1; packed_bytes += old['bytes']; continue
            tables = {}
            for name, ref in chunk['tables'].items():
                file = db.DATA/ref['path']
                if hashlib.sha256(file.read_bytes()).hexdigest() != ref['sha256']:
                    raise ValueError('Canonical checksum mismatch: '+ref['path'])
                tables[name] = db.read(file)
            payload = dict(format='orion-packed-tables-v1', meta=chunk['meta'], metrics=chunk['metrics'],
                           tables={name: pack_table(rows) for name, rows in tables.items()})
            # Content-addressed paths allow safe browser/CDN caching across releases.
            relative = f"computed/dashboard/{season['id'].replace('/', '-')}/{chunk['leagueId']}-{stamp[:24]}.json.gz"
            ref = db.write(relative, payload)
            size = (db.DATA/relative).stat().st_size
            out['chunks'].append(dict(leagueId=chunk['leagueId'], path=relative, sha256=ref['sha256'],
                                     bytes=size, sourceDigest=stamp, competitions=tables['competitions']))
            packed_bytes += size; built += 1
        manifest['seasons'].append(out)
    db.write('computed/dashboard/index.json', manifest)
    # Obsolete versions remain in Git history; the current checkout needs only referenced views.
    live = {c['path'] for s in manifest['seasons'] for c in s['chunks']}
    for file in (db.DATA/'computed/dashboard').glob('*/*.json.gz'):
        if file.relative_to(db.DATA).as_posix() not in live:
            file.unlink()
    result = dict(built=built, reused=reused, canonical_bytes=raw_bytes, serving_bytes=packed_bytes)
    print(json.dumps(result), flush=True)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--data-root', type=Path)
    build_views(parser.parse_args().data_root)
