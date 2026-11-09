"""Operator for the v2 logical DB on the unchanged, existing RDS instance."""

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import tempfile
import urllib.request

import psycopg

ACCOUNT = "361769570630"
REGION = "us-east-2"
INSTANCE = "statarena-postgres"
HOST = "statarena-postgres.clcy2iqyajbl.us-east-2.rds.amazonaws.com"
GROUP = "sg-0667c20e8ff5d2431"
DATABASE = "vega_v2"
ADMIN = "statarena_admin"
HERE = Path(__file__).resolve().parent


class OperatorError(RuntimeError):
    pass


def aws(*args, body=None, absent=None):
    command = ["aws", "--region", REGION, "--output", "json", "--no-cli-pager"]
    profile = os.environ.get("V2_AWS_PROFILE")
    if profile:
        command += ["--profile", profile]
    command += list(args)
    if body is not None:
        # AWS CLI file input is supported by the operator environment; stdin
        # parameter-file handling is not. This private file contains configuration
        # only, is never logged, and is removed immediately after the CLI exits.
        with tempfile.TemporaryDirectory(
            prefix="vega-v2-aws-", dir="/tmp"
        ) as directory:
            path = Path(directory) / "request.json"
            path.write_text(json.dumps(body), encoding="utf-8")
            path.chmod(0o600)
            result = subprocess.run(
                command + ["--cli-input-json", "file://" + str(path)],
                capture_output=True,
                text=True,
            )
    else:
        result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode:
        match = re.search(r"\(([A-Za-z0-9_.-]+)\) when calling", result.stderr)
        code = (
            match.group(1)
            if match
            else next(
                (
                    label
                    for marker, label in (
                        ("Error parsing parameter", "CLI_INPUT_ERROR"),
                        ("SSL validation failed", "TLS_ERROR"),
                        ("Could not connect", "NETWORK_ERROR"),
                        ("timed out", "NETWORK_TIMEOUT"),
                        ("Unable to locate credentials", "CREDENTIALS_UNAVAILABLE"),
                    )
                    if marker in result.stderr
                ),
                "AWS_ERROR",
            )
        )
        if absent and code == absent:
            return None
        raise OperatorError(args[0] + "_" + args[1] + "_" + code)
    return json.loads(result.stdout) if result.stdout.strip() else {}


def infrastructure():
    if aws("sts", "get-caller-identity")["Account"] != ACCOUNT:
        raise OperatorError("WRONG_ACCOUNT")
    db = aws("rds", "describe-db-instances", "--db-instance-identifier", INSTANCE)[
        "DBInstances"
    ][0]
    if (
        db["Endpoint"]["Address"] != HOST
        or db["MasterUsername"] != ADMIN
        or GROUP not in {g["VpcSecurityGroupId"] for g in db["VpcSecurityGroups"]}
    ):
        raise OperatorError("WRONG_SHARED_INSTANCE")
    return {
        k: db.get(k)
        for k in (
            "DBInstanceIdentifier",
            "DBInstanceClass",
            "AllocatedStorage",
            "MaxAllocatedStorage",
            "EngineVersion",
            "DBInstanceStatus",
            "PendingModifiedValues",
        )
    }


def parameter(name):
    result = aws(
        "ssm",
        "get-parameter",
        "--name",
        name,
        "--with-decryption",
        absent="ParameterNotFound",
    )
    if result is None:
        return None
    if result["Parameter"]["Type"] != "SecureString":
        raise OperatorError("UNENCRYPTED_PARAMETER")
    return json.loads(result["Parameter"]["Value"])


def credential(kind, *, create=False):
    name = "/statarena/v2/" + kind
    user = "vega_v2_" + kind
    data = parameter(name)
    if data is None and create:
        data = {
            "host": HOST,
            "port": 5432,
            "database": DATABASE,
            "username": user,
            "password": secrets.token_urlsafe(36),
            "instance": INSTANCE,
            "region": REGION,
        }
        aws(
            "ssm",
            "put-parameter",
            body={
                "Name": name,
                "Type": "SecureString",
                "Tier": "Standard",
                "Value": json.dumps(data),
                "Overwrite": False,
                "Tags": [{"Key": "Application", "Value": "vega-v2"}],
            },
        )
    if (
        not data
        or (
            data.get("host"),
            data.get("database"),
            data.get("username"),
            data.get("instance"),
        )
        != (HOST, DATABASE, user, INSTANCE)
        or not data.get("password")
    ):
        raise OperatorError("INVALID_V2_CREDENTIAL")
    return data


def certificate():
    ca = Path(os.environ.get("PGSSLROOTCERT", "/tmp/vega-shared-rds-ca.pem"))
    if not ca.exists():
        urllib.request.urlretrieve(
            "https://truststore.pki.rds.amazonaws.com/us-east-2/us-east-2-bundle.pem",
            ca,
        )
    return str(ca)


def connection(user, password, database, *, readonly=False):
    return psycopg.connect(
        host=HOST,
        port=5432,
        dbname=database,
        user=user,
        password=password,
        sslmode="verify-full",
        sslrootcert=certificate(),
        connect_timeout=10,
        autocommit=True,
        application_name="vega-v2-shared-operator",
        options="-c statement_timeout=30000"
        + (" -c default_transaction_read_only=on" if readonly else ""),
    )


def admin_credential():
    data = parameter("/statarena/app/rds-admin")
    if (
        not data
        or data.get("username") != ADMIN
        or data.get("security_group") != GROUP
        or not data.get("password")
    ):
        raise OperatorError("INVALID_ADMIN_CREDENTIAL")
    return data


def snapshot_admin(conn):
    return {
        "identity": conn.execute("SELECT current_database(),current_user").fetchone(),
        "existing_database": conn.execute(
            "SELECT datname,datdba,datacl::text FROM pg_database WHERE datname='statarena_prod'"
        ).fetchone(),
        "admin_attributes": conn.execute(
            "SELECT rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=current_user"
        ).fetchone(),
    }


def bootstrap():
    before = infrastructure()
    admin = admin_credential()
    # Save generated credentials first, so an interrupted bootstrap is resumable.
    ingest = credential("ingest", create=True)
    reader = credential("reader", create=True)
    spec = importlib.util.spec_from_file_location(
        "vega_shared_bootstrap", HERE / "shared_bootstrap.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with connection(ADMIN, admin["password"], "postgres") as conn:
        old = snapshot_admin(conn)
        result = module.provision_shared(
            conn,
            lambda: connection(ADMIN, admin["password"], DATABASE),
            {
                ADMIN: admin["password"],
                "vega_v2_ingest": ingest["password"],
                "vega_v2_reader": reader["password"],
            },
        )
        if snapshot_admin(conn) != old:
            raise OperatorError("EXISTING_DATABASE_METADATA_CHANGED")
    after = infrastructure()
    if before != after:
        raise OperatorError("INSTANCE_CONFIGURATION_CHANGED")
    return {
        "bootstrap": result,
        "existing_instance_unchanged": True,
        "verification": verify(),
    }


def verify():
    writer = credential("ingest")
    reader = credential("reader")
    with connection(writer["username"], writer["password"], DATABASE) as conn:
        identity = conn.execute("SELECT current_database(),current_user").fetchone()
        if identity != (DATABASE, writer["username"]):
            raise OperatorError("WRONG_DATABASE")
        migrations = conn.execute(
            "SELECT count(*) FROM ops.schema_migrations"
        ).fetchone()[0]
        versions = conn.execute(
            "SELECT extname,extversion FROM pg_extension WHERE extname IN ('vector','pg_trgm') ORDER BY extname"
        ).fetchall()
        size = conn.execute("SELECT pg_database_size(current_database())").fetchone()[0]
    with connection(reader["username"], reader["password"], DATABASE) as conn:
        readonly = conn.execute("SHOW default_transaction_read_only").fetchone()[0]
        privileges = conn.execute(
            "SELECT has_table_privilege(current_user,'core.matches','SELECT'),has_table_privilege(current_user,'core.matches','INSERT,UPDATE,DELETE,TRUNCATE'),has_table_privilege(current_user,'ops.fetch_jobs','SELECT')"
        ).fetchone()
        if readonly != "on" or privileges != (True, False, False):
            raise OperatorError("READER_GRANTS_INCORRECT")
    return {
        "database": DATABASE,
        "migrations": migrations,
        "bytes": size,
        "extensions": versions,
        "reader_readonly": True,
    }


def preflight():
    result = {"instance": infrastructure()}
    admin = admin_credential()
    with connection(ADMIN, admin["password"], "postgres", readonly=True) as conn:
        result["identity"] = conn.execute(
            "SELECT current_database(),current_user"
        ).fetchone()
        result["existing_v2"] = conn.execute(
            "SELECT datname,pg_get_userbyid(datdba) FROM pg_database WHERE datname=%s",
            (DATABASE,),
        ).fetchall()
        result["admin_capabilities"] = conn.execute(
            "SELECT rolcreatedb,rolcreaterole,pg_has_role(current_user,'rds_superuser','member') FROM pg_roles WHERE rolname=current_user"
        ).fetchone()
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("preflight", "bootstrap", "verify"))
    args = parser.parse_args()
    try:
        result = {"preflight": preflight, "bootstrap": bootstrap, "verify": verify}[
            args.action
        ]()
        print(json.dumps(result))
        return 0
    except Exception as error:
        # Never print psycopg/AWS details containing credential values or SQL.
        print(
            json.dumps(
                {
                    "error": (
                        str(error)
                        if isinstance(error, OperatorError)
                        else type(error).__name__
                    )
                }
            )
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
