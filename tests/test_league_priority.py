import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "dashboard/scripts"))
from neon_ingest import ENDPOINTS, claim_job, prioritize_league
from neon_materialize import competition_metadata


class Result:
    def __init__(self, rows):
        self.rows = rows

    def fetchall(self):
        return self.rows

    def fetchone(self):
        return self.rows[0] if self.rows else None


class Database:
    def __init__(self, rows):
        self.rows = rows
        self.calls = []

    def execute(self, sql, params=None):
        self.calls.append((sql, params))
        return Result(self.rows)


class Store:
    def __init__(self, rows):
        self.db = Database(rows)
        self.jobs = []

    def enqueue(self, endpoint, params=None, priority=3, refresh=False):
        self.jobs.append((endpoint, params, priority, refresh))


class LeaguePriorityTest(unittest.TestCase):
    def test_seed_orders_seasons_and_core_statistics_before_other_data(self):
        store = Store([("m_000001", "2026/2027"), ("m_000002", "2025/2026")])
        report = prioritize_league(store, "l_0Lpz1f")
        self.assertEqual(report["matches"], 2)
        self.assertEqual(report["seasons"], ["2026/2027", "2025/2026"])
        jobs = {(endpoint, str(params)): priority for endpoint, params, priority, _ in store.jobs}
        self.assertLess(jobs[("/matches/m_000001/players", "None")], jobs[("/matches/m_000001/events", "None")])
        self.assertLess(jobs[("/matches/m_000001/events", "None")], jobs[("/matches/m_000002/players", "None")])
        self.assertEqual(len(store.jobs), 2 * (len(ENDPOINTS) + 1))
        self.assertIn("status='finished'", store.db.calls[0][0])
        self.assertEqual(store.db.calls[0][1], ("l_0Lpz1f",))

    def test_empty_or_invalid_league_is_not_silently_processed(self):
        with self.assertRaises(ValueError):
            prioritize_league(Store([]), "l_0Lpz1f")
        with self.assertRaises(ValueError):
            prioritize_league(Store([]), "invalid")

    def test_claim_is_limited_to_finished_matches_in_the_requested_league(self):
        store = Store([])
        self.assertIsNone(claim_job(store, "l_0Lpz1f"))
        sql, args = store.db.calls[-1]
        self.assertIn("f.league_id=%s", sql)
        self.assertIn("f.status='finished'", sql)
        self.assertEqual(args, ("l_0Lpz1f",))

    def test_competition_identity_fills_missing_values_without_overwriting_existing(self):
        profile = {"name": "Saudi Pro League", "country_code": "KSA", "image_url": "logo"}
        previous = {"id": "l_0Lpz1f", "name": "Saudi Pro League", "country": "", "imageUrl": None, "seasons": ["2025/2026"]}
        result = competition_metadata(previous, profile, "l_0Lpz1f", "2026/2027", [])
        self.assertEqual((result["country"], result["providerCountry"], result["imageUrl"]), ("KSA", "KSA", "logo"))
        self.assertEqual(result["seasons"], ["2025/2026", "2026/2027"])
        result = competition_metadata({"name": "Curated", "country": "FRA", "imageUrl": "existing"}, profile, "l_xxxxxx", "2026/2027", [])
        self.assertEqual((result["name"], result["country"], result["imageUrl"]), ("Curated", "FRA", "existing"))


if __name__ == "__main__":
    unittest.main()
