"""Win, draw and loss during a match: the pure steps. The reference values below are also
checked by the read API's suite (backend/api/test/inplay.test.mjs), which computes them
with its own copy of the calculation."""

from pathlib import Path
import random
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from vega import forecast, inplay

MODEL = {"profile": [0.13, 0.14, 0.18, 0.16, 0.16, 0.16, 0.07], "down": 0.6, "up": 1.7}
RHO = -0.03


class StepsTest(unittest.TestCase):
    def close(self, got, want):
        for a, b in zip(got, want):
            self.assertAlmostEqual(a, b, places=6)

    def test_the_share_of_goals_still_to_come(self):
        got = [inplay.remaining(MODEL["profile"], m, a) for m, a in ((0, 0), (15, 0), (37.5, 0), (60, 0), (89, 0), (90, 0), (90, 4), (90, 12))]
        self.close(got, [1.0, 0.87, 0.64, 0.39, 0.080667, 0.07, 0.035, 0.0])
        # A goal's band: the first half's added time in the third quarter-hour, the 90th minute's in the last.
        self.assertEqual([inplay.band(m, a) for m, a in ((1, 0), (15, 0), (16, 0), (45, 3), (46, 0), (90, 0), (90, 2), (105, 0))], [0, 0, 1, 2, 3, 5, 6, 6])

    def test_at_kick_off_the_probabilities_are_the_forecasts(self):
        grid = forecast.score_grid(1.6, 1.1, RHO)
        self.close(inplay.outcome(1.6, 1.1, 1.0, 0, 0, 0, 0, MODEL, RHO), forecast.outcome(grid))

    def test_the_state_of_a_match_moves_the_probabilities(self):
        self.close(inplay.outcome(1.6, 1.1, 1.0, 0, 0, 0, 0, MODEL, RHO), [0.486025, 0.256008, 0.257967])
        self.close(inplay.outcome(1.6, 1.1, 0.39, 1, 0, 0, 0, MODEL, RHO), [0.782823, 0.17635, 0.040828])
        # The side leading a man down: less often a winner.
        self.close(inplay.outcome(1.6, 1.1, 0.39, 1, 0, 1, 0, MODEL, RHO), [0.590557, 0.284731, 0.124712])
        self.close(inplay.outcome(1.2, 1.9, 0.07, 2, 2, 0, 1, MODEL, RHO), [0.123551, 0.809582, 0.066867])
        # No time left: the score is the result.
        self.assertEqual(inplay.outcome(1.6, 1.1, 0.0, 0, 1, 0, 0, MODEL, RHO), (0.0, 0.0, 1.0))
        self.assertEqual(inplay.outcome(1.6, 1.1, 0.0, 1, 1, 0, 0, MODEL, RHO), (0.0, 1.0, 0.0))

    def test_a_match_minute_by_minute(self):
        events = [(23, 0, "goal", "home"), (45, 3, "goal", "away"), (61, 0, "red", "away"), (90, 4, "goal", "home")]
        points = inplay.timeline(1.6, 1.1, events, MODEL, RHO)
        self.assertEqual(len(points), 91)
        want = {0: (0.486025, 0.256008, 0.257967, 0, 0), 22: (0.453259, 0.2955, 0.251242, 0, 0), 23: (0.740991, 0.173839, 0.085169, 1, 0),
                45: (0.395849, 0.368416, 0.235735, 1, 1), 61: (0.552411, 0.359206, 0.088383, 1, 1), 89: (0.183654, 0.775406, 0.040939, 1, 1),
                90: (0.962515, 0.036627, 0.000858, 2, 1)}
        for minute, values in want.items():
            self.close(points[minute][1:4], values[:3])
            self.assertEqual(points[minute][4:], values[3:])
        for _, home, draw, away, _, _ in points:
            self.assertAlmostEqual(home + draw + away, 1.0, places=9)

    def test_goal_events_are_read_by_the_team_they_are_credited_to(self):
        rows = [(10, 0, "goal", 7), (30, 0, "red_card", 9), (50, 0, "goal", 9), (70, 0, "goal", 7)]
        self.assertEqual(inplay.match_events(rows, 7, 2, 1),
                         [(10, 0, "goal", "home"), (30, 0, "red", "away"), (50, 0, "goal", "away"), (70, 0, "goal", "home")])
        # Goal events that do not give the score: the match is not read.
        self.assertIsNone(inplay.match_events(rows, 7, 3, 1))
        self.assertIsNone(inplay.match_events(rows[:1], 7, 2, 1))
        self.assertEqual(inplay.match_events([], 7, 0, 0), [])

    def test_the_fit_finds_when_goals_come_and_what_a_red_card_costs(self):
        rng = random.Random(4)
        profile, down, up = MODEL["profile"], 0.6, 1.5

        def minute_of(index):  # a minute in the band, and its added time
            return (90, 1 + rng.randrange(6)) if index == 6 else (15 * index + 1 + rng.randrange(15), 0)

        def goals(rate, start, factor):
            out = []
            for index, share in enumerate(profile):
                lo, hi = (15 * index, 15 * (index + 1)) if index < 6 else (90, 98)
                part = share if lo >= start else 0.0 if hi <= start else share * (hi - start) / (hi - lo) if index < 6 else share
                lam, k, p, limit = rate * part * factor, 0, rng.random(), 0
                from math import exp
                limit = exp(-lam)
                while p > limit:
                    k += 1
                    p *= rng.random()
                for _ in range(k):
                    m, a = minute_of(index)
                    if m > start or index == 6:
                        out.append((m, a))
            return out

        matches = []
        for n in range(6000):
            red = 30 if n % 3 == 0 else None  # a third of the matches: the home side a man down from the 30th minute
            events = [(m, a, "goal", "home") for m, a in goals(1.5, 0, 1.0) if red is None or m <= red]
            events += [(m, a, "goal", "away") for m, a in goals(1.2, 0, 1.0) if red is None or m <= red]
            if red is not None:
                events.append((red, 0, "red", "home"))
                events += [(m, a, "goal", "home") for m, a in goals(1.5, red, down)]
                events += [(m, a, "goal", "away") for m, a in goals(1.2, red, up)]
            matches.append((1.5, 1.2, sorted(events)))
        model = inplay.fit(matches)
        self.assertEqual((model["matches"], model["red_matches"]), (6000, 2000))
        for got, want in zip(model["profile"], profile):
            self.assertAlmostEqual(got, want, delta=0.012)
        self.assertAlmostEqual(sum(model["profile"]), 1.0, places=9)
        self.assertAlmostEqual(model["down"], down, delta=0.06)
        self.assertAlmostEqual(model["up"], up, delta=0.1)
        self.assertIsNone(inplay.fit(matches[:inplay.MIN_FIT - 1]))
        # Without a red card in the base, a dismissal changes nothing.
        clean = inplay.fit([m for m in matches if not any(kind == "red" for _, _, kind, _ in m[2])])
        self.assertEqual((clean["down"], clean["up"]), (1.0, 1.0))


if __name__ == "__main__":
    unittest.main()
