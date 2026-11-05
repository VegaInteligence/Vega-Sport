"""Load AWS worker parameters without writing credentials to checkout or artifacts."""
import json
import os
from pathlib import Path
import re
import secrets
import ssl
import subprocess
import sys
from urllib.parse import quote

REGION = "us-east-2"
BUCKET = "statarena-football-333rosky-70db6e5f"


def parameter(name):
    proc = subprocess.run(
        ["aws", "ssm", "get-parameter", "--region", REGION, "--name", "/statarena/app/" + name,
         "--with-decryption", "--output", "json", "--no-cli-pager"],
        capture_output=True, timeout=40, check=False,
    )
    if proc.returncode:
        raise ValueError("Cannot read SSM parameter " + name)
    result = json.loads(proc.stdout)["Parameter"]
    if result["Type"] != "SecureString":
        raise ValueError("Expected an SSM SecureString")
    return json.loads(result["Value"])


def field(record, name):
    value = record[name]
    if not isinstance(value, str) or not value or any(ord(c) < 32 for c in value):
        raise ValueError("Invalid SSM field " + name)
    return value


def bootstrap(mode):
    if mode not in ("ingest", "typed-ingest", "runtime"):
        raise ValueError("Unknown database access mode")
    db = parameter("rds-" + ("ingest" if mode == "typed-ingest" else mode))
    host, database, user, password = (field(db, key) for key in ("host", "database", "username", "password"))
    if not re.fullmatch(r"[a-z0-9-]+\.[a-z0-9]+\.us-east-2\.rds\.amazonaws\.com", host) or database != "statarena_prod":
        raise ValueError("Unexpected RDS instance or database")
    port = int(db.get("port", 5432))
    if not 1 <= port <= 65535:
        raise ValueError("Invalid database port")
    if mode == "typed-ingest" and (
        host != "statarena-postgres.clcy2iqyajbl.us-east-2.rds.amazonaws.com"
        or port != 5432
        or user != "statarena_ingest"
    ):
        raise ValueError("Unexpected typed ingestion target or actor")
    url = f"postgresql://{quote(user, safe='')}:{quote(password, safe='')}@{host}:{port}/{database}?sslmode=verify-full"
    cert = Path(os.environ["GITHUB_WORKSPACE"]) / "dashboard/backend/certs/rds-us-east-2.pem"
    ssl.create_default_context(cafile=str(cert))
    pem = cert.read_text().strip()
    values = {
        "DATABASE_URL": url, "DATABASE_CA_PEM": pem, "DATABASE_POOL_MAX": "1",
        "STATARENA_DATA_PROVIDER": "aws", "PGSSLROOTCERT": str(cert),
        "NODE_EXTRA_CA_CERTS": str(cert), "PGSSLMODE": "verify-full",
    }
    sensitive = [password, quote(password, safe=""), url]
    if mode == "ingest":
        storage = parameter("s3-ingest")
        key, secret = (field(storage, k) for k in ("access_key_id", "secret_access_key"))
        sensitive.extend((key, secret))
        # Existing staging writers still use these historical environment names.
        values.update({
            "NEON_DATABASE_URL": url, "STATARENA_DATABASE_CA_PEM": pem,
            "NEON_STORAGE_ENDPOINT": "https://s3.us-east-2.amazonaws.com",
            "NEON_STORAGE_REGION": REGION, "NEON_STORAGE_BUCKET": BUCKET,
            "NEON_STORAGE_ACCESS_KEY_ID": key, "NEON_STORAGE_SECRET_ACCESS_KEY": secret,
            "STATARENA_EXTERNAL_STORAGE": "1", "STATARENA_SQL_DOCUMENTS": "1",
            "STATARENA_S3_PATH_STYLE": "0",
        })
    for value in sensitive:
        print("::add-mask::" + value.replace("%", "%25"), flush=True)
    delimiter = "EOF_" + secrets.token_hex(24)
    with Path(os.environ["GITHUB_ENV"]).open("a") as fp:
        for key, value in values.items():
            fp.write(f"{key}<<{delimiter}\n{value}\n{delimiter}\n")


if __name__ == "__main__":
    try:
        bootstrap(sys.argv[1])
    except (ValueError, KeyError, IndexError, OSError, subprocess.TimeoutExpired) as exc:
        # SDK errors can contain payloads. Only emit the safe class and input mode.
        sys.exit(f"AWS database bootstrap failed ({type(exc).__name__}); check the role, parameters and regional CA.")
