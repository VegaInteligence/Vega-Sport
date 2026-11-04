import base64
import hashlib
import io
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "dashboard/scripts"))
from botocore.exceptions import ClientError
from copy_object_storage import copy_one
from neon_ingest import capacity
from neon_store import Store


class FakeStorage:
    def __init__(self, files=None):
        self.files = dict(files or {})
        self.reads = 0

    def get_object(self, Bucket, Key):
        self.reads += 1
        if Key not in self.files:
            raise ClientError({"Error": {"Code": "NoSuchKey"}}, "GetObject")
        return {"Body": io.BytesIO(self.files[Key])}

    def put_object(self, Bucket, Key, Body, ContentMD5, **_):
        body = Body.read() if hasattr(Body, "read") else Body
        if base64.b64decode(ContentMD5) != hashlib.md5(body).digest():
            raise ValueError("Invalid MD5")
        self.files[Key] = body
        return {"ETag": '"' + hashlib.md5(body).hexdigest() + '"'}


class Result:
    def __init__(self, value):
        self.value = value

    def fetchone(self):
        return self.value


class Database:
    def __init__(self):
        self.rows = {}
        self.last_insert = None

    def execute(self, sql, values):
        if sql.startswith("select body,sha256,size") or sql.startswith("select NULL,sha256,size"):
            return Result(self.rows.get(values[0]))
        if sql.startswith("select sha256"):
            row = self.rows.get(values[0])
            return Result((row[1],) if row else None)
        if sql.startswith("insert into statarena.objects"):
            self.last_insert = values
            self.rows[values[0]] = (values[4], values[2], values[1])
            return Result(None)
        raise AssertionError(sql)


class ManagedStorageTest(unittest.TestCase):
    def test_capacity_keeps_neon_limits_but_uses_explicit_external_limits(self):
        class CapacityDB:
            def execute(self, sql):
                return Result((1_000_000_000 if "pg_database_size" in sql else 5_000_000_000,))

        store = type("CapacityStore", (), {"db": CapacityDB()})()
        with patch.dict(os.environ, {}, clear=True):
            self.assertTrue(capacity(store)["paused"])
        with patch.dict(os.environ, {"STATARENA_EXTERNAL_STORAGE": "1"}, clear=True):
            self.assertFalse(capacity(store)["paused"])
        with patch.dict(os.environ, {"STATARENA_EXTERNAL_STORAGE": "1", "STATARENA_SQL_LIMIT_BYTES": "999999999"}, clear=True):
            self.assertTrue(capacity(store)["paused"])
        with patch.dict(os.environ, {"STATARENA_EXTERNAL_STORAGE": "1", "STATARENA_OBJECT_LIMIT_BYTES": "4999999999"}, clear=True):
            self.assertTrue(capacity(store)["paused"])

    def test_verified_copy_preserves_path_and_skips_matching_file(self):
        body = b"fixture file"
        source = FakeStorage({"data/raw/x.json": body})
        destination = FakeStorage()
        row = ("raw/x.json", len(body), hashlib.sha256(body).digest(), "application/json")
        self.assertEqual(copy_one(source, destination, "source", "target", row)[0], "copied")
        self.assertEqual(destination.files["data/raw/x.json"], body)
        self.assertEqual(copy_one(source, destination, "source", "target", row)[0], "already_present")
        self.assertEqual(source.reads, 1)

    def test_copy_refuses_incorrect_source_bytes(self):
        expected = b"expected"
        source = FakeStorage({"data/raw/x.json": b"incorrect"})
        destination = FakeStorage()
        row = ("raw/x.json", len(expected), hashlib.sha256(expected).digest(), "application/json")
        with self.assertRaises(ValueError):
            copy_one(source, destination, "source", "target", row)
        self.assertNotIn("data/raw/x.json", destination.files)

    def test_external_ingestion_reads_files_and_avoids_inline_sql_copies(self):
        store = Store.__new__(Store)
        store.db = Database()
        store.s3 = FakeStorage()
        store.bucket = "target"
        store.external = True
        body = b"new file"
        store.put("raw/x.json", body, hot=True)
        self.assertIsNone(store.db.last_insert[4])
        store.db.rows["raw/x.json"] = (b"stale SQL bytes", hashlib.sha256(body).digest(), len(body))
        self.assertEqual(store.bytes("raw/x.json"), body)


if __name__ == "__main__":
    unittest.main()
