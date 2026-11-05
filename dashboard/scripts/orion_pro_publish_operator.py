#!/usr/bin/env python3
"""Admit and publish the recovered real Ligue 1 core on RDS017.

Drives the owned-qualified ``Admission`` (orion_pro_admit_real.py) and
``Publisher`` (orion_pro_publish_real.py) classes unchanged. Only the boundary
differs from their CLI: the target is the adopted 012-017 journal (their CLI pins
012-014), authentication comes from the existing ingest SSM credential, and the
session gives seal/commit the same bounded 300 s / 64 MB import budget.

The envelope is rebuilt from current SQL before each stage. Its per-match proofs
(kickoff, scores, shootout, coordinates, actors, shot IDs, team labels) are
derived independently from the frozen RAM capture and must agree with SQL; the
admission and publisher re-check them. No source body is persisted.

Modes: --plan-admit, --admit, --plan-publish, --publish, --verify.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
from decimal import Decimal
import json
from pathlib import Path
import platform
import subprocess
import sys
import time
from types import SimpleNamespace

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'dashboard/scripts'))
import orion_pro_admit_real as admit  # noqa: E402
import orion_pro_publish_real as publish  # noqa: E402
from orion_pro_publish import MODEL_PATH, METRICS, REPRESENTATION, SCHEME, sha, tagged  # noqa: E402
import orion_pro_source_recovery as recovery  # noqa: E402
import orion_pro_native_transport_real_v4 as rds  # noqa: E402

EVIDENCE = ROOT / 'docs/verification/orion-pro-real-publication-20261105'
TRANSFER = ROOT / 'docs/verification/orion-pro-real-rds-transfer-20261105/transport-real-v4/operations/core-v2'
LEAGUE = 'l_3FJFUl'
OPTIONS = ('-c default_transaction_read_only=off -c statement_timeout=300000 -c lock_timeout=1000 '
           "-c work_mem=64MB -c timezone=UTC -c datestyle=ISO,YMD -c extra_float_digits=3 "
           '-c idle_in_transaction_session_timeout=120000')
RO_OPTIONS = OPTIONS.replace('default_transaction_read_only=off', 'default_transaction_read_only=on')


def require(ok, message):
    if not ok:
        raise admit.Refused('OPERATOR_INPUT', message)


def head_commit(strict=True):
    commit = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
    for path in ('dashboard/scripts/orion_pro_admit_real.py', 'dashboard/scripts/orion_pro_publish_real.py'):
        blob = subprocess.run(['git', 'show', commit + ':' + path], cwd=ROOT, capture_output=True, check=True).stdout
        require(not strict or sha(blob) == sha((ROOT / path).read_bytes()), 'Working tree differs from the pinned commit: ' + path)
    return commit


def number(value):
    if isinstance(value, Decimal) and value == value.to_integral_value():
        return int(value)
    return value


def rows(conn, sql, params=()):
    cursor = conn.execute(sql, params)
    names = [c.name for c in cursor.description]
    return [dict(zip(names, r)) for r in cursor.fetchall()]


def source_proofs(parts):
    by_match = {}
    for path, part in parts.items():
        shots = {}
        for shot in part['tables']['shots']:
            shots.setdefault(shot['matchId'], []).append(shot)
        for ordinal, fixture in enumerate(part['tables']['fixtures']):
            by_match[fixture['id']] = {'path': path, 'ordinal': ordinal, 'fixture': fixture, 'shots': shots.get(fixture['id'], [])}
    return by_match


def envelope(conn, parts, binding, stage, admission_receipt=None, strict=True):
    """Closed real envelope from current SQL plus independent source proofs."""
    commit = head_commit(strict)
    snapshots = {r['generation']: r for r in rows(conn, "SELECT id,generation,manifest_sha256,source_priority_version "
                                                       "FROM ingest.dataset_snapshots WHERE status='sealed' ORDER BY generation")}
    latest = max(snapshots)
    shape = lambda r: {'snapshotId': r['id'], 'generation': r['generation'], 'manifestSha256': r['manifest_sha256'],
                       'sourcePriorityVersion': r['source_priority_version']}
    readback = json.loads((TRANSFER / 'independent-readback/result.json').read_text())
    transport = json.loads((TRANSFER / 'apply.result.json').read_text())
    source_gen = transport['completedPhases'][0]['generation']
    epoch = readback['businessNativeSha256']
    editions = rows(conn, "SELECT e.id,e.revision_id,e.competition_id,e.season_key FROM football.competition_seasons e "
                          "WHERE e.recorded_to_gen IS NULL AND e.is_canonical AND NOT e.is_deleted ORDER BY e.season_key")
    matches = rows(conn, "SELECT m.id,m.revision_id,m.competition_season_id,m.source_id,m.source_record_id,m.publication_state,"
                         "m.kickoff_at,a.public_key,r.locator,d.content_sha256 FROM football.matches m "
                         "JOIN ingest.public_aliases a ON a.match_id=m.id AND a.route_kind='match' AND a.recorded_to_gen IS NULL "
                         "JOIN ingest.source_records r ON r.id=m.source_record_id JOIN ingest.source_documents d ON d.id=r.document_id "
                         "WHERE m.recorded_to_gen IS NULL AND m.is_canonical AND NOT m.is_deleted ORDER BY m.id")
    require(len(matches) == 612 and all(m['revision_id'] for m in matches), 'Exactly 612 current matches required')
    league = rows(conn, "SELECT public_key,competition_id FROM ingest.public_aliases WHERE route_kind='competition' AND recorded_to_gen IS NULL")
    require([r['public_key'] for r in league] == [LEAGUE], 'Exact league alias required')
    sides = rows(conn, "SELECT t.match_id,t.side,t.team_id,t.source_id,tm.name,a.public_key team_key FROM football.match_teams t "
                       "JOIN football.teams tm ON tm.id=t.team_id JOIN ingest.public_aliases a ON a.team_id=t.team_id "
                       "AND a.route_kind='team' AND a.recorded_to_gen IS NULL "
                       "WHERE t.recorded_to_gen IS NULL AND t.is_canonical AND NOT t.is_deleted")
    coverage = {r['match_id']: r for r in rows(conn, "SELECT * FROM ingest.match_coverage WHERE recorded_to_gen IS NULL "
                                                      "AND is_canonical AND feature_code='shots'")}
    shots_sql = {}
    for r in rows(conn, "SELECT match_id,external_shot_id FROM football.shots WHERE recorded_to_gen IS NULL AND is_canonical AND NOT is_deleted"):
        shots_sql.setdefault(r['match_id'], []).append(str(r['external_shot_id']))
    players = {r['public_key'] for r in rows(conn, "SELECT public_key FROM ingest.public_aliases WHERE route_kind='player' AND recorded_to_gen IS NULL")}
    pk = [c for c in rows(conn, "SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey) "
                                 "WHERE i.indrelid='ingest.match_coverage'::regclass AND i.indisprimary ORDER BY array_position(i.indkey::int2[],a.attnum)")]
    pk = [c['attname'] for c in pk]
    source = source_proofs(parts)
    minimum, cover, labels = {}, {}, []
    for m in matches:
        mid = m['public_key']
        observed = source[mid]
        fixture = observed['fixture']
        require(m['locator'] == f"/tables/fixtures/rows/{observed['ordinal']}" and
                binding['documentHashes'][observed['path']] == m['content_sha256'], 'Fixture witness differs: ' + mid)
        instant = datetime.strptime(fixture['time_utc'], '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc)
        require(m['kickoff_at'] == instant, 'SQL kickoff differs from source: ' + mid)
        xy = [(s.get('x'), s.get('y')) for s in observed['shots']]
        require(all(isinstance(x, (int, Decimal)) and isinstance(y, (int, Decimal)) for x, y in xy), 'Non-numeric source coordinate: ' + mid)
        unresolved = sorted({s['playerId'] for s in observed['shots'] if s['playerId'] not in players})
        present = 'score_home' in fixture and 'score_away' in fixture
        score = {side: {'state': 'absent' if not present else 'null' if fixture['score_' + side] is None else 'number',
                        'sha256': sha(tagged(number(fixture.get('score_' + side))))} for side in ('home', 'away')}
        require(not any(k for k in fixture if 'penalt' in k.lower() or 'shootout' in k.lower()), 'Unmapped shootout field: ' + mid)
        minimum[mid] = {'timeState': 'available', 'kickoffSha256': sha(tagged(instant)),
                        'sourceXyState': 'numeric_units_unqualified' if xy else 'absent', 'sourceFrameState': 'absent',
                        'unresolvedActorIds': unresolved,
                        'finalScoreObservation': {'present': present, 'scope': 'final_without_shootout' if present else None, **score},
                        'shootoutObservation': {'present': False, 'homeSha256': sha(tagged(None)), 'awaySha256': sha(tagged(None))}}
        parent = coverage.get(m['id'])
        source_ids = sorted(str(s['id']) for s in observed['shots'])
        require(source_ids == sorted(shots_sql.get(m['id'], [])), 'Source and SQL shot ID sets differ: ' + mid)
        cover[mid] = {'state': parent['collection_state'] if parent else 'unknown',
                      'matchRevisionId': parent['match_revision_id'] if parent else None,
                      'dataRevision': parent['data_revision'] if parent else None,
                      'key': {k: parent[k] for k in pk} if parent else None, 'shotIds': source_ids}
        for side in ('home', 'away'):
            team = [s for s in sides if s['match_id'] == m['id'] and s['side'] == side]
            require(len(team) == 1, 'Exact match side required: ' + mid)
            team = team[0]
            witness = fixture.get(side + '_team') or {}
            require(witness.get('id') == team['team_key'] and witness.get('name') == team['name'] and team['name'] is not None,
                    'Source team label differs from SQL: ' + mid + ':' + side)
            labels.append({'matchId': m['id'], 'side': side, 'teamId': team['team_id'], 'labelSha256': sha(tagged(team['name'])),
                           'sourceRecordId': m['source_record_id'], 'state': 'string', 'locator': m['locator'],
                           'documentSha256': m['content_sha256']})
    endpoint = {'hostname': rds.old.HOST, 'port': 5432, 'database': 'statarena_prod', 'actor': 'statarena_ingest',
                'sslmode': 'verify-full', 'caSha256': sha(rds.old.CA.read_bytes()), 'serverVersion': 180006}
    body = {'schemaVersion': 1, 'kind': admit.REAL_INPUT_KIND if stage == 'admit' else admit.REAL_PUBLICATION_KIND,
            'dataOrigin': 'existing_aws_saved_observations', 'sourcePolicy': admit.POLICY,
            'modelSha256': sha(MODEL_PATH.read_bytes()), 'representationVersion': REPRESENTATION, 'dependencyScheme': SCHEME,
            'sourceReconciliationSha256': sha((TRANSFER / 'independent-readback/result.json').read_bytes()),
            'sourceFieldMatrixSha256': admit.FIELD_MATRIX_SHA,
            'transport': {'origin': 'real_native_sql_checkpoint',
                          'coreCheckpointSha256': '35dba5b977335c957d39472ca85dbfc6c2ce0074a94a558badbec32f82fb73cc',
                          'sourceNative94Sha256': epoch, 'targetNative94ReadbackSha256': epoch,
                          'sourceNative31Sha256': '5f9175c1526ad2db4426ebe02d3e412e20999c2bd6486aef5d82d082f34255e0',
                          'targetNative31ReadbackSha256': '5f9175c1526ad2db4426ebe02d3e412e20999c2bd6486aef5d82d082f34255e0',
                          'sourceTargetMappingSha256': sha((TRANSFER / 'independent-readback/business-native.json').read_bytes()),
                          'sourceProducerVersion': admit.POLICY, 'sourceProducerSha256': admit.REAL_PRODUCER_SHA,
                          'transportReceiptSha256': sha((TRANSFER / 'apply.result.json').read_bytes())},
            'publisher': {'commit': commit, 'contentSha256': sha((ROOT / 'dashboard/scripts/orion_pro_publish_real.py').read_bytes()),
                          'environmentSha256': sha({'python': platform.python_version(), 'psycopg': __import__('psycopg').__version__,
                                                    'endpoint': endpoint, 'operator': sha(Path(__file__).read_bytes())}),
                          'transformVersion': admit.PUBLISH_TRANSFORM, 'metricsContractVersion': METRICS},
            'admissionProducer': {'commit': commit, 'contentSha256': sha((ROOT / 'dashboard/scripts/orion_pro_admit_real.py').read_bytes()),
                                  'transformVersion': admit.TRANSFORM},
            'admissionReceiptSha256': admission_receipt,
            'dataset': shape(snapshots[latest]), 'catalogue': shape(snapshots[latest]),
            'sourceInput': shape(snapshots[source_gen]), 'sourceInputEpochSha256': epoch,
            'endpoint': endpoint,
            'editions': [{'editionId': e['id'], 'editionRevisionId': e['revision_id'], 'competitionId': e['competition_id'],
                          'publicLeagueId': LEAGUE, 'season': e['season_key'], 'completeUsefulCohort': True,
                          'members': [{'matchId': m['id'], 'matchRevisionId': m['revision_id'], 'publicId': m['public_key'],
                                       'sourceId': m['source_id'], 'sourceRecordId': m['source_record_id'],
                                       'publicationState': m['publication_state']}
                                      for m in matches if m['competition_season_id'] == e['id']]} for e in editions],
            'proofs': {'minimumSource': minimum, 'coverage': cover, 'labels': labels}, 'fullAcceptance': False}
    if stage == 'admit':
        admit.validate_input(body, 'admit', 'rds')
    return body, commit


class Boundary(SimpleNamespace):
    def event(self, *args, **kwargs):
        return None

    def committed_ack(self):
        return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    for name in ('plan-admit', 'admit', 'plan-publish', 'publish', 'verify'):
        group.add_argument('--' + name, action='store_true')
    parser.add_argument('--admission-receipt', type=Path)
    args = parser.parse_args()
    label = next(n for n in ('plan_admit', 'admit', 'plan_publish', 'publish', 'verify') if getattr(args, n))
    EVIDENCE.mkdir(exist_ok=True)
    out = EVIDENCE / (datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + label + '.json')
    started = time.monotonic()
    result, conn = {}, None
    try:
        writes = label in {'admit', 'publish'}
        with rds.ingest_auth() as passfile:
            conn = rds.rds_connection(passfile, OPTIONS if writes else RO_OPTIONS)
        journal = [tuple(r) for r in conn.execute('SELECT version,content_sha256 FROM ingest.schema_migrations ORDER BY version')]
        require(journal == sorted(admit.MIGRATIONS.items()), 'Approved migration journal required')
        model = admit.strict_json(MODEL_PATH.read_bytes())
        if label == 'verify':
            result = {'status': 'verified', 'publications': rows(conn, "SELECT b.id build_id,b.competition_season_id,b.status,"
                "b.representation_version,b.metrics_contract_version,p.published_from_gen,"
                "(SELECT count(*) FROM analytics.match_summary s WHERE s.build_id=b.id) match_rows "
                "FROM analytics.aggregation_builds b JOIN analytics.publication_versions p ON p.build_id=b.id AND p.published_to_gen IS NULL ORDER BY 2"),
                'catalogPublication': rows(conn, 'SELECT catalog_snapshot_id,representation_version FROM analytics.catalog_publication')}
            require(len(result['publications']) == 2 and all(p['status'] == 'ready' and p['match_rows'] == 306 for p in result['publications']),
                    'Two ready publications with 306 match summaries expected')
        else:
            parts, binding = recovery.source_parts()
            stage = 'admit' if label in {'plan_admit', 'admit'} else 'publish'
            receipt_digest = sha(args.admission_receipt.read_bytes()) if args.admission_receipt else None
            body, commit = envelope(conn, parts, binding, stage, receipt_digest, strict=writes)
            if stage == 'publish':
                receipt = json.loads(args.admission_receipt.read_text())
                body['dataset'] = body['catalogue'] = receipt['qualifiedSnapshotPair']['dataset']
            mode = {'plan_admit': 'plan', 'admit': 'apply', 'plan_publish': 'plan', 'publish': 'publish'}[label]
            code = sha((ROOT / 'dashboard/scripts' / ('orion_pro_admit_real.py' if stage == 'admit' else 'orion_pro_publish_real.py')).read_bytes())
            boundary = Boundary(args=SimpleNamespace(mode=mode, admission_receipt=args.admission_receipt), body=body, code_sha=code,
                                commit=commit, connections=1, owned=False, run=EVIDENCE, events=None, control=None)
            operation = (admit.Admission if stage == 'admit' else publish.Publisher)(boundary, conn, model)
            result = operation.run()
            result['operatorStage'] = operation.stage
    except admit.Refused as error:
        result = {'status': 'rejected', 'error': {'code': error.code, 'message': str(error)}}
    except Exception as error:
        result = {'status': 'failed', 'error': {'type': type(error).__name__, 'sqlstate': getattr(error, 'sqlstate', None),
                                                 'message': str(error)[:3000]}}
        context = getattr(getattr(error, 'diag', None), 'context', None)
        if isinstance(context, str):
            result['error']['context'] = context[:6000]
    finally:
        if conn is not None:
            conn.close()
    result['elapsedSeconds'] = round(time.monotonic() - started, 3)
    result.pop('matchProducts', None)  # scores stay in SQL; the receipt keeps digests only
    out.write_text(json.dumps(result, indent=2, sort_keys=True, default=str) + '\n')
    print(json.dumps({'status': result.get('status'), 'receipt': str(out), 'error': result.get('error'),
                      'generation': result.get('generation'), 'publicationGeneration': result.get('publicationGeneration'),
                      'changed': result.get('changedEditionIds'), 'elapsedSeconds': result['elapsedSeconds']}, default=str))
    return 0 if result.get('status') in {'planned', 'admitted', 'published', 'noop', 'verified'} else 1


if __name__ == '__main__':
    raise SystemExit(main())
