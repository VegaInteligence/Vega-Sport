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
