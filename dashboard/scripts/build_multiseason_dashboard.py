#!/usr/bin/env python3
"""Build small, resumable competition-season snapshots for the dashboard."""
import hashlib
import json
from pathlib import Path
import sys

from build_season_dashboard import ROOT, build, season_label

ARCHIVES = [ROOT / 'data' / 'sources' / 'pitchapi' / 'archives' / 'europe_2026_2027', ROOT / 'data' / 'sources' / 'pitchapi' / 'archives' / 'europe_2021_2026', ROOT / 'data' / 'sources' / 'pitchapi' / 'archives' / 'world_cup_2026']
DASHBOARD = ROOT / 'data' / 'staging' / 'dashboard'
MANIFEST = DASHBOARD / 'football-manifest.json'


def fingerprint(archive, competitions, retrieved_at, builder_digest):
    digest = hashlib.sha256()
    digest.update(builder_digest)
    digest.update(json.dumps({'competitions':competitions, 'retrieved_at':retrieved_at}, sort_keys=True, ensure_ascii=False).encode())
    for competition in competitions:
        directory = archive / 'matches' / competition['id']
        for match in competition['matches']:
            if match.get('status') != 'finished':
                continue
            match_id = match['id']
            safe = directory / f'{match_id}--{match_id.encode().hex()}.json'
            legacy = directory / f'{match_id}.json'
            file = safe if safe.exists() else legacy
            try:
                stat = file.stat()
            except FileNotFoundError:
                continue
            digest.update(f'{match_id}:{stat.st_size}:{stat.st_mtime_ns}\n'.encode())
    return digest.hexdigest()


def main():
    builder_digest = hashlib.sha256((ROOT/'dashboard'/'scripts'/'build_season_dashboard.py').read_bytes() + (ROOT/'dashboard'/'scripts'/'build_dashboard_data.py').read_bytes()).digest()
    try:
        previous = json.loads(MANIFEST.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        previous = {}
    cached = {item['path']:item for season in previous.get('seasons', []) for item in season.get('chunks', [])}
    groups, archive_retrieved = {}, {}
    for archive in ARCHIVES:
        if not (archive / 'inventory.json').is_file():
            continue
        inventory = json.loads((archive / 'inventory.json').read_text(encoding='utf-8'))
        archive_retrieved[archive] = inventory['retrieved_at_utc']
        for competition in inventory['competitions']:
            label = season_label(competition['season'])
            year = int(label[:4]) if len(label) >= 4 and label[:4].isdigit() else 0
            if 2024 <= year:
                groups.setdefault((label, archive, competition['id']), []).append(competition)
    # A competition can be retained in more than one archive. Build it once,
    # from the most recently retrieved inventory, preserving its source season.
    selected = {}
    for key in groups:
        label, archive, league = key
        identity = (label, league)
        current = selected.get(identity)
        if current is None or archive_retrieved[archive] > archive_retrieved[current[1]]:
            selected[identity] = key
    groups = {key: groups[key] for key in selected.values()}
    seasons = {}
    all_issues = []
    for (label, archive, league_id), competitions in sorted(groups.items(), key=lambda entry:(entry[0][0],entry[0][2]), reverse=True):
        relative = Path('seasons') / label.replace('/', '-') / f'{league_id}--{league_id.encode().hex()}.json.gz'
        key = relative.as_posix()
        output = DASHBOARD / relative
        retrieved = archive_retrieved[archive]
        stamp = fingerprint(archive, competitions, retrieved, builder_digest)
        old = cached.get(key)
        if old and old.get('fingerprint') == stamp and output.is_file() and output.stat().st_size == old.get('bytes'):
            item = old
        else:
            metadata = {}
            issues = build(output, archive=archive, display_season=label, include_inventory_only=True,
                           write_issues=False, competition_id=league_id, metadata_out=metadata)
            all_issues.extend(issues)
            item = {'path':key, 'leagueId':league_id, 'fingerprint':stamp, **metadata,
                    'sha256':hashlib.sha256(output.read_bytes()).hexdigest(), 'bytes':output.stat().st_size}
            if item['bytes'] >= 100 * 1024 * 1024:
                raise ValueError(f'Competition-season snapshot exceeds GitHub file limit: {key}')
        seasons.setdefault(label, []).append(item)
    manifest = {'schemaVersion':2, 'defaultSeason':max(seasons, default=None),
                'seasons':[{'id':label, 'chunks':chunks,
                            'collectedMatches':sum(c['collectedMatches'] for c in chunks),
                            'expectedFinishedMatches':sum(c['expectedFinishedMatches'] for c in chunks)}
                           for label,chunks in sorted(seasons.items(), reverse=True)]}
    DASHBOARD.mkdir(parents=True, exist_ok=True)
    temporary = MANIFEST.with_suffix('.json.tmp')
    temporary.write_text(json.dumps(manifest, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    temporary.replace(MANIFEST)
    (DASHBOARD / 'multiseason_issues.json').write_text(json.dumps(all_issues, ensure_ascii=False), encoding='utf-8')
    print(f"Multi-season dashboard: {len(manifest['seasons'])} seasons, {sum(len(s['chunks']) for s in manifest['seasons'])} competition snapshots, {len(all_issues)} issues")
    return 1 if all_issues else 0


if __name__ == '__main__':
    sys.exit(main())
