import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "dashboard/scripts"))
from mls_fixture_alias import publish_mls_fixture_alias


class Database:
    def __init__(self):
        self.calls = []
    def execute(self, sql, params):
        self.calls.append((sql, params))


class Store:
    def __init__(self):
        self.db = Database()
        self.objects = {}
    def put_json(self, path, value):
        self.objects[path] = value
        return {"path": path, "sha256": "test"}


class FixtureAliasTest(unittest.TestCase):
    def test_native_year_rows_are_exposed_under_dashboard_bucket(self):
        store = Store()
        fixtures = [{"id": "m_000001", "season": "2026", "league": {"id": "l_0eg6C9"}, "status": "finished"}]
        self.assertTrue(publish_mls_fixture_alias(store, "l_0eg6C9", "2026/2027", fixtures))
        self.assertEqual(list(store.objects.values())[0]["data"]["matches"], fixtures)
        sql, params = store.db.calls[0]
        self.assertEqual(params[0], "/leagues/l_0eg6C9/matches")
        self.assertEqual(json.loads(params[1]), {"season": "2026/2027", "status": "all"})
        self.assertEqual(params[2].obj["path"], next(iter(store.objects)))

    def test_other_or_mixed_seasons_are_not_relabelled(self):
        store = Store()
        self.assertFalse(publish_mls_fixture_alias(store, "l_0Lpz1f", "2026/2027", [{"season": "2026"}]))
        self.assertFalse(publish_mls_fixture_alias(store, "l_0eg6C9", "2026/2027", [{"season": "2026"}, {"season": "2025"}]))
        self.assertEqual(store.db.calls, [])


if __name__ == "__main__":
    unittest.main()
