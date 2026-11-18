"""Aggregate the verified edition rows by canonical competition, without mixing entity types."""
import argparse
import csv
from collections import Counter
from decimal import Decimal
import gzip
import hashlib
import io
import json
from pathlib import Path

def generate(source):
    counts = {}
    editions = {}
    labels = {}
    cols = ('known_participations_minimum', 'expected_algorithm', 'actual_valid', 'missing_from_storage')
    player_cols = ('role_unavailable', 'known_without_stats', 'known_without_measured_minutes')
    with gzip.open(source, 'rt', encoding='utf-8', newline='') as stream:
        rows = list(csv.DictReader(stream))
    assert len(rows) == len({(r['edition_id'], r['entity_type']) for r in rows}) == 6447
    for row in rows:
        key = (int(row['competition_id']), row['entity_type'])
        label = (row['competition'], row['country_code'])
        assert labels.setdefault(key, label) == label
        editions.setdefault(key, set()).add(row['edition_id'])
        stats = counts.setdefault(key, Counter())
        for col in cols + (player_cols if key[1] == 'player' else ()):
            stats[col] += int(row[col])
        assert int(row['expected_algorithm']) == int(row['actual_valid']) + int(row['missing_from_storage'])
    output = io.StringIO(newline='')
    writer = csv.writer(output, lineterminator='\n')
    writer.writerow(('competition_id','competition','country_code','entity_type','editions') + cols + player_cols)
    for key, stats in sorted(counts.items()):
        writer.writerow((key[0], *labels[key], key[1], len(editions[key]), *(stats[c] for c in cols),
                         *(stats[c] if key[1] == 'player' else '' for c in player_cols)))
    missing = {kind:sum(v['missing_from_storage'] for (_,t),v in counts.items() if t==kind)
               for kind in ('player','club','national team')}
    assert len(counts) == 624 and missing == {'player':14418, 'club':20, 'national team':0}
    top = sorted(((v['missing_from_storage'],labels[key][0],key[0]) for key,v in counts.items()
                  if key[1]=='player' and v['missing_from_storage']),reverse=True)
    summary = {'rows':len(counts),'missing_by_type':missing,'player_gaps':top,
               'share_top_3_percent':str(round(Decimal(100)*sum(t[0] for t in top[:3])/missing['player'],2)),
               'source_sha256':hashlib.sha256(source.read_bytes()).hexdigest()}
    return gzip.compress(output.getvalue().encode(),mtime=0),summary

if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('source', type=Path)
    p.add_argument('output', type=Path)
    p.add_argument('summary', type=Path)
    args=p.parse_args()
    data, summary=generate(args.source)
    args.output.write_bytes(data)
    summary['output_sha256']=hashlib.sha256(data).hexdigest()
    args.summary.write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
    print(summary['rows'],summary['missing_by_type'],summary['share_top_3_percent'])
