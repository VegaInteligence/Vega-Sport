"""Adapters of the sources other than PitchAPI: call -> validate -> match -> write.

Each adapter exposes SCOPES (scope -> period) and run(conn, get, scope, now) returning
(rows_written, unmatched). `due` and `run_due` schedule them from ops.source_runs;
the worker calls run_due once a day. Responses are processed in memory, never stored.
"""

from datetime import datetime, timedelta, timezone
import re
import unicodedata

import psycopg

from ..store import StoreError


def normalize(name):
    """Comparison form of a name: ASCII, lower case, letters and digits only."""
    folded = unicodedata.normalize("NFKD", name or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]", "", folded)


def adapters():
    from . import cups, curated, fifa, honours, open_matchday, sportsapi, sportscore, uefa, wikidata

    # Keys are core.provider values (ops.source_runs.source). Curated names first: the
    # UEFA links read the reviewed aliases.
    return {"vega": curated, "uefa": uefa, "fifa": fifa, "sportsapi": sportsapi, "sportscore": sportscore, "wikidata": wikidata, "wikimedia": honours,
            # Cup editions: one adapter per source provider of ops.source_runs.
            "openfootball": cups.For("open-cups"), "openligadb": cups.For("openligadb"),
            "international_results": cups.For("nations-results"), "open_matchday": open_matchday}


def due(conn, now, adapter_name, adapter):
    rows = dict(
        conn.execute(
            "SELECT scope, last_success_at FROM ops.source_runs WHERE source=%s", (adapter_name,)
        ).fetchall()
    )
    return [scope for scope, period in adapter.scopes(now).items() if rows.get(scope) is None or rows[scope] <= now - period]


def run_due(conn, get, now=None, *, names=None):
    """Run every adapter scope whose period has elapsed; one failure never stops the others."""
    instant = now or datetime.now(timezone.utc)
    results = {}
    for name, adapter in adapters().items():
        if names and name not in names:
            continue
        for scope in due(conn, instant, name, adapter):
            code, written, unmatched = None, 0, 0
            try:
                with conn.transaction():
                    written, unmatched = adapter.run(conn, get, scope, instant)
            except (SourceError, StoreError, ValueError, KeyError, TypeError, psycopg.Error) as error:
                # The scope's writes are rolled back; the other scopes still run.
                code = (
                    error.code if isinstance(error, SourceError)
                    else "DATABASE_ERROR" if isinstance(error, psycopg.Error)
                    else "INVALID_SOURCE_RESPONSE"
                )
            try:
                record_run(conn, name, scope, instant, code, written, unmatched)
            except psycopg.Error:
                # A status that cannot be written must not stop the other scopes.
                code = code or "STATUS_NOT_RECORDED"
            results[(name, scope)] = code or "ok"
    return results


def record_run(conn, name, scope, instant, code, written, unmatched):
    with conn.transaction():
        conn.execute(
            """INSERT INTO ops.source_runs(source, scope, last_attempt_at, last_success_at, status, error_code, rows_written, unmatched, updated_at)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,now())
               ON CONFLICT (source, scope) DO UPDATE SET last_attempt_at=EXCLUDED.last_attempt_at,
                 last_success_at=coalesce(EXCLUDED.last_success_at, ops.source_runs.last_success_at),
                 status=EXCLUDED.status, error_code=EXCLUDED.error_code, rows_written=EXCLUDED.rows_written,
                 unmatched=EXCLUDED.unmatched, updated_at=now()""",
            (name, scope, instant, None if code else instant, "error" if code else "ok", code, written, unmatched),
        )


class SourceError(RuntimeError):
    def __init__(self, code):
        super().__init__(code)
        self.code = code
