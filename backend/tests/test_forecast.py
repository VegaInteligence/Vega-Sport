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

    # The Nations League (VI-19, 17 Nov 2026). Rows: (edition, cup key, group, home, away, status, home goals, away goals, day).
    def unl(self, group, h, a, hs=None, as_=None, status="finished", day=1, edition=9, key="nations-results:nations-league:2026/2027"):
        from datetime import date

        return (edition, key, group, h, a, status, hs, as_, date(2026, 9, day))

    def test_a_nations_league_group_and_its_matches_left(self):
        # A group plays home and away: the legs a source gives no fixture for are the ones not played yet.
        u = self.unl
        played = [u("B1", 1, 2, 1, 0), u("B1", 3, 4, 0, 0), u("B1", 1, 3, 2, 2), u("B1", 2, 4, 0, 1), u("B1", 4, 1, 1, 1), u("B1", 2, 3, 3, 0),
                  u("B1", 2, 1, 0, 0), u("B1", 4, 3, 2, 1)]
        group = forecast.nations_groups(played)[9]["B1"]
        self.assertEqual(group["members"], {1, 2, 3, 4})
        self.assertEqual(len(group["results"]), 8)
        self.assertEqual(sorted(group["fixtures"]), [(1, 4), (3, 1), (3, 2), (4, 2)])
        # A fixture given counts once; League A's groups are « 1 » to « 4 ».
        a = [u("1", 1, 2, 1, 0, key="openligadb:nations-league:2026/2027", edition=8), u("1", 2, 1, status="not_started", key="openligadb:nations-league:2026/2027", edition=8)]
        self.assertEqual(forecast.nations_groups(a)[8]["1"]["fixtures"], [(2, 1)])

    def test_a_group_ranked_as_uefa_does(self):
        # Points, then the points, goal difference and goals of the matches between the teams level, again among those
        # still level, then overall goal difference, goals, away goals, wins, away wins (the site's own order,
        # nations-standings.js); a tie left after all is drawn.
        import random

        results = [(1, 2, 1, 0), (2, 3, 1, 0), (3, 1, 1, 0), (1, 4, 5, 0), (2, 4, 1, 0), (3, 4, 2, 0)]
        # 1, 2 and 3 have 6 points each and beat each other in a circle (head-to-head level): overall goal difference decides.
        self.assertEqual(forecast.uefa_order({1, 2, 3, 4}, results, random.Random(0)), [1, 3, 2, 4])
        # 1 and 2 level on 6 points: 2 won their meeting, so it goes first though 1's goal difference is far better.
        results = [(1, 2, 0, 1), (1, 3, 6, 0), (1, 4, 6, 0), (2, 3, 1, 0), (2, 4, 0, 1), (3, 4, 0, 0)]
        self.assertEqual(forecast.uefa_order({1, 2, 3, 4}, results, random.Random(0)), [2, 1, 4, 3])

    def test_a_nations_league_replayed_to_its_final_four(self):
        # League A: four groups, then quarter-finals (a winner against another group's runner-up, two legs), then the
        # Final Four; a group already played out keeps its order.
        u = self.unl
        key = "openligadb:nations-league:2026/2027"
        rows = []
        for g in range(4):
            t = [10 * g + k for k in range(1, 5)]
            for i, h in enumerate(t):
                for a in t:
                    if h != a:
                        hs, as_ = (2, 0) if t.index(h) < t.index(a) else (0, 1)
                        rows.append(u(str(g + 1), h, a, hs, as_, key=key, edition=8))
        rows[-1] = u("4", rows[-1][3], rows[-1][4], status="not_started", key=key, edition=8)  # one match left
        groups = forecast.nations_groups(rows)[8]
        strengths = {t: 1700 - 5 * t for g in groups.values() for t in g["members"]}
        odds = forecast.simulate_nations(groups, MODEL, strengths, knockout=True, simulations=300, seed=2)
        total = lambda k: sum(o[k] for o in odds.values())
        for k, n in (("first", 4), ("second", 4), ("third", 4), ("fourth", 4), ("qf", 8), ("sf", 4), ("final", 2), ("win", 1)):
            self.assertAlmostEqual(total(k), n, places=6)
        self.assertEqual((odds[1]["first"], odds[4]["fourth"]), (1.0, 1.0))  # group 1 is played out
        self.assertEqual(odds, forecast.simulate_nations(groups, MODEL, strengths, knockout=True, simulations=300, seed=2))
        # Leagues B to D: their groups only.
        b = forecast.simulate_nations({"B1": groups["1"]}, MODEL, strengths, knockout=False, simulations=50)
        self.assertNotIn("win", b[1])
        self.assertEqual(b[1]["first"], 1.0)

    def test_which_nations_league_editions_are_projected(self):
        # League A's edition with its knockout, Leagues B to D's groups alone; each club's points and matches so far;
        # an edition with a nation the Elo does not rate waits.
        from datetime import date

        u = self.unl
        a = [u(str(g + 1), 10 * g + i, 10 * g + j, 1, 0, key="openligadb:nations-league:2026/2027", edition=8)
             for g in range(4) for i in range(1, 5) for j in range(1, 5) if i != j]
        b = [u("B1", 101, 102, 2, 1), u("B1", 103, 104, 0, 0)]
        strengths = {t: 1500.0 for t in [10 * g + i for g in range(4) for i in range(1, 5)] + [101, 102, 103, 104]}
        out = forecast.nations_projections(a + b, MODEL, strengths, date(2026, 11, 17), simulations=40)
        table, odds = out[8]
        self.assertEqual(table[1], (9, 3, 3, 6))  # three home wins, three away defeats: points, goals for, goals against, played
        self.assertIn("win", odds[1]["stages"])
        self.assertNotIn("win", out[9][1][101]["stages"])
        self.assertEqual(out[9][0][101], (3, 2, 1, 1))
        del strengths[104]
        self.assertNotIn(9, forecast.nations_projections(b, MODEL, strengths, date(2026, 11, 17), simulations=10))

    # The 2026–27 edition is transitional (three leagues of 18 from 2028–29; UEFA's rules, read 17 Nov 2026): League A's
    # two best third-placed stay, its two worst third-placed and two best fourth-placed play the A/B play-offs against
    # League B's runners-up, its two worst fourth-placed go down; League B's winners go up, its third-placed stay, its
    # fourth-placed play the B/C play-offs against League C's runners-up; League C's winners go up, its third- and
    # fourth-placed stay; all of League D goes up. Play-offs: two legs, the higher league's side at home second.
    def season(self, fixtures=False):
        """Groups played out: in each, team 1 > 2 > 3 > 4 by points (double round-robin, the better side winning); in
        League A, group g's third beats its fourth by g + 1 both times, so the thirds are ranked by goal difference
        (groups 3 and 4 best) and the fourths the other way round (groups 1 and 2 best)."""
        u, rows, teams = self.unl, [], {}
        layout = [("A", str(g + 1), 4, "openligadb:nations-league:2026/2027", 8) for g in range(4)]
        layout += [(league, f"{league}{g + 1}", 4, "nations-results:nations-league:2026/2027", 9) for league in "BC" for g in range(4)]
        layout += [("D", f"D{g + 1}", 3, "nations-results:nations-league:2026/2027", 9) for g in range(2)]
        base = 0
        for league, group, size, key, edition in layout:
            t = [base + k for k in range(1, size + 1)]
            base += 10
            teams[group] = t
            g = int(group[-1]) - 1
            for i, h in enumerate(t):
                for j, a in enumerate(t):
                    if h == a:
                        continue
                    best = min(i, j)
                    margin = g + 1 if league == "A" and {i, j} == {2, 3} else 2
                    hs, as_ = (margin, 0) if i == best else (0, margin)
                    rows.append(u(group, h, a, hs, as_, key=key, edition=edition))
        return rows, teams

    def test_the_transitional_season_s_promotion_and_relegation(self):
        rows, teams = self.season()
        strengths = {t: 1500.0 for ts in teams.values() for t in ts}
        leagues = forecast.nations_leagues(rows)
        self.assertEqual(sorted(leagues), ["A", "B", "C", "D"])
        odds = forecast.simulate_nations_season(leagues, MODEL, strengths, simulations=200, seed=3)
        total = lambda k: round(sum(o.get(k, 0) for o in odds.values()), 6)
        # Each stage holds its number of nations; each nation plays next season in one league; 18 in each.
        for k, n in (("qf", 8), ("sf", 4), ("final", 2), ("win", 1), ("stay", 14), ("relegated", 2), ("promoted", 14), ("barrage", 16),
                     ("next_a", 18), ("next_b", 18), ("next_c", 18)):
            self.assertEqual(total(k), n, k)
        for team, o in odds.items():
            self.assertAlmostEqual(o["next_a"] + o["next_b"] + o["next_c"], 1.0, places=9, msg=team)
        a = lambda g, place: odds[teams[str(g)][place - 1]]
        # League A: the thirds of groups 3 and 4 (better goal difference) stay; those of 1 and 2 play the play-offs. The
        # fourths of groups 1 and 2 play them; those of 3 and 4 go down.
        self.assertEqual([a(g, 3)["stay"] for g in (1, 2, 3, 4)], [0.0, 0.0, 1.0, 1.0])
        self.assertEqual([a(g, 3)["barrage"] for g in (1, 2, 3, 4)], [1.0, 1.0, 0.0, 0.0])
        self.assertEqual([a(g, 4)["barrage"] for g in (1, 2, 3, 4)], [1.0, 1.0, 0.0, 0.0])
        self.assertEqual([a(g, 4)["relegated"] for g in (1, 2, 3, 4)], [0.0, 0.0, 1.0, 1.0])
        self.assertEqual((a(3, 4)["next_b"], a(1, 1)["qf"], a(1, 1)["next_a"]), (1.0, 1.0, 1.0))
        b, c, d = (lambda group, place: odds[teams[group][place - 1]] for _ in range(3))
        self.assertEqual((b("B1", 1)["promoted"], b("B1", 1)["next_a"]), (1.0, 1.0))
        self.assertEqual((b("B1", 2)["barrage"], b("B1", 3)["stay"], b("B1", 3)["next_b"], b("B1", 4)["barrage"]), (1.0, 1.0, 1.0, 1.0))
        self.assertAlmostEqual(b("B1", 2)["next_a"] + b("B1", 2)["next_b"], 1.0)
        self.assertAlmostEqual(b("B1", 4)["next_b"] + b("B1", 4)["next_c"], 1.0)
        self.assertEqual((c("C2", 1)["promoted"], c("C2", 1)["next_b"], c("C2", 3)["stay"], c("C2", 4)["stay"], c("C2", 4)["next_c"]), (1.0, 1.0, 1.0, 1.0, 1.0))
        self.assertAlmostEqual(c("C2", 2)["next_b"] + c("C2", 2)["next_c"], 1.0)
        self.assertEqual([(d("D1", k)["promoted"], d("D1", k)["next_c"]) for k in (1, 2, 3)], [(1.0, 1.0)] * 3)
        self.assertEqual(odds, forecast.simulate_nations_season(leagues, MODEL, strengths, simulations=200, seed=3))

    def test_a_drawn_tie_is_played_as_drawn(self):
        # Once the quarter-finals and play-offs are drawn (20 Nov 2026), their ties are the draw's, their legs played or not.
        rows, teams = self.season()
        u, key = self.unl, "openligadb:nations-league:2026/2027"
        w1, r3 = teams["1"][0], teams["3"][1]
        rows += [u(None, r3, w1, status="not_started", key=key, edition=8, day=25), u(None, w1, r3, status="not_started", key=key, edition=8, day=28)]
        b2, a3 = teams["B2"][1], teams["1"][2]
        rows += [u(None, b2, a3, 3, 0, key=key, edition=8, day=26)]  # the play-off's first leg, played
        leagues = forecast.nations_leagues(rows)
        self.assertEqual(sorted(map(sorted, leagues["A"]["draws"])), sorted([sorted((w1, r3)), sorted((b2, a3))]))
        strengths = {t: 1500.0 for ts in teams.values() for t in ts}
        odds = forecast.simulate_nations_season(leagues, MODEL, strengths, simulations=200, seed=4)
        self.assertAlmostEqual(odds[w1]["sf"] + odds[r3]["sf"], 1.0)  # exactly one of the two reaches the Final Four
        self.assertGreater(odds[b2]["next_a"], 0.8)  # 3-0 up after the first leg

    def test_the_season_is_projected_jointly_once_its_leagues_are_all_there(self):
        # With Leagues A, B and C in the base (each edition rated), both editions carry the joint season's stages: the
        # play-offs link them; each nation's points so far stay its edition's.
        from datetime import date

        rows, teams = self.season()
        strengths = {t: 1500.0 for ts in teams.values() for t in ts}
        out = forecast.nations_projections(rows, MODEL, strengths, date(2026, 11, 17), simulations=60)
        self.assertEqual(sorted(out), [8, 9])
        w1, b1 = teams["1"][0], teams["B1"][0]
        self.assertEqual((out[8][1][w1]["stages"]["next_a"], out[9][1][b1]["stages"]["promoted"]), (1.0, 1.0))
        self.assertIn("barrage", out[9][1][teams["B1"][1]]["stages"])
        self.assertEqual(out[8][0][w1][3], 6)  # six matches played

    def test_a_copy_of_a_club_plays_at_its_club_s_strength(self):
        # A cup source's copy of a club (« FC Bayern München », « SK Rapid ») is merged into its club by the daily identity
        # pass; until then the forecasts read it at its club's strength, as the Elo already does (merged_rows): a cup is
        # projected the day its round is drawn, not the day after (17 Nov 2026).
        strengths = {1: 1700.0, 2: 1500.0}
        self.assertEqual(forecast.with_merges(strengths, {10: 1, 11: 2, 12: 99}), {1: 1700.0, 2: 1500.0, 10: 1700.0, 11: 1500.0})
        self.assertEqual(forecast.with_merges(strengths, {1: 2}), strengths)  # a rated team keeps its own strength

    def test_the_access_list_settles_a_tie_left_after_all(self):
        # The last criterion is the access list's order (the 2024–25 final ranking), never a draw; the disciplinary
        # points come before it, but the sources give no cards.
        import random

        results = [(1, 2, 1, 1), (2, 1, 1, 1), (3, 4, 0, 0), (4, 3, 0, 0), (1, 3, 1, 0), (3, 1, 0, 1), (2, 4, 1, 0), (4, 2, 0, 1),
                   (1, 4, 0, 0), (4, 1, 0, 0), (2, 3, 0, 0), (3, 2, 0, 0)]
        for seed in range(5):
            self.assertEqual(forecast.uefa_order({1, 2, 3, 4}, results, random.Random(seed), rank={1: 9, 2: 4, 3: 30, 4: 12})[:2], [2, 1])
        self.assertEqual(forecast.ACCESS_LIST[:3], ("POR", "ESP", "FRA"))
        self.assertEqual(len(forecast.ACCESS_LIST), 54)
        self.assertEqual(forecast.nation_code("Italie"), "ITA")
        self.assertEqual(forecast.nation_code("Turkiye"), "TUR")
        self.assertEqual(forecast.nation_code("Îles Féroé"), "FRO")
        self.assertEqual(forecast.nation_code("Bosnia and Herzegovina"), "BIH")


if __name__ == "__main__":
    unittest.main()
