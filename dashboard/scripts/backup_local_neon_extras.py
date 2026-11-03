#!/usr/bin/env python3
"""Back up additional local migration data at original keys before SSD cleanup."""

import argparse, base64, concurrent.futures, hashlib, json, os, re, sqlite3, threading, psycopg
from pathlib import Path
from neon_store import Store

p = argparse.ArgumentParser()
p.add_argument("--root", required=True)
p.add_argument("--inventory", required=True)
p.add_argument("--report", required=True)
p.add_argument("--prefix", default="")
a = p.parse_args()
root = Path(a.root).resolve()
inventory = json.load(open(a.inventory))
store = Store()
source = sqlite3.connect("/tmp/statarena-neon-file-layout/progress.sqlite")
known = {
    sha: (path, size)
    for path, size, sha in source.execute("select path,size,sha256 from files")
}
rows = []
lock = threading.Lock()
fail = []
remaining = 4_750_000_000 - int(
    store.db.execute("select sum(size) from statarena.objects").fetchone()[0]
)
assert inventory["unknownBytes"] < remaining, (
    "Additional backup exceeds free storage headroom"
)


def transfer(item):
    path = Path(item["path"])
    assert path.is_relative_to(root) and not path.is_symlink()
    if item["dataless"]:
        return {
            "path": str(path),
            "state": "preserved-cloud-placeholder",
            "size": item["size"],
        }
    sha = hashlib.sha256()
    md5 = hashlib.md5()
    tail = b""
    with path.open("rb") as f:
        while chunk := f.read(1024 * 1024):
            if re.search(rb"pk_(?:live|test)_[A-Za-z0-9_-]{12,}", tail + chunk):
                raise ValueError("Credential-like material; preserve locally")
            tail = chunk[-512:]
            sha.update(chunk)
            md5.update(chunk)
    digest = sha.hexdigest()
    relative = (
        "data/"
        + (a.prefix.strip("/") + "/" if a.prefix else "")
        + path.relative_to(root).as_posix()
    )
    if digest in known:
        return {
            "path": str(path),
            "state": "verified-identical",
            "size": item["size"],
            "sha256": digest,
            "neonKey": known[digest][0],
        }
    # Restore paths exactly, even ignored staging files and collector state.
    try:
        result = store.s3.head_object(Bucket=store.bucket, Key=relative)
    except Exception:
        result = {}
    if (
        result.get("ETag", "").strip('"') != md5.hexdigest()
        or result.get("ContentLength", item["size"]) != item["size"]
    ):
        with path.open("rb") as f:
            result = store.s3.put_object(
                Bucket=store.bucket,
                Key=relative,
                Body=f,
                ContentMD5=base64.b64encode(md5.digest()).decode(),
                ContentType="application/octet-stream",
            )
    if result["ETag"].strip('"') != md5.hexdigest():
        raise ValueError("Server checksum mismatch")
    # Independent GET verifies full bytes, including the old SQLite queue.
    check = hashlib.sha256()
    body = store.s3.get_object(Bucket=store.bucket, Key=relative)["Body"]
    size = 0
    for chunk in body.iter_chunks(1024 * 1024):
        check.update(chunk)
        size += len(chunk)
    if check.hexdigest() != digest or size != item["size"]:
        raise ValueError("Download checksum mismatch")
    return {
        "path": str(path),
        "state": "backed-up",
        "size": size,
        "sha256": digest,
        "etag": md5.hexdigest(),
        "neonKey": relative,
    }


with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
    futures = {pool.submit(transfer, item): item for item in inventory["unknownFiles"]}
    for future in concurrent.futures.as_completed(futures):
        item = futures[future]
        try:
            row = future.result()
            rows.append(row)
            with open("/tmp/statarena-neon-extras-progress.jsonl", "a") as receipt:
                receipt.write(json.dumps(row) + "\n")
        except Exception as e:
            fail.append({"path": item["path"], "error": str(e)})
        if len(rows) % 250 == 0:
            print("Verified extra files", len(rows), flush=True)
store.db.close()
store.db = psycopg.connect(
    os.environ["NEON_DATABASE_URL"], autocommit=True, connect_timeout=15
)
with store.db.transaction():
    store.db.execute(
        "create temporary table import_extras(path text,size bigint,sha256 bytea,etag text) on commit drop"
    )
    with store.db.cursor().copy("copy import_extras from stdin") as copy:
        for row in rows:
            if row["state"] == "backed-up":
                copy.write_row(
                    (
                        row["neonKey"].removeprefix("data/"),
                        row["size"],
                        bytes.fromhex(row["sha256"]),
                        row["etag"],
                    )
                )
    store.db.execute(
        "insert into statarena.objects(path,size,sha256,etag,content_type) select path,size,sha256,etag,'application/octet-stream' from import_extras on conflict do nothing"
    )
report = {
    "command": "NEON_DATABASE_URL=<production writer> NEON_STORAGE_*=<production> python dashboard/scripts/backup_local_neon_extras.py --root <Football_ranking/data> --inventory /tmp/statarena-neon-local-inventory.json --report docs/verification/neon-runtime-20261103/local-extra-backup.json",
    "expected": "Every unique materialized local file uploaded under its original key, server MD5 and independent GET SHA-256 verified before deletion.",
    "files": rows,
    "failures": fail,
    "status": "passed"
    if not fail and all(r["state"] != "preserved-cloud-placeholder" for r in rows)
    else "partial",
}
Path(a.report).write_text(json.dumps(report, indent=2) + "\n")
print(
    json.dumps(
        {
            "status": report["status"],
            "files": len(rows),
            "failures": len(fail),
            "uploadedBytes": sum(r["size"] for r in rows if r["state"] == "backed-up"),
        }
    )
)
