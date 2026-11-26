"""A Deploy's own state (FAILURE_MODES_OPTIMISATIONS.md GH157, GH157.3): s3://vega-v2-deploy-state-<account>-<region>/
state.json, the one object of a private bucket the roles stack creates (deploy-roles.yaml DeployStateBucket), so that it
exists before anything a Deploy creates. Read and written with S3's conditional requests only (created if absent,
replaced only if unchanged since read): two runs never overwrite each other's state.

    python3 infra/aws/deploy_state.py acquire --bucket B --owner O [--takeover O2]
    python3 infra/aws/deploy_state.py set     --bucket B --owner O --etag E key=value ...
    python3 infra/aws/deploy_state.py release --bucket B --owner O --etag E [--done]
  Maintenance entries, the owner's (infra/aws/README.md, Takeover and first install):
    python3 infra/aws/deploy_state.py abandon --bucket B --holder H --reason TEXT
    python3 infra/aws/deploy_state.py resolve-migrate --bucket B --token T (--arn A | --none) --reason TEXT

acquire, set and release print shell assignments for deploy.sh to evaluate (STATE_ETAG, STATE_PHASE, …); a refusal says
why on stderr and exits: 3 the bucket does not exist (the roles stack not updated), 4 another run holds the state (its
name, phase and age printed as STATE_HOLDER, STATE_HOLDER_PHASE, STATE_HOLDER_AGE, and STATE_ABANDONED when the owner
attested that run dead), 5 the state changed since this run read it, 1 anything else (a refusal of S3, an expired
session, a maintenance entry refused).

The state: owner (the run holding it, or null), beat (its last write, epoch seconds), phase (idle, running, stopped),
before (the counts, image and template digest the services had when a Deploy stopped them, or a first install's target
counts: {worker, backfill, image, digest}), changed (the candidate's template or image may have been submitted to the
worker stack since they stopped), unsafe (a full migration may have started and has not succeeded), migrate (the migrate
task asked for and not yet seen stopped: {token, phase asked or running, arn, taskdef, command, sg, asked, and seen:
when its ARN was first answered}), abandoned
(the owner's attestation that the holder is dead: {holder, at, reason, by}), resolved (the owner's last settling of a
migrate intent). Another run's state is taken over only when `--takeover` names it, which deploy.sh gives for a run known
dead, never for its age (GH157.3); taken over, before, changed, unsafe and migrate are kept, the attestation spent.
"""
import argparse
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys
import tempfile
import time

import run_lock

KEY = "state.json"
IDLE = {"version": 1, "owner": None, "beat": 0, "phase": "idle", "before": None, "changed": False, "unsafe": False, "migrate": None}


class Refused(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def aws(*args):
    done = subprocess.run(["aws", *args, "--output", "json"], capture_output=True, text=True)
    if done.returncode == 0:
        return json.loads(done.stdout or "{}"), None
    found = re.search(r"An error occurred \(([A-Za-z0-9]+)\)", done.stderr)
    return None, (found.group(1) if found else "Unknown", done.stderr.strip()[-300:])


def put(bucket, doc, *, etag=None, create=False):
    """Writes `doc` if the object is still `etag` (or absent, with create): its new ETag."""
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        json.dump(doc, f, sort_keys=True)
    try:
        condition = ["--if-none-match", "*"] if create else ["--if-match", etag]
        out, error = aws("s3api", "put-object", "--bucket", bucket, "--key", KEY, "--body", f.name, "--content-type", "application/json", *condition)
    finally:
        os.unlink(f.name)
    if error is None:
        return out["ETag"]
    code, message = error
    if code in ("PreconditionFailed", "ConditionalRequestConflict"):
        raise Refused(5, f"the Deploy state changed since this run read it ({code}): another Deploy wrote it; nothing more is changed here")
    if code == "NoSuchBucket":
        raise Refused(3, f"bucket {bucket} does not exist: the roles stack (vega-v2-deploy-roles) creates it")
    raise Refused(1, f"the Deploy state could not be written ({code}): {message}")


def get(bucket):
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
        path = f.name
    try:
        out, error = aws("s3api", "get-object", "--bucket", bucket, "--key", KEY, path)
        if error is None:
            return json.loads(Path(path).read_text()), out["ETag"]
    finally:
        os.unlink(path)
    code, message = error
    if code == "NoSuchBucket":
        raise Refused(3, f"bucket {bucket} does not exist: the roles stack (vega-v2-deploy-roles) creates it")
    raise Refused(1, f"the Deploy state could not be read ({code}): {message}")


def shell(doc, etag, **extra):
    before = doc.get("before") or {}
    migrate = doc.get("migrate") or {}
    values = {"STATE_ETAG": etag, "STATE_PHASE": doc["phase"], "STATE_OWNER": doc.get("owner") or "",
              "STATE_BEFORE_WORKER": before.get("worker", ""), "STATE_BEFORE_BACKFILL": before.get("backfill", ""),
              "STATE_BEFORE_IMAGE": before.get("image", ""), "STATE_BEFORE_DIGEST": before.get("digest", ""),
              "STATE_CHANGED": "true" if doc.get("changed") else "false", "STATE_UNSAFE": "true" if doc.get("unsafe") else "false",
              "STATE_MIGRATE_TOKEN": migrate.get("token", ""), "STATE_MIGRATE_PHASE": migrate.get("phase", ""),
              "STATE_MIGRATE_ARN": migrate.get("arn") or "", "STATE_MIGRATE_TASKDEF": migrate.get("taskdef", ""),
              "STATE_MIGRATE_COMMAND": migrate.get("command", ""), "STATE_MIGRATE_SG": migrate.get("sg", ""),
              "STATE_MIGRATE_ASKED": migrate.get("asked", ""), "STATE_MIGRATE_SEEN": migrate.get("seen", ""), **extra}
    return "\n".join(f"{k}={shlex.quote(str(v))}" for k, v in values.items())


def acquire(bucket, owner, takeover):
    try:
        put(bucket, dict(IDLE), create=True)
    except Refused as refused:
        if refused.code != 5:  # already there: read it
            raise
    doc, etag = get(bucket)
    took, age = "", 0
    holder = doc.get("owner")
    if holder and holder != owner:
        age = int(time.time()) - int(doc.get("beat") or 0)
        if takeover != holder:
            attested = (doc.get("abandoned") or {}).get("holder") == holder
            print(shell(doc, etag, STATE_HOLDER=holder, STATE_HOLDER_PHASE=doc.get("phase"), STATE_HOLDER_AGE=age // 60,
                        STATE_ABANDONED=holder if attested else ""))
            raise Refused(4, f"another Deploy ({holder}) holds the Deploy state, phase {doc.get('phase')}, last seen {age // 60} min ago")
        took = holder
    doc = {**IDLE, **doc, "owner": owner, "beat": int(time.time()), "phase": "stopped" if doc.get("phase") == "stopped" else "running"}
    doc.pop("abandoned", None)
    etag = put(bucket, doc, etag=etag)
    return shell(doc, etag, STATE_TOOK_OVER=took, STATE_TOOK_OVER_AGE=age // 60 if took else "")


def update(bucket, owner, etag, changes, done=False, release=False):
    doc, current = get(bucket)
    if current != etag or doc.get("owner") != owner:
        raise Refused(5, f"the Deploy state changed since this run read it (owner {doc.get('owner')}): another Deploy wrote it")
    for change in changes:
        key, _, value = change.partition("=")
        if key in ("before.worker", "before.backfill"):
            doc["before"] = {**(doc.get("before") or {}), key.split(".")[1]: int(value)}
        elif key in ("before.image", "before.digest"):
            doc["before"] = {**(doc.get("before") or {}), key.split(".")[1]: value}
        elif key == "before":
            doc["before"] = None if value in ("", "null") else json.loads(value)
        elif key in ("changed", "unsafe"):
            doc[key] = value == "true"
        elif key == "phase" and value in ("idle", "running", "stopped"):
            doc["phase"] = value
        elif key in ("migrate.token", "migrate.phase", "migrate.arn", "migrate.command", "migrate.taskdef", "migrate.sg"):
            doc["migrate"] = {**(doc.get("migrate") or {}), key.split(".")[1]: value}
        elif key in ("migrate.asked", "migrate.seen"):
            doc["migrate"] = {**(doc.get("migrate") or {}), key.split(".")[1]: int(value)}
        elif key == "migrate" and value in ("", "null"):
            doc["migrate"] = None
        else:
            raise Refused(1, f"unknown change {change}")
    if done:
        doc.update(phase="idle", before=None, changed=False, unsafe=False)
    if release:
        doc["owner"] = None
    doc["beat"] = int(time.time())
    return shell(doc, put(bucket, doc, etag=etag))


def this_host():
    return run_lock.host()


def abandon(bucket, holder, reason):
    """The owner's attestation that the holder is dead, for what nothing here can prove (GH157-ag): a workstation's run
    whose lock is not in this machine's lock directory (another machine's, of any name or identity; this one's before a
    restart or a cleaning of it) or whose name has no run token (an earlier Deploy's). Refused for a GitHub run (the
    Deploy asks GitHub whether its attempt completed) and for a run whose lock is here: held, it lives; free, the Deploy
    takes it over itself (run_lock.py)."""
    doc, etag = get(bucket)
    if doc.get("owner") != holder:
        raise Refused(1, f"{holder} does not hold the Deploy state (its holder: {doc.get('owner')}); nothing is written")
    if re.fullmatch(r"gh-\d+-\d+", holder):
        raise Refused(1, f"{holder} is a GitHub run: the Deploy asks GitHub whether its attempt completed; nothing is written")
    state, lock = run_lock.holder_state(holder)
    if state == "held":
        raise Refused(1, f"{holder}: its lock {lock} is held: a process of that run lives; nothing is written")
    if state == "free":
        raise Refused(1, f"{holder}: its lock {lock} is here and free: the Deploy takes it over itself; nothing is written")
    doc["abandoned"] = {"holder": holder, "at": int(time.time()), "reason": reason, "by": this_host() or run_lock.short_name()}
    put(bucket, doc, etag=etag)
    return f"deploy state: {holder} attested dead by the owner ({reason}); the next Deploy takes the state over"


def resolve_migrate(bucket, token, arn, reason):
    """The owner's settling of a migrate intent the Deploy suspended (its outcome unknown past the replay window): the
    task found (its ARN: the next Deploy waits for it and reads its exit), or none ran under that token."""
    doc, etag = get(bucket)
    if doc.get("owner"):
        raise Refused(1, f"{doc['owner']} holds the Deploy state: its migrate intent is settled once it is released; nothing is written")
    migrate = doc.get("migrate") or {}
    if migrate.get("token") != token:
        raise Refused(1, f"the Deploy state's migrate intent is {migrate.get('token') or 'none'}, not {token}; nothing is written")
    doc["migrate"] = {**migrate, "arn": arn, "phase": "running"} if arn else None
    doc["resolved"] = {"token": token, "at": int(time.time()), "reason": reason, "arn": arn}
    put(bucket, doc, etag=etag)
    return f"deploy state: the migrate task {token} " + (f"is {arn}: the next Deploy waits for it" if arn else "ran nowhere: its intent is cleared")


def main(argv):
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["acquire", "set", "release", "abandon", "resolve-migrate"])
    parser.add_argument("--bucket", required=True)
    parser.add_argument("--owner")
    parser.add_argument("--etag")
    parser.add_argument("--takeover", default="")
    parser.add_argument("--done", action="store_true")
    parser.add_argument("--holder")
    parser.add_argument("--reason")
    parser.add_argument("--token")
    which = parser.add_mutually_exclusive_group()
    which.add_argument("--arn")
    which.add_argument("--none", action="store_true")
    parser.add_argument("changes", nargs="*")
    args = parser.parse_args(argv)
    try:
        if args.command in ("abandon", "resolve-migrate"):
            if not args.reason:
                raise Refused(1, "--reason is required: say what was checked")
            if args.command == "abandon":
                if not args.holder:
                    raise Refused(1, "--holder is required")
                out = abandon(args.bucket, args.holder, args.reason)
            else:
                if not args.token or not (args.arn or args.none):
                    raise Refused(1, "--token and one of --arn or --none are required")
                out = resolve_migrate(args.bucket, args.token, args.arn, args.reason)
        elif not args.owner:
            raise Refused(1, "--owner is required")
        elif args.command == "acquire":
            out = acquire(args.bucket, args.owner, args.takeover)
        else:
            if not args.etag:
                raise Refused(1, "--etag is required")
            out = update(args.bucket, args.owner, args.etag, args.changes, done=args.done, release=args.command == "release")
    except Refused as refused:
        print(f"deploy state: {refused}", file=sys.stderr)
        return refused.code
    print(out)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
