"""V2 logical database on the existing RDS instance; legacy URLs stay unused."""

import os
from pathlib import Path
import re

import psycopg
from .store import StoreError, connect_local

ACCOUNT_REGION = "us-east-2"
INSTANCE = "statarena-postgres"
HOST = "statarena-postgres.clcy2iqyajbl.us-east-2.rds.amazonaws.com"
DATABASE = "vega_v2"
USERS = ("vega_v2_ingest", "vega_v2_reader")


def connect_database(dsn=None):
    local_dsn = dsn or os.environ.get("V2_DATABASE_URL")
    if local_dsn:
        # An explicit URL remains restricted to the tested disposable local DBs.
        return connect_local(local_dsn)
    host = os.environ.get("V2_DB_HOST", "")
    database = os.environ.get("V2_DB_NAME", "")
    user = os.environ.get("V2_DB_USER", "")
    instance = os.environ.get("V2_DB_TARGET_INSTANCE", "")
    region = os.environ.get("AWS_REGION", "")
    password = os.environ.get("V2_DB_PASSWORD", "")
    certificate = Path(os.environ.get("PGSSLROOTCERT", "/app/v2/certs/rds-ca.pem"))
    if (
        instance != INSTANCE
        or region != ACCOUNT_REGION
        or host != HOST
        or database != DATABASE
        or user not in USERS
        or not password
        or not certificate.is_file()
    ):
        raise StoreError("DEDICATED_V2_DATABASE_REQUIRED")
    conn = psycopg.connect(
        host=host,
        port=5432,
        dbname=database,
        user=user,
        password=password,
        sslmode="verify-full",
        sslrootcert=str(certificate),
        connect_timeout=10,
        autocommit=True,
        application_name="vega-v2-" + user.removeprefix("vega_v2_"),
        options="-c statement_timeout=60000 -c idle_in_transaction_session_timeout=60000",
    )
    if conn.execute("SELECT current_database(),current_user").fetchone() != (
        database,
        user,
    ):
        conn.close()
        raise StoreError("V2_DATABASE_IDENTITY_MISMATCH")
    return conn
