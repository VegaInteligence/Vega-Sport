#!/usr/bin/env python3
"""Test-first real-process E2E for the new bounded-child helper; no PG."""
from __future__ import annotations
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
from datetime import datetime, timezone

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'docs/verification/orion-pro-bulk-stream-v2-local-20261105/process-budget'
HELPER = ROOT / 'tests/orion_e2e_process.py'
CASES = ['helper_available', 'exact_output', 'shared_deadline', 'resource_stop_kills_term_ignoring_child',
         'expired_deadline_no_launch', 'output_limit', 'descendant_pipe_drain']

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--label', required=True)
    args = parser.parse_args()
    assert args.label and all(c.isalnum() or c == '-' for c in args.label)
    run = BASE / (datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ') + '-' + args.label)
    (run / 'inputs').mkdir(parents=True)
    for path in [Path(__file__), HELPER, BASE.parent / 'ROOT_REVISION_PROTOCOL.md']:
        if path.is_file():
            shutil.copy2(path, run / 'inputs' / path.name)
    report = {'kind': 'owned_process_budget_real_e2e_v1', 'command': [sys.executable, str(Path(__file__)), *sys.argv[1:]],
              'expected': 'ROOT_REVISION_PROTOCOL.md', 'cases': [], 'postgresStarts': 0, 'remoteCalls': 0,
              'fullAcceptance': False}
    private = Path(tempfile.mkdtemp(prefix='orion-process-budget-'))
    tracked = []
    blocker = None
    helper = None
    def command(code):
        return [sys.executable, '-c', code]
    def stopped(code, **kwargs):
        try:
            helper.run_bounded(command(code), **kwargs)
        except helper.ChildStopped as error:
            if error.pid:
                tracked.append(error.pid)
            return error
        raise AssertionError('Expected a bounded child stop')
    def dead(pid):
        state = subprocess.run(['ps', '-o', 'stat=', '-p', str(pid)], capture_output=True, text=True, timeout=2)
        return not state.stdout.strip() or state.stdout.strip().startswith('Z')
    try:
        for name in CASES:
            if blocker:
                report['cases'].append({'case': name, 'status': 'unverified', 'reason': blocker})
                continue
            started = time.monotonic()
            try:
                actual = {}
                if name == 'helper_available':
                    assert HELPER.is_file(), 'New bounded-child helper absent'
                    spec = importlib.util.spec_from_file_location('new_process_budget_helper', HELPER)
                    helper = importlib.util.module_from_spec(spec)
                    spec.loader.exec_module(helper)
                elif name == 'exact_output':
                    got = helper.run_bounded(command("import sys;print('été ⚽');print('diagnostic',file=sys.stderr);sys.exit(7)"), deadline=time.monotonic() + 2)
                    assert (got.stdout, got.stderr, got.returncode) == ('été ⚽\n', 'diagnostic\n', 7)
                    actual = {'exitCode': got.returncode, 'stdout': got.stdout, 'stderr': got.stderr}
                elif name == 'shared_deadline':
                    deadline = time.monotonic() + .6
                    helper.run_bounded(command('import time;time.sleep(.35)'), deadline=deadline)
                    error = stopped('import time;time.sleep(5)', deadline=deadline, term_seconds=.1, drain_seconds=.2)
                    assert error.reason == 'deadline' and error.returncode is not None and dead(error.pid)
                    assert time.monotonic() - started < 1.5
                    actual = {'reason': error.reason, 'returncode': error.returncode, 'sharedDeadline': True}
                elif name == 'resource_stop_kills_term_ignoring_child':
                    ready = private / 'term-ignoring-ready'
                    reason = []
                    def cancel():
                        end = time.monotonic() + 2
                        while not ready.exists() and time.monotonic() < end:
                            time.sleep(.01)
                        reason.append('owned_disk_limit')
                    thread = threading.Thread(target=cancel)
                    thread.start()
                    code = "import signal,time;from pathlib import Path;signal.signal(signal.SIGTERM,signal.SIG_IGN);Path(" + repr(str(ready)) + ").touch();time.sleep(30)"
                    error = stopped(code, deadline=time.monotonic() + 4, stop_reason=lambda: reason[0] if reason else None, term_seconds=.1, drain_seconds=.2)
                    thread.join(2)
                    assert ready.exists() and error.reason == 'owned_disk_limit' and error.returncode == -signal.SIGKILL and dead(error.pid)
                    assert time.monotonic() - started < 2
                    actual = {'reason': error.reason, 'returncode': error.returncode, 'ownedChildStopped': True}
                elif name == 'expired_deadline_no_launch':
                    marker = private / 'must-not-launch'
                    error = stopped('from pathlib import Path;Path(' + repr(str(marker)) + ').touch()', deadline=time.monotonic() - 1)
                    assert error.pid is None and error.reason == 'deadline' and not marker.exists()
                    actual = {'pid': None, 'markerAbsent': True}
                elif name == 'output_limit':
                    error = stopped("import os,time;os.write(1,b'x'*200000);time.sleep(20)", deadline=time.monotonic() + 3, output_limit=1024, term_seconds=.1, drain_seconds=.2)
                    assert error.reason == 'output_limit' and len(error.stdout.encode()) <= 1024 and dead(error.pid)
                    actual = {'reason': error.reason, 'retainedBytes': len(error.stdout.encode())}
                elif name == 'descendant_pipe_drain':
                    pidfile = private / 'descendant-pid'
                    code = "import subprocess,sys;from pathlib import Path;p=subprocess.Popen([sys.executable,'-c','import time;time.sleep(30)']);Path(" + repr(str(pidfile)) + ").write_text(str(p.pid))"
                    error = stopped(code, deadline=time.monotonic() + 4, term_seconds=.1, drain_seconds=.2)
                    descendant = int(pidfile.read_text())
                    tracked.append(descendant)
                    assert error.reason == 'pipe_drain' and dead(descendant) and time.monotonic() - started < 2
                    actual = {'reason': error.reason, 'descendantStopped': True}
                report['cases'].append({'case': name, 'status': 'pass', 'elapsedSeconds': round(time.monotonic() - started, 4), 'actual': actual})
            except Exception as error:
                report['cases'].append({'case': name, 'status': 'fail', 'errorType': type(error).__name__, 'reason': str(error)})
                blocker = name
    finally:
        report['processCleanup'] = all(dead(pid) for pid in tracked)
        shutil.rmtree(private)
        report['privateFixtureRemoved'] = not private.exists()
        report['counts'] = {status: sum(c['status'] == status for c in report['cases']) for status in ['pass', 'fail', 'unverified']}
        report['status'] = 'pass' if report['counts'] == {'pass': 7, 'fail': 0, 'unverified': 0} and report['processCleanup'] and report['privateFixtureRemoved'] else 'fail'
        report['inputs'] = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in (run / 'inputs').iterdir()}
        (run / 'result.json').write_text(json.dumps(report, indent=2) + '\n')
        print(json.dumps({'status': report['status'], 'counts': report['counts'], 'evidence': str(run / 'result.json')}))
    return 0 if report['status'] == 'pass' else 1

if __name__ == '__main__':
    raise SystemExit(main())
