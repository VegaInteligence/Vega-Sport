"""Bound a newly owned E2E child by one absolute campaign deadline."""
from __future__ import annotations

import os
import selectors
import signal
import subprocess
import time


class ChildStopped(RuntimeError):
    def __init__(self, reason, pid=None, returncode=None, stdout='', stderr=''):
        super().__init__('Owned E2E child stopped: ' + reason)
        self.reason, self.pid, self.returncode = reason, pid, returncode
        self.stdout, self.stderr = stdout, stderr


def run_bounded(args, *, deadline, stop_reason=lambda: None, cwd=None, env=None,
                term_seconds=1., drain_seconds=1., output_limit=8 * 1024 ** 2):
    reason = stop_reason() or ('deadline' if time.monotonic() >= deadline else None)
    if reason:
        raise ChildStopped(reason)
    if output_limit <= 0 or term_seconds < 0 or drain_seconds <= 0:
        raise ValueError('Positive output/drain bounds and nonnegative TERM grace required')
    process = subprocess.Popen(args, cwd=cwd, env=env, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, start_new_session=True)
    selector = selectors.DefaultSelector()
    output = {'stdout': bytearray(), 'stderr': bytearray()}
    retained = 0
    exited_at = term_at = kill_at = None

    def send(sig):
        # Popen created this distinct session/process group; never target PG or
        # the caller's process group. A dead group simply needs no signal.
        assert process.pid != os.getpgrp()
        try:
            os.killpg(process.pid, sig)
        except ProcessLookupError:
            pass

    for stream, name in [(process.stdout, 'stdout'), (process.stderr, 'stderr')]:
        os.set_blocking(stream.fileno(), False)
        selector.register(stream, selectors.EVENT_READ, name)
    try:
        while selector.get_map() or process.poll() is None:
            now = time.monotonic()
            reason = reason or stop_reason() or ('deadline' if now >= deadline else None)
            if process.poll() is not None:
                exited_at = now if exited_at is None else exited_at
                if selector.get_map() and now - exited_at >= drain_seconds:
                    reason = reason or 'pipe_drain'
            if reason and term_at is None:
                send(signal.SIGTERM)
                term_at = now
            if term_at is not None and kill_at is None and now - term_at >= term_seconds:
                send(signal.SIGKILL)
                kill_at = now
            if kill_at is not None and now - kill_at >= drain_seconds:
                break
            for key, _ in selector.select(.05):
                try:
                    chunk = os.read(key.fd, 65536)
                except BlockingIOError:
                    continue
                if not chunk:
                    selector.unregister(key.fileobj)
                    key.fileobj.close()
                    continue
                take = min(len(chunk), max(0, output_limit - retained))
                output[key.data].extend(chunk[:take])
                retained += take
                if take != len(chunk):
                    reason = reason or 'output_limit'
        returncode = process.wait(timeout=1)
    finally:
        # Interrupts and unexpected selector failures also release the exact
        # owned child; pipe draining itself has a fixed deadline.
        if process.poll() is None or selector.get_map():
            send(signal.SIGKILL)
        for key in list(selector.get_map().values()):
            selector.unregister(key.fileobj)
            key.fileobj.close()
        selector.close()
        process.wait(timeout=1)
    stdout, stderr = (bytes(output[k]).decode('utf-8', errors='replace') for k in ['stdout', 'stderr'])
    if reason:
        raise ChildStopped(reason, process.pid, returncode, stdout, stderr)
    return subprocess.CompletedProcess(args, returncode, stdout, stderr)
