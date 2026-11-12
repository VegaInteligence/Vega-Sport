"""Coming back from an absence: the pure steps, on appearances built here."""

from datetime import date, timedelta
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from vega import returns

START = date(2026, 1, 3)
WEEK = [START + timedelta(days=7 * i) for i in range(40)]  # a club playing every week
CLUBS = {1: WEEK, 2: WEEK}


def played(weeks, minutes=90, team=1):
    return [(WEEK[w], team, minutes) for w in weeks]


class StepsTest(unittest.TestCase):
    def test_an_absence_needs_days_matches_missed_and_the_same_club(self):
        # Eight matches, six weeks out (five club matches missed), then back.
        seq = played(range(8)) + played(range(14, 18), minutes=45)
        (found,) = returns.returns_of(seq, CLUBS)
        self.assertEqual((found["index"], found["days"], found["missed"], found["usual"]), (8, 49, 6, 90.0))
        self.assertEqual((found["left"], found["back"]), (WEEK[7], WEEK[14]))
        self.assertEqual(returns.bucket(found["days"]), "30_59")
        # Three weeks out: too short. Six weeks without a club match in between (a break): no absence.
        self.assertEqual(returns.returns_of(played(range(8)) + played(range(11, 14)), CLUBS), [])
        self.assertEqual(returns.returns_of(seq, {1: WEEK[:8] + WEEK[14:]}), [])
        # Back at another club: a transfer, not a return. Too few matches before: no usual minutes.
        self.assertEqual(returns.returns_of(played(range(8)) + played(range(14, 18), team=2), CLUBS), [])
        self.assertEqual(returns.returns_of(played(range(3)) + played(range(9, 12)), CLUBS), [])
        self.assertEqual([returns.bucket(d) for d in (29, 30, 59, 60, 119, 120, 400)], [None, "30_59", "30_59", "60_119", "60_119", "120_plus", "120_plus"])

    def test_the_curve_is_the_minutes_of_each_match_back_beside_the_usual_ones(self):
        minimum, returns.MIN_RETURNS = returns.MIN_RETURNS, 2
        try:
            players = {
                1: played(range(8)) + [(WEEK[14], 1, 30), (WEEK[15], 1, 60), (WEEK[16], 1, 90)],
                2: played(range(8), minutes=80) + [(WEEK[14], 1, 50), (WEEK[15], 1, 70)],
                3: played(range(20)),  # never away
            }
            points = returns.curve(players, CLUBS)
            self.assertEqual(points[("30_59", 1)], (2, 40.0, 85.0))
            self.assertEqual(points[("30_59", 2)], (2, 65.0, 85.0))
            self.assertNotIn(("30_59", 3), points)  # one return only reaches a third match: below the minimum
            self.assertEqual({key[0] for key in points}, {"30_59"})
        finally:
            returns.MIN_RETURNS = minimum

    def test_the_matches_back_stop_at_the_next_absence(self):
        minimum, returns.MIN_RETURNS = returns.MIN_RETURNS, 1
        try:
            seq = played(range(8)) + played([14, 15], minutes=40) + played([22, 23], minutes=20)
            points = returns.curve({1: seq}, CLUBS)
            # Two returns, each with two matches back: the second return's matches are not the first's third and fourth.
            self.assertEqual([points[("30_59", k)][0] for k in (1, 2)], [2, 2])
            self.assertNotIn(("30_59", 3), points)
        finally:
            returns.MIN_RETURNS = minimum

    def test_a_player_is_coming_back_while_his_return_is_recent(self):
        seq = played(range(8)) + [(WEEK[14], 1, 30), (WEEK[15], 1, 60)]
        state = returns.current(seq, CLUBS, WEEK[16])
        self.assertEqual((state["days"], state["missed"], state["bucket"], state["matches_back"], state["minutes_back"], state["usual"]),
                         (49, 6, "30_59", 2, 45.0, 90.0))
        # Too long ago, too many matches since, never away: nothing to show.
        self.assertIsNone(returns.current(seq, CLUBS, WEEK[15] + timedelta(days=120)))
        self.assertIsNone(returns.current(played(range(8)) + played(range(14, 24)), CLUBS, WEEK[24]))
        self.assertIsNone(returns.current(played(range(20)), CLUBS, WEEK[20]))


if __name__ == "__main__":
    unittest.main()
