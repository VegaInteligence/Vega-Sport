import json
import copy
import sys
import unittest
from contextlib import nullcontext
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "dashboard/scripts"))
from mls_fixture_alias import publish_mls_fixture_alias
from build_dashboard_views import pack_table
from aws_materialize import _materialize


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

    def test_materialization_publishes_the_alias_alongside_the_partition(self):
        fixture = {"id": "m_000001", "season": "2026", "league": {"id": "l_0eg6C9", "name": "MLS"}, "status": "finished"}
        table_names = ["players", "performances", "matches", "shots", "team_statistics", "teams", "competitions", "fixtures"]
        objects = {
            "computed/dashboard/index.json": {"seasons": [{"id": "2026/2027", "chunks": [{"leagueId": "l_0eg6C9", "path": "chunk"}]}], "scouting": {"playerRoutes": {"path": "routes"}}},
            "raw/index.json": {"seasons": []},
            "routes": {"routes": {}, "clubRoutes": {}},
            "chunk": {"tables": {name: pack_table([]) for name in table_names}, "meta": {}},
        }

        class Result:
            def __init__(self, rows=()):
                self.rows = list(rows)
            def fetchall(self):
                return self.rows
            def fetchone(self):
                return self.rows[0] if self.rows else None
            def __iter__(self):
                return iter(self.rows)

        class MaterializeDB(Database):
            def transaction(self):
                return nullcontext()
            def execute(self, sql, params=None):
                self.calls.append((sql, params))
                if sql.startswith("select season,league_id,changed_at"):
                    return Result([("2026/2027", "l_0eg6C9", "stamp")])
                if sql.startswith("select body from statarena.fixtures"):
                    return Result([(fixture,)])
                if sql.startswith("select size from statarena.objects"):
                    return Result([(100,)])
                return Result()

        class MaterializeStore(Store):
            def __init__(self):
                super().__init__()
                self.db = MaterializeDB()
                self.objects = copy.deepcopy(objects)
            def json(self, path):
                if path not in self.objects:
                    raise FileNotFoundError(path)
                return copy.deepcopy(self.objects[path])
            def put_json(self, path, value, hot=False):
                self.objects[path] = copy.deepcopy(value)
                return {"path": path, "sha256": "test"}

        store = MaterializeStore()
        self.assertEqual(_materialize(store, league_id="l_0eg6C9"), 1)
        aliases = [(sql, params) for sql, params in store.db.calls if sql.startswith("insert into statarena.resources")]
        self.assertEqual(len(aliases), 1)
        self.assertEqual(json.loads(aliases[0][1][1])["season"], "2026/2027")
        self.assertEqual(store.objects[aliases[0][1][2].obj["path"]]["data"]["matches"], [fixture])


if __name__ == "__main__":
    unittest.main()
