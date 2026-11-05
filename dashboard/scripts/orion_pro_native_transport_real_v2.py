#!/usr/bin/env python3
"""Explicit native SQL checkpoint transport. Offline unless separately released.

Bounded COPY, ownership and native-row machinery comes from the immutable local
V2 implementation. Its local policy adapter, pair acceptance and control writer
are never invoked. This module owns the distinct origin/policy/receipt contracts.
"""
from __future__ import annotations

import argparse
import ast
import math
from collections import Counter
from datetime import datetime, timezone, date
from decimal import Decimal
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import socket
import stat
import sys
import time

sys.dont_write_bytecode = True
import orion_pro_bulk_stream_v2 as v2
import orion_pro_bulk as v1
import orion_pro_policy as policy

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / 'docs/verification/orion-pro-real-rds-transfer-20261105/transport-real-v2'
BINDINGS = BASE / 'BINDINGS.json'
BINDINGS_SHA = '1a78e36f93b51852be771148f54a3e3c6fcf2813bd1c6028a13d8d2108efbb60'
MODEL = v2.MODEL
VERSION = 'orion_pro_native_transport_real_v2'
PHASE_VERSION = 'orion_pro_native_transport_real_phase_v2'
REAL_ORIGIN = 'real_native_sql_checkpoint'
FIXTURE_ORIGIN = 'owned_source_free_fixture'
FIXTURE_VERSION = 'source_free_native_transport_fixture_v1'
REAL_PRODUCER_VERSION = 'real_source_core_v2_native31'
REAL_PRODUCER_SHA = '4b98a829bc7e32e11a7e66381ffecae6248ce536d17771aa080502374fe844bc'
REAL_MANIFEST_SHA = '654993cac446a9aa81cc2079a6b9fafd6ddef3a3188ff54ea5297b1677f5aaa9'
REAL_CANDIDATE_SHA = '218f378b599cd166f747fbacf6f79148220150fbc2bede4f81bef535eca553bc'
RDS_P1_STATE_SHA = 'e24d2f4864f2a24c639d5556b4012d276b8958f5df3d02e2a80e52a601ae9a32'
HOST = 'statarena-postgres.clcy2iqyajbl.us-east-2.rds.amazonaws.com'
DATABASE = 'statarena_prod'
ACTOR = 'statarena_ingest'
CA = ROOT / 'dashboard/backend/certs/rds-us-east-2.pem'
CONTROL = v2.CONTROL
Refusal, require = v1.Refusal, v1.require
q, rel, digest, canonical, hashed = v1.q, v1.rel, v1.digest, v1.canonical, v1.hashed
OPTIONS = ('-c default_transaction_read_only=on -c statement_timeout=8000 -c lock_timeout=1000 '
           '-c search_path=pg_catalog -c timezone=UTC -c datestyle=ISO,YMD -c intervalstyle=iso_8601 '
           '-c client_encoding=UTF8 -c extra_float_digits=3')
SOURCE_ROLES = {'owner': 'orion_pro_owner', 'writer': 'orion_pro_ingest', 'reader': 'orion_pro_runtime'}
TARGET_ROLES = {'owner': 'statarena_admin', 'writer': ACTOR, 'reader': 'statarena_runtime'}


def read_json(path, maximum=1024 ** 2):
    try:
        p = Path(path)
        info = p.lstat()
        require(stat.S_ISREG(info.st_mode) and info.st_size <= maximum, 'BINDING', 'Regular bounded metadata file required')
        def unique(items):
            out = {}
            for key, value in items:
                require(key not in out, 'BINDING', 'Duplicate JSON key refused')
                out[key] = value
            return out
        return json.loads(p.read_text(), object_pairs_hook=unique,
                          parse_constant=lambda value: (_ for _ in ()).throw(ValueError('Nonfinite JSON')))
    except Refusal:
        raise
    except (OSError, ValueError, TypeError, UnicodeError):
        raise Refusal('BINDING', 'Malformed bounded metadata') from None


def fixed_bindings():
    require(digest(BINDINGS) == BINDINGS_SHA, 'BINDING', 'Immutable dependency binding differs')
    binding = read_json(BINDINGS)
    require(binding['kind'] == 'real_normalizer_receipt_transport_dependencies_v2' and binding['writerVersion'] == VERSION and
            binding['finalProductionCaps'] is False and binding['fullAcceptance'] is False, 'BINDING', 'Unknown binding contract')
    for name, expected in binding['inputs'].items():
        path = ROOT / name
        require(path.is_file() and digest(path) == expected, 'BINDING', 'A frozen transport/model/producer dependency differs')
    old = read_json(ROOT / 'dashboard/backend/schema-policies/orion-pro/guard-review-v2/m18da43-p014-membership-nonnull-v1.json')
    require(old['qualifiedImportPairs'] == [], 'BINDING', 'Historical local import pairs changed')
    return binding


def sha_shape(value):
    return isinstance(value, str) and re.fullmatch('[0-9a-f]{64}', value) is not None


def exact_keys(value, keys, message):
    require(isinstance(value, dict) and set(value) == set(keys), 'BINDING', message)


def validate_pair(pair, accepted, pair_sha, environment, binding):
    exact_keys(pair, ['kind', 'environment', 'writerSha256', 'bindingSha256', 'source', 'target'], 'Unknown pair fields')
    base_keys = ['kind', 'dataOrigin', 'writerSha256', 'bindingsSha256', 'pairSha256', 'modelSha256', 'producerSha256',
                 'producerVersion', 'sourceNativeSha256', 'sourceTables', 'sourceRows', 'sourcePhases',
                 'sourceCheckpointSha256', 'fullAcceptance']
    real = environment == 'rds'
    require(real, 'BINDING', 'This separate adapter accepts only the real RDS pair; metadata fixtures have no live acceptance')
    exact_keys(accepted, [*base_keys, 'realSource' if real else 'fixture'], 'Unknown acceptance fields/origin')
    origin = REAL_ORIGIN if real else FIXTURE_ORIGIN
    require(pair['kind'] == 'explicit_native_sql_transport_real_v2_pair' and pair['environment'] == environment and
            accepted['kind'] == 'native_sql_real_receipt_acceptance_v2' and accepted['dataOrigin'] == origin and
            pair['writerSha256'] == accepted['writerSha256'] == digest(Path(__file__)) and
            pair['bindingSha256'] == accepted['bindingsSha256'] == digest(BINDINGS) and
            accepted['pairSha256'] == pair_sha and accepted['modelSha256'] == digest(MODEL) and
            accepted['fullAcceptance'] is False and sha_shape(accepted['sourceCheckpointSha256']),
            'BINDING', 'Explicit writer/model/origin/pair acceptance differs')
    model = read_json(MODEL, 2 * 1024 ** 2)
    names = {t['qualified_name'] for s in model['schemas'] for t in s['tables'] if t['phase'] != 'models'}
    tables = accepted['sourceTables']
    require(set(tables) == names and len(tables) == 94 and all(set(v) == {'rows', 'sha256'} and
            type(v['rows']) is int and 0 <= v['rows'] <= 500000 and sha_shape(v['sha256']) for v in tables.values()) and
            type(accepted['sourceRows']) is int and accepted['sourceRows'] == sum(v['rows'] for v in tables.values()) <= 2000000 and
            accepted['sourceNativeSha256'] == hashed(tables), 'BINDING', 'Exact bounded native94 source acceptance required')
    phases = accepted['sourcePhases']
    require(isinstance(phases, list) and 0 < len(phases) <= 64 and
            all(isinstance(p, dict) and set(p) == {'phase', 'generation', 'snapshotId', 'runId', 'manifest'} and
                isinstance(p['phase'], str) and 0 < len(p['phase']) <= 128 and sha_shape(p['manifest']) and
                all(type(p[c]) is int and p[c] > 1 for c in ['generation', 'snapshotId']) and
                type(p['runId']) is int and p['runId'] > 0 for p in phases) and
            len({p['phase'] for p in phases}) == len(phases) and len({p['runId'] for p in phases}) == len(phases) and
            [p['generation'] for p in phases] == sorted({p['generation'] for p in phases}), 'BINDING', 'Closed source phase set required')
    if real:
        expected_real = {'normalizerSha256': REAL_PRODUCER_SHA, 'manifestSha256': REAL_MANIFEST_SHA,
                         'candidateSha256': REAL_CANDIDATE_SHA, 'checkpointKind': 'owned_real_typed_sql_checkpoint_v1',
                         'receiptHashKind': 'normalizer_v2_typed_number_preimage',
                         'sourceContractSha256': digest(BASE / 'REAL_SOURCE_CONTRACT.json')}
        require(accepted['realSource'] == expected_real and accepted['producerSha256'] == REAL_PRODUCER_SHA and
                accepted['producerVersion'] == REAL_PRODUCER_VERSION, 'BINDING', 'Frozen real native producer differs')
    else:
        f = accepted['fixture']
        exact_keys(f, ['codeSha256', 'testSha256', 'version', 'shape'], 'Closed fixture descriptor required')
        shape = {'APPEARANCES': 40, 'SCALARS': 1240, 'MATCHES': 4, 'PLAYERS': 40, 'VERSION': FIXTURE_VERSION}
        require(f == {'codeSha256': digest(ROOT / 'tests/orion_pro_bulk_stream_local.py'),
                      'testSha256': digest(ROOT / 'tests/orion_pro_real_rds_transport_local.py'),
                      'version': FIXTURE_VERSION, 'shape': shape} and
                accepted['producerVersion'] == FIXTURE_VERSION and accepted['producerSha256'] == hashed({
                    'fixtureCodeSha256': f['codeSha256'], 'testSha256': f['testSha256'], 'shape': shape}),
                'BINDING', 'Fixture acceptance never authorizes real-source or RDS execution')
    for source in [True, False]:
        descriptor = pair['source' if source else 'target']
        keys = ['kind', 'origin', 'roles', 'endpoint', 'catalogueSha256', 'nativeCatalogueCounts', 'functionProperties',
                'journal', 'journalNativeSha256', 'bootstrapNativeText']
        if real and not source:
            keys.append('rdsP1StateSha256')
        exact_keys(descriptor, keys, 'Closed independent endpoint descriptor required')
        roles = SOURCE_ROLES if source else TARGET_ROLES
        endpoint = descriptor['endpoint']
        exact_keys(endpoint, ['database', 'actor', 'serverVersion', 'postmasterStartedAt', 'tls'], 'Closed endpoint identity required')
        require(descriptor['kind'] == ('typed_native_p1_overlay_v1' if source else 'typed_native_p1_journal_v1') and
                descriptor['origin'] == (origin if source else 'existing_rds_p1' if real else 'owned_local_tls_target') and
                descriptor['roles'] == roles and endpoint['actor'] == roles['reader' if source else 'writer'] and
                endpoint['serverVersion'] == 180006 and endpoint['tls'] is True and
                re.fullmatch('[a-z_][a-z0-9_]{0,62}', endpoint['database']) and
                datetime.fromisoformat(endpoint['postmasterStartedAt']).tzinfo is not None and
                sha_shape(descriptor['catalogueSha256']) and sha_shape(descriptor['journalNativeSha256']) and
                isinstance(descriptor['bootstrapNativeText'], str) and 0 < len(descriptor['bootstrapNativeText'].encode()) <= 1048576 and
                isinstance(descriptor['functionProperties'], list) and len(descriptor['functionProperties']) == 7,
                'BINDING', 'Independent source/target policy origin or identity differs')
        counts = descriptor['nativeCatalogueCounts']
        require(all(counts.get(k) == v for k,v in {'table': 94, 'column': 1709, 'view': 46, 'sequence': 67}.items()),
                'BINDING', 'Closed native table/column/view/sequence catalogue required')
        journal = descriptor['journal']
        versions = ['012', '013'] if source else ['012', '013', '014']
        require(isinstance(journal, list) and [r[0] for r in journal] == versions and
                all(len(r) == 4 and r[1] == binding['inputs']['dashboard/backend/migrations/' + {
                    '012': '012_orion_pro_domain.sql', '013': '013_orion_pro_integrity.sql', '014': '014_orion_pro_membership_nonnull.sql'}[r[0]]] and
                    datetime.fromisoformat(r[2]).tzinfo is not None and isinstance(r[3], str) and r[3] for r in journal),
                'BINDING', 'Endpoint journal/installation clocks differ from its explicit chain')
        if real and not source:
            require(descriptor['rdsP1StateSha256'] == RDS_P1_STATE_SHA and endpoint['database'] == DATABASE,
                    'BINDING', 'Only the independently adopted existing RDS P1 is supported')
    real_contract = read_json(BASE / 'REAL_SOURCE_CONTRACT.json')
    require(accepted['sourceCheckpointSha256'] == real_contract['sourceCheckpointSha256'] and
            accepted['sourceNativeSha256'] == real_contract['sourceNativeSha256'] and
            accepted['sourceRows'] == real_contract['sourceRows'] and accepted['sourcePhases'] == real_contract['sourcePhases'],
            'BINDING', 'Real source checkpoint/native94/phase contract differs')
    require(not (pair['source']['endpoint']['database'] == pair['target']['endpoint']['database'] and not real),
            'BINDING', 'Owned source and target databases must differ')


def catalogue(conn, source):
    roles = SOURCE_ROLES if source else TARGET_ROLES
    actor_sql = ','.join("'" + roles[k] + "'" for k in ['owner', 'writer', 'reader'])
    sql = policy.CATALOGUE_SQL.replace("'policy_owner','policy_ingest','policy_runtime'", actor_sql)
    rows, retained = [], 0
    for row in policy.streamed(conn, sql):
        retained += 512 + 2 * sum(sys.getsizeof(v) for v in row)
        require(len(rows) < 20000 and retained <= 8 * 1024 ** 2, 'SOURCE_BOUND', 'Native catalogue metadata exceeds8MiB')
        rows.append(list(row))
    return {'sha256': hashed(rows), 'counts': dict(Counter(row[0] for row in rows)), 'bytes': v1.container_bytes(rows)}


def journal_native(conn):
    h = hashlib.sha256()
    for (text,) in conn.execute('SELECT ROW(j.*)::text FROM ingest.schema_migrations j ORDER BY version'):
        v1.framed(h, text)
    return h.hexdigest()


def describe_endpoint(conn, *, source, origin):
    """Readonly descriptor preparation; caller supplies its own RO RR transaction."""
    c = catalogue(conn, source)
    database, started, ssl = conn.execute('SELECT current_database(),pg_postmaster_start_time(),'
        '(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid())').fetchone()
    roles = SOURCE_ROLES if source else TARGET_ROLES
    descriptor = {'kind': 'typed_native_p1_overlay_v1' if source else 'typed_native_p1_journal_v1', 'origin': origin,
                  'roles': roles.copy(), 'endpoint': {'database': database, 'actor': roles['reader' if source else 'writer'],
                    'serverVersion': conn.info.server_version, 'postmasterStartedAt': started.isoformat(), 'tls': ssl},
                  'catalogueSha256': c['sha256'], 'nativeCatalogueCounts': c['counts'],
                  'functionProperties': policy.function_properties(conn),
                  'journal': [list(row) for row in conn.execute('SELECT version,content_sha256,applied_at::text,code_commit FROM ingest.schema_migrations ORDER BY version')],
                  'journalNativeSha256': journal_native(conn),
                  'bootstrapNativeText': conn.execute("SELECT ROW(s.*)::text FROM ingest.dataset_snapshots s WHERE transform_version='bootstrap_v1'").fetchone()[0]}
    if origin == 'existing_rds_p1':
        descriptor['rdsP1StateSha256'] = RDS_P1_STATE_SHA
    return descriptor


def owned_marker(path):
    try:
        p = Path(path); info = p.lstat()
        require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and stat.S_IMODE(info.st_mode) == 0o600,
                'OWNED_ENDPOINT', 'Private owned marker required')
        marker = read_json(p, 16384)
        root = Path(marker['ownedRoot']).resolve()
        data = root / 'data'
        lines = (data / 'postmaster.pid').read_text().splitlines()
        cert = Path(marker['certificatePath']).resolve()
        epoch = datetime.fromisoformat(marker['postmasterStartedAt'])
        require(marker['kind'] == 'owned_native_transport_pg18_v1' and root.name.startswith('orion-pro-e2e-') and
                root.stat().st_uid == os.getuid() and stat.S_IMODE(root.stat().st_mode) == 0o700 and p.parent.resolve() == root and
                Path(lines[1]).resolve() == data and int(lines[3]) == marker['port'] and 1024 < marker['port'] < 65536 and
                (data / 'PG_VERSION').read_text().strip() == '18' and epoch.tzinfo is not None and
                cert.is_relative_to(root) and digest(cert) == marker['certificateSha256'],
                'OWNED_ENDPOINT', 'Owned engine/port/epoch/certificate identity differs')
        os.kill(int(lines[0]), 0)
        return marker
    except Refusal:
        raise
    except (OSError, ValueError, TypeError, KeyError, IndexError):
        raise Refusal('OWNED_ENDPOINT', 'Invalid owned SQL checkpoint marker') from None


def validate_release(path, expected_sha, mode, pair_sha, acceptance_sha):
    require(digest(path) == expected_sha, 'RELEASE', 'Exact operation release hash required')
    release = read_json(path, 16384)
    exact_keys(release, ['kind', 'scope', 'mode', 'writerSha256', 'bindingSha256', 'pairSha256', 'acceptanceSha256', 'expiresAt', 'fullAcceptance'],
               'Closed operation release fields required')
    expires = datetime.fromisoformat(release['expiresAt'])
    require(release['kind'] == 'native_transport_operation_release_v1' and release['mode'] == mode and
            release['scope'] == ('typed_real_business_pilot' if mode.endswith('rds') else FIXTURE_ORIGIN) and
            release['writerSha256'] == digest(Path(__file__)) and release['bindingSha256'] == digest(BINDINGS) and
            release['pairSha256'] == pair_sha and release['acceptanceSha256'] == acceptance_sha and
            release['fullAcceptance'] is False and expires.tzinfo is not None and
            datetime.now(timezone.utc) < expires, 'RELEASE', 'Separate exact unexpired operation release required')


def connect(psycopg, marker, descriptor, *, source, real_target=False, passfile=None):
    expected = descriptor['endpoint']
    if real_target:
        guard_path = ROOT / 'docs/verification/orion-pro-policy-rds-20261105/adapter.py'
        spec = importlib.util.spec_from_file_location('native_transport_private_auth_guard', guard_path)
        guard = importlib.util.module_from_spec(spec); spec.loader.exec_module(guard)
        authentication = guard.validated_rds_passfile({'ORION_RDS_PASSFILE': str(passfile)})
        addresses = sorted({v[4][0] for v in socket.getaddrinfo(HOST, 5432, type=socket.SOCK_STREAM)})
        require(addresses, 'ENDPOINT', 'Existing RDS hostname did not resolve')
        kwargs = {'host': HOST, 'hostaddr': addresses[0], 'port': 5432, 'sslrootcert': str(CA), 'passfile': authentication}
    else:
        database = marker['sourceDatabase' if source else 'targetDatabase']
        require(database == expected['database'] and datetime.fromisoformat(marker['postmasterStartedAt']) ==
                datetime.fromisoformat(expected['postmasterStartedAt']), 'OWNED_ENDPOINT', 'Owned database/epoch is not the accepted checkpoint')
        kwargs = {'host': '127.0.0.1', 'hostaddr': '127.0.0.1', 'port': marker['port'],
                  'sslrootcert': marker['certificatePath'], 'password': '', 'passfile': '/dev/null'}
    conn = psycopg.connect(**kwargs, dbname=expected['database'], user=expected['actor'], sslmode='verify-full',
                           connect_timeout=7, autocommit=True, application_name=VERSION, options=OPTIONS)
    try:
        conn.execute('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
        identity = conn.execute("SELECT current_database(),current_user,session_user,pg_postmaster_start_time(),"
            "current_setting('transaction_read_only'),current_setting('transaction_isolation'),"
            "current_setting('statement_timeout'),current_setting('lock_timeout'),"
            "(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid())").fetchone()
        require(conn.info.server_version == 180006 and identity == (expected['database'], expected['actor'], expected['actor'],
                datetime.fromisoformat(expected['postmasterStartedAt']), 'on', 'repeatable read', '8s', '1s', True),
                'ACTOR', 'Exact TLS/RO RR/engine/actor/deadline/epoch identity differs')
        flags = conn.execute('SELECT rolsuper,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=current_user').fetchone()
        members = conn.execute("SELECT count(*) FROM pg_roles WHERE rolname<>current_user AND pg_has_role(current_user,oid,'MEMBER')").fetchone()[0]
        owners = conn.execute("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('ingest','football','analytics') AND c.relowner=current_user::regrole").fetchone()[0]
        can_insert = conn.execute("SELECT has_table_privilege(current_user,'football.players','INSERT')").fetchone()[0]
        require(flags is not None and not any(flags) and members == owners == 0 and can_insert == (not source),
                'ACTOR', 'Only the exact ordinary nonowner source reader / target ingest may connect')
        sequence_rows = list(conn.execute("SELECT s.schemaname||'.'||s.sequencename,s.increment_by,s.cycle,s.cache_size,"
            "has_sequence_privilege(current_user,c.oid,'USAGE'),has_sequence_privilege(current_user,c.oid,'SELECT') "
            "FROM pg_sequences s JOIN pg_namespace n ON n.nspname=s.schemaname JOIN pg_class c ON c.relnamespace=n.oid AND c.relname=s.sequencename "
            "WHERE s.schemaname IN ('ingest','football','analytics') ORDER BY 1 LIMIT 68"))
        require(len(sequence_rows) == 67 and all(r[1:4] == (1, False, 1) and r[5] is False and
            r[4] == (not source and r[0] != 'ingest.commit_generation_seq') for r in sequence_rows),
            'ACTOR', 'Sequence shape/USAGE contract differs; sequence value SELECT is neither used nor required')
        conn.commit()
        return conn
    except BaseException:
        conn.close()
        raise


def new_report():
    return {'kind': VERSION, 'writerSha256': digest(Path(__file__)), 'status': 'offline_plan', 'fullAcceptance': False,
            'connections': 0, 'copyCommands': 0, 'copiedRows': 0, 'copiedScalarRows': 0, 'nextvalCalls': 0,
            'reservations': [], 'copyTables': {}, 'plans': [], 'sourceCopyReadMs': 0, 'copyWriteMs': 0,
            'sourceReopenMs': [], 'sourcePrefixOracleMs': [], 'targetOracleMs': [], 'sealMs': [], 'commitMs': [],
            'reusedPhases': 0, 'maxMetadataBytes': 0, 'maxBufferedBytes': 0, 'externalRequests': 0,
            'selfRankWitnesses': [], 'selfCopyWindows': [], 'temporaryTablesCreated': 0,
            'sourceTransactionsClosedBeforeTargetAdmission': 0, 'sequenceValueSelects': 0,
            'nativeCatalogueCounts': {}, 'startedAt': datetime.now(timezone.utc).isoformat()}


_PRODUCER_HASH = None


def producer_hash(value):
    """Execute only the three immutable pure hash functions; no mapper import/I/O."""
    global _PRODUCER_HASH
    if _PRODUCER_HASH is None:
        path = ROOT / 'dashboard/scripts/orion_pro_normalize.py'
        require(digest(path) == REAL_PRODUCER_SHA, 'BINDING', 'Frozen real hash producer differs')
        tree = ast.parse(path.read_text())
        names = {'canonical_decimal', 'normalized', 'hashed'}
        nodes = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in names]
        require({n.name for n in nodes} == names and len(nodes) == 3, 'BINDING', 'Closed producer hash functions missing')
        namespace = {'Decimal': Decimal, 'datetime': datetime, 'date': date, 'math': math,
                     'hashlib': hashlib, 'json': json}
        exec(compile(ast.Module(body=nodes, type_ignores=[]), str(path), 'exec'), namespace)
        _PRODUCER_HASH = namespace['hashed']
    return _PRODUCER_HASH(value)


def same_typed_json(actual, expected):
    if type(actual) is not type(expected):
        return False
    if isinstance(expected, dict):
        return set(actual) == set(expected) and all(same_typed_json(actual[k], v) for k, v in expected.items())
    if isinstance(expected, list):
        return len(actual) == len(expected) and all(same_typed_json(a, e) for a, e in zip(actual, expected))
    return actual == expected


def admit_receipt(run, snapshot, documents, contract):
    """Closed metadata admission; never mutate input values or accept native facts."""
    try:
        phase, binding, report = contract['phase'], contract['binding'], contract['report']
        require(set(run) == {'id','mode','status','transform_version','code_commit','started_at','finished_at',
                             'parameters','counters','checkpoint','error','error_is_sql_null'} and
                set(snapshot) == {'id','generation','status','manifest_sha256','snapshot_key','transform_version',
                                  'source_priority_version','knowledge_cutoff_at','created_at','sealed_at'},
                'SOURCE_RECEIPT', 'Closed source run/snapshot columns required')
        require(type(run['id']) is int and run['id'] == phase['runId'] and
                (run['mode'],run['status'],run['transform_version'],run['code_commit']) ==
                ('rebuild','partial',binding['transform_version'],binding['transform_sha256']) and run['error'] is None and
                run['error_is_sql_null'] is True,
                'SOURCE_RECEIPT', 'Exact source run identity/mode/status/producer/error differs')
        require(same_typed_json(run['parameters'],contract['parameters']) and
                same_typed_json(run['counters'],contract['counters']),
                'SOURCE_RECEIPT', 'Exact source parameters/counters/types differ')
        checkpoint = run['checkpoint']
        require(isinstance(checkpoint,dict) and set(checkpoint) == {'kind','phase','receipt_key','binding','generation',
                                                                  'snapshot_id','report','report_sha256'},
                'SOURCE_RECEIPT', 'Closed source checkpoint fields required')
        require(checkpoint['kind'] == 'orion_pro_phase_receipt_v2' and checkpoint['phase'] == phase['phase'] and
                type(checkpoint['generation']) is type(checkpoint['snapshot_id']) is int and
                checkpoint['generation'] == phase['generation'] and checkpoint['snapshot_id'] == phase['snapshotId'] and
                same_typed_json(checkpoint['binding'],binding) and same_typed_json(checkpoint['report'],report),
                'SOURCE_RECEIPT', 'Exact source binding/report/phase coordinates differ')
        bare = {k:v for k,v in binding.items() if k != 'input_manifest_sha256'}
        require(binding['kind'] == checkpoint['kind'] and binding['phase'] == phase['phase'] and
                binding['transform_sha256'] == REAL_PRODUCER_SHA and binding['transform_version'] == REAL_PRODUCER_VERSION and
                binding['model_sha256'] == digest(MODEL) and binding['input_manifest_sha256'] == producer_hash(bare) and
                checkpoint['report_sha256'] == producer_hash(report),
                'SOURCE_RECEIPT', 'Frozen real numeric-tagged input/report fingerprint differs')
        key = 'real-source-v2:' + phase['phase'] + ':' + binding['input_manifest_sha256']
        sealed = producer_hash({'input_manifest_sha256':binding['input_manifest_sha256'],
                                'report_sha256':checkpoint['report_sha256']})
        require(checkpoint['receipt_key'] == key and type(snapshot['id']) is type(snapshot['generation']) is int and
                (snapshot['id'],snapshot['generation'],snapshot['status'],snapshot['snapshot_key'],snapshot['transform_version'],
                 snapshot['source_priority_version'],snapshot['knowledge_cutoff_at'],snapshot['manifest_sha256']) ==
                (phase['snapshotId'],phase['generation'],'sealed',key,REAL_PRODUCER_VERSION,REAL_PRODUCER_VERSION,None,sealed),
                'SOURCE_RECEIPT', 'Exact source sealed snapshot/priority/cutoff/key differs')
        if 'sealedManifestSha256' in contract:
            require(sealed == contract['sealedManifestSha256'], 'SOURCE_RECEIPT', 'Concrete accepted source manifest differs')
        require(same_typed_json(documents,contract['documents']) and type(binding['source_document_count']) is int and
                len(documents) == binding['source_document_count'] and
                len({tuple(v) for v in documents}) == len(documents) and documents == sorted(documents) and
                producer_hash(documents) == binding['source_document_manifest_sha256'],
                'SOURCE_RECEIPT', 'Exact source snapshot document links/membership differ')
        clocks = []
        for value in [run['started_at'],run['finished_at'],snapshot['created_at'],snapshot['sealed_at']]:
            clock = value if isinstance(value,datetime) else datetime.fromisoformat(value)
            require(clock.tzinfo is not None, 'SOURCE_RECEIPT', 'Aware source transaction clocks required')
            clocks.append(clock)
        require(len(set(clocks)) == 1, 'SOURCE_RECEIPT', 'Four source transaction clocks differ')
        return {'inputManifestSha256':binding['input_manifest_sha256'],'reportSha256':checkpoint['report_sha256'],
                'sealedManifestSha256':sealed,'documentCount':len(documents),'sourceTransactionClock':clocks[0].isoformat()}
    except Refusal:
        raise
    except (KeyError,ValueError,TypeError,AttributeError):
        raise Refusal('SOURCE_RECEIPT', 'Malformed closed real source receipt metadata') from None


class NativeTransport(v2.Stream):
    """New control and endpoint adapter over pinned raw-native transport methods."""
    def check_pair(self):
        validate_pair(self.pair, self.accepted, self.pair_sha, self.pair['environment'], self.binding)

    def receipts(self):
        contract = read_json(BASE / 'REAL_SOURCE_CONTRACT.json')
        snapshots = self.source.execute('SELECT id,generation,status,manifest_sha256,snapshot_key,transform_version,'
            'source_priority_version,knowledge_cutoff_at,created_at,sealed_at FROM ingest.dataset_snapshots '
            'ORDER BY generation LIMIT 3').fetchall()
        names = ['id','generation','status','manifest_sha256','snapshot_key','transform_version',
                 'source_priority_version','knowledge_cutoff_at','created_at','sealed_at']
        require(len(snapshots) == 2 and snapshots[0][0:3] == (1,1,'sealed'),
                'SOURCE_RECEIPT', 'Concrete core source must contain only B0 and one accepted snapshot')
        snapshot = dict(zip(names,snapshots[1]))
        rows = self.source.execute('SELECT id,mode,status,transform_version,code_commit,started_at,finished_at,'
            'parameters::text,counters::text,checkpoint::text,error,error IS NULL,ROW(r.*)::text FROM ingest.import_runs r '
            'WHERE octet_length(ROW(r.*)::text)<=65536 ORDER BY id LIMIT 2').fetchall()
        require(len(rows) == 1, 'SOURCE_RECEIPT', 'Concrete core source needs exactly one bounded run')
        row = rows[0]
        run = dict(zip(['id','mode','status','transform_version','code_commit','started_at','finished_at',
                        'parameters','counters','checkpoint','error','error_is_sql_null'],row[:12]))
        for key in ['parameters','counters','checkpoint']:
            raw = run[key]
            require(isinstance(raw,str) and len(raw.encode()) <= 16384, 'SOURCE_RECEIPT', 'Bounded source control JSON required')
            try:
                run[key] = json.loads(raw,parse_float=Decimal)
            except (ValueError,TypeError):
                raise Refusal('SOURCE_RECEIPT', 'Malformed source control JSON') from None
        documents = [list(v) for v in self.source.execute('SELECT d.legacy_object_path,d.content_sha256 '
            'FROM ingest.dataset_snapshot_documents m JOIN ingest.source_documents d ON d.id=m.document_id '
            'WHERE m.snapshot_id=%s ORDER BY d.legacy_object_path,d.content_sha256 LIMIT 3', (snapshot['id'],))]
        verified = admit_receipt(run,snapshot,documents,contract)
        phase = {'phase':contract['phase']['phase'],'generation':snapshot['generation'],'snapshotId':snapshot['id'],
                 'runId':run['id'],'manifest':snapshot['manifest_sha256']}
        require([phase] == self.accepted['sourcePhases'] == contract['sourcePhases'],
                'SOURCE_RECEIPT', 'Exact accepted real phase set differs')
        self.phases = [phase]
        self.phase_contracts = {snapshot['generation']:(snapshot['source_priority_version'],snapshot['knowledge_cutoff_at'])}
        self.source_runs = {run['id']:snapshot['generation']}
        self.source_run_digest = {run['id']:hashlib.sha256(row[12].encode()).hexdigest()}
        self.report['realSourceReceiptContractSha256'] = digest(BASE / 'REAL_SOURCE_CONTRACT.json')
        self.report['realSourceReceiptAdmission'] = verified
        self.memory(contract,run,snapshot,documents)

    def policies(self):
        for conn, source, code in [(self.source, True, 'SOURCE_POLICY'), (self.target, False, 'TARGET_POLICY')]:
            d = self.pair['source' if source else 'target']
            c = catalogue(conn, source)
            self.memory(c)
            require(c['sha256'] == d['catalogueSha256'] and c['counts'] == d['nativeCatalogueCounts'], code,
                    'Independent native/security catalogue differs from accepted endpoint')
            require(policy.function_properties(conn) == d['functionProperties'], code, 'Native validator properties/OID differ')
            journal = [list(row) for row in conn.execute('SELECT version,content_sha256,applied_at::text,code_commit FROM ingest.schema_migrations ORDER BY version')]
            require(journal == d['journal'] and journal_native(conn) == d['journalNativeSha256'], code,
                    'Independent endpoint journal/clocks differ')
            self.report['nativeCatalogueCounts']['source' if source else 'target'] = c['counts']

    def baseline(self, conn, source):
        # Pure baseline native/seed checks from V2; this method does not load any
        # fixture policy or compare source and target journal timestamps.
        v2.Stream.baseline(self, conn, source)

    def control_binding(self, phase):
        return {'kind': PHASE_VERSION, 'phase': phase['phase'], 'writer_sha256': self.accepted['writerSha256'],
                'model_sha256': digest(MODEL), 'bindings_sha256': digest(BINDINGS), 'pair_sha256': self.pair_sha,
                'data_origin': self.accepted['dataOrigin'], 'source_checkpoint_sha256': self.accepted['sourceCheckpointSha256'],
                'source_native_sha256': self.accepted['sourceNativeSha256'], 'producer_sha256': self.accepted['producerSha256'],
                'source_generation': phase['generation'], 'source_snapshot_id': phase['snapshotId'],
                'source_run_id': phase['runId'], 'source_run_sha256': self.source_run_digest[phase['runId']],
                'source_phase_manifest_sha256': phase['manifest']}

    def parameters(self, phase):
        return {'kind': VERSION, 'pair_sha256': self.pair_sha, 'data_origin': self.accepted['dataOrigin'],
                'source_run_sha256': self.source_run_digest[phase['runId']], 'producer_sha256': self.accepted['producerSha256']}

    def counters(self, copied_rows):
        return {'copied_rows': copied_rows, 'full_acceptance': False,
                'local_only': self.accepted['dataOrigin'] == FIXTURE_ORIGIN}

    def snapshot_key(self, phase):
        return 'native-real-v2:' + self.accepted['sourceNativeSha256'] + ':' + phase['phase']


    def prefix(self):
        """Inspect bounded controls; business91 parity is checked after source RO closes."""
        rows = list(self.target.execute('SELECT id,mode,status,transform_version,code_commit,started_at,finished_at,'
            'parameters::text,counters::text,checkpoint::text,error IS NULL FROM ingest.import_runs ORDER BY id LIMIT 65'))
        require(len(rows) <= 64, 'TARGET_DRIFT', 'Foreign/oversized destination run set')
        by_phase = {}
        for row in rows:
            try:
                require(isinstance(row[9], str) and len(row[9].encode()) <= 16384, 'TARGET_DRIFT', 'Missing/oversized target checkpoint')
                checkpoint = json.loads(row[9], parse_float=Decimal)
                checksum = checkpoint.pop('receipt_sha256')
                require(checksum == hashed(checkpoint), 'TARGET_DRIFT', 'Receipt checksum differs')
                checkpoint['receipt_sha256'] = checksum
                phase = next(p for p in self.phases if p['phase'] == checkpoint['phase'])
                require(set(checkpoint) == set(self.control_binding(phase)) | {
                        'receipt_sha256', 'generation', 'snapshot_id', 'copied_rows', 'transaction_started_at'} and
                        type(checkpoint['copied_rows']) is int and
                        checkpoint['copied_rows'] == self.phase_rows[phase['generation']],
                        'TARGET_DRIFT', 'Checkpoint shape/source-derived row count differs')
                clock = datetime.fromisoformat(checkpoint['transaction_started_at'])
                require(clock.tzinfo is not None, 'TARGET_DRIFT', 'Aware native transaction clock required')
                require(phase['phase'] not in by_phase and
                        row[0] == phase['runId'] and row[1:5] == ('backfill', 'partial', VERSION, self.accepted['writerSha256']) and
                        row[5] is not None and row[6] is not None and row[5] <= row[6] and row[10] is True and
                        all(checkpoint.get(k) == v for k, v in self.control_binding(phase).items()),
                        'TARGET_DRIFT', 'Foreign/different target execution receipt')
                generation, sid = checkpoint['generation'], checkpoint['snapshot_id']
                require(type(generation) is int and type(sid) is int and generation > 1 and sid > 1,
                        'TARGET_DRIFT', 'Malformed destination control IDs')
                snap = self.target.execute('SELECT generation,status,manifest_sha256,transform_version,source_priority_version,'
                    'snapshot_key,knowledge_cutoff_at,created_at,sealed_at FROM ingest.dataset_snapshots WHERE id=%s', (sid,)).fetchone()
                priority, cutoff = self.phase_contracts[phase['generation']]
                require(snap is not None and snap[:7] == (generation, 'sealed', hashed(checkpoint), VERSION, priority,
                        self.snapshot_key(phase), cutoff) and snap[7] is not None and snap[8] is not None and
                        snap[7] == row[5] == row[6] == snap[8] == clock,
                        'TARGET_DRIFT', 'Destination snapshot/control clocks differ')
                parameters = json.loads(row[7], parse_float=Decimal)
                counters = json.loads(row[8], parse_float=Decimal)
                require(parameters == self.parameters(phase) and counters == self.counters(checkpoint['copied_rows']), 'TARGET_DRIFT', 'Technical parameters/counters differ')
                by_phase[phase['phase']] = {'phase': phase['phase'], 'sourceGeneration': phase['generation'],
                    'sourceSnapshotId': phase['snapshotId'], 'generation': generation, 'snapshotId': sid, 'runId': phase['runId']}
            except Refusal:
                raise
            except (KeyError, ValueError, TypeError, StopIteration):
                raise Refusal('TARGET_DRIFT', 'Malformed or foreign destination control receipt') from None
        completed = []
        for phase in self.phases:
            if phase['phase'] not in by_phase:
                break
            item = by_phase[phase['phase']]
            self.maps_g[item['sourceGeneration']] = item['generation']
            self.maps_s[item['sourceSnapshotId']] = item['snapshotId']
            completed.append(item)
        require(len(completed) == len(rows) and
                {r[0] for r in self.target.execute('SELECT id FROM ingest.dataset_snapshots ORDER BY id LIMIT 66')} == {1, *(i['snapshotId'] for i in completed)} and
                len(set(self.maps_g.values())) == len(self.maps_g) and len(set(self.maps_s.values())) == len(self.maps_s) and
                list(self.maps_g.values()) == sorted(self.maps_g.values()) and list(self.maps_s.values()) == sorted(self.maps_s.values()),
                'TARGET_DRIFT', 'Destination is not an exact monotone committed phase prefix')
        self.report['controlContractsVerified'] = 3
        self.memory()
        return completed

    def apply(self, completed, fault):
        self.report['reusedPhases'] = len(completed)
        self.report['completedPhases'] = completed
        if len(completed) == len(self.phases):
            self.report['status'] = 'noop'
            return
        self.target.execute('SET default_transaction_read_only=off')
        reserved = False
        for phase in self.phases[len(completed):]:
            self.source_reopen()
            owners = {0, *(p['sourceGeneration'] for p in completed), phase['generation']}
            started = time.monotonic()
            expected = self.business(self.source, owners=owners)
            self.report['sourcePrefixOracleMs'].append(round((time.monotonic() - started) * 1000, 3))
            # All source acceptance/prefix work above precedes the target BEGIN.
            self.target.execute('BEGIN')
            try:
                transaction_start = self.target.execute('SELECT transaction_timestamp()').fetchone()[0]
                self.report['applicationStarted'] = True
                priority, cutoff = self.phase_contracts[phase['generation']]
                g = self.target.execute('SELECT ingest.begin_generation(%s,%s,%s,%s)',
                    (self.snapshot_key(phase), VERSION, priority, cutoff)).fetchone()[0]
                sid = self.target.execute('SELECT id FROM ingest.dataset_snapshots WHERE generation=%s', (g,)).fetchone()[0]
                self.maps_g[phase['generation']] = g
                self.maps_s[phase['snapshotId']] = sid
                require(len(set(self.maps_g.values())) == len(self.maps_g) and len(set(self.maps_s.values())) == len(self.maps_s),
                        'TARGET_DRIFT', 'Destination allocated a colliding control reference')
                if not reserved:
                    self.reserve()
                    reserved = True
                self.target.execute("INSERT INTO ingest.import_runs(id,mode,status,transform_version,code_commit,parameters) "
                    "OVERRIDING SYSTEM VALUE VALUES(%s,'backfill','running',%s,%s,%s::jsonb)",
                    (phase['runId'], VERSION, self.accepted['writerSha256'], canonical(self.parameters(phase))))
                start_count = self.report['copiedRows']
                for name in self.order:
                    if name in self.matrix['copiedRelations']:
                        self.copy_table(name, phase['generation'], fault)
                # No source reader is held idle during the target oracle or either
                # native admission. No heartbeat or timeout change is used.
                self.source.commit()
                self.report['sourceTransactionsClosedBeforeTargetAdmission'] += 1
                self.verify_business(expected, applying=True)
                require(self.report['copiedRows'] - start_count == self.phase_rows[phase['generation']],
                        'PHASE_ORACLE', 'Actual copied row count differs from accepted source ownership')
                checkpoint = {**self.control_binding(phase), 'generation': g, 'snapshot_id': sid,
                              'copied_rows': self.report['copiedRows'] - start_count,
                              'transaction_started_at': transaction_start.isoformat()}
                checkpoint['receipt_sha256'] = hashed(checkpoint)
                require(len(canonical(checkpoint).encode()) <= 16384, 'SOURCE_BOUND', 'Regenerated technical receipt exceeds16KiB')
                counters = self.counters(checkpoint['copied_rows'])
                self.target.execute("UPDATE ingest.import_runs SET status='partial',finished_at=CURRENT_TIMESTAMP,checkpoint=%s::jsonb,counters=%s::jsonb WHERE id=%s",
                                    (canonical(checkpoint), canonical(counters), phase['runId']))
                if fault == 'before-seal-timeout':
                    self.target.execute('SELECT pg_sleep(8.1)')
                started = time.monotonic()
                self.target.execute('SELECT ingest.seal_generation(%s,%s)', (g, hashed(checkpoint)))
                seal_ms = round((time.monotonic() - started) * 1000, 3)
                self.report['sealMs'].append(seal_ms)
                require(seal_ms < 8000, 'NATIVE_TIMEOUT', 'Native seal exceeded8s')
                started = time.monotonic()
                self.report['commitOutcome'] = 'sent'
                try:
                    self.target.commit()
                except BaseException as error:
                    if not getattr(error, 'sqlstate', None):
                        self.report['commitOutcome'] = 'unknown'
                        raise Refusal('COMMIT_ACK_UNKNOWN', 'Commit outcome unknown; fresh readonly prefix inspection required') from None
                    self.report['commitOutcome'] = 'rejected'
                    raise
                self.report['commitOutcome'] = 'committed' 
                commit_ms = round((time.monotonic() - started) * 1000, 3)
                self.report['commitMs'].append(commit_ms)
                require(commit_ms < 8000, 'NATIVE_TIMEOUT', 'Native deferred commit exceeded8s')
                item = {'phase': phase['phase'], 'sourceGeneration': phase['generation'], 'sourceSnapshotId': phase['snapshotId'],
                        'generation': g, 'snapshotId': sid, 'runId': phase['runId']}
                completed.append(item)
                self.report['completedPhases'] = completed
                if fault == 'after-commit-ack':
                    raise Refusal('COMMIT_ACK_UNKNOWN', 'Commit sent; fresh readonly prefix inspection is required')
                if fault == 'after-core-commit' and phase['phase'] == 'core':
                    raise Refusal('INJECTED_FAILURE', 'Deliberate process exit after committed core')
            except BaseException:
                self.source.rollback()
                self.target.rollback()
                raise
        # Fresh native control inspection verifies regenerated3 separately.
        completed = self.prefix()
        require(len(completed) == len(self.phases), 'TARGET_DRIFT', 'Final target control prefix is incomplete')
        self.report['status'] = 'applied'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group()
    for name in ['preflight-rds', 'apply-rds']:
        modes.add_argument('--' + name, action='store_true')
    modes.add_argument('--check-local-structure', action='store_true')
    parser.add_argument('--receipt', type=Path)
    parser.add_argument('--receipt-sha256')
    parser.add_argument('--source-marker', type=Path)
    parser.add_argument('--pair', type=Path)
    parser.add_argument('--pair-sha256')
    parser.add_argument('--acceptance', type=Path)
    parser.add_argument('--acceptance-sha256')
    parser.add_argument('--release', type=Path)
    parser.add_argument('--release-sha256')
    parser.add_argument('--target-passfile', type=Path)
    parser.add_argument('--fault', choices=sorted(v2.FAULTS))
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    report = new_report()
    source = target = transport = None
    locks = []
    started = time.monotonic()
    code = 0
    try:
        mode = next((name for name in ['preflight-rds', 'apply-rds']
                     if getattr(args, name.replace('-', '_'))), None)
        if args.check_local_structure:
            fixed_bindings()
            require(args.receipt and args.receipt_sha256 and digest(args.receipt) == args.receipt_sha256, 'BINDING', 'Exact local metadata bytes required')
            data = read_json(args.receipt, 65536)
            require(set(data) == {'kind','origin','realProducerExecuted','contract','run','snapshot','documents'} and data['kind'] == 'local_receipt_structure_fixture_v2' and data['origin'] == 'owned_local_receipt_metadata' and data['realProducerExecuted'] is False, 'BINDING', 'Explicit unobserved local structural metadata required')
            admit_receipt(data['run'], data['snapshot'], data['documents'], data['contract'])
            report.update(status='local_structure_only', realSourceAccepted=False, nativeDataVerified=False)
        elif mode is None:
            require(not args.fault, 'BINDING', 'Faults require released owned local apply')
            report['nextStep'] = 'Explicit independent source/target descriptors, native94 acceptance and operation release required'
        else:
            real = mode.endswith('rds')
            applying = mode.startswith('apply')
            require(all([args.source_marker, args.pair, args.pair_sha256, args.acceptance,
                         args.acceptance_sha256, args.release, args.release_sha256]) and
                    (not real or args.target_passfile), 'BINDING', 'Explicit marker/pair/acceptance/release hashes and real private auth required')
            require(not args.fault or (applying and not real), 'BINDING', 'Fault injection is available exclusively to owned local apply')
            require(not any(k.startswith('PG') for k in os.environ), 'ENVIRONMENT', 'Inherited libpq routing/options refused')
            binding = fixed_bindings()
            require(digest(args.pair) == args.pair_sha256 and digest(args.acceptance) == args.acceptance_sha256,
                    'BINDING', 'Exact accepted pair/metadata bytes differ')
            pair, accepted = read_json(args.pair), read_json(args.acceptance)
            validate_pair(pair, accepted, args.pair_sha256, 'rds' if real else 'owned_local_tls', binding)
            validate_release(args.release, args.release_sha256, mode, args.pair_sha256, args.acceptance_sha256)
            marker = owned_marker(args.source_marker)
            report.update(dataOrigin=accepted['dataOrigin'], executionEnvironment=pair['environment'],
                          pilotAdmission=binding['pilotAdmission'], finalProductionCaps=False,
                          sourceCheckpointSha256=accepted['sourceCheckpointSha256'])
            import psycopg
            source = connect(psycopg, marker, pair['source'], source=True)
            report['connections'] += 1
            target = connect(psycopg, marker, pair['target'], source=False, real_target=real, passfile=args.target_passfile)
            report['connections'] += 1
            if applying:
                for conn, sql in [(source, 'SELECT pg_try_advisory_lock(20261104,1)'),
                                  (target, 'SELECT pg_try_advisory_lock(20261104,2)'),
                                  (target, 'SELECT pg_try_advisory_lock(20261104,1)'),
                                  (target, 'SELECT pg_try_advisory_lock(97813003::bigint)')]:
                    require(conn.execute(sql).fetchone()[0], 'LEASE', 'Source generation or target migration/generation/serving lease occupied')
                    locks.append((conn, sql.replace('pg_try_advisory_lock', 'pg_advisory_unlock')))
            report['leasesAcquired'] = len(locks)
            transport = NativeTransport(source, target, pair, accepted, report, args.pair_sha256, binding)
            transport.check_pair()
            transport.policies()
            for conn, is_source in [(source, True), (target, False)]:
                with conn.transaction():
                    transport.baseline(conn, is_source)
            source.execute('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
            transport.inspect_source()
            transport.target_bounds()
            completed = transport.prefix()
            expected = transport.business(source, owners={0, *(p['sourceGeneration'] for p in completed)})
            source.commit()
            with target.transaction():
                transport.verify_business(expected)
            report['status'] = 'preflight'
            report['activeFault'] = args.fault
            if applying:
                transport.apply(completed, args.fault)
    except BaseException as error:
        code = 1
        sqlstate = getattr(error, 'sqlstate', None)
        reason = getattr(error, 'code', None)
        if reason is None:
            reason = ('NATIVE_TIMEOUT' if sqlstate in {'57014', '25P03', '55P03'} else 'NATIVE_FK' if sqlstate == '23503'
                      else 'NATIVE_REJECTION' if sqlstate else 'BINDING' if report['connections'] == 0 else 'TRANSPORT_FAILURE')
        report.update(status='refused', reasonCode=reason, sqlstate=sqlstate,
                      error=str(error) if isinstance(error, Refusal) else type(error).__name__)
    finally:
        if transport is not None:
            report['generationMap'] = transport.maps_g
            report['snapshotMap'] = transport.maps_s
        for conn in [source, target]:
            if conn is not None:
                try:
                    conn.rollback()
                    for owner, sql in reversed(locks):
                        if owner is conn:
                            conn.execute(sql)
                except Exception:
                    pass
                conn.close()
        report['connectionsClosed'] = all(c is None or c.closed for c in [source, target])
        report['elapsedMs'] = round((time.monotonic() - started) * 1000, 3)
        report['finishedAt'] = datetime.now(timezone.utc).isoformat()
        text = json.dumps(report, indent=2, ensure_ascii=False, default=str) + '\n'
        require(len(text.encode()) <= 4 * 1024 ** 2, 'SOURCE_BOUND', 'Evidence report exceeds4MiB')
        if args.report:
            args.report.write_text(text)
        print(text)
    return code


if __name__ == '__main__':
    raise SystemExit(main())

