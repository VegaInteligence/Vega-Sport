"""SQL queue recovery: failed work is retained and cannot starve healthy partitions."""

import json
import io
import os
import sys
from contextlib import redirect_stdout
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from urllib.parse import urlsplit

import psycopg

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "dashboard/scripts"))
import relational_materialize as publisher


def continuation_checks(db, check):
    """Exercise the real queue, catalogue spool, receipts and SQL transactions.

    Only the synthetic source transformer is substituted. The catalogue batch
    and admission loop are production code, including all acknowledgement SQL.
    """
    db.execute("CREATE TEMP TABLE continuation_records(kind text,key text,PRIMARY KEY(kind,key))")

    def scenario(*, catalog_count, partition_count, catalog_seconds=0,
                 partition_seconds=0, max_partitions=None, fail_catalog_at=None, fail_globals=False, minutes=1):
        db.execute("DROP TABLE IF EXISTS work_catalog,work_failed")
        db.execute("TRUNCATE statarena_app.publication_jobs,statarena_app.worker_inputs,statarena_app.workflow_state,continuation_records")
        clock = [0]
        catalog_writes = [0]
        events = []
        generation = db.execute("SELECT generation FROM statarena_app.publications").fetchone()[0]

        def prepare(*_):
            db.execute("CREATE TEMP TABLE work_catalog(kind text,key text,digest text,ref jsonb,status integer,error text)")
            db.cursor().executemany("INSERT INTO work_catalog VALUES('object',%s,%s,NULL,200,NULL)",
                                    [(f"fixture/{i:03}.json", f"digest-{i}") for i in range(catalog_count)])
            db.cursor().executemany("INSERT INTO statarena_app.publication_jobs(season,league_id) VALUES('2026/2027',%s)",
                                    [(f"l_{i:06}",) for i in range(partition_count)])

        def prefetch(refs, scratch):
            scratch.executemany("INSERT INTO body_cache VALUES(?,?,?)",
                                [(key, digest, json.dumps({"key": key})) for key, digest in refs])

        def publish_globals(_):
            events.append(("global",))
            with db.transaction():
                db.execute("INSERT INTO continuation_records VALUES('global','support')")
                publisher.receipt(db, "global", "support", "fixture")
                db.execute("UPDATE statarena_app.publications SET generation=generation+1")
                if fail_globals:
                    raise ValueError("source-body-must-not-appear")
            return {"support_changed": 1}

        def publish_catalog(_, records):
            keys = []
            for key, value in records:
                assert value == {"key": key}
                db.execute("INSERT INTO continuation_records VALUES('catalog',%s)", (key,))
                keys.append(key)
                catalog_writes[0] += 1
                if catalog_writes[0] == fail_catalog_at:
                    raise ValueError("source-body-must-not-appear")
            events.append(("catalog", len(keys)))
            clock[0] += catalog_seconds
            return {"changed": len(keys)}

        def publish_partition(inputs, manifest, season, league, marked, timing):
            db.execute("INSERT INTO continuation_records VALUES('partition',%s)", (league,))
            publisher.receipt(db, "partition", season + ":" + league, "fixture")
            db.execute("DELETE FROM statarena_app.publication_jobs WHERE season=%s AND league_id=%s AND changed_at=%s", (season, league, marked))
            db.execute("UPDATE statarena_app.publications SET generation=generation+1")
            events.append(("partition", league))
            clock[0] += partition_seconds
            return 1

        inputs = SimpleNamespace(db=db, read=lambda _: {}, prefetch=prefetch)
        output = io.StringIO()
        with patch.object(publisher, "capacity", return_value=10**12), \
             patch.object(publisher, "install"), \
             patch.object(publisher, "Inputs", return_value=inputs), \
             patch.object(publisher, "prepare", side_effect=prepare), \
             patch.object(publisher, "publish_partition", side_effect=publish_partition), \
             patch.object(publisher, "publish_global", side_effect=publish_globals), \
             patch.object(publisher, "publish_catalog", side_effect=publish_catalog), \
             patch.object(publisher, "catalog_records", return_value=[("fixture", {})]), \
             patch.object(publisher, "queue_dirty"), \
             patch.object(publisher, "time", SimpleNamespace(monotonic=lambda: clock[0])), \
             redirect_stdout(output):
            result = publisher.run(SimpleNamespace(db=db), minutes=minutes, batch=10, max_partitions=max_partitions)
        return result, events, generation, output.getvalue()

    result, events, generation, _ = scenario(catalog_count=12, partition_count=3,
                                               catalog_seconds=5, partition_seconds=70)
    check("globals and catalogue commit before a long first partition", events == [
        ("global",), ("catalog", 4), ("catalog", 4), ("catalog", 4), ("partition", "l_000000")])
    check("long partition retains remaining queue after budget expiry", result["partitions"] == 1 and result["catalog_inputs"] == 12 and result["remaining"] == 2)
    check("each complete catalogue batch and partition advances generation atomically", db.execute("SELECT generation FROM statarena_app.publications").fetchone()[0] == generation + 5)

    result, events, _, _ = scenario(catalog_count=100, partition_count=3,
                                    catalog_seconds=11, partition_seconds=1, max_partitions=2, minutes=5)
    check("catalogue yields to each partition after its soft slice", events == [
        ("global",), ("catalog", 4), ("catalog", 4), ("catalog", 4), ("partition", "l_000000"),
        ("catalog", 4), ("catalog", 4), ("catalog", 4), ("partition", "l_000001")])
    check("successful partition cap is preserved while both queues advance", result["partitions"] == 2 and result["catalog_inputs"] == 24 and result["remaining"] == 77)
    check("only completed catalogue inputs are acknowledged", db.execute("SELECT count(*) FROM statarena_app.worker_inputs WHERE kind='object'").fetchone()[0] == 24 and db.execute("SELECT count(*) FROM work_catalog").fetchone()[0] == 76)

    result, events, _, _ = scenario(catalog_count=12, partition_count=1, catalog_seconds=65)
    check("atomic catalogue overrun does not admit another batch or partition", events == [("global",), ("catalog", 4)] and result["partitions"] == 0 and result["catalog_inputs"] == 4)
    check("unadmitted catalogue inputs retain work and no receipt", result["remaining"] == 9 and db.execute("SELECT count(*) FROM work_catalog").fetchone()[0] == 8 and db.execute("SELECT count(*) FROM statarena_app.worker_inputs WHERE kind='object'").fetchone()[0] == 4)

    result, events, _, _ = scenario(catalog_count=44, partition_count=0)
    check("catalogue drains beyond one slice when partition queue is empty", result["catalog_inputs"] == 44 and result["remaining"] == 0 and len([event for event in events if event[0] == "catalog"]) == 11)

    result, events, _, _ = scenario(catalog_count=8, partition_count=2, max_partitions=0)
    check("zero partition cap still permits global and catalogue publication", result["partitions"] == 0 and result["catalog_inputs"] == 8 and result["remaining"] == 2 and not any(event[0] == "partition" for event in events))

    result, events, generation, output = scenario(catalog_count=8, partition_count=2, fail_catalog_at=2)
    check("failed catalogue remains visible while healthy partitions publish", result["failed_catalog_batches"] == 1 and result["partitions"] == 2 and db.execute("SELECT status FROM statarena_app.workflow_state").fetchone()[0] == "failed")
    check("failed catalogue writes and all acknowledgements roll back together", result["catalog_inputs"] == 0 and db.execute("SELECT count(*) FROM continuation_records WHERE kind='catalog'").fetchone()[0] == 0 and db.execute("SELECT count(*) FROM statarena_app.worker_inputs WHERE kind='object'").fetchone()[0] == 0 and db.execute("SELECT count(*) FROM work_catalog").fetchone()[0] == 8)
    check("failed catalogue is attempted once and logs only a safe code", output.count('"phase":"catalog-deferred"') == 1 and '"error_code":"ValueError"' in output and "source-body-must-not-appear" not in output)
    check("only healthy work advances generation after catalogue failure", result["remaining"] == 8 and db.execute("SELECT count(*) FROM statarena_app.publication_jobs").fetchone()[0] == 0 and db.execute("SELECT generation FROM statarena_app.publications").fetchone()[0] == generation + 3)

    result, _, generation, output = scenario(catalog_count=8, partition_count=2, fail_catalog_at=6)
    check("later catalogue failure preserves earlier committed batch statistics", result["catalog_inputs"] == 4 and result["failed_catalog_batches"] == 1 and result["partitions"] == 2 and result["remaining"] == 4 and '"committed_inputs":4' in output)
    check("later catalogue failure preserves only completed receipts and generation", db.execute("SELECT count(*) FROM continuation_records WHERE kind='catalog'").fetchone()[0] == 4 and db.execute("SELECT count(*) FROM statarena_app.worker_inputs WHERE kind='object'").fetchone()[0] == 4 and db.execute("SELECT count(*) FROM work_catalog").fetchone()[0] == 4 and db.execute("SELECT generation FROM statarena_app.publications").fetchone()[0] == generation + 4)

    result, events, generation, output = scenario(catalog_count=8, partition_count=1, fail_globals=True)
    check("global failure does not starve catalogue or healthy partitions", result["failed_globals"] == 1 and result["catalog_inputs"] == 8 and result["partitions"] == 1 and result["remaining"] == 1 and db.execute("SELECT status FROM statarena_app.workflow_state").fetchone()[0] == "failed")
    check("failed global facts and receipt roll back without repeated attempts", events.count(("global",)) == 1 and db.execute("SELECT count(*) FROM continuation_records WHERE kind='global'").fetchone()[0] == 0 and db.execute("SELECT count(*) FROM statarena_app.worker_inputs WHERE kind='global'").fetchone()[0] == 0 and db.execute("SELECT generation FROM statarena_app.publications").fetchone()[0] == generation + 3)
    check("global failure log does not expose source exception text", output.count('"phase":"global-deferred"') == 1 and '"error_code":"ValueError"' in output and "source-body-must-not-appear" not in output)

    result, _, generation, output = scenario(catalog_count=8, partition_count=2, fail_globals=True, fail_catalog_at=2)
    check("two failed queues remain pending while healthy partitions finish", result["failed_globals"] == result["failed_catalog_batches"] == 1 and result["partitions"] == 2 and result["remaining"] == 9 and db.execute("SELECT generation FROM statarena_app.publications").fetchone()[0] == generation + 2)
    check("each failed queue has one safe attempt per invocation", output.count('"phase":"global-deferred"') == output.count('"phase":"catalog-deferred"') == 1 and "source-body-must-not-appear" not in output)


def main():
    target = urlsplit(os.environ["TEST_DATABASE_URL"])
    if target.hostname not in ("localhost", "127.0.0.1", "::1") or target.path != "/vega_refactor_test":
        raise RuntimeError("A disposable loopback vega_refactor_test is required")
    checks = []

    def check(name, condition):
        if not condition:
            raise AssertionError(name)
        checks.append(name)

    with psycopg.connect(os.environ["TEST_DATABASE_URL"]) as db:
        check("fresh schema", db.execute("SELECT to_regnamespace('statarena_app')").fetchone()[0] is None)
        try:
            publisher.install(db)
            db.execute("CREATE TEMP TABLE work_scopes(season text,league_id text,digest text)")
            db.execute("CREATE TEMP TABLE source_markers(league text PRIMARY KEY)")
            db.execute("CREATE TEMP TABLE observed_publications(league text PRIMARY KEY)")
            db.execute("INSERT INTO work_scopes VALUES('2026/2027','l_bad','v1'),('2026/2027','l_good','v1')")
            db.execute("INSERT INTO source_markers VALUES('l_bad'),('l_good')")
            publisher.queue_changed_scopes(db)
            generation = db.execute("SELECT generation FROM statarena_app.publications").fetchone()[0]

            def prepare(*_):
                db.execute("CREATE TEMP TABLE work_catalog(kind text,key text)")

            def publish(inputs, manifest, season, league, marked, timing):
                # The real orchestrator owns this SQL transaction. Core write,
                # receipt and source consumption all deliberately precede failure.
                db.execute("INSERT INTO observed_publications VALUES(%s)", (league,))
                publisher.receipt(db, "partition", season+":"+league, "v1")
                db.execute("DELETE FROM source_markers WHERE league=%s", (league,))
                db.execute("DELETE FROM statarena_app.publication_jobs WHERE season=%s AND league_id=%s AND changed_at=%s", (season, league, marked))
                db.execute("UPDATE statarena_app.publications SET generation=generation+1")
                if league == "l_bad":
                    raise ValueError("Untrusted source payload must not be persisted in queue errors")
                return 1

            fake_inputs = SimpleNamespace(db=db, read=lambda path: {})
            with patch.object(publisher, "capacity", return_value=10**12), \
                 patch.object(publisher, "Inputs", return_value=fake_inputs), \
                 patch.object(publisher, "prepare", side_effect=prepare), \
                 patch.object(publisher, "publish_partition", side_effect=publish), \
                 patch.object(publisher, "publish_global", return_value={}), \
                 patch.object(publisher, "catalog_batch", return_value=0), \
                 patch.object(publisher, "queue_dirty"):
                result = publisher.run(SimpleNamespace(db=db), minutes=1, batch=2, max_partitions=1)
            check("healthy partition published after earlier failure", result["partitions"] == 1 and result["failed_partitions"] == 1)
            check("failed inputs retained and counted", result["remaining"] == result["deferred_partitions"] == 1)
            check("only healthy facts retained", db.execute("SELECT league FROM observed_publications").fetchall() == [("l_good",)])
            check("failed source marker preserved", db.execute("SELECT league FROM source_markers").fetchall() == [("l_bad",)])
            check("failed receipt rolled back", db.execute("SELECT key FROM statarena_app.worker_inputs WHERE kind='partition'").fetchall() == [("2026/2027:l_good",)])
            check("only healthy generation advances", db.execute("SELECT generation FROM statarena_app.publications").fetchone()[0] == generation+1)
            row = db.execute("""SELECT attempts,last_error_code,extract(epoch from(next_attempt_at-last_attempt_at)),changed_at
                FROM statarena_app.publication_jobs WHERE league_id='l_bad'""").fetchone()
            check("safe failure and five minute initial backoff", row[0:2] == (1, "ValueError") and 299 <= row[2] <= 301)
            check("workflow failure stays visible", db.execute("SELECT status,remaining FROM statarena_app.workflow_state").fetchone() == ("failed", 1))
            publisher.queue_changed_scopes(db)
            check("identical source does not reset retry", db.execute("SELECT attempts FROM statarena_app.publication_jobs").fetchone()[0] == 1)
            db.execute("UPDATE work_scopes SET digest='v2' WHERE league_id='l_bad'")
            publisher.queue_changed_scopes(db)
            check("new source resets backoff and changes watermark", db.execute("SELECT attempts,next_attempt_at,last_error_code,source_stamp,changed_at>%s FROM statarena_app.publication_jobs", (row[3],)).fetchone() == (0, None, None, "v2", True))
            publisher.defer_partition(db, "2026/2027", "l_bad", row[3], ValueError("old attempt"))
            check("stale attempt cannot defer newer source", db.execute("SELECT attempts FROM statarena_app.publication_jobs").fetchone()[0] == 0)
            marked = db.execute("SELECT changed_at FROM statarena_app.publication_jobs").fetchone()[0]
            db.execute("UPDATE statarena_app.publication_jobs SET attempts=100")
            publisher.defer_partition(db, "2026/2027", "l_bad", marked, psycopg.errors.CheckViolation())
            row = db.execute("SELECT attempts,last_error_code,extract(epoch from(next_attempt_at-last_attempt_at)) FROM statarena_app.publication_jobs").fetchone()
            check("retry cap prevents overflow and retains SQLSTATE", row[0:2] == (101, "23514") and 21599 <= row[2] <= 21601)
            continuation_checks(db, check)
        finally:
            db.rollback()
        check("isolated schema rolled back", db.execute("SELECT to_regnamespace('statarena_app')").fetchone()[0] is None)
        print(json.dumps(dict(status="passed", server_version=db.info.server_version, checks=checks,
                              writes="isolated fixtures rolled back")))


if __name__ == "__main__":
    main()
