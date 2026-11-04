#!/usr/bin/env python3
"""Preimplementation E2E contract for the approved 94-table selective-inline pilot."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import importlib
import json
from pathlib import Path
import shutil
import sys
import traceback

REPO = Path(__file__).resolve().parents[1]
EVIDENCE = REPO / "docs/verification/orion-pro-pilot-20261104"
MODEL = REPO / "docs/architecture/orion-plan-20261104/target-schema.proposed.json"
MODEL_SHA = "028c221d4cd45ad809a2340e62f34ab9df191c593b23c0c45d5f44587eb35a8c"
CASE_NAMES = [
    "runner_available", "active_catalogue", "bootstrap_bindings", "migration_idempotence_restart_rollback",
    "typed_shared_editions", "retained_xg_and_cohort", "no_op_reimport", "http_dedup",
    "source_receipt_retention_guards",
    "typed_states_and_profiles", "contract_and_seed_versions", "wrong_parent_provider_h2h",
    "parent_selection_consistency", "shot_profiles", "atomic_heatmaps_networks", "atomic_collections",
    "append_only_parser_correction", "generation_guards", "concurrent_generation_order",
    "publication_guards", "ready_engagement_guards", "readonly_role", "queue_lease",
]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def canonical_type(value):
    return {"timestamptz": "timestamp with time zone"}.get(value, value).replace(", ", ",")


def active_catalogue(conn, model, evidence):
    active = {t["qualified_name"]: t for s in model["schemas"] for t in s["tables"] if t["phase"] != "models"}
    deferred = {t["qualified_name"] for s in model["schemas"] for t in s["tables"] if t["phase"] == "models"}
    assert len(active) == 94 and len(deferred) == 9
    closure = [(n, f["references"]["table"]) for n, t in active.items() for f in t["foreign_keys"] if f["references"]["table"] not in active]
    assert not closure, closure
    actual_tables = {r[0] for r in conn.execute("""SELECT n.nspname||'.'||c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname IN ('ingest','football','analytics') AND c.relkind IN ('r','p')""")}
    errors = []
    if actual_tables != set(active):
        errors.append({"tables_missing": sorted(set(active)-actual_tables), "tables_extra": sorted(actual_tables-set(active))})
    totals = {"tables": len(actual_tables), "columns": 0, "primary_keys": 0, "foreign_keys": 0}
    for name, table in active.items():
        if name not in actual_tables:
            continue
        columns = {r[0]: (r[1], r[2]) for r in conn.execute("""SELECT a.attname,format_type(a.atttypid,a.atttypmod),NOT a.attnotnull
            FROM pg_attribute a WHERE a.attrelid=to_regclass(%s) AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum""", (name,))}
        expected = {k: (canonical_type(v["type"]), v["nullable"]) for k,v in table["columns"].items()}
        totals["columns"] += len(columns)
        if columns != expected:
            errors.append({"table": name, "columns_actual": columns, "columns_expected": expected})
        constraints = list(conn.execute("""SELECT con.contype,
              ARRAY(SELECT a.attname FROM unnest(con.conkey) WITH ORDINALITY u(k,o) JOIN pg_attribute a ON a.attrelid=con.conrelid AND a.attnum=u.k ORDER BY u.o),
              CASE WHEN con.confrelid<>0 THEN (SELECT ns.nspname||'.'||cl.relname FROM pg_class cl JOIN pg_namespace ns ON ns.oid=cl.relnamespace WHERE cl.oid=con.confrelid) END,
              ARRAY(SELECT a.attname FROM unnest(con.confkey) WITH ORDINALITY u(k,o) JOIN pg_attribute a ON a.attrelid=con.confrelid AND a.attnum=u.k ORDER BY u.o)
            FROM pg_constraint con WHERE con.conrelid=to_regclass(%s) AND con.contype IN ('p','f')""", (name,)))
        pks = [tuple(r[1]) for r in constraints if r[0] == "p"]
        fks = sorted((tuple(r[1]), r[2], tuple(r[3])) for r in constraints if r[0] == "f")
        exp_fk = sorted((tuple(f["columns"]),f["references"]["table"],tuple(f["references"]["columns"])) for f in table["foreign_keys"])
        totals["primary_keys"] += len(pks)
        totals["foreign_keys"] += len(fks)
        if pks != [tuple(table["primary_key"]["columns"])]:
            errors.append({"table": name, "pk_actual": pks, "pk_expected": table["primary_key"]["columns"]})
        if fks != exp_fk:
            errors.append({"table": name, "fk_actual": fks, "fk_expected": exp_fk})
    forbidden = [n for n in actual_tables if n.endswith("_history") or n.split(".")[1] in {"row_versions","dataset_snapshot_rows","field_states","record_row_links"}]
    assert not forbidden, forbidden
    output = {"totals": totals, "active_dependency_closure": closure, "deferred": sorted(deferred), "errors": errors}
    (evidence / "catalogue.json").write_text(json.dumps(output, indent=2) + "\n")
    assert not errors, f"catalogue mismatches: {len(errors)}; see catalogue.json"
    return totals


def bootstrap_bindings(conn, model):
    result = {}
    for name, seeds in model["seed_data"].items():
        rows = list(conn.execute(f"SELECT code,definition_version,recorded_from_gen,transform_code_sha256,relation_code,contract_version FROM {name} ORDER BY code"))
        assert len(rows) == len(seeds), (name, rows)
        assert {(r[0],r[1]) for r in rows} == {(r["code"],r["definition_version"]) for r in seeds}
        for row in rows:
            receipt = conn.execute("SELECT status FROM ingest.dataset_snapshots WHERE generation=%s", (row[2],)).fetchone()
            assert receipt == ("sealed",), (name,row,receipt)
            assert len(row[3]) == 64 and row[3] not in {"0"*64,"a"*64,"1"*64}
            assert conn.execute("SELECT 1 FROM ingest.relation_contracts WHERE relation_code=%s AND contract_version=%s", (row[4],row[5])).fetchone()
        result[name] = [list(r) for r in rows]
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--pg-bin", type=Path, default=Path("/tmp/statarena-cache-test-tools/node_modules/@embedded-postgres/darwin-arm64/native/bin"))
    parser.add_argument("--python-path", type=Path, default=Path("/tmp/statarena-publication-test-python"))
    parser.add_argument("--run-label", default="acceptance")
    args = parser.parse_args()
    sys.path[:0] = [str(args.python_path), str(EVIDENCE)]
    import psycopg
    from harness import LocalPostgres
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    evidence = EVIDENCE / "runs" / f"{stamp}-{args.run_label}"
    evidence.mkdir(parents=True)
    sources=evidence / "inputs"
    sources.mkdir()
    for path in [Path(__file__),MODEL,EVIDENCE/"PROTOCOL.md",EVIDENCE/"fixtures.py",EVIDENCE/"harness.py"]:
        if path.exists():shutil.copy2(path,sources/path.name)
    # Keep the original approval separate from a later bounded correction.
    for path in [EVIDENCE/"approval.json",EVIDENCE/"model-amendments.json",REPO/"tests/orion_pro_metric_states_postgres.py"]:
        if path.exists():shutil.copy2(path,sources/path.name)
    baseline=EVIDENCE/"runs/20261104T175834735172Z-initial-red-missing-runner/inputs/target-schema.proposed.json"
    if baseline.exists():shutil.copy2(baseline,sources/"original-approved-model.json")
    runtime=[REPO/"dashboard/scripts"/name for name in ["orion_pro_schema.py","orion_pro_migrate.py","orion_pro_integrity.py"]]
    runtime += list((REPO/"dashboard/backend/migrations").glob("01[23]_orion_pro_*.sql"))
    for path in runtime:
        if path.exists():shutil.copy2(path,sources/path.name)
    report = {"started_at": datetime.now(timezone.utc).isoformat(), "kind": "local_owned_postgres_e2e", "run_label": args.run_label,
              "model_sha256": digest(MODEL), "test_sha256": digest(Path(__file__)), "protocol_sha256": digest(EVIDENCE / "PROTOCOL.md"),
              "rerun": f"PYTHONPATH={args.python_path} python3 tests/orion_pro_pilot_postgres.py --run-label {args.run_label} --pg-bin '{args.pg_bin}' --python-path '{args.python_path}'",
              "expected": "PROTOCOL.md failure matrix", "cases": [], "external_actions": []}
    report["runtime_sha256"]={str(p.relative_to(REPO)):digest(p) for p in runtime if p.exists()}
    report["runtime_sha256_phase"]="before CLI compilation; preexisting SQL may be regenerated by the runner"
    report["acceptance_scope"]="bounded local typed schema and fixture workflows"
    report["unverified_outside_scope"]=["production collector and public reader adaptation", "remote RDS physical pilot and capacity/performance", "full legacy field/variant reconciliation", "HTTP/browser/cache invalidation parity", "purge/retirement acceptance"]
    pg, conn, fixture = LocalPostgres(args.pg_bin, evidence), None, None
    prerequisite = None
    try:
        report["original_approved_model_sha256"]=MODEL_SHA
        if report["model_sha256"]==MODEL_SHA:
            report["model_gate"]={"kind":"original_approved_baseline","sha256":MODEL_SHA}
        else:
            from orion_pro_metric_states_postgres import validate_model_gate
            _,report["model_gate"]=validate_model_gate(EVIDENCE/"model-amendments.json")
            assert report["model_gate"]["candidate_sha256"]==report["model_sha256"],"Model changed during the E2E gate"
        pg.start()
        conn = psycopg.connect(pg.dsn, autocommit=True)
        report["server_version"] = conn.execute("SELECT version()").fetchone()[0]
        assert conn.info.server_version == 180006, report["server_version"]
        for name in CASE_NAMES:
            if prerequisite:
                report["cases"].append({"case":name,"status":"unverified","reason":prerequisite})
                continue
            try:
                if name == "runner_available":
                    pg.migration(REPO)
                    versions=list(conn.execute("SELECT version,content_sha256 FROM ingest.schema_migrations ORDER BY version"))
                    applied_dir=evidence/"applied-sql"
                    applied_dir.mkdir()
                    applied={}
                    for version,checksum in versions:
                        paths=list((REPO/"dashboard/backend/migrations").glob(f"{version}_orion_pro_*.sql"))
                        assert len(paths)==1,(version,paths)
                        assert digest(paths[0])==checksum,"Compiled SQL differs from the applied migration receipt"
                        shutil.copy2(paths[0],applied_dir/paths[0].name)
                        applied[paths[0].name]=checksum
                    result = {"migration_versions":versions,"applied_sql_sha256":applied,"capture_phase":"immediately after CLI and journal readback"}
                elif name == "active_catalogue":
                    result = active_catalogue(conn, json.loads(MODEL.read_text()), evidence)
                elif name == "bootstrap_bindings":
                    result = bootstrap_bindings(conn,json.loads(MODEL.read_text()))
                elif name == "migration_idempotence_restart_rollback":
                    before = bootstrap_bindings(conn,json.loads(MODEL.read_text()))
                    pg.migration(REPO)
                    conn.close()
                    pg.stop()
                    pg.start()
                    conn = psycopg.connect(pg.dsn, autocommit=True)
                    assert bootstrap_bindings(conn,json.loads(MODEL.read_text())) == before
                    pg.migration(REPO, rollback_to="012")
                    pg.migration(REPO)
                    active_catalogue(conn,json.loads(MODEL.read_text()),evidence)
                    result = {"seed_rows_after_reapply": bootstrap_bindings(conn,json.loads(MODEL.read_text())), "restart": "passed", "rollback_reapply": "passed"}
                else:
                    if fixture is None:
                        from fixtures import PilotWorkflow
                        fixture = PilotWorkflow(conn, pg.dsn, evidence, psycopg)
                    result = getattr(fixture,name)()
                report["cases"].append({"case":name,"status":"pass","actual":result})
                if isinstance(result,dict) and result.get("unverified"):
                    report.setdefault("model_fidelity_gaps",[]).extend(result["unverified"])
                print(f"PASS {name}", flush=True)
            except Exception as exc:
                report["cases"].append({"case":name,"status":"fail","error":str(exc),"traceback":traceback.format_exc()})
                print(f"FAIL {name}: {exc}", flush=True)
                if name in CASE_NAMES[:6]:
                    prerequisite = f"prerequisite {name} failed"
    except Exception as exc:
        report["setup_error"] = str(exc)
        report["setup_traceback"] = traceback.format_exc()
    finally:
        if conn is not None:
            conn.close()
        try:
            report["cleanup"] = pg.cleanup()
        except Exception as exc:
            report["cleanup"] = {"error":str(exc),"owned_root":str(pg.root)}
        report["finished_at"] = datetime.now(timezone.utc).isoformat()
        report["counts"] = {s:sum(c["status"]==s for c in report["cases"]) for s in ("pass","fail","unverified")}
        report["status"] = "pass" if report["counts"]["pass"]==len(CASE_NAMES) and "setup_error" not in report and report["cleanup"].get("server_stopped") else "fail"
        for p in (EVIDENCE / "fixtures.py",EVIDENCE / "harness.py"):
            if p.exists(): report[p.name+"_sha256"] = digest(p)
        (evidence / "result.json").write_text(json.dumps(report, indent=2, default=str)+"\n")
        print(json.dumps({"status":report["status"],"counts":report["counts"],"evidence":str(evidence)}),flush=True)
    return 0 if report["status"]=="pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
