"""Exercise explicit physical retirement on a fresh disposable PostgreSQL database.

The synthetic recovery attestation below is fixture input, not evidence that a
real snapshot was restored. Production retirement additionally needs the native
operator's reviewed backup/restore and post-snapshot replay evidence.
"""

from copy import deepcopy
import json
import os
from pathlib import Path
import sys
from urllib.parse import urlsplit

import psycopg
from psycopg import sql
from psycopg.types.json import Jsonb

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "dashboard/scripts"))
from consolidated_model import MODEL_DIGEST, NODES
from consolidated_storage import storage_mode
from consolidation_postgres import PGliteCopyAdapter, seed_every_node
from relational_catalog import _publish_group
from relational_match import publish_match_details
from relational_materialize import install
from relational_support import publish_supporting
from lineup_consolidation import execute as lineup_operation
from finalize_schema_retirement import apply_parameters, validate_plan, validate_receipt, validate_recovery


def fixture_recovery(plan):
    """Only a disposable SQL fixture may use these synthetic evidence digests."""
    return {
        "format": "vega.provider-retirement.recovery.v1",
        "database": plan["manifest"]["database"],
        "model_digest": MODEL_DIGEST,
        "manifest_sha256": plan["manifest_sha256"],
        "snapshot": {"identifier": "disposable-fixture-only", "status": "available",
                     "captured_at": "2026-01-01T00:00:00Z", "receipt_sha256": "1" * 64},
        "restore": {"snapshot_identifier": "disposable-fixture-only", "status": "verified",
                    "verified_at": "2026-01-01T01:00:00Z", "retired_table_count": 112,
                    "active_contracts_passed": True, "receipt_sha256": "2" * 64},
        "preservation": {"status": "verified", "full_readback_verified": True,
                         "receipt_sha256": "3" * 64, "artifact_sha256": "4" * 64},
        "recovery": {"strategy": "restore_snapshot_then_replay",
                     "post_snapshot_publication_replay_reviewed": True, "plan_sha256": "5" * 64},
        "approval": {"action": "retire_exact_112_provider_tables",
                     "loss_of_in_place_rollback_accepted": True},
    }


def run(db):
    checks = []
    native_only = []
    version = db.execute("SELECT version()").fetchone()[0]
    publishing = PGliteCopyAdapter(db) if "PGlite" in version else db

    def check(label, value):
        if not value:
            raise AssertionError(label)
        checks.append(label)

    def call(name, *args):
        return db.execute("SELECT statarena_app.consolidation_" + name + "(" +
                          ",".join(["%s"] * len(args)) + ")", args).fetchone()[0]

    def fails(label, operation, fragment, error_class=psycopg.Error):
        try:
            with db.transaction():
                operation()
        except error_class as error:
            check(label, fragment in str(error))
        else:
            raise AssertionError(label + " unexpectedly succeeded")

    def finalize(plan, recovery=None, confirmation=None):
        return call("finalize_retirement", Jsonb(plan),
                    Jsonb(fixture_recovery(plan) if recovery is None else recovery),
                    plan["manifest_sha256"] if confirmation is None else confirmation)

    def catalogue():
        return db.execute("SELECT resource_id,statarena_app.catalog_response(c) FROM statarena_app.catalog_editions c ORDER BY resource_id").fetchall()

    def details():
        return db.execute("SELECT resource_id,statarena_app.detail_response(f) FROM statarena_app.match_families f ORDER BY resource_id").fetchall()

    def store_fingerprints():
        return [db.execute(sql.SQL("SELECT count(*),encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(r) ORDER BY resource_id,record_kind,path),'[]'::jsonb)::text,'UTF8')),'hex') FROM statarena_app.{} r").format(sql.Identifier(name))).fetchone()
                for name in ("catalog_records", "support_records", "detail_records")]

    def retired_objects():
        return db.execute("SELECT 'table',c.oid,c.relname::text FROM pg_class c WHERE c.relnamespace='statarena_retired_v1'::regnamespace AND c.relkind='r' UNION ALL SELECT 'function',p.oid,p.proname::text FROM pg_proc p WHERE p.pronamespace='statarena_retired_v1'::regnamespace ORDER BY 1,2").fetchall()

    def journal():
        return db.execute("SELECT version,digest FROM statarena_app.worker_schema ORDER BY version").fetchall()

    # Preserve the pre-cutover runtime grant shape: no direct grant on future
    # record stores or migration state, only existing public table contracts.
    for prefix in ("003_", "004_", "005_", "006_", "007_", "008_", "009_", "010_", "011_", "020_", "021_", "022_"):
        db.execute(next((ROOT / "dashboard/backend/migrations").glob(prefix + "*.sql")).read_text())
    db.execute("CREATE ROLE vega_retirement_reader NOLOGIN")
    db.execute("GRANT USAGE ON SCHEMA statarena_app TO vega_retirement_reader")
    db.execute("GRANT SELECT ON ALL TABLES IN SCHEMA statarena_app TO vega_retirement_reader")
    install(db)
    db.execute("GRANT USAGE ON SCHEMA statarena_next TO vega_retirement_reader")
    home_oids = db.execute("SELECT 'statarena_app.home_projection'::regclass::oid,'statarena_app.home_projection_queue'::regclass::oid").fetchone()
    check("new home projection migration is installed before retirement", all(home_oids)
          and db.execute("SELECT count(*) FROM statarena_app.worker_schema WHERE version='035_home_projection.sql'").fetchone()[0] == 1)
    db.execute("INSERT INTO statarena_app.home_projection(scope_key,stamp,computed_at,valid_until,snapshot) VALUES('retirement-fixture','fixture',clock_timestamp(),clock_timestamp()+interval '1 hour','{\"retirement_fixture\":true}'::jsonb)")
    check("install036 creates no retirement receipt and leaves all112 legacy physical tables",
          call("status")["control"]["mode"] == "legacy"
          and db.execute("SELECT count(*) FROM pg_class c WHERE c.oid=ANY(%s)",
                         ([db.execute("SELECT to_regclass(%s)::oid", ("statarena_app." + n.table,)).fetchone()[0] for n in NODES],)).fetchone()[0] == 112
          and db.execute("SELECT count(*) FROM statarena_app.consolidation_state WHERE key='physical_retirement'").fetchone()[0] == 0)
    fails("legacy state cannot produce a retirement plan", lambda: call("retirement_plan"), "Verified active provider storage")
    seed_every_node(db, negative_ids=True)
    initial_lineups = {"status": 200, "data": {"home": {"starters": [
        {"player_id": "p_RETIR1", "name": "Before retirement", "shirt_number": "00", "pitch_x": -0.0}],
        "subs": None}, "away": None}}
    publish_match_details(publishing, "m_RETIR1", {"lineups": initial_lineups})
    with db.transaction():
        _publish_group(publishing, {("profile", "teams", "retirement"): (
            "profile_teams", {"status": 200, "data": {"id": "t_RETIR1", "name": "Before retirement"}}, "6" * 64)})
    publish_supporting(publishing, [("player-honours", {"id": "p_RETIR1"}, {"available": False})])
    call("begin", "backfill")
    for operation in ("copy_batch", "verify_batch"):
        for node in NODES:
            while not call(operation, node.table, 1000)["complete"]:
                pass
    for family in ("catalog", "support", "detail"):
        while not call("verify_resources", family, 128)["complete"]:
            pass
    call("activate")
    plan = call("retirement_plan")
    validate_plan(plan, plan["manifest_sha256"])
    validate_recovery(fixture_recovery(plan), plan)
    apply_parameters(plan, fixture_recovery(plan), plan["manifest_sha256"])
    check("real SQL plan and recovery envelope satisfy the independent CLI contract", True)
    check("reviewed plan contains exact112 tables and62 actual retired function identities",
          plan["ready"] is True and plan["blockers"] == []
          and sorted(x["name"] for x in plan["manifest"]["tables"]) == sorted(n.table for n in NODES)
          and len(plan["manifest"]["functions"]) == 62
          and all("statarena_retired_v1." in x["arguments"] for x in plan["manifest"]["functions"]))
    envelope_bytes = len(json.dumps([plan, fixture_recovery(plan), plan["manifest_sha256"]], separators=(",", ":")).encode())
    check("complete reviewed SQL parameter envelope fits below80KB without omitting catalogue hashes", envelope_bytes < 80000)
    check("pre-finalization status preserves the in-place rollback option", call("status")["rollback_available"] is True)

    with db.transaction():
        db.execute("SET LOCAL ROLE vega_retirement_reader")
        fails("runtime cannot invoke physical retirement plan", lambda: call("retirement_plan"), "permission denied")
        fails("runtime cannot invoke physical retirement finalizer", lambda: finalize(plan), "permission denied")
    fails("missing recovery evidence cannot retire data", lambda: finalize(plan, {}), "Reviewed available snapshot")
    fails("mismatched explicit confirmation cannot retire data", lambda: finalize(plan, confirmation="0" * 64), "explicit matching confirmation")
    altered_plan = deepcopy(plan)
    altered_plan["manifest"]["tables"][0]["oid"] = "1"
    fails("tampered reviewed manifest is rejected before execution", lambda: finalize(altered_plan), "explicit matching confirmation")
    for path, value, fragment in (
        (("restore", "retired_table_count"), 111, "Reviewed available snapshot"),
        (("restore", "active_contracts_passed"), None, "Reviewed available snapshot"),
        (("restore", "snapshot_identifier"), "a-different-snapshot", "Reviewed available snapshot"),
        (("preservation", "full_readback_verified"), False, "Reviewed available snapshot"),
        (("recovery", "post_snapshot_publication_replay_reviewed"), False, "Reviewed available snapshot"),
        (("approval", "loss_of_in_place_rollback_accepted"), False, "Reviewed available snapshot"),
        (("snapshot", "receipt_sha256"), "not-a-digest", "SHA-256"),
        (("restore", "verified_at"), "2025-12-31T23:00:00Z", "chronological"),
        (("snapshot", "captured_at"), "2026-01-01T00:00:00", "chronological"),
    ):
        recovery = fixture_recovery(plan)
        recovery[path[0]][path[1]] = value
        fails("recovery guard rejects " + ".".join(path), lambda: finalize(plan, recovery), fragment)
    with db.transaction():
        db.execute("UPDATE statarena_app.publications SET generation=generation+1,published_at=clock_timestamp()")
        fails("publication generation drift rejects the previously reviewed plan", lambda: finalize(plan), "plan is stale")
        raise psycopg.Rollback()
    with db.transaction():
        db.execute("CREATE VIEW statarena_app.unreviewed_retired_consumer AS SELECT * FROM statarena_retired_v1.lineup_sheets")
        blocked = call("retirement_plan")
        check("incoming active view is reported as a dependency blocker", not blocked["ready"] and any(x["kind"] == "external_dependency" for x in blocked["blockers"]))
        fails("unreviewed view prevents any DROP", lambda: finalize(plan), "plan is stale")
        raise psycopg.Rollback()
    with db.transaction():
        db.execute("CREATE TABLE statarena_app.unreviewed_composite(value statarena_retired_v1.lineup_sheets)")
        blocked = call("retirement_plan")
        check("a retained composite column blocks old row-type deletion", not blocked["ready"])
        raise psycopg.Rollback()
    with db.transaction():
        db.execute("CREATE TABLE statarena_app.unreviewed_fk(resource_id bigint,record_no integer,FOREIGN KEY(resource_id,record_no) REFERENCES statarena_retired_v1.lineup_sheets(resource_id,record_no))")
        fails("an incoming foreign key fails closed", lambda: call("retirement_plan"), "Unmapped foreign key")
        raise psycopg.Rollback()
    with db.transaction():
        db.execute("CREATE FUNCTION statarena_app.unreviewed_text_consumer() RETURNS bigint LANGUAGE sql AS $$ SELECT count(*) FROM statarena_retired_v1.lineup_sheets $$")
        blocked = call("retirement_plan")
        check("untracked string-body retired-schema consumer blocks retirement", not blocked["ready"] and any(x["kind"] == "retired_schema_function_reference" for x in blocked["blockers"]))
        raise psycopg.Rollback()
    with db.transaction():
        db.execute("ALTER TABLE statarena_retired_v1.lineup_sheets ADD COLUMN unreviewed text")
        fails("unmapped retired column drift fails closed", lambda: call("retirement_plan"), "Unmapped source columns")
        raise psycopg.Rollback()
    with db.transaction():
        db.execute("CREATE TABLE statarena_retired_v1.unreviewed_table(id integer)")
        fails("extra retired physical table is never added implicitly to DROP scope", lambda: call("retirement_plan"), "all and only")
        raise psycopg.Rollback()
    with db.transaction():
        db.execute("CREATE FUNCTION statarena_retired_v1.unreviewed_function() RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$")
        fails("extra retired function is never added implicitly to DROP scope", lambda: call("retirement_plan"), "Unexpected retired function")
        raise psycopg.Rollback()
    check("all rejected gates preserve the reviewed objects and state", call("retirement_plan")["manifest"] == plan["manifest"])

    if "PGlite" in version:
        native_only.append("Independent PostgreSQL backend lease contention (PGlite shares one backend)")
    else:
        with psycopg.connect(db.info.dsn, autocommit=True) as other:
            other.execute("SELECT pg_advisory_lock(97813003::bigint)")
            try:
                fails("independent publisher lease blocks retirement without waiting", lambda: finalize(plan), "Publication lease is busy", psycopg.errors.LockNotAvailable)
            finally:
                other.execute("SELECT pg_advisory_unlock(97813003::bigint)")

    objects_before = retired_objects()
    control_before = call("status")
    data_before = store_fingerprints()
    readers_before = (catalogue(), details())
    journal_before = journal()
    home_before = db.execute("SELECT to_jsonb(h) FROM statarena_app.home_projection h WHERE scope_key='retirement-fixture'").fetchone()[0]
    home_queue_before = db.execute("SELECT to_jsonb(q) FROM statarena_app.home_projection_queue q").fetchall()
    # Force a failure after all DROPs but before the final control receipt update.
    # PostgreSQL must restore every old table/function, not leave a partial lot.
    db.execute("CREATE TEMP TABLE retirement_fixture_marker(id integer)")
    db.execute("CREATE FUNCTION pg_temp.reject_retirement_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.value->'physical_retirement_finalized'='true'::jsonb THEN RAISE EXCEPTION 'fixture finalization rollback'; END IF; RETURN NEW; END $$")
    db.execute("CREATE TRIGGER fixture_retirement_rollback BEFORE UPDATE ON statarena_app.consolidation_state FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_retirement_receipt()")
    fails("late receipt failure rolls back the complete DROP transaction", lambda: finalize(plan), "fixture finalization rollback")
    db.execute("DROP TRIGGER fixture_retirement_rollback ON statarena_app.consolidation_state")
    check("atomic failure restores exact old table/function OIDs and proof state", retired_objects() == objects_before and call("status") == control_before)
    check("atomic failure leaves every active store row unchanged", store_fingerprints() == data_before)
    with db.transaction():
        db.execute("SET LOCAL ROLE vega_retirement_reader")
        check("least-privilege readers work before finalization", (catalogue(), details()) == readers_before)

    receipt = finalize(plan)
    validate_receipt(receipt, plan)
    check("real SQL finalization receipt satisfies the independent CLI contract", True)
    state = call("status")
    check("explicit finalizer physically removes exactly112 tables and62 old functions", receipt["dropped_tables"] == 112 and receipt["dropped_functions"] == 62 and retired_objects() == [])
    check("active mode and physical-table count remain unchanged", state["control"]["mode"] == "active" and state["active_physical_tables"] == control_before["active_physical_tables"] and state["retired_physical_tables"] == 0)
    check("normal publication generation is not changed by schema-only retirement", receipt["publication_before"] == receipt["publication_after"] == plan["manifest"]["publication"])
    check("all active source records and public responses survive exact retirement", store_fingerprints() == data_before and (catalogue(), details()) == readers_before)
    check("both new home projection tables retain their identities and complete rows", home_oids == db.execute("SELECT 'statarena_app.home_projection'::regclass::oid,'statarena_app.home_projection_queue'::regclass::oid").fetchone()
          and home_before == db.execute("SELECT to_jsonb(h) FROM statarena_app.home_projection h WHERE scope_key='retirement-fixture'").fetchone()[0]
          and home_queue_before == db.execute("SELECT to_jsonb(q) FROM statarena_app.home_projection_queue q").fetchall())
    check("migration journal and original cutover/parity proofs are retained", journal() == journal_before and state["progress"] == control_before["progress"] and db.execute("SELECT count(*) FROM statarena_app.consolidation_state WHERE key='retirement_manifest'").fetchone()[0] == 1)
    check("status makes snapshot/replay recovery and unavailable in-place rollback explicit", state["rollback_available"] is False and state["recovery_strategy"] == "restore_snapshot_then_replay" and state["control"]["physical_retirement_finalized"] is True and state["physical_retirement"]["status"] == "finalized")
    check("final receipt keeps exact reviewed manifest and evidence hashes", receipt["manifest"] == plan["manifest"] and receipt["recovery_proof"] == fixture_recovery(plan) and len(receipt["recovery_proof_sha256"]) == 64)
    check("identical retirement retry returns the stored receipt", finalize(plan) == receipt)
    different_recovery = fixture_recovery(plan)
    different_recovery["snapshot"]["receipt_sha256"] = "a" * 64
    fails("retry with different recovery evidence is refused", lambda: finalize(plan, different_recovery), "different evidence")
    check("post-finalization plan does not advertise another deletable copy", call("retirement_plan")["status"] == "finalized" and call("retirement_plan")["ready"] is False)
    fails("begin rollback fails before deleting proofs or changing mode", lambda: call("begin", "rollback"), "recovery requires the verified snapshot")
    fails("direct physical rollback fails with the same recovery instruction", lambda: call("rollback"), "recovery requires the verified snapshot")
    check("rejected rollback preserves finalized control and all proof checkpoints", call("status") == state)
    install(db)
    check("installer after retirement preserves journal, views and finalized state", journal() == journal_before and call("status") == state and (catalogue(), details()) == readers_before)
    db.execute((ROOT / "dashboard/backend/migrations/036_finalize_provider_retirement.sql").read_text())
    check("036 reapplication neither recreates sources nor changes finalization receipt", retired_objects() == [] and call("status") == state)

    changed_lineups = {"status": 200, "data": {"home": {"starters": [
        {"player_id": "p_RETIR1", "name": "After physical retirement", "shirt_number": "09", "pitch_x": -0.0}],
        "subs": []}, "away": None}}
    publish_match_details(publishing, "m_RETIR1", {"lineups": changed_lineups})
    with db.transaction():
        check("normal writer still selects active consolidated storage", storage_mode(db))
        _publish_group(publishing, {("profile", "teams", "retirement"): (
            "profile_teams", {"status": 200, "data": {"id": "t_RETIR1", "name": "After physical retirement"}}, "7" * 64)}, consolidated=True)
    publish_supporting(publishing, [("player-honours", {"id": "p_RETIR1"}, {"available": True})])
    check("actual detail writer replaces headers and descendants after retirement", db.execute("SELECT statarena_app.detail_response(f) FROM statarena_app.match_families f WHERE match_id='m_RETIR1' AND family='lineups'").fetchone()[0] == changed_lineups)
    check("actual catalogue writer publishes into the surviving store", db.execute("SELECT statarena_app.catalog_response(c)#>>'{data,name}' FROM statarena_app.catalog_editions c WHERE catalog='profile' AND scope='teams' AND edition='retirement'").fetchone()[0] == "After physical retirement")
    check("actual support writer publishes into the surviving store", db.execute("SELECT h.available FROM statarena_app.support_honours h JOIN statarena_app.support_projection p ON p.id=h.projection_id WHERE p.name='player-honours' AND p.params::jsonb->>'id'='p_RETIR1'").fetchone()[0] is True)
    check("post-retirement publication keeps home projection invalidation operational", db.execute("SELECT q.generation=p.generation FROM statarena_app.home_projection_queue q CROSS JOIN statarena_app.publications p").fetchone()[0]
          and home_before == db.execute("SELECT to_jsonb(h) FROM statarena_app.home_projection h WHERE scope_key='retirement-fixture'").fetchone()[0])
    check("post-retirement typed compatibility reads retain native negative zero", db.execute("SELECT encode(float8send(s.pitch_x),'hex') FROM statarena_app.lineup_home_starters s JOIN statarena_app.match_families f USING(resource_id) WHERE f.match_id='m_RETIR1'").fetchone()[0] == "8000000000000000")
    after_writes = (catalogue(), details())
    with db.transaction():
        db.execute("SET LOCAL ROLE vega_retirement_reader")
        check("least-privilege runtime sees all new published rows after deletion", (catalogue(), details()) == after_writes)
        check("runtime still has no direct record-store access", not db.execute("SELECT has_table_privilege(current_user,'statarena_app.detail_records','SELECT')").fetchone()[0])
    lineup_operation(db, action="rollback")
    check("independent legacy lineup-reader switch remains available", db.execute("SELECT statarena_app.detail_response(f) FROM statarena_app.match_families f WHERE match_id='m_RETIR1' AND family='lineups'").fetchone()[0] == changed_lineups)
    check("new publication never recreates any retired physical object", retired_objects() == [] and call("status")["control"]["physical_retirement_finalized"] is True)
    return {"status": "passed", "server": version, "checks": checks,
            "applyEnvelopeBytes": envelope_bytes, "not_exercised_native_only": native_only}


def main():
    url = os.environ["TEST_DATABASE_URL"]
    address = urlsplit(url)
    if address.path not in ("/vega_retirement_test", "/vega_ci_test") or not address.hostname or address.hostname.endswith(".rds.amazonaws.com"):
        raise RuntimeError("A fresh disposable loopback/CI PostgreSQL database is required")
    with psycopg.connect(url, autocommit=True) as db:
        if db.execute("SELECT to_regnamespace('statarena_app')").fetchone()[0]:
            raise RuntimeError("Use a fresh disposable database")
        print(json.dumps(run(db), indent=2))


if __name__ == "__main__":
    main()
