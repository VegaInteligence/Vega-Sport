#!/usr/bin/env python3
"""Record the normalized performance collection coverage the core normalizer omitted.

The frozen normalizer wrote ``ingest.match_coverage`` only for the shots
collection: one row per match present in each partition's ``matches`` table
(the 387 played matches), counting that match's rows. The performance
collection was imported without its coverage, so readers cannot tell "no
performances collected" from "unknown". This writes the same observation for
``normalized_performance``: same matches, same partition document and
observation time as the shots coverage, the count of that match's rows in the
partition ``performances`` table, required to equal the selected SQL
``player_match_stats`` (full_match) rows. Unplayed fixtures get no row: the
source did not collect them.

Default offline; --plan and --readback are read-only; --apply writes one sealed
generation. Values come from the frozen RAM capture; no body is persisted.
"""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys
import time
import uuid

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'dashboard/scripts'))
import orion_pro_source_recovery as base  # noqa: E402

TRANSFORM = 'orion_pro_coverage_recovery_v1'
FEATURE = 'normalized_performance'
CODE_SHA = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
EVIDENCE = ROOT / 'docs/verification/orion-pro-coverage-recovery-20261105'
require, fetch, digest = base.require, base.fetch, base.digest


def observe(conn, parts, binding):
    docs = {d['legacy_object_path']: d for d in fetch(conn, 'SELECT id,legacy_object_path,content_sha256 FROM ingest.source_documents')}
    for path, sha in binding['documentHashes'].items():
        require(path in docs and docs[path]['content_sha256'] == sha, 'Partition document lineage differs: ' + path)
    aliases = {a['public_key']: a for a in fetch(conn, "SELECT a.public_key,a.match_id,m.revision_id FROM ingest.public_aliases a "
                                                       "JOIN football.matches m ON m.id=a.match_id AND m.recorded_to_gen IS NULL AND m.is_canonical "
                                                       "WHERE a.route_kind='match' AND a.recorded_to_gen IS NULL")}
    sql_counts = {r['match_id']: r['n'] for r in fetch(conn, "SELECT match_id,count(*) n FROM football.player_match_stats WHERE recorded_to_gen IS NULL "
                                                             "AND is_canonical AND NOT is_deleted AND period_code='full_match' GROUP BY match_id")}
    shots = {(r['match_id']): r for r in fetch(conn, "SELECT * FROM ingest.match_coverage WHERE feature_code='shots' AND recorded_to_gen IS NULL AND is_canonical")}
    existing = fetch(conn, 'SELECT count(*) n FROM ingest.match_coverage WHERE feature_code=%s', (FEATURE,))[0]['n']
    require(existing == 0, 'Performance coverage already recorded')
    records = {r['document_id']: r for r in fetch(conn, "SELECT * FROM ingest.source_records WHERE locator='/tables/performances'")}
    rows, plan_records = [], []
    for path, part in parts.items():
        document = docs[path]
        counts = Counter(r['matchId'] for r in part['tables']['performances'])
        played = [m['id'] for m in part['tables']['matches']]
        require(set(counts) <= set(played), 'Performances outside the collected matches: ' + path)
        plan_records.append({'path': path, 'documentId': document['id'], 'existingRecord': document['id'] in records})
        for mid in played:
            alias = aliases[mid]
            shot = shots.get(alias['match_id'])
            require(shot is not None, 'Collected match lacks its shots observation: ' + mid)
            require(counts[mid] == sql_counts.get(alias['match_id'], 0), 'Source and SQL performance counts differ: ' + mid)
            rows.append({'mid': mid, 'match_id': alias['match_id'], 'match_revision_id': alias['revision_id'],
                         'count': counts[mid], 'path': path, 'template': shot})
    require(len(rows) == len(shots) == 387 and sum(r['count'] for r in rows) == sum(sql_counts.values()), 'Coverage scope differs')
    plan = {'rows': len(rows), 'performances': sum(r['count'] for r in rows), 'empty': sum(r['count'] == 0 for r in rows),
            'records': plan_records, 'coverageSha256': digest(sorted((r['mid'], r['count']) for r in rows))}
    return {'rows': rows, 'records': records, 'docs': docs, 'plan': plan}


def apply(conn, observed, binding):
    g = conn.execute('SELECT ingest.begin_generation(%s,%s,%s,NULL)',
                     ('real-performance-coverage:' + uuid.uuid4().hex, TRANSFORM, base.POLICY)).fetchone()[0]
    record_for = {}
    for path, doc in observed['docs'].items():
        if path not in binding['documentHashes']:
            continue
        existing = observed['records'].get(doc['id'])
        if existing:
            record_for[path] = existing['id']
            continue
        rid = conn.execute("INSERT INTO ingest.source_records(source_id,document_id,locator_kind,locator,ordinal,record_kind,external_key) "
                           "VALUES(1,%s,'json_pointer','/tables/performances',NULL,'normalized_performance_collection',%s) RETURNING id",
                           (doc['id'], path.split('/')[2].replace('-', '/'))).fetchone()[0]
        record_for[path] = rid
    names, generated = base.columns(conn, 'ingest.match_coverage')
    for row in observed['rows']:
        fresh = {c: row['template'][c] for c in names if c not in generated | {'recorded_to_gen'}}
        fresh.update(feature_code=FEATURE, match_revision_id=row['match_revision_id'], source_record_id=record_for[row['path']],
                     observed_row_count=row['count'], coverage_state='available' if row['count'] else 'empty_response',
                     collection_state='present' if row['count'] else 'empty', recorded_from_gen=g, data_revision=1,
                     transform_version=TRANSFORM, transform_code_sha256=CODE_SHA)
        cols = list(fresh)
        conn.execute(f"INSERT INTO ingest.match_coverage ({','.join(chr(34) + c + chr(34) for c in cols)}) VALUES "
                     f"({','.join(['%s'] * len(cols))})", base.adapt(conn, 'ingest.match_coverage', [(c, fresh[c]) for c in cols]))
    editions = fetch(conn, 'SELECT id,revision_id FROM football.competition_seasons WHERE recorded_to_gen IS NULL AND is_canonical AND NOT is_deleted')
    for edition in editions:
        conn.execute('UPDATE ingest.dirty_editions SET generation=%s,competition_season_revision_id=%s,changed_at=CURRENT_TIMESTAMP,reason=%s '
                     'WHERE competition_season_id=%s', (g, edition['revision_id'], 'Recorded normalized performance coverage', edition['id']))
    manifest = {'transform': TRANSFORM, 'codeSha256': CODE_SHA, 'source': binding, 'plan': observed['plan']}
    conn.execute('SET LOCAL statement_timeout = 300000')
    conn.execute("SET LOCAL work_mem = '64MB'")
    started = time.monotonic()
    conn.execute('SELECT ingest.seal_generation(%s,%s)', (g, digest(manifest)))
    seal_ms = round((time.monotonic() - started) * 1000, 3)
    started = time.monotonic()
    conn.commit()
    return {'generation': g, 'sealMs': seal_ms, 'commitMs': round((time.monotonic() - started) * 1000, 3),
            'records': {p: r for p, r in record_for.items()}}


def readback(conn, generation):
    rows = fetch(conn, "SELECT c.match_id,c.observed_row_count,c.collection_state,(SELECT count(*) FROM football.player_match_stats s "
                       "WHERE s.match_id=c.match_id AND s.recorded_to_gen IS NULL AND s.is_canonical AND s.period_code='full_match') actual "
                       "FROM ingest.match_coverage c WHERE c.feature_code=%s AND c.recorded_from_gen=%s AND c.recorded_to_gen IS NULL", (FEATURE, generation))
    require(len(rows) == 387 and all(r['observed_row_count'] == r['actual'] for r in rows), 'Coverage readback differs')
    snap = fetch(conn, 'SELECT status FROM ingest.dataset_snapshots WHERE generation=%s', (generation,))
    require(snap == [{'status': 'sealed'}], 'Coverage generation not sealed')
    return {'generation': generation, 'rows': len(rows), 'performances': sum(r['actual'] for r in rows),
            'present': sum(r['collection_state'] == 'present' for r in rows)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    for name in ('plan', 'apply', 'readback'):
        mode.add_argument('--' + name, action='store_true')
    parser.add_argument('--generation', type=int)
    args = parser.parse_args()
    EVIDENCE.mkdir(exist_ok=True)
    label = 'plan' if args.plan else 'apply' if args.apply else 'readback'
    out = EVIDENCE / (datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + label + '.json')
    report = {'kind': TRANSFORM + '_' + label, 'codeSha256': CODE_SHA, 'rawBodiesPersisted': False}
    started, conn = time.monotonic(), None
    try:
        with base.rds.ingest_auth() as passfile:
            conn = base.rds.rds_connection(passfile, base.RW if args.apply else base.RO)
        if args.readback:
            conn.execute('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
            report['readback'] = readback(conn, args.generation)
            conn.rollback()
            report['status'] = 'verified'
        else:
            parts, binding = base.source_parts()
            report['sourceBinding'] = binding
            conn.execute('BEGIN ISOLATION LEVEL REPEATABLE READ' + (' READ ONLY' if args.plan else ''))
            observed = observe(conn, parts, binding)
            report['plan'] = observed['plan']
            if args.plan:
                conn.rollback()
                report['status'] = 'planned'
            else:
                report['applied'] = apply(conn, observed, binding)
                report['status'] = 'committed'
    except BaseException as error:
        if conn is not None:
            try:
                conn.rollback()
            except Exception:
                pass
        report.update(status='refused', errorType=type(error).__name__, error=str(error)[:3000], sqlstate=getattr(error, 'sqlstate', None))
    finally:
        if conn is not None:
            conn.close()
        report['elapsedSeconds'] = round(time.monotonic() - started, 3)
        out.write_text(json.dumps(report, indent=2, default=str) + '\n')
        print(json.dumps({k: report.get(k) for k in ('status', 'plan', 'applied', 'readback', 'error', 'elapsedSeconds')}, default=str))
    return 0 if report['status'] in {'planned', 'committed', 'verified'} else 1


if __name__ == '__main__':
    raise SystemExit(main())
