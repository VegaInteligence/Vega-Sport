"""Apply the migrations as the schema owner, then create or update the login users.

Runs inside the VPC (ECS task vega-v2-migrate): the database is private. The owner
connection comes from V2_MIGRATION_DATABASE_URL, or from V2_DB_HOST, V2_DB_NAME,
V2_DB_USER and V2_DB_PASSWORD (the RDS-managed master secret). For each of
collect, calc, read and account, V2_<ROLE>_PASSWORD (SSM SecureString) sets the password
of the login vega_v2_<role>, member of the group role vega_<role> (017_roles.sql;
backend/account/sql/001_accounts.sql for vega_account).

The account's files (backend/account/sql, account/sql in the image) run only when
V2_ACCOUNT_PASSWORD is set: after the football migrations, before the logins (the login
joins the group 001 creates), with their own record (backend/account/FAILURE_MODES.md
M1 to M9). The football suites, which drop and rebuild core, agg, ops and api at will,
never set it. Nothing secret is printed.
"""

import hashlib
import os
from pathlib import Path
import re
import sys
from urllib.parse import quote

import psycopg
from psycopg import sql

from .store import migrate
from .worker import connect

LOGINS = ("collect", "calc", "read", "account")
# A connection limit per login keeps the instance's connections for the others.
# read: the read API's function keeps one connection per copy, and a deploy leaves the old
# copies beside the new ones until the base closes their idle sessions: twice the copies
# (infra/aws/api.yaml, ReservedConcurrency: 32), plus a margin for a diagnostic session.
# backend/tests/test_api_capacity.py fails when the two numbers part. (12 until
# 20 November 2026, for an account that ran 10 functions at most: the account's limit
# became 1000, 19 copies ran and the base refused the thirteenth, 53300.)
READ_MARGIN = 4
# account: the account store keeps one connection per copy, 8 copies (infra/aws/account.yaml,
# ReservedConcurrentExecutions), twice for a deploy, plus a diagnostic session
# (backend/tests/test_account_capacity.py).
ACCOUNT_MARGIN = 2
CONNECTION_LIMITS = {"collect": 6, "calc": 4, "read": 2 * 32 + READ_MARGIN, "account": 2 * 8 + ACCOUNT_MARGIN}
ACCOUNT_SQL = Path(__file__).resolve().parents[1] / "account" / "sql"
ACCOUNT_LOCK = "SELECT pg_advisory_xact_lock(hashtext('vega-account-migrations'))"


class AccountMigrationError(RuntimeError):
    pass


def account_files(directory=ACCOUNT_SQL):
    files = sorted(p for p in Path(directory).glob("*.sql") if re.fullmatch(r"\d{3}_[a-z0-9_]+\.sql", p.name))
    if not files:
        raise AccountMigrationError(f"ACCOUNT_SQL_MISSING no NNN_name.sql file in {directory}")
    return files


def migrate_account(conn, directory=ACCOUNT_SQL):
    """Apply the account's files in the order of their names, each once, in its own transaction with its record.

    The record is account_admin.applied, owned by the owner and granted to no one. A recorded file whose bytes
    changed stops the run. Returns (the names applied now, the number recorded).
    """
    files = account_files(directory)
    with conn.transaction():
        conn.execute(ACCOUNT_LOCK)
        conn.execute("CREATE SCHEMA IF NOT EXISTS account_admin")
        conn.execute("REVOKE ALL ON SCHEMA account_admin FROM PUBLIC")
        conn.execute(
            """CREATE TABLE IF NOT EXISTS account_admin.applied (
                 name text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())"""
        )
    applied = []
    for path in files:
        source = path.read_bytes()
        sha = hashlib.sha256(source).hexdigest()
        with conn.transaction():
            conn.execute(ACCOUNT_LOCK)
            row = conn.execute("SELECT sha256 FROM account_admin.applied WHERE name = %s", (path.name,)).fetchone()
            if row:
                if row[0] != sha:
                    raise AccountMigrationError(f"ACCOUNT_SQL_CHANGED {path.name}: applied with sha256 {row[0]}, the file is {sha}")
                continue
            conn.execute(source.decode("utf-8"))
            conn.execute("INSERT INTO account_admin.applied (name, sha256) VALUES (%s, %s)", (path.name, sha))
        applied.append(path.name)
    total = conn.execute("SELECT count(*) FROM account_admin.applied").fetchone()[0]
    return applied, total


def owner_url(env):
    if env.get("V2_MIGRATION_DATABASE_URL"):
        return env["V2_MIGRATION_DATABASE_URL"]
    parts = [env.get(k) for k in ("V2_DB_HOST", "V2_DB_NAME", "V2_DB_USER", "V2_DB_PASSWORD")]
    if not all(parts):
        return None
    host, name, user, password = parts
    root = env.get("V2_DB_CA", "/app/rds-ca.pem")
    return f"postgresql://{quote(user, safe='')}:{quote(password, safe='')}@{host}:5432/{name}?sslmode=verify-full&sslrootcert={quote(root)}"


# A login's verifier is as sensitive as its password (an MD5 one logs in by itself, a SCRAM one opens an offline
# search): it is never recorded nor logged, and nothing is cleaned afterwards (a rollback, a cancel or a client gone
# would leave the cleaning undone). Before anything is sent, the rotation's transaction must hold the settings that
# keep a nested statement's text out of the server's log and statistics; the role sets them when it may (a superuser:
# CI's, a local server), else they must already be in effect (RDS: the group's values, database.yaml); otherwise the
# rotation refuses (FAILURE_MODES_OPTIMISATIONS.md GH171.1, Logins; GH171-l to n).
class LoginsRefused(RuntimeError):
    pass


def secure(conn):
    """Sets, for the transaction, the settings the role may set, then checks the effective ones; raises LoginsRefused
    naming each unsafe setting, before any verifier is sent."""
    def setting(name):
        return conn.execute("SELECT pg_catalog.current_setting(%s, true)", (name,)).fetchone()[0]

    def holds(name, value):
        if setting(name) != value:
            try:
                with conn.transaction():  # a savepoint: a refused setting leaves the transaction usable
                    conn.execute("SELECT pg_catalog.set_config(%s, %s, true)", (name, value))
            except psycopg.errors.InsufficientPrivilege:
                pass
        return setting(name) == value

    unsafe = []
    # No CONTEXT line: an error, a cancel, a termination or a lock wait during the nested statement would print it.
    if not holds("log_error_verbosity", "terse"):
        unsafe.append(f"log_error_verbosity is {setting('log_error_verbosity')}")
    # pg_stat_statements records a nested utility statement only with track all and track_utility on.
    if setting("pg_stat_statements.track") == "all" and not holds("pg_stat_statements.track_utility", "off"):
        unsafe.append("pg_stat_statements.track_utility is on with pg_stat_statements.track all")
    for name in ("debug_print_parse", "debug_print_rewritten", "debug_print_plan"):
        if not holds(name, "off"):
            unsafe.append(f"{name} is on")
    if unsafe:
        raise LoginsRefused("LOGINS_REFUSED the logins' passwords are not set, nothing was sent: this server would keep "
                            f"their statements' text ({'; '.join(unsafe)}). Its group must hold database.yaml's values "
                            "(log_error_verbosity terse, pg_stat_statements.track_utility off), or the role be one that "
                            "may set them for its transaction.")


# The verifiers reach the server as COPY data (in no statement's text and in no bound value); this block, whose text
# holds no secret, sets the passwords with nested statements. A failure, a cancel or a statement timeout (which WHEN
# OTHERS does not catch) is raised again without the nested statement.
SET_LOGINS = """
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT login, verifier FROM pg_temp.vega_login_verifiers ORDER BY login LOOP
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = r.login) THEN
        EXECUTE format('ALTER ROLE %I LOGIN PASSWORD %L', r.login, r.verifier);
      ELSE
        EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L', r.login, r.verifier);
      END IF;
    EXCEPTION
      WHEN query_canceled THEN
        RAISE EXCEPTION 'the password of % could not be set (%)', r.login, SQLSTATE USING ERRCODE = SQLSTATE;
      WHEN OTHERS THEN
        RAISE EXCEPTION 'the password of % could not be set (%)', r.login, SQLSTATE USING ERRCODE = SQLSTATE;
    END;
  END LOOP;
END
$$"""


def ensure_logins(conn, env):
    """Sets each login's password from the environment, all in one transaction: a verifier computed by libpq for the
    server's password_encryption (the server stores the same one it would have computed), never the password."""
    algorithm = conn.execute("SHOW password_encryption").fetchone()[0].encode()
    rows = []
    for role in LOGINS:
        password = env.get(f"V2_{role.upper()}_PASSWORD")
        if password:
            login = f"vega_v2_{role}"
            rows.append((role, login, conn.pgconn.encrypt_password(password.encode(), login.encode(), algorithm).decode()))
    if not rows:
        return []
    deadlock_ms = int(conn.execute("SELECT setting FROM pg_catalog.pg_settings WHERE name = 'deadlock_timeout'").fetchone()[0])
    with conn.transaction():
        secure(conn)
        # A wait on another session's lock ends before it would be logged (deadlock_timeout), as a failure (55P03).
        conn.execute(sql.SQL("SET LOCAL lock_timeout = {}").format(sql.Literal(f"{max(10, deadlock_ms // 2)}ms")))
        conn.execute("CREATE TEMPORARY TABLE vega_login_verifiers (login text PRIMARY KEY, verifier text NOT NULL) ON COMMIT DROP")
        with conn.cursor().copy("COPY pg_temp.vega_login_verifiers (login, verifier) FROM STDIN") as copy:
            for _, login, verifier in rows:
                copy.write_row((login, verifier))
        conn.execute(SET_LOGINS)
        for role, login, _ in rows:
            conn.execute(sql.SQL("GRANT {} TO {}").format(sql.Identifier(f"vega_{role}"), sql.Identifier(login)))
            conn.execute(sql.SQL("ALTER ROLE {} CONNECTION LIMIT {}").format(sql.Identifier(login), sql.Literal(CONNECTION_LIMITS[role])))
    return [login for _, login, _ in rows]


def main(env=os.environ):
    url = owner_url(env)
    if not url:
        print("V2_MIGRATION_DATABASE_URL or V2_DB_HOST/NAME/USER/PASSWORD is required", file=sys.stderr)
        return 2
    account = bool(env.get("V2_ACCOUNT_PASSWORD"))
    if account:
        account_files()  # before anything changes: an image without the account's files stops here
    with connect(url) as conn:
        present = conn.execute("SELECT to_regclass('ops.schema_migrations') IS NOT NULL").fetchone()[0]
        count = conn.execute("SELECT count(*) FROM ops.schema_migrations").fetchone()[0] if present else 0
        migrate(conn, vector=env.get("V2_VECTOR") == "1")
        after = conn.execute("SELECT count(*) FROM ops.schema_migrations").fetchone()[0]
        line = f"migrations applied={after - count} total={after}"
        if account:
            done, total = migrate_account(conn)
            line += f" account applied={len(done)} total={total}"
        logins = ensure_logins(conn, env)
    print(f"{line} logins={','.join(logins) or 'unchanged'}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
