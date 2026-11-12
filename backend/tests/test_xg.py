"""Vega's own expected goals: the fit, on shots drawn from a known model."""

from math import atan2, hypot, log
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from vega import xg

TRUE = [-1.4, 1.0, -0.17, 0.15, 1.4, 0.1, -0.2, -0.7, -0.4, 0.5, 0.6, -0.5, -0.4, -1.3]


def bins(shots_per_bin=40, scale=1.0):
    """Bins over the pitch, each holding exactly the goals the TRUE model expects."""
    out = []
    situations = ("regular_play", *xg.SITUATIONS)
    for i, situation in enumerate(situations):
        for j, body in enumerate(("right_foot", "left_foot", "header", "other")):
            for dx in (2, 5, 8, 11, 15, 20, 26, 33):
                for dy in (0, 4, 9, 15):
                    distance = hypot(dx, dy)
                    angle = max(0.0, atan2(xg.GOAL_WIDTH * dx, dx * dx + dy * dy - (xg.GOAL_WIDTH / 2) ** 2))
                    n = shots_per_bin + 3 * ((i + j + dx + dy) % 5)
                    p = xg.probability(TRUE, xg.features(situation, body, distance, angle)) * scale
                    out.append((situation, body, distance, angle, n, n * p))
    return out


class FitTest(unittest.TestCase):
    def test_the_terms_follow_the_table_columns(self):
        self.assertEqual(len(xg.TERMS), len(xg.features("regular_play", "right_foot", 10.0, 0.5)))
        self.assertEqual(xg.features("regular_play", "right_foot", 10.0, 0.5), [1.0, 0.5, 10.0, 1.0, 0.5, 0, 0, 0, 0, 0, 0, 0, 0, 0])
        header = xg.features("from_corner", "header", 8.0, 0.4)
        self.assertEqual((header[5], header[7], header[13]), (1.0, 1.0, 0.8))
        self.assertEqual(xg.features("throw_in_set_piece", "other", 8.0, 0.4)[6], 1.0)
        self.assertEqual(xg.features("throw_in_set_piece", "other", 8.0, 0.4)[xg.TERMS.index("throw_in")], 1.0)

    def test_the_fit_finds_the_model_the_shots_were_drawn_from(self):
        found = xg.fit(bins())
        for term, want, got in zip(xg.TERMS, TRUE, found):
            self.assertAlmostEqual(got, want, places=4, msg=term)
        # The model's goals add up to the goals scored, as a logistic fit with a constant must.
        data = bins()
        expected = sum(n * xg.probability(found, xg.features(s, b, d, th)) for s, b, d, th, n, _ in data)
        self.assertAlmostEqual(expected, sum(goals for *_, goals in data), places=3)
        # A closer shot is worth more; a header from the same place is worth less than a foot.
        near, far = (xg.probability(found, xg.features("regular_play", "right_foot", d, 0.6)) for d in (6.0, 25.0))
        self.assertGreater(near, far)
        self.assertGreater(near, xg.probability(found, xg.features("regular_play", "header", 6.0, 0.6)))

    def test_the_fit_beats_a_constant_on_shots_it_has_not_seen(self):
        found = xg.fit(bins())
        unseen = bins(shots_per_bin=17)
        rate = sum(g for *_, g in unseen) / sum(n for *_, n, _ in unseen)
        constant = [log(rate / (1 - rate))] + [0.0] * (len(xg.TERMS) - 1)
        self.assertLess(xg.log_loss(found, unseen), xg.log_loss(constant, unseen))

    def test_too_few_shots_or_no_goal_give_no_model(self):
        self.assertIsNone(xg.fit(bins(shots_per_bin=1)[:200]))
        self.assertIsNone(xg.fit([(s, b, d, th, n, 0) for s, b, d, th, n, _ in bins()]))
        self.assertIsNone(xg.fit([]))

    def test_a_situation_the_base_never_saw_keeps_a_null_weight(self):
        seen = [row for row in bins() if row[0] != "fast_break"]
        found = xg.fit(seen)
        self.assertAlmostEqual(found[xg.TERMS.index("fast_break")], 0.0, places=6)
        self.assertAlmostEqual(found[xg.TERMS.index("from_corner")], TRUE[xg.TERMS.index("from_corner")], places=3)


if __name__ == "__main__":
    unittest.main()
