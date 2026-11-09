"""One-shot, v2-only database bootstrap. Credentials are never printed."""
import json
import os
from pathlib import Path
import re
import sys

import psycopg
from psycopg import sql

TARGET_INSTANCE = 'vega-v2-postgres'
TARGET_DATABASE = 'vega_v2'
ROLE_OWNER = 'vega_v2_owner'
ROLE_INGEST = 'vega_v2_ingest'
ROLE_READER = 'vega_v2_reader'
ROLE_ADMIN = 'vega_v2_admin'

class BootstrapError(Exception):
    pass


def _credential(value, expected):
    try:
        data = json.loads(value)
        if not isinstance(data, dict) or data.get('username') != expected:
            raise ValueError()
        password = data.get('password')
        if not isinstance(password, str) or not password or len(password) > 4096 or '\x00' in password:
            raise ValueError()
        return password
    except (ValueError, TypeError):
        raise BootstrapError('INVALID_CREDENTIAL') from None


def read_config(env):
    host = env.get('V2_DB_HOST', '')
    if (env.get('V2_DB_TARGET_INSTANCE') != TARGET_INSTANCE or
        env.get('V2_DB_NAME') != TARGET_DATABASE or
        env.get('AWS_REGION') != 'us-east-2' or
        not re.fullmatch(r'vega-v2-postgres\.[a-z0-9]+\.us-east-2\.rds\.amazonaws\.com', host)):
        raise BootstrapError('INVALID_TARGET')
    ca = env.get('PGSSLROOTCERT', '')
    if not ca or not Path(ca).is_file():
        raise BootstrapError('INVALID_CA')
    passwords = {
        ROLE_ADMIN: _credential(env.pop('V2_MASTER_CREDENTIALS', ''), ROLE_ADMIN),
        ROLE_INGEST: _credential(env.pop('V2_INGEST_CREDENTIALS', ''), ROLE_INGEST),
        ROLE_READER: _credential(env.pop('V2_READER_CREDENTIALS', ''), ROLE_READER),
    }
    return host, ca, passwords


def provision(conn, passwords, *, migration=None):
    """Single transaction, bound to the caller-verified NEW v2 database and admin."""
    if migration is None:
        from vega_v2.store import migrate
        migration = lambda connection: migrate(connection, vector=True)
    with conn.transaction():
        actual = conn.execute('SELECT current_database(),current_user').fetchone()
        if actual != (TARGET_DATABASE, ROLE_ADMIN):
            raise BootstrapError('UNEXPECTED_DB_IDENTITY')
        conn.execute("SELECT pg_advisory_xact_lock(hashtextextended('vega_v2_bootstrap',0))")
        # Extension installation is performed under the RDS master, not the collector.
        conn.execute('CREATE EXTENSION IF NOT EXISTS pg_trgm')
        conn.execute('CREATE EXTENSION IF NOT EXISTS vector')
        for name, login in ((ROLE_OWNER, False), (ROLE_INGEST, True), (ROLE_READER, True)):
            memberships = conn.execute("SELECT parent.rolname FROM pg_auth_members m JOIN pg_roles child ON child.oid=m.member JOIN pg_roles parent ON parent.oid=m.roleid WHERE child.rolname=%s", (name,)).fetchall()
            allowed_memberships = {ROLE_OWNER} if name == ROLE_INGEST else set()
            if any(role not in allowed_memberships for (role,) in memberships):
                raise BootstrapError('UNSAFE_EXISTING_MEMBERSHIP')
            row = conn.execute('SELECT rolsuper,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=%s', (name,)).fetchone()
            if row and any(row):
                raise BootstrapError('UNSAFE_EXISTING_ROLE')
            if row is None:
                conn.execute(sql.SQL('CREATE ROLE {} {} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS').format(sql.Identifier(name), sql.SQL('LOGIN' if login else 'NOLOGIN')))
            if login:
                # Hash client-side: SQL/server logs must not receive the plaintext password.
                verifier = conn.pgconn.encrypt_password(passwords[name].encode('utf-8'), name.encode('utf-8'), b'scram-sha-256').decode('ascii')
                conn.execute(sql.SQL('ALTER ROLE {} LOGIN INHERIT PASSWORD {}').format(sql.Identifier(name), sql.Literal(verifier)))
                verifier = None
            else:
                conn.execute(sql.SQL('ALTER ROLE {} NOLOGIN').format(sql.Identifier(name)))
        conn.execute(sql.SQL('GRANT {} TO {}').format(sql.Identifier(ROLE_OWNER),sql.Identifier(ROLE_INGEST)))
        # The master needs SET ROLE to create the schema as its durable owner,
        # and membership to set defaults for future ingest-created partitions.
        for role in (ROLE_OWNER, ROLE_INGEST):
            conn.execute(sql.SQL('GRANT {} TO {}').format(sql.Identifier(role), sql.Identifier(ROLE_ADMIN)))
        conn.execute(sql.SQL('GRANT CREATE ON DATABASE {} TO {}').format(sql.Identifier(TARGET_DATABASE),sql.Identifier(ROLE_OWNER)))
        conn.execute(sql.SQL('SET LOCAL ROLE {}').format(sql.Identifier(ROLE_OWNER)))
        migration(conn)
        conn.execute('RESET ROLE')
        conn.execute(sql.SQL('REVOKE CREATE ON DATABASE {} FROM {}').format(sql.Identifier(TARGET_DATABASE),sql.Identifier(ROLE_OWNER)))
        conn.execute(sql.SQL('GRANT CONNECT ON DATABASE {} TO {},{}').format(sql.Identifier(TARGET_DATABASE),sql.Identifier(ROLE_INGEST),sql.Identifier(ROLE_READER)))
        conn.execute(sql.SQL('REVOKE ALL ON SCHEMA core,agg,ops FROM {}').format(sql.Identifier(ROLE_READER)))
        conn.execute(sql.SQL('GRANT USAGE ON SCHEMA core,agg,ops TO {}').format(sql.Identifier(ROLE_READER)))
        conn.execute(sql.SQL('REVOKE ALL ON ALL TABLES IN SCHEMA core,agg FROM {}').format(sql.Identifier(ROLE_READER)))
        conn.execute(sql.SQL('REVOKE ALL ON ALL SEQUENCES IN SCHEMA core,agg,ops FROM {}').format(sql.Identifier(ROLE_READER)))
        conn.execute(sql.SQL('GRANT SELECT ON ALL TABLES IN SCHEMA core,agg TO {}').format(sql.Identifier(ROLE_READER)))
        conn.execute(sql.SQL('REVOKE ALL ON ALL TABLES IN SCHEMA ops FROM {}').format(sql.Identifier(ROLE_READER)))
        conn.execute(sql.SQL('GRANT SELECT ON ops.resource_versions TO {}').format(sql.Identifier(ROLE_READER)))
        for creator in (ROLE_OWNER, ROLE_INGEST):
            conn.execute(sql.SQL('ALTER DEFAULT PRIVILEGES FOR ROLE {} IN SCHEMA core,agg GRANT SELECT ON TABLES TO {}').format(sql.Identifier(creator),sql.Identifier(ROLE_READER)))
        conn.execute(sql.SQL('ALTER ROLE {} SET default_transaction_read_only=on').format(sql.Identifier(ROLE_READER)))
        # These temporary administration memberships are not needed afterwards.
        for role in (ROLE_INGEST, ROLE_OWNER):
            conn.execute(sql.SQL('REVOKE {} FROM {}').format(sql.Identifier(role),sql.Identifier(ROLE_ADMIN)))


def main():
    passwords = None
    try:
        host, ca, passwords = read_config(os.environ)
        with psycopg.connect(host=host, port=5432, dbname=TARGET_DATABASE, user=ROLE_ADMIN,
                             password=passwords[ROLE_ADMIN], sslmode='verify-full', sslrootcert=ca,
                             connect_timeout=10, autocommit=True) as conn:
            provision(conn, passwords)
        print('V2_BOOTSTRAP_OK')
        return 0
    except Exception:
        # Database errors can include rejected SQL and credentials; never echo them.
        print('V2_BOOTSTRAP_FAILED', file=sys.stderr)
        return 1
    finally:
        if passwords is not None:
            passwords.clear()

if __name__ == '__main__':
    raise SystemExit(main())
