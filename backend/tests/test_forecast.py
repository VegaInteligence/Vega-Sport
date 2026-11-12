"""Match forecasts and season projections (vega/forecast.py): the formulas, without a database.
The database pass over a synthetic season is in test_models.py."""

from pathlib import Path
import random
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from vega import forecast

MODEL = {"home": (0.26, 0.93), "away": (0.32, 0.91), "rho": -0.03, "matches": 1000}


class ForecastTest(unittest.TestCase):
    def test_a_score_grid_is_a_probability_law(self):
        grid = forecast.score_grid(1.6, 1.1, -0.03)
        self.assertAlmostEqual(sum(map(sum, grid)), 1.0)
        win, draw, loss = forecast.outcome(grid)
        self.assertAlmostEqual(win + draw + loss, 1.0)
        self.assertGreater(win, loss)
        # The low-score correction moves weight between the four lowest scores only.
        plain = forecast.score_grid(1.6, 1.1, 0.0)
        self.assertGreater(forecast.outcome(grid)[1], forecast.outcome(plain)[1])  # a negative rho gives more draws
        self.assertAlmostEqual(grid[3][2] / plain[3][2], sum(map(sum, plain)) / sum(plain[i][j] * forecast.tau(i, j, 1.6, 1.1, -0.03) for i in range(11) for j in range(11)))

    def test_the_stronger_and_the_home_side_are_favoured(self):
        level = forecast.forecast(MODEL, 1700, 1700)
        self.assertGreater(level["home"], level["away"])  # the home advantage alone
        neutral = forecast.forecast(MODEL, 1700, 1700, neutral=True)
        self.assertLess(level["home"] - neutral["home"], 0.2)
        self.assertGreater(level["home"], neutral["home"])
        strong = forecast.forecast(MODEL, 1986, 1760)
        self.assertGreater(strong["home"], 0.7)
        self.assertGreater(strong["home_goals"], strong["away_goals"])
        self.assertEqual(strong["score"][0] > strong["score"][1], True)
        self.assertAlmostEqual(strong["home"] + strong["draw"] + strong["away"], 1.0)

    def test_fit_recovers_the_laws_that_made_the_scores(self):
        rng = random.Random(7)
        matches = []
        for _ in range(6000):
            eh, ea = rng.gauss(1600, 120), rng.gauss(1600, 120)
            lh, la = forecast.rates(MODEL, eh, ea)
            matches.append((eh, ea, False, forecast._goals(rng, lh), forecast._goals(rng, la)))
        model = forecast.fit(matches)
        for side in ("home", "away"):
            self.assertAlmostEqual(model[side][0], MODEL[side][0], delta=0.06)
            self.assertAlmostEqual(model[side][1], MODEL[side][1], delta=0.12)
        self.assertLessEqual(abs(model["rho"]), 0.06)  # independent scores: no correction to find
        self.assertIsNone(forecast.fit(matches[:100]))  # too few matches to fit
        judged = forecast.evaluate(model, matches[:2000])
        self.assertLess(judged["log_loss"], 1.0986)  # better than three equal chances
        self.assertEqual(judged["matches"], 2000)

    def test_a_league_replayed_to_its_end(self):
        teams = list(range(8))
        strengths = {t: 1800 - 40 * t for t in teams}
        table = {t: (12 - t, 10, 8, 6) for t in teams}  # six matches played each
        fixtures = [(h, a) for h in teams for a in teams if h != a][:40]
        projected = forecast.simulate(table, fixtures, MODEL, strengths, simulations=400, seed=3)
        self.assertEqual(set(projected), set(teams))
        for team in teams:
            self.assertAlmostEqual(sum(projected[team]["positions"]), 1.0)
            self.assertGreaterEqual(projected[team]["points"], table[team][0])
        for place in range(len(teams)):
            self.assertAlmostEqual(sum(projected[t]["positions"][place] for t in teams), 1.0)  # one club per place
        self.assertGreater(projected[0]["positions"][0], projected[7]["positions"][0])
        self.assertEqual(projected, forecast.simulate(table, fixtures, MODEL, strengths, simulations=400, seed=3))  # the same replays, the same answer
        # Strengths held exactly make the leader more certain than strengths that may move.
        fixed = forecast.simulate(table, fixtures, MODEL, strengths, simulations=400, seed=3, spread=0.0)
        self.assertGreater(fixed[0]["positions"][0], projected[0]["positions"][0] - 0.15)
        # A season over: every club stays where it is.
        done = forecast.simulate({0: (9, 5, 1, 3), 1: (4, 3, 3, 3), 2: (1, 1, 5, 3)}, [], MODEL, {0: 1700, 1: 1600, 2: 1500}, simulations=50)
        self.assertEqual([done[t]["positions"].index(1.0) for t in (0, 1, 2)], [0, 1, 2])

    def test_a_league_s_state_from_its_matches(self):
        row = lambda match, edition, home, away, status, hs=None, as_=None, regular=True, domestic=True: (match, edition, home, away, False, status, hs, as_, regular, domestic)
        rows = [row(i, 1, h, a, "finished", 2, 1) for i, (h, a) in enumerate([(t, t + 1) for t in range(1, 8)])]
        rows += [row(20, 1, 8, 9, "not_started"), row(21, 1, 1, 2, "not_started", regular=False), row(22, 2, 1, 2, "not_started"),
                 row(23, 3, 1, 2, "not_started", domestic=False)]
        state = forecast.league_state(rows)
        self.assertEqual(set(state), {1})  # edition 2 has two clubs, edition 3 is no domestic league
        table, fixtures = state[1]
        self.assertEqual(fixtures, [(8, 9)])  # a knockout round is not replayed
        self.assertEqual(table[1], (3, 2, 1, 1))
        self.assertEqual(table[9], (0, 0, 0, 0))  # a club still to play its first match is in the table
        self.assertEqual(len(table), 9)


if __name__ == "__main__":
    unittest.main()
