"""Worker loop end to end against an in-memory PitchAPI: plan, collect, calculate."""

import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys
import tempfile
import unittest
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from vega_v2 import planner
from vega_v2.jobs import DETAIL_FAMILIES
from vega_v2.pitchapi import PitchClient
from vega_v2.store import Store, StoreError, connect_local, migrate
from vega_v2.worker import Worker, connect, report

DSN = os.environ.get("VEGA_V2_WORKER_TEST_DSN")
HOME = {"id": "t_aaaaaa", "name": "Home FC"}
AWAY = {"id": "t_bbbbbb", "name": "Away FC"}
LIGUE1 = {"id": "l_aaaaaa", "name": "Ligue 1", "country_code": "FRA"}
PLAYER = {"id": "p_aaaaaa", "name": "Synthetic Player"}


def iso(value):
    return value.isoformat().replace("+00:00", "Z")


def match(key, kickoff, status, score=None, season="2025/2026"):
    item = {
        "id": key,
        "home_team": HOME,
        "away_team": AWAY,
        "league": LIGUE1,
        "season": season,
        "status": status,
        "date": kickoff.date().isoformat(),
        "time_utc": iso(kickoff),
        "round": "Matchday 12",
    }
    if season is None:
        del item["season"]
    if score:
        item.update(score_home=score[0], score_away=score[1])
    return item


def details(key, goals=2):
    """The 12 detail families of one finished match (shapes from the pilot fixture)."""
    base = "/matches/" + key
    return {
        base + "/lineups": {
            "home_team": HOME,
            "away_team": AWAY,
            "home": {"starters": [{"player_id": PLAYER["id"], "pitch_x": 0.5, "pitch_y": 0.5}], "subs": []},
            "away": {"starters": [], "subs": []},
        },
        base + "/players": [
            {
                "player": PLAYER,
                "team_id": HOME["id"],
                "stats": [
                    {
                        "stats": {
                            "g": {"key": "goals", "stat": {"type": "integer", "value": goals}},
                            "m": {"key": "minutes_played", "stat": {"type": "integer", "value": 90}},
                        }
                    }
                ],
            }
        ],
        base + "/stats": {
            "home_team": HOME,
            "away_team": AWAY,
            "periods": [
                {
                    "period": "All",
                    "groups": [{"items": [{"key": "expected_goals", "home": "1.25", "away": "0.5", "format_type": "double"}]}],
                }
            ],
        },
        base + "/shots": {"periods": []},
        base + "/events": {"events": []},
        base + "/momentum": {"points": [{"minute": 1, "value": 0.5}]},
        base + "/players/halves": {"players": []},
        base + "/advanced": {"teams": []},
        base + "/advanced/players": {"players": []},
        base + "/advanced/network": {"networks": []},
        base + "/heatmaps": {"grid": {"length": 16, "width": 12, "frame": "acting_ltr"}, "teams": [], "players": []},
        base + "/h2h": {"home_wins": 1, "draws": 0, "away_wins": 0, "total_matches": 1},
    }


class FakeApi:
    def __init__(self):
        self.routes = {}
        self.errors = {}
        self.calls = []

    def __call__(self, request, timeout):
        path = urlparse(request.full_url).path.removeprefix("/v1")
        self.calls.append(path)
        if path in self.errors:
            status, code = self.errors[path]
            return status, {}, json.dumps({"error": {"code": code}}).encode()
        if path.startswith("/date/") and path not in self.routes:
            return 200, {}, json.dumps({"data": {"date": path[6:], "matches": []}}).encode()
        if path not in self.routes:
            return 404, {}, json.dumps({"error": {"code": "RESOURCE_NOT_FOUND"}}).encode()
        return 200, {}, json.dumps({"data": self.routes[path]}).encode()


class ConnectTest(unittest.TestCase):
    def test_remote_needs_tls_and_a_v2_database(self):
        for dsn in (
            "postgresql://u:p@db.example.com/vega_v2",
            "postgresql://u:p@db.example.com/statarena?sslmode=require",
        ):
            with self.assertRaises(StoreError):
                connect(dsn)


@unittest.skipUnless(DSN, "requires dedicated local vega_v2_worker_test DB")
class WorkerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        target = urlparse(DSN)
        if target.hostname not in ("localhost", "127.0.0.1", "::1") or target.path != "/vega_v2_worker_test":
            raise RuntimeError("dedicated local worker DB required")
        cls.db = connect_local(DSN)

    @classmethod
    def tearDownClass(cls):
        cls.db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        cls.db.close()

    def setUp(self):
        self.db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        migrate(self.db)
        # Leases are checked against the database clock: the fake clock only moves forward.
        self.now = datetime.now(timezone.utc).replace(second=0, microsecond=0) + timedelta(minutes=1)
        self.api = FakeApi()
        self.api.routes.update(
            {
                "/leagues": {"leagues": [dict(LIGUE1, seasons=["2025/2026"])]},
                "/leagues/" + LIGUE1["id"]: dict(LIGUE1, season="2025/2026"),
                "/teams/" + HOME["id"]: HOME,
                "/teams/" + AWAY["id"]: AWAY,
                "/players/" + PLAYER["id"]: PLAYER,
            }
        )
        client = PitchClient("pk_test_synthetic", interval=0, retries=0, transport=self.api, sleep=lambda _: None)
        self.worker = Worker(Store(self.db), client, clock=lambda: self.now, cohort_delay=0)

    def at(self, value):
        self.now = value
        return planner.plan(self.db, value)

    def drain(self):
        count = 0
        while self.worker.step():
            count += 1
            self.assertLess(count, 500)
        return count

    def calendar(self, *matches, day=None):
        day = day or self.now.date()
        self.api.routes["/date/" + day.isoformat()] = {"date": day.isoformat(), "matches": list(matches)}

    def mid(self, key):
        return self.db.execute(
            "SELECT entity_id FROM core.provider_ids WHERE entity_type='match' AND provider='pitchapi' AND provider_key=%s",
            (key,),
        ).fetchone()[0]

    def watch(self, key):
        return self.db.execute(
            "SELECT state::text, next_check_at, checks FROM ops.match_watch WHERE match_id=%s", (self.mid(key),)
        ).fetchone()

    def jobs(self, key, family=None, state=None):
        return self.db.execute(
            "SELECT family::text, state::text, run_after FROM ops.fetch_jobs WHERE entity_type='match' AND entity_id=%s AND (%s::text IS NULL OR family::text=%s) AND (%s::text IS NULL OR state::text=%s) ORDER BY id",
            (self.mid(key), family, family, state, state),
        ).fetchall()

    def test_match_lifecycle_from_calendar_to_correction(self):
        start = self.now
        a_kick, b_kick = start - timedelta(hours=3), start + timedelta(hours=30)
        self.calendar(
            match("m_aaaaaa", a_kick, "finished", (2, 0)),
            match("m_bbbbbb", b_kick, "not_started"),
            match("m_cccccc", start + timedelta(hours=2), "postponed"),
        )
        counts = self.at(start)
        self.assertEqual(counts["calendar"], 9)
        self.assertEqual(counts["reference"], 1)  # the weekly league catalogue
        self.assertEqual(self.at(start).get("calendar", 0), 0)
        self.drain()
        self.assertEqual(self.watch("m_aaaaaa")[:2], ("scheduled", start))
        self.assertEqual(self.watch("m_bbbbbb")[:2], ("scheduled", b_kick + timedelta(minutes=105)))
        self.assertEqual(self.watch("m_cccccc")[:2], ("stopped", None))
        dates = sorted(p for p in self.api.calls if p.startswith("/date/"))
        self.assertEqual(len(dates), 9)
        self.assertEqual(dates[0], "/date/" + (start.date() - timedelta(days=1)).isoformat())

        # Next plan: score check of the finished match, B's lineup forecast and h2h,
        # the active edition's calendar and competition (weekly).
        self.api.routes["/matches/m_aaaaaa"] = match("m_aaaaaa", a_kick, "finished", (2, 0))
        self.api.routes.update(details("m_aaaaaa"))
        self.api.routes["/matches/m_bbbbbb/h2h"] = {"home_wins": 0, "draws": 1, "away_wins": 0, "total_matches": 1}
        self.api.routes["/leagues/l_aaaaaa/matches"] = {
            "league": {"id": "l_aaaaaa", "name": "Ligue 1"},
            "matches": [match("m_aaaaaa", a_kick, "finished", (2, 0)), match("m_bbbbbb", b_kick, "not_started")],
        }
        counts = self.at(start)
        self.assertEqual((counts["summary"], counts["lineups"], counts["h2h"], counts["reference"]), (1, 1, 1, 2))
        self.drain()
        state, next_at, checks = self.watch("m_aaaaaa")
        self.assertEqual((state, next_at, checks), ("final", start + timedelta(hours=24), 1))
        self.assertEqual(len(self.jobs("m_aaaaaa", state="done")), 13)  # summary + 12 families
        self.assertEqual([row[1] for row in self.jobs("m_aaaaaa", "summary", "pending")], ["pending"])
        self.assertEqual(
            self.db.execute(
                "SELECT count(*) FROM ops.family_state WHERE match_id=%s AND status IN ('ok','unavailable')",
                (self.mid("m_aaaaaa"),),
            ).fetchone()[0],
            13,
        )
        # The lineup forecast was not published yet: a permanent failure, kept visible.
        self.assertEqual(self.jobs("m_bbbbbb", "lineups")[0][1], "failed")
        self.assertEqual(self.db.execute("SELECT count(*) FROM ops.fetch_log").fetchone()[0], len(self.api.calls))

        # Calculator: the dirty scopes of the finished match become season rows.
        self.worker.calculate()
        goals, minutes = self.db.execute(
            "SELECT s.goals_sum, s.appearances FROM agg.player_season_stats s JOIN core.provider_ids p ON p.entity_type='player' AND p.entity_id=s.player_id WHERE p.provider_key=%s",
            (PLAYER["id"],),
        ).fetchone()
        self.assertEqual((goals, minutes), (2, 1))
        self.assertEqual(self.db.execute("SELECT count(*) FROM ops.dirty_scopes").fetchone()[0], 0)

        # A at +24 h: the provider corrected the score, details are fetched once more.
        self.api.routes["/matches/m_aaaaaa"] = match("m_aaaaaa", a_kick, "finished", (2, 1))
        self.at(start + timedelta(hours=24, minutes=1))
        self.worker.lanes = ("score",)
        self.drain()
        self.assertEqual(self.watch("m_aaaaaa")[0], "corrected")
        self.assertEqual(len(self.jobs("m_aaaaaa", state="pending")), len(DETAIL_FAMILIES))
        self.assertEqual(
            self.db.execute("SELECT away_score FROM core.matches WHERE id=%s", (self.mid("m_aaaaaa"),)).fetchone()[0],
            1,
        )
        self.worker.lanes = ("score", "details", "reference")

        # B at kickoff: the failed forecast is revived, the confirmed lineups arrive.
        self.api.routes.update(details("m_bbbbbb", goals=1))
        self.assertEqual(self.at(b_kick + timedelta(minutes=1))["lineups"], 1)
        self.drain()
        self.assertEqual(self.jobs("m_bbbbbb", "lineups")[0][1], "done")

        # +105: still playing, so checks every 2 minutes; +107: finished.
        self.api.routes["/matches/m_bbbbbb"] = match("m_bbbbbb", b_kick, "in_play", (1, 1))
        self.at(b_kick + timedelta(minutes=105))
        self.drain()
        self.assertEqual(self.watch("m_bbbbbb")[:2], ("waiting_final", b_kick + timedelta(minutes=107)))
        self.api.routes["/matches/m_bbbbbb"] = match("m_bbbbbb", b_kick, "finished", (1, 1))
        self.at(b_kick + timedelta(minutes=107))
        self.drain()
        self.assertEqual(self.watch("m_bbbbbb")[0], "final")
        # lineups at kickoff, h2h before, two score checks, then the 12 families.
        self.assertEqual(len(self.jobs("m_bbbbbb", state="done")), 1 + 1 + 2 + len(DETAIL_FAMILIES))

        # The run report carries measurements only, never names or other provider values.
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "worker.md"
            report(self.worker, path, jobs=1, seconds=0)
            text = path.read_text(encoding="utf-8")
        for secret in (HOME["name"], AWAY["name"], PLAYER["name"], "m_aaaaaa", "t_aaaaaa"):
            self.assertNotIn(secret, text)
        self.assertIn("## Watches", text)

    def test_rescheduled_and_never_final_watches(self):
        start = self.now
        e_kick = start - timedelta(hours=1)
        self.api.routes["/matches/m_eeeeee"] = match("m_eeeeee", e_kick, "in_play")
        self.calendar(match("m_dddddd", start + timedelta(hours=5), "postponed"), match("m_eeeeee", e_kick, "in_play"))
        self.at(start)
        self.drain()
        self.assertEqual(self.watch("m_dddddd")[0], "stopped")
        self.assertEqual(self.watch("m_eeeeee")[:2], ("scheduled", e_kick + timedelta(minutes=105)))
        self.worker.lanes = ("score",)
        self.at(e_kick + timedelta(minutes=105))
        self.drain()
        self.assertEqual(self.watch("m_eeeeee")[:2], ("waiting_final", e_kick + timedelta(minutes=107)))

        # The next day's calendar gives D a new date: the watch restarts on it.
        new_kick = start + timedelta(days=3)
        self.calendar(match("m_eeeeee", e_kick, "in_play"))
        self.calendar(match("m_dddddd", new_kick, "not_started"), day=new_kick.date())
        self.at(start + timedelta(days=1))
        self.drain()
        self.assertEqual(self.watch("m_dddddd")[:2], ("scheduled", new_kick + timedelta(minutes=105)))

        # E never reaches a final status: hourly, then daily, then stopped at +7 days.
        self.at(e_kick + timedelta(days=7, minutes=1))
        self.drain()
        self.assertEqual(self.watch("m_eeeeee")[:2], ("stopped", None))
        self.assertEqual(
            self.db.execute("SELECT kind::text FROM ops.data_warnings WHERE match_id=%s", (self.mid("m_eeeeee"),)).fetchone()[0],
            "score_never_final",
        )

    def test_failures_retry_then_stop_and_daily_revival(self):
        start = self.now
        kick = start - timedelta(hours=2)
        self.calendar(match("m_ffffff", kick, "finished", (0, 0)))
        self.at(start)
        self.drain()
        self.worker.lanes = ("score",)
        self.api.errors["/matches/m_ffffff"] = (503, "INTERNAL_SERVER_ERROR")
        self.at(start)
        self.drain()
        family, state, run_after = self.jobs("m_ffffff", "summary")[-1]
        self.assertEqual(state, "pending")  # transient: retried with backoff
        self.assertGreater(run_after, start)
        self.assertEqual(self.watch("m_ffffff")[0], "scheduled")
        self.api.errors["/matches/m_ffffff"] = (404, "RESOURCE_NOT_FOUND")
        self.now = run_after
        self.drain()
        self.assertEqual(self.jobs("m_ffffff", "summary")[-1][1], "failed")
        self.assertEqual(self.watch("m_ffffff")[:2], ("stopped", None))
        codes = [r[0] for r in self.db.execute("SELECT error_code FROM ops.parse_failures WHERE family='summary' ORDER BY id")]
        self.assertEqual(codes, ["HTTP_SERVER_ERROR", "RESOURCE_NOT_FOUND"])
        # A permanent failure stays failed; a transient one gets a new try a day later.
        self.db.execute(
            "UPDATE ops.fetch_jobs SET state='failed', last_error_code='HTTP_SERVER_ERROR' WHERE family='calendar' AND target_date=%s",
            (start.date(),),
        )
        self.assertEqual(self.at(start + timedelta(hours=25))["revived"], 1)
        self.assertEqual(self.jobs("m_ffffff", "summary")[-1][1], "failed")

    def test_date_matches_without_edition_and_new_statuses(self):
        # Real /date responses name the competition but not the edition.
        start = self.now
        self.api.routes["/leagues/" + LIGUE1["id"]] = dict(LIGUE1, seasons=["2024/2025", "2025/2026"])
        self.calendar(
            match("m_iiiiii", start + timedelta(hours=4), "not_started", season=None),
            dict(match("m_jjjjjj", start - timedelta(hours=1), "in_play", season=None), status="abandoned"),
        )
        self.at(start)
        self.worker.lanes = ("score",)
        self.drain()
        label, current = self.db.execute(
            "SELECT cs.native_label, cs.is_current FROM core.matches m JOIN core.competition_seasons cs ON cs.id=m.competition_season_id WHERE m.id=%s",
            (self.mid("m_iiiiii"),),
        ).fetchone()
        self.assertEqual((label, current), ("2025/2026", True))
        self.assertEqual(
            self.db.execute("SELECT count(*) FROM core.competition_seasons WHERE is_current").fetchone()[0], 1
        )
        self.assertEqual(self.watch("m_iiiiii")[0], "scheduled")
        # An unknown status is reported as a path and leaves the rest of the day intact.
        self.assertIsNone(self.db.execute("SELECT status FROM core.matches WHERE id=%s", (self.mid("m_jjjjjj"),)).fetchone()[0])
        self.assertEqual(
            self.db.execute("SELECT field_path FROM ops.unknown_fields WHERE family='calendar'").fetchall(),
            [("match.status.abandoned",)],
        )
        self.assertEqual(self.db.execute("SELECT count(*) FROM ops.parse_failures").fetchone()[0], 0)

    def test_summary_edition_wins_over_the_assumed_one(self):
        start = self.now
        self.api.routes["/leagues/" + LIGUE1["id"]] = dict(LIGUE1, seasons=["2024/2025", "2025/2026"])
        kick = start - timedelta(hours=3)
        self.calendar(match("m_llllll", kick, "finished", (1, 0), season=None))
        self.at(start)
        self.worker.lanes = ("score",)
        self.drain()
        # /matches/{id} says the match belongs to 2024/2025, not the current edition.
        self.api.routes["/matches/m_llllll"] = match("m_llllll", kick, "finished", (1, 0), season="2024/2025")
        self.at(start)
        self.drain()
        label = self.db.execute(
            "SELECT cs.native_label FROM core.matches m JOIN core.competition_seasons cs ON cs.id=m.competition_season_id WHERE m.id=%s",
            (self.mid("m_llllll"),),
        ).fetchone()[0]
        self.assertEqual((label, self.watch("m_llllll")[0]), ("2024/2025", "final"))
        self.assertEqual(self.db.execute("SELECT count(*) FROM ops.parse_failures").fetchone()[0], 0)

    def test_bad_match_does_not_block_the_day_and_jobs_are_pruned(self):
        start = self.now
        kick = start + timedelta(hours=6)
        self.calendar(match("m_gggggg", kick, "not_started"), match("m_kkkkkk", kick, "not_started"))
        self.at(start)
        self.drain()
        # G already has after-match facts, K only a forecast lineup.
        self.db.execute(
            "INSERT INTO ops.family_state(match_id, family, status) VALUES (%s, 'shots', 'ok'), (%s, 'lineups', 'ok')",
            (self.mid("m_gggggg"), self.mid("m_kkkkkk")),
        )
        # The provider moves G and K to another edition; H of that edition must still be
        # saved, K moves with it (its forecast is dropped), G is refused visibly.
        self.calendar(
            match("m_gggggg", kick, "not_started", season="2024/2025"),
            match("m_hhhhhh", kick, "not_started", season="2024/2025"),
            match("m_kkkkkk", kick, "not_started", season="2024/2025"),
        )
        self.at(start + timedelta(days=1))
        self.drain()
        self.assertEqual(self.watch("m_hhhhhh")[0], "scheduled")
        labels = dict(
            self.db.execute(
                "SELECT p.provider_key, cs.native_label FROM core.matches m JOIN core.competition_seasons cs ON cs.id = m.competition_season_id JOIN core.provider_ids p ON p.entity_type='match' AND p.entity_id=m.id"
            ).fetchall()
        )
        self.assertEqual(labels, {"m_gggggg": "2025/2026", "m_hhhhhh": "2024/2025", "m_kkkkkk": "2024/2025"})
        self.assertIsNone(
            self.db.execute("SELECT 1 FROM ops.family_state WHERE match_id=%s AND family='lineups'", (self.mid("m_kkkkkk"),)).fetchone()
        )
        self.assertEqual(
            self.db.execute("SELECT error_code FROM ops.parse_failures WHERE family='calendar'").fetchall(),
            [("MATCH_SEASON_CHANGED",)],
        )
        done = self.db.execute("SELECT count(*) FROM ops.fetch_jobs WHERE state='done'").fetchone()[0]
        self.assertGreater(done, 0)
        self.assertGreaterEqual(self.at(start + timedelta(days=16))["pruned"], done)


if __name__ == "__main__":
    unittest.main()
