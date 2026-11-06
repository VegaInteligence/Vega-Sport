#!/usr/bin/env python3
"""Actual Node24 AWS handler, typed native match details on one owned PG18.6."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import select
import shutil
import signal
import subprocess
import sys
import time
import traceback
from urllib.error import HTTPError
from urllib.request import Request, build_opener, ProxyHandler

from orion_node24_runtime import verify_node24_runtime

ROOT = Path(__file__).resolve().parents[1]
DOC = ROOT / 'docs/verification'
BASE = DOC / 'orion-pro-match-readers-20261105'
PILOT = DOC / 'orion-pro-pilot-20261104'
ORIGINAL = DOC / 'orion-pro-appearances-20261105'
CORE = DOC / 'orion-pro-match-core-fields-20261105'
APP = ROOT / 'dashboard/backend/aws-app.js'
SERVICES = APP.parent / 'services'
MIG = APP.parent / 'migrations'
MODEL103 = ROOT / 'docs/architecture/orion-plan-20261104/target-schema.proposed.json'
MODEL016 = ROOT / 'docs/architecture/orion-native-details-107-20261105/target-schema.approved-107.json'
MODEL017 = MODEL016.with_name('target-schema.approved-107-core.json')
BIND016 = DOC / 'orion-pro-native107-20261105/PUBLICATION_BINDING.json'
BIND017 = CORE / 'PUBLICATION_BINDING_017.json'
HTTP_SERVER = ORIGINAL / 'http_server.mjs'
SUMS = ORIGINAL / 'runtime/SHASUMS256.txt'
DEFAULT_NODE = '/tmp/statarena-node24-runtime/v24.22.2/node-v24.22.2-darwin-arm64/bin/node'
DEFAULT_PG = '/tmp/statarena-cache-test-tools/node_modules/@embedded-postgres/darwin-arm64/native/bin'
MIGRATIONS = ('012_orion_pro_domain.sql', '013_orion_pro_integrity.sql',
              '014_orion_pro_membership_nonnull.sql', '015_orion_pro_metric_membership_guard.sql',
              '016_orion_pro_native_match_details.sql', '017_orion_pro_native_match_core_fields.sql')
CAPS = dict(seconds=600, sql=4000, http=200, typedRows=5000, evidenceBytes=64 * 1024**2,
            ownedDiskBytes=1024**3, connections=5, statementMilliseconds=8000, lockMilliseconds=1000)
OPTIONS = '-c statement_timeout=8000 -c lock_timeout=1000 -c timezone=UTC -c datestyle=ISO,YMD -c extra_float_digits=3'
ROLE_OWNER = 'statarena_admin'
ROLE_WRITER = 'statarena_ingest'
ROLE_RUNTIME = 'statarena_runtime'
DB = 'native_match_readers_owned'
sys.path[:0] = [str(BASE), str(PILOT), str(DOC / 'orion-pro-readers-20261104'),
                str(ROOT / 'dashboard/scripts')]


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def size(path):
    return sum(p.stat().st_size for p in path.rglob('*') if p.is_file()) if path.exists() else 0


class Counted:
    def __init__(self, connection, harness):
        self.connection, self.harness = connection, harness

    def execute(self, sql, *args, **kwargs):
        self.harness.count_sql(sql)
        return self.connection.execute(sql, *args, **kwargs)

    def transaction(self):
        txn, harness = self.connection.transaction(), self.harness

        class Transaction:
            def __enter__(self):
                harness.count_sql('BEGIN_OR_SAVEPOINT')
                return txn.__enter__()

            def __exit__(self, *args):
                try:
                    return txn.__exit__(*args)
                finally:
                    harness.count_sql('COMMIT_OR_ROLLBACK')
        return Transaction()

    def __getattr__(self, key):
        return getattr(self.connection, key)


class Harness:
    def __init__(self, args, run, report):
        self.args, self.phase, self.run, self.report = args, args.phase, run, report
        self.pg = self.server = self.origin = self.out = self.err = None
        self.admin = self.writer = self.fixture = None
        self.process_count = self.runtime_sql = self.http_count = 0
        self.clients, self.servers = [], []
        self.clean_env = {'PATH': '/usr/bin:/bin:/usr/sbin:/sbin:' + str(args.node24.parent)}
        for key, name in [('PGPASSFILE', 'empty.pgpass'), ('PGSERVICEFILE', 'empty.pg_service.conf')]:
            path = run / name
            path.write_text('')
            path.chmod(0o600)
            self.clean_env[key] = str(path)
        self.clean_env['PGPASSWORD'] = ''
        self.open = build_opener(ProxyHandler({})).open
        self.binding016 = json.loads(BIND016.read_text())
        self.binding017 = json.loads(BIND017.read_text())
        self.model = json.loads(MODEL103.read_text())
        self.sources = {}

    def freeze(self):
        from http_cases import __file__ as case_path
        from typed_fixture import __file__ as typed_path
        from fixture_publisher import __file__ as publisher_path
        # Copy the app's local import graph, including the exact historical helper
        # files actually loaded. No package inventory, env file or business body.
        imports = re.compile(r'(?:from\s*|import\s*)["\'](\.[^"\']+)["\']')
        graph, todo = set(), [APP, HTTP_SERVER]
        while todo:
            file = todo.pop()
            if file in graph:
                continue
            graph.add(file)
            for relative in imports.findall(file.read_text()):
                child = (file.parent / relative).resolve()
                if child.is_file() and 'node_modules' not in child.parts and child.is_relative_to(ROOT):
                    todo.append(child)
        paths = graph | {Path(__file__), Path(case_path), Path(typed_path), Path(publisher_path),
            BASE / 'PROTOCOL.md', BASE / 'CORE_017_E2E.md', BASE / 'synthetic_inputs.py',
            BASE / 'CORE_MOMENTUM_FIELD_MATRIX.json', MODEL103, MODEL016, MODEL017, BIND016, BIND017,
            SUMS, ROOT / 'tests/orion_node24_runtime.py', ROOT / 'dashboard/package.json',
            DOC / 'orion-pro-readers-20261104/fixture.py', PILOT / 'fixtures.py', PILOT / 'harness.py'}
        paths.update(ROOT / 'dashboard/scripts' / (n + '.py')
                     for n in ('orion_pro_migrate', 'orion_pro_integrity', 'orion_pro_schema'))
        paths.update(MIG / name for name in MIGRATIONS[:(6 if self.args.target == '017' else 5)])
        product = SERVICES / 'orion-pro-match-details.js'
        if product.is_file():
            paths.add(product)
        for file in sorted(paths):
            relative = file.relative_to(ROOT)
            dest = self.run / 'inputs' / relative
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(file, dest)
            self.sources[str(relative)] = sha(file)
        self.report['inputSha256'] = self.sources
        for path, digest in ((MODEL103, '18da43f940870b7a3a3cb49323c847dd5e5174e5eea1f8ff0c8a159cf373cb08'),
                             (MIG / MIGRATIONS[4], '12d63eaab6f4d610de3f2ff4efc0dcd71059c4d2e489a5f30d62d2a8498fd087'),
                             (MODEL016, self.binding016['modelSha256']), (MODEL017, self.binding017['modelSha256'])):
            assert sha(path) == digest, path
        # Historical schemas stay pinned; current application code is frozen
        # above and qualified by the HTTP cases, then checked for run-time drift.
        assert SERVICES / 'orion-pro.js' in graph
        if self.args.target == '017':
            assert sha(MIG / MIGRATIONS[5]) == '87aac35a93b8b0455a7dcf13fde5bb0be468d1183a0bf4a96f36b04b4b770458'
            assert sha(BIND017) == '72019db9540c0099f197b8cf1b41d63198347fb17b7d07d440cf77fbfa3e4d9c'
        self.report['initialProductImported'] = product in graph
        assert (product in graph) == (self.phase == 'after'), 'Run phase must match actual app dispatch'

    def count_sql(self, sql):
        entries = self.report['setupSql']
        assert len(entries) + self.runtime_sql < CAPS['sql'], 'External SQL limit'
        entries.append({'index': len(entries) + 1, 'sha256': hashlib.sha256(sql.encode()).hexdigest(),
                        'verb': sql.split(None, 1)[0]})

    def connect(self, db, role, *, readonly=False):
        assert sum(not c.closed for c in self.clients) + (self.server is not None) < CAPS['connections']
        c = self.psycopg.connect(host='127.0.0.1', port=self.pg.port, dbname=db, user=role,
            sslmode='disable', gssencmode='disable', connect_timeout=5, autocommit=True,
            passfile=self.clean_env['PGPASSFILE'], password='',
            options=OPTIONS + (' -c default_transaction_read_only=on' if readonly else ''))
        self.clients.append(c)
        return Counted(c, self)

    def migrate(self, name, applied):
        path = MIG / name
        body = path.read_text()
        digest = sha(path)
        assert self.sources[str(path.relative_to(ROOT))] == digest
        self.admin.execute(body, prepare=False)
        self.admin.execute('INSERT INTO ingest.schema_migrations VALUES(%s,%s,CURRENT_TIMESTAMP,%s)',
                           (name[:3], digest, 'owned-match-readers-e2e'))
        applied.append((name[:3], path, body))

    def setup(self):
        import psycopg
        from harness import LocalPostgres
        from typed_fixture import MatchReaderFixture
        from orion_pro_migrate import bootstrap
        from orion_pro_integrity import role_grants_sql
        self.psycopg, self.grants = psycopg, role_grants_sql
        env = self.clean_env

        class OwnedPG(LocalPostgres):
            def command(self, argv, *, env=env, check=True, name='command'):
                return super().command(argv, env=env, check=check, name=name)

        info = subprocess.check_output([str(self.args.node24), '-p',
            'JSON.stringify({version:process.version,arch:process.arch,platform:process.platform,rawJSON:typeof JSON.rawJSON})'],
            text=True, env=env, timeout=10)
        self.report['runtime'] = json.loads(info)
        self.report['runtimeVerification'] = verify_node24_runtime(self.args.node24, self.report['runtime'], SUMS)
        # Use an empty local libpq service/password source, never a user file.
        for key in ('PGPASSFILE', 'PGSERVICEFILE', 'PGPASSWORD'):
            os.environ[key] = env[key]
        os.environ.pop('PGSERVICE', None)
        self.pg = OwnedPG(self.args.pg_bin, self.run)
        self.pg.start()
        bootstrap_conn = self.connect('postgres', os.environ.get('USER', 'postgres'))
        assert bootstrap_conn.info.server_version == 180006
        self.report['postgresVersion'] = bootstrap_conn.info.server_version
        for role in (ROLE_OWNER, ROLE_WRITER, ROLE_RUNTIME):
            bootstrap_conn.execute('CREATE ROLE ' + role + ' LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS')
        bootstrap_conn.execute('CREATE DATABASE ' + DB + ' OWNER ' + ROLE_OWNER)
        bootstrap_conn.close()
        self.admin = self.connect(DB, ROLE_OWNER)
        self.writer = self.connect(DB, ROLE_WRITER)
        self.applied = []
        with self.admin.transaction():
            for name in MIGRATIONS[:4]:
                self.migrate(name, self.applied)
            self.report['bootstrap'] = bootstrap(self.admin, self.model, self.applied[:2])
            self.admin.execute(self.grants(self.model, ROLE_WRITER, ROLE_RUNTIME), prepare=False)
        self.fixture = MatchReaderFixture(self.admin, self.pg.dsn, self.run, psycopg)
        self.report['legacyFixture'] = self.fixture.prepare()
        self.count_rows('legacy103')

    def install016(self):
        self.model = json.loads(MODEL016.read_text())
        with self.admin.transaction():
            self.migrate(MIGRATIONS[4], self.applied)
            self.admin.execute(self.grants(self.model, ROLE_WRITER, ROLE_RUNTIME), prepare=False)
        self.fixture.bind_extended_model(MODEL016)
        self.fixture.conn = self.writer

    def install017(self):
        names = ("source_referee_label", "source_referee_state", "source_has_playoff",
                 "source_has_playoff_state", "source_league_image_url", "source_league_image_url_state")
        self.model = json.loads(MODEL017.read_text())
        with self.admin.transaction():
            self.migrate(MIGRATIONS[5], self.applied)
        actual = self.admin.execute("""SELECT column_name,data_type,is_nullable,column_default
            FROM information_schema.columns WHERE table_schema='football' AND table_name='match_observation_details'
            AND column_name=ANY(%s) ORDER BY column_name""", (list(names),)).fetchall()
        assert len(actual) == 6 and all(
            (kind, nullable, default) == (('text' if name != 'source_has_playoff' else 'boolean'),
                ('NO' if name.endswith('_state') else 'YES'), ("'unrecorded'::text" if name.endswith('_state') else None))
            for name, kind, nullable, default in actual), actual
        active, cols, fks = self.admin.execute("""SELECT
            (SELECT count(*) FROM pg_tables WHERE schemaname IN ('ingest','football','analytics')),
            (SELECT count(*) FROM information_schema.columns WHERE table_schema IN ('ingest','football','analytics')
             AND EXISTS (SELECT 1 FROM pg_tables t WHERE t.schemaname=table_schema AND t.tablename=table_name)),
            (SELECT count(*) FROM pg_constraint WHERE contype='f' AND connamespace IN ('ingest'::regnamespace,'football'::regnamespace,'analytics'::regnamespace))""").fetchone()
        assert (active, cols, fks) == (98, 1829, 447), (active, cols, fks)
        self.report['append017Schema'] = {'columns': actual, 'activeTables': active, 'activeColumns': cols, 'foreignKeys': fks}
        self.fixture.extend_core_model(MODEL017)

    def start_http(self, pro):
        assert self.server is None
        self.process_count += 1
        n = self.process_count
        env = {**self.clean_env, 'DATABASE_URL': f'postgresql://{ROLE_RUNTIME}@127.0.0.1:{self.pg.port}/{DB}?sslmode=disable',
               'DATABASE_POOL_MAX': '1', 'STATARENA_TEST_DATABASE': '1', 'STATARENA_DATA_PROVIDER': 'aws',
               'STATARENA_PRO_API': pro, 'STATARENA_CLOUDFRONT_URL': 'https://cdn.fixture.invalid/',
               'STATARENA_METRICS_SAMPLE_RATE': '1', 'STATARENA_SERVER_TIMING': '1'}
        self.out = (self.run / f'http-{n}.stdout.log').open('w')
        self.err = (self.run / f'http-{n}.stderr.log').open('w')
        self.server = subprocess.Popen([str(self.args.node24), str(HTTP_SERVER)], cwd=ROOT, env=env,
                                       stdout=subprocess.PIPE, stderr=self.err, text=True, bufsize=1)
        end = time.monotonic() + 15
        while time.monotonic() < end:
            ready, _, _ = select.select([self.server.stdout], [], [], 0.2)
            if ready:
                line = self.server.stdout.readline()
                self.out.write(line)
                self.out.flush()
                if not line and self.server.poll() is not None:
                    raise RuntimeError('Node24 actual-app server exited before ready')
                try:
                    info = json.loads(line)
                except ValueError:
                    continue
                if info.get('event') == 'ready':
                    self.origin = f"http://127.0.0.1:{info['port']}"
                    self.runtime_sql += 1
                    self.servers.append({'instance': n, 'proMode': pro, 'info': info, 'environmentKeys': sorted(env)})
                    return info
        raise TimeoutError('Actual-app server did not reach ready')

    def stop_http(self):
        if self.server is None:
            return
        if self.server.poll() is None:
            self.server.terminate()
        try:
            self.server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.server.kill()
            self.server.wait(timeout=5)
        self.server.stdout.close()
        self.out.close()
        self.err.close()
        if self.servers and self.servers[-1]['instance'] == self.process_count:
            self.servers[-1]['exitCode'] = self.server.returncode
        self.server = self.origin = self.out = self.err = None

    def fetch(self, request):
        assert self.http_count < CAPS['http'], 'Actual HTTP limit (including trace requests)'
        self.http_count += 1
        try:
            return self.open(request, timeout=12)
        except HTTPError as exc:
            return exc

    def http(self, path, *, method='GET', headers=None):
        ledger = self.report['requests']
        request_id = 'match-' + str(len(ledger) + 1)
        with self.fetch(Request(self.origin + path, method=method,
                                headers={'X-E2E-ID': request_id, **(headers or {})})) as response:
            raw = response.read(1024**2 + 1024)
            entry = {'id': request_id, 'serverInstance': self.process_count, 'path': path, 'method': method,
                'requestHeaders': headers or {}, 'status': response.status,
                'headers': {k.lower(): v for k, v in response.headers.items()},
                'bytes': len(raw), 'body': raw.decode(), 'bodySha256': hashlib.sha256(raw).hexdigest()}
        ledger.append(entry)
        with self.fetch(self.origin + '/__e2e__/traces') as response:
            trace_bytes = response.read(4 * 1024**2 + 1)
        assert len(trace_bytes) <= 4 * 1024**2
        traces = json.loads(trace_bytes)
        self.report['externalHttpAttempts'] += traces['externalAttempts'] - self.servers[-1].get('externalAttempts', 0)
        self.servers[-1]['externalAttempts'] = traces['externalAttempts']
        trace = next(record for record in traces['requests'] if record['id'] == request_id)
        entry['sql'] = trace['sql']
        self.runtime_sql += len(entry['sql'])
        assert self.runtime_sql + len(self.report['setupSql']) <= CAPS['sql']
        assert trace['status'] == entry['status'] and self.report['externalHttpAttempts'] == 0
        assert len(raw) < 1024**2 + 1024, 'Unexpected output exceeded the bounded read'
        return entry

    def count_rows(self, label):
        tables = [t['qualified_name'] for s in self.model['schemas'] for t in s['tables'] if t['phase'] != 'models']
        # A single query counts the full typed fixture, including historical rows.
        parts = [f"(SELECT count(*) FROM {name})" for name in tables]
        count = self.admin.execute('SELECT ' + '+'.join(parts)).fetchone()[0]
        assert count <= CAPS['typedRows'], count
        self.report['typedRows'][label] = count
        return count

    def sequences(self):
        cur = self.admin.execute("""SELECT schemaname,sequencename,last_value FROM pg_sequences
            WHERE schemaname IN ('ingest','football','analytics') ORDER BY 1,2""")
        return cur.fetchall()

    def boundary(self):
        from http_cases import FORBIDDEN
        queries = [q['sql'] for r in self.report['requests'] for q in r['sql']]
        assert not any(FORBIDDEN.search(sql) for sql in queries)
        assert all(not q.get('error') for r in self.report['requests'] for q in r['sql'])
        assert self.report['externalHttpAttempts'] == 0
        self.report['runtimeBoundary'] = {'schemas': ['analytics', 'football', 'ingest'],
            'sourceProviderAccess': False, 'localCredentialFilesEmpty': True, 'observedRuntimeQueries': len(queries)}

    def runtime_write_denied(self):
        c = self.connect(DB, ROLE_RUNTIME)
        try:
            try:
                c.execute("UPDATE football.matches SET status='finished' WHERE false")
            except self.psycopg.Error as error:
                assert error.sqlstate == '42501', (error.sqlstate, error)
                self.report['runtimeWriteDenial'] = {'sqlstate': error.sqlstate, 'message': error.diag.message_primary}
            else:
                raise AssertionError('Runtime role unexpectedly has a typed write permission')
        finally:
            c.close()

    def cleanup(self):
        self.stop_http()
        for c in self.clients:
            if not c.closed:
                c.close()
        if self.pg:
            self.report['ownedDiskBytesBeforeCleanup'] = size(self.pg.root)
            self.report['cleanup'] = self.pg.cleanup()
            assert self.report['ownedDiskBytesBeforeCleanup'] <= CAPS['ownedDiskBytes']
        else:
            self.report['cleanup'] = {'owned_cluster_started': False}
        self.report['httpServers'] = self.servers
        self.report['allConnectionsClosed'] = all(c.closed for c in self.clients)
        self.report['actualHttpRequests'] = self.http_count
        self.report['runtimeSqlCalls'] = self.runtime_sql
        self.report['externalSqlCalls'] = len(self.report['setupSql']) + self.runtime_sql
        self.report['changedInputs'] = [name for name, expected in self.sources.items()
            if not (ROOT / name).is_file() or sha(ROOT / name) != expected]
        assert not self.report['changedInputs'], self.report['changedInputs']


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--phase', choices=('red', 'after'), required=True)
    parser.add_argument('--target', choices=('016', '017'), default='016')
    parser.add_argument('--label', required=True)
    parser.add_argument('--deadline-seconds', type=int, choices=(60, 600), default=600)
    parser.add_argument('--node24', type=Path, default=Path(DEFAULT_NODE))
    parser.add_argument('--pg-bin', type=Path, default=Path(DEFAULT_PG))
    args = parser.parse_args()
    if not re.fullmatch('[A-Za-z0-9][A-Za-z0-9-]{0,70}', args.label):
        parser.error('Simple label required')
    if args.phase == 'red' and args.target != '016':
        parser.error('Unwired app RED uses original016 binding')
    run = BASE / 'runs' / (datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ') + '-' + args.label)
    run.mkdir(parents=True, exist_ok=False)
    report = {'kind': 'source-free-owned-actual-Node24-native-match-http-e2e',
        'phase': args.phase, 'target': args.target, 'start': datetime.now(timezone.utc).isoformat(),
        'command': [sys.executable, 'tests/orion_pro_match_readers_local.py', *sys.argv[1:]],
        'workdir': str(ROOT), 'authorizationBounds': {**CAPS, 'seconds': args.deadline_seconds}, 'protocol': 'PROTOCOL.md / CORE_017_E2E.md',
        'cases': [], 'requests': [], 'setupSql': [], 'typedRows': {}, 'publications': {},
        'externalHttpAttempts': 0, 'remoteActions': [],
        'limitations': ['Ordinary guarded synthetic READY inputs; not qualification of the production publisher',
                        'No real source, deployed API, production latency or cutover acceptance'],
        'status': 'fail'}
    started, h, blocked = time.monotonic(), None, None
    ids = ['R' + str(i).zfill(2) for i in range(1, 33)]
    if args.target == '017':
        ids = ['R01', 'R02', 'R03', 'R04', 'R05', 'R06', 'R10', 'R11', 'R15', 'R18', 'R23', 'R30', 'R32']
        ids += ['C' + str(i).zfill(2) for i in range(1, 11)]

    def timed_out(signum, frame):
        raise TimeoutError('Owned campaign deadline, stop and clean up')

    signal.signal(signal.SIGALRM, timed_out)
    signal.setitimer(signal.ITIMER_REAL, args.deadline_seconds - 15)
    try:
        from http_cases import Cases
        h = Harness(args, run, report)
        h.freeze()
        h.setup()
        cases = Cases(h)
        for name in ids:
            case_start = time.monotonic()
            if blocked:
                report['cases'].append({'case': name, 'status': 'unverified', 'reason': blocked})
                continue
            before = len(report['requests'])
            try:
                status = getattr(cases, name.lower())() or 'pass'
                if status == 'observed-red':
                    blocked = 'Intentional actual app baseline 501; stop at R02'
                    report['status'] = status
                report['cases'].append({'case': name, 'status': status,
                    'requestIds': [r['id'] for r in report['requests'][before:]],
                    'elapsedMs': round((time.monotonic() - case_start) * 1000, 3)})
            except Exception as exc:
                blocked = f'{name}: {type(exc).__name__}'
                report['cases'].append({'case': name, 'status': 'fail', 'error': str(exc)[:4000],
                    'requestIds': [r['id'] for r in report['requests'][before:]]})
                (run / 'first-failure.log').write_text(traceback.format_exc())
        if not blocked:
            report['status'] = 'pass'
    except Exception as exc:
        report['setupFailure'] = {'type': type(exc).__name__, 'error': str(exc)[:4000]}
        report['cases'] = [{'case': name, 'status': 'unverified', 'reason': 'Setup failed'} for name in ids]
        (run / 'first-failure.log').write_text(traceback.format_exc())
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        if h:
            try:
                h.cleanup()
            except Exception as exc:
                report['status'] = 'fail'
                report['cleanupFailure'] = str(exc)[:4000]
                (run / 'cleanup-failure.log').write_text(traceback.format_exc())
        report['elapsedSeconds'] = round(time.monotonic() - started, 3)
        result = run / 'result.json'
        result.write_text(json.dumps(report, indent=2, ensure_ascii=False, default=str) + '\n')
        if size(run) > CAPS['evidenceBytes'] or report['elapsedSeconds'] > args.deadline_seconds:
            report['status'] = 'fail'
            report['budgetOverrun'] = {'evidenceBytes': size(run), 'elapsedSeconds': report['elapsedSeconds']}
            result.write_text(json.dumps(report, indent=2, ensure_ascii=False, default=str) + '\n')
        print(json.dumps({'status': report['status'], 'passed': sum(c['status'] == 'pass' for c in report['cases']),
            'elapsedSeconds': report['elapsedSeconds'], 'externalSqlCalls': report.get('externalSqlCalls'),
            'actualHttpRequests': report.get('actualHttpRequests'), 'evidence': str(result.relative_to(ROOT)),
            'sha256': sha(result)}, indent=2))
    return 0 if report['status'] == 'pass' else 1


if __name__ == '__main__':
    raise SystemExit(main())
