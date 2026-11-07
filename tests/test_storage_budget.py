import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "dashboard/scripts"))
from aws_storage_budget import DEFAULT_SQL_LIMIT_BYTES, DEFAULT_SQL_RESERVE_BYTES, sql_budget
from relational_materialize import capacity
from aws_ingest import capacity as ingestion_capacity


class Result:
    def __init__(self, value):
        self.value = value

    def fetchone(self):
        return (self.value,)


class Database:
    def __init__(self, size):
        self.size = size

    def execute(self, query):
        return Result(self.size if "pg_database_size" in query else 0)


class StorageBudgetTests(unittest.TestCase):
    def test_current_eighteen_gib_database_can_publish_with_reserved_headroom(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(capacity(Database(18 * 1024**3), 2 * 1024**3), 28 * 1024**3)

    def test_near_ceiling_blocks_publication_and_collection(self):
        size = DEFAULT_SQL_LIMIT_BYTES - DEFAULT_SQL_RESERVE_BYTES + 1
        with patch.dict(os.environ, {"STATARENA_DATA_PROVIDER": "aws", "STATARENA_EXTERNAL_STORAGE": "1"}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "database_bytes=.*limit_bytes=.*reserve_bytes="):
                capacity(Database(size))
            store = type("Store", (), {"db": Database(size)})()
            self.assertTrue(ingestion_capacity(store)["paused"])

    def test_growth_and_explicit_overrides_remain_enforced(self):
        with patch.dict(os.environ, {"STATARENA_SQL_LIMIT_BYTES": "1000", "STATARENA_SQL_RESERVE_BYTES": "100"}, clear=True):
            self.assertEqual(capacity(Database(800), 100), 100)
            with self.assertRaises(RuntimeError):
                capacity(Database(800), 101)
        with patch.dict(os.environ, {"STATARENA_SQL_LIMIT_BYTES": "0"}, clear=True):
            with self.assertRaises(ValueError):
                sql_budget()


if __name__ == "__main__":
    unittest.main()
