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
    from . import cups, curated, fifa, honours, odds, open_matchday, sportscore, uefa, wikidata

    # Keys are core.provider values (ops.source_runs.source). Curated names first: the
    # UEFA links read the reviewed aliases.
    return {"vega": curated, "uefa": uefa, "fifa": fifa, "sportscore": sportscore, "wikidata": wikidata, "wikimedia": honours,
            # Cup editions: one adapter per source provider of ops.source_runs.
            "openfootball": cups.For("open-cups"), "openligadb": cups.For("openligadb"),
            "international_results": cups.For("nations-results"), "open_matchday": open_matchday,
            # Bookmakers' odds of the coming matches (needs V2_ODDS_API_KEY).
            "oddsapi": odds}


# A failed scope is tried again after this delay (or its period, if shorter), not at every round.
RETRY_AFTER = timedelta(hours=1)
# A scope waits this long, at most, for rows another transaction holds, then fails and
# retries at RETRY_AFTER: the sources run first in the daily pass, before the rankings and
# the models, which a scope waiting on another writer would hold up as long as that writer
# (on 14 November 2026 a merge of teams held them for five hours).
LOCK_WAIT = "30s"


def due(conn, now, adapter_name, adapter):
    rows = {
        scope: (success, attempt)
        for scope, success, attempt in conn.execute(
            "SELECT scope, last_success_at, last_attempt_at FROM ops.source_runs WHERE source=%s", (adapter_name,)
        ).fetchall()
    }

    def is_due(scope, period):
        success, attempt = rows.get(scope, (None, None))
        if success is not None and success > now - period:
            return False
        return attempt is None or attempt <= now - min(period, RETRY_AFTER)

    return [scope for scope, period in adapter.scopes(now).items() if is_due(scope, period)]


def run_due(conn, get, now=None, *, names=None):
    """Run every adapter scope whose period has elapsed; one failure never stops the others."""
    instant = now or datetime.now(timezone.utc)
    results = {}
    for name, adapter in adapters().items():
        if names and name not in names:
            continue
        for scope in due(conn, instant, name, adapter):
            code, detail, written, unmatched = None, None, 0, 0
            try:
                with conn.transaction():
                    conn.execute(f"SET LOCAL lock_timeout = '{LOCK_WAIT}'")
                    written, unmatched = adapter.run(conn, get, scope, instant)
            except (SourceError, StoreError, ValueError, KeyError, TypeError, psycopg.Error) as error:
                # The scope's writes are rolled back; the other scopes still run.
                code = (
                    error.code if isinstance(error, SourceError)
                    else "DATABASE_ERROR" if isinstance(error, psycopg.Error)
                    else "INVALID_SOURCE_RESPONSE"
                )
                detail = error.detail if isinstance(error, SourceError) else None
            try:
                record_run(conn, name, scope, instant, code, written, unmatched, detail)
            except psycopg.Error:
                # A status that cannot be written must not stop the other scopes.
                code = code or "STATUS_NOT_RECORDED"
            results[(name, scope)] = code or "ok"
    return results


def record_run(conn, name, scope, instant, code, written, unmatched, detail=None):
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
        if code and detail:
            # What a refused snapshot would have changed (snapshot.py): the scope's status says that it
            # failed, this says which matches.
            failure(conn, code, f"{name}:{scope}: {detail}")


def failure(conn, code, message, edition=None):
    """One ops.parse_failures row: a source response that was not written (its code and why)."""
    conn.execute("INSERT INTO ops.parse_failures(competition_season_id, error_code, message, at) VALUES (%s,%s,%s,now())",
                 (edition, code, message[:2000]))


class SourceError(RuntimeError):
    """A source answer that is not written; `detail` (optional) names what it would have changed."""

    def __init__(self, code, detail=None):
        super().__init__(code)
        self.code = code
        self.detail = detail
