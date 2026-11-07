"""Package a finite SQL manifest and IAM-only worker as a deterministic release."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]


def validate_transient(document, mode):
    if document.get("format") != "vega.transient-" + mode + ".v1":
        raise ValueError("The transient release format does not match its handler")
    try:
        issued = datetime.fromisoformat(document["issuedAt"].replace("Z", "+00:00"))
        expires = datetime.fromisoformat(document["expiresAt"].replace("Z", "+00:00"))
    except (KeyError, AttributeError, ValueError, TypeError) as error:
        raise ValueError("A fixed transient release window is required") from error
    now = datetime.now(timezone.utc)
    if not issued.tzinfo or not expires.tzinfo or not issued <= now < expires or not 0 < (expires-issued).total_seconds() <= 14400:
        raise ValueError("Transient releases must expire within four hours of issuance")
    operations = document["operations"]
    if len(operations) > 256 or any(operation.get("targets") != ["prod"] for operation in operations.values()):
        raise ValueError("Transient releases contain only finite production operations")
    if mode == "ingest":
        if {"bootstrap-consolidation", "transfer-authorize"} & set(operations):
            raise ValueError("Admin-only operations cannot enter an ingestion release")
    elif mode == "admin-transfers":
        expected = {
            "transfer-owner-preflight": ("SELECT statarena_app.legacy_transfer_preflight($1) AS receipt", "read"),
            "transfer-authorize": ("SELECT statarena_app.legacy_transfer_authorize($1::text[]) AS receipt", "write"),
            "transfer-archive": ("SELECT statarena_app.legacy_transfer_archive($1::jsonb) AS receipt", "write"),
            "transfer-rollback": ("SELECT statarena_app.legacy_transfer_rollback($1::jsonb) AS receipt", "write"),
        }
        if set(operations) != set(expected):
            raise ValueError("The admin release contains only its four reviewed transfer operations")
        for name, operation in operations.items():
            statement, mode_name = expected[name]
            if operation.get("sql") != statement or operation.get("mode") != mode_name or operation.get("parameters") != 1:
                raise ValueError("Admin transfer SQL and signatures are fixed")
            if operation.get("kind") or operation.get("repeat") or operation.get("migration"):
                raise ValueError("Admin transfer operations cannot add maintenance modes")


def build(manifest, output, *, bootstrap=False, transient_ingest=False, transient_admin_transfers=False):
    if sum((bootstrap, transient_ingest, transient_admin_transfers)) > 1:
        raise ValueError("Select one separate credential handler")
    document = json.loads(manifest.read_text())
    if not isinstance(document.get("operations"), dict) or not document["operations"]:
        raise ValueError("A reviewed operation manifest is required")
    if bootstrap and set(document["operations"]) != {"bootstrap-consolidation"}:
        raise ValueError("The separate bootstrap release accepts only its fixed prerequisite operation")
    if transient_ingest or transient_admin_transfers:
        validate_transient(document, "ingest" if transient_ingest else "admin-transfers")
    for name, operation in document["operations"].items():
        kind = operation.get("kind")
        if kind and (kind not in ("archive-refresh", "vacuum-analyze") or operation.get("mode") != "write"
                     or operation.get("sql") or operation.get("migration") or operation.get("repeat")):
            raise ValueError(f"Invalid fixed maintenance operation: {name}")
        if operation.get("mode") not in ("read", "write") or (not kind and not operation.get("sql")):
            raise ValueError(f"Invalid operation: {name}")
        if not set(operation.get("targets", [])) <= {"stage", "prod"}:
            raise ValueError(f"Invalid target: {name}")
    with tempfile.TemporaryDirectory(prefix="vega-maintenance-") as staging:
        stage = Path(staging)
        entry = HERE / ("bootstrap.mjs" if bootstrap else "transient-ingest.mjs" if transient_ingest
                        else "admin-transfers.mjs" if transient_admin_transfers else "index.mjs")
        subprocess.run(["bun", "build", str(entry), "--target=node", "--format=esm",
                        "--outfile=" + str(stage / "index.mjs")], cwd=ROOT, check=True)
        shutil.copyfile(ROOT / "dashboard/backend/certs/rds-us-east-2.pem", stage / "rds-ca.pem")
        (stage / "operations.json").write_text(json.dumps(document, ensure_ascii=False, separators=(",", ":")))
        # Import in isolation and prove invocation-supplied SQL is rejected before
        # connecting to any database. No credentials are needed for packaging.
        check = """import {handler} from './index.mjs';
let rejected=false;try{await handler({operation:'injected',sql:'SELECT 1'})}catch{rejected=true}
if(!rejected)throw Error('Unpackaged SQL was accepted');"""
        subprocess.run([os.environ.get("BUILD_NODE", "node"), "--input-type=module", "-e", check],
                       cwd=stage, env={"PATH": os.environ["PATH"], "LAMBDA_TASK_ROOT": str(stage)}, check=True)
        with ZipFile(stage / "release.zip", "w") as archive:
            for name in ("index.mjs", "operations.json", "rds-ca.pem"):
                entry = ZipInfo(name, date_time=(2020, 1, 1, 0, 0, 0))
                entry.external_attr = 0o100644 << 16
                archive.writestr(entry, (stage / name).read_bytes(), compress_type=ZIP_DEFLATED)
        data = (stage / "release.zip").read_bytes()
        sha = hashlib.sha256(data).hexdigest()
        output.mkdir(parents=True, exist_ok=True)
        destination = output / (sha + ".zip")
        destination.write_bytes(data)
        print(json.dumps({"path": str(destination), "sha256": sha, "bytes": len(data),
                          "operationHashes": {key: hashlib.sha256(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()
                                              for key, value in document["operations"].items()}}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest", type=Path)
    parser.add_argument("output", type=Path)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument("--bootstrap", action="store_true", help="Build the separate password-free one-time bootstrap handler")
    modes.add_argument("--transient-ingest", action="store_true", help="Build the expiring ingestion handler with invocation-only credentials")
    modes.add_argument("--transient-admin-transfers", action="store_true", help="Build the expiring admin transfer handler with invocation-only credentials")
    args = parser.parse_args()
    build(args.manifest, args.output, bootstrap=args.bootstrap, transient_ingest=args.transient_ingest,
          transient_admin_transfers=args.transient_admin_transfers)
