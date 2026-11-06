#!/usr/bin/env python3
"""Actual Node24 and owned PG017 player-statistics composite publication E2E."""
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

from orion_pro_match_readers_local import (
    APP, BASE as MATCH_PROOF, BIND016, BIND017, CAPS, DEFAULT_NODE, DEFAULT_PG,
    DOC, Harness, HTTP_SERVER, MIG, MIGRATIONS, MODEL103, MODEL016, MODEL017,
    PILOT, ROOT, SUMS, sha, size,
)
BASE = DOC / 'orion-pro-player-statistics-20261105'
PRODUCT = APP.parent / 'services/orion-pro-match-statistics.js'
sys.path.insert(0, str(BASE))


class PeriodHarness(Harness):
    def freeze(self):
        import orion_pro_match_readers_local as lifecycle
        imports = re.compile(r'(?:from\s*|import\s*)["\'](\.[^"\']+)["\']')
        graph, queue = set(), [APP, HTTP_SERVER]
        while queue:
            file = queue.pop()
            if file in graph:
                continue
            graph.add(file)
            for link in imports.findall(file.read_text()):
                child = (file.parent / link).resolve()
                if child.is_file() and 'node_modules' not in child.parts and child.is_relative_to(ROOT):
                    queue.append(child)
        files = graph | {Path(__file__), Path(lifecycle.__file__),
            BASE / 'STATISTICS_PUBLICATION.json', BASE / 'PLAYER_PERIOD_PROTOCOL.md',
            BASE / 'player_period_fixture.py', BASE / 'player_period_cases.py',
            MODEL103, MODEL016, MODEL017, BIND016, BIND017, SUMS,
            ROOT / 'tests/orion_node24_runtime.py', ROOT / 'dashboard/package.json',
            DOC / 'orion-pro-readers-20261104/fixture.py', PILOT / 'fixtures.py', PILOT / 'harness.py'}
        files.update(MATCH_PROOF / n for n in ('fixture_publisher.py','typed_fixture.py','synthetic_inputs.py','http_cases.py'))
        files.update(MIG / name for name in MIGRATIONS)
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
        expected = {
            MODEL103: '18da43f940870b7a3a3cb49323c847dd5e5174e5eea1f8ff0c8a159cf373cb08',
            MODEL016: self.binding016['modelSha256'], MODEL017: self.binding017['modelSha256'],
            MIG / MIGRATIONS[4]: '12d63eaab6f4d610de3f2ff4efc0dcd71059c4d2e489a5f30d62d2a8498fd087',
            MIG / MIGRATIONS[5]: '87aac35a93b8b0455a7dcf13fde5bb0be468d1183a0bf4a96f36b04b4b770458',
            BASE / 'STATISTICS_PUBLICATION.json': '52b47b0d2b7c0e80c160f9d61bf4a9a5d0dbdaf97a4839e12bcee23fa3fbfb77',
        }
        assert all(sha(path) == digest for path, digest in expected.items())
        assert APP.parent / 'services/orion-pro.js' in graph
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
    report = {'kind': 'owned-actual-Node24-composite-player-period-e2e',
        'phase': args.phase, 'start': datetime.now(timezone.utc).isoformat(), 'workdir': str(ROOT),
        'command': [sys.executable, 'tests/orion_pro_player_period_local.py', *sys.argv[1:]],
        'authorizationBounds': {**CAPS, 'seconds': 120},
        'protocol': 'PLAYER_PERIOD_PROTOCOL.md / P01–P14', 'installedMigrations': MIGRATIONS,
        'cases': [], 'requests': [], 'setupSql': [], 'typedRows': {}, 'externalHttpAttempts': 0,
        'remoteActions': [], 'publications': {}, 'status': 'fail',
        'limits': ['Synthetic owned reader qualification with independent typed closure; no production publisher or source acceptance',
                   'Normalized period/metric projection; no raw independent subject archive claim']}
    started, harness, blocked = time.monotonic(), None, None
    ids = [f'P{i:02}' for i in range(1, 15)]

    def timed_out(signum, frame):
        raise TimeoutError('Owned player period deadline; stop and clean up')

    signal.signal(signal.SIGALRM, timed_out)
    signal.setitimer(signal.ITIMER_REAL, 105)
    try:
        from player_period_cases import PlayerPeriodCases
        harness = PeriodHarness(args, run, report)
        harness.freeze()
        harness.setup()
        cases = PlayerPeriodCases(harness)
        for name in ids:
            if blocked:
                report['cases'].append({'case': name, 'status': 'unverified', 'reason': blocked})
                continue
            index = len(report['requests'])
            start = time.monotonic()
            try:
                status = getattr(cases, name.lower())() or 'pass'
                if status == 'observed-red':
                    report['status'] = status
                    blocked = 'Intentional actual handler 501 at P02 before router integration'
                report['cases'].append({'case': name, 'status': status,
                    'requests': [r['id'] for r in report['requests'][index:]],
                    'elapsedMs': round((time.monotonic() - start) * 1000, 3)})
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
        if report['elapsedSeconds'] > 120 or size(run) > CAPS['evidenceBytes']:
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
