"""Identity rules for the dated bulk player snapshot."""
from datetime import date
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from vega.sources.player_fact_snapshot import load, pair

D = date(2000, 1, 1)
A = ('clubone', date(2024, 1, 1))
B = ('clubone', date(2024, 1, 8))


def row(sid, names, birth=None, evidence=()):
    return {'id': sid, 'names': set(names), 'birth': birth, 'evidence': set(evidence)}


class SnapshotMatchingTest(unittest.TestCase):
    def test_unique_name_and_birth(self):
        self.assertEqual(pair([row('1', ['alicesmith'], D)], [(4, 'Alice Smith', None, D)], {}, {}), {'1': 4})

    def test_conflicting_birth_and_ambiguous_names_do_not_match(self):
        players = [(4, 'Alice Smith', None, D), (5, 'Alice Smith', None, D)]
        self.assertEqual(pair([row('1', ['alicesmith'], D)], players, {}, {}), {})
        self.assertEqual(pair([row('1', ['alicesmith'], date(2001, 1, 1), [A, B])], players, {4: {A, B}}, {}), {})

    def test_missing_birth_requires_two_distinct_dates_and_unique_name(self):
        players = [(4, 'Alice Smith', None, None)]
        source = [row('1', ['alicesmith'], D, [A, B])]
        self.assertEqual(pair(source, players, {4: {A}}, {}), {})
        self.assertEqual(pair(source, players, {4: {A, B}}, {}), {'1': 4})
        self.assertEqual(pair(source + [row('2', ['alicesmith'], D, [A, B])], players, {4: {A, B}}, {}), {})

    def test_existing_associations_and_competing_claims(self):
        players = [(4, 'Alice Smith', None, D), (5, 'Another Name', None, D)]
        source = [row('1', ['alicesmith'], D), row('2', ['alicesmith'], D)]
        self.assertEqual(pair(source, players, {}, {}), {})
        self.assertEqual(pair(source, players, {}, {'1': 5}), {'2': 4})
        self.assertEqual(pair([source[0]], players, {}, {'9': 4}), {})

    def test_packaged_snapshot_loads(self):
        rows = load()
        self.assertGreater(len(rows), 50000)
        self.assertTrue(all(r['url'].startswith('https://') for r in rows))


if __name__ == '__main__':
    unittest.main()
