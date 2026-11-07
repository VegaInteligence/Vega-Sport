"""Boundary and native-state checks for the incremental publication planner."""

import copy
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "dashboard/scripts"))
from build_dashboard_data import build_snapshot
from relational_core import row_batches
from relational_core_delta import snapshot_state, match_inputs, fixtures
from test_dashboard_data import synthetic


class DeltaContracts(unittest.TestCase):
    def test_statement_limits_cover_rows_and_utf8_bytes_without_loss(self):
        rows = [dict(id=i, value="é"*i) for i in range(60)]
        batches = list(row_batches(rows, max_rows=5, max_bytes=300))
        self.assertEqual([row for batch in batches for row in batch], rows)
        self.assertTrue(all(len(batch) <= 5 for batch in batches))
        self.assertTrue(all(sum(len(json.dumps(row, ensure_ascii=False).encode()) for row in batch) <= 300 for batch in batches))

    def test_oversized_row_is_rejected_without_silent_truncation(self):
        with self.assertRaises(ValueError):
            list(row_batches([dict(value="é"*1000)], max_bytes=1000))

    def test_persisted_native_scalar_differences_are_not_false_noops(self):
        value = build_snapshot(*synthetic())
        states = []
        for jersey in (None, 0, False, "0", "09", 9):
            item = copy.deepcopy(value)
            item["appearances"][0]["shirtNumber"] = jersey
            states.append(snapshot_state(item, "2026/2027", "l_000001")["matches"])
        self.assertEqual(len({json.dumps(state, sort_keys=True) for state in states}), len(states))

    def test_semantically_identical_float8_values_do_not_rewrite_facts(self):
        value = build_snapshot(*synthetic())
        other = copy.deepcopy(value)
        value["appearances"][0]["goals"] = 1
        other["appearances"][0]["goals"] = 1.0
        self.assertEqual(snapshot_state(value, "2026/2027", "l_000001"), snapshot_state(other, "2026/2027", "l_000001"))

    def test_duplicate_or_orphaned_identities_fail_before_replacement(self):
        value = build_snapshot(*synthetic())
        for key in ("matches", "appearances"):
            broken = copy.deepcopy(value)
            broken[key].append(broken[key][0])
            with self.assertRaises(ValueError):
                match_inputs(broken)
        value["appearances"][0]["matchId"] = "m_orphan"
        with self.assertRaises(ValueError):
            match_inputs(value)

    def test_fixture_in_another_competition_is_rejected(self):
        with self.assertRaises(ValueError):
            fixtures({"fixtures": [{"id": "m_a", "league": {"id": "l_other"}}]}, "2026/2027", "l_current")


if __name__ == "__main__":
    unittest.main()
