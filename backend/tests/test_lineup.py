"""What a line-up adds to a forecast (vega/lineup.py): the pure calculations. The values of
points() and replace() are those backend/api/test/lineup.test.mjs checks on the API's copy."""
import random
import unittest
from math import exp

from vega import lineup


def poisson(rng, mean):
    limit, k, p = exp(-mean), 0, 1.0
    while True:
        p *= rng.random()
        if p <= limit:
            return k
        k += 1


class LineupTest(unittest.TestCase):
    def setUp(self):
        self.addCleanup(setattr, lineup, "STARTERS", lineup.STARTERS)
        self.addCleanup(setattr, lineup, "MIN_HISTORY", lineup.MIN_HISTORY)
        self.addCleanup(setattr, lineup, "MIN_FIT", lineup.MIN_FIT)

    def test_a_rate_is_drawn_towards_zero_while_a_player_has_played_little(self):
        self.assertAlmostEqual(lineup.rate(3.0, 260), 0.38028169014084506)
        self.assertAlmostEqual(lineup.rate(4.5, 1760), 0.1832579185520362)
        self.assertEqual(lineup.rate(0.0, 0), 0.0)

    def test_a_line_up_is_compared_with_the_clubs_earlier_ones_from_rates_known_before_the_match(self):
        lineup.STARTERS, lineup.MIN_HISTORY = 2, 1
        previous = {1: (4.5, 450.0, "winger"), 9: (9.0, 900.0, "goalkeeper")}
        matches = [(1, "A", "B", 0.15, 2, 0), (2, "B", "A", 0.1, 1, 1), (3, "A", "B", 0.15, 0, 0), (4, "B", "A", 0.1, 3, 0)]
        appearances = {
            1: [(1, "winger", 90.0, 0.9), (2, "winger", 90.0, -0.45), (3, "centre_back", 90.0, 0.0), (9, "goalkeeper", 90.0, 5.0)],
            2: [(1, "winger", 90.0, 0.0), (2, "winger", 90.0, 0.0), (3, "centre_back", 90.0, 0.0)],
        }
        starters = {(1, "A"): [1, 9], (1, "B"): [2, 3], (2, "B"): [2, 3], (2, "A"): [1, 9], (3, "A"): [1], (3, "B"): [2, 3], (4, "B"): [2, 3], (4, "A"): [1, 9]}
        kept, totals = lineup.deviations(matches, appearances, starters, previous)
        # Match 1: no earlier line-up to compare with. Match 3: a side without its starters.
        self.assertEqual([(row[0], row[2], row[3]) for row in kept], [(0.1, 1, 1), (0.1, 3, 0)])
        # Match 2. A: its winger alone counts (the goalkeeper is left out), last year's 4.5 over 450 minutes
        # then 0.9 more in match 1: 90 × 5.4 / 990, against 0.45 at match 1. B: −0.45 in 90 minutes, against 0.
        winger, other = 90 * 5.4 / 990, 90 * -0.45 / 540
        self.assertAlmostEqual(kept[0][1], (other - 0.0) - (winger - 0.45))
        # Match 4: each club against the mean of its earlier line-ups. A's incomplete one of match 3 is not
        # one of them; B's of match 3 is, though the match itself was not kept.
        now_a, now_b = 90 * 5.4 / 1080, 90 * -0.45 / 630
        self.assertAlmostEqual(kept[1][1], (now_b - (0.0 + other + now_b) / 3) - (now_a - (0.45 + winger) / 2))
        # The year's totals, for the year after: nothing of the year before is carried twice.
        self.assertEqual(totals[1], (0.9, 180.0, "winger"))
        self.assertEqual(totals[9], (5.0, 90.0, "goalkeeper"))
        self.assertEqual(totals[2][2], "winger")

    def test_the_worth_of_a_line_up_is_found_again_in_scores_drawn_from_it(self):
        rng = random.Random(7)
        coefficients = ((0.27, 0.9), (0.32, 0.9))
        rows = []
        for _ in range(6000):
            delta, deviation = rng.uniform(-0.6, 0.6), rng.gauss(0, 0.5)
            x = delta + 0.11 * deviation  # 44 Elo points per unit
            rows.append((delta, deviation, poisson(rng, exp(0.27 + 0.9 * x)), poisson(rng, exp(0.32 - 0.9 * x))))
        elo, error = lineup.fit(rows, coefficients)
        self.assertLess(abs(elo - 44), 3 * error)
        self.assertTrue(4 < error < 12)
        self.assertGreater(lineup.likelihood(rows, coefficients, elo / 400), lineup.likelihood(rows, coefficients, 0.0))
        # Too few matches: nothing is fitted.
        self.assertIsNone(lineup.fit(rows[: lineup.MIN_FIT - 1], coefficients))

    def test_a_replacement_reads_as_elo_points_then_as_points_per_league_match(self):
        model = {"home": (0.26, 0.93), "away": (0.32, 0.91), "rho": -0.03}
        self.assertAlmostEqual(lineup.points(model, 1650, 1520), 1.9154036860888715, places=12)
        self.assertAlmostEqual(lineup.points(model, 1500, 1500), 1.3686359975976474, places=12)
        shift, gain = lineup.replace(model, 44.8, 1650, 1520, 0.31, 0.05)
        self.assertAlmostEqual(shift, 11.648)
        self.assertAlmostEqual(gain, 0.046919724825661646, places=12)
        shift, loss = lineup.replace(model, 44.8, 1400, 1520, -0.12, 0.2)
        self.assertAlmostEqual(shift, -14.336)
        self.assertAlmostEqual(loss, -0.05230882216908672, places=12)
        # The same player in his own place changes nothing.
        self.assertEqual(lineup.replace(model, 44.8, 1500, 1500, 0.2, 0.2), (0.0, 0.0))


if __name__ == "__main__":
    unittest.main()
