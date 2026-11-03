#!/usr/bin/env python3
"""Retry a bounded batch of refused checkpoint keys without modifying buckets."""
import argparse
import gzip
import json
import os
import time
from collect_pitchapi_all import PitchClient, load_api_key
from collect_pitchapi_countries import CHECKPOINTS, DATA, compressed, publish


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--limit', type=int, default=10)
    parser.add_argument('--publish', action='store_true')
    args = parser.parse_args()
    if args.limit < 1:
        parser.error('--limit must be positive')
    refused = {}
    for path in sorted(CHECKPOINTS.glob('*.json.gz')):
        for row in json.loads(gzip.decompress(path.read_bytes())):
            if row[4] == 'blocked' and row[5] == 403:
                refused[row[0]] = row
    client = PitchClient(load_api_key(), interval=.2, max_retries=4)
    records = []
    for key, row in sorted(refused.items())[:args.limit]:
        record = client.fetch(row[1], json.loads(row[2]))
        records.append(record)
        print(json.dumps({'endpoint':row[1], 'status':record['status'],
            'recovered':record['ok'], 'error':record.get('error')}, ensure_ascii=False), flush=True)
        if record['status'] == 401:
            break
    if records:
        # A new filename avoids races with the active collector's checkpoint commits.
        archive = DATA / 'raw/pitchapi-world/refusal-retries' / f'{os.environ.get("GITHUB_RUN_ID", "local")}-{time.time_ns()}.json.gz'
        compressed(archive, records)
        if args.publish:
            publish('refusal-retry', False)
    summary = {'targets':len(refused), 'attempted':len(records),
        'recovered':sum(record['ok'] for record in records),
        'remainingRefusals':sum(record['status'] == 403 for record in records)}
    print(json.dumps(summary), flush=True)
    if any(record['status'] == 401 for record in records):
        raise RuntimeError('PitchAPI authentication refused; retry stopped')


if __name__ == '__main__':
    main()
