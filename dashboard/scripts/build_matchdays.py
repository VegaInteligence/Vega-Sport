#!/usr/bin/env python3
"""Extract PitchAPI matchday labels from the archived match observations."""
import argparse
import gzip
import json
from collections import defaultdict
from pathlib import Path


def read(path):
    body = Path(path).read_bytes()
    return json.loads(gzip.decompress(body) if str(path).endswith('.gz') else body)


def build_matchdays(data, output=None, labels=None):
    data = Path(data)
    output = Path(output or data)
    index = read(data / 'raw/index.json')
    observations = read(data / 'raw/match-observations.json')
    shards = read(data / 'raw/observation-shards.json')
    wanted = defaultdict(list)
    seasons = {}
    for season in index['seasons']:
        label = season['id']
        if labels is not None and label not in labels:
            continue
        seasons[label] = {}
        for chunk in season['chunks']:
            league = chunk['leagueId']
            seasons[label][league] = {}
            for fixture in read(data / chunk['tables']['fixtures']['path']):
                entry = (observations.get(fixture.get('id')) or [None])[0]
                if entry:
                    wanted[entry['shard']].append((label, league, fixture, entry))

    for shard, items in wanted.items():
        ref = shards.get(shard, {})
        match_ref = ref.get('tables', {}).get('match')
        if not ref.get('document') or not match_ref:
            continue
        documents = read(data / ref['document']['path'])
        rows = {row['documentId']: row for row in read(data / match_ref['path'])}
        for label, league, fixture, entry in items:
            if entry['ordinal'] >= len(documents):
                continue
            document = documents[entry['ordinal']]
            metadata = document.get('metadata', {})
            response = rows.get(document['id'], {}).get('response', {})
            detail = response.get('data') or {}
            # A match ID and its exact archive document are the join keys; do
            # not infer a round from dates, clubs, or neighbouring fixtures.
            if (response.get('status') != 200 or detail.get('id') != fixture.get('id')
                    or detail.get('league', {}).get('id') != league
                    or metadata.get('competition_id') != league
                    or str(detail.get('season')) != str(fixture.get('season'))):
                continue
            name = detail.get('round_name')
            if not isinstance(name, (str, int)) or not str(name).strip():
                continue
            seasons[label][league][fixture['id']] = {
                'name': str(name).strip(),
                'playoff': detail.get('has_playoff') is True,
            }

    counts = {}
    for label, leagues in seasons.items():
        target = output / 'computed/matchdays' / (label.replace('/', '-') + '.json.gz')
        target.parent.mkdir(parents=True, exist_ok=True)
        raw = json.dumps(leagues, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()
        body = gzip.compress(raw, compresslevel=6, mtime=0)
        if not target.exists() or target.read_bytes() != body:
            temp = target.with_suffix('.gz.tmp')
            temp.write_bytes(body)
            temp.replace(target)
        counts[label] = sum(len(matches) for matches in leagues.values())
    return counts


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--data-root', type=Path, required=True)
    parser.add_argument('--output-root', type=Path)
    args = parser.parse_args()
    print(json.dumps(build_matchdays(args.data_root, args.output_root)))
