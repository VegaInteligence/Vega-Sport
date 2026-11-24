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


def ensure_logins(conn, env):
    done = []
    for role in LOGINS:
        password = env.get(f"V2_{role.upper()}_PASSWORD")
        if not password:
            continue
        login = f"vega_v2_{role}"
        with conn.transaction():
            exists = conn.execute("SELECT 1 FROM pg_roles WHERE rolname=%s", (login,)).fetchone()
            statement = "ALTER ROLE {} LOGIN PASSWORD {}" if exists else "CREATE ROLE {} LOGIN PASSWORD {}"
            conn.execute(sql.SQL(statement).format(sql.Identifier(login), sql.Literal(password)))
            conn.execute(sql.SQL("GRANT {} TO {}").format(sql.Identifier(f"vega_{role}"), sql.Identifier(login)))
            conn.execute(sql.SQL("ALTER ROLE {} CONNECTION LIMIT {}").format(sql.Identifier(login), sql.Literal(CONNECTION_LIMITS[role])))
        done.append(login)
    return done


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
