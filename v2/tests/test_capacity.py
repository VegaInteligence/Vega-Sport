import json
import os
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from vega_v2.capacity import (
    CapacityGuard,
    cloudwatch_free_storage,
    RDS_HOST,
    DEFAULT_RESERVE,
)
from vega_v2.store import StoreError

NOW = 1794268800.0


class DB:
    def __init__(self, host=RDS_HOST, name="vega_v2", size=512):
        self.info = SimpleNamespace(host=host)
        self.name = name
        self.size = size
        self.calls = 0

    def execute(self, sql):
        if sql != "SELECT current_database(),pg_database_size(current_database())":
            raise AssertionError(sql)
        self.calls += 1
        return SimpleNamespace(fetchone=lambda: (self.name, self.size))


def point(timestamp, minimum):
    from datetime import datetime, timezone

    return {
        "Timestamp": datetime.fromtimestamp(timestamp, timezone.utc).isoformat(),
        "Minimum": minimum,
    }


class CapacityTests(unittest.TestCase):
    def blocked(self, guard, reason):
        with self.assertRaisesRegex(StoreError, "^V2_CAPACITY_LOW$"):
            guard()
        self.assertEqual(guard.snapshot["reason"], reason)

    def test_remote_uses_minimum_of_recent_series_and_caches_both_reads(self):
        clock = [NOW]
        db = DB()
        calls = []

        def sample(start, end):
            calls.append((start, end))
            return {
                "Datapoints": [
                    point(end - 10, DEFAULT_RESERVE + 20),
                    point(end - 500, DEFAULT_RESERVE + 10),
                ]
            }

        guard = CapacityGuard(
            db, sample_cloudwatch=sample, now=lambda: clock[0], max_database_bytes=1000
        )
        self.assertEqual(guard(db)["free_storage_min_bytes"], DEFAULT_RESERVE + 10)
        clock[0] += 29
        guard()
        self.assertEqual((db.calls, len(calls)), (1, 1))
        clock[0] += 1
        guard()
        self.assertEqual((db.calls, len(calls)), (2, 2))
        self.assertEqual(calls[0], (NOW - 600, NOW))

    def test_cache_never_extends_metric_freshness_past_ten_minutes(self):
        clock = [NOW]
        calls = []

        def sample(*_):
            calls.append(1)
            return {"Datapoints": [point(NOW - 599, DEFAULT_RESERVE + 1)]}

        guard = CapacityGuard(
            DB(),
            sample_cloudwatch=sample,
            now=lambda: clock[0],
            max_database_bytes=1000,
        )
        self.assertEqual(guard()["status"], "ok")
        clock[0] += 2
        self.blocked(guard, "STORAGE_METRIC_STALE")
        self.assertEqual(len(calls), 2)

    def test_physical_threshold_and_stale_or_missing_metrics_fail_closed(self):
        for response, reason in [
            ({"Datapoints": [point(NOW - 1, DEFAULT_RESERVE - 1)]}, "PHYSICAL_RESERVE"),
            (
                {"Datapoints": [point(NOW - 601, DEFAULT_RESERVE + 1)]},
                "STORAGE_METRIC_STALE",
            ),
            ({"Datapoints": []}, "STORAGE_METRIC_STALE"),
            (
                {"Datapoints": [{"Timestamp": "broken", "Minimum": 1}]},
                "STORAGE_METRIC_STALE",
            ),
        ]:
            with self.subTest(reason=reason):
                db = DB()
                g = CapacityGuard(
                    db,
                    sample_cloudwatch=lambda *_: response,
                    now=lambda: NOW,
                    max_database_bytes=1000,
                )
                self.blocked(g, reason)
                self.blocked(g, reason)
                self.assertEqual(db.calls, 1)

    def test_database_threshold_and_target_identity_precede_cloudwatch(self):
        calls = []
        for db, reason in [
            (DB(size=1000), "DATABASE_LIMIT"),
            (DB(host="old.example"), "INVALID_TARGET"),
            (DB(name="statarena_prod"), "INVALID_TARGET"),
            (DB(host="127.0.0.1", name="statarena_prod"), "INVALID_TARGET"),
        ]:
            g = CapacityGuard(
                db,
                sample_cloudwatch=lambda *_: calls.append(1),
                now=lambda: NOW,
                max_database_bytes=1000,
            )
            self.blocked(g, reason)
        self.assertEqual(calls, [])

    def test_local_disposable_database_checks_size_without_aws(self):
        db = DB(host="127.0.0.1", name="vega_v2_capacity_test", size=999)
        g = CapacityGuard(
            db,
            sample_cloudwatch=lambda *_: self.fail("must not call cloudwatch"),
            now=lambda: NOW,
            max_database_bytes=1000,
        )
        self.assertEqual(g()["mode"], "local")

    def test_cloudwatch_failure_and_bad_env_fail_without_exposing_error(self):
        def fail(*_):
            raise RuntimeError("PRIVATE_SECRET_VALUE")

        g = CapacityGuard(
            DB(), sample_cloudwatch=fail, now=lambda: NOW, max_database_bytes=1000
        )
        self.blocked(g, "CAPACITY_CHECK_UNAVAILABLE")
        self.assertNotIn("PRIVATE_SECRET_VALUE", str(g.snapshot))
        with patch.dict(os.environ, {"V2_MAX_DATABASE_BYTES": "not-a-number"}):
            self.blocked(CapacityGuard(DB(), now=lambda: NOW), "INVALID_LIMITS")

    def test_other_connection_is_rejected_and_cached_block_can_recover(self):
        clock = [NOW]
        db = DB()
        sample = [{"Datapoints": []}]
        g = CapacityGuard(
            db,
            sample_cloudwatch=lambda *_: sample[0],
            now=lambda: clock[0],
            max_database_bytes=1000,
        )
        self.blocked(g, "STORAGE_METRIC_STALE")
        sample[0] = {"Datapoints": [point(NOW + 31, DEFAULT_RESERVE)]}
        clock[0] += 31
        self.assertEqual(g()["status"], "ok")
        with self.assertRaisesRegex(StoreError, "^V2_CAPACITY_LOW$"):
            g(DB())

    def test_aws_cli_exact_target_no_shell_and_profile_argument(self):
        captured = []

        def run(args, **kwargs):
            captured.append((args, kwargs))
            return SimpleNamespace(stdout=json.dumps({"Datapoints": []}).encode())

        with patch.dict(os.environ, {"V2_AWS_PROFILE": "vega-honours"}), patch(
            "subprocess.run", side_effect=run
        ):
            self.assertEqual(
                cloudwatch_free_storage(NOW - 600, NOW), {"Datapoints": []}
            )
        argv, opts = captured[0]
        self.assertIn("Name=DBInstanceIdentifier,Value=statarena-postgres", argv)
        self.assertIn("Minimum", argv)
        self.assertEqual(argv[argv.index("--period") + 1], "60")
        self.assertEqual(argv[argv.index("--profile") + 1], "vega-honours")
        self.assertNotIn("shell", opts)


if __name__ == "__main__":
    unittest.main()
