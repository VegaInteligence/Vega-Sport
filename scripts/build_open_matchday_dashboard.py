#!/usr/bin/env python3
"""Prepare a separate dashboard view of the open-matchday CSV archive."""
import csv
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ARCHIVE = ROOT / 'data' / 'open_matchday_2026_2027'
OUTPUT = ROOT / 'dashboard' / 'data' / 'open_matchday.json'


def build(archive=ARCHIVE, output=OUTPUT):
    archive, output = Path(archive), Path(output)
    manifest = json.loads((archive / 'manifest.json').read_text(encoding='utf-8'))
    competitions = []
    for info in manifest['competitions']:
        item = {key: info[key] for key in ('folder', 'name', 'country_code')}
        for kind in ('results', 'fixtures', 'goals'):
            file = info['files'].get(kind)
            if not file:
                item[kind] = []
                continue
            with (archive / file['path']).open(encoding='utf-8-sig', newline='') as stream:
                item[kind] = list(csv.DictReader(stream))
        competitions.append(item)
    result = {'meta': {key: manifest[key] for key in ('source', 'terms', 'usage', 'retrieved_at_utc', 'source_generated_at_utc')},
              'competitions': competitions}
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_name(f'{output.name}.{os.getpid()}.tmp')
    temporary.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    temporary.replace(output)
    print(f"open-matchday dashboard: {len(competitions)} competitions")


if __name__ == '__main__':
    build()
