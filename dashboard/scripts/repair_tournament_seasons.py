#!/usr/bin/env python3
"""Audit/repair persisted AWS staging fixtures whose sporting season is wrong.

Dry-run by default. The ingester keeps the native provider edition in body;
this utility can correct old typed seasons without another provider request.
It MUST NOT rewrite published website tables: republish first, then retire
old snapshots only once the replacement is verified.
"""
import argparse
import hashlib
import json
import os
from urllib.parse import parse_qs, urlsplit
import boto3
import psycopg
from football_seasons import SEASON, tournament_kind, fixture_sporting_season

LEASE = 97813003
HOST = "statarena-postgres.clcy2iqyajbl.us-east-2.rds.amazonaws.com"
INSTANCE = "statarena-postgres"
LIMIT = 10000


def proposed(db):
    rows = db.execute("""
      SELECT id,league_id,season,body->>'season' AS native_season,day,
        COALESCE(body#>>'{league,name}',body->>'league_name','') AS name
      FROM statarena.fixtures
      WHERE season ~ '^[12][0-9]{3}(/[12][0-9]{3})?$'
        AND (league_id='l_1XLtP0'
          OR lower(COALESCE(body#>>'{league,name}',body->>'league_name','')) ~
             'world cup|coupe du monde|afcon|africa cup|african cup|coupe d.afrique|copa am[eé]rica|asian cup|gold cup|euro')
      ORDER BY id
    """).fetchall()
    if len(rows)>LIMIT:
        raise RuntimeError("Candidate count exceeds controlled limit")
    changes,unresolved=[],[]
    for mid,league,current,native,day,name in rows:
        if not tournament_kind(league,name):
            continue
        if not SEASON.fullmatch(native or ""):
            unresolved.append((mid,"Missing native edition"))
            continue
        target = fixture_sporting_season({
            "season":native,
            "date":str(day or ""),
            "league":{"id":league,"name":name},
        })
        if current!=target:
            changes.append((mid,league,current,target))
    return changes,unresolved,len(rows)


def fingerprint(changes):
    value=json.dumps(changes,separators=(",",":"),ensure_ascii=False)
    return hashlib.sha256(value.encode()).hexdigest()


def checked_snapshot(name):
    if not name or not name.startswith("statarena-"):
        raise RuntimeError("Explicit verified RDS snapshot is required")
    snapshots=boto3.client("rds",region_name="us-east-2").describe_db_snapshots(
        DBSnapshotIdentifier=name,DBInstanceIdentifier=INSTANCE,
    )["DBSnapshots"]
    if len(snapshots)!=1 or snapshots[0]["Status"]!="available" or not snapshots[0]["Encrypted"]:
        raise RuntimeError("RDS snapshot not ready/encrypted")


def run(db,apply=False,expected_sha=None):
    if not db.execute("SELECT pg_try_advisory_lock(%s)",(LEASE,)).fetchone()[0]:
        raise RuntimeError("Publisher/ingester currently holds the AWS lease")
    try:
        changes,unresolved,count=proposed(db)
        sha=fingerprint(changes)
        report={
            "candidates":count,"updates":len(changes),
            "unresolved":unresolved[:30],
            "sha256":sha,
            "sample":[{"match":i,"league":l,"old":o,"new":n}
                      for i,l,o,n in changes[:20]],
            "applied":False,
            "note":"Published old cohorts must not be retired until the new publication is accepted.",
        }
        if not apply:
            return report
        if unresolved:
            raise RuntimeError("Incomplete native-source information; aborting")
        if sha!=expected_sha:
            raise RuntimeError("Plan hash drifted; run dry-run again")
        if not changes:
            return report
        with db.transaction():
            with db.cursor() as cur:
                cur.executemany(
                    """UPDATE statarena.fixtures
                       SET season=%s,updated_at=clock_timestamp()
                       WHERE id=%s AND season=%s""",
                    [(new,mid,old) for mid,league,old,new in changes],
                )
            for mid,league,old,new in changes:
                got=db.execute("SELECT season FROM statarena.fixtures WHERE id=%s",(mid,)).fetchone()
                if got!=(new,):
                    raise RuntimeError("A source changed mid-repair; rollback")
            scopes=sorted({(s,l) for _,l,o,n in changes for s in (o,n)})
            with db.cursor() as cur:
                cur.executemany(
                    """INSERT INTO statarena.dirty_partitions(season,league_id)
                       VALUES(%s,%s) ON CONFLICT(season,league_id)
                       DO UPDATE SET changed_at=clock_timestamp()""",scopes,
                )
            report["queued_scopes"]=scopes
        report["applied"]=True
        return report
    finally:
        db.execute("SELECT pg_advisory_unlock(%s)",(LEASE,))


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--apply",action="store_true")
    p.add_argument("--expected-sha256")
    p.add_argument("--snapshot-id")
    args=p.parse_args()
    if args.apply and (not args.expected_sha256 or not args.snapshot_id):
        p.error("--apply requires a reviewed SHA256 and an existing encrypted snapshot")
    url=os.environ.get("DATABASE_URL","")
    target=urlsplit(url)
    if (os.environ.get("GITHUB_ACTIONS")!="true"
        or os.environ.get("STATARENA_DATA_PROVIDER")!="aws"
        or target.hostname!=HOST or target.path!="/statarena_prod"
        or parse_qs(target.query).get("sslmode")!=["verify-full"]):
        raise SystemExit("Use the verified AWS ingestion GitHub Actions role")
    if args.apply:
        checked_snapshot(args.snapshot_id)
    with psycopg.connect(url,autocommit=True,
                         options="-c statement_timeout=20000 -c lock_timeout=1000") as db:
        print(json.dumps(run(db,apply=args.apply,expected_sha=args.expected_sha256),
                         ensure_ascii=False,indent=2))


if __name__=="__main__":
    main()
