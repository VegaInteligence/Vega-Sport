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

    def test_a_clubs_form_is_its_last_matches_chances_and_what_its_results_owe_to_something_else(self):
        # Ten matches at most, five with an xG at least: the mean xG difference, and the mean of the goal difference less it.
        self.assertIsNone(forecast.form_of([(0.5, 1)] * 4))
        xg, luck = forecast.form_of([(0.5, 1), (-0.2, 0), (1.1, 3), (0.0, 0), (0.6, 1)])
        self.assertAlmostEqual(xg, 0.4)
        self.assertAlmostEqual(luck, 0.6)
        # Each side's form before each match: nothing of a match enters its own; a match without xG enters nobody's.
        rows = [(1, 2, 2, 0, 1.5, 0.5)] * 5 + [(1, 2, 0, 0, None, None), (2, 1, 1, 1, 1.0, 1.0)]
        before, present = forecast.with_forms(rows)
        self.assertEqual(before[:5], [(None, None)] * 5)
        self.assertEqual(before[5], ((1.0, 1.0), (-1.0, -1.0)))
        self.assertEqual(before[6], ((-1.0, -1.0), (1.0, 1.0)))  # club 2 at home: the match without xG changed nothing
        self.assertAlmostEqual(present[1][0], 5 / 6)
        self.assertAlmostEqual(present[1][1], 5 / 6)
        # Only the last ten matches count.
        _, late = forecast.with_forms([(1, 2, 0, 0, 0.0, 2.0)] * 10 + [(1, 2, 3, 0, 2.0, 0.0)] * 10)
        self.assertEqual(late[1], (2.0, 1.0))
        # In Elo points.
        self.assertAlmostEqual(forecast.form_shift((0.07, -0.05), (0.5, 0.4)), 400 * (0.035 - 0.02))
        self.assertEqual(forecast.form_shift((0.07, -0.05), None), 0.0)

    def test_what_a_form_adds_is_found_again_in_scores_drawn_from_it(self):
        from math import exp

        rng = random.Random(5)

        def drawn(mean):
            limit, k, p = exp(-mean), 0, rng.random()
            while p > limit:
                k += 1
                p *= rng.random()
            return k

        cases = []
        for _ in range(8000):
            d, xg, luck = rng.uniform(-0.6, 0.6), rng.gauss(0, 0.8), rng.gauss(0, 0.65)
            x = d + 0.07 * xg - 0.05 * luck
            cases.append((d, xg, luck, drawn(exp(MODEL["home"][0] + MODEL["home"][1] * x)), drawn(exp(MODEL["away"][0] - MODEL["away"][1] * x))))
        found = forecast.fit_form(cases, MODEL)
        self.assertAlmostEqual(found[0], 0.07, delta=0.025)
        self.assertAlmostEqual(found[1], -0.05, delta=0.03)
        self.assertEqual(forecast.fit_form(cases[:forecast.MIN_FIT - 1], MODEL), (0.0, 0.0))  # too few matches with two forms

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


    def test_a_uefa_league_phase_is_projected_like_a_league(self):
        row = lambda match, edition, home, away, status, hs=None, as_=None, regular=True, domestic=True: (match, edition, home, away, False, status, hs, as_, regular, domestic)
        rows = [row(i, 3, t, t + 1, "finished", 1, 0, domestic=False) for i, t in enumerate(range(1, 9))] + [row(30, 3, 9, 1, "not_started", domestic=False)]
        self.assertEqual(forecast.league_state(rows), {})  # an international competition is no league…
        self.assertEqual(set(forecast.league_state(rows, phases={3})), {3})  # …unless it is a league phase

    def test_a_league_phase_holds_eight_matches_a_club(self):
        # A knockout match listed before its round is set reads as regular: once a club has its
        # eight league-phase matches (played, then to play by date), any further one is not of the phase.
        row = lambda match, home, away, status, hs=None, as_=None: (match, 3, home, away, False, status, hs, as_, True, False)
        rows = [row(i, 1, t, "finished", 1, 0) for i, t in enumerate(range(2, 9))]  # club 1: seven played
        rows += [row(20, 9, 1, "not_started"), row(21, 1, 10, "not_started"), row(22, 11, 12, "not_started")]
        table, fixtures = forecast.league_state(rows, phases={3})[3]
        self.assertEqual(fixtures, [(9, 1), (11, 12)])  # club 1's ninth match is left out
        self.assertNotIn(10, table)  # …and its opponent there is no club of the phase

    def test_a_knockout_round_by_its_name(self):
        names = {"1/16": "playoff", "Knockout round play-offs": "playoff", "1/8": "r16", "Round of 16": "r16", "1/4": "qf",
                 "Quarter-finals": "qf", "1/2": "sf", "Semi-finals": "sf", "final": "final", "Final": "final", "Qualifying round 3": None}
        self.assertEqual({name: forecast.knockout_stage(name) for name in names}, names)

    def league_phase(self, played=8):
        """36 clubs after their league phase (or before its last rounds): Elo 1900 for the first down to 1550."""
        table = {t: (3 * (36 - t), 40 - t, 10 + t, played) for t in range(1, 37)}
        strengths = {t: 1900 - 10 * (t - 1) for t in range(1, 37)}
        return table, strengths

    def test_a_cup_replayed_through_its_bracket(self):
        table, strengths = self.league_phase()
        cup = forecast.simulate_cup(table, [], MODEL, strengths, {}, simulations=300, seed=5)
        stage = lambda key: sum(p["stages"][key] for p in cup.values())
        # The order is final: the first eight go through, 9th to 24th play the play-offs, the rest are out.
        self.assertEqual([cup[t]["stages"]["top8"] for t in (1, 8, 9)], [1.0, 1.0, 0.0])
        self.assertEqual([cup[t]["stages"]["playoff"] for t in (9, 24, 25)], [1.0, 1.0, 0.0])
        self.assertEqual(cup[30]["stages"]["out"], 1.0)
        for key, count in (("r16", 16), ("qf", 8), ("sf", 4), ("final", 2), ("win", 1)):
            self.assertAlmostEqual(stage(key), count, places=6)
        self.assertEqual(cup[30]["stages"]["r16"], 0.0)
        self.assertGreater(cup[1]["stages"]["win"], cup[16]["stages"]["win"])  # the stronger and better placed go further
        self.assertEqual(cup, forecast.simulate_cup(table, [], MODEL, strengths, {}, simulations=300, seed=5))

    def test_ties_already_played_stay_as_they_are(self):
        table, strengths = self.league_phase()
        # Play-off 9 v 24 decided for 24 (it won both legs); 10 v 23 after a first leg 23 won 3–0; the rest drawn, not played.
        knockout = {"playoff": [
            {"teams": (24, 9), "legs": [(24, 9, 2, 0, None, None), (9, 24, 1, 1, None, None)]},
            {"teams": (23, 10), "legs": [(23, 10, 3, 0, None, None), (10, 23, None, None, None, None)]},
            {"teams": (22, 11), "legs": [(22, 11, 1, 1, None, None), (11, 22, 0, 0, 3, 4)]},  # level on aggregate: 22 won the shoot-out
        ]}
        cup = forecast.simulate_cup(table, [], MODEL, strengths, knockout, simulations=300, seed=5)
        self.assertEqual((cup[24]["stages"]["r16"], cup[9]["stages"]["r16"]), (1.0, 0.0))
        self.assertEqual((cup[22]["stages"]["r16"], cup[11]["stages"]["r16"]), (1.0, 0.0))
        self.assertGreater(cup[23]["stages"]["r16"], 0.8)  # 3–0 up after the first leg
        self.assertAlmostEqual(sum(p["stages"]["r16"] for p in cup.values()), 16, places=6)

    # Domestic knockout cups (VI-19/VI-21, 17 Nov 2026). Rows: (edition, cup key, home, away, status, home goals,
    # away goals, home penalties, away penalties, day).
    def cup_row(self, home, away, status="not_started", hs=None, as_=None, hp=None, ap=None, day=20, edition=7, key="openligadb:germany-cup:2026/2027"):
        from datetime import date

        return (edition, key, home, away, status, hs, as_, hp, ap, date(2026, 12, day) if day > 0 else date(2026, 10, -day))

    def test_a_knockout_cup_s_round_in_play(self):
        # The clubs still in a knockout cup: the ties of the round drawn and not started, each club once;
        # a tie of two legs counts its leg played. A round begun, half played, says nothing yet.
        r = self.cup_row
        round16 = [r(2 * k + 1, 2 * k + 2) for k in range(8)] + [r(90, 91, "finished", 2, 1, day=-28)]  # an earlier round's match
        ties = forecast.knockout_round(round16)
        self.assertEqual(sorted(t["teams"] for t in ties[7]), [(2 * k + 1, 2 * k + 2) for k in range(8)])
        self.assertIsNone(forecast.knockout_round([r(1, 2), r(3, 4), r(5, 6)]).get(7))  # three ties: no complete round
        begun = [r(2 * k + 1, 2 * k + 2) for k in range(7)] + [r(15, 16, "finished", 1, 0, day=1)]
        self.assertIsNone(forecast.knockout_round(begun).get(7))  # one tie of the round already played: wait for the next draw
        half = [r(2 * k + 1, 2 * k + 2) for k in range(4)] + [r(2 * k + 1, 2 * k + 2, "finished", 1, 0, day=18) for k in range(4, 8)]
        self.assertIsNone(forecast.knockout_round(half).get(7))  # four of eight played two days before: the round is begun
        semis = [r(1, 2, "finished", 2, 0, day=1), r(2, 1, day=21), r(3, 4, "finished", 1, 1, day=1), r(4, 3, day=21)]
        ties = forecast.knockout_round(semis)[7]
        self.assertEqual([len(t["legs"]) for t in ties], [2, 2])  # the first legs count
        self.assertIsNone(forecast.knockout_round([r(1, 2), r(1, 3)]).get(7))  # a club twice: no round

    def test_a_knockout_cup_replayed_to_its_final(self):
        r = self.cup_row
        strengths = {t: 1800 - 15 * t for t in range(1, 17)}
        ties = forecast.knockout_round([r(2 * k + 1, 2 * k + 2) for k in range(8)])[7]
        cup = forecast.simulate_knockout(ties, MODEL, strengths, simulations=400, seed=3)
        stage = lambda key: sum(p[key] for p in cup.values())
        for key, count in (("r16", 16), ("qf", 8), ("sf", 4), ("final", 2), ("win", 1)):
            self.assertAlmostEqual(stage(key), count, places=6)
        self.assertGreater(cup[1]["win"], cup[16]["win"])
        self.assertEqual(cup, forecast.simulate_knockout(ties, MODEL, strengths, simulations=400, seed=3))
        # Two-legged semi-finals change nothing to the counts; a final already settled stays as it is.
        self.assertAlmostEqual(sum(p["sf"] for p in forecast.simulate_knockout(ties, MODEL, strengths, simulations=200, two_legged_semis=True).values()), 4, places=6)
        final = forecast.knockout_round([r(1, 2, "finished", 1, 1, 4, 5, day=21)] + [r(1, 2, "not_started", day=22)][:0])
        self.assertEqual(final, {})  # a final played has no round left
        semis = forecast.knockout_round([r(1, 2, "finished", 3, 0, day=1), r(2, 1, day=21), r(3, 4, day=21)])[7]
        cup = forecast.simulate_knockout(semis, MODEL, strengths, simulations=300, two_legged_semis=True)
        self.assertGreater(cup[1]["final"], 0.85)  # 3–0 up after the first leg
        self.assertAlmostEqual(sum(p["final"] for p in cup.values()), 2, places=6)

    def test_a_knockout_cup_is_projected_once_its_clubs_are_all_in(self):
        # A cup whose later rounds bring clubs in (the FA Cup's third round, the Coppa Italia's round of 16) is
        # projected only once the round in play holds no more clubs than the round its last clubs enter.
        self.assertEqual(forecast.knockout_cup("open-matchday:ENG_CUP_efl-cup:2026/2027"), ("open-matchday:ENG_CUP_efl-cup", 32, True))
        self.assertIsNone(forecast.knockout_cup("open-matchday:GER_CUP_dfb-pokal:2026/2027"))  # OpenLigaDB holds that cup, with its rounds
        self.assertEqual(forecast.knockout_cup("openligadb:germany-cup:2026/2027")[1:], (64, False))
        self.assertIsNone(forecast.knockout_cup("open-matchday:ENG_5_national-league:2026/2027"))

    def test_which_cups_are_projected(self):
        # Projected: a cup of KNOCKOUT_CUPS whose round in play holds no more clubs than its last entrants'
        # round, every club rated. Not: the Coppa Italia with 32 clubs (its seeds enter at 16), a cup with a
        # club the Elo does not rate, open-matchday's copy of the German cup.
        from datetime import date

        r = lambda edition, key, h, a: (edition, key, h, a, "not_started", None, None, None, None, date(2026, 12, 20))
        rows = [r(1, "open-matchday:ENG_CUP_fa-cup:2026/2027", 2 * k + 1, 2 * k + 2) for k in range(32)]
        rows += [r(2, "open-matchday:ITA_CUP_coppa-italia:2026/2027", 100 + 2 * k, 101 + 2 * k) for k in range(16)]
        rows += [r(3, "open-matchday:SUI_CUP_swiss-cup:2026/2027", 200 + 2 * k, 201 + 2 * k) for k in range(8)]
        rows += [r(4, "open-matchday:GER_CUP_dfb-pokal:2026/2027", 300 + 2 * k, 301 + 2 * k) for k in range(8)]
        strengths = {t: 1500.0 for t in list(range(1, 65)) + list(range(100, 132)) + list(range(200, 215)) + list(range(300, 316))}
        cups = forecast.knockout_projections(rows, MODEL, strengths, date(2026, 12, 1), simulations=50)
        self.assertEqual(sorted(cups), [1])  # the Swiss cup lacks club 215's strength
        self.assertAlmostEqual(sum(p["r32"] for p in cups[1].values()), 32, places=6)


if __name__ == "__main__":
    unittest.main()
