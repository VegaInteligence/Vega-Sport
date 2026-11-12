"""The read API serves a breakout list only when it was computed under the present rule:
the rule's name is written on both sides and must be the same."""

from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from vega import breakout


class RuleTest(unittest.TestCase):
    def test_the_read_api_names_the_rule_the_worker_computes(self):
        routes = (ROOT / "api/src/routes/rankings.mjs").read_text(encoding="utf-8")
        self.assertIn(f'export const BREAKOUT_RULE = "{breakout.MODEL_VERSION}";', routes)

    def test_a_known_age_under_the_limit_is_required(self):
        self.assertEqual(breakout.MAX_AGE, 23)
        self.assertIn("pl.birth_date > make_date(%(season)s - %(age)s, 8, 1)", breakout.FLAG)
        self.assertNotIn("birth_date IS NULL", breakout.FLAG)


if __name__ == "__main__":
    unittest.main()
