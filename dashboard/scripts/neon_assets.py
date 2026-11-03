#!/usr/bin/env python3
"""Copy display images into Neon; backend asset requests never fetch the CDN."""

import argparse, base64, concurrent.futures, gzip, hashlib, json, re, urllib.request, urllib.error
from pathlib import Path
from neon_store import Store


def urls(value):
    found = set()

    def walk(v):
        if (
            isinstance(v, str)
            and re.match(
                r"^https://(?:cdn\.pitchapi\.dev/|upload\.wikimedia\.org/wikipedia/commons/|img\.thesports\.com/football/(?:team|competition)/)",
                v,
            )
            and re.search(r"\.(?:png|webp|jpe?g)(?:\?|$)", v, re.I)
        ):
            found.add(v)
        elif isinstance(v, dict):
            for x in v.values():
                walk(x)
        elif isinstance(v, list):
            for x in v:
                walk(x)

    walk(value)
    return found


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--files")
    p.add_argument("--count-only", action="store_true")
    p.add_argument("--limit", type=int, default=2000)
    a = p.parse_args()
    found = set()
    if a.files:
        for path in Path(a.files).glob("data/computed/dashboard/*/*.gz"):
            found.update(urls(json.loads(gzip.decompress(path.read_bytes()))))
        print("Unique source images:", len(found), flush=True)
        if a.count_only:
            return
    store = Store()
    for (body,) in store.db.execute("select body from statarena.projections"):
        found.update(urls(body))
        for plan in body.get("plans", []):
            if plan.get("imageUrl", "").startswith("https://"):
                found.add(plan["imageUrl"])
    with store.db.transaction():
        store.db.execute("create temporary table seed_assets(url text) on commit drop")
        with store.db.cursor().copy("copy seed_assets from stdin") as copy:
            for url in found:
                copy.write_row((url,))
        store.db.execute(
            "insert into statarena.asset_jobs(url) select url from seed_assets s where not exists(select 1 from statarena.assets a where a.url=s.url) on conflict do nothing"
        )
    rows = store.db.execute(
        "select j.url from statarena.asset_jobs j left join statarena.assets a on a.url=j.url where a.url is null and next_attempt<=now() order by attempts,url limit %s",
        (a.limit,),
    ).fetchall()
    print("Pending asset batch:", len(rows), flush=True)

    def transfer(row):
        url = row[0]
        try:
            req = urllib.request.Request(
                url, headers={"User-Agent": "STATARENA-Neon-Ingestion/1.0"}
            )
            with urllib.request.urlopen(req, timeout=20) as response:
                content_type = response.headers.get_content_type()
                body = response.read(4 * 1024 * 1024 + 1)
            if not content_type.startswith("image/") or len(body) > 4 * 1024 * 1024:
                raise ValueError("Invalid image response")
            sha = hashlib.sha256(body).hexdigest()
            md5 = hashlib.md5(body).hexdigest()
            ext = {
                "image/png": "png",
                "image/webp": "webp",
                "image/jpeg": "jpg",
                "image/svg+xml": "svg",
            }.get(content_type, "img")
            path = "raw/neon/assets/" + sha + "." + ext
            result = store.s3.put_object(
                Bucket=store.bucket,
                Key="data/" + path,
                Body=body,
                ContentType=content_type,
                ContentMD5=base64.b64encode(bytes.fromhex(md5)).decode(),
            )
            if result["ETag"].strip('"') != md5:
                raise ValueError("Image server checksum mismatch")
            return url, path, len(body), bytes.fromhex(sha), md5, content_type, None
        except Exception as e:
            return url, None, 0, None, None, None, type(e).__name__

    success = failed = total = 0
    batch = []

    def flush():
        nonlocal success, failed, total
        with store.db.transaction():
            store.db.execute(
                "create temporary table if not exists asset_import(url text,path text,size bigint,sha bytea,etag text,ctype text,error text) on commit delete rows"
            )
            with store.db.cursor().copy("copy asset_import from stdin") as copy:
                for row in batch:
                    copy.write_row(row)
            store.db.execute(
                "insert into statarena.objects(path,size,sha256,etag,content_type) select distinct on(path) path,size,sha,etag,ctype from asset_import where error is null on conflict do nothing"
            )
            store.db.execute(
                "insert into statarena.assets(url,path,content_type) select url,path,ctype from asset_import where error is null on conflict(url) do update set path=excluded.path,content_type=excluded.content_type"
            )
            store.db.execute(
                "delete from statarena.asset_jobs j using asset_import i where j.url=i.url and i.error is null"
            )
            store.db.execute(
                "update statarena.asset_jobs j set attempts=attempts+1,next_attempt=now()+interval '1 day',error=i.error from asset_import i where j.url=i.url and i.error is not null"
            )
            for url, path, size, sha, etag, ctype, error in batch:
                if error:
                    failed += 1
                else:
                    success += 1
                    total += size
        batch.clear()
        print(
            json.dumps({"images": success, "failed": failed, "bytes": total}),
            flush=True,
        )

    with concurrent.futures.ThreadPoolExecutor(max_workers=24) as pool:
        for result in pool.map(transfer, rows):
            batch.append(result)
            if len(batch) >= 100:
                flush()
    if batch:
        flush()
    store.db.close()


if __name__ == "__main__":
    main()
