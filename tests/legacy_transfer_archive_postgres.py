"""Exercise migration 026 on an owned, disposable PostgreSQL database.

No cloud database is accepted. The exact same fixture can run on native
PostgreSQL in CI and the local PGlite socket used by the development environment.
"""

import json
import os
from pathlib import Path
from urllib.parse import urlsplit

import psycopg
from psycopg import sql
from psycopg.types.json import Jsonb

ROOT = Path(__file__).resolve().parents[1]
NAMES = (
    "neon_asset_delta", "neon_asset_job_delta", "neon_delta_documents",
    "neon_delta_queue", "neon_dirty_partition_delta", "neon_ingest_failure_delta",
    "neon_job_delta", "neon_projection_delta", "neon_resource_delta", "neon_state_delta",
)


def run(db):
    checks = []

    def check(label, value):
        if not value:
            raise AssertionError(label)
        checks.append(label)

    def as_owner(owner, action):
        with db.transaction():
            db.execute(sql.SQL("SET LOCAL ROLE {}").format(sql.Identifier(owner)))
            result = action()
            db.execute("RESET ROLE")
            return result

    def preflight(owner="statarena_ingest", archived=False):
        return as_owner(owner, lambda: db.execute("SELECT statarena_app.legacy_transfer_preflight(%s)", (archived,)).fetchone()[0])

    def archive(plan, owner=None):
        return as_owner(owner or plan["owner"], lambda: db.execute("SELECT statarena_app.legacy_transfer_archive(%s)", (Jsonb(plan),)).fetchone()[0])

    def rollback(receipt):
        return as_owner(receipt["owner"], lambda: db.execute("SELECT statarena_app.legacy_transfer_rollback(%s)", (Jsonb(receipt),)).fetchone()[0])

    def authorize(owner="statarena_admin", owners=None):
        return as_owner(owner, lambda: db.execute("SELECT statarena_app.legacy_transfer_authorize(%s)",
            (owners or ["statarena_admin", "statarena_ingest"],)).fetchone()[0])

    def fails(label, action, fragment):
        try:
            with db.transaction():
                action()
        except psycopg.Error as error:
            check(label, fragment in str(error))
        else:
            raise AssertionError(label)

    def values(schema):
        return {name: db.execute(sql.SQL("SELECT * FROM {}.{} ORDER BY id").format(
            sql.Identifier(schema), sql.Identifier(name))).fetchall() for name in NAMES}

    db.execute("CREATE ROLE statarena_admin NOINHERIT; CREATE ROLE statarena_ingest NOINHERIT")
    db.execute(sql.SQL("GRANT CREATE ON DATABASE {} TO statarena_admin").format(sql.Identifier(db.execute("SELECT current_database()").fetchone()[0])))
    db.execute("CREATE SCHEMA statarena AUTHORIZATION statarena_admin; CREATE SCHEMA statarena_app AUTHORIZATION statarena_ingest; CREATE SCHEMA neon_auth")
    db.execute("GRANT USAGE ON SCHEMA statarena TO statarena_ingest")
    db.execute("CREATE TABLE statarena.jobs(id integer PRIMARY KEY); INSERT INTO statarena.jobs VALUES(11)")
    db.execute('CREATE TABLE neon_auth."user"(id integer PRIMARY KEY); INSERT INTO neon_auth."user" VALUES(22)')
    for name in NAMES:
        db.execute(sql.SQL("CREATE TABLE statarena.{}(id integer PRIMARY KEY, document jsonb, raw bytea, exact numeric, labels text[])").format(sql.Identifier(name)))
        db.execute(sql.SQL("INSERT INTO statarena.{} VALUES(1,%s,%s,%s,%s),(2,NULL,NULL,NULL,NULL)").format(sql.Identifier(name)),
                   (Jsonb({"missing": None, "value": 0, "text": "é 空"}), b"\x00\xff", "12345678901234567890.0000000001", ["", None, "é"]))
        owner = "statarena_admin" if name in ("neon_delta_documents", "neon_delta_queue") else "statarena_ingest"
        db.execute(sql.SQL("ALTER TABLE statarena.{} OWNER TO {}").format(sql.Identifier(name), sql.Identifier(owner)))
    db.execute((ROOT / "dashboard/backend/migrations/026_legacy_transfer_archive.sql").read_text())
    original = values("statarena")
    plan = preflight()
    admin_plan = preflight("statarena_admin")
    check("installation moves no tables", len(original) == 10 and db.execute("SELECT to_regnamespace('statarena_legacy_transfer')").fetchone()[0] is None)
    check("two owner preflights cover exactly the ten tables", len(plan["tables"]) == 8 and len(admin_plan["tables"]) == 2 and set(plan["tables"]) | set(admin_plan["tables"]) == set(NAMES))
    check("neither owner can read the other's capture rows", not db.execute("SELECT has_table_privilege('statarena_admin','statarena.neon_asset_delta','SELECT') OR has_table_privilege('statarena_ingest','statarena.neon_delta_documents','SELECT')").fetchone()[0])
    check("preflight counts every owned row exactly", all(item["rows"] == "2" for item in {**plan["tables"], **admin_plan["tables"]}.values()))
    check("ordinary primary keys are not external dependencies", all(not any(item["blockers"].values()) for item in plan["tables"].values()))
    check("operator functions are invoker rights and not public", db.execute("""
      SELECT bool_and(NOT p.prosecdef) AND NOT EXISTS(
        SELECT 1 FROM pg_proc p2, LATERAL aclexplode(p2.proacl) a
        WHERE p2.pronamespace='statarena_app'::regnamespace AND p2.proname LIKE 'legacy_transfer_%'
          AND a.grantee=0 AND a.privilege_type='EXECUTE')
      FROM pg_proc p WHERE p.pronamespace='statarena_app'::regnamespace AND p.proname LIKE 'legacy_transfer_%'
    """).fetchone()[0])
    fails("archival requires prior schema-owner authorization", lambda: archive(plan), "source-schema owner authorization")
    fails("only the source-schema owner can authorize", lambda: authorize("statarena_ingest"), "source-schema owner")
    fails("authorization rejects an unreviewed owner set", lambda: authorize(owners=["statarena_admin"]), "exact reviewed owners")
    authorization = authorize()
    check("authorization names only the two existing owners", authorization["owners"] == ["statarena_admin", "statarena_ingest"])
    fails("one owner cannot submit the other's receipt", lambda: archive(plan, "statarena_admin"), "current table owner")

    db.execute("CREATE VIEW statarena.capture_consumer AS SELECT id FROM statarena.neon_delta_documents")
    fails("an external view blocks the entire move", lambda: archive(preflight("statarena_admin")), "dependencies, triggers or policies")
    db.execute("DROP VIEW statarena.capture_consumer")
    db.execute("CREATE FUNCTION statarena.capture_consumer() RETURNS bigint LANGUAGE sql AS 'SELECT count(*) FROM statarena.neon_delta_documents'")
    fails("string-body SQL consumer is detected", lambda: archive(preflight("statarena_admin")), "dependencies, triggers or policies")
    db.execute("DROP FUNCTION statarena.capture_consumer()")
    db.execute("CREATE FUNCTION statarena.capture_trigger() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RETURN NEW; END'")
    db.execute("CREATE TRIGGER capture_trigger BEFORE INSERT ON statarena.neon_asset_delta FOR EACH ROW EXECUTE FUNCTION statarena.capture_trigger()")
    db.execute("ALTER TABLE statarena.neon_asset_delta DISABLE TRIGGER capture_trigger")
    fails("even a disabled trigger blocks archival", lambda: archive(preflight()), "dependencies, triggers or policies")
    db.execute("DROP TRIGGER capture_trigger ON statarena.neon_asset_delta; DROP FUNCTION statarena.capture_trigger()")
    db.execute("CREATE TABLE statarena.active_reference(id integer REFERENCES statarena.neon_asset_delta(id))")
    fails("foreign-key consumers block archival", lambda: archive(preflight()), "dependencies, triggers or policies")
    db.execute("DROP TABLE statarena.active_reference")
    plan = preflight()
    db.execute("INSERT INTO statarena.neon_asset_delta(id) VALUES(3)")
    fails("a changed exact row count rejects a stale receipt", lambda: archive(plan), "preflight changed")
    original = values("statarena")
    plan = preflight()

    class UndoFixture(Exception):
        pass

    try:
        with db.transaction():
            archive(plan)
            raise UndoFixture()
    except UndoFixture:
        pass
    check("an owner batch rolls back atomically", values("statarena") == original)
    receipt = archive(plan)
    check("the other owner can resume after the first owner commits", preflight("statarena_admin") == admin_plan)
    admin_receipt = archive(admin_plan)
    check("archival preserves exact native values", values("statarena_legacy_transfer") == original)
    check("archival preserves OIDs, ACLs, indexes, columns and counts", receipt["before"]["tables"] == receipt["after"]["tables"])
    check("only allowlisted source tables move", all(db.execute("SELECT to_regclass(%s)", ("statarena." + name,)).fetchone()[0] is None for name in NAMES))
    check("repeated archival is idempotent", archive(plan) == receipt)
    db.execute("CREATE TABLE statarena.neon_state_delta(id integer)")
    fails("rollback refuses an occupied original name", lambda: rollback(receipt), "destination is occupied")
    db.execute("DROP TABLE statarena.neon_state_delta")
    db.execute("INSERT INTO statarena_legacy_transfer.neon_asset_delta(id) VALUES(4)")
    fails("rollback refuses unreviewed archive changes", lambda: rollback(receipt), "preflight changed")
    db.execute("DELETE FROM statarena_legacy_transfer.neon_asset_delta WHERE id=4")
    restored = rollback(receipt)
    admin_restored = rollback(admin_receipt)
    check("explicit rollback restores every exact row and relation identity", values("statarena") == original and preflight()["tables"] == plan["tables"] and preflight("statarena_admin")["tables"] == admin_plan["tables"])
    check("repeated rollback is idempotent for both owners", rollback(receipt) == restored and rollback(admin_receipt) == admin_restored)
    check("active staging and authentication tables are unchanged", db.execute("SELECT id FROM statarena.jobs").fetchall() == [(11,)] and db.execute('SELECT id FROM neon_auth."user"').fetchall() == [(22,)])
    return checks


def main():
    url = os.environ["TEST_DATABASE_URL"]
    address = urlsplit(url)
    if address.hostname not in ("localhost", "127.0.0.1", "::1", "postgres") or address.path not in ("/vega_refactor_test", "/vega_ci_test", "/vega_legacy_transfer_test"):
        raise RuntimeError("Use an owned disposable loopback/CI PostgreSQL database")
    with psycopg.connect(url, autocommit=True) as db:
        if db.execute("SELECT to_regnamespace('statarena'),to_regnamespace('statarena_app'),to_regnamespace('neon_auth')").fetchone() != (None, None, None):
            raise RuntimeError("Use a fresh disposable database")
        checks = run(db)
        print(json.dumps({"status": "passed", "server": db.execute("SELECT version()").fetchone()[0], "checks": checks}, indent=2))


if __name__ == "__main__":
    main()
