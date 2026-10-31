"""Regression checks for data integrity and unavailable statistics."""

import copy
import importlib.util
import json
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("build_dashboard_data", ROOT / "scripts/build_dashboard_data.py")
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class DashboardDataTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.raw = json.loads((ROOT / "data/pitchapi_premiers_matchs.json").read_text(encoding="utf-8-sig"))
        cls.catalog = json.loads((ROOT / "data/pitchapi_championnats.json").read_text(encoding="utf-8-sig"))
        cls.snapshot = builder.build_snapshot(cls.raw, cls.catalog)

    def test_sample_counts_and_unique_references(self):
        meta = self.snapshot["meta"]
        self.assertEqual((meta["matchCount"], meta["playerCount"], meta["appearanceCount"], meta["catalogCount"]), (9, 320, 274, 77))
        self.assertEqual((meta["shotCount"], meta["knownShotXgCount"], meta["ratedAppearanceCount"]), (234, 233, 109))
        ids = [p["id"] for p in self.snapshot["appearances"]]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual(set(ids), {identity for m in self.snapshot["matches"] for identity in m["players"]})

    def test_missing_own_goal_xg_is_not_zero(self):
        own_goals = [s for m in self.snapshot["matches"] for s in m["shots"] if s["isOwnGoal"]]
        self.assertEqual(len(own_goals), 1)
        self.assertIsNone(own_goals[0]["xg"])
        self.assertFalse(own_goals[0]["isGoal"])

    def test_suspicious_empty_shots_do_not_become_performance_zeroes(self):
        match = next(m for m in self.snapshot["matches"] if m["league"] == "3. Liga")
        self.assertFalse(match["coverage"]["shots"])
        self.assertFalse(match["coverage"]["teamStatsReliable"])
        self.assertEqual(match["shots"], [])
        self.assertIsNone(match["home"]["shots"])
        self.assertEqual((match["home"]["score"], match["away"]["score"]), (1, 2))
        players = [p for p in self.snapshot["appearances"] if p["matchId"] == match["id"]]
        self.assertTrue(all(p["shots"] is None and p["touches"] is None and p["passesAccurate"] is None for p in players))
        self.assertEqual(sum(p["goals"] or 0 for p in players), 3)
        self.assertGreater(sum(p["minutes"] or 0 for p in players), 0)

    def test_missing_metrics_and_roles_are_not_invented(self):
        player = next(p for p in self.snapshot["appearances"] if p["league"] == "HNL" and p["minutes"] > 0)
        self.assertIsNone(player["rating"])
        self.assertIsNone(player["xa"])
        self.assertTrue(all(p["role"] is None for p in self.snapshot["appearances"]))
        self.assertFalse(self.snapshot["meta"]["rankingAvailable"])

    def test_fraction_numerator_and_denominator_are_preserved(self):
        player = next(p for p in self.snapshot["appearances"] if p["name"] == "Olivier Giroud")
        self.assertEqual((player["passesAccurate"], player["passesAttempted"]), (4, 4))
        self.assertEqual(player["defensiveActions"], 1)  # Repeated in two provider groups.
        self.assertIsNone(builder.number(None))
        self.assertIsNone(builder.number(False))
        self.assertEqual(builder.number(0), 0)

    def test_exact_duplicate_samples_and_shots_are_not_counted_twice(self):
        duplicate = copy.deepcopy(self.raw)
        duplicate["samples"].append(copy.deepcopy(duplicate["samples"][0]))
        result = builder.build_snapshot(duplicate, self.catalog)
        self.assertEqual(result, self.snapshot)
        duplicate = copy.deepcopy(self.raw)
        period = duplicate["samples"][0]["shots"]["data"]["periods"][0]
        period["shots"].append(copy.deepcopy(period["shots"][0]))
        result = builder.build_snapshot(duplicate, self.catalog)
        self.assertEqual(result, self.snapshot)

    def test_failed_endpoint_is_not_treated_as_observed_data(self):
        failed = copy.deepcopy(self.raw)
        failed["samples"][0]["shots"]["ok"] = False
        failed["samples"][0]["players"]["ok"] = False
        result = builder.build_snapshot(failed, self.catalog)
        match = next(m for m in result["matches"] if m["id"] == failed["samples"][0]["match"]["id"])
        self.assertFalse(match["coverage"]["shots"])
        self.assertFalse(match["coverage"]["players"])
        self.assertEqual(match["players"], [])
        self.assertEqual(match["shots"], [])

    def test_build_is_deterministic_and_does_not_mutate_sources(self):
        before = json.dumps(self.raw, sort_keys=True)
        self.assertEqual(builder.build_snapshot(self.raw, self.catalog), self.snapshot)
        self.assertEqual(json.dumps(self.raw, sort_keys=True), before)
        json.dumps(self.snapshot, allow_nan=False)


if __name__ == "__main__":
    unittest.main()
