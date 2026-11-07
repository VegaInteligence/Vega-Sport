"""Compare real flat-profile publication batches on disposable PostgreSQL.

All fixture writes roll back. Native PostgreSQL uses COPY. The local PGlite
wire bridge substitutes a batched INSERT only for COPY transport; its timing
is reported separately and must not be treated as production throughput.
"""

from contextlib import contextmanager, redirect_stdout
from hashlib import sha256
import io
import json
import os
from pathlib import Path
import re
import statistics
import sys
import time
from types import SimpleNamespace
from urllib.parse import urlsplit

import psycopg
from psycopg.types.json import Jsonb

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "dashboard/scripts"))
import relational_materialize as publisher
from consolidated_model import NODES


class CountedConnection:
    def __init__(self, db, pglite):
        self.db, self.pglite = db, pglite
        self.reset()

    def reset(self):
        self.calls = dict(execute=0, executemany=0, stream=0, copy=0, transaction=0)

    def __getattr__(self, name):
        return getattr(self.db, name)

    def execute(self, *args, **kwargs):
        self.calls["execute"] += 1
        return self.db.execute(*args, **kwargs)

    def transaction(self, *args, **kwargs):
        self.calls["transaction"] += 1
        return self.db.transaction(*args, **kwargs)

    def cursor(self):
        parent = self
        inner = self.db.cursor()

        class Cursor:
            def __enter__(self):
                inner.__enter__()
                return self

            def __exit__(self, *args):
                return inner.__exit__(*args)

            def executemany(self, *args, **kwargs):
                parent.calls["executemany"] += 1
                return inner.executemany(*args, **kwargs)

            def stream(self, *args, **kwargs):
                parent.calls["stream"] += 1
                return inner.stream(*args, **kwargs)

            @contextmanager
            def copy(self, statement):
                parent.calls["copy"] += 1
                if not parent.pglite:
                    with inner.copy(statement) as stream:
                        yield stream
                    return
                match = re.fullmatch(r"COPY ([a-z_]+\.[a-z_]+) \(([a-z_,]+)\) FROM STDIN", statement)
                if not match:
                    raise AssertionError("Unexpected local COPY transport")
                table, columns = match.groups()
                rows = []
                yield SimpleNamespace(write_row=rows.append)
                if rows:
                    placeholders = "(" + ",".join(["%s"] * len(columns.split(","))) + ")"
                    inner.execute("INSERT INTO " + table + " (" + columns + ") VALUES "
                                  + ",".join([placeholders] * len(rows)),
                                  [value for row in rows for value in row])

        return Cursor()


def main():
    url = os.environ["TEST_DATABASE_URL"]
    target = urlsplit(url)
    if target.hostname not in ("localhost", "127.0.0.1", "::1") or target.path != "/vega_refactor_test":
        raise RuntimeError("A disposable loopback vega_refactor_test is required")
    with psycopg.connect(url) as db:
        try:
            assert db.execute("SELECT to_regnamespace('statarena_app')").fetchone()[0] is None
            version = db.execute("SELECT version()").fetchone()[0]
            publisher.install(db)
            # Activate the real empty consolidated layout through all parity
            # gates; no direct edits to its control state or adapter views.
            db.execute("SELECT statarena_app.consolidation_begin('backfill')")
            for action in ("copy_batch", "verify_batch"):
                for node in NODES:
                    for _ in range(4):
                        if db.execute("SELECT statarena_app.consolidation_"+action+"(%s,500)", (node.table,)).fetchone()[0]["complete"]:
                            break
                    else:
                        raise AssertionError("Disposable consolidation did not converge")
            for family in ("catalog", "detail", "support"):
                for _ in range(4):
                    if db.execute("SELECT statarena_app.consolidation_verify_resources(%s,16)", (family,)).fetchone()[0]["complete"]:
                        break
                else:
                    raise AssertionError("Disposable resource parity did not converge")
            assert db.execute("SELECT statarena_app.consolidation_activate()").fetchone()[0]["mode"] == "active"
            db.execute("""CREATE SCHEMA statarena;
              CREATE TABLE statarena.objects(path text PRIMARY KEY,sha256 bytea NOT NULL);
              CREATE TABLE statarena.current_file_documents(source_path text,document_path text,document jsonb,PRIMARY KEY(source_path,document_path));
              CREATE TEMP TABLE work_catalog(kind text,key text,digest text,ref jsonb,status integer,error jsonb,PRIMARY KEY(kind,key));""")
            profiles = []
            for i in range(40):
                key = f"/players/p_{i:06}"
                body = {"data": {"id": f"p_{i:06}", "name": f"Profil é {i}", "short_name": "",
                                 "image_url": None, "country_code": "FR", "position_id": 0,
                                 "shirt_number": "00"}}
                raw = publisher.compact(body)
                digest = sha256(raw.encode()).hexdigest()
                path = f"fixture/profile-{i}.json"
                db.execute("INSERT INTO statarena.objects VALUES(%s,%s)", (path, bytes.fromhex(digest)))
                db.execute("INSERT INTO statarena.current_file_documents VALUES(%s,%s,%s)", (path, path, Jsonb(body)))
                profiles.append(("profile", key, digest, Jsonb({"path": path, "sha256": digest}), 200, None))
            counted = CountedConnection(db, "PGlite" in version)
            inputs = publisher.Inputs(SimpleNamespace(db=counted))
            baseline = None
            samples = []

            def run(profile_limit, *, retain=False):
                nonlocal baseline
                db.execute("SAVEPOINT profile_case")
                db.cursor().executemany("INSERT INTO work_catalog VALUES(%s,%s,%s,%s,%s,%s)", profiles)
                before_generation = db.execute("SELECT generation FROM statarena_app.publications").fetchone()[0]
                counted.reset()
                batches, total = [], 0
                started = time.monotonic()
                with redirect_stdout(io.StringIO()):
                    while total < 40:
                        count = publisher.catalog_batch(inputs, min(4, 40-total), profile_limit=min(profile_limit, 40-total))
                        assert count > 0
                        batches.append(count)
                        total += count
                elapsed = time.monotonic() - started
                counters = dict(counted.calls)
                rows = db.execute("""SELECT c.catalog,c.scope,c.edition,c.model,c.source_digest,c.response_status,
                    statarena_app.catalog_response(c) FROM statarena_app.catalog_editions c ORDER BY c.scope,c.edition""").fetchall()
                receipts = db.execute("SELECT kind,key,digest FROM statarena_app.worker_inputs ORDER BY kind,key").fetchall()
                assert len(rows) == len(receipts) == 40
                assert db.execute("SELECT count(*) FROM work_catalog").fetchone()[0] == 0
                assert db.execute("SELECT count(*) FROM statarena_app.catalog_records").fetchone()[0] == 40
                assert db.execute("SELECT generation FROM statarena_app.publications").fetchone()[0] == before_generation + len(batches)
                if baseline is None:
                    baseline = (rows, receipts)
                assert (rows, receipts) == baseline, "batch size changes neither typed responses nor source receipts"
                assert counters["copy"] == counters["stream"] == len(batches)
                if retain:
                    samples.append(dict(profile_limit=profile_limit, batches=batches, elapsed_seconds=round(elapsed, 6), client_calls=counters))
                db.execute("ROLLBACK TO SAVEPOINT profile_case")
                db.execute("RELEASE SAVEPOINT profile_case")

            run(4)  # Warm statement/data caches before any recorded comparison.
            for limits in ((4,16,32),(32,16,4),(16,4,32)):
                for limit in limits:
                    run(limit, retain=True)
            summary = []
            for limit in (4,16,32):
                chosen = [s for s in samples if s["profile_limit"] == limit]
                summary.append(dict(profile_limit=limit, batches=chosen[0]["batches"],
                                    median_seconds=round(statistics.median(s["elapsed_seconds"] for s in chosen),6),
                                    client_calls=chosen[0]["client_calls"]))
            report = dict(format="vega.catalog-profile-batches.fixture.v1", status="passed", engine=version,
                          copy_transport="batched-insert-adapter" if counted.pglite else "native-copy",
                          note="Rollback-only SQL fixture. Client API call counts are not wire round-trip counts. Timings are not production throughput.",
                          profiles=40, typed_response_and_receipt_parity=True, generation_per_batch=True,
                          summaries=summary, samples=samples)
            if os.environ.get("VEGA_CATALOG_BENCHMARK_EVIDENCE"):
                Path(os.environ["VEGA_CATALOG_BENCHMARK_EVIDENCE"]).write_text(json.dumps(report,indent=2)+"\n")
            print(json.dumps({key:value for key,value in report.items() if key!="samples"}))
        finally:
            db.rollback()


if __name__ == "__main__":
    main()
