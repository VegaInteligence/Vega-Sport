"""The loader's one connection (backend/panna/FAILURE_MODES.md, sections 4 and 6): a PostgreSQL URL, optionally
through a local port forward (`--via HOST:PORT`, TLS still verifying the database's own name), the run's advisory lock
on it, and every write as an idempotent unit retried on a fresh connection when the link is lost."""

from pathlib import Path
import time
from urllib.parse import parse_qs, urlparse

import psycopg

LOCK = "vega-panna-loader"
RDS_CA = Path(__file__).resolve().parents[1] / "certs" / "rds-us-east-2.pem"
# Reopening after a lost link: a delay that doubles to 10 s, about 90 s in all, long enough for the server to end the
# old session (its keepalives and connection checks below) and so release the run's lock (GH278-au).
ATTEMPTS = 12


class AlreadyRunning(Exception):
    pass


class LockBusy(Exception):
    """The run's lock is still held, by this run's old session or by another runner: wait, then try again."""


class LinkLost(Exception):
    """The connection could not be opened again: the run stops PARTIAL and `retry` resumes it."""


def connect_kwargs(url, via=None):
    params = parse_qs(urlparse(url).query)
    # TCP keepalives on the loader's side: a link that died without a word is found within a minute.
    kwargs = {"application_name": "vega-panna", "connect_timeout": 20,
              "keepalives": 1, "keepalives_idle": 30, "keepalives_interval": 10, "keepalives_count": 3}
    if params.get("sslmode", [""])[0] in ("verify-full", "verify-ca") and "sslrootcert" not in params and RDS_CA.is_file():
        kwargs["sslrootcert"] = str(RDS_CA)
    if via:
        host, _, port = via.rpartition(":")
        kwargs.update(hostaddr=host or "127.0.0.1", port=int(port))
    return kwargs


class Session:
    """One connection holding the run's lock. `unit(fn)` runs fn(conn) in a transaction; a lost link is opened again
    (the lock taken again) and fn run again, so fn must find what an earlier try committed."""

    def __init__(self, url, via=None, out=None, lock=True, attempts=ATTEMPTS):
        self.url, self.via, self.out, self.locking, self.attempts = url, via, out, lock, attempts
        self.conn = None
        self.reconnects = 0
        self.open(first=True)

    def open(self, first=False):
        conn = psycopg.connect(self.url, autocommit=True, **connect_kwargs(self.url, self.via))
        conn.execute("SET TimeZone = 'UTC'")
        conn.execute("SET statement_timeout = '30min'")
        # The server's side of a dead link: its keepalives, and a check of the client during a long statement, end the
        # session within about a minute, which releases its lock for the reopened one.
        for name, value in (("tcp_keepalives_idle", "30"), ("tcp_keepalives_interval", "10"), ("tcp_keepalives_count", "3"),
                            ("client_connection_check_interval", "10s")):
            conn.execute("SELECT pg_catalog.set_config(%s, %s, false)", (name, value))
        # Commits wait for their WAL flush (the server's default, set here whatever the role or base says): a chunk
        # the loader saw committed survives a crash-restart (GH278-as).
        conn.execute("SET synchronous_commit = on")
        if self.locking and not conn.execute("SELECT pg_try_advisory_lock(hashtext(%s))", (LOCK,)).fetchone()[0]:
            conn.close()
            if first:
                raise AlreadyRunning()
            raise LockBusy()
        self.conn = conn

    def setting(self, name):
        return self.read(lambda c: c.execute("SELECT pg_catalog.current_setting(%s)", (name,)).fetchone()[0])

    def reopen(self):
        delay = 0.5
        busy = False
        for attempt in range(1, self.attempts + 1):
            try:
                if self.conn is not None:
                    self.conn.close()
            except psycopg.Error:
                pass
            self.conn = None
            try:
                self.open()
                self.reconnects += 1
                if self.out:
                    self.out.emit("reconnect", attempt=attempt, waited_for_lock=busy)
                return
            except LockBusy:
                busy = True
            except psycopg.OperationalError:
                pass
            time.sleep(delay)
            delay = min(delay * 2, 10)
        raise LinkLost("LOCK_LOST" if busy else "CONNECTION_LOST")

    def unit(self, fn):
        while True:
            try:
                with self.conn.transaction():
                    return fn(self.conn)
            except psycopg.OperationalError:
                if not self.broken():
                    raise
                self.reopen()

    def read(self, fn):
        while True:
            try:
                return fn(self.conn)
            except psycopg.OperationalError:
                if not self.broken():
                    raise
                self.reopen()

    def broken(self):
        return self.conn is None or self.conn.closed or self.conn.broken

    def close(self):
        if self.conn is not None:
            try:
                self.conn.close()
            except psycopg.Error:
                pass
