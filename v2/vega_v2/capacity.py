"""Fail-closed, cached shared-RDS capacity checks for v2 job admission."""

from datetime import datetime, timedelta, timezone
import json
import math
import os
import re
import subprocess
import threading
import time

from .store import StoreError

RDS_HOST = "statarena-postgres.clcy2iqyajbl.us-east-2.rds.amazonaws.com"
RDS_INSTANCE = "statarena-postgres"
REGION = "us-east-2"
DEFAULT_RESERVE = 6 * 1024**3
DEFAULT_MAX_DATABASE = 1024**3


def _iso(seconds):
    return (
        datetime.fromtimestamp(seconds, timezone.utc).isoformat().replace("+00:00", "Z")
    )


def cloudwatch_free_storage(start, end):
    """Read one-minute minima from CloudWatch; no credentials or output are logged."""
    profile = os.environ.get("V2_AWS_PROFILE", "")
    if profile and not re.fullmatch(r"[A-Za-z0-9_.@-]{1,128}", profile):
        raise ValueError("INVALID_PROFILE")
    args = [
        "aws",
        "cloudwatch",
        "get-metric-statistics",
        "--namespace",
        "AWS/RDS",
        "--metric-name",
        "FreeStorageSpace",
        "--dimensions",
        "Name=DBInstanceIdentifier,Value=" + RDS_INSTANCE,
        "--start-time",
        _iso(start),
        "--end-time",
        _iso(end),
        "--period",
        "60",
        "--statistics",
        "Minimum",
        "--region",
        REGION,
        "--output",
        "json",
        "--no-cli-pager",
    ]
    if profile:
        args.extend(["--profile", profile])
    result = subprocess.run(args, check=True, capture_output=True, timeout=12)
    return json.loads(result.stdout)


class CapacityGuard:
    """Reusable callback; at most one measurement per cache window.

    Local disposable vega_v2_* databases check only their own size. The exact
    shared RDS host additionally requires a recent CloudWatch free-space series.
    """

    def __init__(
        self,
        conn,
        *,
        sample_cloudwatch=None,
        now=time.time,
        cache_seconds=30,
        reserve_bytes=DEFAULT_RESERVE,
        max_database_bytes=None
    ):
        self.conn = conn
        self.sample_cloudwatch = sample_cloudwatch or cloudwatch_free_storage
        self.now = now
        self.cache_seconds = cache_seconds
        self.reserve_bytes = reserve_bytes
        if max_database_bytes is None:
            try:
                max_database_bytes = int(
                    os.environ.get("V2_MAX_DATABASE_BYTES", str(DEFAULT_MAX_DATABASE))
                )
            except (ValueError, TypeError):
                max_database_bytes = 0
        self.max_database_bytes = max_database_bytes
        self._snapshot = None
        self._checked_at = None
        self._metric_at = None
        self._lock = threading.Lock()

    @property
    def snapshot(self):
        return dict(self._snapshot) if self._snapshot is not None else None

    def __call__(self, conn=None):
        return self.check(conn)

    def check(self, conn=None):
        with self._lock:
            if conn is not None and conn is not self.conn:
                self._snapshot = {"status": "blocked", "reason": "CONNECTION_MISMATCH"}
                self._checked_at = None
                raise StoreError("V2_CAPACITY_LOW")
            now = self.now()
            if (
                self._snapshot is not None
                and self._checked_at is not None
                and 0 <= now - self._checked_at < self.cache_seconds
            ):
                if self._snapshot["status"] != "ok":
                    raise StoreError("V2_CAPACITY_LOW")
                if self._snapshot.get("mode") != "shared_rds" or (
                    self._metric_at is not None and now - self._metric_at <= 600
                ):
                    return dict(self._snapshot)
            result = {"status": "blocked", "checked_at": _iso(now)}
            try:
                if (
                    not isinstance(self.cache_seconds, (int, float))
                    or self.cache_seconds <= 0
                    or not isinstance(self.reserve_bytes, int)
                    or self.reserve_bytes <= 0
                    or not isinstance(self.max_database_bytes, int)
                    or self.max_database_bytes <= 0
                ):
                    raise ValueError("INVALID_LIMITS")
                host = self.conn.info.host
                database, size = self.conn.execute(
                    "SELECT current_database(),pg_database_size(current_database())"
                ).fetchone()
                local = host in ("localhost", "127.0.0.1", "::1") and bool(
                    re.fullmatch(r"vega_v2_[a-z0-9_]+", database or "")
                )
                remote = host == RDS_HOST and database == "vega_v2"
                if not (local or remote):
                    raise ValueError("INVALID_TARGET")
                if not isinstance(size, int) or size < 0:
                    raise ValueError("INVALID_DATABASE_SIZE")
                result.update(
                    database_bytes=size,
                    max_database_bytes=self.max_database_bytes,
                    mode="local" if local else "shared_rds",
                )
                if size >= self.max_database_bytes:
                    raise ValueError("DATABASE_LIMIT")
                if remote:
                    response = self.sample_cloudwatch(now - 600, now)
                    points = []
                    for point in response.get("Datapoints", []):
                        try:
                            timestamp = datetime.fromisoformat(
                                point["Timestamp"].replace("Z", "+00:00")
                            )
                            if timestamp.tzinfo is None:
                                continue
                            ts = timestamp.timestamp()
                            value = point["Minimum"]
                            if (
                                isinstance(value, bool)
                                or not isinstance(value, (int, float))
                                or not math.isfinite(value)
                                or value < 0
                            ):
                                continue
                            if now - 600 <= ts <= now + 60:
                                points.append((ts, int(value)))
                        except (
                            KeyError,
                            ValueError,
                            TypeError,
                            AttributeError,
                            OverflowError,
                        ):
                            continue
                    if not points:
                        raise ValueError("STORAGE_METRIC_STALE")
                    latest = max(ts for ts, _ in points)
                    self._metric_at = latest
                    minimum = min(value for _, value in points)
                    result.update(
                        free_storage_min_bytes=minimum,
                        reserve_bytes=self.reserve_bytes,
                        storage_metric_latest_at=_iso(latest),
                        storage_metric_points=len(points),
                    )
                    if minimum < self.reserve_bytes:
                        raise ValueError("PHYSICAL_RESERVE")
                result["status"] = "ok"
            except Exception as error:
                # Never propagate subprocess output, DSNs, host details or SQL errors.
                allowed = {
                    "INVALID_LIMITS",
                    "INVALID_TARGET",
                    "INVALID_DATABASE_SIZE",
                    "DATABASE_LIMIT",
                    "STORAGE_METRIC_STALE",
                    "PHYSICAL_RESERVE",
                }
                result["reason"] = (
                    str(error)
                    if isinstance(error, ValueError) and str(error) in allowed
                    else "CAPACITY_CHECK_UNAVAILABLE"
                )
            self._checked_at = now
            self._snapshot = result
            if result["status"] != "ok":
                raise StoreError("V2_CAPACITY_LOW")
            return dict(result)
