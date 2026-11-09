"""Isolated v2 logical-database bootstrap on the existing shared RDS instance.

Only the new database and new v2 role names are modified. No old database is
connected to, queried for application data, or granted/revoked privileges.
"""

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
import psycopg
from psycopg import sql

HOST = "statarena-postgres.clcy2iqyajbl.us-east-2.rds.amazonaws.com"
INSTANCE = "statarena-postgres"
DATABASE = "vega_v2"
ADMIN = "statarena_admin"
ROLES = ("vega_v2_owner", "vega_v2_ingest", "vega_v2_reader")


class SharedBootstrapError(Exception):
    pass


def read_config(env):
    if (
        env.get("V2_DB_HOST") != HOST
        or env.get("V2_DB_TARGET_INSTANCE") != INSTANCE
        or env.get("V2_DB_NAME") != DATABASE
        or env.get("AWS_REGION") != "us-east-2"
    ):
        raise SharedBootstrapError("INVALID_TARGET")
    ca = env.get("PGSSLROOTCERT", "")
    if not ca or not Path(ca).is_file():
        raise SharedBootstrapError("INVALID_CA")
    result = {}
    for variable, expected in (
        ("V2_MASTER_CREDENTIALS", ADMIN),
        ("V2_INGEST_CREDENTIALS", ROLES[1]),
        ("V2_READER_CREDENTIALS", ROLES[2]),
    ):
        try:
            value = json.loads(env.pop(variable, ""))
        except (ValueError, TypeError):
            raise SharedBootstrapError("INVALID_CREDENTIAL") from None
        if (
            not isinstance(value, dict)
            or value.get("username") != expected
            or not isinstance(value.get("password"), str)
            or not value["password"]
            or len(value["password"]) > 4096
            or "\x00" in value["password"]
        ):
            raise SharedBootstrapError("INVALID_CREDENTIAL")
        if variable == "V2_MASTER_CREDENTIALS" and (
            value.get("host", HOST) != HOST or int(value.get("port", 5432)) != 5432
        ):
            raise SharedBootstrapError("INVALID_TARGET")
        result[expected] = value["password"]
    return ca, result


def _verify_target_database(conn):
    """Accept only an empty target or the same checksummed v2-owned schema."""
    if conn.execute("SELECT current_database(),current_user").fetchone() != (
        DATABASE,
        ADMIN,
    ):
        raise SharedBootstrapError("UNEXPECTED_DB_IDENTITY")
    namespaces = conn.execute(
        "SELECT nspname,pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname IN ('core','agg','ops')"
    ).fetchall()
    journal = conn.execute(
        "SELECT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ops' AND c.relname='schema_migrations' AND c.relkind IN ('r','p'))"
    ).fetchone()[0]
    roles = conn.execute(
        "SELECT rolname FROM pg_roles WHERE rolname=ANY(%s)", (list(ROLES),)
    ).fetchall()
    if not journal:
        if namespaces or roles:
            raise SharedBootstrapError("UNMANAGED_TARGET_OR_ROLE_COLLISION")
        populated = conn.execute(
            "SELECT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r','p','v','m','S','f'))"
        ).fetchone()[0]
        if populated:
            raise SharedBootstrapError("UNMANAGED_TARGET_OR_ROLE_COLLISION")
        return
    if {name for name, owner in namespaces if owner == "vega_v2_owner"} != {
        "core",
        "agg",
        "ops",
    }:
        raise SharedBootstrapError("UNMANAGED_TARGET_OR_ROLE_COLLISION")
    if {name for (name,) in roles} != set(ROLES):
        raise SharedBootstrapError("UNMANAGED_TARGET_OR_ROLE_COLLISION")
    members = conn.execute(
        "SELECT parent.rolname,child.rolname,m.admin_option,m.inherit_option,m.set_option FROM pg_auth_members m JOIN pg_roles parent ON parent.oid=m.roleid JOIN pg_roles child ON child.oid=m.member WHERE parent.rolname=ANY(%s)",
        (list(ROLES),),
    ).fetchall()
    for parent, child, admin_option, inherit_option, set_option in members:
        normal_ingest = (
            (parent, child) == ("vega_v2_owner", "vega_v2_ingest")
            and not admin_option
            and inherit_option
            and set_option
        )
        # PostgreSQL 16+ grants a CREATEROLE creator ADMIN only; it has no
        # implicit inherit/set membership and must be preserved on retries.
        creator_admin = (
            parent in ROLES
            and child == ADMIN
            and admin_option
            and not inherit_option
            and not set_option
        )
        if not (normal_ingest or creator_admin):
            raise SharedBootstrapError("UNMANAGED_V2_ROLE_MEMBERSHIP")
    from vega_v2 import store

    paths = {
        p.name: hashlib.sha256(p.read_text(encoding="utf-8").encode()).digest()
        for p in (Path(store.__file__).resolve().parents[1] / "sql").glob("*.sql")
    }
    # Admin may have CREATEROLE without permanent access to v2 schemas. The
    # temporary owner membership is transaction-scoped and removed on success;
    # any failure rolls it back, preserving the existing admin role.
    with conn.transaction():
        conn.execute(
            sql.SQL("GRANT {} TO {}").format(
                sql.Identifier(ROLES[0]), sql.Identifier(ADMIN)
            )
        )
        conn.execute(sql.SQL("SET LOCAL ROLE {}").format(sql.Identifier(ROLES[0])))
        applied = conn.execute(
            "SELECT version,checksum FROM ops.schema_migrations"
        ).fetchall()
        if (
            not applied
            or "001_core.sql" not in {r[0] for r in applied}
            or any(
                name not in paths or bytes(digest) != paths[name]
                for name, digest in applied
            )
        ):
            raise SharedBootstrapError("MIGRATION_MISMATCH")
        conn.execute("RESET ROLE")
        conn.execute(
            sql.SQL("REVOKE {} FROM {}").format(
                sql.Identifier(ROLES[0]), sql.Identifier(ADMIN)
            )
        )


def provision_shared(admin_conn, target_connect, passwords):
    """Run CREATE DATABASE outside a transaction; target_connect opens only v2."""
    if not admin_conn.autocommit or admin_conn.execute(
        "SELECT current_database(),current_user"
    ).fetchone() != ("postgres", ADMIN):
        raise SharedBootstrapError("UNEXPECTED_ADMIN_IDENTITY")
    admin_conn.execute(
        "SELECT pg_advisory_lock(hashtextextended('vega_v2_shared_bootstrap',0))"
    )
    try:
        exists = admin_conn.execute(
            "SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=%s",
            (DATABASE,),
        ).fetchone()
        if exists and exists[0] != ADMIN:
            raise SharedBootstrapError("UNMANAGED_TARGET_OWNER")
        if not exists:
            collisions = admin_conn.execute(
                "SELECT rolname FROM pg_roles WHERE rolname=ANY(%s)", (list(ROLES),)
            ).fetchall()
            if collisions:
                raise SharedBootstrapError("V2_ROLE_NAME_COLLISION")
            available = {
                r[0]
                for r in admin_conn.execute(
                    "SELECT name FROM pg_available_extensions WHERE name IN ('vector','pg_trgm')"
                )
            }
            if available != {"vector", "pg_trgm"}:
                raise SharedBootstrapError("V2_EXTENSION_UNAVAILABLE")
            admin_conn.execute(
                sql.SQL("CREATE DATABASE {} OWNER {} TEMPLATE template0").format(
                    sql.Identifier(DATABASE), sql.Identifier(ADMIN)
                )
            )
        with target_connect() as target:
            _verify_target_database(target)
            # Load an isolated module instance; do not modify the dedicated draft.
            spec = importlib.util.spec_from_file_location(
                "vega_v2_shared_role_provision",
                Path(__file__).with_name("bootstrap.py"),
            )
            delegate = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(delegate)
            delegate.ROLE_ADMIN = ADMIN
            delegate.provision(target, passwords)
        return {"database": DATABASE, "created": not bool(exists)}
    finally:
        admin_conn.execute(
            "SELECT pg_advisory_unlock(hashtextextended('vega_v2_shared_bootstrap',0))"
        )


def main():
    passwords = None
    try:
        ca, passwords = read_config(os.environ)
        options = dict(
            host=HOST,
            port=5432,
            user=ADMIN,
            password=passwords[ADMIN],
            sslmode="verify-full",
            sslrootcert=ca,
            connect_timeout=10,
            autocommit=True,
        )
        with psycopg.connect(dbname="postgres", **options) as admin:
            result = provision_shared(
                admin, lambda: psycopg.connect(dbname=DATABASE, **options), passwords
            )
        print("V2_SHARED_BOOTSTRAP_OK created=" + str(result["created"]).lower())
        return 0
    except Exception:
        print("V2_SHARED_BOOTSTRAP_FAILED", file=sys.stderr)
        return 1
    finally:
        if passwords is not None:
            passwords.clear()


if __name__ == "__main__":
    raise SystemExit(main())
