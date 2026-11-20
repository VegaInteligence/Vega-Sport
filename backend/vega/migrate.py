"""Apply the migrations as the schema owner, then create or update the login users.

Runs inside the VPC (ECS task vega-v2-migrate): the database is private. The owner
connection comes from V2_MIGRATION_DATABASE_URL, or from V2_DB_HOST, V2_DB_NAME,
V2_DB_USER and V2_DB_PASSWORD (the RDS-managed master secret). For each of
collect, calc and read, V2_<ROLE>_PASSWORD (SSM SecureString) sets the password of
the login vega_v2_<role>, member of the group role vega_<role> (017_roles.sql).
Nothing secret is printed.
"""

import os
import sys
from urllib.parse import quote

from psycopg import sql

from .store import migrate
from .worker import connect

LOGINS = ("collect", "calc", "read")
# A connection limit per login keeps the instance's connections for the others.
# read: the read API's function keeps one connection per copy, and a deploy leaves the old
# copies beside the new ones until the base closes their idle sessions: twice the copies
# (infra/aws/api.yaml, ReservedConcurrency: 32), plus a margin for a diagnostic session.
# backend/tests/test_api_capacity.py fails when the two numbers part. (12 until
# 20 November 2026, for an account that ran 10 functions at most: the account's limit
# became 1000, 19 copies ran and the base refused the thirteenth, 53300.)
READ_MARGIN = 4
CONNECTION_LIMITS = {"collect": 6, "calc": 4, "read": 2 * 32 + READ_MARGIN}


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
    with connect(url) as conn:
        present = conn.execute("SELECT to_regclass('ops.schema_migrations') IS NOT NULL").fetchone()[0]
        count = conn.execute("SELECT count(*) FROM ops.schema_migrations").fetchone()[0] if present else 0
        migrate(conn, vector=env.get("V2_VECTOR") == "1")
        after = conn.execute("SELECT count(*) FROM ops.schema_migrations").fetchone()[0]
        logins = ensure_logins(conn, env)
    print(f"migrations applied={after - count} total={after} logins={','.join(logins) or 'unchanged'}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
