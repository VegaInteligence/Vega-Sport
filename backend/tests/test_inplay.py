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
        # A side ahead scores less for the rest of the match, a side behind more (version 2); a level score changes nothing.
        state = {**MODEL, "ahead": 0.85, "behind": 1.1}
        self.close(inplay.outcome(1.6, 1.1, 0.39, 1, 0, 0, 0, state, RHO), [0.745134, 0.202399, 0.052467])
        self.close(inplay.outcome(1.6, 1.1, 0.39, 0, 1, 0, 0, state, RHO), [0.114505, 0.281145, 0.60435])
        self.close(inplay.outcome(1.6, 1.1, 0.39, 2, 1, 1, 0, state, RHO), [0.552454, 0.296477, 0.151069])
        self.close(inplay.outcome(1.6, 1.1, 0.39, 1, 1, 0, 0, state, RHO), inplay.outcome(1.6, 1.1, 0.39, 1, 1, 0, 0, MODEL, RHO))
        self.close(inplay.outcome(1.6, 1.1, 1.0, 0, 0, 0, 0, state, RHO), [0.486025, 0.256008, 0.257967])
        self.assertEqual([inplay.state_factors(2, 1, 0.85, 1.1), inplay.state_factors(0, 3, 0.85, 1.1), inplay.state_factors(1, 1, 0.85, 1.1)],
                         [(0.85, 1.1), (1.1, 0.85), (1.0, 1.0)])
        # The score changes the rates of the goals expected after the hour only: before it, the part of the match still to come after it.
        tilt = {**MODEL, "ahead": 0.85, "behind": 1.15}
        self.close([inplay.late_share(MODEL["profile"], m, a) for m, a in ((0, 0), (30, 0), (60, 0), (75, 0), (90, 4))], [0.39, 0.39, 0.39, 0.23, 0.035])
        at = lambda minute, home, away: inplay.outcome(1.6, 1.1, inplay.remaining(MODEL["profile"], minute, 0), home, away, 0, 0, tilt, RHO,
                                                       inplay.late_share(MODEL["profile"], minute, 0))
        self.close(at(30, 1, 0), [0.706589, 0.196064, 0.097347])
        self.close(at(75, 0, 1), [0.057434, 0.245146, 0.69742])
        events = [(23, 0, "goal", "home"), (45, 3, "goal", "away"), (61, 0, "red", "away"), (90, 4, "goal", "home")]
        points = inplay.timeline(1.6, 1.1, events, tilt, RHO)
        for minute, want in ((23, (0.705142, 0.19164, 0.103218)), (40, (0.711598, 0.203393, 0.085009)), (70, (0.468921, 0.447483, 0.083596))):
            self.close(points[minute][1:4], want)
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

    def test_the_fit_finds_what_being_ahead_or_behind_changes(self):
        from math import exp

        rng = random.Random(11)
        profile = MODEL["profile"]
        model = {"profile": profile, "down": 1.0, "up": 1.0}
        late = inplay.remaining(profile, 60, 0)

        def drawn(mean):
            limit, k, p = exp(-mean), 0, rng.random()
            while p > limit:
                k += 1
                p *= rng.random()
            return k

        matches = []
        for _ in range(4000):
            # Up to the hour the goals come at the forecast's rates; after it, a side ahead scores 0.7 times its rate, a side behind 1.3 times.
            early = [drawn(1.5 * (1 - late)), drawn(1.2 * (1 - late))]
            ahead, behind = (1.0, 1.0) if early[0] == early[1] else (0.7, 1.3)
            factor = (ahead, behind) if early[0] > early[1] else (behind, ahead)
            rest = [drawn(1.5 * late * factor[0]), drawn(1.2 * late * factor[1])]
            events = [(30, 0, "goal", side) for side, n in zip(("home", "away"), early) for _ in range(n)]
            events += [(80, 0, "goal", side) for side, n in zip(("home", "away"), rest) for _ in range(n)]
            matches.append((1.5, 1.2, events))
        self.addCleanup(setattr, inplay, "STATE_MINUTES", inplay.STATE_MINUTES)
        inplay.STATE_MINUTES = (60,)
        ahead, behind = inplay.fit_state(matches, model)
        self.assertAlmostEqual(ahead, 0.7, delta=0.1)
        self.assertAlmostEqual(behind, 1.3, delta=0.15)
        # Too few matches with a side ahead: the factors stay at 1.
        self.assertEqual(inplay.fit_state(matches[:200], model), (1.0, 1.0))

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
        # These goals were drawn whatever the score: the two factors of the score stay near 1.
        self.assertAlmostEqual(model["ahead"], 1.0, delta=0.15)
        self.assertAlmostEqual(model["behind"], 1.0, delta=0.15)
        # Without a red card in the base, a dismissal changes nothing.
        clean = inplay.fit([m for m in matches if not any(kind == "red" for _, _, kind, _ in m[2])])
        self.assertEqual((clean["down"], clean["up"]), (1.0, 1.0))


if __name__ == "__main__":
    unittest.main()
