#!/usr/bin/env python3
"""Import verified object metadata and serving indexes, without fetching Pitch API."""

import argparse, sqlite3, json, gzip, hashlib, os
from pathlib import Path
import psycopg
from psycopg.types.json import Jsonb


def unpack(t):
    result = []
    for i, row in enumerate(t["rows"]):
        missing = t.get("missing", {}).get(str(i), [])
        d = t.get("dictionaries", {})
        result.append(
            {
                k: (d[str(j)][row[j]] if str(j) in d and row[j] is not None else row[j])
                for j, k in enumerate(t["keys"])
                if j not in missing
            }
        )
    return result


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--inventory", required=True)
    p.add_argument("--files", required=True)
    p.add_argument("--report", required=True)
    a = p.parse_args()
    root = Path(a.files)
    db = psycopg.connect(os.environ["NEON_DATABASE_URL"])
    db.execute(
        (Path(__file__).parents[1] / "backend/migrations/001_neon.sql").read_text()
    )
    db.commit()
    db.execute(
        "create temporary table import_objects (like statarena.objects including defaults)"
    )
    source = sqlite3.connect(a.inventory)
    with db.cursor().copy(
        "copy import_objects(path,size,sha256,etag,body,content_type) from stdin"
    ) as c:
        for path, size, sha, etag in source.execute(
            "select path,size,sha256,etag from files order by path"
        ):
            f = root / path
            b = f.read_bytes() if f.is_file() and "checkpoints/" not in path else None
            if b is not None and hashlib.sha256(b).hexdigest() != sha:
                raise ValueError("Bootstrap source mismatch " + path)
            c.write_row(
                (
                    path.removeprefix("data/"),
                    size,
                    bytes.fromhex(sha),
                    etag,
                    b,
                    "application/gzip" if path.endswith(".gz") else "application/json",
                )
            )
    db.execute(
        "insert into statarena.objects select * from import_objects on conflict(path) do update set body=excluded.body where statarena.objects.sha256=excluded.sha256"
    )
    db.commit()
    print("catalog imported", flush=True)
    shards = json.loads((root / "data/raw/observation-shards.json").read_bytes())
    observations = json.loads((root / "data/raw/match-observations.json").read_bytes())
    db.execute("create temporary table import_shards (like statarena.shards)")
    with db.cursor().copy("copy import_shards(id,ref) from stdin") as c:
        for k, v in shards.items():
            c.write_row((k, Jsonb(v)))
    db.execute(
        "insert into statarena.shards select * from import_shards on conflict do nothing"
    )
    db.execute(
        "create temporary table import_observations (like statarena.observations)"
    )
    with db.cursor().copy("copy import_observations(id,shard,ordinal) from stdin") as c:
        for k, vs in observations.items():
            v = max(vs, key=lambda v: v.get("retrievedAt") or "")
            c.write_row((k, v["shard"], v["ordinal"]))
    db.execute(
        "insert into statarena.observations select * from import_observations on conflict do nothing"
    )
    db.commit()
    db.execute(
        "create temporary table import_resources (like statarena.resources including defaults)"
    )
    with db.cursor().copy(
        "copy import_resources(endpoint,params,status,ref,error) from stdin"
    ) as c:
        for f in sorted((root / "data/raw/pitchapi-world/checkpoints").glob("*.gz")):
            for _, endpoint, params, priority, state, status, ref, error in json.loads(
                gzip.decompress(f.read_bytes())
            ):
                if status:
                    c.write_row(
                        (
                            endpoint,
                            params,
                            status,
                            Jsonb(json.loads(ref)) if ref else None,
                            Jsonb(json.loads(error)) if error else None,
                        )
                    )
    db.execute(
        "insert into statarena.resources select * from import_resources on conflict do nothing"
    )
    db.commit()
    profiles = json.loads((root / "data/raw/profile-index.json").read_bytes())[
        "entities"
    ]
    db.execute("delete from import_resources")
    with db.cursor().copy("copy import_resources(endpoint,status,ref) from stdin") as c:
        for key, versions in profiles.items():
            v = max(versions, key=lambda v: v.get("retrievedAt") or "")
            c.write_row(
                (
                    "/" + key.replace(":", "/"),
                    200,
                    Jsonb({"path": v["path"], "ordinal": v["ordinal"]}),
                )
            )
    db.execute(
        "insert into statarena.resources select * from import_resources on conflict do nothing"
    )
    db.commit()
    print("resource indexes imported", flush=True)
    fixtures = {}
    for f in sorted((root / "data/computed/dashboard").glob("*/*.gz")):
        doc = json.loads(gzip.decompress(f.read_bytes()))
        table = doc.get("tables", {}).get("fixtures")
        if not table:
            continue
        for m in unpack(table):
            if m.get("id"):
                fixtures[m["id"]] = m
    db.execute(
        "create temporary table import_fixtures (like statarena.fixtures including defaults)"
    )
    with db.cursor().copy(
        "copy import_fixtures(id,league_id,season,day,status,body) from stdin"
    ) as c:
        for mid, m in fixtures.items():
            league = (m.get("league") or {}).get("id") or m.get("league_id")
            if league:
                c.write_row(
                    (
                        mid,
                        league,
                        str(m.get("season", "")),
                        m.get("date") or (m.get("time_utc") or "")[:10] or None,
                        m.get("status"),
                        Jsonb(m),
                    )
                )
    db.execute(
        "insert into statarena.fixtures select * from import_fixtures on conflict do nothing"
    )
    db.execute(
        "insert into statarena.state(name,value) values('bootstrap',%s) on conflict(name) do update set value=excluded.value",
        (
            Jsonb(
                {
                    "source": "579b47107e0cd4fa4f9a12a5a95dd6a1be274ed9",
                    "verifiedFiles": 250748,
                }
            ),
        ),
    )
    db.commit()
    db.execute("analyze statarena.objects")
    db.execute("analyze statarena.resources")
    db.execute("analyze statarena.fixtures")
    db.commit()
    report = {
        t: db.execute("select count(*) from statarena." + t).fetchone()[0]
        for t in ["objects", "resources", "observations", "shards", "fixtures"]
    }
    report["databaseBytes"] = db.execute(
        "select pg_database_size(current_database())"
    ).fetchone()[0]
    report["objectBytes"] = db.execute(
        "select sum(size) from statarena.objects"
    ).fetchone()[0]
    Path(a.report).write_text(json.dumps(report, indent=2, default=str) + "\n")
    print(json.dumps(report, default=str), flush=True)


if __name__ == "__main__":
    main()
