"""Failure attribution is retained without persisting SQL or source payloads."""

import json
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "dashboard/scripts"))
from player_rollups import refresh_player_rollups
from publication_trace import PublicationTrace, mark_stage


class QueryCanceled(Exception):
    sqlstate = "57014"

    def __init__(self, message="canceling statement due to statement timeout", context=None):
        super().__init__("DO NOT LOG source body or SQL parameters")
        self.diag = SimpleNamespace(message_primary=message, context=context)


class PublicationTraceTests(unittest.TestCase):
    def test_rollup_failure_retains_stage_after_rollback_and_redacts_all_payloads(self):
        clock = [0]
        fault = QueryCanceled(context='SQL statement "SECRET SOURCE SQL"\nPL/pgSQL function statarena_app.refresh_player_season_rollups(text,text,boolean) line 92 at SQL statement')

        class DB:
            def execute(self, *_):
                clock[0] = 122
                raise fault

        trace = PublicationTrace(clock=lambda: clock[0])
        with self.assertRaises(QueryCanceled) as caught:
            with trace:
                mark_stage("core_match_write")
                clock[0] = 2
                try:
                    refresh_player_rollups(DB(), "source-season-must-not-log", "source-id-must-not-log")
                finally:
                    clock[0] += 1  # The surrounding SQL transaction rolls back.
        self.assertIs(caught.exception, fault)
        result = trace.failure(fault)
        self.assertEqual(result["failure_stage"], "rollup_refresh")
        self.assertEqual(result["stage_seconds"], 121)
        self.assertEqual(result["stage_timings"]["core_match_write"], 2)
        self.assertEqual(result["cancellation"], "statement_timeout")
        self.assertEqual((result["sql_function"], result["sql_function_line"]), ("refresh_player_season_rollups", 92))
        encoded = json.dumps(result)
        for secret in ("SECRET", "DO NOT LOG", "source-season", "source-id", "SQL parameters"):
            self.assertNotIn(secret, encoded)
        # A later observer/rollback cannot rewrite the recorded interval.
        clock[0] = 999
        self.assertEqual(trace.failure(fault), result)

    def test_only_exact_known_cancellations_and_function_frames_are_emitted(self):
        for message, expected in [
            ("canceling statement due to user request", "user_cancel"),
            ("canceling statement due to statement timeout -- sensitive detail", "unclassified"),
            ("untrusted error text", "unclassified"),
            (None, "unclassified"),
        ]:
            with PublicationTrace() as trace:
                mark_stage("source_spool")
            result = trace.failure(QueryCanceled(message, "PL/pgSQL function private_secret(text) line 9 at SQL statement"))
            self.assertEqual(result["cancellation"], expected)
            self.assertNotIn("sql_function", result)
            self.assertNotIn("private_secret", json.dumps(result))
        self.assertNotIn("cancellation", trace.failure(ValueError("sensitive")))

    def test_successful_stages_accumulate_repeated_batches_and_track_commit(self):
        clock = [0]
        with PublicationTrace(clock=lambda: clock[0]) as trace:
            mark_stage("detail_write")
            clock[0] = 1
            mark_stage("detail_prepare")
            clock[0] = 2
            mark_stage("detail_write")
            clock[0] = 4
            mark_stage("transaction_commit")
            clock[0] = 4.5
        self.assertEqual(trace.timings(), {"partition_start": 0, "detail_write": 3, "detail_prepare": 1, "transaction_commit": 0.5})

    def test_context_is_restored_between_nested_calls_and_next_partition(self):
        with PublicationTrace() as outer:
            mark_stage("source_scope")
            with PublicationTrace() as inner:
                mark_stage("rollup_refresh")
            mark_stage("transaction_commit")
        mark_stage("detail_write")  # No active observer.
        self.assertEqual(outer.stage, "transaction_commit")
        self.assertEqual(inner.stage, "rollup_refresh")
        with PublicationTrace() as next_partition:
            pass
        self.assertEqual(next_partition.stage, "partition_start")

    def test_stage_names_cannot_encode_source_values(self):
        with PublicationTrace() as trace:
            with self.assertRaisesRegex(ValueError, "Unknown publication diagnostic stage"):
                mark_stage("source-body-secret")
        self.assertNotIn("source-body-secret", json.dumps(trace.timings()))


if __name__ == "__main__":
    unittest.main()
