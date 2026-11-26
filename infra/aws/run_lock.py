"""A workstation Deploy's run lock (FAILURE_MODES_OPTIMISATIONS.md GH157.3, GH157-ad, GH157-ag). deploy.sh names its run
host:<host>:<pid>:<token>, <token> 32 random hex digits of its own, opens <lock directory>/vega-deploy-<token>.lock on
descriptor 9 when it starts, which every command it starts inherits, and holds an exclusive lock on it here. The lock
belongs to the open file, not to a process: while any process of the run lives (its shell, an `aws cloudformation
deploy` the shell left running, whose CreateChangeSet, wait and ExecuteChangeSet are separate requests), it stays held.
The lock directory is the machine's own (DEPLOY_LOCK_DIR, else /tmp): another machine — of any name and identity, a
clone — or this one after a restart or a cleaning of it does not see the file.

What a run's lock proves to another Deploy, or to deploy_state.py abandon, reading the run's name:
    here and free   no process of that run lives: it is dead, and the Deploy takes it over;
    here and held   a process of it lives: refused, the owner's attestation too;
    absent, unreadable, or a name without a run token (an earlier Deploy's)   nothing: only the owner's attestation
                    (deploy_state.py abandon) lets the next Deploy take it over.
The file stays once the run ends (empty; its token is never reused): removing it would only turn a proof into nothing.

    python3 infra/aws/run_lock.py token          # a new run's token
    python3 infra/aws/run_lock.py hold 9         # the lock on the caller's descriptor 9 (exit 1: already held)
    python3 infra/aws/run_lock.py state <name>   # a run's lock: free|held|absent|unreadable <file>, or untokened -
    python3 infra/aws/run_lock.py host           # this machine: <short host name>-<10 hex digits>
                                                 # (exit 3, nothing printed: the machine has no identity of its own)

This machine, in a workstation run's name: its short host name and a digest of its machine identity (Linux's
/etc/machine-id, macOS's IOPlatformUUID). A machine without one — none, or a placeholder: `uninitialized` (a first boot),
32 zeros, a malformed value, a null or malformed IOPlatformUUID — names no host (GH157-af): a workstation's Deploy
stops there (deploy.sh).
"""
import fcntl
import hashlib
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys

LOCK_DIR = Path(os.environ.get("DEPLOY_LOCK_DIR") or "/tmp")
MACHINE_ID = Path("/etc/machine-id")
IOREG = Path("/usr/sbin/ioreg")
TOKEN = re.compile(r"[0-9a-f]{32}")
HOLDER = re.compile(r"host:([^:]+):(\d+):([^:]+)")
UUID = re.compile(r"[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}")


def short_name():
    return subprocess.run(["hostname", "-s"], capture_output=True, text=True).stdout.strip() or "unknown"


def identity():
    """The machine's identity, or "" when it has none of its own (no source, or a placeholder)."""
    if MACHINE_ID.is_file():
        value = MACHINE_ID.read_text().strip().lower()
        return value if TOKEN.fullmatch(value) and value.strip("0") else ""
    if IOREG.exists():
        out = subprocess.run([str(IOREG), "-rd1", "-c", "IOPlatformExpertDevice"], capture_output=True, text=True).stdout
        found = re.search(r'"IOPlatformUUID" = "([^"]*)"', out)
        value = (found.group(1) if found else "").upper()
        return value if UUID.fullmatch(value) and value.replace("-", "").strip("0") else ""
    return ""


def host():
    """This machine: its short host name and the first 10 hex digits of the SHA-256 of its identity; None without one."""
    ident = identity()
    return f"{short_name()}-{hashlib.sha256(ident.encode()).hexdigest()[:10]}" if ident else None


def path(token):
    return LOCK_DIR / f"vega-deploy-{token}.lock"


def lock_state(file):
    """free, held, absent or unreadable. The file is opened as it is, never created: one removed meanwhile is absent."""
    try:
        fd = os.open(file, os.O_RDONLY)
    except FileNotFoundError:
        return "absent"
    except OSError:
        return "unreadable"
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        return "held"
    finally:
        os.close(fd)  # closing it releases the probe's own lock
    return "free"


def holder_state(name):
    """A run's lock from its name: (state, file), or ("untokened", None) for a name without a run token."""
    found = HOLDER.fullmatch(name)
    if not found or not TOKEN.fullmatch(found[3]):
        return "untokened", None
    file = path(found[3])
    return lock_state(file), file


def main(argv):
    if argv == ["token"]:
        print(secrets.token_hex(16))
        return 0
    if len(argv) == 2 and argv[0] == "hold":
        try:
            fcntl.flock(int(argv[1]), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            return 1
        return 0
    if len(argv) == 2 and argv[0] == "state":
        state, file = holder_state(argv[1])
        print(state, file or "-")
        return 0
    if argv == ["host"]:
        name = host()
        if name is None:
            print(f"run_lock: this machine ({short_name()}) has no identity of its own ({MACHINE_ID}, IOPlatformUUID): no host is named for it", file=sys.stderr)
            return 3
        print(name)
        return 0
    print("usage: run_lock.py token | hold <descriptor> | state <run name> | host", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
