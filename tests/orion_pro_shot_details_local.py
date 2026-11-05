#!/usr/bin/env python3
"""Owned PG103 and actual Node24 handler E2E for normalized shot detail aliases."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import shutil
import signal
import sys
import time
import traceback
from urllib.request import ProxyHandler, build_opener

from orion_pro_match_readers_local import (
    APP, BASE as MATCH_PROOF, CAPS, DEFAULT_NODE, DEFAULT_PG, DOC,
    Harness, HTTP_SERVER, MIG, MIGRATIONS, MODEL103, PILOT, ROOT, SUMS, sha, size,
)

BASE = DOC / 'orion-pro-player-statistics-20261105'
PRODUCT = APP.parent / 'services/orion-pro-player-statistics.js'
sys.path.insert(0, str(BASE))


class ShotHarness(Harness):
    """Reuse the qualified lifecycle, with a strictly 103-only setup."""

    def __init__(self, args, run, report):
        # The inherited HTTP/setup/cleanup machinery is independent of 016/017.
        # Do not read the native bindings or install either native migration.
        self.args, self.phase, self.run, self.report = args, args.phase, run, report
        self.pg = self.server = self.origin = self.out = self.err = None
        self.admin = self.writer = self.fixture = None
        self.process_count = self.runtime_sql = self.http_count = 0
        self.clients, self.servers, self.sources = [], [], {}
        self.clean_env = {'PATH': '/usr/bin:/bin:/usr/sbin:/sbin:' + str(args.node24.parent)}
        for key, name in [('PGPASSFILE', 'empty.pgpass'), ('PGSERVICEFILE', 'empty.pg_service.conf')]:
            path = run / name
            path.write_text('')
            path.chmod(0o600)
            self.clean_env[key] = str(path)
        self.clean_env['PGPASSWORD'] = ''
        self.open = build_opener(ProxyHandler({})).open
        self.model = json.loads(MODEL103.read_text())

    def setup(self):
        from shot_cases import ShotFixture
        super().setup()
        self.fixture = ShotFixture.from_prepared(self.fixture)

    def freeze(self):
        import orion_pro_match_readers_local as lifecycle
        import shot_cases
        imports = re.compile(r'(?:from\s*|import\s*)["\'](\.[^"\']+)["\']')
        graph, todo = set(), [APP, HTTP_SERVER]
        while todo:
            file = todo.pop()
            if file in graph:
                continue
            graph.add(file)
            for link in imports.findall(file.read_text()):
                child = (file.parent / link).resolve()
                if child.is_file() and 'node_modules' not in child.parts and child.is_relative_to(ROOT):
                    todo.append(child)
        files = graph | {Path(__file__), Path(lifecycle.__file__), Path(shot_cases.__file__),
            BASE / 'SHOT_PROTOCOL.md', BASE / 'ROUTE_SCOPE.md', BASE / 'SOURCE_SHAPES.json',
            MODEL103, SUMS, ROOT / 'tests/orion_node24_runtime.py', ROOT / 'dashboard/package.json',
            PILOT / 'fixtures.py', PILOT / 'harness.py', DOC / 'orion-pro-readers-20261104/fixture.py',
            MATCH_PROOF / 'typed_fixture.py', MATCH_PROOF / 'synthetic_inputs.py'}
        files.update(MIG / name for name in MIGRATIONS[:4])
        files.update(ROOT / 'dashboard/scripts' / (name + '.py')
                     for name in ('orion_pro_migrate', 'orion_pro_integrity', 'orion_pro_schema'))
        if PRODUCT.is_file():
            files.add(PRODUCT)
        for path in sorted(files):
            relative = path.relative_to(ROOT)
            dest = self.run / 'inputs' / relative
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, dest)
            self.sources[str(relative)] = sha(path)
        assert sha(MODEL103) == '18da43f940870b7a3a3cb49323c847dd5e5174e5eea1f8ff0c8a159cf373cb08'
        assert sha(APP.parent / 'services/orion-pro.js') == '4815cdfb184fbae31fa501b50695b235c2ca14b85660db6e6aee8f5fef979616'
        self.report['inputSha256'] = self.sources
        self.report['initialProductImported'] = PRODUCT in graph
        assert (PRODUCT in graph) == (self.phase == 'after'), 'Actual app import does not match phase'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--phase', choices=('red', 'after'), required=True)
    parser.add_argument('--label', required=True)
    parser.add_argument('--node24', type=Path, default=Path(DEFAULT_NODE))
    parser.add_argument('--pg-bin', type=Path, default=Path(DEFAULT_PG))
    args = parser.parse_args()
    if not re.fullmatch('[A-Za-z0-9][A-Za-z0-9-]{0,70}', args.label):
        parser.error('Simple label required')
    run = BASE / 'runs' / (datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ') + '-' + args.label)
    run.mkdir(parents=True, exist_ok=False)
    report = {'kind': 'owned-actual-Node24-normalized-shot-details-e2e',
        'phase': args.phase, 'start': datetime.now(timezone.utc).isoformat(), 'workdir': str(ROOT),
        'command': [sys.executable, 'tests/orion_pro_shot_details_local.py', *sys.argv[1:]],
        'authorizationBounds': {**CAPS, 'seconds': 90},
        'protocol': 'SHOT_PROTOCOL.md / S01–S14', 'installedMigrations': MIGRATIONS[:4],
        'cases': [], 'requests': [], 'setupSql': [], 'typedRows': {}, 'externalHttpAttempts': 0,
        'remoteActions': [], 'status': 'fail',
        'limits': ['Synthetic owned local reader qualification; no hosted or source-coverage claims',
                   'This is an explicit normalized V1 projection, not the independent raw subject-resource body']}
    started, harness, blocked = time.monotonic(), None, None
    ids = [f'S{i:02}' for i in range(1, 15)]

    def timed_out(signum, frame):
        raise TimeoutError('Owned shot detail deadline; stop and clean up')

    signal.signal(signal.SIGALRM, timed_out)
    signal.setitimer(signal.ITIMER_REAL, 75)
    try:
        from shot_cases import ShotCases
        harness = ShotHarness(args, run, report)
        harness.freeze()
        harness.setup()
        cases = ShotCases(harness)
        for name in ids:
            if blocked:
                report['cases'].append({'case': name, 'status': 'unverified', 'reason': blocked})
                continue
            index = len(report['requests'])
            case_start = time.monotonic()
            try:
                status = getattr(cases, name.lower())() or 'pass'
                if status == 'observed-red':
                    report['status'] = status
                    blocked = 'Intentional actual handler 501 at S02 before router integration'
                report['cases'].append({'case': name, 'status': status,
                    'requests': [r['id'] for r in report['requests'][index:]],
                    'elapsedMs': round((time.monotonic() - case_start) * 1000, 3)})
            except Exception as exc:
                blocked = f'{name}: {type(exc).__name__}'
                report['cases'].append({'case': name, 'status': 'fail', 'error': str(exc)[:4000],
                    'requests': [r['id'] for r in report['requests'][index:]]})
                (run / 'first-failure.log').write_text(traceback.format_exc())
        if not blocked:
            report['status'] = 'pass'
    except Exception as exc:
        report['setupFailure'] = {'type': type(exc).__name__, 'error': str(exc)[:4000]}
        report['cases'] = [{'case': name, 'status': 'unverified', 'reason': 'Setup failed'} for name in ids]
        (run / 'first-failure.log').write_text(traceback.format_exc())
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        if harness:
            try:
                harness.cleanup()
            except Exception as exc:
                report['status'] = 'fail'
                report['cleanupFailure'] = str(exc)[:4000]
                (run / 'cleanup-failure.log').write_text(traceback.format_exc())
        report['elapsedSeconds'] = round(time.monotonic() - started, 3)
        result = run / 'result.json'
        result.write_text(json.dumps(report, indent=2, ensure_ascii=False, default=str) + '\n')
        if report['elapsedSeconds'] > 90 or size(run) > CAPS['evidenceBytes']:
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
