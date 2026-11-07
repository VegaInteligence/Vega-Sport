import contextlib
import io
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "dashboard/scripts"))
import player_honours as worker
from build_dashboard_views import pack_table


class Result:
    def __init__(self, rows=()):
        self.rows = list(rows)
    def fetchone(self):
        return self.rows[0] if self.rows else None
    def fetchall(self):
        return self.rows


class DB:
    def __init__(self):
        self.writes = []
    def execute(self, sql, params=None):
        if sql.startswith("insert into statarena.projections"):
            self.writes.append((sql, params))
        return Result()
    def close(self):
        pass


class Store:
    def __init__(self, objects):
        self.objects = objects
        self.db = DB()
    def json(self, path):
        return self.objects[path]


class HonoursWorkerTest(unittest.TestCase):
    def test_interrupted_candidate_is_retried_from_saved_cursor(self):
        manifest = {"seasons": [{"id": "2026/2027", "chunks": []}]}
        store = Store({"computed/dashboard/index.json": manifest})
        class StatefulDB(DB):
            def __init__(self):
                super().__init__()
                self.state = {}
            def execute(self, sql, params=None):
                if sql.startswith("select value from statarena.state"):
                    key = params[0] if params else "player_honours_rotation"
                    return Result([(self.state[key],)] if key in self.state else [])
                if sql.startswith("insert into statarena.state"):
                    key, value = params if len(params) == 2 else ("player_honours_rotation", params[0])
                    self.state[key] = value.obj
                return super().execute(sql, params)
        store.db = StatefulDB()
        store.db.state["player_honours_cursor:recent"] = 2
        players = {f"p_{i:06d}": {"name": str(i), "minutes": 100-i,
                   "observations": {(str(i), "Team"): "2026-11-02"}} for i in range(3)}
        calls = []
        def interrupted(name, observations):
            calls.append(name)
            if name == "0":
                raise KeyboardInterrupt()
            return None
        with patch("aws_store.Store", return_value=store), patch.object(worker, "candidates_from_manifest", return_value=players), patch.object(worker, "player_candidate", return_value=None), patch.object(worker, "collect_player", side_effect=interrupted), patch.object(worker.time, "sleep"), contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(KeyboardInterrupt):
                worker.run(limit=3)
        self.assertEqual(calls, ["2", "0"])
        self.assertEqual(store.db.state["player_honours_cursor:recent"], 0)
        self.assertNotIn("player_honours_rotation", store.db.state)
        with patch("aws_store.Store", return_value=store), patch.object(worker, "candidates_from_manifest", return_value=players), patch.object(worker, "player_candidate", return_value=None), patch.object(worker, "collect_player", return_value=None) as collect, patch.object(worker.time, "sleep"), contextlib.redirect_stdout(io.StringIO()):
            worker.run(limit=1)
        self.assertEqual(collect.call_args.args[0], "0")
        self.assertEqual(store.db.state["player_honours_cursor:recent"], 1)
        self.assertEqual(store.db.state["player_honours_rotation"], 1)

    def test_source_parser_preserves_wins_and_excludes_runners_up(self):
        html = "<p><b>Club</b></p><ul><li>League: 2024–25; runner-up: 2023–24</li><li>Cup runner-up: 2022</li></ul>"
        self.assertEqual(worker.parse_honours(html), [{"name": "League", "team": "Club", "category": "team", "seasons": ["2024–25"]}])

    def test_target_player_uses_the_route_index_and_observed_team(self):
        pid = worker.MESSI_ID
        manifest = {"scouting": {"playerRoutes": {"path": "routes"}}, "seasons": [{"id": "2026/2027", "chunks": [{"leagueId": "l_mls", "path": "chunk"}, {"leagueId": "l_other", "path": "unused"}]}]}
        store = Store({
            "routes": {"routes": {pid: {"2026/2027": ["l_mls"]}}},
            "chunk": {"tables": {
                "players": pack_table([{"id": "ref", "playerId": pid, "name": "Lionel Messi"}]),
                "performances": pack_table([{"playerRef": "ref", "playerId": pid, "team": "Inter Miami CF", "minutes": 90, "date": "2026-11-02"}]),
            }},
        })
        result = worker.player_candidate(store, manifest, pid)
        self.assertEqual(result["name"], "Lionel Messi")
        self.assertIn(("Lionel Messi", "Inter Miami CF"), result["observations"])

    def test_daily_worker_attempts_messi_first_and_saves_source(self):
        manifest = {"seasons": [{"id": "2026/2027", "chunks": []}]}
        store = Store({"computed/dashboard/index.json": manifest})
        players = {
            worker.MESSI_ID: {"name": "Lionel Messi", "minutes": 90, "observations": {("Lionel Messi", "Inter Miami CF"): "2026-11-02"}},
            "p_123456": {"name": "Other", "minutes": 900, "observations": {("Other", "Team"): "2026-11-02"}},
        }
        source = {"identitySourceUrl": "https://www.wikidata.org/wiki/Q615", "sourceUrl": "https://en.wikipedia.org/w/index.php?oldid=1", "honours": [{"name": "MLS Cup", "seasons": ["2025"]}]}
        with patch("aws_store.Store", return_value=store), patch.object(worker, "candidates_from_manifest", return_value=players), patch.object(worker, "collect_player", return_value=source) as collect, patch.object(worker.time, "sleep"), contextlib.redirect_stdout(io.StringIO()):
            worker.run(limit=1)
        self.assertEqual(collect.call_args.args[0], "Lionel Messi")
        self.assertEqual(len(store.db.writes), 1)
        self.assertIn(worker.MESSI_ID, store.db.writes[0][1][1])

    def test_interruption_after_saved_projection_retries_then_skips_fresh_record(self):
        manifest = {"seasons": [{"id": "2026/2027", "chunks": []}]}
        store = Store({"computed/dashboard/index.json": manifest})
        class FreshDB(DB):
            def execute(self, sql, params=None):
                if sql.startswith("select params from statarena.projections"):
                    return Result([(self.writes[0][1][1],)] if self.writes else [])
                if sql.startswith("insert into statarena.state"):
                    raise KeyboardInterrupt()
                return super().execute(sql, params)
        store.db = FreshDB()
        players = {f"p_{i:06d}": {"name": str(i), "minutes": 100-i,
                   "observations": {(str(i), "Team"): "2026-11-02"}} for i in range(2)}
        source = {"identitySourceUrl": "https://www.wikidata.org/wiki/Q1", "honours": []}
        with patch("aws_store.Store", return_value=store), patch.object(worker, "candidates_from_manifest", return_value=players), patch.object(worker, "player_candidate", return_value=None), patch.object(worker, "collect_player", return_value=source), patch.object(worker.time, "sleep"), contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(KeyboardInterrupt):
                worker.run(limit=1)
        self.assertEqual(len(store.db.writes), 1)
        with patch("aws_store.Store", return_value=store), patch.object(worker, "candidates_from_manifest", return_value=players), patch.object(worker, "player_candidate", return_value=None), patch.object(worker, "collect_player", return_value=source) as collect, patch.object(worker.time, "sleep"), contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(KeyboardInterrupt):
                worker.run(limit=1)
        self.assertEqual(collect.call_args.args[0], "1")

    def test_interrupted_priority_and_target_do_not_write_state(self):
        manifest = {"seasons": [{"id": "2026/2027", "chunks": []}]}
        player = {"name": "Lionel Messi", "minutes": 90, "observations": {("Lionel Messi", "Inter Miami"): "2026-11-02"}}
        class StateDB(DB):
            def execute(self, sql, params=None):
                if sql.startswith("insert into statarena.state"):
                    self.writes.append((sql, params))
                return super().execute(sql, params)
        for target in (None, worker.MESSI_ID):
            with self.subTest(target=target):
                store = Store({"computed/dashboard/index.json": manifest})
                store.db = StateDB()
                with patch("aws_store.Store", return_value=store), patch.object(worker, "candidates_from_manifest", return_value={worker.MESSI_ID: player}), patch.object(worker, "player_candidate", return_value=player), patch.object(worker, "collect_player", side_effect=KeyboardInterrupt), contextlib.redirect_stdout(io.StringIO()):
                    with self.assertRaises(KeyboardInterrupt):
                        worker.run(limit=1, player_id=target)
                self.assertEqual(store.db.writes, [])

    def test_messi_is_retried_after_one_day_even_when_other_honours_are_recent(self):
        manifest = {"seasons": [{"id": "2026/2027", "chunks": []}]}
        store = Store({"computed/dashboard/index.json": manifest})
        class RecentDB(DB):
            def execute(self, sql, params=None):
                if sql.startswith("select params from statarena.projections"):
                    return Result([('{"id":"p_1mZO3B"}',)])
                return super().execute(sql, params)
        store.db = RecentDB()
        players = {worker.MESSI_ID: {"name": "Lionel Messi", "minutes": 90, "observations": {("Lionel Messi", "Inter Miami CF"): "2026-11-02"}}}
        source = {"identitySourceUrl": "https://www.wikidata.org/wiki/Q615", "sourceUrl": "https://en.wikipedia.org/w/index.php?oldid=1", "honours": [{"name": "MLS Cup", "seasons": ["2025"]}]}
        with patch("aws_store.Store", return_value=store), patch.object(worker, "candidates_from_manifest", return_value=players), patch.object(worker, "collect_player", return_value=source) as collect, patch.object(worker.time, "sleep"), contextlib.redirect_stdout(io.StringIO()):
            worker.run(limit=1)
        self.assertEqual(collect.call_count, 1)


if __name__ == "__main__":
    unittest.main()
