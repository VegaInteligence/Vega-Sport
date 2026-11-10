"""Drift tests between the read API's static tables and their sources of truth."""

from pathlib import Path
import re
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from vega.schema_contract import PITCHAPI_TEAM_KEYS, TEAM_STATS_COLUMNS


class TeamStatKeysTest(unittest.TestCase):
    def test_keys_columns_and_site_order(self):
        api = re.findall(r'\["([^"]+)", "([a-z_]+)", "(double|integer)"\]', (ROOT / "api/src/team-stats.mjs").read_text())
        self.assertTrue(api)
        for key, column, fmt in api:
            self.assertEqual(PITCHAPI_TEAM_KEYS[key], column, key)
            self.assertIn(column, TEAM_STATS_COLUMNS)
        site = (ROOT.parent / "dashboard/frontend/src/services/match-data.js").read_text()
        order = re.findall(r'\["([^"]+)", "[^"]+", "[^"]+"\]', site.split("const definitions = [")[1].split("];")[0])
        self.assertEqual([key for key, _, _ in api], order)


if __name__ == "__main__":
    unittest.main()
