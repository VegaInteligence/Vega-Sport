"""Players' profile vectors: the pure steps, on tables built here."""

from pathlib import Path
import random
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from vega import embedding


def squad(count=300, seed=1):
    """Three kinds of players (keeper, defender, forward) on twelve statistics, with noise."""
    rng = random.Random(seed)
    centres = {
        "keeper": [0, 0, 0, 20, 1, 0, 0, 4, 0, 1, 0, 25],
        "defender": [0.5, 0.1, 1, 60, 5, 3, 4, 0, 2, 6, 1, 55],
        "forward": [3, 0.6, 5, 25, 1, 0.5, 0.5, 0, 6, 3, 4, 20],
    }
    kinds, rows = [], []
    for i in range(count):
        kind = ("keeper", "defender", "forward")[i % 3]
        kinds.append(kind)
        rows.append([max(0.0, centre + rng.gauss(0, 0.15 * (centre + 1))) for centre in centres[kind]])
    return kinds, rows


class StepsTest(unittest.TestCase):
    def test_a_total_per_ninety_minutes_of_the_time_measured(self):
        self.assertEqual(embedding.per90(10, 450), 2.0)
        self.assertIsNone(embedding.per90(10, 0))
        self.assertIsNone(embedding.per90(None, 450))

    def test_columns_are_standardised_and_the_unusable_ones_left_out(self):
        rows = [[1.0, 5.0, None, 7.0], [2.0, 5.0, None, None], [3.0, 5.0, 1.0, 9.0], [4.0, 5.0, None, 8.0], [50.0, 5.0, None, 8.0]]
        table, kept = embedding.standardise(rows)
        # The constant column and the one measured for one player in five are left out.
        self.assertEqual(kept, [0, 3])
        column = [row[0] for row in table]
        self.assertAlmostEqual(sum(column[:4]) + column[4], sum(column), places=9)
        self.assertLessEqual(max(column), embedding.CLIP)  # 50 is clipped, it does not stretch the scale alone
        self.assertEqual(table[1][1], 0.0)  # not measured: the column's mean
        self.assertEqual(embedding.standardise([]), ([], []))

    def test_the_leading_axes_of_a_known_matrix(self):
        (first, axis), (second, other) = embedding.principal_axes([[2.0, 1.0], [1.0, 2.0]], 2)
        self.assertAlmostEqual(first, 3.0, places=9)
        self.assertAlmostEqual(second, 1.0, places=9)
        self.assertAlmostEqual(axis[0], 2 ** -0.5, places=9)
        self.assertAlmostEqual(axis[1], 2 ** -0.5, places=9)
        self.assertAlmostEqual(abs(other[0]), 2 ** -0.5, places=9)
        self.assertAlmostEqual(other[0] + other[1], 0.0, places=9)
        self.assertGreater(max(other, key=abs), 0)  # the sign is fixed: the largest term is positive

    def test_players_of_one_kind_come_out_as_neighbours(self):
        kinds, rows = squad()
        vectors, kept_share, kept = embedding.embed(rows, dimensions=4)
        self.assertEqual(len(vectors), 300)
        self.assertEqual(len(kept), 12)
        self.assertGreater(kept_share, 0.8)
        same = total = 0
        for i, vector in enumerate(vectors):
            nearest = sorted((embedding.distance(vector, other), j) for j, other in enumerate(vectors) if j != i)[:10]
            same += sum(kinds[j] == kinds[i] for _, j in nearest)
            total += len(nearest)
        self.assertGreater(same / total, 0.99)
        # The same table gives the same vectors.
        again, _, _ = embedding.embed(rows, dimensions=4)
        self.assertEqual(vectors, again)

    def test_too_few_players_or_statistics_give_no_vector(self):
        _, rows = squad(count=embedding.MIN_PLAYERS - 1)
        self.assertIsNone(embedding.embed(rows, dimensions=4))
        _, rows = squad()
        self.assertIsNone(embedding.embed([row[:3] for row in rows], dimensions=4))

    def test_the_statistics_read_add_up_and_leave_discipline_out(self):
        keys = embedding.statistics()
        self.assertIn("goals", keys)
        self.assertIn("accurate_passes", keys)
        self.assertFalse(set(keys) & embedding.EXCLUDED)
        self.assertNotIn("rating", keys)  # an average, not a total
        self.assertGreater(len(keys), 60)


if __name__ == "__main__":
    unittest.main()
