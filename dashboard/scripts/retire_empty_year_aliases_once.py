#!/usr/bin/env python3
"""One-time cleanup of the 26 provably empty year-only RDS partitions.

No source fixtures are removed. The existing YYYY/YYYY+1 partitions and all
their matches, fixtures, player performances, and metrics are retained.
Requires the AWS ingestion writer, shared lease and an encrypted RDS snapshot.
Default: read-only dry run. Idempotent after successful application.
"""
import argparse
import json
import os
from collections import Counter
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import boto3
import psycopg
from psycopg.rows import dict_row

from audit_empty_year_aliases import QUERY

SNAPSHOT = "statarena-before-empty-year-alias-cleanup-20261106"
HOST = "statarena-postgres.clcy2iqyajbl.us-east-2.rds.amazonaws.com"
LEASE = 97813003
YEAR = "2026"
EXPECTED = frozenset("""
l_0eg6C9 l_0uqFK8 l_1D8Xrl l_1TTHxD l_1TVRZW l_1XsMdH l_1dmt9H
l_1eJSA7 l_1xXulJ l_20pNSc l_271pqa l_2ApGa4 l_2EKrnc l_3Ci5Cg
l_3Kf7Ni l_3Tn1kG l_3UiOcj l_3qNjzC l_3qUkB8 l_3uNwVX l_3yVUAO
l_45VZuL l_45xKXM l_4FPF2L l_4V6jPs l_4dzm4e
""".split())
GUARD = ("matches","fixtures","appearances","team_seasons","bootstrap_sources",
         "notes","nonzero_counts","nonzero_catalog","pending_jobs")


def preflight(db):
    rows = db.execute(QUERY).fetchall()
    actual = {(row["season"],row["league_id"]) for row in rows}
    required = {(YEAR,league) for league in EXPECTED}
    if not actual:
        return {"already_done":True,"reason":"no year-only partitions"}
    if actual != required:
        raise RuntimeError("Year-only source scope changed: abort without writes")
    for row in rows:
        if any(row[field] != 0 for field in GUARD):
            raise RuntimeError("Year-only scope contains real business data: "+row["league_id"])
        if not row["next_partition"] or not (
            row["next_season_matches"] or row["next_season_fixtures"]
        ):
            raise RuntimeError("No populated canonical season for "+row["league_id"])
        if row["metric_definitions"] != 17:
            raise RuntimeError("Unexpected year-only metric definitions")
    metrics = db.execute("""
      SELECT season,league_id,metric_key,ordinal
      FROM statarena_app.partition_metrics
      WHERE league_id=ANY(%s) AND season IN ('2026','2026/2027')
      ORDER BY league_id,season,ordinal,metric_key
    """,(sorted(EXPECTED),)).fetchall()
    definitions = {}
    for row in metrics:
        key = (row["season"],row["league_id"])
        definitions.setdefault(key,[]).append((row["metric_key"],row["ordinal"]))
    for league in EXPECTED:
        if definitions.get((YEAR,league)) != definitions.get(("2026/2027",league)):
            raise RuntimeError("Metric definition mismatch in "+league)
    old = {row["league_id"]:{
        "matches":row["next_season_matches"],
        "fixtures":row["next_season_fixtures"],
    } for row in rows}
    return {
        "already_done":False,
        "aliases":len(rows),
        "definition_rows":sum(row["metric_definitions"] for row in rows),
        "canonical":old,
    }


def execute(db, plan):
    if plan["already_done"]:
        return {"applied":False,"already_done":True}
    ids=sorted(EXPECTED)
    # The transaction contains only metadata deletes. If any unexpected
    # business dependency exists, PostgreSQL aborts and rolls everything back.
    with db.transaction():
        removed = db.execute(
            """DELETE FROM statarena_app.partitions p
               WHERE p.season=%s AND p.league_id=ANY(%s)
               RETURNING p.league_id""",(YEAR,ids),
        ).fetchall()
        if {r["league_id"] for r in removed} != EXPECTED:
            raise RuntimeError("Partition deletion did not match expected cohort")
        removed_catalog=db.execute(
            """DELETE FROM statarena_app.competition_seasons
               WHERE season=%s AND competition_id=ANY(%s) AND sample_matches=0
               RETURNING competition_id""",(YEAR,ids),
        ).fetchall()
        if db.execute(
            """SELECT 1 FROM statarena_app.competition_seasons
               WHERE season=%s AND competition_id=ANY(%s) LIMIT 1""",
            (YEAR,ids),
        ).fetchone():
            raise RuntimeError("An alias still exists in the competition catalogue")
        remaining = db.execute(QUERY).fetchall()
        if remaining:
            raise RuntimeError("Unexpected year-only partition after cleanup")
        for league,expected in plan["canonical"].items():
            matches=db.execute(
                """SELECT count(*) AS n FROM statarena_app.matches
                   WHERE season='2026/2027' AND league_id=%s""",(league,),
            ).fetchone()["n"]
            fixtures=db.execute(
                """SELECT count(*) AS n FROM statarena_app.fixtures
                   WHERE season='2026/2027' AND league_id=%s""",(league,),
            ).fetchone()["n"]
            if matches != expected["matches"] or fixtures != expected["fixtures"]:
                raise RuntimeError("Canonical season changed during cleanup")
        generation=db.execute(
            """UPDATE statarena_app.publications
               SET generation=generation+1,published_at=clock_timestamp()
               WHERE singleton=true RETURNING generation"""
        ).fetchone()
        if not generation:
            raise RuntimeError("Could not advance publication generation")
    return {
        "applied":True,
        "aliases_removed":len(removed),
        "catalog_alias_rows_removed":len(removed_catalog),
        "metric_definitions_retained_in_canonical_seasons":True,
        "new_publication_generation":generation["generation"],
    }


def verify_snapshot():
    result=boto3.client("rds",region_name="us-east-2").describe_db_snapshots(
        DBSnapshotIdentifier=SNAPSHOT,DBInstanceIdentifier="statarena-postgres"
    )["DBSnapshots"]
    if len(result)!=1 or result[0]["Status"]!="available" or not result[0]["Encrypted"]:
        raise RuntimeError("RDS snapshot not available and encrypted")


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--execute",action="store_true")
    args=parser.parse_args()
    url=os.environ.get("DATABASE_URL","")
    target=urlsplit(url)
    if (
        os.environ.get("GITHUB_ACTIONS")!="true"
        or os.environ.get("STATARENA_DATA_PROVIDER")!="aws"
        or target.hostname!=HOST or target.path!="/statarena_prod"
        or parse_qs(target.query).get("sslmode")!=["verify-full"]
    ):
        raise SystemExit("Must run under verified AWS ingestion GitHub workflow")
    verify_snapshot()
    with psycopg.connect(url,autocommit=True,row_factory=dict_row,
                         options="-c statement_timeout=20000 -c lock_timeout=2000") as db:
        if not db.execute("SELECT pg_try_advisory_lock(%s)",(LEASE,)).fetchone()["pg_try_advisory_lock"]:
            raise RuntimeError("AWS ingest/publisher holds the shared writer lease")
        try:
            plan=preflight(db)
            report={"expected":len(EXPECTED),"dry_run":not args.execute,
                    "preflight":{k:v for k,v in plan.items() if k!="canonical"}}
            if args.execute:
                report["result"]=execute(db,plan)
            Path("year-alias-cleanup-receipt.json").write_text(
                json.dumps(report,indent=2,ensure_ascii=False,default=str)+"\n"
            )
            print(json.dumps(report,ensure_ascii=False,default=str))
        finally:
            db.execute("SELECT pg_advisory_unlock(%s)",(LEASE,))


if __name__=="__main__":
    main()
