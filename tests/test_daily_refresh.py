import copy
import datetime as dt
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "dashboard/scripts"))
from build_dashboard_data import build_snapshot
from neon_ingest import (
    DAILY_DISCOVERY_PRIORITY,
    DAILY_MATCH_PRIORITY,
    PULSE_AUX_PRIORITY,
    PULSE_DISCOVERY_PRIORITY,
    PULSE_MATCH_PRIORITY,
    discover,
    enqueue_pulse_matches,
    enqueue_recent_matches,
    publish_pending,
    seed,
)
from neon_store import Store
from test_dashboard_data import synthetic


class Result:
    def __init__(self, rows=()):
        self.rows = list(rows)
    def __iter__(self):
        return iter(self.rows)


class DB:
    def __init__(self, rows=()):
        self.rows = rows
        self.calls = []
    def execute(self, sql, params=None):
        self.calls.append((sql, params))
        return Result(self.rows)


class Queue:
    def __init__(self, rows=()):
        self.db = DB(rows)
        self.jobs = []
    def enqueue(self, endpoint, params=None, priority=3, refresh=False, force=False):
        self.jobs.append({"endpoint": endpoint, "params": params, "priority": priority, "force": force})


class DailyRefreshTest(unittest.TestCase):
    def test_daily_jobs_preempt_historical_backfill_and_force_recent_data(self):
        store = Queue([("m_000001",)])
        seed(store, "daily")
        league = next(x for x in store.jobs if x["endpoint"] == "/leagues")
        player = next(x for x in store.jobs if x["endpoint"] == "/matches/m_000001/players")
        self.assertEqual(league["priority"], DAILY_DISCOVERY_PRIORITY)
        self.assertEqual(player["priority"], DAILY_MATCH_PRIORITY)
        self.assertLess(player["priority"], -30000)
        self.assertTrue(player["force"])
        self.assertTrue(any(x["endpoint"].endswith("/heatmaps") and x["params"] == {"frame": "home_ltr"} for x in store.jobs))

    def test_recently_discovered_matches_are_refreshed_without_replaying_old_seasons(self):
        today = dt.date(2026, 11, 4)
        store = Queue()
        enqueue_recent_matches(store, [
            {"id": "m_000001", "date": "2026-11-03"},
            {"id": "m_000002", "date": "2026-10-01"},
        ], today)
        self.assertTrue(any(x["endpoint"] == "/matches/m_000001/players" and x["force"] for x in store.jobs))
        self.assertFalse(any("m_000002" in x["endpoint"] for x in store.jobs))

    def test_morning_refresh_selects_recent_games_across_leagues(self):
        now = dt.datetime(2026, 11, 4, 6, 10, tzinfo=dt.timezone.utc)
        store = Queue()
        enqueue_pulse_matches(store, [
            {"id": "m_MLS001", "time_utc": "2026-11-04T03:30:00Z", "status": "finished"},
            {"id": "m_KSA001", "time_utc": "2026-11-03T18:00:00Z", "status": "finished"},
            {"id": "m_LATE01", "time_utc": "2026-11-04T04:20:00Z", "status": "playing"},
            {"id": "m_OLD001", "time_utc": "2026-11-03T15:00:00Z", "status": "finished"},
            {"id": "m_POST01", "time_utc": "2026-11-03T18:00:00Z", "status": "postponed"},
            {"id": "m_UNKN01", "date": "2026-11-03", "status": "finished"},
        ], now)
        players = {job["endpoint"] for job in store.jobs if job["endpoint"].count("/") == 3 and job["endpoint"].endswith("/players")}
        self.assertEqual(players, {
            "/matches/m_MLS001/players", "/matches/m_KSA001/players", "/matches/m_UNKN01/players"
        })
        self.assertTrue(all(job["force"] for job in store.jobs))
        self.assertTrue(all(job["priority"] in {PULSE_MATCH_PRIORITY, PULSE_AUX_PRIORITY} for job in store.jobs))

    def test_morning_seed_does_not_replay_the_full_league_inventory(self):
        now = dt.datetime.now(dt.timezone.utc)
        match = {"id": "m_MLS001", "time_utc": (now - dt.timedelta(hours=3)).isoformat(), "status": "finished"}
        store = Queue([(match,)])
        seed(store, "pulse")
        dates = [job for job in store.jobs if job["endpoint"].startswith("/date/")]
        self.assertEqual(len(dates), 2)
        self.assertTrue(all(job["priority"] == PULSE_DISCOVERY_PRIORITY for job in dates))
        self.assertFalse(any(job["endpoint"] == "/leagues" for job in store.jobs))
        self.assertTrue(any(job["endpoint"] == "/matches/m_MLS001/players" for job in store.jobs))

    def test_morning_discovery_queues_only_games_in_the_refresh_window(self):
        now = dt.datetime.now(dt.timezone.utc)
        recent = {"id": "m_MLS001", "time_utc": (now - dt.timedelta(hours=3)).isoformat(), "status": "finished"}
        future = {"id": "m_MLS002", "time_utc": (now + dt.timedelta(hours=3)).isoformat(), "status": "not_started"}
        store = Queue()
        with patch("neon_ingest.matches") as record_fixtures:
            discover(store, "/date/2026-11-04", {"matches": [recent, future]}, "pulse")
        self.assertFalse(record_fixtures.call_args.kwargs["enqueue_details"])
        self.assertTrue(any("m_MLS001" in job["endpoint"] for job in store.jobs))
        self.assertFalse(any("m_MLS002" in job["endpoint"] for job in store.jobs))

    def test_force_uses_run_start_not_the_six_hour_cache(self):
        store = Store.__new__(Store)
        store.db, store.queue = DB(), {}
        store.refresh_since = dt.datetime(2026, 11, 4, 8, 30, tzinfo=dt.timezone.utc)
        store.enqueue("/matches/m_000001/players", priority=DAILY_MATCH_PRIORITY, force=True)
        store.flush()
        sql, params = store.db.calls[0]
        self.assertIn("r.updated_at >= %s", sql)
        self.assertNotIn("interval '6 hours'", sql)
        self.assertEqual(params[1], store.refresh_since)
        self.assertEqual(params[-2:], (True, True))

    def test_daily_publication_prioritizes_both_requested_leagues(self):
        for mode in ("daily", "pulse"):
            with self.subTest(mode=mode), patch("neon_materialize.materialize") as materialize:
                publish_pending(object(), mode)
                self.assertEqual([call.kwargs.get("league_id") for call in materialize.call_args_list[:2]], ["l_0eg6C9", "l_0Lpz1f"])
                self.assertTrue(all(call.kwargs["recent_first"] for call in materialize.call_args_list[:2]))
                self.assertTrue(materialize.call_args_list[-1].kwargs["recent_first"])

    def test_updated_provider_goal_changes_the_normalized_player_stat(self):
        raw, catalog = synthetic()
        before = copy.deepcopy(raw)
        before["samples"][0]["players"]["data"][0]["stats"][0]["stats"]["Goals"]["stat"]["value"] = 0
        old = next(x for x in build_snapshot(before, catalog)["appearances"] if x["matchId"] == "m_000001")
        new = next(x for x in build_snapshot(raw, catalog)["appearances"] if x["matchId"] == "m_000001")
        self.assertEqual((old["goals"], new["goals"]), (0, 1))


if __name__ == "__main__":
    unittest.main()
