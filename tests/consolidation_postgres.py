"""Execute the real migration, both writers and reverse-copy rollback on PostgreSQL.

TEST_DATABASE_URL must name a disposable database. No test is silently skipped.
The fixture runner does not accept the production database name or a public RDS host.
"""

import json
import os
from pathlib import Path
import sys
import re
from urllib.parse import urlsplit

import psycopg
from psycopg import sql

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "dashboard/scripts"))
from consolidated_model import NODES, CATALOG_MODELS, SUPPORT
from consolidation_sql import migration
from relational_catalog import _publish_group
from relational_match import publish_match_details
from relational_support import publish_supporting
from relational_match_model import families


class PGliteCopyAdapter:
    """Only the PGlite socket lacks reliable psycopg COPY completion messages.

    Keep real SQL types/constraints/transactions and exact publisher rows while
    substituting INSERT transport locally. Native PostgreSQL always uses COPY.
    """

    def __init__(self, db):
        self.db = db

    def __getattr__(self, name):
        return getattr(self.db, name)

    def cursor(self):
        parent = self

        class Cursor:
            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def copy(self, statement):
                match = re.fullmatch(r"COPY ([a-z_]+\.[a-z_]+) \(([^)]+)\) FROM STDIN", statement)
                if not match:
                    raise AssertionError("Unexpected COPY statement")
                target, names = match.groups()
                command = "INSERT INTO " + target + " (" + names + ") VALUES (" + ",".join(["%s"] * len(names.split(","))) + ")"

                class Stream:
                    def __enter__(self):
                        return self

                    def __exit__(self, *args):
                        return False

                    def write_row(self, row):
                        parent.db.execute(command, row)

                return Stream()

        return Cursor()


def seed_every_node(db, *, negative_ids=False):
    """One typed source row for every mapped node, including precision boundaries."""
    resources = {}
    allocated = {domain: 0 for domain in ("catalog", "support", "detail")}

    def next_resource(domain):
        ordinal = allocated[domain]
        allocated[domain] += 1
        return (-(2**63), -1, 0)[ordinal] if ordinal < 3 else -1000 - ordinal

    edition = "types-negative" if negative_ids else "types"
    floats = [-0.0, 0.0, 0.1, 1.2345678901234567, 5e-324, 1.7976931348623157e308]
    index = 0
    for node in NODES:
        if node.parent:
            resources[node.table] = resources[node.parent]
        elif node.domain == "catalog":
            model = next(k for k, v in CATALOG_MODELS.items() if v.table == node.table)
            if negative_ids:
                resources[node.table] = db.execute("INSERT INTO statarena_app.catalog_editions(resource_id,catalog,scope,edition,model,source_digest,response_status) OVERRIDING SYSTEM VALUE VALUES(%s,'fixture',%s,%s,%s,%s,200) RETURNING resource_id", (next_resource(node.domain), node.table, edition, model, "c" * 64)).fetchone()[0]
            else:
                resources[node.table] = db.execute("INSERT INTO statarena_app.catalog_editions(catalog,scope,edition,model,source_digest,response_status) VALUES('fixture',%s,%s,%s,%s,200) RETURNING resource_id", (node.table, edition, model, "c" * 64)).fetchone()[0]
        elif node.domain == "support":
            family = next(k for k, root in SUPPORT["families"].items() if SUPPORT["models"][root]["table"] == node.table)
            if negative_ids:
                resources[node.table] = db.execute("INSERT INTO statarena_app.support_projection(id,name,params,digest) OVERRIDING SYSTEM VALUE VALUES(%s,%s,%s,%s) RETURNING id", (next_resource(node.domain), family, json.dumps({"fixture": edition}), "d" * 64)).fetchone()[0]
            else:
                resources[node.table] = db.execute("INSERT INTO statarena_app.support_projection(name,params,digest) VALUES(%s,%s,%s) RETURNING id", (family, json.dumps({"fixture": edition}), "d" * 64)).fetchone()[0]
        else:
            family = next(k for k, v in families.items() if v.table == node.table)
            match_id = "m_" + str((800000 if negative_ids else 900000) + len(resources))
            db.execute("INSERT INTO statarena_app.match_details(match_id) VALUES(%s)", (match_id,))
            if negative_ids:
                resources[node.table] = db.execute("INSERT INTO statarena_app.match_families(resource_id,match_id,family,subject_id,params,status,has_data,has_error,error_object,error_has_code,error_has_message,source_digest) OVERRIDING SYSTEM VALUE VALUES(%s,%s,%s,'','{}',200,true,false,false,false,false,%s) RETURNING resource_id", (next_resource(node.domain), match_id, family, "e" * 64)).fetchone()[0]
            else:
                resources[node.table] = db.execute("INSERT INTO statarena_app.match_families(match_id,family,subject_id,params,status,has_data,has_error,error_object,error_has_code,error_has_message,source_digest) VALUES(%s,%s,'','{}',200,true,false,false,false,false,%s) RETURNING resource_id", (match_id, family, "e" * 64)).fetchone()[0]
        row = {node.resource: resources[node.table], "missing": [], "null_groups": []}
        if node.domain == "support":
            row.update({key: 0 for key in node.key_columns[1:]})
        else:
            row["record_no"] = 0
            if node.parent:
                row.update(parent_no=0, position=0)
            if node.keyed:
                row["metric_label"] = ""
        for col, kind in node.columns:
            row[col] = {"text": "é / 空 / literal null", "integer": 0, "boolean": False,
                        "date": "2026-11-06", "integer[]": [0, 2147483647],
                        "text[]": ["", None, "é"], "integer[][]": [[0, -2147483648], [2147483647, None]]}.get(kind)
            if kind == "double precision":
                row[col] = floats[index % len(floats)]
                index += 1
        statement = sql.SQL("INSERT INTO statarena_app.{} ({}) VALUES ({})").format(
            sql.Identifier(node.table), sql.SQL(",").join(map(sql.Identifier, row)),
            sql.SQL(",").join(sql.Placeholder() for _ in row))
        db.execute(statement, list(row.values()))


def run(db):
    checks = []
    publishing_db = PGliteCopyAdapter(db) if "PGlite" in db.execute("SELECT version()").fetchone()[0] else db

    def check(label, value):
        if not value:
            raise AssertionError(label)
        checks.append(label)

    def call(name, *args):
        return db.execute("SELECT statarena_app.consolidation_" + name + "(" + ",".join(["%s"] * len(args)) + ")", args).fetchone()[0]

    def copy_and_verify(action):
        call("begin", action)
        for node in NODES:
            for _ in range(100):
                if call("copy_batch", node.table, 2)["complete"]:
                    break
            else:
                raise AssertionError("copy did not converge")
        for node in NODES:
            for _ in range(100):
                if call("verify_batch", node.table, 2)["complete"]:
                    break
            else:
                raise AssertionError("verification did not converge")
        if action == "backfill":
            for kind in ("catalog", "detail", "support"):
                while not call("verify_resources", kind, 2)["complete"]:
                    pass

    def unchanged_copy_regressions(action):
        """Exercise the installed copier, including work avoided before INSERT."""
        reverse = action == "rollback"
        node = next(n for n in NODES if n.table == "lineup_home_starters")
        plan = next(p for p in call("status")["targets"] if p["table"] == node.table)
        destination_schema = "statarena_retired_v1" if reverse else "statarena_app"
        source_schema = "statarena_next" if reverse else "statarena_app"
        destination_tables = [n.table for n in NODES] if reverse else ["catalog_records", "support_records", "detail_records"]
        watched_tables = [node.table] if reverse else destination_tables

        def tuple_ids():
            return {table: db.execute(sql.SQL("SELECT ctid::text FROM {}.{} ORDER BY ctid").format(
                sql.Identifier(destination_schema), sql.Identifier(table))).fetchall() for table in destination_tables}

        with db.transaction():
            db.execute("CREATE TEMP TABLE consolidation_copy_writes(operation text)")
            db.execute("""CREATE FUNCTION pg_temp.observe_consolidation_copy() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN INSERT INTO pg_temp.consolidation_copy_writes VALUES(TG_OP); RETURN NEW; END $$""")
            for table in watched_tables:
                db.execute(sql.SQL("CREATE TRIGGER observe_copy BEFORE INSERT OR UPDATE ON {}.{} FOR EACH ROW EXECUTE FUNCTION pg_temp.observe_consolidation_copy()").format(
                    sql.Identifier(destination_schema), sql.Identifier(table)))
            before_tuples = tuple_ids()
            call("restart")
            copy_and_verify(action)
            check("028 " + action + " leaves every unchanged destination tuple in place", tuple_ids() == before_tuples)
            check("028 " + action + " skips unchanged rows before INSERT triggers", db.execute("SELECT count(*) FROM pg_temp.consolidation_copy_writes").fetchone()[0] == 0)
            progress = call("status")["progress"]
            for item in NODES:
                amount = db.execute(sql.SQL("SELECT count(*) FROM {}.{}").format(sql.Identifier(source_schema), sql.Identifier(item.table))).fetchone()[0]
                if progress["copy:" + item.table]["rows"] != amount:
                    raise AssertionError("028 source traversal count changed for " + item.table)
            check("028 " + action + " counts every source key including unchanged nonpositive keys", True)

            rid, record_no = db.execute(sql.SQL("SELECT resource_id,record_no FROM {}.{} WHERE resource_id<0 ORDER BY resource_id,record_no LIMIT 1").format(
                sql.Identifier(source_schema), sql.Identifier(node.table))).fetchone()
            typed_where = "resource_id=%s AND record_no=%s"
            store_where = "resource_id=%s AND record_kind='lineup_home_starters' AND path=ARRAY[%s::integer]"
            destination = "statarena_retired_v1.lineup_home_starters" if reverse else "statarena_app.detail_records"
            destination_where = typed_where if reverse else store_where

            def recopy_member():
                db.execute("DELETE FROM statarena_app.consolidation_state WHERE key=%s", ("copy:" + node.table,))
                for _ in range(100):
                    if call("copy_batch", node.table, 2)["complete"]:
                        return
                raise AssertionError("028 member copy did not converge")

            def exact_member(schema, key):
                return db.execute("SELECT " + plan["evidence"] + ",array_send(t.missing),array_send(t.null_groups) FROM "
                                  + schema + ".lineup_home_starters t WHERE " + typed_where, key).fetchone()

            # Establish equal, nonempty metadata arrays with a nondefault lower
            # bound. JSON equality alone would not detect their later corruption.
            if reverse:
                db.execute("UPDATE statarena_app.detail_records SET attributes=jsonb_set(attributes,'{pitch_x}','0'),negative_zero=array_remove(negative_zero,'pitch_x'),missing='[0:0]={shirt_number}',null_groups='[0:0]={fixture_group}' WHERE " + store_where, (rid, record_no))
            else:
                db.execute("UPDATE statarena_app.lineup_home_starters SET pitch_x=0,missing='[0:0]={shirt_number}',null_groups='[0:0]={fixture_group}' WHERE " + typed_where, (rid, record_no))
            recopy_member()
            mutations = [
                ("changed attributes", "name='changed destination'" if reverse else "attributes=jsonb_set(attributes,'{name}','\"changed destination\"')"),
                ("signed zero", "pitch_x='-0'::float8" if reverse else "negative_zero=array_append(negative_zero,'pitch_x')"),
                ("missing-array bounds", "missing='[1:1]={shirt_number}'"),
                ("null-group-array bounds", "null_groups='[1:1]={fixture_group}'"),
            ]
            for label, assignment in mutations:
                db.execute("UPDATE " + destination + " SET " + assignment + " WHERE " + destination_where, (rid, record_no))
                before_tuple = db.execute("SELECT ctid::text FROM " + destination + " WHERE " + destination_where, (rid, record_no)).fetchone()[0]
                db.execute("TRUNCATE pg_temp.consolidation_copy_writes")
                recopy_member()
                after_tuple = db.execute("SELECT ctid::text FROM " + destination + " WHERE " + destination_where, (rid, record_no)).fetchone()[0]
                writes = db.execute("SELECT operation FROM pg_temp.consolidation_copy_writes ORDER BY operation").fetchall()
                target_schema = "statarena_retired_v1" if reverse else "statarena_next"
                check("028 " + action + " repairs " + label + " with exact typed/binary parity",
                      before_tuple != after_tuple and writes == [("INSERT",), ("UPDATE",)]
                      and exact_member(source_schema, (rid, record_no)) == exact_member(target_schema, (rid, record_no)))
            db.execute("DELETE FROM " + destination + " WHERE " + destination_where, (rid, record_no))
            db.execute("TRUNCATE pg_temp.consolidation_copy_writes")
            recopy_member()
            check("028 " + action + " inserts a missing destination row",
                  db.execute("SELECT operation FROM pg_temp.consolidation_copy_writes").fetchall() == [("INSERT",)]
                  and exact_member(source_schema, (rid, record_no)) == exact_member(target_schema, (rid, record_no)))

            new_key = (rid, 20000)
            if reverse:
                db.execute("""INSERT INTO statarena_app.detail_records(resource_id,record_kind,path,parent_kind,parent_path,position,metric_label,missing,null_groups,negative_zero,attributes)
                    SELECT resource_id,record_kind,ARRAY[20000],parent_kind,parent_path,20000,metric_label,missing,null_groups,negative_zero,attributes
                    FROM statarena_app.detail_records WHERE """ + store_where, (rid, record_no))
            else:
                columns = plan["column_sql"]
                selected = ",".join("20000" if name in ("record_no", "position") else '"' + name + '"' for name in plan["columns"])
                db.execute("INSERT INTO statarena_app.lineup_home_starters (" + columns + ") SELECT " + selected
                           + " FROM statarena_app.lineup_home_starters WHERE " + typed_where, (rid, record_no))
            db.execute("TRUNCATE pg_temp.consolidation_copy_writes")
            recopy_member()
            check("028 " + action + " copies a newly added source key",
                  db.execute("SELECT operation FROM pg_temp.consolidation_copy_writes").fetchall() == [("INSERT",)]
                  and exact_member(source_schema, new_key) == exact_member(target_schema, new_key))
            db.execute("TRUNCATE pg_temp.consolidation_copy_writes")
            recopy_member()
            check("028 " + action + " remains a no-op after repairing and extending rows",
                  db.execute("SELECT count(*) FROM pg_temp.consolidation_copy_writes").fetchone()[0] == 0)
            raise psycopg.Rollback()

    for prefix in ("003_", "004_", "005_", "006_", "007_", "008_", "009_", "010_", "011_", "020_", "021_", "022_", "023_", "024_"):
        if prefix == "023_":
            # Match the existing RDS runtime's old public-schema read grants.
            # Deliberately grant no direct SELECT on the future stores/next views.
            db.execute("CREATE ROLE vega_consolidation_reader NOLOGIN")
            db.execute("GRANT USAGE ON SCHEMA statarena_app TO vega_consolidation_reader")
            db.execute("GRANT SELECT ON ALL TABLES IN SCHEMA statarena_app TO vega_consolidation_reader")
        file = next((ROOT / "dashboard/backend/migrations").glob(prefix + "*.sql"))
        db.execute(file.read_text())
    db.execute("GRANT USAGE ON SCHEMA statarena_next TO vega_consolidation_reader")
    check("migration is reproducible from the checked-in model", migration() == (ROOT / "dashboard/backend/migrations/023_consolidated_provider_records.sql").read_text())
    member = dict(player_id="p_000001", name="Éléonore", shirt_number="09", position_id=0,
                  pitch_x=0, pitch_y=0.125, is_captain=False)
    lineups = dict(status=200, data=dict(match_id="m_000001", home_team=dict(id="t_000001", name="Home", image_url=None),
                  away_team=None, home=dict(formation="4-3-3", lineup_type=None, confirmed=False,
                  coach=dict(name=None), starters=[member, {"name": None}, {}], subs=[]),
                  away=dict(formation=None, confirmed=True, coach={}, starters=[], subs=[member])), error=None)
    publish_match_details(publishing_db, "m_000001", {"lineups": lineups})
    publish_match_details(publishing_db, "m_000002", {"events": {"status": 200, "data": {"match_id": "m_000002", "events": []}}})
    # Provider errors, absent data, explicit nulls and variants remain distinct.
    publish_match_details(publishing_db, "m_000003", {"lineups": {"status": 404, "error": {"message": None}}}, params={"variant": "A"})
    publish_match_details(publishing_db, "m_000003", {"lineups": {"status": 200, "data": None}}, params={"variant": "B"})
    with db.transaction():
        _publish_group(publishing_db, {("profile", "teams", "current"): ("profile_teams", {"status": 200, "data": {"id": "t_000001", "name": "Équipe", "image_url": None}}, "a" * 64)})
    # The model itself supplies a minimal valid missing-field resource for every support family.
    from relational_support import FAMILIES
    publish_supporting(publishing_db, [(name, {}, {}) for name in FAMILIES])
    seed_every_node(db)
    seed_every_node(db, negative_ids=True)
    for header, column in (("catalog_editions", "resource_id"), ("support_projection", "id"), ("match_families", "resource_id")):
        observed = db.execute(sql.SQL("SELECT {} FROM statarena_app.{} WHERE {}=ANY(%s) ORDER BY {}").format(
            sql.Identifier(column), sql.Identifier(header), sql.Identifier(column), sql.Identifier(column)), ([-(2**63), -1, 0],)).fetchall()
        check("legal bigint boundary headers exist in " + header, observed == [(-(2**63),), (-1,), (0,)])
    read = lambda: db.execute("SELECT match_id,params,statarena_app.detail_response(f) FROM statarena_app.match_families f ORDER BY match_id,params").fetchall()
    before = read()
    catalog_before = db.execute("SELECT statarena_app.catalog_response(c) FROM statarena_app.catalog_editions c").fetchall()
    check("lineups exactly reconstruct input", before[0][2] == lineups)
    count_before = call("status")["active_physical_tables"]
    call("begin", "backfill")
    # A zero-start implementation could incorrectly certify both copy and
    # parity while silently omitting the same negative source identifiers.
    db.execute("INSERT INTO statarena_app.consolidation_state VALUES('copy:old-zero-proof','{\"complete\":true}'),('verify:old-zero-proof','{\"complete\":true}'),('resources:old-zero-proof','{\"complete\":true}')")
    function_metadata = lambda: db.execute("SELECT oid,proname,proowner,proacl::text,prosecdef,provolatile,proconfig,proargtypes::text FROM pg_proc WHERE pronamespace='statarena_app'::regnamespace AND proname IN ('consolidation_plan','consolidation_copy_batch','consolidation_verify_batch','consolidation_verify_resources') ORDER BY oid").fetchall()
    before_functions = function_metadata()
    cursor_migration = (ROOT / "dashboard/backend/migrations/027_nullable_consolidation_cursors.sql").read_text()
    db.execute(cursor_migration)
    check("027 invalidates every zero-start copy and parity checkpoint", call("status")["progress"] == {})
    check("027 preserves function OIDs, owners, ACLs and signatures", function_metadata() == before_functions)
    unchanged_migration = (ROOT / "dashboard/backend/migrations/028_skip_unchanged_consolidation_rows.sql").read_text()
    db.execute(unchanged_migration)
    check("028 preserves function OIDs, owners, ACLs and signatures", function_metadata() == before_functions)
    try:
        call("activate")
    except psycopg.errors.RaiseException:
        check("activation rejects incomplete parity", True)
    else:
        raise AssertionError("Incomplete migration activated")
    try:
        publish_match_details(publishing_db, "m_000009", {"lineups": {"status": 200, "data": {}}})
    except RuntimeError:
        check("publisher respects the maintenance fence", True)
    else:
        raise AssertionError("Publisher ignored migration maintenance")
    copy_and_verify("backfill")
    unchanged_copy_regressions("backfill")
    for store in ("catalog_records", "support_records", "detail_records"):
        keys = db.execute(sql.SQL("SELECT DISTINCT resource_id FROM statarena_app.{} WHERE resource_id=ANY(%s) ORDER BY resource_id").format(sql.Identifier(store)), ([-(2**63), -1, 0],)).fetchall()
        check("full-range copy includes bigint minimum, negative and zero in " + store, keys == [(-(2**63),), (-1,), (0,)])
    row_proofs = call("status")["progress"]
    for node in NODES:
        source_total, source_count = db.execute(sql.SQL("SELECT count(*),count(*) FILTER(WHERE {}<=0) FROM statarena_app.{}").format(sql.Identifier(node.resource), sql.Identifier(node.table))).fetchone()
        copied_count = db.execute(sql.SQL("SELECT count(*) FROM statarena_app.{} WHERE record_kind=%s AND resource_id<=0").format(sql.Identifier(node.store)), (node.table,)).fetchone()[0]
        if source_count != copied_count or source_count == 0:
            raise AssertionError("nonpositive resource rows omitted from " + node.table)
        if row_proofs["verify:" + node.table]["rows"] != source_total:
            raise AssertionError("row parity did not inspect the full key range in " + node.table)
    check("all 112 mapped tables copy their nonpositive resource rows", True)
    check("row parity counts every source row across all 112 mapped tables", True)
    try:
        with db.transaction():
            node = NODES[0]
            db.execute(sql.SQL("DELETE FROM statarena_app.{} WHERE record_kind=%s AND resource_id=%s").format(sql.Identifier(node.store)), (node.table, -(2**63)))
            db.execute("DELETE FROM statarena_app.consolidation_state WHERE key=%s", ("verify:" + node.table,))
            call("verify_batch", node.table, 1)
    except psycopg.errors.RaiseException as error:
        check("row parity detects a missing bigint-minimum record", "Exact row parity failed" in str(error))
    else:
        raise AssertionError("negative-ID corruption bypassed exact parity")
    for family, header in (("catalog", "catalog_editions"), ("support", "support_projection"), ("detail", "match_families")):
        header_count = db.execute(sql.SQL("SELECT count(*) FROM statarena_app.{}").format(sql.Identifier(header))).fetchone()[0]
        check("resource parity includes every header in " + family, call("status")["progress"]["resources:" + family]["rows"] == header_count)
    proof_before_reapply = call("status")["progress"]
    db.execute(cursor_migration)
    check("027 reapplication preserves new full-range proofs", call("status")["progress"] == proof_before_reapply)
    db.execute(unchanged_migration)
    check("028 reapplication preserves full-range copy and parity proofs", call("status")["progress"] == proof_before_reapply)
    check("all 112 mapped node kinds were copied", db.execute("SELECT count(*) FROM (SELECT DISTINCT record_kind FROM statarena_app.catalog_records UNION SELECT DISTINCT record_kind FROM statarena_app.support_records UNION SELECT DISTINCT record_kind FROM statarena_app.detail_records) n").fetchone()[0] == 112)
    check("negative zero is explicitly preserved", db.execute("SELECT count(*) FROM statarena_app.detail_records WHERE cardinality(negative_zero)>0").fetchone()[0] > 0)
    try:
        with db.transaction():
            db.execute("UPDATE statarena_app.lineup_home_starters SET name=name")
            call("activate")
    except psycopg.errors.RaiseException:
        check("a late legacy write invalidates all prior parity receipts", True)
    else:
        raise AssertionError("Stale migration proof authorized cutover")
    for mutation in (
        "UPDATE statarena_app.detail_records SET attributes=attributes||'{\"unmapped\":1}'::jsonb WHERE record_kind='lineup_home_starters'",
        "UPDATE statarena_app.detail_records SET attributes=jsonb_set(attributes,'{pitch_x}','\"not numeric\"') WHERE record_kind='lineup_home_starters'",
        "UPDATE statarena_app.detail_records SET parent_path='{999}' WHERE record_kind='lineup_home_starters'",
    ):
        try:
            with db.transaction():
                db.execute(mutation)
        except psycopg.IntegrityError:
            pass
        else:
            raise AssertionError("Invalid consolidated row accepted")
    check("typed scalar keys, numeric types and parent identity are enforced", True)
    check("completed copy is resumable", call("copy_batch", "lineup_home_starters", 2)["complete"])
    generation = db.execute("SELECT generation FROM statarena_app.publications").fetchone()[0]
    call("activate")
    check("112 physical source tables became three stores and one state table", call("status")["active_physical_tables"] == count_before - 112)
    check("retained rollback tables are separate from the active schema", call("status")["retired_physical_tables"] == 112)
    check("activation preserves all match resources", read() == before)
    check("activation preserves catalogue resources", db.execute("SELECT statarena_app.catalog_response(c) FROM statarena_app.catalog_editions c").fetchall() == catalog_before)
    with db.transaction():
        db.execute("SET LOCAL ROLE vega_consolidation_reader")
        check("runtime reads match functions through owner-backed adapters", read() == before)
        check("runtime reads catalogue functions through owner-backed adapters", db.execute("SELECT statarena_app.catalog_response(c) FROM statarena_app.catalog_editions c").fetchall() == catalog_before)
        check("runtime reads supporting typed views", db.execute("SELECT count(*) FROM statarena_app.support_honours").fetchone()[0] > 0)
        check("runtime has no direct consolidated-store access", not db.execute("SELECT has_table_privilege(current_user,'statarena_app.detail_records','SELECT')").fetchone()[0])
        check("runtime has no internal-view SELECT or migration-execute privilege", not db.execute("SELECT has_table_privilege(current_user,'statarena_next.lineup_sheets','SELECT') OR has_function_privilege(current_user,'statarena_app.consolidation_activate()','EXECUTE')").fetchone()[0])
    check("cutover advances publication generation once", db.execute("SELECT generation FROM statarena_app.publications").fetchone()[0] == generation + 1)
    call("activate")
    check("repeated activation is idempotent", db.execute("SELECT generation FROM statarena_app.publications").fetchone()[0] == generation + 1)
    # Actual new writer data must survive rollback, including source-header replacement
    # cascading into the old archived copy and into the consolidated children.
    changed = {"status": 200, "data": {"home": {"starters": [{"name": "New", "shirt_number": "00"}], "subs": None}, "away": None}}
    publish_match_details(publishing_db, "m_000001", {"lineups": changed})
    publish_supporting(publishing_db, [(name, {}, {"available": False} if name == "player-honours" else {}) for name in FAMILIES])
    from consolidated_storage import storage_mode
    with db.transaction():
        check("new writer sees active storage", storage_mode(db))
        _publish_group(publishing_db, {("profile", "teams", "current"): ("profile_teams", {"status": 200, "data": {"id": "t_000001", "name": "After cutover"}}, "b" * 64)}, consolidated=True)
    after_write = read()
    after_catalog = db.execute("SELECT statarena_app.catalog_response(c) FROM statarena_app.catalog_editions c").fetchall()
    with db.transaction():
        db.execute("SET LOCAL ROLE vega_consolidation_reader")
        check("runtime observes new published records after cutover", read() == after_write)
    check("publication actually writes the consolidated member store", db.execute("SELECT count(*) FROM statarena_app.detail_records WHERE record_kind='lineup_home_starters' AND attributes->>'name'='New'").fetchone()[0] == 1)
    copy_and_verify("rollback")
    unchanged_copy_regressions("rollback")
    call("rollback")
    for node in NODES:
        restored_count = db.execute(sql.SQL("SELECT count(*) FROM statarena_app.{} WHERE {}<=0").format(sql.Identifier(node.table), sql.Identifier(node.resource))).fetchone()[0]
        if restored_count == 0:
            raise AssertionError("reverse copy omitted nonpositive resource rows in " + node.table)
    check("reverse copy restores nonpositive resources in all 112 mapped tables", True)
    check("reverse copy preserves post-cutover match writes", read() == after_write)
    check("reverse copy preserves post-cutover catalogue writes", db.execute("SELECT statarena_app.catalog_response(c) FROM statarena_app.catalog_editions c").fetchall() == after_catalog)
    with db.transaction():
        db.execute("SET LOCAL ROLE vega_consolidation_reader")
        check("runtime grants survive reverse-copy rollback", read() == after_write)
    check("legacy physical tables restored", call("status")["active_physical_tables"] == count_before)
    check("rollback leaves no second retired physical copy", call("status")["retired_physical_tables"] == 0)
    publish_match_details(publishing_db, "m_000004", {"lineups": {"status": 200, "data": {"away": {"starters": []}}}})
    check("legacy publisher continues after rollback", len(read()) == len(after_write) + 1)
    return checks


def main():
    url = os.environ["TEST_DATABASE_URL"]
    address = urlsplit(url)
    if address.path not in ("/vega_refactor_test", "/vega_ci_test") or not address.hostname or address.hostname.endswith(".rds.amazonaws.com"):
        raise RuntimeError("Disposable loopback/CI PostgreSQL database required")
    with psycopg.connect(url, autocommit=True) as db:
        if db.execute("SELECT to_regnamespace('statarena_app')").fetchone()[0]:
            raise RuntimeError("Use a fresh disposable database")
        checks = run(db)
        print(json.dumps(dict(status="passed", server=db.execute("SELECT version()").fetchone()[0], checks=checks), indent=2))


if __name__ == "__main__":
    main()
