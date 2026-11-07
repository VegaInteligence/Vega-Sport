"""Physical retirement input and transaction guards, without PostgreSQL/cloud."""

from contextlib import redirect_stderr, redirect_stdout
from copy import deepcopy
import hashlib
import io
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "dashboard/scripts"))
import finalize_schema_retirement as cli

HASH = "a" * 64
LOCAL = "postgresql://fixture@127.0.0.1/vega_refactor_test"
REMOTE_HOST = "fixture.us-east-2.rds.amazonaws.com"
REMOTE = "postgresql://statarena_ingest:do-not-print@" + REMOTE_HOST + "/statarena_prod?sslmode=verify-full"


def reviewed_plan():
    return {
        "format": "vega.provider-retirement.plan.v1", "ready": True, "manifest_sha256": HASH,
        "blockers": [], "observations": {},
        "manifest": {
            "format": "vega.provider-retirement.manifest.v1", "database": "vega_refactor_test", "database_oid": "16384",
            "actor": "fixture", "model_digest": cli.MODEL_DIGEST, "revision": 1251,
            "active_physical_tables": 56,
            "activated_at": "2026-11-07T08:05:32Z",
            "publication": {"generation": "310", "published_at": "2026-11-07T08:43:00+00:00"},
            "original_manifest_sha256": "b" * 64, "active_contracts_sha256": "c" * 64,
            "migration_journal_sha256": "d" * 64,
            "tables": [{"name": name, "oid": str(20000 + i), "row_type_oid": str(40000 + i), "owner": "fixture", "acl": None,
                        "column_count": 8, "structure_sha256": "e" * 64} for i, name in enumerate(sorted(cli.TABLE_NAMES))],
            "functions": [{"name": "read_fixture_" + str(i), "oid": str(30000 + i), "arguments": "r statarena_retired_v1.fixture_" + str(i),
                           "owner": "fixture", "acl": None, "active_oid": str(50000 + i), "definition_sha256": "f" * 64} for i in range(62)],
        },
    }


def recovery_proof():
    return {
        "format": "vega.provider-retirement.recovery.v1", "database": "vega_refactor_test",
        "model_digest": cli.MODEL_DIGEST, "manifest_sha256": HASH,
        "snapshot": {"identifier": "verified-fixture-snapshot", "status": "available", "captured_at": "2026-11-06T23:00:00Z", "receipt_sha256": "1" * 64},
        "restore": {"snapshot_identifier": "verified-fixture-snapshot", "status": "verified", "verified_at": "2026-11-07T01:00:00Z",
                    "retired_table_count": 112, "active_contracts_passed": True, "receipt_sha256": "2" * 64},
        "preservation": {"status": "verified", "full_readback_verified": True, "receipt_sha256": "3" * 64, "artifact_sha256": "4" * 64},
        "recovery": {"strategy": "restore_snapshot_then_replay", "post_snapshot_publication_replay_reviewed": True, "plan_sha256": "5" * 64},
        "approval": {"action": "retire_exact_112_provider_tables", "loss_of_in_place_rollback_accepted": True},
    }


def receipt(plan=None):
    plan = plan or reviewed_plan()
    return {
        "format": "vega.provider-retirement.receipt.v1", "status": "finalized", "database": plan["manifest"]["database"],
        "actor": plan["manifest"]["actor"], "finalized_at": "2026-11-07T12:00:00Z", "model_digest": cli.MODEL_DIGEST,
        "revision": 1251, "manifest_sha256": HASH, "recovery_proof_sha256": "f" * 64,
        "dropped_tables": 112, "dropped_functions": 62, "active_physical_tables_before": 56, "active_physical_tables_after": 56,
        "retired_physical_tables_after": 0, "publication_before": plan["manifest"]["publication"],
        "publication_after": plan["manifest"]["publication"], "rollback_available": False, "recovery_strategy": "restore_snapshot_then_replay",
        "manifest": plan["manifest"], "recovery_proof": recovery_proof(),
    }


def write_json(path, value):
    raw = (json.dumps(value, indent=2) + "\n").encode()
    path.write_bytes(raw)
    return hashlib.sha256(raw).hexdigest()


class FakeDB:
    autocommit = True

    def __init__(self, *, value=None, failure=None, identity=("vega_refactor_test", "fixture", "fixture")):
        self.value = value if value is not None else receipt()
        self.failure = failure
        self.identity = identity
        self.queries = []
        self.commits = self.rollbacks = 0

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def transaction(self):
        db = self

        class Transaction:
            def __enter__(self):
                return self

            def __exit__(self, kind, *_):
                if kind:
                    db.rollbacks += 1
                else:
                    db.commits += 1
                return False

        return Transaction()

    def execute(self, statement, params=None):
        self.queries.append((statement, params))
        if statement == "SELECT current_database(),current_user,session_user":
            result = self.identity
        elif statement in cli.SQL.values():
            if self.failure:
                raise self.failure
            result = (self.value,)
        else:
            result = None
        return type("Cursor", (), {"fetchone": lambda _: result})()


class ReviewedFileTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "plan.json"

    def test_hash_is_exact_file_bytes_not_reserialized_manifest(self):
        value = reviewed_plan()
        sha = write_json(self.path, value)
        self.assertEqual(cli.read_reviewed_json(self.path, sha), value)
        self.path.write_bytes(self.path.read_bytes() + b" ")
        with self.assertRaisesRegex(cli.ValidationError, "SHA-256 does not match"):
            cli.read_reviewed_json(self.path, sha)

    def test_duplicate_keys_nonfinite_numbers_and_credential_fields_fail_closed(self):
        cases = [b'{"k":1,"k":2}', b'{"k":1,"\\u006b":2}', b'{"value":NaN}', b'{"value":Infinity}',
                 b'{"value":1e999}', b'{"nested":{"password":"never-print"}}', b'[]', b'\xff', b'{not-json']
        for raw in cases:
            with self.subTest(raw=raw):
                self.path.write_bytes(raw)
                with self.assertRaises(cli.ValidationError) as caught:
                    cli.read_reviewed_json(self.path, hashlib.sha256(raw).hexdigest())
                self.assertNotIn("never-print", str(caught.exception))

    def test_symlinks_directories_and_oversized_files_are_not_read_as_evidence(self):
        sha = write_json(self.path, reviewed_plan())
        link = self.path.with_name("link.json")
        link.symlink_to(self.path)
        for path in (link, self.path.parent):
            with self.subTest(path=path.name), self.assertRaises(cli.ValidationError):
                cli.read_reviewed_json(path, sha)
        with patch.object(cli, "MAX_JSON_BYTES", 10), self.assertRaises(cli.ValidationError):
            cli.read_reviewed_json(self.path, sha)


class ContractTests(unittest.TestCase):
    def test_valid_plan_and_historical_snapshot_need_no_cloud_lookup(self):
        plan, proof = reviewed_plan(), recovery_proof()
        before = deepcopy(plan)
        self.assertEqual(cli.validate_plan(plan, HASH), plan["manifest"])
        cli.validate_recovery(proof, plan)
        self.assertEqual(plan, before)
        # This digest refers to the external restore/replay plan, not this JSON file.
        self.assertNotEqual(proof["recovery"]["plan_sha256"], plan["manifest_sha256"])

    def test_confirmation_ready_state_exact_targets_and_model_are_required(self):
        mutations = [
            lambda p: p.update(ready=False), lambda p: p.update(ready=1),
            lambda p: p.update(blockers=[{"code": "dependency"}]),
            lambda p: p["manifest"].update(model_digest="0" * 64),
            lambda p: p["manifest"].update(revision=True),
            lambda p: p["manifest"].update(database_oid="0"),
            lambda p: p["manifest"]["tables"].pop(),
            lambda p: p["manifest"]["tables"][0].update(name="unexpected_table"),
            lambda p: p["manifest"]["tables"][0].update(name=p["manifest"]["tables"][1]["name"]),
            lambda p: p["manifest"]["tables"][0].update(oid=p["manifest"]["tables"][1]["oid"]),
            lambda p: p["manifest"]["tables"][0].update(owner="another_owner"),
            lambda p: p["manifest"]["tables"][0].update(structure_sha256="A" * 64),
            lambda p: p["manifest"]["functions"].pop(),
            lambda p: p["manifest"]["functions"][0].update(active_oid=p["manifest"]["functions"][0]["oid"]),
            lambda p: p["manifest"]["publication"].update(generation=310),
            lambda p: p["manifest"].update(activated_at="2026-11-07T08:00:00"),
        ]
        for mutate in mutations:
            plan = reviewed_plan()
            mutate(plan)
            with self.subTest(mutate=mutate), self.assertRaises(cli.ValidationError):
                cli.validate_plan(plan, HASH)
        with self.assertRaises(cli.ValidationError):
            cli.validate_plan(reviewed_plan(), "0" * 64)
        with self.assertRaises(cli.ValidationError):
            cli.validate_plan({"format": "vega.provider-retirement.plan.v1", "ready": False, "status": "finalized", "receipt": receipt(), "blockers": []}, HASH)

    def test_each_recovery_assertion_is_bound_and_not_truthy_coercion(self):
        mutations = [
            lambda p: p.update(database="other"), lambda p: p.update(manifest_sha256="0" * 64),
            lambda p: p["snapshot"].update(status="creating"),
            lambda p: p["restore"].update(snapshot_identifier="another-snapshot"),
            lambda p: p["restore"].update(verified_at="2026-11-06T22:00:00Z"),
            lambda p: p["restore"].update(retired_table_count=111),
            lambda p: p["restore"].update(active_contracts_passed=1),
            lambda p: p["preservation"].update(full_readback_verified=False),
            lambda p: p["preservation"].update(artifact_sha256="A" * 64),
            lambda p: p["recovery"].update(strategy="in_place_rollback"),
            lambda p: p["recovery"].update(post_snapshot_publication_replay_reviewed=1),
            lambda p: p["approval"].update(loss_of_in_place_rollback_accepted=False),
            lambda p: p["approval"].update(action="retire_all_tables"),
            lambda p: p.update(unreviewed_extra={}),
        ]
        for mutate in mutations:
            proof = recovery_proof()
            mutate(proof)
            with self.subTest(mutate=mutate), self.assertRaises(cli.ValidationError):
                cli.validate_recovery(proof, reviewed_plan())


class TargetTests(unittest.TestCase):
    def test_remote_reads_and_writes_require_explicit_target_and_tls(self):
        self.assertEqual(cli.validate_target(LOCAL), cli.Target("127.0.0.1", "vega_refactor_test", "fixture", True))
        self.assertEqual(cli.validate_target(REMOTE, REMOTE_HOST, "statarena_prod").actor, "statarena_ingest")
        for url, host, database in ((REMOTE, None, None), (REMOTE, "other", "statarena_prod"),
                                    (REMOTE, REMOTE_HOST, "other"), (REMOTE.replace("verify-full", "require"), REMOTE_HOST, "statarena_prod"),
                                    (LOCAL.replace("vega_refactor_test", "statarena_prod"), None, None)):
            with self.subTest(url=url), self.assertRaises(cli.ValidationError) as caught:
                cli.validate_target(url, host, database)
            self.assertNotIn("do-not-print", str(caught.exception))

    def test_uri_overrides_and_ambient_libpq_configuration_cannot_bypass_checked_identity(self):
        for override in ("host=other", "hostaddr=1.2.3.4", "dbname=other", "user=other", "service=other", "options=-crole=admin", "sslmode=disable"):
            with self.subTest(override=override), self.assertRaises(cli.ValidationError):
                cli.validate_target(REMOTE + "&" + override, REMOTE_HOST, "statarena_prod")
        for key in ("PGHOST", "PGHOSTADDR", "PGDATABASE", "PGUSER", "PGSERVICE", "PGSERVICEFILE", "PGOPTIONS"):
            with self.subTest(key=key), self.assertRaises(cli.ValidationError):
                cli.validate_environment({key: "do-not-print"})
        cli.validate_environment({"PGPASSWORD": "do-not-print"})

    def test_malformed_or_ambiguous_uri_is_rejected_without_echoing_it(self):
        for url in ("dbname=secret", "postgresql://fixture@host1,host2/db", "postgresql://fixture@host:bad/db",
                    "postgresql://fixture@host/vega_ci_test#secret", "postgresql:///vega_ci_test", "postgresql://fixture@%2Ftmp/vega_ci_test",
                    "postgresql://fixture@127.0.0.1\n/vega_refactor_test"):
            with self.subTest(url=url), self.assertRaises(cli.ValidationError):
                cli.validate_target(url)


class TransactionTests(unittest.TestCase):
    def test_status_and_plan_are_read_only_with_fixed_identity_and_timeout_checks(self):
        for action, value in (("status", {"control": {"mode": "active"}}), ("plan", reviewed_plan())):
            db = FakeDB(value=value)
            self.assertEqual(cli.execute(db, cli.validate_target(LOCAL), action=action), value)
            self.assertEqual(db.queries[0][0], "SET TRANSACTION READ ONLY")
            self.assertEqual(db.queries[-1], (cli.SQL[action], None))
            self.assertEqual((db.commits, db.rollbacks), (1, 0))

    def test_apply_submits_reviewed_objects_once_without_loading_a_fresh_plan(self):
        db, plan, proof = FakeDB(), reviewed_plan(), recovery_proof()
        result = cli.execute(db, cli.validate_target(LOCAL), action="apply", plan=plan, proof=proof, confirmation=HASH)
        writes = [(q, p) for q, p in db.queries if q == cli.SQL["apply"]]
        self.assertEqual(len(writes), 1)
        self.assertEqual(json.loads(writes[0][1][0]), plan)
        self.assertEqual(json.loads(writes[0][1][1]), proof)
        self.assertEqual(writes[0][1][2], HASH)
        self.assertFalse(any(q == cli.SQL["plan"] for q, _ in db.queries))
        self.assertEqual(result["dropped_tables"], 112)
        self.assertEqual((db.commits, db.rollbacks), (1, 0))

    def test_identity_drift_and_unexpected_result_rollback_before_commit(self):
        bad_receipt = receipt()
        bad_receipt["active_physical_tables_after"] = 55
        changed_proof = receipt()
        changed_proof["recovery_proof"]["preservation"]["artifact_sha256"] = "0" * 64
        cases = [FakeDB(identity=("other", "fixture", "fixture")),
                 FakeDB(identity=("vega_refactor_test", "fixture", "admin")), FakeDB(value=bad_receipt), FakeDB(value=changed_proof)]
        for db in cases:
            with self.subTest(identity=db.identity), self.assertRaises(cli.ValidationError):
                cli.execute(db, cli.validate_target(LOCAL), action="apply", plan=reviewed_plan(), proof=recovery_proof(), confirmation=HASH)
            self.assertEqual((db.commits, db.rollbacks), (0, 1))
        self.assertFalse(any(q == cli.SQL["apply"] for q, _ in cases[0].queries))


class CLITests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.plan = self.root / "plan.json"
        self.proof = self.root / "recovery.json"
        self.plan_sha = write_json(self.plan, reviewed_plan())
        self.proof_sha = write_json(self.proof, recovery_proof())
        self.args = ["apply", "--plan", str(self.plan), "--plan-sha256", self.plan_sha,
                     "--recovery-proof", str(self.proof), "--recovery-sha256", self.proof_sha,
                     "--confirm-manifest-sha256", HASH]

    def run_cli(self, args, db=None):
        out, err = io.StringIO(), io.StringIO()
        with patch.dict(os.environ, {"DATABASE_URL": LOCAL}, clear=True), patch.object(cli, "connect", return_value=db or FakeDB()) as connect, \
                redirect_stdout(out), redirect_stderr(err):
            code = cli.main(args)
        return code, out.getvalue(), err.getvalue(), connect

    def test_default_is_status_and_apply_flags_are_never_silently_ignored(self):
        db = FakeDB(value={"control": {"mode": "active", "revision": 1}, "active_physical_tables": 56, "retired_physical_tables": 112})
        code, out, _, _ = self.run_cli([], db)
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out)["action"], "status")
        code, _, _, connect = self.run_cli(["status", "--confirm-manifest-sha256", HASH])
        self.assertEqual(code, 2)
        connect.assert_not_called()

    def test_bad_file_hash_and_missing_confirmation_fail_before_connect(self):
        for args in (self.args[:-2], [a if a != self.plan_sha else "0" * 64 for a in self.args]):
            with self.subTest(args=args):
                code, _, _, connect = self.run_cli(args)
                self.assertEqual(code, 2)
                connect.assert_not_called()

    def test_oversized_worker_envelope_is_rejected_before_connect_using_utf8_bytes(self):
        plan = reviewed_plan()
        plan["observations"]["note"] = "é" * 40000
        compact = json.dumps([plan, recovery_proof(), HASH], ensure_ascii=False, separators=(",", ":"))
        self.assertLess(len(compact), cli.MAX_APPLY_BYTES)
        self.assertGreater(len(compact.encode("utf-8")), cli.MAX_APPLY_BYTES)
        sha = write_json(self.plan, plan)
        args = [sha if value == self.plan_sha else value for value in self.args]
        code, _, err, connect = self.run_cli(args)
        self.assertEqual(code, 2)
        self.assertIn("100000-byte", err)
        connect.assert_not_called()

    def test_finalized_plan_reports_recovery_state_without_reapplying(self):
        value = {"format": "vega.provider-retirement.plan.v1", "ready": False, "status": "finalized",
                 "receipt": receipt(), "blockers": [{"kind": "physical_retirement_finalized"}]}
        code, out, _, _ = self.run_cli(["plan"], FakeDB(value=value))
        self.assertEqual(code, 0)
        report = json.loads(out)
        self.assertEqual(report["manifest_sha256"], HASH)
        self.assertEqual(report["dropped_tables"], 112)
        self.assertEqual(report["recovery_strategy"], "restore_snapshot_then_replay")
        self.assertFalse(report["rollback_available"])

    def test_plan_output_has_exact_file_digest_and_private_permissions(self):
        destination = self.root / "review.json"
        code, out, _, _ = self.run_cli(["plan", "--receipt", str(destination)], FakeDB(value=reviewed_plan()))
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out)["receipt_file_sha256"], hashlib.sha256(destination.read_bytes()).hexdigest())
        self.assertEqual(stat.S_IMODE(destination.stat().st_mode), 0o600)
        self.assertEqual(json.loads(destination.read_bytes()), reviewed_plan())

    def test_existing_receipt_is_not_overwritten_and_blocks_apply_before_connect(self):
        code, _, _, connect = self.run_cli(self.args + ["--receipt", str(self.plan)])
        self.assertEqual(code, 2)
        connect.assert_not_called()
        self.assertEqual(hashlib.sha256(self.plan.read_bytes()).hexdigest(), self.plan_sha)

    def test_database_failure_is_redacted_not_retried_and_leaves_no_partial_receipt(self):
        class Failure(Exception):
            sqlstate = "55000"

        db = FakeDB(failure=Failure("postgresql://user:do-not-print@host secret row content"))
        destination = self.root / "result.json"
        code, out, err, _ = self.run_cli(self.args + ["--receipt", str(destination)], db)
        self.assertEqual(code, 2)
        self.assertNotIn("do-not-print", out + err)
        self.assertNotIn("secret row content", out + err)
        self.assertEqual(json.loads(err)["sqlstate"], "55000")
        self.assertEqual(json.loads(err)["outcome"], "check_read_only_plan_before_any_retry")
        self.assertEqual(sum(q == cli.SQL["apply"] for q, _ in db.queries), 1)
        self.assertFalse(any(q == cli.SQL["plan"] for q, _ in db.queries))
        self.assertFalse(destination.exists())

    def test_success_summary_does_not_print_full_plan_or_claim_external_verification(self):
        destination = self.root / "result.json"
        code, out, _, _ = self.run_cli(self.args + ["--receipt", str(destination)])
        self.assertEqual(code, 0)
        result = json.loads(out)
        self.assertEqual(result["recovery_evidence"], "operator_attested")
        self.assertNotIn("manifest", result)
        self.assertNotIn("recovery_proof", result)
        self.assertEqual(json.loads(destination.read_bytes())["manifest"], reviewed_plan()["manifest"])


if __name__ == "__main__":
    unittest.main()
