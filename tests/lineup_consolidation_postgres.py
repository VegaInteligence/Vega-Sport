"""Real SQL parity and reversible facade activation, using rollback-only fixtures."""

import copy
import json
import os
import sys
from pathlib import Path
from urllib.parse import urlsplit

import psycopg
from psycopg import sql

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "dashboard/scripts"))
from lineup_consolidation import verify, switch_reader, execute
from relational_materialize import install
from relational_match import prepare
from relational_match_ddl import dbname, leaves


def seed(db, response, i):
    mid = "m_"+str(i//2).zfill(6)
    db.execute("INSERT INTO statarena_app.match_details(match_id) VALUES(%s) ON CONFLICT DO NOTHING", (mid,))
    header, batches = prepare("lineups", response)
    resource = db.execute("""INSERT INTO statarena_app.match_families(match_id,family,subject_id,params,
        status,has_data,has_error,error_object,error_code,error_message,error_has_code,error_has_message,source_digest)
        VALUES(%s,'lineups','',%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING resource_id""",
        (mid, json.dumps({"variant": i%2}), *header, str(i).zfill(64))).fetchone()[0]
    for spec, rows in batches:
        columns = ["resource_id", "record_no", "missing", "null_groups"]
        if rows[0]["parent_no"] is not None:
            columns += ["parent_no", "position"]
        columns += [dbname(p) for p, _ in leaves(spec.fields)]
        statement = sql.SQL("INSERT INTO statarena_app.{} ({}) VALUES ({})").format(
            sql.Identifier(spec.table), sql.SQL(',').join(map(sql.Identifier, columns)),
            sql.SQL(',').join(sql.Placeholder() for _ in columns))
        for row in rows:
            db.execute(statement, [resource, *(row.get(k) for k in columns[1:])])
    return resource


def main():
    address = urlsplit(os.environ["TEST_DATABASE_URL"])
    if address.hostname not in ("localhost", "127.0.0.1", "::1") or address.path != "/vega_refactor_test":
        raise RuntimeError("A disposable loopback vega_refactor_test is required")
    checks = []

    def check(name, value):
        if not value:
            raise AssertionError(name)
        checks.append(name)

    member = dict(player_id="p_000001", name="Éléonore", shirt_number="09", position_id=0,
                  pitch_x=0, pitch_y=0.125, is_captain=False)
    data = dict(match_id="m_000001", home_team=dict(id="t_000001", name="Home", image_url=None),
                away_team=None, home=dict(formation="4-3-3", lineup_type=None, confirmed=False,
                coach=dict(name=None), starters=[member, {"name": None}, {}], subs=[]),
                away=dict(formation=None, confirmed=True, coach={}, starters=[], subs=[member]))
    responses = [dict(status=200, data=data, error=None), dict(status=200, data={}),
                 dict(status=200, data=None), dict(status=404, error={"code": "not_found"}),
                 dict(status=None, error={"message": None}), dict(status=200, data={"home": None}),
                 dict(status=200, data={"away": {"starters": None, "subs": None, "coach": None}})]
    for side in ("home", "away"):
        for field in ("formation", "lineup_type", "confirmed", "coach", "starters", "subs"):
            for state in ("absent", "null"):
                body = copy.deepcopy(data)
                if state == "absent":
                    body[side].pop(field, None)
                else:
                    body[side][field] = None
                responses.append(dict(status=200, data=body))

    with psycopg.connect(os.environ["TEST_DATABASE_URL"]) as db:
        check("fresh schema", db.execute("SELECT to_regnamespace('statarena_app')").fetchone()[0] is None)
        try:
            install(db)
            ids = [seed(db, response, i) for i, response in enumerate(responses)]
            physical_before = db.execute("""SELECT resource_id,side,role,record_no,position,missing,null_groups,
                player_id,name,shirt_number,position_id,pitch_x,pitch_y,is_captain
                FROM statarena_app.lineup_members ORDER BY resource_id,side,role,position""").fetchall()
            source_before = db.execute("SELECT row_to_json(f) FROM statarena_app.match_families f ORDER BY resource_id").fetchall()
            read = lambda: [r[0] for r in db.execute("SELECT statarena_app.detail_response(f) FROM statarena_app.match_families f ORDER BY resource_id")]
            check("legacy exactly reconstructs 31 native response variants", read() == responses)
            check("complete bounded comparison", verify(db, batch=3) == dict(complete=True, resources=len(ids), members=len(physical_before)))
            check("partial comparison marked incomplete", verify(db, batch=2, max_resources=3) == dict(complete=False, resources=3, members=sum(row[0] in ids[:3] for row in physical_before)))
            try:
                execute(db, action="activate", max_resources=3)
            except ValueError:
                check("partial comparison cannot activate", True)
            else:
                raise AssertionError("Partial scan authorized activation")
            generation = db.execute("SELECT generation FROM statarena_app.publications").fetchone()[0]
            check("activation changes only public function", switch_reader(db, "unified"))
            check("public detail responses preserve missing null values order and errors", read() == responses)
            check("one generation for switch", db.execute("SELECT generation FROM statarena_app.publications").fetchone()[0] == generation+1)
            check("repeated activation idempotent", not switch_reader(db, "unified"))
            with db.transaction():
                switch_reader(db, "legacy")
                raise psycopg.Rollback()
            check("rollback of switch restores function and generation", not switch_reader(db, "unified") and db.execute("SELECT generation FROM statarena_app.publications").fetchone()[0] == generation+1)
            check("explicit compatibility rollback succeeds", switch_reader(db, "legacy") and read() == responses)
            check("source provenance untouched", db.execute("SELECT row_to_json(f) FROM statarena_app.match_families f ORDER BY resource_id").fetchall() == source_before)
            check("four member stores untouched", db.execute("""SELECT resource_id,side,role,record_no,position,missing,null_groups,
                player_id,name,shirt_number,position_id,pitch_x,pitch_y,is_captain
                FROM statarena_app.lineup_members ORDER BY resource_id,side,role,position""").fetchall() == physical_before)
            with db.transaction():
                db.execute("CREATE OR REPLACE FUNCTION statarena_app.detail_data_lineups_unified(rid bigint) RETURNS jsonb LANGUAGE sql STABLE AS $$SELECT '{}'::jsonb$$")
                try:
                    verify(db, batch=3)
                except ValueError:
                    check("comparison rejects changed native representation", True)
                else:
                    raise AssertionError("Parity accepted an invalid reader")
                raise psycopg.Rollback()
        finally:
            db.rollback()
        check("all fixtures and facade DDL rolled back", db.execute("SELECT to_regnamespace('statarena_app')").fetchone()[0] is None)
        print(json.dumps(dict(status="passed", server_version=db.info.server_version, checks=checks,
                              response_variants=len(responses), writes="isolated fixtures rolled back")))


if __name__ == "__main__":
    main()
