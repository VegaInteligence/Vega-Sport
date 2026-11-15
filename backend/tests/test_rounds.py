"""The leagues' matchweeks (vega/rounds.py): when a round closes, its Team of the Round and
the Player of the Season race, without a database. The pass over a database is in
test_models.py."""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import itertools
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from vega import forecast, rounds

T0 = datetime(2026, 11, 6, 19, 0, tzinfo=timezone.utc)  # a Friday


class RoundStateTest(unittest.TestCase):
    def test_a_round_closes_once_its_matches_are_over_and_ranked(self):
        matches = [("finished", T0), ("finished", T0 + timedelta(days=1)), ("finished", T0 + timedelta(days=2))]
        end = T0 + timedelta(days=2, hours=2)
        # Six hours after the end of its last match, once the ranking ran after it.
        self.assertEqual(rounds.round_state(matches, end + timedelta(hours=5), end)[0], "open")
        self.assertEqual(rounds.round_state(matches, end + timedelta(hours=6), end - timedelta(minutes=1))[0], "open")
        self.assertEqual(rounds.round_state(matches, end + timedelta(hours=6), end), ("closed", 3, 0, end))
        # A match still to play keeps it open.
        waiting = matches + [("not_started", T0 + timedelta(days=3))]
        self.assertEqual(rounds.round_state(waiting, T0 + timedelta(days=3, hours=1), end)[0], "open")

    def test_a_postponed_or_late_match_never_blocks_its_round(self):
        end = T0 + timedelta(days=1, hours=2)
        postponed = [("finished", T0), ("finished", T0 + timedelta(days=1)), ("postponed", T0 + timedelta(days=1))]
        self.assertEqual(rounds.round_state(postponed, end + timedelta(hours=6), end), ("closed", 2, 1, end))
        # Moved weeks later: not on time, it does not count.
        moved = [("finished", T0), ("finished", T0 + timedelta(days=1)), ("not_started", T0 + timedelta(days=30))]
        self.assertEqual(rounds.round_state(moved, end + timedelta(hours=6), end)[0], "closed")
        # A status the source never updated, 72 hours after its kick-off.
        stale = [("finished", T0), ("finished", T0 + timedelta(days=1)), ("not_started", T0 + timedelta(days=1))]
        self.assertEqual(rounds.round_state(stale, end + timedelta(hours=6), end)[0], "open")
        self.assertEqual(rounds.round_state(stale, T0 + timedelta(days=4, hours=1), end)[0], "closed")
        # In any case, seven days after the median kick-off; a round nothing was played in has no state.
        waiting = [("finished", T0), ("in_play", T0 + timedelta(days=1))]
        self.assertEqual(rounds.round_state(waiting, T0 + timedelta(days=7), None)[0], "closed")
        self.assertIsNone(rounds.round_state([("not_started", T0)], T0 + timedelta(days=9), None))

    def test_a_week_starts_on_tuesday_noon_utc(self):
        self.assertEqual(rounds.week_key(datetime(2026, 11, 10, 2, 0, tzinfo=timezone.utc)), datetime(2026, 11, 3, 12, tzinfo=timezone.utc))  # Monday night
        self.assertEqual(rounds.week_key(datetime(2026, 11, 10, 19, 0, tzinfo=timezone.utc)), datetime(2026, 11, 10, 12, tzinfo=timezone.utc))  # Tuesday evening
        self.assertEqual(rounds.week_key(datetime(2026, 11, 16, 1, 0, tzinfo=timezone.utc)), datetime(2026, 11, 10, 12, tzinfo=timezone.utc))  # a Sunday in America

    def test_rounds_by_id_or_by_week(self):
        rows = [
            (1, 10, 5, "5", "finished", T0), (1, 11, 5, "5", "finished", T0 + timedelta(days=1)),
            (1, 12, None, None, "not_started", T0 + timedelta(days=60)),  # not in a round yet: left out
            (2, 20, None, None, "finished", T0), (2, 21, None, None, "finished", T0 + timedelta(days=5)),
        ]
        out = rounds.season_rounds(rows)
        self.assertEqual(list(out[1]), ["r5"])
        self.assertEqual([m for m, _, _ in out[1]["r5"][2]], [10, 11])
        self.assertEqual(sorted(out[2]), ["w2026-11-03", "w2026-11-10"])


class AssignmentTest(unittest.TestCase):
    def test_the_assignment_is_exact(self):
        costs = [[4, 1, 3, 9], [2, 0, 5, 9], [3, 2, 2, 9]]
        best = min(itertools.permutations(range(4), 3), key=lambda p: sum(costs[i][j] for i, j in enumerate(p)))
        picked = rounds.assign(costs)
        self.assertEqual(len(set(picked)), 3)
        self.assertEqual(sum(costs[i][j] for i, j in enumerate(picked)), sum(costs[i][j] for i, j in enumerate(best)))

    def test_the_team_of_the_round_picks_its_formation(self):
        roles = (["goalkeeper"] * 2 + ["centre_back"] * 4 + ["full_back"] * 3 + ["defensive_midfielder"] * 3
                 + ["central_midfielder"] * 3 + ["winger"] * 2 + ["centre_forward"] * 3)
        candidates = [(i, role, 90, 0.1 * (i % 7)) for i, role in enumerate(roles)]
        # Three outstanding forwards and few wingers: two forwards up front pay more than wingers.
        candidates += [(100, "centre_forward", 90, 3.0), (101, "centre_forward", 90, 2.9)]
        formation, total, slots = rounds.team_of_round(candidates)
        self.assertEqual(len(slots), 11)
        self.assertEqual(len({s[3][0] for s in slots}), 11)
        self.assertTrue(all(s[3][1] in rounds.SLOT_ROLES[s[2]] for s in slots))
        self.assertIn(formation, ("4-4-2", "3-5-2"))
        self.assertIn(100, {s[3][0] for s in slots})
        self.assertIn(101, {s[3][0] for s in slots})
        # The best formation: no other one reaches its total.
        for other in rounds.FORMATIONS:
            pool = [c for c in candidates if c[2] >= 60]
            slots_other = rounds.formation_slots(other)
            costs = [[-c[3] if c[1] in rounds.SLOT_ROLES[slot] else 1e6 for c in pool] for _, _, slot in slots_other]
            picked = rounds.assign(costs)
            if all(costs[i][j] < 1e6 for i, j in enumerate(picked)):
                self.assertLessEqual(sum(pool[j][3] for j in picked), total + 1e-9)
        # Players of fewer than 60 minutes are left out unless nothing else fills a team.
        short = [(i, role, 30, z) for i, role, _, z in candidates]
        self.assertIsNone(rounds.team_of_round(short))
        half = [(i, role, 50, z) for i, role, _, z in candidates]
        self.assertIsNotNone(rounds.team_of_round(half))


class RaceTest(unittest.TestCase):
    def test_the_race_shrinks_the_mean_grade_and_asks_for_minutes(self):
        rows = [
            (1, 10, 90, 2.0), (1, 10, 90, 2.0), (1, 10, 90, 2.0),  # three full matches at z 2
            (2, 10, 90, 3.0), (2, 10, 90, 3.0),  # two matches: below the three asked
            (3, 11, 90, 1.0), (3, 11, 90, 1.0), (3, 11, 90, 1.0), (3, 11, 10, 9.0),  # a cameo of 10 minutes does not count
            (4, 11, 45, 1.5), (4, 11, 45, 1.5), (4, 11, 45, 1.5),  # half his club's minutes: eligible
        ]
        race = rounds.season_race(rows, {10: 3, 11: 3})
        self.assertEqual([r[0] for r in race], [1, 3, 4])
        self.assertAlmostEqual(race[0][2], 3 * 90 * 2.0 / (270 + 450))
        self.assertAlmostEqual(race[1][2], 270 / (270 + 450))
        self.assertEqual(race[1][3:], (3, 270))


class HeldMatchesTest(unittest.TestCase):
    def test_a_match_of_an_open_round_counts_as_still_to_play(self):
        rows = [(m, 7, h, a, False, "finished", 2, 0, True, True, T0) for m, (h, a) in enumerate(((1, 2), (3, 4), (5, 6), (7, 8)))]
        rows += [(10, 7, 1, 3, False, "not_started", None, None, True, True, T0)]
        table, games = forecast.league_state(rows)[7]
        self.assertEqual(table[1][0], 3)
        held = forecast.league_state(rows, {0})[7]
        self.assertEqual(held[0][1][0], 0)
        self.assertIn((1, 2), held[1])


if __name__ == "__main__":
    unittest.main()
