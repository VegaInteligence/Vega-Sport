"""Verify and reversibly switch the public lineup reader; no business data migration.

The default operation is read-only parity verification. --activate requires a
complete comparison in the same repeatable-read transaction and writer lease.
--rollback restores the frozen compatibility reader without removing any object.
"""

import argparse
import json
import os
from urllib.parse import parse_qs, urlsplit

import psycopg

LEASE = 97813003


def verify(db, *, batch=128, max_resources=None):
    if not 1 <= batch <= 500 or (max_resources is not None and max_resources < 1):
        raise ValueError("Invalid parity comparison budget")
    after, checked, members = 0, 0, 0
    while True:
        take = batch if max_resources is None else min(batch, max_resources-checked)
        if take <= 0:
            more = db.execute("SELECT EXISTS(SELECT 1 FROM statarena_app.match_families WHERE family='lineups' AND resource_id>%s)", (after,)).fetchone()[0]
            return dict(complete=not more, resources=checked, members=members)
        ids = [r[0] for r in db.execute("""SELECT resource_id FROM statarena_app.match_families
            WHERE family='lineups' AND resource_id>%s ORDER BY resource_id LIMIT %s""", (after, take))]
        if not ids:
            return dict(complete=True, resources=checked, members=members)
        mismatches = db.execute("""SELECT resource_id FROM statarena_app.match_families
            WHERE resource_id=ANY(%s) AND statarena_app.detail_data_lineups_legacy(resource_id)
              IS DISTINCT FROM statarena_app.detail_data_lineups_unified(resource_id)
            ORDER BY resource_id""", (ids,)).fetchall()
        if mismatches:
            # Resource IDs are sufficient to investigate; no player/source payload is logged.
            raise ValueError("Lineup parity failed for resources: "+','.join(str(r[0]) for r in mismatches))
        members += db.execute("SELECT count(*) FROM statarena_app.lineup_members WHERE resource_id=ANY(%s)", (ids,)).fetchone()[0]
        checked += len(ids)
        after = ids[-1]


def switch_reader(db, mode):
    """Caller owns transaction + lease. Retain function ACLs and every source table."""
    if mode not in ("unified", "legacy"):
        raise ValueError("Invalid lineup reader")
    target = "statarena_app.detail_data_lineups_"+mode
    source = db.execute("SELECT prosrc FROM pg_proc WHERE oid='statarena_app.detail_data_lineups(bigint)'::regprocedure").fetchone()[0]
    body = "SELECT "+target+"(rid);"
    if source.strip() == body:
        return False
    # Only the two fixed identifiers above enter SQL. The public signature stays unchanged.
    db.execute("CREATE OR REPLACE FUNCTION statarena_app.detail_data_lineups(rid bigint) RETURNS jsonb LANGUAGE sql STABLE AS $$"+body+"$$")
    db.execute("UPDATE statarena_app.publications SET generation=generation+1,published_at=clock_timestamp()")
    return True


def execute(db, *, action="verify", batch=128, max_resources=None):
    if action not in ("verify", "activate", "rollback"):
        raise ValueError("Unknown lineup operation")
    if action != "verify" and max_resources is not None:
        raise ValueError("A partial parity scan cannot authorize a reader switch")
    if not db.execute("SELECT pg_try_advisory_lock(%s)", (LEASE,)).fetchone()[0]:
        raise RuntimeError("Publication lease is busy")
    try:
        with db.transaction():
            db.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ"+ (" READ ONLY" if action == "verify" else ""))
            if action == "rollback":
                return dict(action=action, switched=switch_reader(db, "legacy"))
            result = verify(db, batch=batch, max_resources=max_resources)
            result["action"] = action
            if action == "activate":
                if not result["complete"]:
                    raise RuntimeError("Lineup comparison is incomplete")
                result["switched"] = switch_reader(db, "unified")
            return result
    finally:
        if not db.closed:
            db.execute("SELECT pg_advisory_unlock(%s)", (LEASE,))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--activate", action="store_true")
    mode.add_argument("--rollback", action="store_true")
    parser.add_argument("--batch", type=int, default=128)
    parser.add_argument("--max-resources", type=int)
    args = parser.parse_args()
    url = os.environ["DATABASE_URL"]
    address = urlsplit(url)
    local_test = address.hostname in ("localhost", "127.0.0.1", "::1") and address.path == "/vega_refactor_test"
    production = (os.environ.get("GITHUB_ACTIONS") == "true"
        and os.environ.get("STATARENA_DATA_PROVIDER") == "aws"
        and (address.hostname or "").endswith(".us-east-2.rds.amazonaws.com")
        and address.path == "/statarena_prod"
        and parse_qs(address.query).get("sslmode") == ["verify-full"])
    if not (local_test or production):
        raise SystemExit("Use the verified AWS ingestion workflow or a disposable loopback test database")
    with psycopg.connect(url, autocommit=True) as db:
        result = execute(db, action="activate" if args.activate else "rollback" if args.rollback else "verify",
                         batch=args.batch, max_resources=args.max_resources)
        print(json.dumps(result, sort_keys=True))
        if result.get("complete") is False:
            raise SystemExit(2)


if __name__ == "__main__":
    main()
