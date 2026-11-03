#!/usr/bin/env python3
"""Compare every original catalog row to the verified transfer inventory."""

import argparse, json, os, sqlite3
from pathlib import Path
import psycopg

p = argparse.ArgumentParser()
p.add_argument("--inventory", required=True)
p.add_argument("--report", required=True)
a = p.parse_args()
db = psycopg.connect(os.environ["NEON_DATABASE_URL"])
source = sqlite3.connect(a.inventory)
actual = {
    path: (size, sha)
    for path, size, sha in db.execute(
        "select path,size,encode(sha256,'hex') from statarena.objects"
    )
}
errors = []
versioned = []
count = total = 0
for path, size, sha in source.execute(
    "select path,size,sha256 from files order by path"
):
    path = path.removeprefix("data/")
    count += 1
    total += size
    if actual.get(path) != (size, sha):
        archive = (
            "raw/neon/versions/"
            + sha
            + (".json.gz" if path.endswith(".gz") else ".json")
        )
        if actual.get(archive) == (size, sha):
            versioned.append({"sourcePath": path, "archivePath": archive})
            continue
        errors.append(
            {"path": path, "expected": [size, sha], "actual": actual.get(path)}
        )
report = {
    "setup": "Verified per-file SQLite receipt from the original transfer; live PostgreSQL catalog.",
    "command": "NEON_DATABASE_URL=<admin URL> python dashboard/scripts/verify_neon_catalog.py --inventory /tmp/statarena-neon-file-layout/progress.sqlite --report docs/verification/neon-runtime-20261103/catalog-integrity.json",
    "expected": "Every original path, size and SHA-256 matches; no missing resource references; runtime cannot write.",
    "originalFiles": count,
    "originalBytes": total,
    "catalogFiles": len(actual),
    "mismatches": errors,
    "versionedSources": versioned,
}
report["missingResourceObjects"] = db.execute(
    "select count(*) from statarena.resources r left join statarena.objects o on o.path=r.ref->>'path' where r.ref->>'path' is not null and o.path is null"
).fetchone()[0]
report["runtimeCanWrite"] = db.execute(
    "select has_table_privilege('statarena_runtime','statarena.objects','INSERT')"
).fetchone()[0]
report["databaseBytes"] = db.execute(
    "select pg_database_size(current_database())"
).fetchone()[0]
report["plans"] = {}
for name, sql in [
    (
        "object",
        "select path,size,body from statarena.objects where path='computed/dashboard/index.json'",
    ),
    (
        "resource",
        "select status,ref from statarena.resources where endpoint='/players/p_01fuwy' and params='{}'",
    ),
    ("date", "select body from statarena.fixtures where day='2026-11-03' order by id"),
    (
        "league",
        "select body from statarena.fixtures where league_id='l_4d6Bwl' and season='2026/2027' order by day,id",
    ),
]:
    report["plans"][name] = db.execute(
        "explain(analyze,buffers,format json) " + sql
    ).fetchone()[0]
report["status"] = (
    "passed"
    if not errors
    and report["originalFiles"] == 250748
    and report["originalBytes"] == 2692640453
    and report["missingResourceObjects"] == 0
    and not report["runtimeCanWrite"]
    else "failed"
)
Path(a.report).write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps({k: v for k, v in report.items() if k != "plans"}))
db.close()
assert report["status"] == "passed"
