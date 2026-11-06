#!/usr/bin/env python3
"""One-time, guarded transaction: World Cup 2022/2026 in AWS RDS.

The 2026 published match IDs, player rows and xG/shot details are retained.
Only the cohort keys are moved. No provider data are fetched or rewritten.
The 2022 source cohort is corrected/queued, not spuriously published as
though a verified historical partition had been built.
"""
import argparse
import hashlib
import json
import os
import sys
from collections import Counter
from urllib.parse import parse_qs, urlsplit

import psycopg
import boto3

from football_seasons import fixture_sporting_season

WORLD = "l_1XLtP0"
OLD = "2026/2027"
NEW = "2025/2026"
QATAR = "2022/2023"
NATIVE_ROWS = {"2026": 104, "2022": 64}
EXPECTED = {"2026": NEW, "2022": QATAR}
LEASE = 97813003
SNAPSHOT = "statarena-before-season-reclass-20261106"
HOST = "statarena-postgres.clcy2iqyajbl.us-east-2.rds.amazonaws.com"


def count(db, table, season):
    return db.execute(
        f"SELECT count(*) FROM statarena_app.{table} WHERE league_id=%s AND season=%s",
        (WORLD,season),
    ).fetchone()[0]


def inspect(db):
    raw = db.execute(
        """SELECT id,season,day,body->>'season' FROM statarena.fixtures
           WHERE league_id=%s ORDER BY id""",(WORLD,),
    ).fetchall()
    if len(raw)!=sum(NATIVE_ROWS.values()):
        raise RuntimeError(f"Unexpected World Cup staging fixture count: {len(raw)}")
    native_counts = Counter(x[3] for x in raw)
    if native_counts!=NATIVE_ROWS:
        raise RuntimeError(f"Unexpected World Cup native editions: {dict(native_counts)}")
    changes=[]
    editions={}
    for mid,current,day,native in raw:
        target=fixture_sporting_season({
            "season":native,"date":str(day or ""),
            "league":{"id":WORLD,"name":"World Cup"},
        })
        if target!=EXPECTED[native]:
            raise RuntimeError("Unsupported World Cup edition/season mapping")
        editions[mid]=native
        if current!=target:
            changes.append((mid,current,target))
        elif current not in (NEW,QATAR):
            raise RuntimeError("Invalid already-normalized tournament fixture")
    existing = db.execute(
        "SELECT id,season FROM statarena_app.matches WHERE league_id=%s",
        (WORLD,),
    ).fetchall()
    published = Counter(season for _,season in existing)
    old_ids = {mid for mid,season in existing if season==OLD}
    native_2026 = {mid for mid,native in editions.items() if native=="2026"}
    if published=={NEW:104} and not changes:
        return {"already_done":True,"staging":dict(native_counts),"published":dict(published)}
    if published!={OLD:104}:
        raise RuntimeError(f"Unexpected published World Cup cohorts: {dict(published)}")
    if old_ids!=native_2026:
        raise RuntimeError("Published World Cup IDs differ from collected source; abort")
    if len(changes)!=168:
        raise RuntimeError(f"Expected 168 incorrect stage rows, found {len(changes)}")
    current_fixture_ids={x[0] for x in db.execute(
        "SELECT id FROM statarena_app.fixtures WHERE league_id=%s AND season=%s",
        (WORLD,OLD)).fetchall()}
    if current_fixture_ids!=old_ids:
        raise RuntimeError("Published fixtures do not match published World Cup matches")
    if count(db,"matches",NEW) or count(db,"fixtures",NEW) or count(db,"appearances",NEW):
        raise RuntimeError("Destination World Cup business cohort is already occupied")
    if count(db,"matches","2026") or count(db,"fixtures","2026"):
        raise RuntimeError("Unexpected published data in raw-year alias")
    rows=db.execute(
        "SELECT season FROM statarena_app.partitions WHERE league_id=%s",
        (WORLD,)).fetchall()
    labels={x[0] for x in rows}
    if OLD not in labels or NEW in labels:
        raise RuntimeError(f"Unexpected World Cup partition keys: {sorted(labels)}")
    fixture_counts={
        "matches":count(db,"matches",OLD),
        "fixtures":count(db,"fixtures",OLD),
        "appearances":count(db,"appearances",OLD),
        "team_seasons":count(db,"team_seasons",OLD),
        "shots":db.execute(
            "SELECT count(*) FROM statarena_app.shots WHERE match_id=ANY(%s)",
            (sorted(old_ids),),
        ).fetchone()[0],
        "team_stats":db.execute(
            "SELECT count(*) FROM statarena_app.team_statistics WHERE match_id=ANY(%s)",
            (sorted(old_ids),),
        ).fetchone()[0],
    }
    if fixture_counts["appearances"]<1000:
        raise RuntimeError("Published player statistics coverage unexpectedly low")
    # Target metadata keys must be unoccupied before moving the entire cohort.
    for table in ("partition_counts","partition_notes","partition_metrics","partition_bootstrap_sources",
                  "team_seasons","publication_jobs"):
        if count(db,table,NEW):
            raise RuntimeError(f"Destination {table} already has data")
    return {
        "already_done":False,
        "source":dict(native_counts),
        "published":dict(published),
        "old_partition":OLD,"new_partition":NEW,"qatar_partition":QATAR,
        "old_business_counts":fixture_counts,
        "changes":changes,
        "ids":sorted(old_ids),
        "source_hash":hashlib.sha256(json.dumps(changes,sort_keys=True).encode()).hexdigest(),
    }


def apply(db, plan):
    if plan.get("already_done"):
        return plan
    ids=plan["ids"]
    with db.transaction():
        # Keep provider JSON body and native_season untouched.
        with db.cursor() as cur:
            cur.executemany(
                """UPDATE statarena.fixtures SET season=%s,updated_at=clock_timestamp()
                   WHERE id=%s AND season=%s""",
                [(target,mid,current) for mid,current,target in plan["changes"]],
            )
        for target,native,count_expected in [(NEW,"2026",104),(QATAR,"2022",64)]:
            observed=db.execute(
                """SELECT count(*) FROM statarena.fixtures
                   WHERE league_id=%s AND season=%s AND body->>'season'=%s""",
                (WORLD,target,native)).fetchone()[0]
            if observed!=count_expected:
                raise RuntimeError("Staging mismatch after reassignment")

        # Copy the immutable publication header to the new canonical key;
        # retain the old snapshot until all child rows have been rekeyed.
        copied=db.execute("""
            INSERT INTO statarena_app.partitions
            (season,league_id,source_digest,source,retrieved_at,rating_source,
             ranking_available,start_date,end_date,published_at)
            SELECT %s,league_id,source_digest,source,retrieved_at,rating_source,
                   ranking_available,start_date,end_date,clock_timestamp()
            FROM statarena_app.partitions
            WHERE league_id=%s AND season=%s
            RETURNING season
        """,(NEW,WORLD,OLD)).fetchall()
        if copied!=[(NEW,)]:
            raise RuntimeError("Expected exactly one migrated publication header")
        for table in (
            "partition_counts","partition_notes","partition_metrics",
            "partition_bootstrap_sources","team_seasons"
        ):
            db.execute(
                f"UPDATE statarena_app.{table} SET season=%s WHERE league_id=%s AND season=%s",
                (NEW,WORLD,OLD),
            )
        db.execute("UPDATE statarena_app.matches SET season=%s WHERE league_id=%s AND season=%s",
                   (NEW,WORLD,OLD))
        db.execute("UPDATE statarena_app.fixtures SET season=%s WHERE league_id=%s AND season=%s",
                   (NEW,WORLD,OLD))
        db.execute("UPDATE statarena_app.appearances SET season=%s WHERE league_id=%s AND season=%s",
                   (NEW,WORLD,OLD))
        db.execute(
            "UPDATE statarena_app.match_details SET season=%s WHERE match_id=ANY(%s) AND season IS DISTINCT FROM %s",
            (NEW,ids,NEW),
        )
        # Source/catalog documents retain their official edition years.
        db.execute(
            "UPDATE statarena_app.competitions SET latest_season=%s "
            "WHERE id=%s AND latest_season=%s",
            (NEW,WORLD,OLD),
        )
        # Canonicalize competition-season row, preserving existing 0-matches
        # aliases only when they have no business matches.
        old_sample=db.execute(
            "SELECT sample_matches FROM statarena_app.competition_seasons WHERE competition_id=%s AND season=%s",
            (WORLD,OLD),
        ).fetchone()
        if not old_sample or old_sample[0]<100:
            raise RuntimeError("World Cup competition coverage unexpectedly low")
        if db.execute("SELECT 1 FROM statarena_app.competition_seasons WHERE competition_id=%s AND season=%s",
                      (WORLD,NEW)).fetchone():
            raise RuntimeError("Canonical competition season already exists")
        db.execute("UPDATE statarena_app.competition_seasons SET season=%s WHERE competition_id=%s AND season=%s",
                   (NEW,WORLD,OLD))
        db.execute("""DELETE FROM statarena_app.competition_seasons
                      WHERE competition_id=%s AND season='2026' AND sample_matches=0""",
                   (WORLD,))
        if db.execute("SELECT count(*) FROM statarena_app.competition_seasons WHERE competition_id=%s AND season='2026'",(WORLD,)).fetchone()[0]:
            raise RuntimeError("Raw 2026 alias cannot be safely removed")
        # Delete old header only after all FK children point to the new key.
        db.execute("DELETE FROM statarena_app.partitions WHERE league_id=%s AND season=%s",
                   (WORLD,OLD))
        # Never remove a populated raw-year alias or its dependent records.
        for table in (
            "matches","fixtures","appearances","team_seasons","partition_metrics",
            "partition_bootstrap_sources","partition_notes",
        ):
            if count(db,table,"2026"):
                raise RuntimeError("Nonempty World Cup 2026 alias: " + table)
        if db.execute(
            """SELECT 1 FROM statarena_app.partition_counts
               WHERE league_id=%s AND season='2026' AND value <> 0""",
            (WORLD,),
        ).fetchone():
            raise RuntimeError("Nonzero counts on raw-year alias")
        db.execute(
            "DELETE FROM statarena_app.partitions WHERE league_id=%s AND season='2026'",
            (WORLD,),
        )
        # A fresh publication generation forces Vercel and CloudFront to
        # request the new edition mapping; retained match IDs are unchanged.
        db.execute("UPDATE statarena_app.publications SET generation=generation+1,published_at=clock_timestamp() WHERE singleton=true")
        # Clear obsolete job scopes so the nightly publisher cannot rediscover
        # a long-retired raw-year alias from the queue itself.
        db.execute(
            "DELETE FROM statarena_app.publication_jobs WHERE league_id=%s AND season IN ('2026','2026/2027','2022')",
            (WORLD,),
        )
        db.execute(
            "DELETE FROM statarena.dirty_partitions WHERE league_id=%s AND season IN ('2022','2026','2026/2027')",
            (WORLD,),
        )
        with db.cursor() as cur:
            cur.executemany(
                """INSERT INTO statarena.dirty_partitions(season,league_id)
                   VALUES(%s,%s) ON CONFLICT(season,league_id)
                   DO UPDATE SET changed_at=clock_timestamp()""",
                [(NEW,WORLD),(QATAR,WORLD)],
            )
        after=dict(
            shots=db.execute(
                "SELECT count(*) FROM statarena_app.shots WHERE match_id=ANY(%s)",
                (ids,),
            ).fetchone()[0],
            team_stats=db.execute(
                "SELECT count(*) FROM statarena_app.team_statistics WHERE match_id=ANY(%s)",
                (ids,),
            ).fetchone()[0],
            stage_2026=db.execute(
                "SELECT count(*) FROM statarena.fixtures WHERE league_id=%s AND season=%s",
                (WORLD,NEW)).fetchone()[0],
            stage_2022=db.execute(
                "SELECT count(*) FROM statarena.fixtures WHERE league_id=%s AND season=%s",
                (WORLD,QATAR)).fetchone()[0],
            published_2026=count(db,"matches",NEW),
            old_published_2026=count(db,"matches",OLD),
            players_2026=count(db,"appearances",NEW),
            old_players_2026=count(db,"appearances",OLD),
        )
        if (after["stage_2026"],after["stage_2022"],after["published_2026"],
            after["old_published_2026"],after["players_2026"],after["old_players_2026"]) != (
                104,64,104,0,plan["old_business_counts"]["appearances"],0):
            raise RuntimeError("Post-migration counts do not reconcile; rolled back")
        if after["shots"]!=plan["old_business_counts"]["shots"] or after["team_stats"]!=plan["old_business_counts"]["team_stats"]:
            raise RuntimeError("Shot or team statistic coverage changed; rolled back")
        if not db.execute("SELECT 1 FROM statarena_app.partitions WHERE league_id=%s AND season=%s",
                          (WORLD,NEW)).fetchone():
            raise RuntimeError("Canonical publication missing")
    return {"applied":True,**after,"source_sha256":plan["source_hash"]}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot",required=True)
    parser.add_argument("--execute",action="store_true")
    args=parser.parse_args()
    parsed=urlsplit(os.environ.get("DATABASE_URL",""))
    if (os.environ.get("GITHUB_ACTIONS")!="true" or
        os.environ.get("STATARENA_DATA_PROVIDER")!="aws" or
        parsed.hostname!=HOST or parsed.path!="/statarena_prod" or
        parse_qs(parsed.query).get("sslmode")!=["verify-full"]):
        raise SystemExit("Requires the verified AWS writer GitHub job")
    if args.snapshot != SNAPSHOT:
        raise SystemExit("Unexpected backup identifier")
    rds=boto3.client("rds",region_name="us-east-2")
    info=rds.describe_db_snapshots(DBSnapshotIdentifier=SNAPSHOT,
                                   DBInstanceIdentifier="statarena-postgres")["DBSnapshots"]
    if len(info)!=1 or info[0]["Status"]!="available" or not info[0]["Encrypted"]:
        raise SystemExit("Fresh RDS snapshot not verified as available")
    with psycopg.connect(os.environ["DATABASE_URL"],autocommit=True,
                         options="-c statement_timeout=90000 -c lock_timeout=2500") as db:
        if not db.execute("SELECT pg_try_advisory_lock(%s)",(LEASE,)).fetchone()[0]:
            raise SystemExit("Existing AWS ingest job is active")
        try:
            plan=inspect(db)
            print(json.dumps({"preflight":{k:v for k,v in plan.items() if k not in ("changes","ids")}},
                             ensure_ascii=False),flush=True)
            report=apply(db,plan) if args.execute else {"dry_run":True}
            with open("tournament-reclass-receipt.json","w") as handle:
                json.dump(report,handle,ensure_ascii=False,indent=2)
            print(json.dumps(report,ensure_ascii=False),flush=True)
        finally:
            db.execute("SELECT pg_advisory_unlock(%s)",(LEASE,))


if __name__=="__main__":
    main()
