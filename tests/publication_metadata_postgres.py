"""Real PostgreSQL checks for metadata publication and empty-alias cache invalidation.

Requires TEST_DATABASE_URL on loopback, database vega_refactor_test or *_e2e.
The application schema must not exist. All fixture/schema writes are rolled back.
"""

import copy
import json
import os
import sys
from pathlib import Path
from urllib.parse import urlparse

import psycopg
from psycopg import sql

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "dashboard/scripts"), str(ROOT / "tests")]
from build_dashboard_data import build_snapshot
from relational_materialize import (
    facts_receipt,
    install,
    publication_digest,
    publish_partition_snapshot,
    retire_empty_season_aliases,
    snapshot_facts,
)
from test_dashboard_data import synthetic

FACT_TABLES = (
    "matches", "fixtures", "players", "appearances", "appearance_metrics",
    "appearance_shirt_numbers", "shots", "team_statistics", "match_coverage",
    "match_warnings", "match_appearance_members", "teams", "team_seasons",
    "competitions", "competition_seasons", "competition_catalog_seasons",
    "metric_definitions", "partition_metrics",
)


def main():
    target = urlparse(os.environ["TEST_DATABASE_URL"])
    database = target.path.lstrip("/")
    if target.hostname not in {"localhost", "127.0.0.1", "::1"} or not (
        database == "vega_refactor_test" or database.endswith("_e2e")
    ):
        raise RuntimeError("An isolated loopback test database is required")
    checks = []

    def check(name, condition):
        if not condition:
            raise AssertionError(name)
        checks.append(name)

    with psycopg.connect(os.environ["TEST_DATABASE_URL"]) as db:
        check("fresh test schema", db.execute("SELECT to_regnamespace('statarena_app')").fetchone()[0] is None)
        try:
            install(db)
            value = build_snapshot(*synthetic())
            value["meta"].update(retrievedAt="2026-11-02T23:00:00Z", legacyCounter=999)
            season, league = "2026/2027", "l_000001"
            key = season + ":" + league

            def generation():
                return db.execute("SELECT generation FROM statarena_app.publications").fetchone()[0]

            def metadata_state():
                return (
                    db.execute("SELECT row_to_json(p)::text FROM statarena_app.partitions p WHERE season=%s AND league_id=%s", (season, league)).fetchone(),
                    db.execute("SELECT digest FROM statarena_app.worker_inputs WHERE kind='partition-facts-v1' AND key=%s", (key,)).fetchone(),
                    generation(),
                )

            def facts_state():
                return {
                    table: db.execute(sql.SQL("SELECT ctid::text,xmin::text,row_to_json(r)::text FROM statarena_app.{} r ORDER BY row_to_json(r)::text").format(sql.Identifier(table))).fetchall()
                    for table in FACT_TABLES
                }

            check("initial full publication", publish_partition_snapshot(db, season, league, value) == 1)
            before_facts, before_generation = facts_state(), generation()
            db.execute("""CREATE FUNCTION pg_temp.reject_fact_write() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN RAISE EXCEPTION 'Unexpected write to published facts'; END $$""")
            for table in FACT_TABLES:
                db.execute(sql.SQL("CREATE TRIGGER test_preserve_facts BEFORE INSERT OR UPDATE OR DELETE ON statarena_app.{} FOR EACH STATEMENT EXECUTE FUNCTION pg_temp.reject_fact_write()").format(sql.Identifier(table)))

            refreshed = copy.deepcopy(value)
            refreshed["meta"]["retrievedAt"] = "2026-11-06T12:00:00Z"
            refreshed["meta"]["notes"] = ["Original source retained; latest successful collection advanced."]
            refreshed["meta"].pop("legacyCounter")
            check("metadata refresh succeeds with fact writes forbidden", publish_partition_snapshot(db, season, league, refreshed) == 1)
            check("facts and tuple versions unchanged", facts_state() == before_facts)
            check("generation advances once for metadata", generation() == before_generation + 1)
            row = db.execute("SELECT retrieved_at,source_digest FROM statarena_app.partitions WHERE season=%s AND league_id=%s", (season, league)).fetchone()
            check("real source retrieval persisted", row[0] == refreshed["meta"]["retrievedAt"])
            check("public digest stays historical SHA256", row[1] == publication_digest(refreshed) and len(row[1]) == 64)
            proof = db.execute("SELECT digest FROM statarena_app.worker_inputs WHERE kind='partition-facts-v1' AND key=%s", (key,)).fetchone()[0]
            check("receipt bound to committed snapshot", proof == facts_receipt(row[1], snapshot_facts(refreshed)))
            check("obsolete metadata counter removed", db.execute("SELECT count(*) FROM statarena_app.partition_counts WHERE season=%s AND league_id=%s AND metric_key='legacyCounter'", (season, league)).fetchone()[0] == 0)
            check("notes replaced exactly", db.execute("SELECT note FROM statarena_app.partition_notes WHERE season=%s AND league_id=%s ORDER BY ordinal", (season, league)).fetchall() == [(n,) for n in refreshed["meta"]["notes"]])
            check("identical publication is a no-op", publish_partition_snapshot(db, season, league, refreshed) == 0 and generation() == before_generation + 1)

            committed = metadata_state()
            with db.transaction():
                interrupted = copy.deepcopy(refreshed)
                interrupted["meta"]["retrievedAt"] = "2026-11-07T12:00:00Z"
                publish_partition_snapshot(db, season, league, interrupted)
                raise psycopg.Rollback()
            check("rollback restores metadata receipt and generation together", metadata_state() == committed)

            try:
                publish_partition_snapshot(db, season, league, refreshed,
                    previous_facts=snapshot_facts(refreshed), previous_state={"source_digest": "outdated"})
            except RuntimeError:
                check("stale in-memory read cannot authorize metadata publication", metadata_state() == committed)
            else:
                raise AssertionError("Stale in-memory snapshot authorized publication")

            # Simulate another publisher replacing the full digest without updating this receipt.
            stale = copy.deepcopy(refreshed)
            stale["meta"]["retrievedAt"] = "2026-11-08T12:00:00Z"
            try:
                with db.transaction():
                    db.execute("UPDATE statarena_app.partitions SET source_digest=%s WHERE season=%s AND league_id=%s", ("b" * 64, season, league))
                    # Another publisher changed a fact as well as the digest.
                    # The delta writer may legitimately re-read unchanged facts,
                    # so an invalid receipt alone need not cause needless writes.
                    db.execute("ALTER TABLE statarena_app.appearances DISABLE TRIGGER test_preserve_facts")
                    db.execute("UPDATE statarena_app.appearances SET goals=99 WHERE id=%s", (refreshed["appearances"][0]["id"],))
                    db.execute("ALTER TABLE statarena_app.appearances ENABLE TRIGGER test_preserve_facts")
                    publish_partition_snapshot(db, season, league, stale)
            except psycopg.errors.RaiseException as error:
                check("stale receipt cannot authorize metadata path", "Unexpected write to published facts" in str(error))
            else:
                raise AssertionError("Stale proof incorrectly skipped a full publication")

            for table in FACT_TABLES:
                db.execute(sql.SQL("DROP TRIGGER test_preserve_facts ON statarena_app.{}").format(sql.Identifier(table)))
            changed = copy.deepcopy(refreshed)
            changed["appearances"][0]["goals"] = 2
            publish_partition_snapshot(db, season, league, changed)
            check("changed fact takes full publication path", db.execute("SELECT goals FROM statarena_app.appearances WHERE id=%s", (changed["appearances"][0]["id"],)).fetchone()[0] == 2)

            # Test the existing empty-alias retirement with one empty and one protected scope.
            db.execute("CREATE TEMP TABLE work_known(season text,league_id text)")
            db.execute("CREATE TEMP TABLE work_scopes(season text,league_id text)")
            for alias_league in ("l_empty", "l_protected"):
                db.execute("INSERT INTO statarena_app.competitions(id,latest_season) VALUES(%s,%s)", (alias_league, season))
                for cohort in ("2026", season):
                    db.execute("INSERT INTO statarena_app.partitions(season,league_id,source_digest) VALUES(%s,%s,'test-empty-alias')", (cohort, alias_league))
                    db.execute("INSERT INTO statarena_app.competition_seasons(competition_id,season) VALUES(%s,%s)", (alias_league, cohort))
                db.execute("INSERT INTO work_known VALUES(%s,%s)", (season, alias_league))
                db.execute("INSERT INTO statarena_app.publication_jobs(season,league_id) VALUES('2026',%s)", (alias_league,))
            db.execute("INSERT INTO statarena_app.partition_counts VALUES('2026','l_protected','matchCount',1)")
            before_generation = generation()
            retire_empty_season_aliases(db)
            check("only proven empty alias removed", db.execute("SELECT league_id FROM statarena_app.partitions WHERE season='2026' ORDER BY league_id").fetchall() == [("l_protected",)])
            check("only empty competition season removed", db.execute("SELECT competition_id FROM statarena_app.competition_seasons WHERE season='2026' ORDER BY competition_id").fetchall() == [("l_protected",)])
            check("alias retirement invalidates cache in same transaction", generation() == before_generation + 1)
            db.execute("DROP TABLE work_aliases")
            retire_empty_season_aliases(db)
            check("no retirement leaves generation unchanged", generation() == before_generation + 1)
        finally:
            db.rollback()
        check("entire isolated schema rolled back", db.execute("SELECT to_regnamespace('statarena_app')").fetchone()[0] is None)
        print(json.dumps({"status": "passed", "server_version": db.info.server_version,
                          "checks": checks, "writes": "isolated fixtures rolled back"}))


if __name__ == "__main__":
    main()
