"""Real SQL parity, bounded writes and rollback for incremental core publication."""

import copy
import json
import os
import sys
from pathlib import Path
from urllib.parse import urlparse

import psycopg

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "dashboard/scripts"), str(ROOT / "tests")]
from build_dashboard_data import build_snapshot
from relational_core import _publish_full_snapshot, publish_snapshot, MAX_CORE_WRITE_ROWS
from relational_materialize import install
from relational_snapshot import read_partition, snapshot
from test_dashboard_data import synthetic, metric


def cohort(count=70):
    raw, catalog = synthetic()
    base = raw["samples"][0]
    samples = []
    for i in range(count):
        item = copy.deepcopy(base)
        mid = "m_" + str(i).zfill(6)
        item["match"]["id"] = mid
        item["match"]["score_home"] = 1
        item["shots"]["data"]["periods"][0]["shots"][0]["id"] = "s_" + str(i).zfill(6)
        item["players"]["data"][0]["stats"][0]["stats"]["Speed"] = metric("physical_metrics_topspeed", 33.125)
        samples.append(item)
    value = build_snapshot({"samples": samples}, catalog)
    value["meta"]["retrievedAt"] = "2026-11-01T12:00:00Z"
    # Native representation is explicitly stored separately from numeric columns.
    for i, appearance in enumerate(value["appearances"]):
        appearance["shirtNumber"] = ("09", 9, 9.5, True, None)[i % 5]
        appearance["positionId"] = (11, "11", None)[i % 3]
    return value


class MeasuredDB:
    def __init__(self, db):
        self.db, self.bind_counts = db, []

    def __getattr__(self, key):
        return getattr(self.db, key)

    def execute(self, query, params=None):
        if params is not None:
            self.bind_counts.append(len(params))
        return self.db.execute(query, params)


def main():
    target = urlparse(os.environ["TEST_DATABASE_URL"])
    if target.hostname not in {"127.0.0.1", "localhost", "::1"} or target.path != "/vega_refactor_test":
        raise RuntimeError("Isolated loopback vega_refactor_test required")
    checks = []

    def check(name, condition):
        if not condition:
            raise AssertionError(name)
        checks.append(name)

    with psycopg.connect(os.environ["TEST_DATABASE_URL"]) as real:
        db = MeasuredDB(real)
        check("fresh schema", db.execute("SELECT to_regnamespace('statarena_app')").fetchone()[0] is None)
        try:
            install(db)
            season, league = "2026/2027", "l_000001"
            value = cohort()

            def published():
                part = read_partition(db, season, league)
                return snapshot(part["tables"], part["meta"], part["metrics"])

            def physical():
                return {
                    table: dict(db.execute(f"SELECT id,ctid::text FROM statarena_app.{table}"))
                    for table in ("matches", "appearances", "fixtures")
                }

            def generation():
                return db.execute("SELECT generation FROM statarena_app.publications").fetchone()[0]

            with db.transaction():
                _publish_full_snapshot(db, season, league, value)
                oracle = published()
                raise psycopg.Rollback()
            publish_snapshot(db, season, league, value)
            check("complete parity with legacy SQL writer", published() == oracle)
            check("every statement respects the PostgreSQL parameter ceiling", bool(db.bind_counts) and max(db.bind_counts) <= 60000)
            original = physical()
            corrected = copy.deepcopy(value)
            corrected["appearances"][35]["goals"] = 2
            corrected["meta"]["retrievedAt"] = "2026-11-02T12:00:00Z"
            before_generation = generation()
            publish_snapshot(db, season, league, corrected)
            after = physical()
            mid = corrected["appearances"][35]["matchId"]
            pid = corrected["appearances"][35]["id"]
            check("unchanged match rows survive a one-player correction", after["matches"] == original["matches"])
            check("only corrected match appearances replaced", {key for key in original["appearances"] if original["appearances"][key] != after["appearances"][key]} == {pid})
            check("unchanged calendar rows preserved", after["fixtures"] == original["fixtures"])
            check("single generation for committed correction", generation() == before_generation + 1)
            check("corrected value and native shirt preserved", db.execute("SELECT a.goals,s.value_text,s.value_type FROM statarena_app.appearances a JOIN statarena_app.appearance_shirt_numbers s ON s.appearance_id=a.id WHERE a.id=%s", (pid,)).fetchone() == (2, "09", "str"))

            # A re-read projects database float8 values back to the same typed facts.
            fresh = copy.deepcopy(corrected)
            fresh["meta"]["retrievedAt"] = "2026-11-03T12:00:00Z"
            publish_snapshot(db, season, league, fresh)
            check("new timestamp alone never rewrites match facts", physical() == after)

            # Inserting a match earlier in the global list cannot renumber other matches.
            extra = cohort(71)
            extra["appearances"][35]["goals"] = 2
            extra["meta"]["retrievedAt"] = "2026-11-04T12:00:00Z"
            publish_snapshot(db, season, league, extra)
            added = physical()
            check("new match preserves all prior appearance tuples", all(added["appearances"][key] == ctid for key, ctid in after["appearances"].items()))
            check("new match is present", len(added["matches"]) == 71)

            before_failure, generation_before_failure = published(), generation()
            tuples_before_failure = physical()
            db.execute("""CREATE FUNCTION pg_temp.fail_second_batch() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN IF NEW.id='m_000050' THEN RAISE EXCEPTION 'synthetic batch failure'; END IF; RETURN NEW; END $$""")
            db.execute("CREATE TRIGGER test_mid_partition_failure BEFORE INSERT OR UPDATE ON statarena_app.matches FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_second_batch()")
            broken = copy.deepcopy(extra)
            for match in broken["matches"]:
                match["home"]["score"] = 4
            try:
                with db.transaction():
                    publish_snapshot(db, season, league, broken)
            except psycopg.errors.RaiseException as error:
                check("failure injected after first bounded batch", "synthetic batch failure" in str(error))
            else:
                raise AssertionError("Expected injected failure")
            check("earlier batches rollback with the failed partition", physical() == tuples_before_failure and published() == before_failure)
            check("failed partition never advances generation", generation() == generation_before_failure)
            db.execute("DROP TRIGGER test_mid_partition_failure ON statarena_app.matches")

            removed = copy.deepcopy(extra)
            removed_mid = removed["matches"].pop()["id"]
            removed["appearances"] = [p for p in removed["appearances"] if p["matchId"] != removed_mid]
            publish_snapshot(db, season, league, removed)
            check("explicit snapshot removal is scoped and cascades consistently", db.execute("SELECT count(*) FROM statarena_app.matches WHERE id=%s", (removed_mid,)).fetchone()[0] == 0
                  and db.execute("SELECT count(*) FROM statarena_app.appearances WHERE match_id=%s", (removed_mid,)).fetchone()[0] == 0)
            check("remaining matches keep physical identity", len(physical()["matches"]) == 70)
            check("parameter ceiling holds across all scenarios", max(db.bind_counts) <= 60000)
        finally:
            db.rollback()
        print(json.dumps({"status": "passed", "checks": checks, "max_bind_parameters": max(db.bind_counts),
                          "seed_matches": 70, "one_goal_correction_appearance_rows_replaced": 1,
                          "writes": "isolated test transaction rolled back"}))


if __name__ == "__main__":
    main()
