#!/usr/bin/env python3
"""Real-PG test-first E2E for the bounded native metric scalar-state amendment."""
from __future__ import annotations

import argparse
import copy
from datetime import datetime, timezone
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import shutil
import sys
import traceback

ROOT=Path(__file__).resolve().parents[1]
EVIDENCE=ROOT/"docs/verification/orion-pro-pilot-20261104"
MODEL=ROOT/"docs/architecture/orion-plan-20261104/target-schema.proposed.json"
BASE_SHA="028c221d4cd45ad809a2340e62f34ab9df191c593b23c0c45d5f44587eb35a8c"
BASE_MODEL=EVIDENCE/"runs/20261104T175834735172Z-initial-red-missing-runner/inputs/target-schema.proposed.json"
METRIC_TABLES={"player":"football.player_match_metric_values","team":"football.team_match_metric_values"}
VALID_STATES={"zero":("number",Decimal(0),None,None),"empty_string":("string",None,"",None),
              "false":("boolean",None,None,False),"null":("null",None,None,None),"absent":("absent",None,None,None)}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def table_map(model):
    return {t["qualified_name"]:t for s in model["schemas"] for t in s["tables"]}


def validate_model_gate(receipt_path):
    assert digest(BASE_MODEL)==BASE_SHA,"Retained baseline bytes differ from original approval"
    actual=digest(MODEL)
    baseline=json.loads(BASE_MODEL.read_text())
    candidate=json.loads(MODEL.read_text())
    if actual==BASE_SHA:
        return candidate,{"kind":"original_approved_baseline","sha256":actual}
    assert receipt_path and receipt_path.exists(),"Candidate requires an inspectable bounded amendment receipt"
    receipt=json.loads(receipt_path.read_text())
    assert receipt["baselineModelSha256"]==BASE_SHA
    approval=json.loads((receipt_path.parent/receipt["baselineApproval"]).read_text())
    assert approval["schemaSha256"]==BASE_SHA,"Original approval must retain its original schema digest"
    assert receipt["baselineModelGitCommit"]==approval["approvedPlanCommit"]
    assert len(receipt["amendments"])==1,"This focused test authorizes only the one recorded native-state amendment"
    amendment=receipt["amendments"][0]
    assert amendment["id"]=="native-metric-states-v1" and amendment["status"]=="in_scope_targeted_correction"
    assert amendment["resultModelSha256"]==actual
    assert amendment["tablesAdded"]==[] and amendment["columnsAdded"]==[] and amendment["keyChanges"]==[]
    reconstructed=copy.deepcopy(baseline)
    tables=table_map(reconstructed)
    seen=set()
    for change in amendment["changes"]:
        name,kind=change["table"],change["kind"]
        assert name in METRIC_TABLES.values(),name
        table=tables[name]
        if kind=="check":
            allowed={name.replace(".","_")+suffix for suffix in ["_one_value_ck","_value_kind_ck"]}
            assert change["name"] in allowed
            item=next(c for c in table["checks"] if c["name"]==change["name"])
            assert item["sql"]==change["before"]
            item["sql"]=change["after"]
            key=(name,kind,change["name"])
        elif kind=="column_description":
            assert change["column"]=="value_kind"
            assert table["columns"]["value_kind"]["description"]==change["before"]
            table["columns"]["value_kind"]["description"]=change["after"]
            key=(name,kind,"value_kind")
        elif kind=="table_description":
            assert table["description"]==change["before"]
            table["description"]=change["after"]
            key=(name,kind,"description")
        else:
            raise AssertionError(f"Unexpected model amendment kind: {kind}")
        assert key not in seen,"Duplicate amendment path"
        seen.add(key)
    assert len(seen)==8,"Expected exactly four CHECKs and four descriptions"
    assert reconstructed==candidate,"Candidate contains an unrecorded or out-of-scope model difference"
    return candidate,{"kind":"recorded_in_scope_amendment","baseline_sha256":BASE_SHA,"candidate_sha256":actual,"receipt_sha256":digest(receipt_path),"changed_paths":len(seen)}


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--run-label",default="metric-states")
    parser.add_argument("--pg-bin",type=Path,default=Path("/tmp/statarena-cache-test-tools/node_modules/@embedded-postgres/darwin-arm64/native/bin"))
    parser.add_argument("--python-path",type=Path,default=Path("/tmp/statarena-publication-test-python"))
    parser.add_argument("--amendment-receipt",type=Path)
    args=parser.parse_args()
    sys.path[:0]=[str(args.python_path),str(EVIDENCE)]
    import psycopg
    from harness import LocalPostgres
    from fixtures import PilotWorkflow
    stamp=datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    evidence=EVIDENCE/"metric-state-runs"/f"{stamp}-{args.run_label}"
    inputs=evidence/"inputs";inputs.mkdir(parents=True)
    sources=[Path(__file__),MODEL,BASE_MODEL,EVIDENCE/"METRIC_STATES_PROTOCOL.md",EVIDENCE/"fixtures.py",EVIDENCE/"harness.py",EVIDENCE/"approval.json"]
    sources += [ROOT/"dashboard/scripts"/name for name in ["orion_pro_schema.py","orion_pro_migrate.py","orion_pro_integrity.py"]]
    if args.amendment_receipt:sources.append(args.amendment_receipt)
    # The retained original and candidate have the same basename; keep both.
    for source in sources:
        if source.exists():shutil.copy2(source,inputs/("original-approved-model.json" if source==BASE_MODEL else source.name))
    report={"kind":"local_owned_metric_states_e2e","started_at":datetime.now(timezone.utc).isoformat(),"run_label":args.run_label,
       "model_sha256":digest(MODEL),"test_sha256":digest(Path(__file__)),"protocol_sha256":digest(EVIDENCE/"METRIC_STATES_PROTOCOL.md"),
       "source_sha256":{str(p):digest(p) for p in sources if p.exists()},"cases":[],"external_actions":[],
       "expected":"METRIC_STATES_PROTOCOL.md failure matrix","scope":"existing player/team metric-value native scalar representability; synthetic typed inputs",
       "unverified_outside_scope":["wide player_match_stats.xg source states","complete source-field mapping","production collector/public reader adaptation","remote RDS capacity/performance","purge safety"]}
    report["rerun"]=f"PYTHONPATH={args.python_path} python3 tests/orion_pro_metric_states_postgres.py --run-label {args.run_label}"+(f" --amendment-receipt '{args.amendment_receipt}'" if args.amendment_receipt else "")
    pg=LocalPostgres(args.pg_bin,evidence);conn=None;driver=None;rows={};last_generation=None

    def run_case(name,action,prerequisite=None):
        if prerequisite:
            report["cases"].append({"case":name,"status":"unverified","reason":prerequisite});print(f"UNVERIFIED {name}: {prerequisite}",flush=True);return None
        try:
            result=action();report["cases"].append({"case":name,"status":"pass","actual":result});print(f"PASS {name}",flush=True);return result
        except Exception as exc:
            report["cases"].append({"case":name,"status":"fail","error":str(exc),"sqlstate":getattr(exc,"sqlstate",None),"constraint":getattr(getattr(exc,"diag",None),"constraint_name",None),"traceback":traceback.format_exc()});print(f"FAIL {name}: {exc}",flush=True);return None

    try:
        model,gate=validate_model_gate(args.amendment_receipt);report["model_gate"]=gate
        pg.start();conn=psycopg.connect(pg.dsn,autocommit=True)
        report["server_version"]=conn.execute("SELECT version()").fetchone()[0]
        assert conn.info.server_version==180006
        pg.migration(ROOT)
        sql_dir=evidence/"applied-sql";sql_dir.mkdir()
        applied={}
        for version,checksum in conn.execute("SELECT version,content_sha256 FROM ingest.schema_migrations ORDER BY version"):
            paths=list((ROOT/"dashboard/backend/migrations").glob(f"{version}_orion_pro_*.sql"));assert len(paths)==1 and digest(paths[0])==checksum
            shutil.copy2(paths[0],sql_dir/paths[0].name);applied[paths[0].name]=checksum
        report["applied_sql_sha256"]=applied
        driver=PilotWorkflow(conn,pg.dsn,evidence,psycopg)
        report["base_fixture"]=driver.typed_shared_editions()
        code_sha=digest(Path(__file__))
        with driver._generation("metric_state_definitions"):
            for subject in METRIC_TABLES:
                for key in [*VALID_STATES,"unknown"]:
                    driver._insert("football.metric_definitions",code=f"pilot_{subject}_{key}",label=f"Pilot {subject} {key}",definition="Synthetic registered expected scalar field; missing observation remains unknown",unit="fixture",scope=subject,aggregation="none",allows_negative=False,definition_version="metric_states_v1",transform_version="metric_states_v1",transform_code_sha256=code_sha)
        report["cases"].append({"case":"bootstrap_and_registered_metric_definitions","status":"pass","actual":{"model_gate":gate,"registered_metrics":12,"base_fixture":"unchanged shared-edition fixture"}})

        def metric_input(subject,key,scalar):
            kind,number,text,boolean=scalar;p=driver.participants["A"][0]
            data=dict(match_id=driver.matches["A"]["id"],team_id=p["team_id"],period_code="full_match",period_definition_version="bootstrap_v1",family_code="standard",
                metric_code=f"pilot_{subject}_{key}",metric_definition_version="metric_states_v1",value_kind=kind,numeric_value=number,text_value=text,boolean_value=boolean,
                source_id=driver.ids["source"],source_record_id=driver.ids["record"],transform_version="metric_states_v1",transform_code_sha256=code_sha)
            if subject=="player":data.update(player_id=p["player_id"],match_player_revision_id=p["revision_id"])
            else:data["match_team_revision_id"]=driver.sides["A"]["home"]["revision_id"]
            return data

        for subject,table in METRIC_TABLES.items():
            for key,scalar in VALID_STATES.items():
                def insert_state(subject=subject,table=table,key=key,scalar=scalar):
                    nonlocal last_generation
                    with driver._generation(f"{subject}_metric_{key}") as g:
                        row=driver._insert(table,**metric_input(subject,key,scalar))
                    observed=conn.execute(f"SELECT value_kind,numeric_value,text_value,boolean_value FROM {table} WHERE revision_id=%s",(row["revision_id"],)).fetchone()
                    assert observed==scalar,(subject,key,observed,scalar)
                    rows[(subject,key)]=row;last_generation=g
                    return {"generation":g,"revision_id":row["revision_id"],"native_scalars":observed,"explicit_absent_input":"expected field was established by fixture contract" if key=="absent" else None}
                run_case(f"{subject}_{key}",insert_state)
            bads={"null_plus_number":{"value_kind":"null","numeric_value":Decimal(42),"text_value":None,"boolean_value":None},
                  "absent_plus_numerator":{"value_kind":"absent","numeric_value":None,"text_value":None,"boolean_value":None,"numerator":Decimal(0)},
                  "null_plus_denominator":{"value_kind":"null","numeric_value":None,"text_value":None,"boolean_value":None,"denominator":Decimal(1)},
                  "absent_plus_empty_display":{"value_kind":"absent","numeric_value":None,"text_value":None,"boolean_value":None,"source_display":""},
                  "wrong_scalar_type":{"value_kind":"number","numeric_value":None,"text_value":None,"boolean_value":False}}
            for label,changes in bads.items():
                def invalid_state(subject=subject,table=table,label=label,changes=changes):
                    values=metric_input(subject,"zero",VALID_STATES["zero"])
                    values.update(changes,variant_key=f"pilot:invalid:{subject}:{label}",is_canonical=False)
                    return driver._reject(f"{subject} metric {label}",lambda:driver._insert(table,**values),states={"23514"})
                run_case(f"{subject}_reject_{label}",invalid_state)
            def unknown(subject=subject,table=table):
                count=conn.execute(f"SELECT count(*) FROM {table} WHERE metric_code=%s",(f"pilot_{subject}_unknown",)).fetchone()[0]
                assert count==0
                return {"rows":count,"state":"unknown; no explicit absent/null observation invented"}
            run_case(f"{subject}_missing_row_unknown",unknown)

        nulls_available=all((s,"null") in rows for s in METRIC_TABLES)
        frozen={}
        def retained_correction():
            oldg=last_generation
            cohort=driver._cohort("A",oldg)
            build=driver._build("A",oldg,cohort)
            with driver._generation("metric_null_to_number") as newg:
                for subject,table in METRIC_TABLES.items():
                    old=rows[(subject,"null")]
                    frozen[subject]=driver._replace(table,old,value_kind="number",numeric_value=Decimal("0.67"),text_value=None,boolean_value=None)
            for subject,table in METRIC_TABLES.items():
                current=conn.execute(f"SELECT value_kind,numeric_value,text_value,boolean_value FROM {table}_current WHERE metric_code=%s",(f"pilot_{subject}_null",)).fetchone()
                assert current==("number",Decimal("0.67"),None,None),current
                previous=conn.execute(f"SELECT value_kind,numeric_value,text_value,boolean_value,recorded_to_gen FROM {table} WHERE revision_id=%s",(rows[(subject,"null")]["revision_id"],)).fetchone()
                assert previous==("null",None,None,None,newg),previous
            frozen.update(build_id=build,old_generation=oldg,new_generation=newg)
            return {"frozen_build_id":build,"old_generation":oldg,"new_generation":newg,"current_kind":"number","current_value":"0.67","old_physical_kind":"null"}
        correction=run_case("retained_null_to_number_both_tables",retained_correction,None if nulls_available else "explicit null rows rejected before amendment")

        def frozen_same_generation():
            g=conn.execute("""SELECT s.generation FROM analytics.aggregation_builds b JOIN ingest.dataset_snapshots s ON s.id=b.dataset_snapshot_id WHERE b.id=%s""",(frozen["build_id"],)).fetchone()[0]
            assert g==frozen["old_generation"]
            result={}
            for subject,table in METRIC_TABLES.items():
                selected=conn.execute(f"""SELECT value_kind,numeric_value,text_value,boolean_value FROM {table} WHERE metric_code=%s
                   AND recorded_from_gen<=%s AND (recorded_to_gen IS NULL OR %s<recorded_to_gen) AND is_canonical AND NOT is_deleted""",(f"pilot_{subject}_null",g,g)).fetchone()
                assert selected==("null",None,None,None),selected
                result[subject]={"generation":g,"selected_native_scalars":selected}
            return {"build_id":frozen["build_id"],"same_generation_reads":result}
        run_case("frozen_player_and_team_read_same_generation",frozen_same_generation,None if correction else "retained correction prerequisite failed")
    except Exception as exc:
        report["setup_error"]=str(exc);report["setup_traceback"]=traceback.format_exc();print(f"SETUP FAIL: {exc}",flush=True)
    finally:
        if conn is not None:conn.close()
        try:report["cleanup"]=pg.cleanup()
        except Exception as exc:report["cleanup"]={"error":str(exc),"owned_root":str(pg.root)}
        report["finished_at"]=datetime.now(timezone.utc).isoformat()
        report["counts"]={s:sum(c["status"]==s for c in report["cases"]) for s in ["pass","fail","unverified"]}
        report["status"]="pass" if "setup_error" not in report and report["counts"]["fail"]==0 and report["counts"]["unverified"]==0 and report["counts"]["pass"]==25 and report["cleanup"].get("server_stopped") else "fail"
        (evidence/"result.json").write_text(json.dumps(report,indent=2,default=str)+"\n")
        print(json.dumps({"status":report["status"],"counts":report["counts"],"evidence":str(evidence)}),flush=True)
    return 0 if report["status"]=="pass" else 1


if __name__=="__main__":
    raise SystemExit(main())
