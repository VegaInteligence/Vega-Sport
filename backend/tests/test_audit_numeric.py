"""Calculation audit of 16 Nov 2026 (VI-23), batches B8 and B9: the numerical contracts that are
checked in isolation (FAILURE_MODES.md §9 and §10, written before the corrections).

Isolated on purpose: the embedding's eligibility and the xG fit's constraints are mathematical
properties of the functions themselves; their database workflows are in test_audit_models.py.
"""

import math
import random
import sys
import unittest
from math import atan2, hypot
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from vega import embedding, xg


# ------------------------------------------------------------------ B8 embedding (13d)


def table(count, width, seed=3):
    """`count` players on `width` statistics: three kinds of players, with noise."""
    rng = random.Random(seed)
    centres = [[1 + ((k * 7 + j * 3) % 11) for j in range(width)] for k in range(3)]
    return [[max(0.0, c + rng.gauss(0, 0.2 * (c + 1))) for c in centres[i % 3]] for i in range(count)]


def placed(result):
    vectors, _, _ = result
    return [i for i, v in enumerate(vectors) if v is not None]


class EmbeddingEligibilityTest(unittest.TestCase):
    """FM-B8.1 to FM-B8.3: who is placed on the axes, and on which statistics."""

    def test_1_the_audit_example_has_too_few_eligible_players(self):
        # 198 measured profiles and two empty ones (the audit's annex): only 198 can be placed,
        # under MIN_PLAYERS: no axes (the baseline places all 200, the empty two at distance 0).
        rows = table(198, 12) + [[None] * 12, [None] * 12]
        result = embedding.embed(rows)
        self.assertTrue(result is None, f"{len(placed(result)) if result else 0} rows placed, the empty two included")

    def test_2_an_empty_profile_is_never_placed(self):
        rows = table(210, 12) + [[None] * 12, [None] * 12]
        result = embedding.embed(rows, dimensions=4)
        self.assertIsNotNone(result)
        vectors, _, kept = result
        self.assertEqual(len(vectors), 212)
        self.assertEqual((vectors[-1], vectors[-2]), (None, None))
        self.assertEqual(placed(result), list(range(210)))
        self.assertEqual(kept, list(range(12)))

    def test_3_ninety_per_cent_of_the_kept_statistics_or_no_vector(self):
        rows = table(210, 10)
        rows[0][3] = None  # 9 of 10: placed
        rows[1][3] = rows[1][7] = None  # 8 of 10: not placed
        rows[2][0] = None  # 9 of 10, missing another statistic than row 3: both placed,
        rows[3][1] = None  # and the two share 8 of the 10 (80 %)
        result = embedding.embed(rows, dimensions=4)
        self.assertEqual(placed(result), [0] + list(range(2, 210)))
        self.assert_pairs_share(rows, result)

    def test_4_the_eligible_rows_and_the_statistics_are_found_together(self):
        # Column 10 is known for 128 of 210 rows (61 %, kept at first). Rows 200-209 miss two
        # other statistics (9 of 11: dropped); without them column 10 is known for 118 of 200
        # (59 %): it is dropped in turn, and every row left knows all ten others.
        rows = table(210, 11)
        for i in range(118, 200):
            rows[i][10] = None
        for i in range(200, 210):
            rows[i][0] = rows[i][1] = None
        result = embedding.embed(rows, dimensions=4)
        self.assertIsNotNone(result)
        self.assertEqual(result[2], list(range(10)))
        self.assertEqual(placed(result), list(range(200)))
        self.assert_pairs_share(rows, result)

    def test_5_same_rows_same_vectors_and_no_rows_no_axes(self):
        rows = table(220, 12)
        rows[5][2] = None
        self.assertEqual(embedding.embed(rows, dimensions=4), embedding.embed(rows, dimensions=4))
        self.assertIsNone(embedding.embed([]))

    def test_6_a_row_of_non_finite_values_is_never_placed(self):
        # FM-B8.6 (coordinator's interim probe): known means a finite number. One row of NaN, +inf
        # or -inf added to 220 valid ones: no placement for it, the 220 placed as without it.
        rows = table(220, 12)
        alone = embedding.embed(rows, dimensions=4)
        for bad in (math.nan, math.inf, -math.inf):
            result = embedding.embed(rows + [[bad] * 12], dimensions=4)
            self.assertIsNotNone(result, bad)
            vectors, share, kept = result
            self.assertIsNone(vectors[-1], bad)
            self.assertEqual((vectors[:-1], share, kept), alone, bad)

    def test_7_non_finite_values_inside_rows_are_missing(self):
        # test_3's rows with NaN and infinities for the blanks: the same placement.
        rows = table(210, 10)
        rows[0][3] = math.nan  # 9 of 10: placed
        rows[1][3], rows[1][7] = math.inf, -math.inf  # 8 of 10: not placed
        rows[2][0], rows[3][1] = math.nan, math.inf
        result = embedding.embed(rows, dimensions=4)
        self.assertEqual(placed(result), [0] + list(range(2, 210)))
        self.assertTrue(all(math.isfinite(x) for i in placed(result) for x in result[0][i]))

    def test_8_a_column_whose_spread_overflows_is_not_used(self):
        rows = table(220, 12)
        rows[0][5] = 1e308  # its squared deviation overflows: the column cannot be standardised
        result = embedding.embed(rows, dimensions=4)
        self.assertIsNotNone(result)
        vectors, share, kept = result
        self.assertNotIn(5, kept)
        self.assertEqual(len(kept), 11)
        self.assertTrue(math.isfinite(share) and all(math.isfinite(x) for v in vectors for x in v))

    def assert_pairs_share(self, rows, result):
        """The guarantee: two placed players share 80 % of the kept statistics as observations."""
        _, _, kept = result
        known = [frozenset(j for j in kept if rows[i][j] is not None) for i in placed(result)]
        need = 0.8 * len(kept) - 1e-9
        self.assertTrue(all(len(a & b) >= need for n, a in enumerate(known) for b in known[n + 1:]))


# ---------------------------------------------------------------------- B9 xG (16a)

# The validation model of docs/calculs/02-metriques-attendues/05-xg-vega.md (audit annex B).
DOCUMENTED = [-1.375, 1.027, -0.167, 0.155, 1.467, 0.114, -0.177, -0.706, -0.414, 0.510, 0.608, -0.478, -0.377, -1.374]
# The fit test's model of test_xg.py before VI-23: outside the constrained space
# (distance_sq +0.15, angle_distance 1.4).
INFEASIBLE = [-1.4, 1.0, -0.17, 0.15, 1.4, 0.1, -0.2, -0.7, -0.4, 0.5, 0.6, -0.5, -0.4, -1.3]
FEASIBLE = [-1.4, 1.0, -0.17, -0.02, 0.0, 0.1, -0.2, -0.7, -0.4, 0.5, 0.6, -0.5, -0.4, -1.3]
BODIES = ("right_foot", "left_foot", "header", "other")
SITUATIONS = ("regular_play", *xg.SITUATIONS)
T = {name: i for i, name in enumerate(xg.TERMS)}


def geometry(dx, dy):
    """Distance and angle as the SQL scores them (xg._GEOMETRY), dx the metres to the goal line."""
    angle = max(0.0, atan2(xg.GOAL_WIDTH * max(dx, 0.01), dx * dx + dy * dy - (xg.GOAL_WIDTH / 2) ** 2))
    return hypot(dx, dy), angle


def bins(truth, shots_per_bin=40, far=False):
    """Bins over the pitch, each holding exactly the goals `truth` expects (test_xg.py's,
    with long shots when `far`)."""
    out = []
    reach = (2, 5, 8, 11, 15, 20, 26, 33) + ((45, 60, 75, 90) if far else ())
    for i, situation in enumerate(SITUATIONS):
        for j, body in enumerate(BODIES):
            for dx in reach:
                for dy in (0, 4, 9, 15):
                    distance, angle = geometry(dx, dy)
                    n = shots_per_bin + 3 * ((i + j + dx + dy) % 5)
                    out.append((situation, body, distance, angle, n, n * xg.probability(truth, xg.features(situation, body, distance, angle))))
    return out


def violations(beta, tolerance=1e-12):
    """The model's coefficient constraints (FAILURE_MODES §10) that `beta` breaks."""
    rules = {
        "distance <= 0": beta[T["distance"]] <= tolerance,
        "distance_sq <= 0": beta[T["distance_sq"]] <= tolerance,
        "header_distance <= 0": beta[T["header_distance"]] <= tolerance,
        "angle >= 0": beta[T["angle"]] >= -tolerance,
        "angle_distance = 0": abs(beta[T["angle_distance"]]) <= tolerance,
    }
    return [rule for rule, ok in rules.items() if not ok]


def rebounds(beta):
    """Where the chance of a goal grows with the distance: along the goal's centre line, and at a
    fixed angle (the derivative of the logit), for every body part and situation."""
    found = []
    for body in BODIES:
        for situation in SITUATIONS:
            previous = None
            for step in range(2, 501):
                d = step / 4
                p = xg.probability(beta, xg.features(situation, body, *geometry(d, 0)))
                if previous is not None and p > previous + 1e-12:
                    found.append((body, situation, "centre", d))
                    break
                previous = p
        header = 1.0 if body == "header" else 0.0
        for angle in [k / 20 for k in range(0, 63)]:
            for d in range(0, 126):
                slope = beta[T["distance"]] + 2 * beta[T["distance_sq"]] * d / 100 + beta[T["angle_distance"]] * angle / 10 + beta[T["header_distance"]] * header / 10
                if slope > 1e-12:
                    found.append((body, "angle", angle, d))
                    break
            else:
                continue
            break
    return found


class ConstrainedXgTest(unittest.TestCase):
    """FM-B9.1: the xG model cannot rise with the distance, whatever the shots it is fitted on."""

    def test_1_the_documented_coefficients_rise_again_far_out(self):
        # The audit's evidence (annex B), kept as documentation of the old risk: 0.968 % at
        # 50 m, 19.365 % at 100 m along the centre line, foot, open play.
        chance = lambda d: xg.probability(DOCUMENTED, xg.features("regular_play", "right_foot", d, atan2(xg.GOAL_WIDTH * d, d * d - (xg.GOAL_WIDTH / 2) ** 2)))
        self.assertAlmostEqual(chance(50), 0.00968, places=5)
        self.assertAlmostEqual(chance(100), 0.19365, places=5)
        self.assertTrue(violations(DOCUMENTED) and rebounds(DOCUMENTED))

    def test_2_shots_drawn_from_a_rising_model_still_give_a_falling_one(self):
        found = xg.fit(bins(INFEASIBLE, far=True))
        self.assertIsNotNone(found)
        self.assertEqual(violations(found), [])
        self.assertEqual(rebounds(found), [])

    def test_3_a_model_inside_the_constraints_is_found_again(self):
        # Equality with the unconstrained optimum when that optimum is feasible (BC). The exact
        # constraints are test_2's: an unconstrained fit only comes within 1e-4 of angle_distance = 0.
        found = xg.fit(bins(FEASIBLE))
        for term, want, got in zip(xg.TERMS, FEASIBLE, found):
            self.assertAlmostEqual(got, want, places=4, msg=term)

    def test_4_the_fit_is_reproducible(self):
        data = bins(INFEASIBLE, far=True)
        self.assertEqual(xg.fit(data), xg.fit(data))

    def test_5_the_fit_says_how_it_ended(self):
        coefficients, info = xg.fit(bins(INFEASIBLE, far=True), diagnostics=True)
        self.assertEqual(violations(coefficients), [])
        self.assertIs(info["converged"], True)
        self.assertGreaterEqual(info["iterations"], 1)
        self.assertTrue(math.isfinite(info["objective"]))
        self.assertLessEqual(info["max_violation"], 1e-12)
        # Too few shots: no model, said as such.
        self.assertIsNone(xg.fit(bins(FEASIBLE, shots_per_bin=1)[:200]))


if __name__ == "__main__":
    unittest.main()
