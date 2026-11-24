"""The home's importance v2 (GitHub #69, Linear VI-48) keeps its stakes as rows of sql/169_home_importance_v2.sql; the
Elo's stakes are constants of vega/power.py (PRESTIGE, STAGE, round_of). Written before the migration (AGENTS.md).

Failure modes this guards against, and the expected outcome:
- D1 a multiplier edited on one side only (a Champions League match worth 1.15 in the Elo, 1.2 on the home) → the
  migration's prestige rows equal power.PRESTIGE and its round rows equal power.STAGE, key for key;
- D2 a competition of power.PRESTIGE missing from the home (or one the Elo does not know added) → same keys;
- D3 round_of's words drift (a new spelling of « huitièmes » read by the Elo, not by the home) → the word lists of
  api.home_round_v2 equal power._SEMI_WORDS and power._KNOCKOUT_WORDS, in order;
- D4 the level scale (VI-48: one row per scope, clubs and nations) is missing a scope, or a divisor is 0 → both rows,
  a positive divisor each.
The SQL classification itself is compared with power.round_of on a database in backend/api/test/home-importance.test.mjs.
"""

from pathlib import Path
import re
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from vega import power  # noqa: E402

MIGRATION = ROOT / "sql" / "169_home_importance_v2.sql"


def rows(sql, table):
    """The (…) tuples of the INSERT INTO `table` VALUES statement, as lists of their literals."""
    block = re.search(rf"INSERT INTO {re.escape(table)}\s*\([^)]*\)\s*VALUES\s*(.*?);", sql, re.S).group(1)
    return [[v.strip().strip("'") for v in t.split(",")] for t in re.findall(r"\(([^()]*)\)", block)]


def words(sql, name):
    """The ARRAY['…', …] literal that follows the comment `-- name` in the migration."""
    block = re.search(rf"--\s*{name}\b.*?ARRAY\[(.*?)\]", sql, re.S).group(1)
    return tuple(re.findall(r"'([^']*)'", block))


class DriftTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = MIGRATION.read_text(encoding="utf-8")

    def test_prestige_and_rounds_are_power_s(self):
        stakes = rows(self.sql, "core.home_stakes")
        prestige = {key: float(m) for kind, key, m in stakes if kind == "prestige"}
        rounds = {key: float(m) for kind, key, m in stakes if kind == "round"}
        self.assertEqual(prestige, power.PRESTIGE)  # D1, D2
        self.assertEqual(rounds, power.STAGE)
        self.assertEqual(len(stakes), len(power.PRESTIGE) + len(power.STAGE))

    def test_round_words_are_round_of_s(self):
        self.assertEqual(words(self.sql, "semi words"), power._SEMI_WORDS)  # D3
        self.assertEqual(words(self.sql, "knockout words"), power._KNOCKOUT_WORDS)

    def test_a_level_scale_for_each_scope(self):
        scales = {scope: (float(c), float(d)) for scope, c, d in rows(self.sql, "core.home_level_scales")}
        self.assertEqual(set(scales), {"clubs", "nations"})  # D4
        self.assertTrue(all(d > 0 for _, d in scales.values()))
        # Provisional (VI-48): the nations take the clubs' scale until their Elo changes scale.
        self.assertEqual(scales["clubs"], (1400.0, 100.0))
        self.assertEqual(scales["nations"], scales["clubs"])


if __name__ == "__main__":
    unittest.main()
