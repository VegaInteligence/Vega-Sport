"""Create only the backend-owned schema and scoped defaults; never migrate source data."""
import argparse
import json
from pathlib import Path
import subprocess
import sys
import psycopg
from psycopg import sql

ACCOUNT = "361769570630"
HOST = "statarena-postgres.clcy2iqyajbl.us-east-2.rds.amazonaws.com"
ROOT = Path(__file__).resolve().parents[2]

def aws(*args):
    result = subprocess.run(["aws", "--profile", "statarena", "--region", "us-east-2", "--no-cli-pager", "--output", "json", *args], capture_output=True, text=True, check=True)
    return json.loads(result.stdout)

def credentials(name):
    p = aws("ssm", "get-parameter", "--name", "/statarena/app/" + name, "--with-decryption")["Parameter"]
    if p["Type"] != "SecureString": raise ValueError("SSM credentials must be encrypted")
    c = json.loads(p["Value"])
    if name == "rds-admin": c.setdefault("host", HOST)
    if c["host"] != HOST: raise ValueError("Unexpected RDS endpoint")
    return c

def connect(c, database, readonly=False):
    return psycopg.connect(host=c["host"], dbname=database, user=c["username"], password=c["password"], sslmode="verify-full", sslrootcert=str(ROOT/"dashboard/backend/certs/rds-us-east-2.pem"), connect_timeout=8, options="-c lock_timeout=2000 -c statement_timeout=15000" + (" -c default_transaction_read_only=on" if readonly else ""), autocommit=True)

def main():
    parser = argparse.ArgumentParser(); parser.add_argument("--apply", action="store_true"); parser.add_argument("--receipt", type=Path, required=True); args = parser.parse_args()
    if aws("sts", "get-caller-identity")["Account"] != ACCOUNT: raise ValueError("Unexpected AWS account")
    runtime, ingest = credentials("rds-runtime"), credentials("rds-ingest")
    if runtime["database"] != "statarena_prod" or ingest["database"] != runtime["database"] or runtime["username"] != "statarena_runtime" or ingest["username"] != "statarena_ingest": raise ValueError("Unexpected runtime/ingest identity")
    receipt = {"account": ACCOUNT, "database": runtime["database"], "apply": args.apply, "sourceDataTouched": False, "rolePasswordsChanged": False}
    with connect(runtime, runtime["database"], readonly=True) as db:
        receipt["schemaBefore"] = db.execute("SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname='statarena_app'").fetchone()
    if args.apply:
        admin = credentials("rds-admin")
        with connect(admin, runtime["database"]) as db:
            with db.transaction():
                if not db.execute("SELECT pg_try_advisory_xact_lock(97813009)").fetchone()[0]: raise ValueError("Backend schema bootstrap is already running")
                owner = db.execute("SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname='statarena_app'").fetchone()
                if owner is None:
                    db.execute("CREATE SCHEMA statarena_app")
                    db.execute("COMMENT ON SCHEMA statarena_app IS 'StatArena AWS backend normalized serving schema'")
                elif owner[0] not in (ingest["username"], admin["username"]):
                    raise ValueError("Existing application schema has a different owner")
                # RDS administrators need not be members of the ingest role.
                # Grant only CREATE/USAGE in our namespace, not database CREATE
                # or new membership in an existing migration role.
                db.execute(sql.SQL("GRANT USAGE, CREATE ON SCHEMA statarena_app TO {}").format(sql.Identifier(ingest["username"])))
                db.execute(sql.SQL("GRANT USAGE ON SCHEMA statarena_app TO {}").format(sql.Identifier(runtime["username"])))
        with connect(ingest, runtime["database"]) as db:
            with db.transaction():
                db.execute(sql.SQL("ALTER DEFAULT PRIVILEGES IN SCHEMA statarena_app GRANT SELECT ON TABLES TO {}").format(sql.Identifier(runtime["username"])))
                db.execute(sql.SQL("GRANT SELECT ON ALL TABLES IN SCHEMA statarena_app TO {}").format(sql.Identifier(runtime["username"])))
    with connect(runtime, runtime["database"], readonly=True) as db:
        receipt["schemaAfter"] = db.execute("SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname='statarena_app'").fetchone()
        receipt["runtimeOwnsSourceWritePrivileges"] = db.execute("SELECT has_table_privilege(current_user,'statarena.fixtures','UPDATE')").fetchone()[0]
    args.receipt.parent.mkdir(parents=True, exist_ok=True)
    args.receipt.write_text(json.dumps(receipt, indent=2) + "\n")
    print(json.dumps(receipt))

if __name__ == "__main__":
    try: main()
    except Exception as error:
        print(json.dumps({"status":"failed", "errorClass": type(error).__name__, "sqlState": getattr(error,"sqlstate",None)}), file=sys.stderr)
        raise SystemExit(1)
