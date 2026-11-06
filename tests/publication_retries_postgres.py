"""SQL queue recovery: failed work is retained and cannot starve healthy partitions."""

import json
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from urllib.parse import urlsplit

import psycopg

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "dashboard/scripts"))
import relational_materialize as publisher


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
                result = publisher.run(SimpleNamespace(db=db), minutes=1, batch=2)
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
        finally:
            db.rollback()
        check("isolated schema rolled back", db.execute("SELECT to_regnamespace('statarena_app')").fetchone()[0] is None)
        print(json.dumps(dict(status="passed", server_version=db.info.server_version, checks=checks,
                              writes="isolated fixtures rolled back")))


if __name__ == "__main__":
    main()
