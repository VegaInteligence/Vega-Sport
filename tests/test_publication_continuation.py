"""Catalogue admission budgets preserve atomic batch boundaries without a DB."""

import io
import sys
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "dashboard/scripts"))
import relational_materialize as publisher


class CatalogueAdmissionTests(unittest.TestCase):
    def slice(self, *, pending=100, seconds=0, stop=100, start=0):
        clock = [start]
        admissions = []

        def publish(inputs, limit):
            nonlocal pending
            admissions.append((clock[0], limit))
            count = min(pending, limit)
            pending -= count
            clock[0] += seconds
            return count

        with patch.object(publisher, "time", SimpleNamespace(monotonic=lambda: clock[0])), \
             patch.object(publisher, "catalog_batch", side_effect=publish):
            applied, error = publisher.catalog_slice(object(), stop)
            self.assertIsNone(error)
        return applied, pending, clock[0], admissions

    def test_fast_catalogue_yields_after_forty_inputs_in_small_transactions(self):
        applied, pending, _, admissions = self.slice()
        self.assertEqual((applied, pending), (40, 60))
        self.assertEqual(admissions, [(0, 4)] * 10)

    def test_slow_batch_finishes_atomically_then_no_new_batch_is_admitted(self):
        applied, pending, elapsed, admissions = self.slice(seconds=35)
        self.assertEqual((applied, pending, elapsed), (4, 96, 35))
        self.assertEqual(admissions, [(0, 4)])

    def test_slice_deadline_is_checked_between_transactions(self):
        applied, pending, elapsed, admissions = self.slice(seconds=11)
        self.assertEqual((applied, pending, elapsed), (12, 88, 33))
        self.assertEqual(admissions, [(0, 4), (11, 4), (22, 4)])

    def test_global_deadline_takes_precedence_over_the_slice_budget(self):
        applied, pending, elapsed, admissions = self.slice(seconds=7, start=90, stop=100)
        self.assertEqual((applied, pending, elapsed), (8, 92, 104))
        self.assertEqual(admissions, [(90, 4), (97, 4)])

    def test_expired_run_does_not_start_a_transaction(self):
        self.assertEqual(self.slice(start=100, stop=100), (0, 100, 100, []))

    def test_short_or_empty_queue_does_not_busy_loop(self):
        self.assertEqual(self.slice(pending=2), (2, 0, 0, [(0, 4)]))
        self.assertEqual(self.slice(pending=0), (0, 0, 0, [(0, 4)]))

    def test_failed_batch_returns_committed_progress_without_retrying_it(self):
        error = RuntimeError("Synthetic publication failure")
        with patch.object(publisher, "catalog_batch", side_effect=[4, error]) as publish:
            count, caught = publisher.catalog_slice(object(), publisher.time.monotonic() + 60)
        self.assertEqual(count, 4)
        self.assertIs(caught, error)
        self.assertEqual(publish.call_count, 2)


class QueueFailureTests(unittest.TestCase):
    def test_closed_connection_aborts_instead_of_isolating_a_queue(self):
        for queue in ("global", "catalog"):
            with self.subTest(queue=queue):
                original = publisher.psycopg.OperationalError("Synthetic connection loss")

                class DB:
                    closed = False

                    def execute(self, query, params=None):
                        if self.closed:
                            raise publisher.psycopg.OperationalError("closed")
                        if "pg_try_advisory_lock" in query:
                            return SimpleNamespace(fetchone=lambda: (True,))
                        if "count(*)" in query:
                            return SimpleNamespace(fetchone=lambda: (1,))
                        if "SELECT j.season" in query:
                            return SimpleNamespace(fetchall=lambda: [("2026/2027", "l_000001", None)])
                        if "work_failed" in query or "workflow_state" in query:
                            return None
                        raise AssertionError("Unexpected query: " + query)

                db = DB()

                def fail(*_):
                    db.closed = True
                    if queue == "global":
                        raise original
                    return 0, original

                with patch.object(publisher, "capacity"), patch.object(publisher, "install"), \
                     patch.object(publisher, "prepare"), \
                     patch.object(publisher, "Inputs", return_value=SimpleNamespace(read=lambda _: {})), \
                     patch.object(publisher, "publish_global", side_effect=fail if queue == "global" else lambda _: {}), \
                     patch.object(publisher, "catalog_slice", side_effect=fail), \
                     redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
                    with self.assertRaises(publisher.psycopg.OperationalError) as caught:
                        publisher.run(SimpleNamespace(db=db))
                self.assertIs(caught.exception, original)

    def test_cli_reports_each_queue_failure_as_nonzero_and_closes_the_store(self):
        for queue in ("failed_partitions", "failed_globals", "failed_catalog_batches"):
            with self.subTest(queue=queue):
                closed = []
                store = SimpleNamespace(db=SimpleNamespace(close=lambda: closed.append(True)))
                with patch.dict(sys.modules, {"aws_store": SimpleNamespace(Store=lambda: store)}), \
                     patch.dict(publisher.os.environ, {"GITHUB_ACTIONS": "true", "STATARENA_DATA_PROVIDER": "aws",
                         "DATABASE_URL": "postgresql://fixture@fixture.us-east-2.rds.amazonaws.com/statarena_prod?sslmode=verify-full"}), \
                     patch.object(sys, "argv", ["relational_materialize.py"]), \
                     patch.object(publisher, "run", return_value={queue: 1, "remaining": 1}), \
                     redirect_stdout(io.StringIO()):
                    with self.assertRaises(SystemExit) as caught:
                        publisher.main()
                self.assertEqual(caught.exception.code, 1)
                self.assertEqual(closed, [True])

    def test_error_log_code_rejects_payload_text(self):
        self.assertEqual(publisher.publication_error_code(ValueError("source-body-must-not-appear")), "ValueError")
        self.assertEqual(publisher.publication_error_code(SimpleNamespace(sqlstate="source body\nnot a code")), "PublicationError")


if __name__ == "__main__":
    unittest.main()
