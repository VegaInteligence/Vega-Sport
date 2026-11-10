"""Synthetic end-to-end pilot; all transport responses stay in memory."""

import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from vega.pilot import Pilot
from vega.store import Store, connect_local, migrate

DSN = os.environ.get("VEGA_V2_PILOT_TEST_DSN")


@unittest.skipUnless(DSN, "requires dedicated local vega_v2_pilot_test DB")
class PilotTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        target = urlparse(DSN)
        if (
            target.hostname not in ("localhost", "127.0.0.1", "::1")
            or target.path != "/vega_v2_pilot_test"
        ):
            raise RuntimeError("dedicated local pilot DB required")
        cls.db = connect_local(DSN)
        if cls.db.execute(
            "SELECT to_regnamespace('core') IS NOT NULL OR to_regnamespace('agg') IS NOT NULL OR to_regnamespace('ops') IS NOT NULL"
        ).fetchone()[0]:
            raise RuntimeError("pilot test DB must be empty")
        migrate(cls.db)

    @classmethod
    def tearDownClass(cls):
        cls.db.execute("DROP SCHEMA IF EXISTS ops,agg,core CASCADE")
        cls.db.close()

    def test_all_families_reference_hydration_reimport_and_safe_report(self):
        name = "DO_NOT_LEAK_PROVIDER_NAME"
        secret = "DO_NOT_LEAK_PROVIDER_VALUE"
        home = {"id": "t_111111", "name": "Home"}
        away = {"id": "t_222222", "name": "Away"}
        match = {
            "id": "m_111111",
            "home_team": home,
            "away_team": away,
            "status": "finished",
            "date": "2026-01-01",
            "time_utc": "2026-01-01T12:00:00Z",
            "score_home": 2,
            "score_away": 0,
        }
        endpoints = {
            "/leagues": {
                "leagues": [
                    {
                        "id": "l_111111",
                        "name": "Ligue 1",
                        "country_code": "FRA",
                        "seasons": ["2025/2026"],
                    }
                ]
            },
            "/leagues/l_111111/matches": {
                "league": {"id": "l_111111", "name": "Ligue 1"},
                "matches": [match],
            },
            "/players/p_111111": {"id": "p_111111", "name": name},
            "/teams/t_111111": {"id": "t_111111", "name": "Home"},
            "/matches/m_111111": match,
            "/matches/m_111111/lineups": {
                "home_team": home,
                "away_team": away,
                "home": {
                    "starters": [
                        {"player_id": "p_111111", "pitch_x": 0.5, "pitch_y": 0.5}
                    ],
                    "subs": [],
                },
                "away": {"starters": [], "subs": []},
            },
            "/matches/m_111111/players": [
                {
                    "player": {"id": "p_111111", "name": name},
                    "team_id": home["id"],
                    "stats": [
                        {
                            "stats": {
                                "g": {
                                    "key": "goals",
                                    "stat": {"type": "integer", "value": 2},
                                }
                            }
                        }
                    ],
                }
            ],
            "/matches/m_111111/stats": {
                "home_team": home,
                "away_team": away,
                "periods": [
                    {
                        "period": "All",
                        "groups": [
                            {
                                "items": [
                                    {
                                        "key": "expected_goals",
                                        "home": "1.25",
                                        "away": "0.5",
                                        "format_type": "double",
                                    }
                                ]
                            }
                        ],
                    }
                ],
            },
            "/matches/m_111111/shots": {
                "periods": [
                    {
                        "period": "FirstHalf",
                        "shots": [
                            {
                                "id": "s_111111",
                                "team_id": home["id"],
                                "player": {"id": "p_111111", "name": name},
                                "minute": 12,
                                "expected_goals": 0.25,
                                "event_type": "Goal",
                                "situation": "RegularPlay",
                                "shot_type": "RightFoot",
                            }
                        ],
                    }
                ]
            },
            "/matches/m_111111/events": {
                "events": [],
                "unknown_payload": {"private": secret},
            },
            "/matches/m_111111/momentum": {"points": [{"minute": 1, "value": 0.5}]},
            "/matches/m_111111/players/halves": {"players": []},
            "/matches/m_111111/advanced": {"teams": []},
            "/matches/m_111111/advanced/players": {"players": []},
            "/matches/m_111111/advanced/network": {"networks": []},
            "/matches/m_111111/heatmaps": {
                "grid": {"length": 16, "width": 12, "frame": "acting_ltr"},
                "teams": [],
                "players": [],
            },
            "/matches/m_111111/h2h": {
                "home_wins": 1,
                "draws": 0,
                "away_wins": 0,
                "total_matches": 1,
            },
        }
        calls = []

        def transport(request, timeout):
            path = urlparse(request.full_url).path.removeprefix("/v1")
            calls.append(path)
            if path not in endpoints:
                raise AssertionError("Unexpected API endpoint " + path)
            return 200, {}, json.dumps({"data": endpoints[path]}).encode()

        pilot = Pilot(Store(self.db), "pk_test_synthetic", interval=0)
        pilot.client._transport = transport
        self.assertTrue(
            pilot.run(
                season="2025/2026",
                league_name="Ligue 1",
                max_matches=1,
                profile_limit=2,
            )
        )
        self.assertEqual(len(calls), 17)
        self.assertEqual(set(calls), set(endpoints))
        self.assertEqual(
            self.db.execute("SELECT count(*) FROM core.matches").fetchone()[0], 1
        )
        self.assertEqual(
            self.db.execute("SELECT goals FROM core.player_match_stats").fetchone()[0],
            2,
        )
        self.assertAlmostEqual(
            self.db.execute("SELECT xg FROM core.shots").fetchone()[0], 0.25
        )
        self.assertEqual(
            self.db.execute(
                "SELECT count(*) FROM ops.family_state WHERE status='ok'"
            ).fetchone()[0],
            13,
        )
        self.assertEqual(
            self.db.execute(
                "SELECT field_path FROM ops.unknown_fields WHERE family='events'"
            ).fetchone()[0],
            "events.unknown_payload",
        )
        before = self.db.execute("SELECT revision FROM core.matches").fetchone()[0]
        self.assertTrue(
            pilot.run(season="2025/2026", league_name="Ligue 1", max_matches=1)
        )
        self.assertEqual(
            self.db.execute("SELECT revision FROM core.matches").fetchone()[0], before
        )
        self.assertEqual(
            self.db.execute("SELECT count(*) FROM core.shots").fetchone()[0], 1
        )
        with tempfile.TemporaryDirectory() as directory:
            report = Path(directory) / "report.md"
            pilot.report(report)
            text = report.read_text(encoding="utf-8")
            self.assertNotIn(name, text)
            self.assertNotIn(secret, text)
            self.assertNotIn("pk_test_synthetic", text)
            self.assertIn("events.unknown_payload", text)


if __name__ == "__main__":
    unittest.main()
