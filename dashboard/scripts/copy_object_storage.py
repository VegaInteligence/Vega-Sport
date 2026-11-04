#!/usr/bin/env python3
"""Copy the catalogued files to another S3-compatible bucket, with verification."""

import argparse
import base64
import concurrent.futures
import hashlib
import json
import os
import tempfile

import boto3
import psycopg
from botocore.config import Config
from botocore.exceptions import ClientError


def client(prefix, workers):
    explicit = {}
    if os.environ.get(prefix + "_ACCESS_KEY_ID"):
        explicit = {
            "aws_access_key_id": os.environ[prefix + "_ACCESS_KEY_ID"],
            "aws_secret_access_key": os.environ[prefix + "_SECRET_ACCESS_KEY"],
            "aws_session_token": os.environ.get(prefix + "_SESSION_TOKEN"),
        }
    return boto3.client(
        "s3",
        endpoint_url=os.environ.get(prefix + "_ENDPOINT"),
        region_name=os.environ.get(prefix + "_REGION", "auto"),
        **explicit,
        config=Config(
            signature_version="s3v4",
            s3={"addressing_style": "path" if os.environ.get(prefix + "_PATH_STYLE", "1") != "0" else "virtual"},
            request_checksum_calculation="when_required",
            response_checksum_validation="when_required",
            max_pool_connections=workers,
            retries={"max_attempts": 4},
        ),
    )


def digest_object(client, bucket, key, sink=None):
    stream = client.get_object(Bucket=bucket, Key=key)["Body"]
    sha = hashlib.sha256()
    md5 = hashlib.md5()
    size = 0
    try:
        while True:
            chunk = stream.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            sha.update(chunk)
            md5.update(chunk)
            if sink is not None:
                sink.write(chunk)
    finally:
        stream.close()
    return size, sha.digest(), md5.digest()


def copy_one(source, destination, source_bucket, destination_bucket, row, verify_only=False):
    path, size, digest, content_type = row
    key = "data/" + path
    try:
        existing_size, existing_sha, _ = digest_object(destination, destination_bucket, key)
    except ClientError as error:
        if error.response["Error"].get("Code") not in ("NoSuchKey", "NotFound", "404"):
            raise
    else:
        if existing_size == size and existing_sha == bytes(digest):
            return "already_present", size
    if verify_only:
        raise ValueError("Destination does not match the source catalog")
    with tempfile.TemporaryFile() as body:
        source_size, source_sha, md5 = digest_object(source, source_bucket, key, body)
        if source_size != size or source_sha != bytes(digest):
            raise ValueError("Source object changed or failed checksum verification")
        body.seek(0)
        destination.put_object(
            Bucket=destination_bucket,
            Key=key,
            Body=body,
            ContentMD5=base64.b64encode(md5).decode(),
            ContentType=content_type,
        )
    target_size, target_sha, _ = digest_object(destination, destination_bucket, key)
    if target_size != size or target_sha != bytes(digest):
        raise ValueError("Destination object failed checksum verification")
    return "copied", size


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--verify-only", action="store_true")
    parser.add_argument("--limit", type=int, help="Limit objects for a controlled preflight")
    args = parser.parse_args()
    if not 1 <= args.workers <= 32:
        raise ValueError("workers must be between 1 and 32")
    if args.limit is not None and args.limit < 1:
        raise ValueError("limit must be positive")
    with psycopg.connect(os.environ["NEON_DATABASE_URL"], options="-c default_transaction_read_only=on") as db:
        sql = "select path,size,sha256,content_type from statarena.objects order by path"
        rows = db.execute(sql + (" limit %s" if args.limit else ""), (args.limit,) if args.limit else ()).fetchall()
    source = None if args.verify_only else client("SOURCE_STORAGE", args.workers)
    destination = client("TARGET_STORAGE", args.workers)
    source_bucket = os.environ.get("SOURCE_STORAGE_BUCKET", "statarena-data")
    destination_bucket = os.environ["TARGET_STORAGE_BUCKET"]
    report = {"objects": len(rows), "copied": 0, "already_present": 0, "failed": 0, "copied_bytes": 0, "failures": []}
    iterator = iter(rows)
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        pending = {}
        while True:
            while len(pending) < args.workers * 2:
                try:
                    row = next(iterator)
                except StopIteration:
                    break
                pending[pool.submit(copy_one, source, destination, source_bucket, destination_bucket, row, args.verify_only)] = row[0]
            if not pending:
                break
            done, _ = concurrent.futures.wait(pending, return_when=concurrent.futures.FIRST_COMPLETED)
            for future in done:
                path = pending.pop(future)
                try:
                    state, size = future.result()
                    report[state] += 1
                    if state == "copied":
                        report["copied_bytes"] += size
                except Exception as error:
                    report["failed"] += 1
                    if len(report["failures"]) < 20:
                        report["failures"].append({"path": path, "error": type(error).__name__})
            if (report["copied"] + report["already_present"] + report["failed"]) % 5000 == 0:
                print(json.dumps({k: v for k, v in report.items() if k != "failures"}), flush=True)
    print(json.dumps(report), flush=True)
    if report["failed"]:
        raise SystemExit("Copy or verification incomplete; inspect failures and rerun")


if __name__ == "__main__":
    main()
