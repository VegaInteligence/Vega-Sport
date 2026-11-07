"""Bounded publisher stage timings without SQL, values, or exception payloads.

The trace is process-local instrumentation, never a database transaction or
checkpoint. A failed database transaction cannot roll it back. Its intervals
measure Python publication stages, including any transport and rollback time;
they are not server-only SQL execution times.
"""

from contextvars import ContextVar
import re
import time


STAGES = frozenset({
    "partition_start", "source_scope", "previous_partition", "source_profile",
    "source_spool", "detail_prepare", "detail_fallback", "detail_write",
    "core_prepare", "core_snapshot", "core_match_write", "core_fixture_write",
    "core_catalog_write", "core_metadata_write", "rollup_refresh",
    "publication_generation", "partition_calendar", "partition_receipts",
    "capacity_check", "transaction_commit",
})
_CURRENT = ContextVar("vega_publication_trace", default=None)
_CANCELLATIONS = {
    "canceling statement due to statement timeout": "statement_timeout",
    "canceling statement due to user request": "user_cancel",
}
_ROLLUP_FRAME = re.compile(
    r"(?m)^PL/pgSQL function (?:statarena_app\.)?"
    r"refresh_player_season_rollups\(text,text,boolean\) line ([0-9]{1,6}) at SQL statement$"
)


def mark_stage(name):
    """Advance only a fixed code-defined stage; callers pass no source values."""
    if name not in STAGES:
        raise ValueError("Unknown publication diagnostic stage")
    trace = _CURRENT.get()
    if trace is not None:
        trace.mark(name)


class PublicationTrace:
    def __init__(self, clock=None):
        self.clock = clock or time.monotonic
        self.stage = "partition_start"
        self.started = self.clock()
        self.elapsed = {}
        self.stopped = None

    def __enter__(self):
        self.token = _CURRENT.set(self)
        return self

    def __exit__(self, *_):
        self.stopped = self.clock()
        _CURRENT.reset(self.token)

    def mark(self, name):
        if name not in STAGES:
            raise ValueError("Unknown publication diagnostic stage")
        now = self.clock()
        self.elapsed[self.stage] = self.elapsed.get(self.stage, 0) + max(0, now - self.started)
        self.stage, self.started = name, now

    def timings(self):
        now = self.stopped if self.stopped is not None else self.clock()
        result = dict(self.elapsed)
        result[self.stage] = result.get(self.stage, 0) + max(0, now - self.started)
        return {name: round(seconds, 3) for name, seconds in result.items()}

    def failure(self, error):
        now = self.stopped if self.stopped is not None else self.clock()
        result = {
            "failure_stage": self.stage,
            "stage_seconds": round(max(0, now - self.started), 3),
            "stage_timings": self.timings(),
        }
        # Error text often contains SQL literals and source documents. Classify
        # only exact server messages and one known function's numeric frame.
        diag = getattr(error, "diag", None)
        if getattr(error, "sqlstate", None) == "57014":
            message = getattr(diag, "message_primary", None)
            result["cancellation"] = _CANCELLATIONS.get(message, "unclassified") if isinstance(message, str) else "unclassified"
        context = getattr(diag, "context", None)
        frame = _ROLLUP_FRAME.search(context[:65536]) if isinstance(context, str) else None
        if frame:
            result["sql_function"] = "refresh_player_season_rollups"
            result["sql_function_line"] = int(frame.group(1))
        return result
