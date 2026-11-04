#!/usr/bin/env python3
"""Before-code E2E contract: existing AWS sources -> real typed local PostgreSQL."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import sys
import traceback
from decimal import Decimal, localcontext

REPO = Path(__file__).resolve().parents[1]
EVIDENCE = REPO / "docs/verification/orion-pro-pilot-20261104"
MODEL = REPO / "docs/architecture/orion-plan-20261104/target-schema.proposed.json"
NORMALIZER = REPO / "dashboard/scripts/orion_pro_normalize.py"
EXPECTED = {"fixtures": 612, "matches": 387, "performances": 15437, "shots": 9795,
            "players": 839, "teams": 20, "player_profile_lookup_gaps": 62}
CASES = ["importer_available", "real_source_import", "exact_typed_key_counts",
         "source_oracle_metrics_aliases", "native_shapes_quality", "noop_reimport",
         "source_correction_retains_snapshot", "local_sql_reads", "mapping_acceptance_boundary"]


def numeric_boundary(conn, normalizer):
    values = [Decimal('12345678901234567890123456781'),Decimal('12345678901234567890123456782'),
              Decimal('0.123456789012345678901234567891'),123456789012345678901234567891,
              Decimal('10000000000000000000000000000.0000'),Decimal('-0.0000')]
    observations = []
    with localcontext() as context:
        context.prec = 28
        for value in values:
            stored = conn.execute('SELECT %s::numeric',(value,)).fetchone()[0]
            canonical = normalizer.normalized(value)['number']
            exact = Decimal(canonical)==stored
            observations.append({'kind':type(value).__name__,'input':str(value),'postgresNumeric':str(stored),'canonical':canonical,'exact':exact})
        distinct = normalizer.hashed(values[0])!=normalizer.hashed(values[1])
    result={'observations':observations,'lastDigitHashesDistinct':distinct,'decimalContextPrecision':28}
    return result, all(r['exact'] for r in observations) and distinct


def collection_boundary(conn, normalizer, evidence):
    class RollbackFixture(Exception):pass
    outcomes=[]
    passed=True
    try:
        with conn.transaction():
            conn.execute('SET LOCAL ROLE orion_pro_ingest')
            actor=normalizer.TypedCore(conn,evidence,None)
            actor.g=conn.execute("SELECT ingest.begin_generation('review-collection-boundary','real_source_core_v1','real_source_core_v1')").fetchone()[0]
            for name,t in actor.tables.items():
                if t['phase']!='models' and 'relation_code' in t['columns']:
                    conn.execute('INSERT INTO ingest.relation_contracts(relation_code,relation_name,contract_version,grain_definition) VALUES(%s,%s,%s,%s) ON CONFLICT DO NOTHING',
                        (name,name,normalizer.VERSION,t['grain']))
            source=actor.insert('ingest.sources',code='synthetic_review_boundary',name='Explicit synthetic collection boundary')
            actor.ids['source']=source['id']
            dataset=actor.insert('ingest.source_datasets',source_id=source['id'],dataset_key='synthetic-boundary',contract_version=normalizer.VERSION)
            document=actor.insert('ingest.source_documents',source_id=source['id'],dataset_id=dataset['id'],content_sha256='f'*64,
                retrieved_at=datetime.now(timezone.utc),request_fingerprint='e'*64)
            record=actor.insert('ingest.source_records',source_id=source['id'],document_id=document['id'],locator_kind='whole_document',locator='',record_kind='synthetic_boundary')
            competition=actor.insert('football.competitions',slug='synthetic-review-boundary',competition_type='unknown',gender='unknown',source_record_id=record['id'])
            edition=actor.insert('football.competition_seasons',competition_id=competition['id'],competition_revision_id=competition['revision_id'],season_key='synthetic',label='Synthetic',source_record_id=record['id'])
            match=actor.insert('football.matches',competition_season_id=edition['id'],competition_season_revision_id=edition['revision_id'],kickoff_precision='unknown',status='unknown',source_record_id=record['id'])
            actor.matches['synthetic_match']=match
            for family,key in [('events','events'),('momentum','points'),('h2h','recent_matches')]:
                for label,value in [('missing',None),('null',None),('object',{}),('number',0),('string',''),('invalid_member',[0]),('empty',[])]:
                    data={} if label=='missing' else {key:value}
                    try:
                        with conn.transaction():
                            actor.transform_family(family,'synthetic_match',data,record['id'],f'review:{family}:{label}')
                            actual=conn.execute('SELECT coverage_state,collection_state,observed_row_count FROM ingest.match_coverage WHERE match_id=%s AND feature_code=%s AND variant_key=%s',
                                (match['id'],family,f'review:{family}:{label}')).fetchone()
                            ok=label=='empty' and actual==('empty_response','empty',0)
                            outcomes.append({'family':family,'form':label,'accepted':True,'coverage':actual,'expectedOutcomeMet':ok})
                            passed=passed and ok
                            raise RollbackFixture()
                    except RollbackFixture:pass
                    except normalizer.MappingError:
                        ok=label!='empty'
                        outcomes.append({'family':family,'form':label,'accepted':False,'expectedOutcomeMet':ok})
                        passed=passed and ok
                    except Exception as error:
                        outcomes.append({'family':family,'form':label,'accepted':False,'errorType':type(error).__name__,'expectedOutcomeMet':False})
                        passed=False
            raise RollbackFixture()
    except RollbackFixture:pass
    return {'syntheticFixtureRolledBack':True,'outcomes':outcomes},passed


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--pg-bin", type=Path, default=Path("/tmp/statarena-cache-test-tools/node_modules/@embedded-postgres/darwin-arm64/native/bin"))
    parser.add_argument("--label", default="real-source")
    parser.add_argument("--phase", choices=["core", "families"], default="core")
    parser.add_argument("--source-scope", type=Path, default=EVIDENCE / "source_scope.json")
    args = parser.parse_args()
    cases = list(CASES)
    cases.insert(1,'native_boundary_counterexamples')
    cases.insert(1,"common_native_contract_available")
    cases.append("common_native_projection_consistency")
    if args.phase == "families":
        cases.insert(1,"family_normalizer_available")
        cases.append("original_family_typed_dispositions")
        cases.append("full_profile_members_exact")
    run = EVIDENCE / "real-source-runs" / (datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ") + "-" + args.label)
    run.mkdir(parents=True)
    inputs = run / "inputs"
    inputs.mkdir()
    # Code/spec metadata only. Never copy AWS documents or a PostgreSQL dump.
    for source in [Path(__file__), EVIDENCE / "REAL_SOURCE_PROTOCOL.md", EVIDENCE / "harness.py", EVIDENCE / "model-amendments.json", EVIDENCE / "approval.json", MODEL, NORMALIZER]:
        if source.exists():
            shutil.copy2(source, inputs / source.name)
    sys.path.insert(0, str(EVIDENCE))
    sys.path.insert(0, str(REPO / "dashboard/scripts"))
    from harness import LocalPostgres
    import psycopg
    pg = LocalPostgres(args.pg_bin, run)
    report = {"startedAt": datetime.now(timezone.utc).isoformat(), "environment": "owned disposable LOCAL PostgreSQL18.6",
              "command": f"PYTHONPATH=/tmp/statarena-publication-test-python python3 tests/orion_pro_real_pilot.py --label {args.label} --phase {args.phase}",
              "modelSha256": sha(MODEL), "sourceScopeSha256": sha(args.source_scope), "expected": EXPECTED,
              "limits": {"awsIndexedQueries":100,"awsDecodedBytes":256*1024*1024,"awsStatementMs":8000,"awsLockMs":1000},
              "cases": [], "remoteWrites": [], "rawSourceCopies": [], "phase": args.phase}
    conn = None
    pilot = None
    blocked = None
    try:
        from orion_pro_metric_states_postgres import validate_model_gate
        _,report["modelGate"] = validate_model_gate(EVIDENCE / "model-amendments.json")
        pg.start()
        pg.migration(REPO)
        conn = psycopg.connect(pg.dsn, autocommit=True)
        for case in cases:
            if blocked:
                report["cases"].append({"case":case,"status":"unverified","reason":blocked})
                continue
            try:
                if case == "importer_available":
                    assert NORMALIZER.is_file(), "real-source normalizer does not exist (expected initial RED)"
                    spec = importlib.util.spec_from_file_location("orion_pro_normalize", NORMALIZER)
                    normalizer = importlib.util.module_from_spec(spec)
                    spec.loader.exec_module(normalizer)
                    assert callable(getattr(normalizer, "run_real_pilot", None)), "normalizer interface missing"
                    actual = {"normalizerSha256":sha(NORMALIZER)}
                elif case=='native_boundary_counterexamples':
                    numeric,numeric_ok=numeric_boundary(conn,normalizer)
                    collections,collections_ok=collection_boundary(conn,normalizer,run)
                    actual={'numeric':numeric,'collections':collections,'awsReads':0}
                    report['reviewBoundaryCounterexamples']=actual
                    assert numeric_ok and collections_ok,'Review counterexamples failed: numeric exact='+str(numeric_ok)+', collection shapes='+str(collections_ok)
                elif case == "family_normalizer_available":
                    assert callable(getattr(normalizer.TypedCore,"import_original_families",None)), "original13-family normalizer does not exist (expected family-phase RED)"
                    assert callable(getattr(normalizer.TypedCore,"import_source_profiles",None)), "exact full-profile normalizer does not exist (expected profile-phase RED)"
                    actual = {"interface":"TypedCore.import_original_families"}
                elif case == "common_native_contract_available":
                    assert callable(getattr(normalizer.TypedCore,"insert_common_native_states",None)), "common metric native-state normalizer does not exist (expected native-state RED)"
                    actual = {"interface":"TypedCore.insert_common_native_states"}
                elif case == "real_source_import":
                    pilot = normalizer.run_real_pilot(conn, run, args.source_scope, args.phase)
                    assert pilot["sourceBudget"]["queries"] <= 100
                    assert pilot["sourceBudget"]["decodedBytes"] <= 256*1024*1024
                    assert pilot["role"] == "orion_pro_ingest"
                    actual = pilot["import"]
                elif case == "exact_typed_key_counts":
                    sqls = {
                        "fixtures":"SELECT count(*) FROM football.matches_current",
                        "matches":"SELECT count(*) FROM football.matches_current WHERE status='finished'",
                        "performances":"SELECT count(*) FROM football.match_players_current",
                        "shots":"SELECT count(*) FROM football.shots_current",
                        "players":"SELECT count(*) FROM football.players",
                        "teams":"SELECT count(*) FROM football.teams",
                    }
                    actual = {k:conn.execute(sql).fetchone()[0] for k,sql in sqls.items()}
                    assert actual == {k:EXPECTED[k] for k in actual}, actual
                elif case == "source_oracle_metrics_aliases":
                    actual = pilot["oracleComparisons"]
                    assert actual and all(x["sourceSha256"]==x["typedSha256"] and x["sourceRows"]==x["typedRows"] for x in actual), actual
                    assert {x["kind"] for x in actual} >= {"fixtures","performances","shots","public_aliases"}
                elif case == "native_shapes_quality":
                    actual = pilot["nativeShapes"]
                    assert actual["missingProfileResourceCount"] == 62
                    assert actual["missingToZeroCoercions"] == 0
                    assert actual["opaqueSourceBodiesStored"] == 0
                    assert actual["numericRoundingCoercions"] == 0
                elif case == "noop_reimport":
                    actual = pilot["noop"]
                    assert actual["duplicateRows"] == 0 and actual["newFactRevisions"] == 0
                elif case == "source_correction_retains_snapshot":
                    actual = pilot["correction"]
                    assert actual["throughActualNormalizer"] and actual["newValue"] != actual["oldValue"]
                    assert actual["oldSnapshotValue"] == actual["oldValue"]
                    assert actual["newSnapshotValue"] == actual["newValue"]
                elif case == "local_sql_reads":
                    actual = pilot["reads"]
                    assert {x["kind"] for x in actual} >= {"list","player","club","match"}
                    assert all(x["rows"] > 0 and x["environment"] == "local" for x in actual)
                elif case == "mapping_acceptance_boundary":
                    actual = pilot["mapping"]
                    assert actual["dispositions"] and actual["unknownUsefulFieldsSilentlyDropped"] == 0
                    if actual["rejected"] or actual["unverified"]:
                        assert not pilot["fullAcceptance"]
                        actual = {**actual,"fullAcceptance":False,"scope":"Explicit mapping gaps remain; this is not global migration acceptance"}
                elif case == "original_family_typed_dispositions":
                    actual = pilot["families"]
                    expected_families = {"match","shots","momentum","events","players","player_halves","lineups","h2h","stats","advanced_teams","advanced_players","pass_networks","heatmaps"}
                    assert {x["family"] for x in actual["dispositions"]} == expected_families
                    assert actual["sourceMembers"]==26 and actual["uniqueMemberFailures"]==0
                    assert actual["opaqueSourceBodiesStored"]==0
                    assert actual["typedRows"]>0 and actual["leafDispositions"]
                elif case == "full_profile_members_exact":
                    actual = pilot["fullProfiles"]
                    assert actual["candidatePlayerResourceRows"]==777 and actual["selectedTeamObservations"]==20
                    assert actual["selectedPlayerObservations"]==776 and actual["mismatchedIds"]==1
                    assert actual["rejectedProviderIds"]==["p_1JuxKR"] and actual["missingPlayerResourceKeys"]==62
                    assert actual["opaqueSourceBodiesStored"]==0
                    assert conn.execute("SELECT count(*) FROM football.player_profile_versions p JOIN ingest.public_aliases_current a ON a.player_id=p.player_id AND a.route_kind='player' WHERE a.public_key='p_1JuxKR' AND p.profile_context='provider_global'").fetchone()[0]==0
                    assert conn.execute("SELECT count(*) FROM ingest.quality_issues WHERE rule_code='profile_resource_member_identity_conflict'").fetchone()[0]==1
                elif case == "common_native_projection_consistency":
                    actual = pilot["commonNativeProjection"]
                    assert actual["sourceRows"]==EXPECTED["performances"]*4 and actual["typedRows"]==actual["sourceRows"]
                    assert actual["sourceSha256"]==actual["typedSha256"]
                    assert actual["unknownMissingRows"]==0 and actual["bindingOrCohortMismatchRows"]==0
                    correction = pilot["correction"]["nativeStateOracleAfter"]
                    assert correction["sourceSha256"]==correction["typedSha256"] and correction["bindingOrCohortMismatchRows"]==0
                    assert pilot["correction"]["newNativeStates"]=={"xg":"number","xa":"null","xgot":"absent","minutes":"number"}
                report["cases"].append({"case":case,"status":"pass","actual":actual})
                print("PASS " + case, flush=True)
            except Exception as error:
                # Never dump a row/source body or connection detail into evidence.
                safe = str(error) if (isinstance(error, AssertionError) or type(error).__name__=="MappingError") and not getattr(error, "sqlstate", None) else type(error).__name__
                report["cases"].append({"case":case,"status":"fail","error":safe,"sqlstate":getattr(error,"sqlstate",None)})
                print("FAIL " + case + ": " + safe, flush=True)
                if case in {"importer_available","native_boundary_counterexamples","family_normalizer_available","common_native_contract_available","real_source_import"}:
                    blocked = "prerequisite " + case + " failed"
    except Exception as error:
        report["setupError"] = {"type":type(error).__name__,"reason":str(error) if isinstance(error, RuntimeError) else None}
    finally:
        if conn is not None:
            conn.close()
        report["cleanup"] = pg.cleanup()
        report["finishedAt"] = datetime.now(timezone.utc).isoformat()
        report["counts"] = {status:sum(c["status"]==status for c in report["cases"]) for status in ("pass","fail","unverified")}
        report["status"] = "pass" if report["counts"]["pass"]==len(cases) and not report.get("setupError") else "fail"
        (run / "result.json").write_text(json.dumps(report, indent=2, default=str)+"\n")
        print(json.dumps({"status":report["status"],"counts":report["counts"],"evidence":str(run)}),flush=True)
    return 0 if report["status"]=="pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
