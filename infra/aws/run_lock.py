"""A workstation Deploy's run lock (FAILURE_MODES_OPTIMISATIONS.md GH157.3, GH157-ad). deploy.sh opens
/tmp/vega-deploy-<pid>-<start>.lock on descriptor 9 when it starts, which every command it starts inherits, and holds
an exclusive lock on it here. The lock belongs to the open file, not to a process: while any process of the run lives
(its shell, an `aws cloudformation deploy` the shell left running, whose CreateChangeSet, wait and ExecuteChangeSet are
separate requests), it stays held, and another Deploy of this host can tell; once they have all ended, it is free.

    python3 infra/aws/run_lock.py hold 9         # the lock on the caller's descriptor 9 (exit 1: already held)
    python3 infra/aws/run_lock.py free <file>    # exit 0: no process holds it (or no such file); 1: held

The file is left in /tmp once the run ends (empty; its name is the run's own, never reused): removing it while a command
of the run might still live would make a live run look dead.
"""
import fcntl
import os
import sys


def path(pid, start):
    """The lock of the workstation run host:<host>:<pid>:<start> (deploy.sh's OWNER), on this host."""
    return f"/tmp/vega-deploy-{pid}-{start}.lock"


def held(file):
    """Whether a process holds the lock (no such file: none does; a file this user cannot open: taken as held)."""
    if not os.path.exists(file):
        return False
    try:
        with open(file, "a") as f:
            try:
                fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError:
                return True
            fcntl.flock(f, fcntl.LOCK_UN)
    except OSError:
        return True
    return False


def main(argv):
    if len(argv) == 2 and argv[0] == "hold":
        try:
            fcntl.flock(int(argv[1]), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            return 1
        return 0
    if len(argv) == 2 and argv[0] == "free":
        return 1 if held(argv[1]) else 0
    print("usage: run_lock.py hold <descriptor> | free <file>", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
