"""Shared ingestion store. No repository data directory or Git publication."""

import os, json, gzip, hashlib, base64
from urllib.parse import urlsplit
import boto3, psycopg
from botocore.config import Config
from botocore.exceptions import ClientError
from psycopg.types.json import Jsonb
from sql_document_parser import supports_documents
from sql_document_store import publish_documents


def canonical(params=None):
    return json.dumps(
        params or {}, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    )


class Store:
    def __init__(self):
        target = urlsplit(os.environ["DATABASE_URL"])
        local_test = os.environ.get("STATARENA_TEST_DATABASE") == "1" and target.hostname in ("localhost", "127.0.0.1", "::1")
        if not local_test and not (target.hostname or "").endswith(".rds.amazonaws.com"):
            raise ValueError("The AWS staging worker requires the RDS endpoint")
        self.db = psycopg.connect(
            os.environ["DATABASE_URL"],
            autocommit=True,
            application_name="statarena-ingestion",
            options="-c statement_timeout=120000",
        )
        # A forced refresh is performed at most once in each worker run.
        self.refresh_since = self.db.execute("select clock_timestamp()").fetchone()[0]
        self.external = True
        self.sql_documents = True
        self.s3 = boto3.client(
            "s3",
            endpoint_url=os.environ["STATARENA_S3_ENDPOINT"],
            region_name=os.environ.get("STATARENA_S3_REGION", "us-east-2"),
            aws_access_key_id=os.environ["STATARENA_S3_ACCESS_KEY_ID"],
            aws_secret_access_key=os.environ["STATARENA_S3_SECRET_ACCESS_KEY"],
            config=Config(
                signature_version="s3v4",
                s3={"addressing_style": "path" if os.environ.get("STATARENA_S3_PATH_STYLE", "1") != "0" else "virtual"},
                request_checksum_calculation="when_required",
                response_checksum_validation="when_required",
                retries={"max_attempts": 4},
            ),
        )
        self.bucket = os.environ["STATARENA_S3_BUCKET"]
        self.queue = {}

    def bytes(self, path):
        row = self.db.execute(
            "select " + ("NULL" if self.external else "body")
            + ",sha256,size from statarena.objects where path=%s", (path,)
        ).fetchone()
        if not row:
            raise FileNotFoundError(path)
        def read(key):
            return self.s3.get_object(Bucket=self.bucket, Key="data/" + key)["Body"].read()

        mutable = path in ["raw/index.json", "computed/dashboard/index.json"] or path.startswith("computed/matchdays/")
        extension = ".json.gz" if path.endswith(".gz") else ".json"
        previous = "raw/neon/versions/" + bytes(row[1]).hex() + extension
        try:
            body = bytes(row[0]) if row[0] is not None and not self.external else read(path)
        except ClientError as error:
            if not self.external or not mutable or error.response["Error"].get("Code") not in ("NoSuchKey", "NotFound", "404"):
                raise
            body = read(previous)
        if self.external and mutable and (
            hashlib.sha256(body).digest() != bytes(row[1]) or len(body) != row[2]
        ):
            body = read(previous)
        if hashlib.sha256(body).digest() != bytes(row[1]) or len(body) != row[2]:
            raise ValueError("AWS object checksum mismatch: " + path)
        return body

    def json(self, path):
        b = self.bytes(path)
        return json.loads(gzip.decompress(b) if path.endswith(".gz") else b)

    def put(self, path, body, content_type="application/json", hot=False):
        digest = hashlib.sha256(body).digest()
        etag = hashlib.md5(body).hexdigest()
        old = self.db.execute(
            "select sha256 from statarena.objects where path=%s", (path,)
        ).fetchone()
        same_digest = bool(old and bytes(old[0]) == digest)
        if same_digest:
            if not self.external:
                return False
            try:
                current = self.s3.get_object(Bucket=self.bucket, Key="data/" + path)["Body"].read()
            except ClientError as error:
                if error.response["Error"].get("Code") not in ("NoSuchKey", "NotFound", "404"):
                    raise
            else:
                if len(current) == len(body) and hashlib.sha256(current).digest() == digest:
                    return False
        if old and not same_digest and (
            path in ["raw/index.json", "computed/dashboard/index.json"]
            or path.startswith("computed/matchdays/")
        ):
            previous = self.bytes(path)
            archive = (
                "raw/neon/versions/"
                + bytes(old[0]).hex()
                + (".json.gz" if path.endswith(".gz") else ".json")
            )
            self.put(archive, previous, content_type)
        result = self.s3.put_object(
            Bucket=self.bucket,
            Key="data/" + path,
            Body=body,
            ContentMD5=base64.b64encode(bytes.fromhex(etag)).decode(),
            ContentType=content_type,
        )
        if result["ETag"].strip('"') != etag:
            raise ValueError("AWS server MD5 mismatch")
        statement = "insert into statarena.objects(path,size,sha256,etag,body,content_type) values(%s,%s,%s,%s,%s,%s) on conflict(path) do update set size=excluded.size,sha256=excluded.sha256,etag=excluded.etag,body=excluded.body,content_type=excluded.content_type,updated_at=now()"
        values = (path, len(body), digest, etag, body if hot and not self.external else None, content_type)
        if self.external and getattr(self, "sql_documents", False) and supports_documents(path):
            with self.db.transaction():
                self.db.execute(statement, values)
                publish_documents(self.db, path, digest, body)
        else:
            self.db.execute(statement, values)
        return True

    def put_json(self, path, value, hot=False):
        body = canonical(value).encode()
        body = gzip.compress(body, mtime=0) if path.endswith(".gz") else body
        self.put(
            path,
            body,
            "application/gzip" if path.endswith(".gz") else "application/json",
            hot,
        )
        return {"path": path, "sha256": hashlib.sha256(body).hexdigest()}

    def enqueue(self, endpoint, params=None, priority=3, refresh=False, force=False):
        p = canonical(params)
        key = (endpoint, p)
        old = self.queue.get(key)
        self.queue[key] = {
            "endpoint": endpoint,
            "params": p,
            "priority": min(priority, old["priority"]) if old else priority,
            "refresh": refresh or force or bool(old and old["refresh"]),
            "force": force or bool(old and old["force"]),
        }

    def flush(self):
        for refresh, force in [(False, False), (True, False), (True, True)]:
            rows = [
                {k: v for k, v in row.items() if k not in {"refresh", "force"}}
                for row in self.queue.values()
                if row["refresh"] == refresh and row["force"] == force
            ]
            if not rows:
                continue
            condition = (
                "WHERE NOT EXISTS(SELECT 1 FROM statarena.resources r WHERE r.endpoint=i.endpoint AND r.params=i.params AND r.status IN(200,400,403,404,410,422)"
                + (" AND r.updated_at >= %s" if force else " AND r.updated_at>now()-interval '6 hours'" if refresh else "")
                + ")"
            )
            self.db.execute(
                "INSERT INTO statarena.jobs(endpoint,params,priority) SELECT i.endpoint,i.params,i.priority FROM jsonb_to_recordset(%s) AS i(endpoint text,params text,priority smallint) "
                + condition
                + " ON CONFLICT(endpoint,params) DO UPDATE SET priority=least(statarena.jobs.priority,excluded.priority),state=case when %s and statarena.jobs.state!='running' then 'pending' else statarena.jobs.state end,available_at=case when %s then now() else statarena.jobs.available_at end",
                (Jsonb(rows), *([self.refresh_since] if force else []), refresh, refresh),
            )
        self.queue.clear()

    def state(self, name, value):
        self.db.execute(
            "insert into statarena.state(name,value) values(%s,%s) on conflict(name) do update set value=excluded.value,updated_at=now()",
            (name, Jsonb(value)),
        )

    def revision(self):
        self.db.execute(
            "update statarena.state set value=to_jsonb((value::text::bigint)+1),updated_at=now() where name='revision'"
        )
