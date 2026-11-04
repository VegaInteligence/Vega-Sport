#!/usr/bin/env python3
"""Before-code read-only CLI E2E for the RDS pilot gate; never invokes --apply."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'docs/verification/orion-pro-pilot-20261104'
WRAPPER = ROOT / 'dashboard/scripts/orion_pro_rds.py'
CASES = ['wrapper_available', 'help_modes', 'offline_plan', 'conflicting_modes',
         'malformed_digest', 'offline_apply_prerequisites', 'tampered_preflight']


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--label', default='offline-gates')
    a = p.parse_args()
    if not a.label.replace('-', '').isalnum():
        p.error('Use a simple label')
    run = BASE / 'rds-gate-runs' / (datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ') + '-' + a.label)
    inputs = run / 'inputs'; inputs.mkdir(parents=True)
    report = {'kind': 'read_only_rds_gate_cli_e2e', 'startedAt': datetime.now(timezone.utc).isoformat(),
              'command': f'python3 tests/orion_pro_rds_gate.py --label {a.label}',
              'setup': 'CLI subprocesses; temporary AWS sentinel; no database connection; --apply is never invoked',
              'expected': 'RDS_PROTOCOL.md failure matrix', 'cases': [], 'commands': [], 'remoteWrites': [],
              'sourceSha256': {}, 'limits': ['Actual remote apply and rollback behavior remain unexecuted']}
    for source in [Path(__file__), BASE / 'RDS_PROTOCOL.md', WRAPPER]:
        if source.exists():
            shutil.copy2(source, inputs / source.name)
            report['sourceSha256'][str(source.relative_to(ROOT))] = sha(source)
    blocked = None
    with tempfile.TemporaryDirectory(prefix='orion-pro-rds-gate-') as temp:
        tmp = Path(temp); sentinel = tmp / 'aws-called'
        aws = tmp / 'aws'
        aws.write_text('#!/bin/sh\nprintf called >> "$ORION_AWS_SENTINEL"\nexit 97\n'); aws.chmod(0o700)
        env = os.environ.copy(); env.update(PATH=str(tmp) + os.pathsep + env['PATH'], ORION_AWS_SENTINEL=str(sentinel))

        def invoke(args):
            cmd = [sys.executable, str(WRAPPER), *args]
            got = subprocess.run(cmd, cwd=ROOT, env=env, text=True, capture_output=True, timeout=60)
            n = len(report['commands']) + 1
            for suffix, body in [('stdout', got.stdout), ('stderr', got.stderr)]:
                (run / f'{n:02d}.{suffix}.log').write_text(body)
            report['commands'].append({'argv': ['python3', str(WRAPPER.relative_to(ROOT)), *args], 'exitCode': got.returncode,
                                       'stdout': f'{n:02d}.stdout.log', 'stderr': f'{n:02d}.stderr.log'})
            assert not sentinel.exists(), 'Offline gate unexpectedly invoked AWS'
            return got

        for case in CASES:
            if blocked:
                report['cases'].append({'case': case, 'status': 'unverified', 'reason': blocked}); continue
            try:
                if case == 'wrapper_available':
                    assert WRAPPER.is_file(), 'RDS wrapper is missing (expected initial RED)'
                    actual = {'wrapperSha256': sha(WRAPPER)}
                elif case == 'help_modes':
                    got = invoke(['--help']); assert got.returncode == 0
                    for flag in ['--plan', '--preflight', '--check-apply', '--apply', '--expect-model-sha256']:
                        assert flag in got.stdout, flag
                    actual = {'helpAvailable': True}
                elif case == 'offline_plan':
                    got = invoke(['--plan', '--label', 'cli-e2e-offline'])
                    assert got.returncode in (0, 2), got.returncode
                    data = json.loads(got.stdout)
                    receipt = json.loads((ROOT / data['receipt']).read_text())
                    assert receipt['mode'] == 'plan' and receipt['remoteWrites'] == []
                    assert set(receipt['plan']['migrationSha256']) == {'012', '013'}
                    assert receipt['plan']['remoteScope'] == 'schema_and_bootstrap_only'
                    actual = {'status': receipt['status'], 'receipt': data['receipt'], 'awsCalls': 0}
                elif case == 'conflicting_modes':
                    got = invoke(['--plan', '--preflight']); assert got.returncode == 2
                    actual = {'exitCode': got.returncode}
                elif case == 'malformed_digest':
                    got = invoke(['--check-apply', '--expect-model-sha256', 'not-a-hash']); assert got.returncode == 2
                    actual = {'exitCode': got.returncode}
                elif case == 'offline_apply_prerequisites':
                    got = invoke(['--check-apply', '--label', 'cli-e2e-missing-acceptance'])
                    assert got.returncode == 2
                    data = json.loads(got.stdout); receipt = json.loads((ROOT / data['receipt']).read_text())
                    assert receipt['mode'] == 'check_apply' and receipt['status'] == 'blocked'
                    assert any('acceptance' in str(x).lower() for x in receipt['blockers'])
                    actual = {'blockers': receipt['blockers'], 'awsCalls': 0}
                else:
                    invalid = tmp / 'tampered.json'; invalid.write_text('{"status":"ready"}\n')
                    got = invoke(['--check-apply', '--preflight-receipt', str(invalid), '--preflight-sha256', '0' * 64,
                                  '--label', 'cli-e2e-tampered'])
                    assert got.returncode == 2
                    data = json.loads(got.stdout); receipt = json.loads((ROOT / data['receipt']).read_text())
                    assert any('digest' in str(x).lower() for x in receipt['blockers'])
                    actual = {'blockers': receipt['blockers'], 'awsCalls': 0}
                report['cases'].append({'case': case, 'status': 'pass', 'actual': actual})
            except Exception as exc:
                report['cases'].append({'case': case, 'status': 'fail', 'errorType': type(exc).__name__, 'reason': str(exc)})
                blocked = f'Prerequisite failed: {case}'
    report['finishedAt'] = datetime.now(timezone.utc).isoformat()
    report['counts'] = {s: sum(c['status'] == s for c in report['cases']) for s in ['pass', 'fail', 'unverified']}
    report['status'] = 'pass' if report['counts']['pass'] == len(CASES) else 'fail'
    (run / 'result.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'status': report['status'], 'counts': report['counts'], 'result': str((run / 'result.json').relative_to(ROOT))}))
    return 0 if report['status'] == 'pass' else 1


if __name__ == '__main__':
    raise SystemExit(main())
