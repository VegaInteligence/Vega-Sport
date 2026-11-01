#!/usr/bin/env python3
"""Package the complete local PitchAPI archives into recoverable Git-sized files."""
from collections import defaultdict
import argparse
from datetime import datetime, timezone
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import re
import tarfile

ROOT = Path(__file__).resolve().parents[2]
ARCHIVES = ('europe_2026_2027', 'europe_2021_2026', 'world_cup_2026')
OUTPUT = ROOT / 'data' / 'sources' / 'pitchapi' / 'bundles'
LIMIT = 80 * 1024 * 1024


def credential():
    value = os.environ.get('PITCHAPI_API_KEY')
    if value:
        return value.encode()
    try:
        text = (ROOT / '.env').read_text(encoding='utf-8')
    except OSError:
        return None
    match = re.search(r'^\s*PITCHAPI_API_KEY\s*=\s*["\']?([^\s"\']+)', text, re.MULTILINE)
    return match.group(1).encode() if match else None


def safe_id(value, prefix):
    if not re.fullmatch(prefix + r'_[A-Za-z0-9]{6}', value or ''):
        raise ValueError('Unexpected provider identifier')
    return value


def archive_name(identifier):
    return f'{identifier}--{identifier.encode().hex()}'


def fingerprint(files, base):
    digest = hashlib.sha256()
    for file in files:
        stat = file.stat()
        digest.update(f'{file.relative_to(base).as_posix()}:{stat.st_size}:{stat.st_mtime_ns}\n'.encode())
    return digest.hexdigest()


def pack_group(files, base, destination, key):
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(f'{destination.name}.{os.getpid()}.tmp')
    with temporary.open('wb') as raw:
        with gzip.GzipFile(filename='', fileobj=raw, mode='wb', mtime=0) as compressed:
            with tarfile.open(fileobj=compressed, mode='w') as tar:
                for file in files:
                    body = file.read_bytes()
                    if key and key in body:
                        raise ValueError('Credential found in source data; bundle not written')
                    info = tarfile.TarInfo(file.relative_to(base).as_posix())
                    info.size=len(body);info.mtime=0;info.mode=0o644;info.uid=info.gid=0;info.uname=info.gname=''
                    tar.addfile(info, io.BytesIO(body))
    if temporary.stat().st_size >= 100 * 1024 * 1024:
        raise ValueError(f'Bundle exceeds GitHub file limit: {destination.name}')
    temporary.replace(destination)


def pack_archive(archive, output, key=None):
    archive, output = Path(archive), Path(output)
    inventory = json.loads((archive / 'inventory.json').read_text(encoding='utf-8'))
    try:
        collection = json.loads((archive / 'collection.json').read_text(encoding='utf-8'))
    except (OSError, ValueError):
        collection = None
    try:
        previous = json.loads((output / 'manifest.json').read_text(encoding='utf-8'))
    except (OSError, ValueError):
        previous = {}
    cached = {item['path']:item for item in previous.get('bundles', [])}
    groups = defaultdict(list)
    for competition in inventory['competitions']:
        league = safe_id(competition['id'], 'l')
        season = str(competition['season']).replace('/', '-')
        if not re.fullmatch(r'20\d{2}(?:-20\d{2})?', season):
            raise ValueError('Unexpected source season')
        for match in competition['matches']:
            identifier = safe_id(match['id'], 'm')
            kind = 'matches' if match.get('status') == 'finished' else 'fixtures'
            directory = archive / kind / league
            encoded = directory / f'{archive_name(identifier)}.json'
            legacy = directory / f'{identifier}.json'
            file = encoded if encoded.is_file() else legacy
            if file.is_file():
                bucket = hashlib.sha256(identifier.encode()).hexdigest()[0]
                groups[(kind, season, archive_name(league), bucket)].append(file)
    found_profiles={kind:set() for kind in ('leagues','teams','players')}
    for kind, prefix in (('leagues','l'),('teams','t'),('players','p')):
        directory = archive / 'profiles' / kind
        if not directory.is_dir():
            continue
        for file in directory.iterdir():
            if not file.is_file() or not file.name.endswith('.json'):
                continue
            identifier = safe_id(file.name.split('--',1)[0], prefix)
            if file.name != f'{archive_name(identifier)}.json':
                raise ValueError('Profile filename is not case-safe')
            found_profiles[kind].add(identifier)
            bucket = hashlib.sha256(identifier.encode()).hexdigest()[:2]
            groups[('profiles', kind, bucket)].append(file)
    bundles = []
    for group, members in sorted(groups.items()):
        members.sort(key=lambda file:file.relative_to(archive).as_posix())
        parts, part, size = [], [], 0
        for file in members:
            length = file.stat().st_size
            if length >= LIMIT:
                raise ValueError('A source record is too large for the bundle limit')
            if part and size + length > LIMIT:
                parts.append(part);part=[];size=0
            part.append(file);size+=length
        if part:parts.append(part)
        for number, files in enumerate(parts):
            relative = Path(*group[:-1]) / f'{group[-1]}-{number:03d}.tar.gz'
            destination = output / relative
            stamp = fingerprint(files, archive)
            old = cached.get(relative.as_posix())
            if not old or old.get('fingerprint') != stamp or not destination.is_file():
                pack_group(files, archive, destination, key)
                item = {'path':relative.as_posix(), 'fingerprint':stamp, 'files':len(files),
                        'bytes':destination.stat().st_size, 'sha256':hashlib.sha256(destination.read_bytes()).hexdigest()}
            else:
                item = old
            bundles.append(item)
    metadata = []
    for name in ('catalogue.json','inventory.json','index.json','collection.json','dashboard_issues.json'):
        file = archive / name
        if not file.is_file():
            continue
        body = file.read_bytes()
        if key and key in body:
            raise ValueError('Credential found in source metadata; bundle not written')
        destination = output / 'metadata' / f'{name}.gz'
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_name(f'{destination.name}.{os.getpid()}.tmp')
        with temporary.open('wb') as raw:
            with gzip.GzipFile(filename='',fileobj=raw,mode='wb',mtime=0) as stream:
                stream.write(body)
        temporary.replace(destination)
        metadata.append({'path':destination.relative_to(output).as_posix(),'target':name,
                         'bytes':destination.stat().st_size,'sha256':hashlib.sha256(destination.read_bytes()).hexdigest()})
    counts={kind:sum(len(files) for group,files in groups.items() if group[0]==kind) for kind in ('matches','fixtures','profiles')}
    scope_years=collection.get('scope_years') if collection else None
    scoped_counts={kind:sum(len(files) for group,files in groups.items() if group[0]==kind and (not scope_years or group[1][:4] in scope_years)) for kind in ('matches','fixtures')}
    inventory_finished=sum(sum(m.get('status')=='finished' for m in c['matches']) for c in inventory['competitions'])
    inventory_other=sum(sum(m.get('status')!='finished' for m in c['matches']) for c in inventory['competitions'])
    expected_profiles=sum(collection.get('profiles',{}).get(kind,0) for kind in ('leagues','teams','players')) if collection else 0
    profile_ids=collection.get('profile_ids') if collection else None
    profiles_complete=(all(len(set(profile_ids.get(kind,[])))==collection.get('profiles',{}).get(kind,0) and set(profile_ids.get(kind,[])).issubset(found_profiles[kind]) for kind in found_profiles)
                       if isinstance(profile_ids,dict) else counts['profiles']==expected_profiles)
    scope_complete=bool(collection and collection.get('profiles_collected',True) and not collection.get('incomplete') and not collection.get('other_fixtures',{}).get('incomplete') and not collection.get('profiles',{}).get('failed')
                        and scoped_counts['matches']==collection.get('completed') and scoped_counts['fixtures']==collection.get('other_fixtures',{}).get('completed') and profiles_complete)
    complete=bool(scope_complete and counts['matches']==inventory_finished and counts['fixtures']==inventory_other)
    result={'archive':archive.name,'generated_at_utc':datetime.now(timezone.utc).isoformat(),
            'inventory_at_utc':inventory['retrieved_at_utc'],'complete':complete,'scope_complete':scope_complete,'scope_years':scope_years,'file_counts':counts,
            'bundles':bundles,'metadata':metadata}
    if previous and {k:v for k,v in previous.items() if k!='generated_at_utc'} == {k:v for k,v in result.items() if k!='generated_at_utc'}:
        result['generated_at_utc'] = previous.get('generated_at_utc', result['generated_at_utc'])
    output.mkdir(parents=True, exist_ok=True)
    temporary=output / f'manifest.{os.getpid()}.tmp'
    temporary.write_text(json.dumps(result,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    temporary.replace(output / 'manifest.json')
    print(f"{archive.name}: {len(bundles)} bundles, {sum(x['files'] for x in bundles)} source files, {sum(x['bytes'] for x in bundles)} compressed bytes")
    return result


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--history-only',action='store_true')
    args=parser.parse_args()
    key=credential()
    for name in (('europe_2021_2026',) if args.history_only else ARCHIVES):
        archive=ROOT/'data'/'sources'/'pitchapi'/'archives'/name
        if (archive/'inventory.json').is_file():
            pack_archive(archive, OUTPUT/name, key)


if __name__ == '__main__':
    main()
