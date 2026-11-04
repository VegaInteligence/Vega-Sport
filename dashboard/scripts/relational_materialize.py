"""Publish typed website tables from verified AWS staging inputs under the ingestion lease."""

import argparse
import hashlib
import json
import os
import re
import sqlite3
import subprocess
import sys
import tempfile
import time
from contextlib import closing
from pathlib import Path

import psycopg
from bootstrap_neon import unpack
from build_dashboard_data import METRICS
from neon_materialize import competition_metadata, merge_sample
from relational_catalog import publish_catalog
from relational_catalog_keys import records as catalog_records
from relational_core import publish_snapshot
from relational_match import (
    _PARENT_SUFFIXES,
    _resource_address,
    publish_match_batch,
)
from relational_snapshot import TABLES, read_partition, snapshot
from relational_support import FAMILIES, publish_supporting

ROOT = Path(__file__).resolve().parents[2]
SCHEMA = ROOT / "dashboard/backend/migrations"
INDEX = "computed/dashboard/index.json"
LEASE = 97813003
CATALOG_PATHS = r"^(raw/(supplemental-index\.json$|cup-worker/|rankings/|openfootball/|historical-goals/|seasons/[^/]+/supplemental_(results|fixtures|goals)/)|computed/matchdays/).*\.json(\.gz)?$"
PROFILE = r"^/(leagues|teams|players)(/[ltp]_[A-Za-z0-9]{6})?$"
MESSI = ("player-honours", '{"id":"p_1mZO3B"}')


def compact(value):
    return json.dumps(
        value,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
        allow_nan=False,
    )


def capacity(db, growth=0):
    limit = int(os.environ.get("STATARENA_SQL_LIMIT_BYTES") or 16_000_000_000)
    margin = int(os.environ.get("STATARENA_SQL_RESERVE_BYTES") or 256_000_000)
    headroom = (
        limit
        - margin
        - db.execute("SELECT pg_database_size(current_database())").fetchone()[0]
    )
    if limit <= 0 or margin < 0 or growth > headroom:
        raise RuntimeError("RDS publication capacity exceeded; queued inputs retained")
    return headroom


def install(db):
    with db.transaction():
        # PostgreSQL checks database CREATE even for CREATE SCHEMA IF NOT EXISTS.
        # A precreated application schema requires only its owner's schema privileges.
        if not db.execute("SELECT to_regnamespace('statarena_app')").fetchone()[0]:
            db.execute("CREATE SCHEMA statarena_app")
        db.execute(
            "CREATE TABLE IF NOT EXISTS statarena_app.worker_schema(version text PRIMARY KEY,digest text NOT NULL)"
        )
        for prefix in ("003_", "004_", "005_", "006_"):
            (path,) = SCHEMA.glob(prefix + "*.sql")
            source = path.read_bytes()
            digest = hashlib.sha256(source).hexdigest()
            prior = db.execute(
                "SELECT digest FROM statarena_app.worker_schema WHERE version=%s",
                (path.name,),
            ).fetchone()
            if prior:
                if prior[0] != digest:
                    raise RuntimeError(f"Applied migration changed: {path.name}")
                continue
            db.execute(
                source.decode().replace(
                    "CREATE SCHEMA IF NOT EXISTS statarena_app;", "", 1
                )
            )
            db.execute(
                "INSERT INTO statarena_app.worker_schema VALUES(%s,%s)",
                (path.name, digest),
            )
        db.execute(
            "CREATE TABLE IF NOT EXISTS statarena_app.worker_inputs(kind text NOT NULL,key text NOT NULL,digest text NOT NULL,PRIMARY KEY(kind,key))"
        )


def receipt(db, kind, key, digest):
    db.execute(
        """INSERT INTO statarena_app.worker_inputs VALUES(%s,%s,%s)
      ON CONFLICT(kind,key) DO UPDATE SET digest=excluded.digest WHERE worker_inputs.digest IS DISTINCT FROM excluded.digest""",
        (kind, key, digest),
    )


class Inputs:
    def __init__(self, store):
        self.store, self.db = store, store.db

    def read(self, path, expected=None):
        row = self.db.execute(
            """SELECT encode(o.sha256,'hex'),d.document FROM statarena.objects o
          LEFT JOIN statarena.current_file_documents d ON d.document_path=o.path AND d.source_path=o.path
          WHERE o.path=%s""",
            (path,),
        ).fetchone()
        if not row:
            raise FileNotFoundError(path)
        # The original worldwide collector names these blobs by the uncompressed
        # canonical JSON SHA. The staging object catalog tracks the gzip bytes.
        logical = expected and row[0] != expected
        if logical and not (
            re.fullmatch(r"[0-9a-f]{64}", expected)
            and path == f"raw/pitchapi-world/blobs/{expected}.json.gz"
        ):
            raise ValueError("Staging reference version changed: " + path)
        value = row[1]
        if value is None:
            # Store.json verifies length and physical SHA when the index is absent.
            value = self.store.json(path)
            if self.db.execute(
                "SELECT encode(sha256,'hex') FROM statarena.objects WHERE path=%s", (path,)
            ).fetchone() != (row[0],):
                raise ValueError("Staging input changed during fallback: " + path)
        if logical and hashlib.sha256(compact(value).encode()).hexdigest() != expected:
            raise ValueError("Staging logical checksum mismatch: " + path)
        return value

    def ref(self, ref):
        return self.read(ref["path"], ref.get("sha256"))


def envelope(source, ref, status, error):
    if not ref:
        return {"status": status, "error": error, "data": None}
    if "ordinal" in ref:
        source = source[ref["ordinal"]]
    if "documentId" in ref:
        source = next(r for r in source if r["documentId"] == ref["documentId"])
    doc = source.get("observation", source.get("response", source))
    # Some older collection rows wrap a response in an observation.
    doc = doc.get("response", doc)
    return {
        "status": status,
        "data": doc.get("data"),
        "error": error or doc.get("error"),
    }


def prepare(inputs, manifest, queue_all):
    db = inputs.db
    known = {(s["id"], c["leagueId"]) for s in manifest["seasons"] for c in s["chunks"]}
    with db.transaction():
        for name in (
            "work_known",
            "work_matches",
            "work_resources",
            "work_scopes",
            "work_catalog",
            "work_shards",
            "work_dirty",
        ):
            db.execute(f"DROP TABLE IF EXISTS pg_temp.{name}")
        staging_bytes = db.execute("""SELECT sum(pg_table_size(rel))::bigint FROM unnest(ARRAY[
            'statarena.resources'::regclass,'statarena.fixtures'::regclass,'statarena.shards'::regclass,
            'statarena.observations'::regclass]) rel""").fetchone()[0]
        capacity(db, staging_bytes * 2)
        db.execute(
            "CREATE TEMP TABLE work_dirty AS SELECT * FROM statarena.dirty_partitions"
        )
        db.execute(
            "CREATE TEMP TABLE work_known(season text,league_id text,PRIMARY KEY(season,league_id))"
        )
        with db.cursor() as cur:
            cur.executemany("INSERT INTO work_known VALUES(%s,%s)", sorted(known))
        db.execute("""CREATE TEMP TABLE work_resources AS SELECT r.*,r.xmin::text AS row_revision,split_part(endpoint,'/',3) AS mid,
            encode(o.sha256,'hex') AS object_digest FROM statarena.resources r LEFT JOIN statarena.objects o ON o.path=r.ref->>'path'
            WHERE starts_with(endpoint,'/matches/')""")
        db.execute("CREATE INDEX ON work_resources(mid)")
        db.execute("""CREATE TEMP TABLE work_shards AS SELECT s.id,md5(s.ref::text || coalesce(string_agg(
            path||coalesce(encode(o.sha256,'hex'),''),'|' ORDER BY path),'')) AS stamp
            FROM statarena.shards s LEFT JOIN LATERAL (SELECT s.ref#>>'{document,path}' AS path UNION ALL
            SELECT value->>'path' FROM jsonb_each(s.ref->'tables')) refs ON true
            LEFT JOIN statarena.objects o USING(path) GROUP BY s.id,s.ref""")
        db.execute("""CREATE TEMP TABLE work_matches AS SELECT f.id,f.league_id,
            CASE WHEN k.season IS NULL AND f.season ~ '^[0-9]{4}$' THEN f.season||'/'||(f.season::int+1)::text ELSE f.season END AS season,
            md5(f.xmin::text||f.updated_at::text||coalesce(o.shard,'')||coalesce(o.ordinal::text,'')||coalesce(s.stamp,'')||coalesce(r.stamp,'')) AS stamp
            FROM statarena.fixtures f LEFT JOIN work_known k ON (k.season,k.league_id)=(f.season,f.league_id)
            LEFT JOIN statarena.observations o ON o.id=f.id LEFT JOIN work_shards s ON s.id=o.shard
            LEFT JOIN (SELECT mid,md5(string_agg(md5(endpoint||params||row_revision||status::text||updated_at::text||coalesce(ref::text,'')||
            coalesce(error::text,'')||coalesce(object_digest,'')),'' ORDER BY endpoint,params)) AS stamp FROM work_resources GROUP BY mid) r ON r.mid=f.id
            WHERE f.season ~ '^[0-9]{4}(/[0-9]{4})?$'""")
        db.execute("CREATE UNIQUE INDEX ON work_matches(id)")
        db.execute("CREATE INDEX ON work_matches(season,league_id)")
        # Saved match endpoints without an eligible fixture still have typed detail readers.
        db.execute("""INSERT INTO work_matches SELECT r.mid,'@details-'||substr(md5(r.mid),1,2),'@details',
            md5(string_agg(md5(r.endpoint||r.params||r.row_revision||r.status::text||r.updated_at::text||coalesce(r.ref::text,'')||coalesce(r.error::text,'')||coalesce(r.object_digest,'')),''
            ORDER BY r.endpoint,r.params)) FROM work_resources r WHERE r.mid ~ '^m_[A-Za-z0-9]{6}$'
            AND NOT EXISTS(SELECT 1 FROM work_matches f WHERE f.id=r.mid) GROUP BY r.mid""")
        db.execute("""INSERT INTO work_matches SELECT o.id,'@details-'||substr(md5(o.id),1,2),'@details',
            md5(o.shard||o.ordinal::text||s.stamp) FROM statarena.observations o JOIN work_shards s ON s.id=o.shard
            WHERE NOT EXISTS(SELECT 1 FROM work_matches w WHERE w.id=o.id AND w.season<>'@details')
            ON CONFLICT(id) DO UPDATE SET stamp=md5(work_matches.stamp||excluded.stamp)""")
        db.execute("""CREATE TEMP TABLE work_scopes AS SELECT w.season,w.league_id,
            md5(string_agg(w.id||w.stamp,'' ORDER BY w.id)||coalesce(p.xmin::text,'')||coalesce(encode(o.sha256,'hex'),'')) AS digest
            FROM work_matches w LEFT JOIN statarena.resources p ON p.endpoint='/leagues/'||w.league_id AND p.params='{}'
            LEFT JOIN statarena.objects o ON o.path=p.ref->>'path' GROUP BY w.season,w.league_id,p.xmin::text,o.sha256""")
        db.execute("CREATE UNIQUE INDEX ON work_scopes(season,league_id)")
        db.execute("""INSERT INTO statarena_app.publication_jobs(season,league_id) SELECT w.season,w.league_id FROM work_scopes w
            LEFT JOIN statarena_app.worker_inputs i ON i.kind='partition' AND i.key=w.season||':'||w.league_id
            WHERE i.digest IS DISTINCT FROM w.digest ON CONFLICT DO NOTHING""")
        db.execute("""INSERT INTO statarena_app.publication_jobs(season,league_id,changed_at) SELECT season,league_id,changed_at FROM work_dirty
            ON CONFLICT(season,league_id) DO UPDATE SET changed_at=excluded.changed_at WHERE publication_jobs.changed_at<excluded.changed_at""")
        if queue_all:
            db.execute("""INSERT INTO statarena_app.publication_jobs(season,league_id)
                SELECT season,league_id FROM work_known UNION SELECT season,league_id FROM work_scopes
                UNION SELECT season,league_id FROM statarena_app.partitions ON CONFLICT DO NOTHING""")
        db.execute(
            """CREATE TEMP TABLE work_catalog AS SELECT * FROM(
            SELECT 'object' kind,o.path AS key,encode(o.sha256,'hex') digest,NULL::jsonb ref,NULL::smallint status,NULL::jsonb error
              FROM statarena.objects o WHERE o.path ~ %s OR o.path='raw/supplemental-index.json'
            UNION ALL SELECT 'profile',r.endpoint,md5(r.xmin::text||r.updated_at::text||r.status::text||coalesce(r.ref::text,'')||coalesce(r.error::text,'')||coalesce(encode(o.sha256,'hex'),'')),r.ref,r.status,r.error
              FROM statarena.resources r LEFT JOIN statarena.objects o ON o.path=r.ref->>'path' WHERE r.params='{}' AND r.endpoint ~ %s) src
            WHERE NOT EXISTS(SELECT 1 FROM statarena_app.worker_inputs i WHERE (i.kind,i.key,i.digest)=(src.kind,src.key,src.digest))""",
            (CATALOG_PATHS, PROFILE),
        )
        db.execute("CREATE UNIQUE INDEX ON work_catalog(kind,key)")


def publish_global(db):
    with db.transaction():
        source = db.execute(
            "SELECT md5(coalesce(string_agg(name||params||xmin::text||updated_at::text,'' ORDER BY name,params),'')) FROM statarena.projections WHERE name=ANY(%s)",
            (list(FAMILIES),),
        ).fetchone()[0]
        curated = ROOT / "dashboard/scripts/materialize_curated.mjs"
        digest = (
            source
            + hashlib.sha256(
                curated.read_bytes()
                + (ROOT / "dashboard/shared/honour-display.js").read_bytes()
            ).hexdigest()
        )
        old = db.execute(
            "SELECT digest FROM statarena_app.worker_inputs WHERE kind='global' AND key='support'"
        ).fetchone()
        changed = 0
        if old != (digest,):
            rows = {
                (n, compact(json.loads(p))): (n, compact(json.loads(p)), b)
                for n, p, b in db.execute(
                    "SELECT name,params,body FROM statarena.projections WHERE name=ANY(%s)",
                    (list(FAMILIES),),
                )
            }
            initial = rows.get(MESSI, (None, None, None))[2]
            for item in json.loads(
                subprocess.run(
                    ["node", str(curated)],
                    input=compact(initial),
                    text=True,
                    capture_output=True,
                    check=True,
                    timeout=90,
                ).stdout
            ):
                key = (item["name"], compact(item["params"]))
                rows[key] = (*key, item["body"])
            capacity(db, sum(len(compact(r[2]).encode()) for r in rows.values()) * 2)
            changed = publish_supporting(db, rows.values())["changed"]
            receipt(db, "global", "support", digest)
        assets = db.execute("""INSERT INTO statarena_app.assets(url,path,content_type,size,sha256,etag,updated_at)
            SELECT a.url,a.path,a.content_type,o.size,encode(o.sha256,'hex'),o.etag,o.updated_at FROM statarena.assets a JOIN statarena.objects o ON o.path=a.path
            LEFT JOIN statarena_app.assets prior ON prior.url=a.url
            WHERE (prior.path,prior.content_type,prior.size,prior.sha256,prior.etag) IS DISTINCT FROM
                  (a.path,a.content_type,o.size,encode(o.sha256,'hex'),o.etag)
            ON CONFLICT(url) DO UPDATE SET path=excluded.path,content_type=excluded.content_type,size=excluded.size,sha256=excluded.sha256,etag=excluded.etag,updated_at=excluded.updated_at
            WHERE (assets.path,assets.content_type,assets.size,assets.sha256,assets.etag) IS DISTINCT FROM
                  (excluded.path,excluded.content_type,excluded.size,excluded.sha256,excluded.etag)""").rowcount
        if changed or assets:
            db.execute(
                "UPDATE statarena_app.publications SET generation=generation+1,published_at=clock_timestamp()"
            )
        capacity(db)
        return {"support_changed": changed, "assets_changed": assets}


def overlay_rounds(db, season, calendar, league=None):
    """Merge imported rounds with successfully published match detail, including zero/false flags."""
    result = {league: dict(games) for league, games in calendar.items()}
    sql = """SELECT f.league_id,f.id,s.round_name,s.has_playoff
        FROM statarena_app.fixtures f JOIN statarena_app.match_families r ON r.match_id=f.id
          AND r.family='match' AND r.subject_id='' AND r.params='{}' AND r.status=200
        JOIN statarena_app.match_summaries s USING(resource_id) WHERE f.season=%s AND s.round_name IS NOT NULL"""
    params = (season,)
    if league is not None:
        sql += " AND f.league_id=%s"
        params = (season, league)
    for scope, mid, round_name, playoff in db.execute(sql, params):
        result.setdefault(scope, {})[mid] = {
            "name": str(round_name),
            "playoff": playoff is True,
        }
    return result


def partition_calendar(inputs, label, league):
    db = inputs.db
    path = "computed/matchdays/" + label.replace("/", "-") + ".json.gz"
    row = db.execute(
        """SELECT statarena_app.read_cat_matchdays(m)->'matches' FROM statarena_app.catalog_editions c
        JOIN statarena_app.cat_matchdays m USING(resource_id) WHERE c.catalog='matchdays' AND c.scope=%s AND c.edition=%s""",
        (league, label),
    ).fetchone()
    if row:
        prior = {league: row[0]}
    else:
        exists = db.execute(
            "SELECT 1 FROM statarena.objects WHERE path=%s", (path,)
        ).fetchone()
        prior = {league: inputs.read(path).get(league, {})} if exists else {}
    merged = overlay_rounds(db, label, prior, league)
    if merged and (not row or merged != prior):
        publish_catalog(db, [(path, merged)])


def catalog_batch(inputs, limit):
    db = inputs.db
    with db.transaction():
        jobs = db.execute(
            "SELECT kind,key,digest,ref,status,error FROM work_catalog ORDER BY kind,key LIMIT %s",
            (limit,),
        ).fetchall()
        if not jobs:
            return 0
        headroom = capacity(db)

        def records():
            estimated = 0
            for kind, key, digest, ref, status, error in jobs:
                body = (
                    inputs.read(key, digest)
                    if kind == "object"
                    else envelope(inputs.ref(ref) if ref else None, ref, status, error)
                )
                estimated += len(compact(body).encode()) * 2
                if estimated > headroom:
                    raise RuntimeError(
                        "Catalog exceeds available RDS publication capacity"
                    )
                if key.startswith("computed/matchdays/"):
                    label = (
                        key.rsplit("/", 1)[1].removesuffix(".json.gz").replace("-", "/")
                    )
                    body = overlay_rounds(db, label, body)
                elif next(iter(catalog_records(key, body)), None) is None:
                    raise ValueError("Unmapped catalog input: " + key)
                yield key, body

        result = publish_catalog(db, records())
        for kind, key, digest, *_ in jobs:
            receipt(db, kind, key, digest)
        db.cursor().executemany(
            "DELETE FROM work_catalog WHERE kind=%s AND key=%s",
            [(r[0], r[1]) for r in jobs],
        )
        if result["changed"]:
            db.execute(
                "UPDATE statarena_app.publications SET generation=generation+1,published_at=clock_timestamp()"
            )
        capacity(db)
        return len(jobs)


def partition_inputs(inputs, scratch, mids):
    """Read each referenced object once; keep endpoint payloads in a job-local disk spool."""
    from collections import Counter

    db = inputs.db
    observations = db.execute(
        """SELECT o.id,o.shard,o.ordinal FROM statarena.observations o
        WHERE o.id=ANY(%s) ORDER BY o.shard,o.ordinal""",
        (mids,),
    ).fetchall()
    shards = {
        sid: (ref, [])
        for sid, ref in db.execute(
            "SELECT id,ref FROM statarena.shards WHERE id=ANY(%s)",
            (list({r[1] for r in observations}),),
        )
    }
    for mid, shard, ordinal in observations:
        shards[shard][1].append((mid, ordinal))
    refs = db.execute(
        """SELECT mid,endpoint,params,status,
        CASE WHEN ref IS NOT NULL AND object_digest IS NOT NULL AND NOT(ref?'sha256') THEN ref||jsonb_build_object('sha256',object_digest) ELSE ref END,error FROM work_resources
        WHERE mid=ANY(%s) ORDER BY ref->>'path',mid,endpoint,params""",
        (mids,),
    ).fetchall()
    uses = Counter(
        (ref["path"], ref.get("sha256"))
        for meta, _ in shards.values()
        for ref in (meta["document"], *meta["tables"].values())
    )
    uses.update(
        {(ref["path"], ref.get("sha256")) for _, _, _, _, ref, _ in refs if ref}
    )
    scratch.executescript("""
        CREATE TABLE body_cache(path text,sha text,body text,PRIMARY KEY(path,sha));
        CREATE TABLE context(mid text PRIMARY KEY,body text);
        CREATE TABLE archive(mid text,family text,body text,PRIMARY KEY(mid,family));
        CREATE TABLE current(mid text,endpoint text,params text,body text,PRIMARY KEY(mid,endpoint,params));
    """)

    def read(ref):
        key = (ref["path"], ref.get("sha256"))
        dbkey = (key[0], key[1] or "")
        prior = scratch.execute(
            "SELECT body FROM body_cache WHERE path=? AND sha=?", dbkey
        ).fetchone()
        if prior:
            value = json.loads(prior[0])
        else:
            value = inputs.ref(ref)
            if uses[key] > 1:
                scratch.execute(
                    "INSERT INTO body_cache VALUES(?,?,?)", (*dbkey, compact(value))
                )
        uses[key] -= 1
        if prior and not uses[key]:
            scratch.execute("DELETE FROM body_cache WHERE path=? AND sha=?", dbkey)
        return value

    for meta, entries in shards.values():
        docs = read(meta["document"])
        identities = {}
        for mid, ordinal in entries:
            doc = docs[ordinal]
            identities[doc["id"]] = mid
            if doc.get("metadata") is not None:
                scratch.execute(
                    "INSERT INTO context VALUES(?,?)", (mid, compact(doc["metadata"]))
                )
        del docs
        for family, ref in meta["tables"].items():
            for item in read(ref):
                mid = identities.get(item["documentId"])
                if mid:
                    scratch.execute(
                        "INSERT INTO archive VALUES(?,?,?)",
                        (mid, family, compact(item["response"])),
                    )
    # Standalone records often reference the very same shard file. Resolve all its
    # ordinals/document IDs in one pass instead of decoding it once per match.
    from itertools import groupby

    for key, group in groupby(
        refs, lambda r: (r[4]["path"], r[4].get("sha256")) if r[4] else None
    ):
        records = list(group)
        source = read(records[0][4]) if key else None
        keyed = (
            {
                r["documentId"]: r
                for r in source
                if isinstance(r, dict) and "documentId" in r
            }
            if isinstance(source, list)
            and any(
                x[4].get("documentId") is not None and "ordinal" not in x[4]
                for x in records
            )
            else {}
        )
        for mid, endpoint, params, status, ref, error in records:
            if keyed and ref.get("documentId") is not None and "ordinal" not in ref:
                body = envelope(
                    keyed[ref["documentId"]], {"path": ref["path"]}, status, error
                )
            else:
                body = envelope(source, ref, status, error)
            scratch.execute(
                "INSERT INTO current VALUES(?,?,?,?)",
                (mid, endpoint, params, compact(body)),
            )
    scratch.commit()


def publish_partition(inputs, manifest, label, league, marked):
    db = inputs.db
    marker = db.execute(
        "SELECT changed_at FROM work_dirty WHERE season=%s AND league_id=%s",
        (label, league),
    ).fetchone()
    digest = db.execute(
        "SELECT digest FROM work_scopes WHERE season=%s AND league_id=%s",
        (label, league),
    ).fetchone()
    is_orphan = label == "@details"
    fixtures = dict(
        db.execute(
            """SELECT w.id,f.body FROM work_matches w LEFT JOIN statarena.fixtures f ON f.id=w.id
        WHERE w.season=%s AND w.league_id=%s ORDER BY f.day,w.id""",
            (label, league),
        ).fetchall()
    )
    if not is_orphan:
        old = read_partition(db, label, league)
        if old is None:
            chunk = next(
                (
                    c
                    for s in manifest["seasons"]
                    if s["id"] == label
                    for c in s["chunks"]
                    if c["leagueId"] == league
                ),
                None,
            )
            packed = inputs.ref(chunk) if chunk else {}
            old = {
                "meta": packed.get("meta", {}),
                "metrics": packed.get("metrics", METRICS),
                "tables": {
                    t: unpack(packed["tables"][t])
                    if t in packed.get("tables", {})
                    else []
                    for t in TABLES
                },
            }
        tables = old["tables"]
        # Legacy packs may be the only remaining source of a historical fixture.
        merged = {f["id"]: f for f in tables["fixtures"]}
        merged.update((mid, f) for mid, f in fixtures.items() if f is not None)
        tables["fixtures"] = list(merged.values())
        prof = db.execute(
            "SELECT status,ref,error FROM statarena.resources WHERE endpoint=%s AND params='{}' AND status=200",
            ("/leagues/" + league,),
        ).fetchone()
        profile = (
            envelope(inputs.ref(prof[1]), prof[1], prof[0], prof[2])["data"]
            if prof and prof[1]
            else {}
        )
        comp = competition_metadata(
            next(iter(tables["competitions"]), {}),
            profile or {},
            league,
            label,
            tables["fixtures"],
        )
        if comp["name"] == "1. Lig" and comp.get("country") == "INT":
            comp["country"] = "TUR"

    count = 0
    with (
        tempfile.TemporaryDirectory(prefix="statarena-publish-") as tmp,
        closing(sqlite3.connect(Path(tmp) / "envelopes.sqlite")) as scratch,
    ):
        partition_inputs(inputs, scratch, list(fixtures))
        mids = list(fixtures)
        for start in range(0, len(mids), 16):
            headroom = capacity(db)
            estimated = 0
            batch_details = []
            for mid in mids[start : start + 16]:
                context = scratch.execute(
                    "SELECT body FROM context WHERE mid=?", (mid,)
                ).fetchone()
                base = {
                    f: json.loads(b)
                    for f, b in scratch.execute(
                        "SELECT family,body FROM archive WHERE mid=?", (mid,)
                    )
                }
                detail = dict(base)
                core = dict(base)
                variants = []
                for endpoint, params, body in scratch.execute(
                    "SELECT endpoint,params,body FROM current WHERE mid=?", (mid,)
                ):
                    response = json.loads(body)
                    family = _PARENT_SUFFIXES.get(
                        endpoint[len("/matches/" + mid) :].lstrip("/")
                    )
                    if family and params == "{}":
                        if (
                            response["status"] == 200
                            or family not in core
                            or core[family].get("status") != 200
                        ):
                            core[family] = response
                        detail[family] = response
                    else:
                        variants.append((endpoint, json.loads(params), response))
                # Reuse only missing successful normalization inputs from the previous typed
                # publication. New current 200s and successful archive rows take precedence.
                if (
                    not is_orphan
                    and fixtures[mid]
                    and fixtures[mid].get("status") == "finished"
                    and core
                ):
                    absent = [
                        f
                        for f in ("match", "players", "shots", "lineups", "stats")
                        if (core.get(f) or {}).get("status") != 200
                    ]
                    if absent:
                        for family, previous in db.execute(
                            """SELECT family,statarena_app.detail_response(f)
                            FROM statarena_app.match_families f WHERE match_id=%s AND params='{}' AND subject_id=''
                            AND family=ANY(%s) AND status=200 AND has_data""",
                            (mid, absent),
                        ):
                            core[family] = previous
                estimated += 2 * (
                    len(compact(detail).encode())
                    + sum(len(compact(v[2]).encode()) for v in variants)
                )
                if estimated > headroom:
                    raise RuntimeError(
                        "Match details exceed available RDS publication capacity"
                    )
                for endpoint, _, _ in variants:
                    if _resource_address(endpoint) is None:
                        raise ValueError("Unmapped saved match endpoint: " + endpoint)
                if detail or context or variants:
                    batch_details.append(
                        (
                            mid,
                            detail,
                            json.loads(context[0]) if context else None,
                            variants,
                        )
                    )
                f = fixtures[mid]
                if is_orphan or not f or f.get("status") != "finished":
                    continue
                match = (core.get("match") or {}).get("data") or {}
                extras = {
                    k: match[k]
                    for k in ("round_name", "has_playoff", "referee", "stadium")
                    if match.get("id") == mid and k in match
                }
                sample = {
                    "match": dict(f, **extras),
                    "country": comp.get("country"),
                    "league": comp["name"],
                    "league_id": league,
                    "season": label,
                }
                for family, target in [
                    ("players", "players"),
                    ("shots", "shots"),
                    ("lineups", "lineups"),
                    ("stats", "team_stats"),
                ]:
                    value = core.get(family)
                    if value and value.get("status") == 200:
                        sample[target] = {"ok": True, "data": value.get("data")}
                if merge_sample(tables, sample, mid):
                    count += 1
            publish_match_batch(db, batch_details)
    if not is_orphan:
        matches = tables["matches"]
        perform = tables["performances"]
        matches.sort(key=lambda m: (m.get("timeUtc") or "", m["id"]), reverse=True)
        perform.sort(key=lambda p: (p["matchId"], p["playerId"]))
        for team in tables["teams"]:
            team["sampleMatches"] = sum(
                team["id"] in {m["home"]["id"], m["away"]["id"]} for m in matches
            )
        comp["sampleMatches"] = len(matches)
        tables["competitions"] = [comp]
        meta = dict(
            old["meta"],
            matchCount=len(matches),
            collectedMatches=sum(m.get("detailCollected") is True for m in matches),
            expectedFinishedMatches=sum(
                f.get("status") == "finished" for f in tables["fixtures"]
            ),
            playerCount=len({p["playerId"] for p in tables["players"]}),
            listedAppearanceCount=len(perform),
            appearanceCount=sum((p.get("minutes") or 0) > 0 for p in perform),
            shotCount=len(tables["shots"]),
        )
        result = snapshot(tables, meta, old["metrics"])
        capacity(db, len(compact(result).encode()) * 2)
        publish_snapshot(db, label, league, result)
        partition_calendar(inputs, label, league)
    if digest:
        receipt(db, "partition", label + ":" + league, digest[0])
    if marker:
        db.execute(
            "DELETE FROM statarena.dirty_partitions WHERE season=%s AND league_id=%s AND changed_at=%s",
            (label, league, marker[0]),
        )
    db.execute(
        "DELETE FROM statarena_app.publication_jobs WHERE season=%s AND league_id=%s AND changed_at=%s",
        (label, league, marked),
    )
    capacity(db)
    return count


def run(store, *, minutes=100, batch=10, queue_all=False, max_partitions=None):
    """Acquire the shared writer lease. Commit independent partition checkpoints and return progress."""
    db = store.db
    if not 0 < minutes <= 330 or not 1 <= batch <= 100:
        raise ValueError("Invalid publication budget")
    if not db.execute("SELECT pg_try_advisory_lock(%s)", (LEASE,)).fetchone()[0]:
        return {"locked": True, "partitions": 0}
    stop = time.monotonic() + minutes * 60
    installed = False
    try:
        capacity(db)
        install(db)
        installed = True
        inputs = Inputs(store)
        manifest = inputs.read(INDEX)
        prepare(inputs, manifest, queue_all)
        result = {
            "partitions": 0,
            "catalog_inputs": 0,
            "support_changed": 0,
            "assets_changed": 0,
        }
        globals_pending = True
        print(
            compact(
                {
                    "phase": "source-discovery",
                    "partition_jobs": db.execute(
                        "SELECT count(*) FROM statarena_app.publication_jobs"
                    ).fetchone()[0],
                    "catalog_jobs": db.execute(
                        "SELECT count(*) FROM work_catalog"
                    ).fetchone()[0],
                }
            ),
            flush=True,
        )
        db.execute("""INSERT INTO statarena_app.workflow_state(workflow,status,remaining,started_at,updated_at)
            VALUES('relational-materialize','running',0,clock_timestamp(),clock_timestamp()) ON CONFLICT(workflow)
            DO UPDATE SET status='running',started_at=excluded.started_at,updated_at=excluded.updated_at""")
        while time.monotonic() < stop:
            jobs = db.execute(
                """SELECT season,league_id,changed_at FROM statarena_app.publication_jobs
                ORDER BY (season='@details'),season DESC,changed_at,league_id LIMIT %s""",
                (batch,),
            ).fetchall()
            for label, league, marked in jobs:
                if time.monotonic() >= stop or (
                    max_partitions is not None
                    and result["partitions"] >= max_partitions
                ):
                    break
                with db.transaction():
                    normalized = publish_partition(
                        inputs, manifest, label, league, marked
                    )
                result["partitions"] += 1
                print(
                    compact(
                        {"published": league, "season": label, "normalized": normalized}
                    ),
                    flush=True,
                )
            if time.monotonic() >= stop:
                break
            if globals_pending:
                result.update(publish_global(db))
                globals_pending = False
            applied = catalog_batch(inputs, max(1, batch * 4))
            result["catalog_inputs"] += applied
            if not jobs and not applied:
                break
            if max_partitions is not None and result["partitions"] >= max_partitions:
                break
        db.execute("""INSERT INTO statarena_app.publication_jobs(season,league_id,changed_at)
            SELECT season,league_id,changed_at FROM statarena.dirty_partitions
            ON CONFLICT(season,league_id) DO UPDATE SET changed_at=excluded.changed_at WHERE publication_jobs.changed_at<excluded.changed_at""")
        result["remaining"] = db.execute(
            "SELECT (SELECT count(*) FROM statarena_app.publication_jobs)+(SELECT count(*) FROM work_catalog)"
        ).fetchone()[0]
        result["remaining"] += int(globals_pending)
        db.execute(
            """UPDATE statarena_app.workflow_state SET status=%s,remaining=%s,updated_at=clock_timestamp(),
            completed_at=CASE WHEN %s=0 THEN clock_timestamp() ELSE NULL END WHERE workflow='relational-materialize'""",
            (
                "pending" if result["remaining"] else "complete",
                result["remaining"],
                result["remaining"],
            ),
        )
        return result
    except Exception:
        if installed:
            try:
                db.execute(
                    "UPDATE statarena_app.workflow_state SET status='failed',updated_at=clock_timestamp() WHERE workflow='relational-materialize'"
                )
            except psycopg.Error as state_error:
                print(
                    "Could not update publication status:",
                    type(state_error).__name__,
                    file=sys.stderr,
                )
        raise
    finally:
        db.execute("SELECT pg_advisory_unlock(%s)", (LEASE,))


def main():
    from neon_store import Store

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--all", action="store_true", help="queue every known partition once"
    )
    parser.add_argument("--minutes", type=float, default=100)
    parser.add_argument("--batch", type=int, default=10)
    a = parser.parse_args()
    if (
        os.environ.get("GITHUB_ACTIONS") != "true"
        or os.environ.get("STATARENA_DATA_PROVIDER") != "aws"
    ):
        raise SystemExit(
            "Run relational publication through the AWS GitHub Actions workflow."
        )
    url = os.environ["DATABASE_URL"]
    from urllib.parse import parse_qs, urlsplit

    parsed = urlsplit(url)
    if (
        not (parsed.hostname or "").endswith(".us-east-2.rds.amazonaws.com")
        or parsed.path != "/statarena_prod"
        or parse_qs(parsed.query).get("sslmode") != ["verify-full"]
    ):
        raise SystemExit("Expected verified AWS RDS staging connection.")
    os.environ["NEON_DATABASE_URL"] = url  # Existing ingestion-only Store interface.
    store = Store()
    try:
        print(
            compact(run(store, minutes=a.minutes, batch=a.batch, queue_all=a.all)),
            flush=True,
        )
    finally:
        store.db.close()


if __name__ == "__main__":
    main()
