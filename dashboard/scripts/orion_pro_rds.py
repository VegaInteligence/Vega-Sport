#!/usr/bin/env python3
"""Guarded existing-RDS schema/bootstrap pilot. Default is read-only preflight.

No DSN/credential arguments, cloud resources, source import, reset or rollback.
The explicit apply mode is separate from every default/offline/read-only mode.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import time

from orion_pro_schema import ROOT, SPEC, active_tables, approved_model, cols, relation, schema_sql
from orion_pro_integrity import integrity_sql, role_grants_sql
from orion_pro_migrate import bootstrap

BASE = ROOT / 'docs/verification/orion-pro-pilot-20261104'
CA = ROOT / 'dashboard/backend/certs/rds-us-east-2.pem'
ACCOUNT, PROFILE, REGION = '361769570630', 'statarena', 'us-east-2'
INSTANCE = 'statarena-postgres'
HOST = 'statarena-postgres.clcy2iqyajbl.us-east-2.rds.amazonaws.com'
DATABASE = 'statarena_prod'
SCHEMAS = ('ingest', 'football', 'analytics')
WRITER, READER = 'statarena_ingest', 'statarena_runtime'
SCOPE = 'schema_and_bootstrap_only'
SQL_PATHS = {'012': ROOT / 'dashboard/backend/migrations/012_orion_pro_domain.sql',
             '013': ROOT / 'dashboard/backend/migrations/013_orion_pro_integrity.sql'}
EXECUTION_PATHS = [SPEC, CA, BASE / 'approval.json', BASE / 'model-amendments.json',
    *SQL_PATHS.values(), *[ROOT / 'dashboard/scripts' / name for name in
    ('orion_pro_schema.py', 'orion_pro_integrity.py', 'orion_pro_migrate.py', 'orion_pro_normalize.py', 'orion_pro_rds.py')],
    *[ROOT / 'tests' / name for name in ('orion_pro_pilot_postgres.py', 'orion_pro_metric_states_postgres.py',
                                      'orion_pro_real_pilot.py', 'orion_pro_rds_gate.py', 'orion_pro_rds_apply_local.py')], BASE / 'harness.py', BASE / 'fixtures.py']


class GateError(Exception):
    """Only fixed, safe gate messages may be emitted to evidence."""


def now():
    return datetime.now(timezone.utc)


def sha(body):
    return hashlib.sha256(body).hexdigest()


def file_sha(path):
    return sha(path.read_bytes())


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()


def relative(path):
    return str(path.resolve().relative_to(ROOT.resolve()))


def json_write(path, body):
    path.write_text(json.dumps(body, indent=2, default=str, ensure_ascii=False) + '\n')


def command(argv):
    """Never includes secret values; never logs stdout/stderr wholesale."""
    got = subprocess.run(argv, cwd=ROOT, capture_output=True, text=True, timeout=30)
    if got.returncode:
        raise GateError('Read command failed: ' + argv[0] + ' (output suppressed)')
    return got.stdout.strip()


def aws(*args):
    output = command(['aws', '--profile', PROFILE, '--region', REGION, '--no-cli-pager', '--output', 'json', *args])
    return json.loads(output)


def gate(report, name, ok, actual):
    report['gates'].append({'gate': name, 'status': 'pass' if ok else 'blocked', 'actual': actual})
    if not ok:
        report['blockers'].append(name)


def source_state():
    commit = command(['git', 'rev-parse', 'HEAD'])
    # A detached CI checkout can produce the read-only plan. It still fails
    # the existing main-branch gate required for an actual database apply.
    branch_ref = subprocess.run(['git', 'symbolic-ref', '--quiet', '--short', 'HEAD'],
                                cwd=ROOT, capture_output=True, text=True, timeout=10)
    if branch_ref.returncode not in (0, 1):
        raise GateError('Cannot inspect the source branch')
    branch = branch_ref.stdout.strip() if branch_ref.returncode == 0 else None
    origin = command(['git', 'rev-parse', 'origin/main'])
    paths = [relative(p) for p in EXECUTION_PATHS]
    changed = command(['git', 'status', '--porcelain', '--untracked-files=normal', '--', *paths])
    committed = {}
    for path in EXECUTION_PATHS:
        rel = relative(path)
        got = subprocess.run(['git', 'cat-file', 'blob', 'HEAD:' + rel], cwd=ROOT, capture_output=True, timeout=10)
        committed[rel] = got.returncode == 0 and sha(got.stdout) == file_sha(path)
    return {'commit': commit, 'branch': branch, 'localOriginMain': origin, 'relevantChangedPaths': changed.splitlines(),
            'allRequiredBytesCommitted': all(committed.values()),
            'uncommittedRequiredPaths': [p for p, equal in committed.items() if not equal]}


def checked_evidence(path, expected_sha, category, model_hash, migrations):
    if not path.is_file() or file_sha(path) != expected_sha:
        raise GateError(category + ' evidence digest mismatch or missing')
    data = json.loads(path.read_text())
    expected_kind = {'sql': 'local_owned_postgres_e2e', 'metrics': 'local_owned_metric_states_e2e'}
    if category in expected_kind and data.get('kind') != expected_kind[category]:
        raise GateError(category + ' evidence has an unexpected E2E kind')
    minimum = {'sql': 23, 'metrics': 25, 'source': 9}[category]
    cases = data.get('cases', [])
    if data.get('status') != 'pass' or len(cases) < minimum or any(c.get('status') != 'pass' for c in cases):
        raise GateError(category + ' evidence is not complete passing local acceptance')
    if data.get('model_sha256', data.get('modelSha256')) != model_hash:
        raise GateError(category + ' evidence model differs from current candidate')
    cleanup = data.get('cleanup', {})
    if cleanup.get('server_stopped') is not True or cleanup.get('owned_directory_removed') is not True:
        raise GateError(category + ' evidence lacks owned PostgreSQL cleanup')
    inputs = path.parent / 'inputs'
    snapshot_paths = [SPEC, BASE / 'approval.json', BASE / 'model-amendments.json']
    if category in {'sql', 'metrics'}:
        snapshot_paths += [ROOT / 'dashboard/scripts' / n for n in
                           ('orion_pro_schema.py', 'orion_pro_integrity.py', 'orion_pro_migrate.py')]
        snapshot_paths += [ROOT / 'tests' / ('orion_pro_pilot_postgres.py' if category == 'sql' else 'orion_pro_metric_states_postgres.py'),
                           BASE / 'harness.py', BASE / 'fixtures.py']
    else:
        if data.get('phase') not in {'core', 'families'} or data.get('remoteWrites') != [] or data.get('rawSourceCopies') != []:
            raise GateError('Source acceptance has unexpected phase or external writes')
        snapshot_paths += [ROOT / 'dashboard/scripts/orion_pro_normalize.py', ROOT / 'tests/orion_pro_real_pilot.py', BASE / 'harness.py']
    for current in snapshot_paths:
        snapshot = inputs / current.name
        if not snapshot.is_file() or file_sha(snapshot) != file_sha(current):
            raise GateError(category + ' evidence input snapshot differs: ' + relative(current))
    if category in {'sql', 'metrics'}:
        journal = data.get('applied_sql_sha256')
        if category == 'sql':
            runner = next((c for c in cases if c.get('case') == 'runner_available'), {})
            actual = runner.get('actual', {})
            journal = actual.get('applied_sql_sha256')
            if dict(actual.get('migration_versions', [])) != migrations:
                raise GateError('SQL local journal differs from current migration checksums')
        for version, expected in migrations.items():
            filename = SQL_PATHS[version].name
            applied = path.parent / 'applied-sql' / filename
            if not journal or journal.get(filename) != expected or not applied.is_file() or file_sha(applied) != expected:
                raise GateError(category + ' actually applied SQL differs from current migration bytes')
    return {'path': relative(path), 'sha256': expected_sha, 'passedCases': len(cases), 'modelSha256': model_hash,
            'acceptanceScope': 'bounded_local_workflow_only'}


def local_plan(args, report):
    model = approved_model(SPEC)
    artifacts = [('012', SQL_PATHS['012'], schema_sql(model)),
                 ('013', SQL_PATHS['013'], integrity_sql(model, active_tables(model)))]
    migrations = {v: sha(sql.encode()) for v, _, sql in artifacts}
    source = {relative(p): file_sha(p) for p in EXECUTION_PATHS}
    state = source_state()
    grants = role_grants_sql(model, ingest_role=WRITER, runtime_role=READER)
    plan = {'remoteScope': SCOPE, 'account': ACCOUNT, 'profile': PROFILE, 'region': REGION, 'instance': INSTANCE,
            'host': HOST, 'database': DATABASE, 'engineVersion': '18.6', 'allocatedGiB': 64,
            'modelSha256': file_sha(SPEC), 'migrationSha256': migrations, 'grantsSha256': sha(grants.encode()),
            'sourceSha256': source, 'git': state, 'schemas': list(SCHEMAS), 'existingRoles': [WRITER, READER],
            'activeTables': len(active_tables(model)), 'seedRows': sum(map(len, model['seed_data'].values())),
            'noSourceImportOrPublication': True, 'readOnlySqlBudget': 20,
            'capacityPolicy': {'freeStorageMinimumBytes': 8 * 1024**3, 'cpuLatestMaximumExclusive': 80,
                               'cpuCreditLatestMinimum': 1, 'maximumMetricAgeSeconds': 300},
            'acceptance': None, 'acceptanceSha256': None}
    report['plan'] = plan
    gate(report, 'compiled_sql_matches_checked_source', all(p.read_text() == sql for _, p, sql in artifacts), migrations)
    gate(report, 'relevant_source_is_committed_main', state['branch'] == 'main' and state['commit'] == state['localOriginMain']
         and state['allRequiredBytesCommitted'] and not state['relevantChangedPaths'], state)
    if not args.acceptance:
        gate(report, 'parent_acceptance_required', False, 'Explicit schema/bootstrap acceptance receipt not supplied')
    else:
        try:
            acceptance_path = args.acceptance.resolve()
            if not args.acceptance_sha256 or file_sha(acceptance_path) != args.acceptance_sha256:
                raise GateError('Parent acceptance digest mismatch or missing')
            accepted = json.loads(acceptance_path.read_text())
            if accepted.get('status') != 'accepted_for_schema_bootstrap' or accepted.get('remoteScope') != SCOPE:
                raise GateError('Parent acceptance does not authorize this exact remote scope')
            if accepted.get('commit') != state['commit'] or accepted.get('modelSha256') != plan['modelSha256'] or accepted.get('migrationSha256') != migrations:
                raise GateError('Parent acceptance commit/model/SQL differs from current source')
            evidence = {}
            for category in ('sql', 'metrics', 'source'):
                item = accepted['evidence'][category]
                path = (ROOT / item['path']).resolve()
                path.relative_to(BASE.resolve())
                evidence[category] = checked_evidence(path, item['sha256'], category, plan['modelSha256'], migrations)
            plan['acceptanceSha256'] = file_sha(acceptance_path)
            plan['acceptance'] = {'path': relative(acceptance_path), 'evidence': evidence}
            gate(report, 'parent_acceptance_current_scope_and_evidence', True, plan['acceptance'])
        except GateError as exc:
            gate(report, 'parent_acceptance_invalid', False, str(exc))
        except Exception as exc:
            gate(report, 'parent_acceptance_invalid', False, {'errorType': type(exc).__name__})
    binding = {k: plan[k] for k in ('remoteScope', 'modelSha256', 'migrationSha256', 'grantsSha256', 'sourceSha256', 'acceptanceSha256')}
    binding['commit'] = state['commit']
    plan['bindingSha256'] = sha(canonical(binding))
    return model, artifacts, grants


class ReadOnlyQueries:
    def __init__(self, db, report):
        self.db, self.report, self.count = db, report, 0

    def run(self, name, sql, params=()):
        self.count += 1
        if self.count > 20 or not sql.lstrip().upper().startswith('SELECT'):
            raise GateError('Read-only SQL budget or statement gate failed')
        start = time.monotonic()
        cur = self.db.execute(sql, params)
        keys = [c.name for c in cur.description]
        rows = [dict(zip(keys, row)) for row in cur.fetchall()]
        self.report['queries'].append({'number': self.count, 'name': name, 'sql': sql,
                                       'params': list(params), 'rows': rows,
                                       'elapsedMs': round((time.monotonic() - start) * 1000, 3)})
        return rows


def target_state(q, model, migrations):
    namespaces = q.run('target_namespaces', 'SELECT nspname FROM pg_namespace WHERE nspname=ANY(%s) ORDER BY 1', (list(SCHEMAS),))
    if not namespaces:
        return {'state': 'absent', 'schemas': [], 'journal': []}
    if {r['nspname'] for r in namespaces} != set(SCHEMAS):
        raise GateError('Only some target namespaces exist; refusing partial or unjournaled state')
    journal_exists = q.run('target_journal_exists', "SELECT to_regclass('ingest.schema_migrations')::text AS journal")[0]['journal']
    if not journal_exists:
        raise GateError('Target namespaces exist without expected migration journal')
    journal = q.run('target_migration_journal', 'SELECT version,content_sha256,code_commit FROM ingest.schema_migrations ORDER BY version')
    if {r['version']: r['content_sha256'] for r in journal} != migrations or len(journal) != 2:
        raise GateError('Target journal versions/checksums differ; no remote rollback or repair is permitted')
    catalogue = q.run('target_catalogue', "SELECT n.nspname||'.'||c.relname AS name,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY(%s) AND c.relkind IN ('r','p') ORDER BY 1", (list(SCHEMAS),))
    expected = set(active_tables(model))
    if {r['name'] for r in catalogue} != expected:
        raise GateError('Journalled target table set differs from the current model')
    allowed = {'ingest.schema_migrations', 'ingest.dataset_snapshots', 'ingest.relation_contracts', *model['seed_data']}
    # EXISTS rather than COUNT avoids scanning populated business relations.
    pieces = [f"SELECT '{name}'::text AS relation WHERE EXISTS (SELECT 1 FROM {relation(name)} LIMIT 1)"
              for name in sorted(expected - allowed)]
    populated = q.run('nonbootstrap_target_data', 'SELECT * FROM (' + ' UNION ALL '.join(pieces) + ') AS found')
    if populated:
        raise GateError('Target contains business data beyond schema/bootstrap scope')
    snapshot = q.run('target_bootstrap_snapshot', 'SELECT snapshot_key,generation,status FROM ingest.dataset_snapshots ORDER BY generation')
    if len(snapshot) != 1 or snapshot[0]['snapshot_key'] != 'bootstrap-v1-' + file_sha(SPEC)[:16] or snapshot[0]['status'] != 'sealed':
        raise GateError('Expected one sealed current-model bootstrap snapshot')
    generation = snapshot[0]['generation']
    for name, seeds in model['seed_data'].items():
        keys = list(seeds[0])
        got = q.run('target_seed_' + name.replace('.', '_'), f'SELECT {cols(keys)},recorded_from_gen FROM {relation(name)} ORDER BY code')
        expected_seeds = sorted([{**s, 'recorded_from_gen': generation} for s in seeds], key=lambda s: s['code'])
        if got != expected_seeds:
            raise GateError('Existing bootstrap seed bytes differ from the current model')
    contracts = q.run('target_bootstrap_contracts', 'SELECT relation_code,contract_version,relation_name,grain_definition FROM ingest.relation_contracts ORDER BY relation_name,contract_version')
    expected_contracts = sorted(model['bootstrap']['relation_contracts'], key=lambda c: (c['relation_name'], c['contract_version']))
    if contracts != expected_contracts:
        raise GateError('Existing bootstrap relation contracts differ')
    return {'state': 'exact_journal_bootstrap_only', 'schemas': list(SCHEMAS), 'journal': journal,
            'bootstrapGeneration': generation, 'businessTablesPopulated': 0}


def db_preflight(report, model, *, admin=None):
    import psycopg
    options = '-c default_transaction_read_only=on -c statement_timeout=8000 -c lock_timeout=1000 -c idle_in_transaction_session_timeout=15000'
    kwargs = dict(host=HOST, port=5432, dbname=DATABASE, user=WRITER, sslmode='verify-full', sslrootcert=str(CA),
                  connect_timeout=7, autocommit=True, application_name='orion-pro-rds-preflight', options=options)
    if admin is not None:
        kwargs.update(user=admin['username'], password=admin['password'])
    with psycopg.connect(**kwargs) as db:
        q = ReadOnlyQueries(db, report)
        identity = q.run('identity_tls_read_only', "SELECT current_database() AS database,current_user AS role,current_setting('server_version') AS version,current_setting('transaction_read_only') AS read_only,(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS ssl")[0]
        gate(report, 'database_tls_read_only_identity', identity['database'] == DATABASE and identity['read_only'] == 'on' and identity['ssl'] is True and db.info.server_version == 180006 and identity['role'] == (admin['username'] if admin else WRITER), identity)
        roles = q.run('existing_application_roles', 'SELECT rolname,rolsuper,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=ANY(%s) ORDER BY rolname', ([WRITER, READER],))
        safe_roles = len(roles) == 2 and {r['rolname'] for r in roles} == {WRITER, READER} and not any(any(r[k] for k in ('rolsuper','rolcreaterole','rolcreatedb','rolreplication','rolbypassrls')) for r in roles)
        memberships = q.run('runtime_role_memberships', 'SELECT parent.rolname AS granted_role FROM pg_auth_members m JOIN pg_roles child ON child.oid=m.member JOIN pg_roles parent ON parent.oid=m.roleid WHERE child.rolname=%s ORDER BY 1', (READER,))
        gate(report, 'existing_roles_are_safe', safe_roles and not memberships, {'roles': roles, 'runtimeMemberships': memberships})
        activity = q.run('other_transactions', "SELECT usename AS role,application_name,state,count(*)::integer AS sessions,max(EXTRACT(EPOCH FROM clock_timestamp()-xact_start))::integer AS oldest_transaction_seconds FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND (xact_start IS NOT NULL OR state IS NULL) GROUP BY 1,2,3 ORDER BY 1,2,3")
        writers = [r for r in activity if r['role'] not in {READER, 'rdsadmin'}]
        gate(report, 'no_active_write_capable_transaction', not writers, {'transactions': activity, 'blockingWriterGroups': len(writers)})
        locks = q.run('active_advisory_leases', "SELECT l.classid::text,l.objid::text,l.objsubid,l.granted,a.usename AS role,a.application_name,count(*)::integer AS locks FROM pg_locks l LEFT JOIN pg_stat_activity a ON a.pid=l.pid WHERE l.locktype='advisory' AND l.database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND l.pid<>pg_backend_pid() GROUP BY 1,2,3,4,5,6 ORDER BY 1,2,3")
        gate(report, 'no_active_advisory_lease', not locks, locks)
        write_locks = q.run('active_write_locks', "SELECT n.nspname AS schema,l.mode,l.granted,count(*)::integer AS locks FROM pg_locks l JOIN pg_class c ON c.oid=l.relation JOIN pg_namespace n ON n.oid=c.relnamespace WHERE l.database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND l.pid<>pg_backend_pid() AND l.mode IN ('RowExclusiveLock','ShareRowExclusiveLock','ShareUpdateExclusiveLock','ExclusiveLock','AccessExclusiveLock') AND n.nspname NOT IN ('pg_catalog','information_schema') GROUP BY 1,2,3 ORDER BY 1,2,3")
        gate(report, 'no_active_write_lock', not write_locks, write_locks)
        sources = q.run('source_schema_metadata_only', "SELECT n.nspname AS schema,count(*) FILTER (WHERE c.relkind IN ('r','p'))::integer AS tables,coalesce(sum(s.n_live_tup),0)::bigint AS estimated_rows FROM pg_namespace n LEFT JOIN pg_class c ON c.relnamespace=n.oid LEFT JOIN pg_stat_user_tables s ON s.relid=c.oid WHERE n.nspname IN ('statarena','statarena_app') GROUP BY 1 ORDER BY 1")
        gate(report, 'existing_source_schemas_present', {r['schema'] for r in sources} == {'statarena','statarena_app'} and all(r['tables'] > 0 for r in sources), {'metadataOnly': sources, 'rowCountsAreEstimates': True})
        try:
            target = target_state(q, model, report['plan']['migrationSha256'])
            gate(report, 'target_absent_or_exact_journal_bootstrap', True, target)
        except GateError as exc:
            gate(report, 'target_absent_or_exact_journal_bootstrap', False, str(exc))
        report['readOnlySqlStatements'] = q.count


def remote_preflight(report, model):
    account = aws('sts', 'get-caller-identity')
    gate(report, 'aws_profile_account_region', account.get('Account') == ACCOUNT, {'profile': PROFILE, 'account': account.get('Account'), 'region': REGION})
    if account.get('Account') != ACCOUNT:
        return
    raw = aws('rds', 'describe-db-instances', '--db-instance-identifier', INSTANCE)['DBInstances']
    if len(raw) != 1:
        raise GateError('Expected exactly one existing named instance')
    rds = raw[0]
    metadata = {'instance': rds['DBInstanceIdentifier'], 'host': rds['Endpoint']['Address'], 'port': rds['Endpoint']['Port'],
                'engine': rds['Engine'], 'engineVersion': rds['EngineVersion'], 'class': rds['DBInstanceClass'],
                'allocatedGiB': rds['AllocatedStorage'], 'pending': rds['PendingModifiedValues'], 'status': rds['DBInstanceStatus']}
    gate(report, 'existing_rds_identity_and_capacity_configuration', metadata['instance'] == INSTANCE and metadata['host'] == HOST and metadata['port'] == 5432 and metadata['engine'] == 'postgres' and metadata['engineVersion'] == '18.6' and metadata['class'] == 'db.t4g.micro' and metadata['allocatedGiB'] == 64 and metadata['pending'] == {} and metadata['status'] == 'available', metadata)
    end = now(); start = end - timedelta(minutes=10)
    names = {'free': ('FreeStorageSpace','Minimum'), 'cpu': ('CPUUtilization','Average'), 'credits': ('CPUCreditBalance','Minimum')}
    requests = [{'Id': key, 'MetricStat': {'Metric': {'Namespace': 'AWS/RDS','MetricName': name,
                 'Dimensions': [{'Name': 'DBInstanceIdentifier', 'Value': INSTANCE}]}, 'Period': 60, 'Stat': statistic}, 'ReturnData': True}
                for key, (name, statistic) in names.items()]
    metric_data = aws('cloudwatch', 'get-metric-data', '--metric-data-queries', json.dumps(requests),
                      '--start-time', start.isoformat(), '--end-time', end.isoformat(), '--scan-by', 'TimestampDescending', '--max-datapoints', '40')
    observed = {}
    for result in metric_data.get('MetricDataResults', []):
        values, stamps = result.get('Values', []), result.get('Timestamps', [])
        observed[result['Id']] = {'metric': names[result['Id']][0], 'status': result.get('StatusCode'),
                                  'value': values[0] if values else None,
                                  'atUtc': datetime.fromisoformat(stamps[0].replace('Z','+00:00')).astimezone(timezone.utc).isoformat() if stamps else None,
                                  'samples': len(values)}
    fresh = set(observed) == set(names) and all(x['status'] == 'Complete' and x['value'] is not None and x['atUtc'] and 0 <= (end - datetime.fromisoformat(x['atUtc'].replace('Z','+00:00'))).total_seconds() <= 300 for x in observed.values())
    gate(report, 'recent_capacity_samples', fresh, observed)
    if fresh:
        gate(report, 'capacity_observation_with_reserve', observed['free']['value'] >= 8*1024**3 and observed['cpu']['value'] < 80 and observed['credits']['value'] >= 1, {'observed': observed, 'policy': report['plan']['capacityPolicy'], 'causalBenchmark': False})
    remote_url = command(['git', 'remote', 'get-url', 'origin'])
    canonical_remote = remote_url in {'https://github.com/OrionQuantPlatform/STATARENA.git', 'git@github.com:OrionQuantPlatform/STATARENA.git'}
    if not canonical_remote:
        gate(report, 'live_origin_main_identity', False, 'Unexpected origin remote; no request to that remote made')
    else:
        origin_sha = command(['git', 'ls-remote', '--exit-code', 'origin', 'refs/heads/main']).split()[0]
        branch = json.loads(command(['gh', 'api', 'repos/OrionQuantPlatform/STATARENA/branches/main']))
        gate(report, 'live_origin_main_identity', origin_sha == report['plan']['git']['commit'] == branch['commit']['sha'], {'liveOriginMain': origin_sha, 'githubMain': branch['commit']['sha']})
        # Repository policy is observed, never altered or invented as a new
        # user approval requirement. Exact main bytes and root review are gated.
        report['repositoryPolicyObservation'] = {'mainProtected': branch.get('protected'), 'changed': False}
    if metadata['host'] != HOST or metadata['engineVersion'] != '18.6':
        return
    db_preflight(report, model)


def offline_apply_checks(args, report):
    plan = report['plan']
    expected = {'commit': (args.expect_commit, plan['git']['commit']), 'model': (args.expect_model_sha256, plan['modelSha256']),
                '012': (args.expect_012_sha256, plan['migrationSha256']['012']), '013': (args.expect_013_sha256, plan['migrationSha256']['013'])}
    gate(report, 'explicit_expected_commit_model_migrations', all(a is not None and a == b for a,b in expected.values()), {k: {'expected': a, 'actual': b} for k,(a,b) in expected.items()})
    if not args.preflight_receipt or not args.preflight_sha256:
        gate(report, 'fresh_preflight_receipt_required', False, 'Explicit fresh preflight path and digest required')
        return
    try:
        path = args.preflight_receipt.resolve()
        if file_sha(path) != args.preflight_sha256:
            gate(report, 'fresh_preflight_digest_mismatch', False, 'Preflight receipt digest mismatch')
            return
        prior = json.loads(path.read_text())
        age = (now() - datetime.fromisoformat(prior['finishedAt'])).total_seconds()
        if prior.get('kind') != 'orion_pro_rds_gate' or prior.get('mode') != 'preflight' or prior.get('status') != 'ready' or prior.get('remoteWrites') != [] or prior.get('blockers') or not 0 <= age <= 600:
            raise GateError('Preflight receipt is stale or not ready/read-only')
        if prior['plan']['bindingSha256'] != plan['bindingSha256']:
            raise GateError('Preflight receipt source/acceptance binding differs')
        gate(report, 'fresh_preflight_matches_current_source', True, {'path': relative(path), 'sha256': file_sha(path), 'ageSeconds': round(age, 3)})
    except GateError as exc:
        gate(report, 'fresh_preflight_invalid', False, str(exc))
    except Exception as exc:
        gate(report, 'fresh_preflight_invalid', False, {'errorType': type(exc).__name__})


def apply_schema_bootstrap(report, model, artifacts, grants):
    """Only reachable from explicit --apply after all offline/fresh online gates.

    The admin connection always starts read-only; transaction-local READ WRITE
    begins only after identity checks. No local reset helper is called.
    """
    import psycopg
    secret_response = aws('ssm', 'get-parameter', '--name', '/statarena/app/rds-admin', '--with-decryption')
    parameter = secret_response['Parameter']
    if parameter.get('Type') != 'SecureString':
        raise GateError('Existing admin parameter is not SecureString')
    secret = json.loads(parameter['Value'])
    del secret_response, parameter
    # This existing instance-wide credential retains its historical database
    # label and may omit host. It never supplies the connection destination.
    allowed_fields = {'database', 'password', 'security_group', 'username', 'host'}
    if (not isinstance(secret, dict) or set(secret) - allowed_fields
            or secret.get('username') != 'statarena_admin'
            or secret.get('database') not in ('statarena', DATABASE)
            or ('host' in secret and secret['host'] != HOST)
            or not isinstance(secret.get('password'), str) or not secret['password']):
        raise GateError('Existing admin parameter target mismatch')
    kwargs = dict(host=HOST, port=5432, dbname=DATABASE, user=secret['username'], password=secret['password'],
                  sslmode='verify-full', sslrootcert=str(CA), connect_timeout=7, autocommit=True,
                  application_name='orion-pro-rds-schema-bootstrap',
                  options='-c default_transaction_read_only=on -c statement_timeout=60000 -c lock_timeout=2000 -c idle_in_transaction_session_timeout=15000')
    with psycopg.connect(**kwargs) as db:
        del kwargs, secret
        if db.info.server_version != 180006:
            raise GateError('Admin connection engine mismatch')
        with db.transaction():
            # Access mode command must precede every transaction data query.
            db.execute('SET TRANSACTION READ WRITE')
            identity = db.execute("SELECT current_database(),(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid())").fetchone()
            if identity != (DATABASE, True):
                raise GateError('Admin connection database/TLS mismatch')
            if not db.execute('SELECT pg_try_advisory_xact_lock(20261104,2)').fetchone()[0]:
                raise GateError('Migration advisory lease is held; nothing applied')
            # Fence the same global generation key used by every typed writer.
            if not db.execute('SELECT pg_try_advisory_xact_lock(20261104,1)').fetchone()[0]:
                raise GateError('Typed generation advisory lease is held; nothing applied')
            # Also fence the existing serving worker, without touching its data.
            if not db.execute('SELECT pg_try_advisory_xact_lock(97813003::bigint)').fetchone()[0]:
                raise GateError('Existing serving worker advisory lease is held; nothing applied')
            other_writers = db.execute("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND xact_start IS NOT NULL AND usename NOT IN (%s,'rdsadmin')", (READER,)).fetchone()[0]
            if other_writers:
                raise GateError('A write-capable transaction appeared after read-only preflight')
            q = ReadOnlyQueries(db, {'queries': []})
            target = target_state(q, model, report['plan']['migrationSha256'])
            roles = db.execute('SELECT rolname,rolsuper,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=ANY(%s)', ([WRITER, READER],)).fetchall()
            if len(roles) != 2 or any(any(row[1:]) for row in roles):
                raise GateError('Existing target roles changed before apply')
            membership = db.execute('SELECT count(*) FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member WHERE r.rolname=%s', (READER,)).fetchone()[0]
            if membership:
                raise GateError('Runtime role membership changed before apply')
            applied = []
            report['remoteWriteAttempt'] = {'scope': SCOPE, 'outcome': 'transaction_open'}
            if target['state'] == 'absent':
                for version, _, sql in artifacts:
                    db.execute(sql, prepare=False)
                    db.execute('INSERT INTO ingest.schema_migrations(version,content_sha256,applied_at,code_commit) VALUES(%s,%s,CURRENT_TIMESTAMP,%s)',
                               (version, sha(sql.encode()), report['plan']['git']['commit']))
                    applied.append(version)
            boot = bootstrap(db, model, artifacts)
            db.execute(grants, prepare=False)
            actual = db.execute('SELECT version,content_sha256 FROM ingest.schema_migrations ORDER BY version').fetchall()
            if dict(actual) != report['plan']['migrationSha256']:
                raise GateError('In-transaction journal verification failed')
            if {relative(p): file_sha(p) for p in EXECUTION_PATHS} != report['plan']['sourceSha256']:
                raise GateError('Relevant source changed before commit; transaction aborted')
            report['apply'] = {'scope': SCOPE, 'applied': applied, 'bootstrap': boot,
                               'grantsSha256': report['plan']['grantsSha256'], 'journal': actual,
                               'transaction': 'commit_pending'}
            report['remoteWriteAttempt']['outcome'] = 'commit_pending'
        report['apply']['transaction'] = 'atomic_committed'
        report['remoteWriteAttempt']['outcome'] = 'committed'
    report['remoteWrites'] = [{'scope': SCOPE, 'schemas': list(SCHEMAS), 'applied': report['apply']['applied']}]


def digest_argument(value):
    if not re.fullmatch('[0-9a-f]{64}', value):
        raise argparse.ArgumentTypeError('Expected a lowercase SHA-256 digest')
    return value


def main():
    p = argparse.ArgumentParser(description=__doc__)
    modes = p.add_mutually_exclusive_group()
    modes.add_argument('--plan', action='store_true', help='Offline plan only; no cloud or database access')
    modes.add_argument('--preflight', action='store_true', help='Read-only AWS/SQL preflight (default)')
    modes.add_argument('--check-apply', action='store_true', help='Offline apply-gate validation; never connects or applies')
    modes.add_argument('--apply', action='store_true', help='Explicit guarded schema/bootstrap transaction after owner review')
    p.add_argument('--label', default='preflight')
    p.add_argument('--acceptance', type=Path)
    p.add_argument('--acceptance-sha256', type=digest_argument)
    p.add_argument('--preflight-receipt', type=Path)
    p.add_argument('--preflight-sha256', type=digest_argument)
    p.add_argument('--expect-commit', type=lambda x: x if re.fullmatch('[0-9a-f]{40}', x) else p.error('Expected a 40-character commit'))
    p.add_argument('--expect-model-sha256', type=digest_argument)
    p.add_argument('--expect-012-sha256', type=digest_argument)
    p.add_argument('--expect-013-sha256', type=digest_argument)
    args = p.parse_args()
    if not re.fullmatch('[a-zA-Z0-9][a-zA-Z0-9-]{0,79}', args.label):
        p.error('Use a simple bounded label')
    mode = 'apply' if args.apply else 'check_apply' if args.check_apply else 'plan' if args.plan else 'preflight'
    run = BASE / 'rds-runs' / (now().strftime('%Y%m%dT%H%M%S%fZ') + '-' + args.label)
    run.mkdir(parents=True)
    report = {'kind': 'orion_pro_rds_gate', 'mode': mode, 'startedAt': now().isoformat(),
              'commandArgv': ['python3', 'dashboard/scripts/orion_pro_rds.py', *sys.argv[1:]],
              'setup': 'Existing named AWS/RDS only; TLS verify-full; indirect libpq password-file reads; no secret/DSN outputs',
              'expected': relative(BASE / 'RDS_PROTOCOL.md'), 'gates': [], 'blockers': [], 'queries': [],
              'remoteWrites': [], 'limits': ['Schema/bootstrap acceptance does not establish full source fidelity, performance or public cutover']}
    try:
        model, artifacts, grants = local_plan(args, report)
        json_write(run / 'plan.json', report['plan'])
        (run / 'existing-role-grants.sql').write_text(grants)
        if mode in {'check_apply', 'apply'}:
            offline_apply_checks(args, report)
        if mode == 'preflight' or (mode == 'apply' and not report['blockers']):
            remote_preflight(report, model)
        if mode == 'apply' and not report['blockers']:
            # Rebuild and bind source after remote reads, immediately before secret access.
            recheck = {'gates': [], 'blockers': []}
            local_plan(args, recheck)
            if recheck['blockers'] or recheck['plan']['bindingSha256'] != report['plan']['bindingSha256']:
                raise GateError('Relevant source or acceptance changed during preflight')
            apply_schema_bootstrap(report, model, artifacts, grants)
        report['status'] = 'blocked' if report['blockers'] else 'applied' if mode == 'apply' else 'ready'
    except Exception as exc:
        report['status'] = 'failed'
        report['error'] = {'type': type(exc).__name__, 'sqlstate': getattr(exc, 'sqlstate', None)}
        if isinstance(exc, GateError):
            report['error']['reason'] = str(exc)
        if report.get('remoteWriteAttempt', {}).get('outcome') == 'commit_pending':
            report['remoteWriteAttempt']['outcome'] = 'commit_acknowledgement_unverified'
        elif report.get('remoteWriteAttempt', {}).get('outcome') == 'transaction_open':
            report['remoteWriteAttempt']['outcome'] = 'failed_transaction_rollback_expected'
        report['blockers'].append('preflight_or_apply_exception')
    report['finishedAt'] = now().isoformat()
    json_write(run / 'result.json', report)
    print(json.dumps({'status': report['status'], 'mode': mode, 'blockers': report['blockers'],
                      'receipt': relative(run / 'result.json'), 'receiptSha256': file_sha(run / 'result.json'),
                      'remoteWrites': report['remoteWrites']}))
    return 0 if report['status'] in {'ready', 'applied'} else 2


if __name__ == '__main__':
    raise SystemExit(main())
