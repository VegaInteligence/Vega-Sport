"""Resume the verified physical provider-store migration, one bounded SQL call at a time.

Use status first. The SQL functions are also suitable for the private IAM SQL
worker: the CLI adds no migration logic and never sends source payloads to logs.
"""

import argparse
import json
import os
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import psycopg

from consolidated_model import NODES


def call(db, name, *args):
    allowed = {"status", "begin", "restart", "copy_batch", "verify_batch", "verify_resources", "activate", "rollback", "cancel"}
    if name not in allowed:
        raise ValueError("Unknown schema operation")
    return db.execute("SELECT statarena_app.consolidation_" + name + "(" + ",".join(["%s"] * len(args)) + ")", args).fetchone()[0]


def summary(db):
    value = call(db, "status")
    return {**{key: value[key] for key in ("control", "active_physical_tables", "retired_physical_tables")},
            "target_count": len(value["targets"]),
            "completed_copies": sum(bool(v.get("complete")) for k, v in value["progress"].items() if k.startswith("copy:")),
            "completed_row_proofs": sum(bool(v.get("complete")) for k, v in value["progress"].items() if k.startswith("verify:")),
            "completed_resource_proofs": sum(bool(v.get("complete")) for k, v in value["progress"].items() if k.startswith("resources:"))}


def execute(db, *, action="status", phase="backfill", batch=2000, resource_batch=32, max_batches=None):
    if not db.autocommit:
        raise ValueError("Use autocommit: each function owns one bounded transaction")
    if action == "status":
        return summary(db)
    if action in ("begin", "restart", "activate", "rollback", "cancel"):
        call(db, action, *([phase] if action == "begin" else []))
        return summary(db)
    if action not in ("copy", "verify"):
        raise ValueError("Unknown action")
    count = 0
    state = call(db, "status")
    if state["control"]["mode"] not in ("backfill", "rollback"):
        raise ValueError("Begin a maintenance phase before copying or verifying")
    steps = [("copy_batch" if action == "copy" else "verify_batch", n.table, batch) for n in NODES]
    if action == "verify" and summary(db)["control"]["mode"] == "backfill":
        steps += [("verify_resources", family, resource_batch) for family in ("catalog", "support", "detail")]
    for function, target, limit in steps:
        prefix = {"copy_batch": "copy:", "verify_batch": "verify:", "verify_resources": "resources:"}[function]
        previous = state["progress"].get(prefix + target, {})
        if previous.get("complete") and (function == "copy_batch" or previous.get("revision") == state["control"]["revision"]):
            continue
        while True:
            if max_batches is not None and count >= max_batches:
                return {**summary(db), "complete": False, "calls": count}
            progress = call(db, function, target, limit)
            count += 1
            print(json.dumps({"operation": function, "target": target, **progress}, sort_keys=True), flush=True)
            if progress["complete"]:
                break
    return {**summary(db), "complete": True, "calls": count}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("status", "begin", "copy", "verify", "activate", "rollback", "cancel", "restart"), nargs="?", default="status")
    parser.add_argument("--phase", choices=("backfill", "rollback"), default="backfill")
    parser.add_argument("--batch", type=int, default=2000)
    parser.add_argument("--resource-batch", type=int, default=32)
    parser.add_argument("--max-batches", type=int)
    parser.add_argument("--expected-host")
    parser.add_argument("--expected-database")
    parser.add_argument("--receipt", type=Path)
    args = parser.parse_args()
    url = os.environ["DATABASE_URL"]
    address = urlsplit(url)
    local = address.hostname in ("localhost", "127.0.0.1", "::1") and address.path in ("/vega_refactor_test", "/vega_ci_test")
    if args.action != "status" and not local:
        if args.expected_host != address.hostname or args.expected_database != address.path.lstrip("/"):
            raise SystemExit("Mutation requires explicit --expected-host and --expected-database matching the connection")
        if parse_qs(address.query).get("sslmode") != ["verify-full"]:
            raise SystemExit("Remote database mutations require TLS sslmode=verify-full")
    if not 1 <= args.batch <= 10000 or not 1 <= args.resource_batch <= 128 or (args.max_batches is not None and args.max_batches < 1):
        raise SystemExit("Invalid batch budget")
    with psycopg.connect(url, autocommit=True) as db:
        actual = db.execute("SELECT current_database()").fetchone()[0]
        if actual != address.path.lstrip("/"):
            raise RuntimeError("Connected database does not match its explicit address")
        result = execute(db, action=args.action, phase=args.phase, batch=args.batch,
                         resource_batch=args.resource_batch, max_batches=args.max_batches)
        if args.receipt:
            args.receipt.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
        print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
