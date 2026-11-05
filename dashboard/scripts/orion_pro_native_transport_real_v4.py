#!/usr/bin/env python3
"""Transport the frozen real typed core into the approved RDS 012-017 schema.

Offline by default. Differences from v3, and nothing else:

* the target is the adopted 016/017 schema (98 relations), observed by a fresh
  read-only descriptor instead of the retired RDS015 receipt;
* the qualified 016/017 TransportOverlay (coordinate round-trip guards, inverse
  float8 projection, empty new detail tables, default new core fields) wraps the
  frozen v3 source/COPY/prefix methods;
* only the import seal and its deferred COMMIT run under a bounded
  SET LOCAL statement_timeout/work_mem. Every other statement keeps the 8 s /
  1 s session deadlines. The native validator SQL, grants and model are unchanged.

The two failed RDS015 attempts were cancelled by the client-side 8 s limit at
seal after ~800 s of COPY on the t4g.micro (work_mem 4 MB). Those receipts stay
untouched under real-core-operation-v4-p2.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import socket
import sys
import time

sys.dont_write_bytecode = True
import orion_pro_native_transport_real_v3 as v3
import orion_pro_target_overlay as overlay

old = v3.old
ROOT = old.ROOT
TRANSFER = ROOT / 'docs/verification/orion-pro-real-rds-transfer-20261105'
BASE = TRANSFER / 'transport-real-v4'
VERSION = 'orion_pro_native_transport_real_v4'
PHASE_VERSION = 'orion_pro_native_transport_real_phase_v4'
PAIR_KIND = 'explicit_native_sql_transport_real_v4_pair'
ACCEPTANCE_KIND = 'native_sql_real_rds017_acceptance_v4'
DESCRIPTOR_KIND = 'typed_native_rds017_journal_v1'
POLICY_ID = 'approved-native-017-rds-v1'
SEAL_BUDGET_MS = 300_000
COMMIT_BUDGET_MS = 300_000
SEAL_WORK_MEM = '64MB'
PREVIOUS_ACCEPTANCE = TRANSFER / 'real-core-operation-v4-p2/acceptance.json'
PREVIOUS_ACCEPTANCE_SHA = 'f6fb121922d0ef06a789646c57cf3fb0ae9025aec0365761ceb1c28f2ce0c1c4'
ADOPTION_RECEIPT = ROOT / 'docs/verification/orion-pro-target-overlay-20261105/rds-runs/20261105T175742790601Z/result.json'
ADOPTION_STATUS = 'applied_and_independently_verified_017'
Refusal, require = old.Refusal, old.require
digest, hashed, canonical, exact_keys = old.digest, old.hashed, old.canonical, old.exact_keys
checked_json = v3.checked_json
SOURCE_KEYS = ('dataOrigin', 'modelSha256', 'producerSha256', 'producerVersion', 'sourceNativeSha256', 'sourceTables',
               'sourceRows', 'sourcePhases', 'sourceCheckpointSha256', 'realSource')

connect = v3.qualified(old.connect, VERSION=VERSION)
new_report = v3.qualified(old.new_report, VERSION=VERSION, __file__=__file__)


def target_policy():
    """Approved 012-017 chain and the independently verified adoption receipt."""
    receipt = json.loads(ADOPTION_RECEIPT.read_text())
    return {'policyId': POLICY_ID,
            'chain': [[number, sha] for number, _, sha in overlay.CHAIN],
            'approvedModelSha256': overlay.TARGET_SHA,
            'adoptionReceiptSha256': digest(ADOPTION_RECEIPT),
            'adoptionStatus': receipt.get('status')}


def read_target_descriptor(conn):
    """Independent read-only descriptor of the adopted 017 target (caller owns conn)."""
    require(conn.autocommit and conn.info.server_version == 180006, 'TARGET_POLICY', 'Idle autocommit PG18.6 required')
    conn.execute('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    try:
        row = conn.execute("SELECT current_database(),current_user,session_user,pg_postmaster_start_time(),"
                           "current_setting('transaction_read_only'),current_setting('statement_timeout'),"
                           "current_setting('lock_timeout'),(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid())").fetchone()
        require(row[0] == 'statarena_prod' and row[1] == row[2] == old.TARGET_ROLES['writer'] and row[4:] == ('on', '8s', '1s', True),
                'TARGET_POLICY', 'Exact RO TLS ingest identity and deadlines required')
        shape = overlay.catalogue(conn, '017')
        require(list(shape['dimensions'][:3]) == [98, 1829, 447], 'TARGET_POLICY', 'Approved 98/1829/447 target required')
        defaults = overlay.verify_core_defaults(conn)
        cat = old.catalogue(conn, False)
        properties = old.policy.function_properties(conn)
        journal = [list(r) for r in conn.execute('SELECT version,content_sha256,applied_at::text,code_commit '
                                                 'FROM ingest.schema_migrations ORDER BY version LIMIT 8')]
        journal_sha = old.journal_native(conn)
        b0 = conn.execute("SELECT ROW(s.*)::text FROM ingest.dataset_snapshots s WHERE transform_version='bootstrap_v1' "
                          "ORDER BY id LIMIT 2").fetchall()
        require(len(b0) == 1, 'TARGET_DRIFT', 'Exactly one B0 snapshot required')
        others = conn.execute("SELECT count(*) FROM ingest.dataset_snapshots WHERE transform_version<>'bootstrap_v1'").fetchone()[0]
        runs = conn.execute('SELECT count(*) FROM ingest.import_runs').fetchone()[0]
    finally:
        conn.rollback()
    descriptor = {'kind': DESCRIPTOR_KIND, 'origin': 'existing_rds_017', 'roles': old.TARGET_ROLES.copy(),
                  'endpoint': {'database': row[0], 'actor': row[1], 'serverVersion': 180006,
                               'postmasterStartedAt': row[3].isoformat(), 'tls': True},
                  'catalogueSha256': cat['sha256'], 'nativeCatalogueCounts': cat['counts'],
                  'functionProperties': properties, 'journal': journal, 'journalNativeSha256': journal_sha,
                  'bootstrapNativeText': b0[0][0], 'approvedShape': list(shape['dimensions']),
                  'approvedCatalogueSha256': shape['catalogueSha256']}
    return descriptor, {'defaults': defaults, 'committedNonBootstrapSnapshots': others, 'importRuns': runs,
                        'catalogueBytes': cat['bytes']}


def validate_target(descriptor, policy):
    exact_keys(descriptor, ['kind', 'origin', 'roles', 'endpoint', 'catalogueSha256', 'nativeCatalogueCounts',
                            'functionProperties', 'journal', 'journalNativeSha256', 'bootstrapNativeText',
                            'approvedShape', 'approvedCatalogueSha256'], 'Unknown 017 target descriptor fields')
    require(descriptor['kind'] == DESCRIPTOR_KIND and descriptor['roles'] == old.TARGET_ROLES and
            descriptor['endpoint']['database'] == 'statarena_prod' and descriptor['endpoint']['actor'] == old.TARGET_ROLES['writer'] and
            [r[:2] for r in descriptor['journal']] == policy['chain'] and list(descriptor['approvedShape'])[:3] == [98, 1829, 447] and
            policy['adoptionStatus'] == ADOPTION_STATUS, 'TARGET_POLICY', 'Approved RDS017 journal/shape/adoption required')


def validate_pair(pair, accepted, pair_sha, context):
    exact_keys(pair, ['kind', 'environment', 'writerSha256', 'bindingSha256', 'source', 'target'], 'Unknown pair fields')
    exact_keys(accepted, ['kind', 'writerSha256', 'bindingsSha256', 'pairSha256', *SOURCE_KEYS, 'fullAcceptance',
                          'sourceServiceCheckpointSha256', 'targetReadbackSha256', 'targetPolicy'], 'Unknown V4 acceptance fields')
    require(pair['kind'] == PAIR_KIND and pair['environment'] == 'rds' and accepted['kind'] == ACCEPTANCE_KIND and
            accepted['dataOrigin'] == old.REAL_ORIGIN and accepted['fullAcceptance'] is False and
            pair['writerSha256'] == accepted['writerSha256'] == digest(Path(__file__)) and
            pair['bindingSha256'] == accepted['bindingsSha256'] == v3.BINDINGS_SHA and
            accepted['modelSha256'] == digest(old.MODEL), 'BINDING', 'Explicit V4 writer/model/origin differs')
    require(canonical(pair['target']) == canonical(context['target']) and
            canonical(accepted['targetPolicy']) == canonical(context['targetPolicy']),
            'TARGET_POLICY', 'Exact independently observed RDS017 target required')
    previous = checked_json(PREVIOUS_ACCEPTANCE, PREVIOUS_ACCEPTANCE_SHA)
    require(all(canonical(accepted[k]) == canonical(previous[k]) for k in SOURCE_KEYS),
            'SOURCE_RECEIPT', 'Source acceptance must be byte-equal to the reviewed V4 source acceptance')
    # The v3 source validation (frozen descriptor, live epoch, logical checkpoint,
    # producer) is reused unchanged on a source-only projection.
    v3_accepted = {**previous, 'pairSha256': pair_sha, 'writerSha256': v3.digest(Path(v3.__file__)),
                   'sourceServiceCheckpointSha256': accepted['sourceServiceCheckpointSha256'],
                   'targetReadbackSha256': v3.TARGET_READBACK_SHA, 'targetPolicy': context['v3TargetPolicy']}
    v3_pair = {**pair, 'kind': v3.PAIR_KIND, 'writerSha256': v3_accepted['writerSha256'], 'target': context['v3Target']}
    v3.validate_pair(v3_pair, v3_accepted, pair_sha, context['binding'], context['v3'])
    require(accepted['pairSha256'] == pair_sha, 'BINDING', 'Exact pair hash required')


class NativeTransport(overlay.TransportOverlay, v3.NativeTransport):
    prefix = v3.qualified(old.NativeTransport.prefix, VERSION=VERSION)
    control_binding = v3.qualified(old.NativeTransport.control_binding, PHASE_VERSION=PHASE_VERSION, BINDINGS=v3.BINDINGS)
    parameters = v3.qualified(old.NativeTransport.parameters, VERSION=VERSION)

    def check_pair(self):
        validate_pair(self.pair, self.accepted, self.pair_sha, self.admission_context)

    def snapshot_key(self, phase):
        return 'native-real-v4:' + self.accepted['sourceNativeSha256'] + ':' + phase['phase']

    def apply(self, completed, fault):
        """Frozen real_v2 apply; only the seal/COMMIT budget differs (see module doc)."""
        require(fault is None, 'BINDING', 'No fault injection on real RDS')
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
                copy_started = time.monotonic()
                for name in self.order:
                    if name in self.matrix['copiedRelations']:
                        self.copy_table(name, phase['generation'], None)
                self.report['copyPhaseSeconds'] = round(time.monotonic() - copy_started, 3)
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
                # Import-only budget: transaction-scoped, reverts at COMMIT/ROLLBACK.
                self.target.execute(f"SET LOCAL statement_timeout = {SEAL_BUDGET_MS}")
                self.target.execute(f"SET LOCAL work_mem = '{SEAL_WORK_MEM}'")
                self.report['sealSettings'] = list(self.target.execute(
                    "SELECT current_setting('statement_timeout'),current_setting('work_mem'),current_setting('lock_timeout')").fetchone())
                started = time.monotonic()
                self.target.execute('SELECT ingest.seal_generation(%s,%s)', (g, hashed(checkpoint)))
                seal_ms = round((time.monotonic() - started) * 1000, 3)
                self.report['sealMs'].append(seal_ms)
                require(seal_ms < SEAL_BUDGET_MS, 'NATIVE_TIMEOUT', 'Native seal exceeded its import budget')
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
                require(commit_ms < COMMIT_BUDGET_MS, 'NATIVE_TIMEOUT', 'Native deferred commit exceeded its import budget')
                completed.append({'phase': phase['phase'], 'sourceGeneration': phase['generation'],
                                  'sourceSnapshotId': phase['snapshotId'], 'generation': g, 'snapshotId': sid,
                                  'runId': phase['runId']})
                self.report['completedPhases'] = completed
            except BaseException:
                self.source.rollback()
                self.target.rollback()
                raise
        self.target.execute('SET default_transaction_read_only=on')
        completed = self.prefix()
        require(len(completed) == len(self.phases), 'TARGET_DRIFT', 'Final target control prefix is incomplete')
        self.report['status'] = 'applied'


def rds_connection(passfile, options):
    import psycopg
    address = sorted({v[4][0] for v in socket.getaddrinfo(old.HOST, 5432, type=socket.SOCK_STREAM)})[0]
    return psycopg.connect(host=old.HOST, hostaddr=address, port=5432, dbname='statarena_prod', user=old.TARGET_ROLES['writer'],
                           passfile=str(passfile), sslmode='verify-full', sslrootcert=str(old.CA), connect_timeout=7,
                           autocommit=True, application_name=VERSION + '-readback', options=options)


READBACK_OPTIONS = ('-c default_transaction_read_only=on -c statement_timeout=8000 -c lock_timeout=1000 '
                    '-c timezone=UTC -c datestyle=ISO,YMD -c extra_float_digits=3 -c idle_in_transaction_session_timeout=15000')


def ingest_auth():
    import importlib.util
    spec = importlib.util.spec_from_file_location('v4_ingest_actor', TRANSFER / 'ingest_actor.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.private_authentication()


def save(path, value):
    Path(path).write_text(json.dumps(value, indent=2, ensure_ascii=False, default=str) + '\n')


def target_readback(out):
    out = Path(out).resolve()
    require(out.is_relative_to(BASE / 'target-readbacks'), 'BINDING', 'Readback must live under transport-real-v4')
    out.mkdir(parents=True, exist_ok=False)
    started = time.monotonic()
    report = {'kind': 'real_rds017_target_descriptor_readback_v4', 'writes': [], 'connections': 0, 'sourceCalls': 0}
    conn = None
    try:
        with ingest_auth() as passfile:
            conn = rds_connection(passfile, READBACK_OPTIONS)
            report['connections'] = 1
            descriptor, observations = read_target_descriptor(conn)
            policy = target_policy()
            validate_target(descriptor, policy)
            save(out / 'target-descriptor.json', descriptor)
            report.update(status='verified_actual_rds017_target_descriptor', observations=observations, targetPolicy=policy,
                          targetDescriptorSha256=digest(out / 'target-descriptor.json'))
    except BaseException as error:
        report.update(status='fail', errorType=type(error).__name__, error=str(error)[:2000], sqlstate=getattr(error, 'sqlstate', None))
    finally:
        if conn is not None:
            conn.close()
        report['connectionClosed'] = conn is None or conn.closed
        report['elapsedSeconds'] = round(time.monotonic() - started, 3)
        save(out / 'result.json', report)
    print(json.dumps({'status': report['status'], 'evidence': str(out / 'result.json')}))
    return 0 if report['status'].startswith('verified') else 1


def prepare(run, checkpoint_path, descriptor_path):
    """Offline: write pair/acceptance from the current source service and 017 readback."""
    run = Path(run).resolve()
    require(run.is_relative_to(BASE / 'operations'), 'BINDING', 'Operation directory must live under transport-real-v4/operations')
    run.mkdir(parents=True, exist_ok=False)
    checkpoint = json.loads(Path(checkpoint_path).read_text())
    source = json.loads(Path(checkpoint['sourceDescriptor']).read_text())
    target = json.loads(Path(descriptor_path).read_text())
    previous = checked_json(PREVIOUS_ACCEPTANCE, PREVIOUS_ACCEPTANCE_SHA)
    writer = digest(Path(__file__))
    pair = {'kind': PAIR_KIND, 'environment': 'rds', 'writerSha256': writer, 'bindingSha256': v3.BINDINGS_SHA,
            'source': source, 'target': target}
    save(run / 'pair.json', pair)
    accepted = {'kind': ACCEPTANCE_KIND, 'writerSha256': writer, 'bindingsSha256': v3.BINDINGS_SHA,
                'pairSha256': digest(run / 'pair.json'), **{k: previous[k] for k in SOURCE_KEYS}, 'fullAcceptance': False,
                'sourceServiceCheckpointSha256': digest(Path(checkpoint_path)),
                'targetReadbackSha256': digest(Path(descriptor_path)), 'targetPolicy': target_policy()}
    save(run / 'acceptance.json', accepted)
    save(run / 'inputs.json', {'sourceServiceCheckpoint': str(Path(checkpoint_path).resolve()),
                               'sourceMarker': checkpoint['markerPath'],
                               'targetDescriptor': str(Path(descriptor_path).resolve()),
                               'pairSha256': digest(run / 'pair.json'), 'acceptanceSha256': digest(run / 'acceptance.json'),
                               'writerSha256': writer, 'preparedAt': datetime.now(timezone.utc).isoformat()})
    print(json.dumps({'status': 'prepared', 'run': str(run)}))
    return 0


def operate(run, mode):
    run = Path(run).resolve()
    inputs = json.loads((run / 'inputs.json').read_text())
    label = 'apply' if mode == 'apply-rds' else 'preflight'
    started_marker = run / (label + '.started.json')
    require(not started_marker.exists(), 'BINDING', 'Operation already consumed; inspect the target before any new attempt')
    if mode == 'apply-rds':
        previous = json.loads((run / 'preflight.result.json').read_text())
        require(previous['status'] == 'preflight' and previous['connectionsClosed'], 'BINDING', 'Successful preflight required')
    with started_marker.open('x') as stream:
        json.dump({'atUtc': datetime.now(timezone.utc).isoformat(), 'mode': mode, 'executions': 1,
                   'writerSha256': digest(Path(__file__))}, stream, indent=2)
    report = new_report()
    report.update(connectionAttempts=0, realSourceAccepted=False, realTargetAccepted=False, mode=mode,
                  sealBudgetMs=SEAL_BUDGET_MS, commitBudgetMs=COMMIT_BUDGET_MS, sealWorkMem=SEAL_WORK_MEM)
    source = target = transport = None
    locks = []
    started = time.monotonic()
    code = 0
    try:
        require(not any(k.startswith('PG') for k in os.environ), 'ENVIRONMENT', 'Inherited libpq routing/options refused')
        binding = v3.fixed_bindings()
        v3_context = v3.fixed_context(binding)
        descriptor_path = Path(inputs['targetDescriptor'])
        descriptor = checked_json(descriptor_path, digest(descriptor_path))
        policy = target_policy()
        validate_target(descriptor, policy)
        context = {**v3_context, 'target': descriptor, 'targetPolicy': policy, 'binding': binding, 'v3': v3_context,
                   'v3Target': v3_context['target'], 'v3TargetPolicy': v3_context['targetPolicy']}
        pair = checked_json(run / 'pair.json', inputs['pairSha256'])
        accepted = checked_json(run / 'acceptance.json', inputs['acceptanceSha256'])
        require(accepted['targetReadbackSha256'] == digest(descriptor_path), 'TARGET_POLICY', 'Readback hash differs')
        validate_pair(pair, accepted, inputs['pairSha256'], context)
        service = Path(inputs['sourceServiceCheckpoint'])
        marker, source_descriptor_sha, recovery_sha = v3.validate_service(
            service, digest(service), Path(inputs['sourceMarker']), pair,
            {**previous_source_fields(accepted), 'sourceServiceCheckpointSha256': accepted['sourceServiceCheckpointSha256']},
            v3_context)
        report.update(dataOrigin=accepted['dataOrigin'], pilotAdmission=binding['pilotAdmission'], finalProductionCaps=False,
                      sourceServiceCheckpointSha256=digest(service), sourceRecoveryReleaseSha256=recovery_sha,
                      sourceDescriptorSha256=source_descriptor_sha, targetDescriptorSha256=digest(descriptor_path),
                      targetPolicy=policy, pairSha256=inputs['pairSha256'], acceptanceSha256=inputs['acceptanceSha256'])
        import psycopg
        with ingest_auth() as passfile:
            report['connectionAttempts'] += 1
            source = connect(psycopg, marker, pair['source'], source=True)
            report['connections'] += 1
            report['connectionAttempts'] += 1
            target = connect(psycopg, marker, pair['target'], source=False, real_target=True, passfile=passfile)
            report['connections'] += 1
        if mode == 'apply-rds':
            for conn, sql in [(source, 'SELECT pg_try_advisory_lock(20261104,1)'),
                              (target, 'SELECT pg_try_advisory_lock(20261104,2)'),
                              (target, 'SELECT pg_try_advisory_lock(20261104,1)'),
                              (target, 'SELECT pg_try_advisory_lock(97813003::bigint)')]:
                require(conn.execute(sql).fetchone()[0], 'LEASE', 'Source generation or target migration/generation/serving lease occupied')
                locks.append((conn, sql.replace('pg_try_advisory_lock', 'pg_advisory_unlock')))
        report['leasesAcquired'] = len(locks)
        transport = NativeTransport(source, target, pair, accepted, report, inputs['pairSha256'], binding)
        transport.admission_context = context
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
        require(transport.phase_rows == {accepted['sourcePhases'][0]['generation']: v3.COPIED_ROWS},
                'SOURCE_RECEIPT', 'Exact source-derived 553545-row phase ownership required')
        report.update(status='preflight', realSourceAccepted=True, realTargetAccepted=True)
        if mode == 'apply-rds':
            transport.apply(completed, None)
    except BaseException as error:
        code = 1
        sqlstate = getattr(error, 'sqlstate', None)
        reason = getattr(error, 'code', None)
        if reason is None:
            reason = ('NATIVE_TIMEOUT' if sqlstate in {'57014', '25P03', '55P03'} else 'NATIVE_FK' if sqlstate == '23503'
                      else 'NATIVE_REJECTION' if sqlstate else 'BINDING' if report['connections'] == 0 else 'TRANSPORT_FAILURE')
        report.update(status='refused', reasonCode=reason, sqlstate=sqlstate, errorType=type(error).__name__,
                      error=str(error)[:4000])
        context_text = getattr(getattr(error, 'diag', None), 'context', None)
        if isinstance(context_text, str):
            report['nativeErrorContext'] = context_text[:16384]
    finally:
        if transport is not None:
            report['generationMap'] = transport.maps_g
            report['snapshotMap'] = transport.maps_s
        for conn in (source, target):
            if conn is not None:
                try:
                    conn.rollback()
                    for owner, sql in reversed(locks):
                        if owner is conn:
                            conn.execute(sql)
                except Exception:
                    pass
                finally:
                    conn.close()
        report['connectionsClosed'] = all(c is None or c.closed for c in (source, target))
        report['elapsedMs'] = round((time.monotonic() - started) * 1000, 3)
        report['finishedAt'] = datetime.now(timezone.utc).isoformat()
        save(run / (label + '.result.json'), report)
        print(json.dumps({k: report.get(k) for k in ('status', 'reasonCode', 'sqlstate', 'error', 'copiedRows', 'sealMs',
                                                       'commitMs', 'elapsedMs', 'connectionsClosed')}, default=str))
    return code


def previous_source_fields(accepted):
    """Project V4 acceptance to the v3 source-only acceptance validate_service reads."""
    previous = checked_json(PREVIOUS_ACCEPTANCE, PREVIOUS_ACCEPTANCE_SHA)
    return {**previous, **{k: accepted[k] for k in SOURCE_KEYS}}


def main():
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    modes = parser.add_mutually_exclusive_group()
    for name in ('target-readback', 'prepare', 'preflight-rds', 'apply-rds'):
        modes.add_argument('--' + name, action='store_true')
    parser.add_argument('--out', type=Path)
    parser.add_argument('--run', type=Path)
    parser.add_argument('--source-service-checkpoint', type=Path)
    parser.add_argument('--target-descriptor', type=Path)
    args = parser.parse_args()
    if args.target_readback:
        return target_readback(args.out)
    if args.prepare:
        return prepare(args.run, args.source_service_checkpoint, args.target_descriptor)
    if args.preflight_rds or args.apply_rds:
        return operate(args.run, 'apply-rds' if args.apply_rds else 'preflight-rds')
    print(json.dumps({'status': 'offline_plan', 'connections': 0, 'version': VERSION,
                      'sealBudgetMs': SEAL_BUDGET_MS, 'commitBudgetMs': COMMIT_BUDGET_MS}))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
