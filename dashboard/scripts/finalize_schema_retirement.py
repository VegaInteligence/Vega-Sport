"""Review or finalize the exact 112 retired provider tables through fixed SQL.

The default action is read-only status. Apply consumes an already reviewed plan
and recovery attestation, each pinned by its file SHA-256. The database checks the
current manifest again under its publication lease; this tool never refreshes a
stale plan or retries an uncertain write. Recovery assertions are operator-owned
evidence, not cloud checks performed by this CLI.
"""

import argparse
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime
import hashlib
import json
import math
import os
from pathlib import Path
import re
import stat
import sys
from urllib.parse import parse_qsl, unquote, urlsplit

from consolidated_model import MODEL_DIGEST, NODES

MAX_JSON_BYTES = 8 * 1024 * 1024
MAX_APPLY_BYTES = 100000
SHA256 = re.compile(r"[a-f0-9]{64}\Z")
IDENTIFIER = re.compile(r"[A-Za-z_][A-Za-z0-9_-]{0,62}\Z")
TABLE_NAMES = {node.table for node in NODES}
SQL = {
    "status": "SELECT statarena_app.consolidation_status()",
    "plan": "SELECT statarena_app.consolidation_retirement_plan()",
    "apply": "SELECT statarena_app.consolidation_finalize_retirement(%s::jsonb,%s::jsonb,%s)",
}
SENSITIVE_KEYS = {
    "password", "passwd", "secret", "token", "accesstoken", "refreshtoken",
    "authorization", "accesskey", "accesskeyid", "secretaccesskey", "privatekey",
    "credentials", "databaseurl", "dsn",
}


class ValidationError(ValueError):
    """Messages are fixed metadata-only descriptions safe to show on stderr."""


def require(condition, message):
    if not condition:
        raise ValidationError(message)


def digest(value, label):
    require(isinstance(value, str) and SHA256.fullmatch(value), label + " must be a lowercase SHA-256")
    return value


def text(value, label, limit=1024):
    require(isinstance(value, str) and 0 < len(value) <= limit and not any(ord(c) < 32 for c in value),
            label + " must be bounded nonempty text")
    return value


def integer(value, label):
    require(type(value) is int and 0 <= value <= 2**63 - 1, label + " must be a nonnegative integer")
    return value


def oid(value, label):
    require(isinstance(value, str) and re.fullmatch(r"[1-9][0-9]{0,9}", value)
            and int(value) <= 2**32 - 1, label + " must be a decimal PostgreSQL OID")
    return value


def timestamp(value, label):
    text(value, label, 80)
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise ValidationError(label + " must be an ISO timestamp") from None
    require(parsed.tzinfo is not None and parsed.utcoffset() is not None, label + " must include a timezone")
    return parsed


def fields(value, required, label, *, exact=False):
    require(isinstance(value, dict) and set(required) <= value.keys(), label + " is missing required fields")
    if exact:
        require(set(value) == set(required), label + " has unexpected fields")
    return value


def metadata_only(value, depth=0):
    require(depth <= 40, "JSON metadata is too deeply nested")
    if isinstance(value, dict):
        for key, child in value.items():
            require(isinstance(key, str), "JSON metadata keys must be text")
            require(re.sub(r"[^a-z0-9]", "", key.lower()) not in SENSITIVE_KEYS,
                    "Credential-bearing fields are not accepted in retirement metadata")
            metadata_only(child, depth + 1)
    elif isinstance(value, list):
        for child in value:
            metadata_only(child, depth + 1)
    elif isinstance(value, float):
        require(math.isfinite(value), "JSON must not contain non-finite numbers")


def _pairs(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "JSON contains a duplicate object key")
        result[key] = value
    return result


def _nonfinite(_):
    raise ValidationError("JSON must not contain non-finite numbers")


def read_reviewed_json(path, expected_sha256):
    """Hash the exact reviewed bytes; never substitute a reserialized hash."""
    digest(expected_sha256, "Reviewed file digest")
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NONBLOCK | getattr(os, "O_NOFOLLOW", 0))
        with os.fdopen(descriptor, "rb") as stream:
            require(stat.S_ISREG(os.fstat(stream.fileno()).st_mode), "Reviewed input must be a regular file")
            require(os.fstat(stream.fileno()).st_size <= MAX_JSON_BYTES, "Reviewed JSON file exceeds the size limit")
            raw = stream.read(MAX_JSON_BYTES + 1)
    except OSError:
        raise ValidationError("Cannot read the reviewed JSON file") from None
    require(0 < len(raw) <= MAX_JSON_BYTES, "Reviewed JSON file is empty or exceeds the size limit")
    require(hashlib.sha256(raw).hexdigest() == expected_sha256, "Reviewed file SHA-256 does not match")
    try:
        value = json.loads(raw.decode("utf-8"), object_pairs_hook=_pairs, parse_constant=_nonfinite)
    except (UnicodeError, json.JSONDecodeError, RecursionError):
        raise ValidationError("Reviewed input must contain valid bounded UTF-8 JSON") from None
    require(isinstance(value, dict), "Reviewed JSON must be an object")
    metadata_only(value)
    return value


def validate_plan(plan, confirmation):
    fields(plan, ("format", "ready", "manifest_sha256", "manifest", "blockers", "observations"), "Reviewed plan", exact=True)
    require(plan["format"] == "vega.provider-retirement.plan.v1", "Unsupported retirement plan format")
    require(plan["ready"] is True and plan["blockers"] == [], "A ready plan with no blockers is required")
    require(isinstance(plan["observations"], dict), "Plan observations must be an object")
    digest(plan["manifest_sha256"], "Manifest digest")
    require(digest(confirmation, "Explicit manifest confirmation") == plan["manifest_sha256"],
            "Explicit confirmation does not match the reviewed manifest")
    manifest = fields(plan["manifest"], (
        "format", "database", "database_oid", "actor", "model_digest", "revision", "activated_at",
        "publication", "original_manifest_sha256", "tables", "functions", "active_contracts_sha256",
        "migration_journal_sha256", "active_physical_tables",
    ), "Retirement manifest", exact=True)
    require(manifest["format"] == "vega.provider-retirement.manifest.v1", "Unsupported retirement manifest format")
    require(isinstance(manifest["database"], str) and IDENTIFIER.fullmatch(manifest["database"]), "Invalid manifest database")
    oid(manifest["database_oid"], "Manifest database OID")
    text(manifest["actor"], "Manifest actor", 63)
    require(manifest["model_digest"] == MODEL_DIGEST, "Manifest model differs from the checked-in mapping")
    integer(manifest["revision"], "Manifest revision")
    integer(manifest["active_physical_tables"], "Active physical table count")
    timestamp(manifest["activated_at"], "Activation timestamp")
    publication = fields(manifest["publication"], ("generation", "published_at"), "Publication fence", exact=True)
    require(isinstance(publication["generation"], str) and re.fullmatch(r"[0-9]{1,19}", publication["generation"])
            and int(publication["generation"]) <= 2**63 - 1, "Publication generation must be a decimal string")
    timestamp(publication["published_at"], "Publication timestamp")
    for key in ("original_manifest_sha256", "active_contracts_sha256", "migration_journal_sha256"):
        digest(manifest[key], "Manifest evidence digest")
    tables = manifest["tables"]
    require(isinstance(tables, list) and len(tables) == 112 and all(isinstance(t, dict) for t in tables),
            "The plan must contain exactly 112 table metadata entries")
    require(all(isinstance(t.get("name"), str) for t in tables)
            and {t["name"] for t in tables} == TABLE_NAMES, "Retirement targets differ from the exact checked-in 112 tables")
    for table in tables:
        fields(table, ("name", "oid", "row_type_oid", "owner", "acl", "column_count", "structure_sha256"),
               "Retired table metadata", exact=True)
        oid(table["oid"], "Retired table OID")
        oid(table["row_type_oid"], "Retired row-type OID")
        require(table["owner"] == manifest["actor"] and (table["acl"] is None or isinstance(table["acl"], str)),
                "Retired table owner or ACL metadata is invalid")
        require(integer(table["column_count"], "Retired column count") > 0, "Retired table columns are required")
        digest(table["structure_sha256"], "Retired table structure digest")
    require(len({t["oid"] for t in tables}) == 112 and len({t["row_type_oid"] for t in tables}) == 112,
            "Retired relation and row-type OIDs must be unique")
    functions = manifest["functions"]
    require(isinstance(functions, list) and len(functions) == 62 and all(isinstance(f, dict) for f in functions),
            "The plan must contain exactly 62 function metadata entries")
    for function in functions:
        fields(function, ("name", "oid", "arguments", "owner", "acl", "active_oid", "definition_sha256"),
               "Retired function metadata", exact=True)
        text(function.get("name"), "Retired function name", 63)
        oid(function["oid"], "Retired function OID")
        oid(function["active_oid"], "Active function OID")
        text(function["arguments"], "Retired function identity arguments", 4096)
        require(function["owner"] == manifest["actor"] and (function["acl"] is None or isinstance(function["acl"], str)),
                "Retired function owner or ACL metadata is invalid")
        digest(function["definition_sha256"], "Retired function definition digest")
    require(len({f["oid"] for f in functions}) == 62 and len({f["active_oid"] for f in functions}) == 62
            and len({(f["name"], f["arguments"]) for f in functions}) == 62
            and not ({f["oid"] for f in functions} & {f["active_oid"] for f in functions}),
            "Retired and active function identities must be distinct and unique")
    metadata_only(plan)
    return manifest


def validate_recovery(proof, plan):
    fields(proof, ("format", "database", "model_digest", "manifest_sha256", "snapshot", "restore",
                   "preservation", "recovery", "approval"), "Recovery attestation", exact=True)
    require(proof["format"] == "vega.provider-retirement.recovery.v1", "Unsupported recovery attestation format")
    require(proof["database"] == plan["manifest"]["database"] and proof["model_digest"] == MODEL_DIGEST
            and proof["manifest_sha256"] == plan["manifest_sha256"], "Recovery attestation is for a different manifest")
    snapshot = fields(proof["snapshot"], ("identifier", "status", "captured_at", "receipt_sha256"), "Snapshot attestation", exact=True)
    text(snapshot["identifier"], "Snapshot identifier", 256)
    require(snapshot["status"] == "available", "Snapshot availability must be attested")
    captured = timestamp(snapshot["captured_at"], "Snapshot capture timestamp")
    restore = fields(proof["restore"], ("snapshot_identifier", "status", "verified_at", "retired_table_count",
                                      "active_contracts_passed", "receipt_sha256"), "Restore attestation", exact=True)
    require(restore["snapshot_identifier"] == snapshot["identifier"] and restore["status"] == "verified"
            and type(restore["retired_table_count"]) is int and restore["retired_table_count"] == 112
            and restore["active_contracts_passed"] is True, "A verified restore of this snapshot and its contracts is required")
    require(timestamp(restore["verified_at"], "Restore verification timestamp") >= captured,
            "Restore verification cannot precede snapshot capture")
    preservation = fields(proof["preservation"], ("status", "full_readback_verified", "receipt_sha256", "artifact_sha256"),
                          "Preservation attestation", exact=True)
    require(preservation["status"] == "verified" and preservation["full_readback_verified"] is True,
            "Full preserved-artifact readback must be attested")
    recovery = fields(proof["recovery"], ("strategy", "post_snapshot_publication_replay_reviewed", "plan_sha256"),
                      "Recovery strategy", exact=True)
    require(recovery["strategy"] == "restore_snapshot_then_replay" and recovery["post_snapshot_publication_replay_reviewed"] is True,
            "The restore and post-snapshot publication replay plan must be reviewed")
    approval = fields(proof["approval"], ("action", "loss_of_in_place_rollback_accepted"), "Finalization approval", exact=True)
    require(approval["action"] == "retire_exact_112_provider_tables" and approval["loss_of_in_place_rollback_accepted"] is True,
            "The attestation must accept exact physical retirement and loss of in-place rollback")
    for section, key in ((snapshot, "receipt_sha256"), (restore, "receipt_sha256"), (preservation, "receipt_sha256"),
                         (preservation, "artifact_sha256"), (recovery, "plan_sha256")):
        digest(section[key], "Recovery evidence digest")
    metadata_only(proof)


@dataclass(frozen=True)
class Target:
    host: str
    database: str
    actor: str
    local: bool


def validate_target(url, expected_host=None, expected_database=None):
    """Reject libpq URI overrides before trusting its displayed host/database."""
    require(isinstance(url, str) and bool(url), "DATABASE_URL is required")
    require(not any(ord(c) < 32 for c in url), "DATABASE_URL must not contain control characters")
    try:
        address = urlsplit(url)
        port = address.port
        pairs = parse_qsl(address.query, keep_blank_values=True, strict_parsing=True)
        host = address.hostname
        database = unquote(address.path[1:]) if address.path.startswith("/") else ""
        actor = unquote(address.username or "")
    except ValueError:
        raise ValidationError("DATABASE_URL must be a valid PostgreSQL URI") from None
    require(address.scheme in ("postgresql", "postgres") and not address.fragment and bool(host)
            and not any(c in host for c in ("%", ",", "/", " ", "\\")), "DATABASE_URL must name one explicit PostgreSQL host")
    require(port is None or 1 <= port <= 65535, "Invalid database port")
    require(bool(IDENTIFIER.fullmatch(database)) and bool(IDENTIFIER.fullmatch(actor)),
            "DATABASE_URL must name one explicit database and role")
    require(all(key in {"sslmode", "sslrootcert", "connect_timeout"} for key, _ in pairs),
            "Connection query parameters may not override the target, role, service or session")
    require(len({key for key, _ in pairs}) == len(pairs), "Duplicate connection query parameters are not allowed")
    options = dict(pairs)
    local = host in ("localhost", "127.0.0.1", "::1") and database in ("vega_refactor_test", "vega_ci_test")
    if not local:
        require(expected_host == host and expected_database == database, "Remote access requires matching --expected-host and --expected-database")
        require(options.get("sslmode") == "verify-full", "Remote access requires TLS sslmode=verify-full")
    else:
        require(expected_host in (None, host) and expected_database in (None, database), "Expected target differs from the disposable database")
    return Target(host, database, actor, local)


def validate_environment(environ):
    require(not any(environ.get(key) for key in ("PGHOST", "PGHOSTADDR", "PGPORT", "PGDATABASE", "PGUSER",
                                                "PGSERVICE", "PGSERVICEFILE", "PGOPTIONS")),
            "Clear ambient libpq target/service/session overrides before using this explicit-target CLI")


def apply_parameters(plan, proof, confirmation):
    """Match the worker's bounded JSON argument envelope, measured in UTF-8."""
    try:
        raw = json.dumps([plan, proof, confirmation], ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        require(len(raw.encode("utf-8")) <= MAX_APPLY_BYTES, "Compact apply arguments exceed the 100000-byte worker limit")
        return (json.dumps(plan, ensure_ascii=False, separators=(",", ":"), allow_nan=False),
                json.dumps(proof, ensure_ascii=False, separators=(",", ":"), allow_nan=False), confirmation)
    except (UnicodeError, ValueError) as error:
        if isinstance(error, ValidationError):
            raise
        raise ValidationError("Apply arguments must contain finite, valid UTF-8 JSON") from None


def validate_receipt(receipt, plan):
    manifest = plan["manifest"]
    fields(receipt, ("format", "status", "database", "actor", "finalized_at", "model_digest", "revision",
                     "manifest_sha256", "recovery_proof_sha256", "dropped_tables", "dropped_functions",
                     "active_physical_tables_before", "active_physical_tables_after", "retired_physical_tables_after",
                     "publication_before", "publication_after", "rollback_available", "recovery_strategy", "manifest", "recovery_proof"), "Finalization receipt")
    require(receipt["format"] == "vega.provider-retirement.receipt.v1" and receipt["status"] == "finalized",
            "Database returned an unexpected finalization receipt")
    require(receipt["database"] == manifest["database"] and receipt["actor"] == manifest["actor"]
            and receipt["model_digest"] == MODEL_DIGEST and receipt["manifest_sha256"] == plan["manifest_sha256"],
            "Finalization receipt differs from the reviewed target")
    for key, expected in (("dropped_tables", 112), ("dropped_functions", 62), ("retired_physical_tables_after", 0)):
        require(type(receipt[key]) is int and receipt[key] == expected, "Finalization receipt has unexpected relation counts")
    require(integer(receipt["active_physical_tables_before"], "Active table count")
            == integer(receipt["active_physical_tables_after"], "Active table count") == manifest["active_physical_tables"],
            "Finalization changed the active physical table count")
    require(receipt["publication_before"] == manifest["publication"] == receipt["publication_after"], "Finalization changed the publication fence")
    require(receipt["rollback_available"] is False and receipt["recovery_strategy"] == "restore_snapshot_then_replay",
            "Finalization receipt has an unexpected recovery contract")
    timestamp(receipt["finalized_at"], "Finalization timestamp")
    require(integer(receipt["revision"], "Receipt revision") == manifest["revision"], "Finalization changed the control revision")
    digest(receipt["recovery_proof_sha256"], "Stored recovery proof digest")
    require(receipt["manifest"] == manifest, "Stored finalization manifest differs from the reviewed plan")
    validate_recovery(receipt["recovery_proof"], plan)
    metadata_only(receipt)


def execute(db, target, *, action="status", plan=None, proof=None, confirmation=None):
    require(action in SQL and db.autocommit is True, "Use a fixed operation on a dedicated autocommit connection")
    params = None
    if action == "apply":
        manifest = validate_plan(plan, confirmation)
        validate_recovery(proof, plan)
        require(manifest["database"] == target.database and manifest["actor"] == target.actor,
                "Reviewed manifest does not match the connection target and role")
        params = apply_parameters(plan, proof, confirmation)
    with db.transaction():
        if action != "apply":
            db.execute("SET TRANSACTION READ ONLY")
        db.execute("SELECT set_config('statement_timeout','45000ms',true),set_config('lock_timeout','2000ms',true)")
        identity = db.execute("SELECT current_database(),current_user,session_user").fetchone()
        require(identity == (target.database, target.actor, target.actor), "Actual database/session identity differs from the explicit target")
        value = db.execute(SQL[action], params).fetchone()[0]
        require(isinstance(value, dict), "Database returned an invalid operation envelope")
        metadata_only(value)
        if action == "apply":
            validate_receipt(value, plan)
            require(value["recovery_proof"] == proof, "Stored recovery attestation differs from the reviewed proof")
    return value


def summary(action, value):
    if action == "status":
        control = value.get("control", {})
        return {"action": action, **{key: value.get(key) for key in ("active_physical_tables", "retired_physical_tables",
                                                                   "rollback_available", "recovery_strategy", "physical_retirement")},
                "control": {key: control[key] for key in ("mode", "revision", "model_digest", "physical_retirement_finalized", "rollback_available") if key in control}}
    if action == "plan":
        manifest = value.get("manifest", {})
        finalized = value.get("receipt", {})
        return {"action": action, "format": value.get("format"), "ready": value.get("ready"), "status": value.get("status"),
                "manifest_sha256": value.get("manifest_sha256", finalized.get("manifest_sha256")),
                "database": manifest.get("database", finalized.get("database")),
                "tables": len(manifest.get("tables", [])), "functions": len(manifest.get("functions", [])),
                "blocker_count": len(value.get("blockers", [])),
                **{key: finalized[key] for key in ("dropped_tables", "dropped_functions", "rollback_available", "recovery_strategy") if key in finalized}}
    keys = ("format", "status", "database", "actor", "finalized_at", "model_digest", "revision", "manifest_sha256",
            "recovery_proof_sha256", "dropped_tables", "dropped_functions", "active_physical_tables_before",
            "active_physical_tables_after", "retired_physical_tables_after", "rollback_available", "recovery_strategy")
    return {"action": action, **{key: value[key] for key in keys}, "recovery_evidence": "operator_attested"}


@contextmanager
def receipt_file(path):
    """Reserve a new private file before any write operation; never overwrite."""
    if path is None:
        yield None
        return
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except OSError:
        raise ValidationError("Receipt destination must be a new writable file") from None
    inode = os.fstat(descriptor).st_ino
    try:
        with os.fdopen(descriptor, "wb") as stream:
            yield stream
            stream.flush()
            os.fsync(stream.fileno())
    except BaseException:
        try:
            if path.lstat().st_ino == inode:
                path.unlink()
        except OSError:
            pass
        raise


def connect(url):
    import psycopg  # Pure input-validation tests need no PostgreSQL dependency.
    return psycopg.connect(url, autocommit=True, connect_timeout=10, application_name="vega-schema-retirement")


def parser():
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("action", nargs="?", choices=tuple(SQL), default="status")
    result.add_argument("--expected-host")
    result.add_argument("--expected-database")
    result.add_argument("--plan", type=Path, help="Previously reviewed plan JSON; never refreshed during apply")
    result.add_argument("--plan-sha256", help="SHA-256 of the exact reviewed plan file bytes")
    result.add_argument("--recovery-proof", type=Path)
    result.add_argument("--recovery-sha256", help="SHA-256 of the exact reviewed recovery file bytes")
    result.add_argument("--confirm-manifest-sha256", help="Explicitly confirm the database-issued manifest digest")
    result.add_argument("--receipt", type=Path, help="Save complete metadata to a new private file without overwriting")
    return result


def main(argv=None):
    args = parser().parse_args(argv)
    operation_started = False
    operation_returned = False
    try:
        supplied = (args.plan, args.plan_sha256, args.recovery_proof, args.recovery_sha256, args.confirm_manifest_sha256)
        if args.action == "apply":
            require(all(supplied), "Apply requires both reviewed files, both file SHA-256s and explicit manifest confirmation")
            plan = read_reviewed_json(args.plan, args.plan_sha256)
            proof = read_reviewed_json(args.recovery_proof, args.recovery_sha256)
            validate_plan(plan, args.confirm_manifest_sha256)
            validate_recovery(proof, plan)
            apply_parameters(plan, proof, args.confirm_manifest_sha256)
        else:
            require(not any(supplied), "Reviewed apply inputs are not accepted for read-only operations")
            plan = proof = None
        validate_environment(os.environ)
        url = os.environ.get("DATABASE_URL")
        target = validate_target(url, args.expected_host, args.expected_database)
        if plan:
            require(plan["manifest"]["database"] == target.database and plan["manifest"]["actor"] == target.actor,
                    "Reviewed manifest does not match the connection target and role")
        with receipt_file(args.receipt) as output:
            with connect(url) as db:
                operation_started = True
                value = execute(db, target, action=args.action, plan=plan, proof=proof, confirmation=args.confirm_manifest_sha256)
                operation_returned = True
            report = summary(args.action, value)
            if output is not None:
                raw = (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True, allow_nan=False) + "\n").encode("utf-8")
                require(len(raw) <= MAX_JSON_BYTES, "Operation metadata exceeds the receipt size limit")
                output.write(raw)
                report.update(receipt_file_sha256=hashlib.sha256(raw).hexdigest(), receipt_file_bytes=len(raw))
        print(json.dumps(report, sort_keys=True, allow_nan=False))
        return 0
    except Exception as error:
        # Database error messages can include DSNs, row contents or SQL details.
        message = str(error) if isinstance(error, ValidationError) else "Operation failed; sensitive exception details are not printed"
        report = {"status": "error", "message": message}
        code = getattr(error, "sqlstate", None)
        if isinstance(code, str) and re.fullmatch(r"[0-9A-Z]{5}", code):
            report["sqlstate"] = code
        if args.action == "apply" and operation_started:
            report["outcome"] = "committed_receipt_not_saved" if operation_returned else "check_read_only_plan_before_any_retry"
        print(json.dumps(report, sort_keys=True), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
