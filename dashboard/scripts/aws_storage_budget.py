"""Logical SQL budget for Vega's existing 64 GiB AWS RDS deployment.

Keep sixteen GiB outside the logical database ceiling for WAL, temporary work,
filesystem overhead and operational headroom, then reserve another two GiB
inside the ceiling for publication growth. Explicit deployment variables win.
This is not a measurement of RDS FreeStorageSpace; that remains an AWS gate.
"""

import os

DEFAULT_SQL_LIMIT_BYTES = 48 * 1024**3
DEFAULT_SQL_RESERVE_BYTES = 2 * 1024**3


def sql_budget():
    limit = int(os.environ.get("STATARENA_SQL_LIMIT_BYTES") or DEFAULT_SQL_LIMIT_BYTES)
    reserve = int(os.environ.get("STATARENA_SQL_RESERVE_BYTES") or DEFAULT_SQL_RESERVE_BYTES)
    if limit <= 0 or reserve < 0 or reserve >= limit:
        raise ValueError("SQL capacity requires a positive ceiling and a smaller nonnegative reserve")
    return limit, reserve
