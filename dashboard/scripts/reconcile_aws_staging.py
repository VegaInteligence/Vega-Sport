"""Apply a checksum-pinned final source capture through the existing AWS writer.

This cutover utility reads only the private AWS capture. It has no source database
credentials or external fallback. The normal AWS publisher builds serving tables.
"""
import argparse
import gzip
import hashlib
import json
import os
import re

from psycopg import sql
from psycopg.types.json import Jsonb

PREFIX = "data/_migration/reconciliation/20261106T141500Z/"
LEASE = 97813003
SPECS = {
    "resources": (("endpoint", "params"), ("endpoint", "params", "status", "ref", "error", "updated_at"), {"ref", "error"}),
    "fixtures": (("id",), ("id", "league_id", "season", "day", "status", "body", "updated_at"), {"body"}),
    "projections": (("name", "params"), ("name", "params", "body", "updated_at"), {"body"}),
    "assets": (("url",), ("url", "path", "content_type"), set()),
}

def compact(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)

def verified(body, expected, size=None):
    if not re.fullmatch(r"[a-f0-9]{64}", expected or "") or hashlib.sha256(body).hexdigest() != expected:
        raise ValueError("Captured content checksum mismatch")
    if size is not None and len(body) != size:
        raise ValueError("Captured content size mismatch")
    return body

def stage_rows(db, kind, rows):
    if kind not in SPECS:
        raise ValueError("Unsupported staging table")
    keys, columns, json_columns = SPECS[kind]
    target = sql.Identifier("statarena", kind)
    staged = sql.Identifier("_statarena_delta_" + kind)
    names = sql.SQL(",").join(map(sql.Identifier, columns))
    if any(set(row) != set(columns) for row in rows):
        raise ValueError("Unexpected captured columns")
    if len({tuple(row[key] for key in keys) for row in rows}) != len(rows):
        raise ValueError("Duplicate captured primary key")
    with db.cursor() as cursor:
        cursor.execute(sql.SQL("CREATE TEMP TABLE {} AS SELECT {} FROM {} WITH NO DATA").format(staged, names, target))
        with cursor.copy(sql.SQL("COPY {} ({}) FROM STDIN").format(staged, names)) as copy:
            for row in rows:
                copy.write_row(tuple(Jsonb(row[key]) if key in json_columns and row[key] is not None else row[key] for key in columns))
    equality = sql.SQL(" AND ").join(sql.SQL("t.{}=s.{}").format(sql.Identifier(k), sql.Identifier(k)) for k in keys)
    comparable = [k for k in columns if k not in keys and k != "updated_at"]
    changed = sql.SQL("ROW({}) IS DISTINCT FROM ROW({})").format(
        sql.SQL(",").join(sql.Identifier("t", k) for k in comparable),
        sql.SQL(",").join(sql.Identifier("s", k) for k in comparable))
    result = db.execute(sql.SQL("SELECT count(*) FILTER(WHERE t.{} IS NULL), count(*) FILTER(WHERE t.{} IS NOT NULL AND ({})) FROM {} s LEFT JOIN {} t ON {}").format(
        sql.Identifier(keys[0]), sql.Identifier(keys[0]), changed, staged, target, equality)).fetchone()
    return {"rows": len(rows), "new": result[0], "changed": result[1]}

def apply_staged(db, captured_at):
    """Caller owns the writer lease and one transaction for every metadata table."""
    result = {}
    for kind, (keys, columns, _) in SPECS.items():
        target = sql.Identifier("statarena", kind)
        staged = sql.Identifier("_statarena_delta_" + kind)
        names = sql.SQL(",").join(map(sql.Identifier, columns))
        equality = sql.SQL(" AND ").join(sql.SQL("t.{}=s.{}").format(sql.Identifier(k), sql.Identifier(k)) for k in keys)
        fields = [k for k in columns if k not in keys and k != "updated_at"]
        changed = sql.SQL("ROW({}) IS DISTINCT FROM ROW({})").format(
            sql.SQL(",").join(sql.Identifier("t", k) for k in fields),
            sql.SQL(",").join(sql.Identifier("s", k) for k in fields))
        if "updated_at" in columns:
            concurrent = db.execute(sql.SQL("SELECT count(*) FROM {} s JOIN {} t ON {} WHERE t.updated_at>%s AND ({})").format(staged, target, equality, changed), (captured_at,)).fetchone()[0]
            if concurrent:
                raise ValueError("AWS source changed after the capture: " + kind)
        assignments = sql.SQL(",").join(sql.SQL("{}=excluded.{}").format(sql.Identifier(k), sql.Identifier(k)) for k in columns if k not in keys)
        conflict_change = sql.SQL("ROW({}) IS DISTINCT FROM ROW({})").format(
            sql.SQL(",").join(sql.Identifier("existing", k) for k in fields),
            sql.SQL(",").join(sql.Identifier("excluded", k) for k in fields))
        result[kind] = db.execute(sql.SQL("INSERT INTO {} AS existing ({}) SELECT {} FROM {} WHERE true ON CONFLICT ({}) DO UPDATE SET {} WHERE {}").format(
            target, names, names, staged, sql.SQL(",").join(map(sql.Identifier, keys)), assignments, conflict_change)).rowcount
    return result

def run(store, manifest_key, expected_sha, apply=False):
    if store.bucket != "statarena-football-333rosky-70db6e5f":
        raise ValueError("Unexpected AWS data bucket")
    if store.db.execute("SELECT current_database(),current_user").fetchone() != ("statarena_prod", "statarena_ingest"):
        raise ValueError("Expected the existing StatArena ingestion writer")
    if manifest_key != PREFIX + "manifest.json":
        raise ValueError("Unexpected private capture")
    def read(key, sha, size=None):
        if not key.startswith(PREFIX) or ".." in key.split("/"):
            raise ValueError("Capture path outside the reviewed prefix")
        response = store.s3.get_object(Bucket=store.bucket, Key=key)
        try:
            body = response["Body"].read(128 * 1024 * 1024 + 1)
        finally:
            response["Body"].close()
        if len(body) > 128 * 1024 * 1024:
            raise ValueError("Capture object exceeds the bounded import size")
        return verified(body, sha, size)
    manifest = json.loads(read(manifest_key, expected_sha))
    if manifest.get("format") != "statarena-staging-delta-v1" or manifest.get("source_project") != "sweet-queen-11955006" or manifest.get("source_branch") != "br-mute-bonus-be23014e" or manifest.get("source_database") != "neondb":
        raise ValueError("Unexpected source capture identity")
    if set(manifest["tables"]) != {"objects", *SPECS} or manifest.get("objects_prefix") != PREFIX + "objects/":
        raise ValueError("Unexpected capture tables or object location")
    records = {}
    for kind, meta in manifest["tables"].items():
        rows = json.loads(gzip.decompress(read(meta["key"], meta["sha256"], meta["bytes"])))
        if not isinstance(rows, list) or len(rows) != meta["rows"] or len(rows) > 50000:
            raise ValueError("Capture row count mismatch")
        records[kind] = rows
    objects = records.pop("objects")
    for row in objects:
        if set(row) != {"path", "size", "sha256", "etag", "content_type", "updated_at"} or not re.fullmatch(r"[a-f0-9]{64}", row["sha256"]) or not 0 <= row["size"] <= 128 * 1024 * 1024:
            raise ValueError("Invalid captured object metadata")
        if not re.match(r"^(raw|computed)/", row["path"]) or ".." in row["path"].split("/"):
            raise ValueError("Object outside the application data prefixes")
    if len({row["path"] for row in objects}) != len(objects):
        raise ValueError("Duplicate captured object path")
    db = store.db
    if not db.execute("SELECT pg_try_advisory_lock(%s)", (LEASE,)).fetchone()[0]:
        raise RuntimeError("The AWS writer lease is busy")
    try:
        before = {path: (size, sha, content_type) for path, size, sha, content_type in db.execute(
            "SELECT path,size,encode(sha256,'hex'),content_type FROM statarena.objects WHERE path=ANY(%s)", ([row["path"] for row in objects],))}
        changed_objects = [row for row in objects if before.get(row["path"]) != (row["size"], row["sha256"], row["content_type"])]
        plan = {kind: stage_rows(db, kind, rows) for kind, rows in records.items()}
        report = {"capture_sha256": expected_sha, "captured_at": manifest["captured_at"], "objects": len(objects),
            "changed_objects": len(changed_objects), "changed_object_bytes": sum(row["size"] for row in changed_objects), "tables": plan, "applied": False}
        print(compact({"phase": "reconciliation-plan", **report}), flush=True)
        if not apply:
            return report
        for index, row in enumerate(changed_objects, 1):
            body = read(PREFIX + "objects/" + row["sha256"], row["sha256"], row["size"])
            store.put(row["path"], body, row["content_type"])
            if index % 500 == 0:
                print(compact({"phase": "verified-objects-applied", "completed": index, "total": len(changed_objects)}), flush=True)
        with db.transaction():
            report["updated_rows"] = apply_staged(db, manifest["captured_at"])
        report["applied"] = True
        print(compact({"phase": "reconciliation-complete", **report}), flush=True)
        return report
    finally:
        db.execute("SELECT pg_advisory_unlock(%s)", (LEASE,))

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--sha256", required=True)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    if os.environ.get("GITHUB_ACTIONS") != "true" or os.environ.get("STATARENA_DATA_PROVIDER") != "aws":
        raise SystemExit("Use the existing AWS ingestion workflow")
    from aws_store import Store
    store = Store()
    try:
        run(store, args.manifest, args.sha256, args.apply)
    finally:
        store.db.close()

if __name__ == "__main__":
    main()
