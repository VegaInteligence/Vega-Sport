"""Backfill SQL documents from verified S3 objects, preserving source versions."""
import argparse
import concurrent.futures
import hashlib
import json
import os
import threading
import time
import urllib.request

import boto3
import psycopg
from botocore.config import Config
from sql_document_parser import supports_documents
from sql_document_store import publish_documents

parser = argparse.ArgumentParser()
parser.add_argument("--workers", type=int, default=8)
parser.add_argument("--limit", type=int)
parser.add_argument("--prefix")
parser.add_argument("--exclude-prefix")
args = parser.parse_args()
if not 1 <= args.workers <= 16 or (args.limit is not None and args.limit < 1):
    raise ValueError("Invalid worker count or limit")

credentials = json.loads(os.environ["RDS_WRITER_CREDENTIALS"])
config = {"host": os.environ["STATARENA_INDEX_DB_HOST"], "port": int(os.environ.get("STATARENA_INDEX_DB_PORT", "5432")),
          "user": "statarena_ingest", "password": credentials["statarena_ingest"], "dbname": os.environ["STATARENA_INDEX_DB_NAME"],
          "sslmode": "verify-full", "sslrootcert": os.environ["STATARENA_INDEX_DB_CA"], "connect_timeout": 10, "autocommit": True}
bucket = os.environ["STATARENA_INDEX_BUCKET"]
ip = urllib.request.urlopen("https://checkip.amazonaws.com", timeout=15).read().decode().strip()
print(json.dumps({"event": "network", "public_ip": ip}), flush=True)
for attempt in range(36):
    try:
        control = psycopg.connect(**config)
        break
    except psycopg.OperationalError:
        if attempt == 35:
            raise
        time.sleep(10)

rows = control.execute("select path,size,sha256 from statarena.objects order by path").fetchall()
rows = [(path, size, bytes(sha)) for path, size, sha in rows if supports_documents(path)]
if args.prefix:
    rows = [row for row in rows if row[0].startswith(args.prefix)]
if args.exclude_prefix:
    rows = [row for row in rows if not row[0].startswith(args.exclude_prefix)]
if args.limit:
    rows = rows[:args.limit]
print(json.dumps({"event": "start", "source_files": len(rows)}), flush=True)
s3 = boto3.client("s3", region_name="us-east-2", config=Config(max_pool_connections=args.workers, retries={"max_attempts": 5}))
local = threading.local()
connections = []
connection_lock = threading.Lock()


def worker(row):
    path, size, expected_sha = row
    if not getattr(local, "db", None):
        local.db = psycopg.connect(**config)
        with connection_lock:
            connections.append(local.db)
    existing = local.db.execute("select source_sha256,status,document_count,error_count from statarena.file_document_sources where source_path=%s", (path,)).fetchone()
    if existing and bytes(existing[0]) == expected_sha and existing[1] in ("ready", "unsupported"):
        return "already_present", existing[2], existing[3]
    body = s3.get_object(Bucket=bucket, Key="data/" + path)["Body"].read()
    if len(body) != size or hashlib.sha256(body).digest() != expected_sha:
        raise ValueError("S3 file does not match the database catalog")
    with local.db.transaction():
        current = local.db.execute("select sha256 from statarena.objects where path=%s for update", (path,)).fetchone()
        if not current or bytes(current[0]) != expected_sha:
            raise ValueError("Source catalog changed during indexing")
        count, errors = publish_documents(local.db, path, expected_sha, body)
    return "indexed", count, errors


report = {"source_files": len(rows), "indexed": 0, "already_present": 0, "failed": 0,
          "documents": 0, "parse_errors": 0, "failures": []}
iterator = iter(rows)
try:
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        pending = {}
        next_progress = 1000
        while True:
            while len(pending) < args.workers * 2:
                try:
                    row = next(iterator)
                except StopIteration:
                    break
                pending[pool.submit(worker, row)] = row[0]
            if not pending:
                break
            done, _ = concurrent.futures.wait(pending, return_when=concurrent.futures.FIRST_COMPLETED)
            for future in done:
                path = pending.pop(future)
                try:
                    status, count, errors = future.result()
                    report[status] += 1
                    report["documents"] += count
                    report["parse_errors"] += errors
                except Exception as error:
                    report["failed"] += 1
                    if len(report["failures"]) < 100:
                        report["failures"].append({"path": path, "error": type(error).__name__})
            completed = report["indexed"] + report["already_present"] + report["failed"]
            if completed >= next_progress:
                print(json.dumps({k: v for k, v in report.items() if k != "failures"}), flush=True)
                next_progress = completed + 1000
finally:
    control.close()
    for connection in connections:
        connection.close()
print(json.dumps(report), flush=True)
if report["failed"]:
    raise SystemExit("Some source files could not be indexed")
