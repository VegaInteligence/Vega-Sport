"""A suite's base as `store.migrate` leaves a new one, cloned from a template instead of the migrations replayed.

  cls.db = fresh(DSN)                    # in setUpClass: in place of connect_local, DROP SCHEMA ... CASCADE and migrate
  type(self).db = fresh(DSN, self.db)    # in setUp, for a class that starts every test on a new base

The first call on a server migrates a template once (vega_v2_template_migrated_<key of backend/sql>, about 5 s); every
call then drops the suite's own database, sessions left on it included, and creates it again from the template
(CREATE DATABASE ... TEMPLATE: about 0.1 s against 4.8 s for the 189 files, PostgreSQL 16 on 28 Nov 2026), and returns
a new connection to it. The template lives as long as the files of backend/sql are the same: another key, another
template, and the older one is dropped. The role needs CREATEDB, as backend/ci/test_databases.py does.

Failure modes: backend/tests/test_template_base.py.
"""

import atexit
import hashlib
from pathlib import Path
import re
import sys
import time
from urllib.parse import urlparse

SQL = Path(__file__).resolve().parents[1] / "sql"
PREFIX = "vega_v2_template_"
# One builder at a time on a server, and no template dropped under a clone being made.
LOCK = "SELECT pg_advisory_lock(hashtextextended('vega_v2_template', 0))"
spent = {"built": 0.0, "clones": 0, "cloning": 0.0}


def migrations_key(directory=SQL):
    """The files `store.migrate` applies, by name and bytes: another key as soon as one is added, renamed or edited."""
    seen = hashlib.sha256()
    for path in sorted(p for p in Path(directory).glob("*.sql") if "vector_optional" not in p.name):
        seen.update(path.name.encode() + b"\0" + hashlib.sha256(path.read_bytes()).digest())
    return seen.hexdigest()[:16]


def clone(dsn, kind, key, build, previous=None):
    """A new connection to the database of `dsn`, dropped and created again from the template `build` filled.

    `build(connection)` runs once for a `kind` and a `key`, on an empty database that becomes the template only if it
    returns; the templates of the same kind under another key are dropped. `previous`, the caller's connection to the
    database, is closed first.
    """
    import psycopg
    from vega.store import StoreError, connect_local

    target = urlparse(dsn)
    name = target.path[1:]
    if (
        target.scheme not in ("postgres", "postgresql")
        or target.hostname not in ("127.0.0.1", "localhost", "::1")
        or not re.fullmatch(r"vega_v2_[a-z0-9_]+", name)
        or name.startswith(PREFIX)
        or target.query
    ):
        raise StoreError("LOCAL_V2_DATABASE_REQUIRED")
    if not re.fullmatch(r"[a-z]+", kind) or not re.fullmatch(r"[0-9a-f]{16}", key):
        raise ValueError("a template is named by a kind in lower-case letters and a key of 16 hexadecimal digits")
    template, building = f"{PREFIX}{kind}_{key}", f"{PREFIX}{kind}_building"
    if previous is not None:
        previous.close()
    started = time.monotonic()
    with psycopg.connect(target._replace(path="/postgres").geturl(), autocommit=True) as admin:
        admin.execute(LOCK)
        if not admin.execute("SELECT 1 FROM pg_database WHERE datname = %s", (template,)).fetchone():
            stale = admin.execute(
                "SELECT datname FROM pg_database WHERE starts_with(datname, %s)", (f"{PREFIX}{kind}_",)).fetchall()
            for (other,) in stale:
                admin.execute(f'DROP DATABASE IF EXISTS "{other}" WITH (FORCE)')
            admin.execute(f'CREATE DATABASE "{building}"')
            try:
                with connect_local(target._replace(path="/" + building).geturl()) as db:
                    build(db)
            except BaseException:
                admin.execute(f'DROP DATABASE IF EXISTS "{building}" WITH (FORCE)')
                raise
            admin.execute(f'ALTER DATABASE "{building}" RENAME TO "{template}"')
            spent["built"] += time.monotonic() - started
            started = time.monotonic()
        admin.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
        admin.execute(f'CREATE DATABASE "{name}" TEMPLATE "{template}"')
    spent["clones"] += 1
    spent["cloning"] += time.monotonic() - started
    return connect_local(dsn)


def fresh(dsn, previous=None):
    """A new connection to the suite's database as `store.migrate` leaves a new one (every file but the optional one)."""
    from vega.store import migrate

    return clone(dsn, "migrated", migrations_key(), migrate, previous)


@atexit.register
def report():
    if spent["clones"]:
        built = f", template built in {spent['built']:.1f} s" if spent["built"] else ""
        print(f"template_base: {spent['clones']} bases cloned in {spent['cloning']:.1f} s{built}", file=sys.stderr)
