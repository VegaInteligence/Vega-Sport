#!/usr/bin/env python3
"""Delete only local data files whose exact bytes have a verified Neon receipt."""

import argparse, concurrent.futures, hashlib, json, os
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument("--root", required=True)
p.add_argument("--canonical", required=True)
p.add_argument("--extras", required=True)
p.add_argument("--versions", required=True)
p.add_argument("--report", required=True)
p.add_argument("--delete", action="store_true")
a = p.parse_args()
root = Path(a.root).resolve()
assert (
    root
    == Path(
        "/Users/lemonnierhugo/Desktop/Coding Project/Football_ranking/data"
    ).resolve()
)
canonical = json.load(open(a.canonical))
extras = json.load(open(a.extras))
versions = json.load(open(a.versions))
candidates = {}
for row in canonical["files"]:
    if row["state"] == "verified":
        candidates[row["path"]] = row
for report in [extras, versions]:
    for row in report["files"]:
        if row["state"] in ["backed-up", "verified-identical"]:
            candidates[row["path"]] = row
for name in [
    "catalog-integrity-final.json",
    "final-deployment-http.json",
    "final-deployment-browser.json",
]:
    r = json.load(open(Path(a.report).parent / name))
    assert r["status"] == "passed", name


def inspect(row):
    path = Path(row["path"])
    assert path.is_relative_to(root) and not path.is_symlink()
    if not path.exists():
        return {"path": str(path), "state": "already-absent"}
    st = path.stat()
    if st.st_flags & 0x40000000:
        return {
            "path": str(path),
            "state": "preserved-cloud-placeholder",
            "allocated": 0,
        }
    sha = hashlib.sha256()
    with path.open("rb") as f:
        while chunk := f.read(1024 * 1024):
            sha.update(chunk)
    if sha.hexdigest() != row["sha256"]:
        return {"path": str(path), "state": "preserved-changed", "size": st.st_size}
    return {
        "path": str(path),
        "state": "verified",
        "sha256": row["sha256"],
        "size": st.st_size,
        "allocated": st.st_blocks * 512,
    }


with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
    rows = list(pool.map(inspect, candidates.values()))
changed = [r for r in rows if r["state"] == "preserved-changed"]
# A changed file is never deleted. Require the complete preflight before Git checkout.
if a.delete and changed:
    raise RuntimeError(
        "Local files changed since backup; preserve and back them up first"
    )
removed = removed_bytes = 0
if a.delete:
    for row in rows:
        if row["state"] == "verified":
            Path(row["path"]).unlink()
            removed += 1
            removed_bytes += row["allocated"]
            row["state"] = "deleted"
    for base, dirs, files in os.walk(root, topdown=False):
        try:
            Path(base).rmdir()
        except OSError:
            pass
remaining = []
remaining_count = 0
for base, dirs, files in os.walk(root):
    for name in files:
        f = Path(base) / name
        st = f.stat()
        remaining_count += 1
        if not a.delete and str(f) in candidates:
            continue
        remaining.append(
            {"path": str(f), "size": st.st_size, "allocated": st.st_blocks * 512}
        )
result = {
    "command": "python dashboard/scripts/cleanup_verified_neon_local.py --root <Football_ranking/data> --canonical /tmp/statarena-neon-local-canonical-verified.json --extras docs/verification/neon-runtime-20261103/local-extra-backup.json --versions docs/verification/neon-runtime-20261103/local-versions-backup.json --report docs/verification/neon-runtime-20261103/local-cleanup.json --delete",
    "expected": "Delete only exact verified backups after live Neon validation; preserve changes and unverified iCloud material.",
    "mode": "delete" if a.delete else "preflight",
    "candidateFiles": len(candidates),
    "verifiedFiles": sum(r["state"] in ["verified", "deleted"] for r in rows),
    "alreadyAbsent": sum(r["state"] == "already-absent" for r in rows),
    "changed": changed,
    "deletedFiles": removed,
    "deletedAllocatedBytes": removed_bytes,
    "remaining": remaining,
    "remainingFileCount": remaining_count,
    "status": "passed" if not changed else "partial",
}
Path(a.report).write_text(json.dumps(result, indent=2) + "\n")
Path("/tmp/statarena-neon-local-cleanup-detail.json").write_text(json.dumps(rows))
print(json.dumps({k: v for k, v in result.items() if k != "remaining"}))
