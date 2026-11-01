#!/usr/bin/env python3
"""Save the European portion of the open-matchday 2026/27 source snapshot."""
import argparse
import csv
from datetime import datetime, timezone
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / 'data' / 'sources' / 'open_matchday' / '2026-2027'
URL = 'https://github.com/oladeeayo/open-matchday/archive/refs/heads/master.zip'
SOURCE = 'https://github.com/oladeeayo/open-matchday'
EUROPE = set('ALB AND ARM AUT AZE BEL BIH BLR BUL CRO CYP CZE DEN ENG ESP EST FIN FRA FRO GEO GER GIB GRE HUN IRE IRL ISL ISR ITA KAZ KOS LIE LTU LUX LVA MDA MKD MLT MNE NED NIR NOR POL POR ROU RUS SCO SMR SRB SUI SVK SVN SWE TUR UEFA UKR WAL'.split())
CSV_NAME = re.compile(r'^(results|fixtures|goals)_2627\.csv$')
FOLDER = re.compile(r'^[A-Z0-9_]+_[a-z0-9-]+$')


def collect(payload, output=OUTPUT):
    output = Path(output)
    competitions = {}
    with zipfile.ZipFile(io.BytesIO(payload)) as source:
        names = source.namelist()
        summary_name = next(n for n in names if n.endswith('/build_summary.json') and len(PurePosixPath(n).parts) == 2)
        prefix = PurePosixPath(summary_name).parts[0]
        summary = json.loads(source.read(summary_name))
        if summary.get('season') != '2627':
            raise ValueError('The source snapshot is not labelled as season 2026/27.')
        by_folder = {item['folder'].split('/')[-1]: item for item in summary['leagues']}
        for name in names:
            parts = PurePosixPath(name).parts
            if len(parts) != 4 or parts[0] != prefix or parts[1] != 'data':
                continue
            folder, filename = parts[2:]
            match = CSV_NAME.fullmatch(filename)
            if not FOLDER.fullmatch(folder) or folder.split('_', 1)[0] not in EUROPE or not match:
                continue
            body = source.read(name)
            rows = list(csv.DictReader(io.StringIO(body.decode('utf-8-sig'), newline='')))
            dates = [row['date'] for row in rows if row.get('date')]
            directory = output / 'competitions' / folder
            directory.mkdir(parents=True, exist_ok=True)
            (directory / filename).write_bytes(body)
            info = competitions.setdefault(folder, {
                'folder': folder, 'name': by_folder.get(folder, {}).get('league'),
                'country_code': folder.split('_', 1)[0], 'files': {},
            })
            info['files'][match.group(1)] = {
                'path': str(Path('competitions') / folder / filename).replace('\\', '/'),
                'rows': len(rows), 'earliest_date': min(dates, default=None), 'latest_date': max(dates, default=None),
                'sha256': hashlib.sha256(body).hexdigest(),
            }
        output.mkdir(parents=True, exist_ok=True)
        for filename in ('README.md', 'DISCLAIMER.md', 'LEAGUE_INDEX.md', 'DATA_DICTIONARY.md', 'build_summary.json'):
            name = f'{prefix}/{filename}'
            if name in names:
                (output / filename).write_bytes(source.read(name))
    if not competitions:
        raise ValueError('No European 2026/27 source files were found in the snapshot.')
    manifest = {
        'source': SOURCE, 'terms': SOURCE + '/blob/master/DISCLAIMER.md',
        'usage': 'informational, non-commercial use with attribution',
        'retrieved_at_utc': datetime.now(timezone.utc).isoformat(),
        'source_generated_at_utc': summary.get('generated_utc'),
        'source_archive_sha256': hashlib.sha256(payload).hexdigest(),
        'note': 'Source files may overlap PitchAPI and calendar-year seasons can be partial.',
        'competitions': sorted(competitions.values(), key=lambda item: item['folder']),
    }
    temporary = output / 'manifest.json.tmp'
    temporary.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    temporary.replace(output / 'manifest.json')
    totals = {kind: sum(item['files'].get(kind, {}).get('rows', 0) for item in competitions.values()) for kind in ('results', 'fixtures', 'goals')}
    print(f"open-matchday: {len(competitions)} European competitions; {totals['results']} results; {totals['fixtures']} fixtures; {totals['goals']} goal rows")
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--archive', type=Path, help='Use an already downloaded repository ZIP.')
    args = parser.parse_args()
    if args.archive:
        payload = args.archive.read_bytes()
    else:
        request = urllib.request.Request(URL, headers={'User-Agent': 'Football-Ranking season data collector'})
        with urllib.request.urlopen(request, timeout=120) as response:
            payload = response.read()
    collect(payload)
