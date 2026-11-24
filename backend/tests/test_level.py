"""Score Vega v9, the player's level (docs/calculs/10-score-vega-v9, FAILURE_MODES §49; v9.1: §54):
the formulas, without a database. The database pass over the synthetic season is in test_models.py."""

import json
from math import exp, sqrt
from pathlib import Path
import random
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from vega import level, power

CF, AM, WG, WM = level.CENTRE_FORWARD, level.ATTACKING_MIDFIELDER, level.WINGER, level.WIDE_MIDFIELDER
CM, DM, FB, CB, GK = level.CENTRAL_MIDFIELDER, level.DEFENSIVE_MIDFIELDER, level.FULL_BACK, level.CENTRE_BACK, level.GOALKEEPER
NB = len(level.BLOCKS)
DEFENCE = level.BLOCKS.index("defence")


def poisson_draw(rng, mean):
    limit, k, p = exp(-mean), 0, 1.0
    while True:
        p *= rng.random()
        if p <= limit:
            return k
        k += 1


def cell(minutes, sums=None, *, keeper=None):
    """A player's sums at a position and a club: every block measured on all his minutes."""
    c = level.empty_cell()
    c[level.MINUTES] = minutes
    if keeper is not None:
        c[level.KEEPER_MINUTES], c[level.KEEPER_GOALS] = minutes, keeper
    else:
        for b in range(NB):
            c[level.BLOCK_MINUTES + b] = minutes
            c[level.BLOCK_SUMS + b] = (sums or [0.0] * NB)[b]
    return c


def keeper_cell(minutes, covered, prevented=0.0):
    """A keeper's sums at a club: goals prevented known for `covered` of his minutes in goal."""
    c = level.empty_cell()
    c[level.MINUTES], c[level.KEEPER_MINUTES], c[level.KEEPER_GOALS] = minutes, covered, prevented
    return c


def references(lam=1000.0, sd=1.0, *, rho=0.8, delta=0.0, prices=None):
    """Measured references, the same for every position and block unless given."""
    return {
        "lam": {(p, b): lam for p in level.OUTFIELD for b in range(NB)},
        "sd": {(p, b): sd for p in level.OUTFIELD for b in range(NB)},
        "rho": {(a, b): rho for a in (True, False) for b in range(NB)},
        "delta": {(a, b): delta for a in (True, False) for b in range(NB)},
        "prices": prices or {p: [level.E * w for w in level.announced(p)] for p in level.OUTFIELD},
    }


def person(share=1.0, club=0.0, *, universe="men", reference=True, team=1):
    return {"share": share, "club": club, "universe": universe, "reference": reference, "team": team, "eligible": True, "linked": True}


class MathematicsTest(unittest.TestCase):
    def test_49a_one_position_is_the_shrinkage_by_the_minutes(self):
        lam, minutes, rate = 782.0, 1564.0, 2.0
        got = level.shrunk({CB: (rate, lam / minutes)}, [CB], lambda a, b: 0.5, {CB: 0.0})
        self.assertAlmostEqual(got[CB], rate * minutes / (minutes + lam))

    def test_49b_two_positions_that_are_one_talent_add_their_minutes(self):
        got = level.shrunk({CM: (2.0, 3.0), DM: (2.0, 3.0)}, [CM, DM], lambda a, b: 1.0 - 1e-9, {CM: 0.0, DM: 0.0})
        # noise 3 at each position = noise 1.5 on the two together: 2 / (1 + 1.5)
        self.assertAlmostEqual(got[CM], 2.0 * 2 / (2 + 3.0), places=6)
        self.assertAlmostEqual(got[DM], got[CM], places=6)

    def test_49c_unrelated_positions_are_shrunk_apart_and_the_second_starts_from_its_mean(self):
        rho = lambda a, b: 0.0
        alone = level.shrunk({CF: (2.0, 1.0)}, [CF, CB], rho, {CF: 0.0, CB: 0.3})
        self.assertAlmostEqual(alone[CF], 1.0)
        self.assertAlmostEqual(alone[CB], 0.3)  # nothing seen there, nothing learnt from the other
        both = level.shrunk({CF: (2.0, 1.0), CB: (1.3, 1.0)}, [CF, CB], rho, {CF: 0.0, CB: 0.3})
        self.assertAlmostEqual(both[CF], 1.0)
        self.assertAlmostEqual(both[CB], 0.3 + (1.3 - 0.3) / 2)
        # A related second position learns from the first even without a match of its own.
        self.assertGreater(level.shrunk({CF: (2.0, 1.0)}, [CF, AM], lambda a, b: 0.8, {CF: 0.0, AM: 0.0})[AM], 0.5)

    def test_49d_the_poisson_regression_finds_the_coefficients_of_its_cells(self):
        rng = random.Random(5)
        truth = (0.5, 0.2, 0.6, -0.3)
        cells = {}
        for _ in range(30000):
            f = (round(rng.gauss(0, .4) * 20) / 20, round(rng.gauss(0, .2) * 20) / 20, int(rng.random() < .3))
            exposure = rng.choice((1.0, 1.0, 0.3))
            c = cells.setdefault(f, [0.0, 0.0])
            c[0] += poisson_draw(rng, exposure * exp(truth[0] + sum(t * x for t, x in zip(truth[1:], f))))
            c[1] += exposure
        theta, errors = level.poisson(cells, 3)
        for got, want, se in zip(theta, truth, errors):
            self.assertLess(abs(got - want), 4 * se + 1e-3)
        self.assertIsNone(level.poisson({(0.0, 0.0, 0): [0.0, 5.0]}, 3))  # nothing counted: no fit

    def test_49e_the_centre_of_the_stabilised_scale(self):
        exact = level._centre_exact
        self.assertAlmostEqual(level.stabilised_centre(0.0), 2 * sqrt(0.375), places=12)
        self.assertAlmostEqual(level.stabilised_centre(4.0), exact(4.0), places=9)
        self.assertAlmostEqual(level.stabilised_centre(7.013), exact(7.013), places=4)
        self.assertAlmostEqual(level.stabilised_centre(80.0), exact(80.0), places=3)
        rng = random.Random(7)
        drawn = sum(2 * sqrt(poisson_draw(rng, 2.5) + 0.375) for _ in range(40000)) / 40000
        self.assertAlmostEqual(level.stabilised_centre(2.5), drawn, delta=0.02)

    def test_49f_noise_and_spread_from_the_players_full_matches(self):
        rng = random.Random(11)
        groups = [[rng.gauss(talent, 1.0) for _ in range(20)] for talent in (rng.gauss(0, 1.0) for _ in range(400))]
        lam, sigma = level.noise_and_spread(groups)
        self.assertAlmostEqual(lam, 90.0, delta=0.15 * 90)  # per-90 values: one match of noise equals the talent spread
        self.assertAlmostEqual(sigma, 1.0, delta=0.10)
        self.assertIsNone(level.noise_and_spread(groups[:29]))  # fewer than 30 players
        self.assertIsNone(level.noise_and_spread([g[:7] for g in groups]))  # fewer than 8 full matches each

    def test_49g_one_price_list_gives_the_attack_its_announced_shares(self):
        announced = {p: level.announced(p) for p in (CF, AM, WG)}
        hidden = [2.0, 0.5, 1.5, 1.0, 3.0]
        # Spreads built so that these prices give CF its shares exactly, AM and WG theirs too
        # (they share their weights): the list must find them, up to its scale.
        sigma = {p: [announced[p][b] / hidden[b] for b in range(NB)] for p in (CF, AM, WG)}
        matches = {CF: 300.0, AM: 100.0, WG: 200.0}
        prices = level.price_list(sigma, announced, matches)
        for p in (CF, AM, WG):
            worth = [prices[b] * sigma[p][b] for b in range(NB)]
            for b in range(NB):
                self.assertAlmostEqual(worth[b] / sum(worth), announced[p][b], places=3)
        mean = sum(matches[p] * sum(prices[b] * sigma[p][b] for b in range(NB)) for p in matches) / sum(matches.values())
        self.assertAlmostEqual(mean, level.E, places=6)

    def test_the_announced_weights_are_the_methods_five_blocks(self):
        for position, role in ((CF, "centre_forward"), (AM, "winger"), (WG, "winger"), (WM, "winger"), (CM, "central_midfielder"),
                               (DM, "defensive_midfielder"), (FB, "full_back"), (CB, "centre_back")):
            self.assertEqual(level.announced(position), [power.WEIGHTS[role][b] for b in level.BLOCKS])
            self.assertAlmostEqual(sum(level.announced(position)), 1.0)


class PositionsTest(unittest.TestCase):
    @staticmethod
    def row(player, match, role, pos, *, minutes=90.0, **more):
        r = {"player_id": player, "match_id": match, "team_id": 1, "role": role, "position_id": pos, "minutes_played": minutes,
             "goals_prevented": None, "national": False}
        r.update(more)
        return r

    def test_49h_a_winger_slot_is_one_of_three_positions(self):
        rows = [self.row(1, 1, "winger", 85), self.row(2, 1, "winger", 94), self.row(3, 1, "winger", 62), self.row(4, 1, "winger", 78),
                self.row(5, 1, "winger", 82), self.row(6, 1, "centre_forward", 105), self.row(7, 1, "full_back", 32)]
        # A substitute (line 2, no slot) filed winger by his most played role: three starts in the axis.
        rows += [self.row(8, m, "winger", 85) for m in (1, 2, 3)] + [self.row(8, 4, "winger", 2, minutes=20.0)]
        rows += [self.row(9, 1, "winger", 2, minutes=20.0)]  # a winger never seen in a slot
        kept = level.judge(rows, {}, set())
        got = {(r["player_id"], r["match_id"]): r["position"] for r in kept}
        self.assertEqual([got[(p, 1)] for p in (1, 2, 3, 4, 5, 6, 7)], [AM, AM, WM, WM, WG, CF, FB])
        self.assertEqual(got[(8, 4)], AM)
        self.assertEqual(got[(9, 1)], WG)
        groups = {r["player_id"]: r["group"] for r in kept}
        self.assertEqual({groups[p] for p in (1, 3, 5, 6)}, {level.ATTACK_GROUP})  # one reference for the attack
        self.assertEqual(groups[7], FB)

    def test_49i_an_outfield_players_match_in_goal_is_not_judged(self):
        main = {1: "centre_back", 2: "central_midfielder", 3: "full_back", 4: "winger", 5: "goalkeeper"}
        rows = [
            self.row(1, 1, "goalkeeper", 11),  # in the keeper's slot
            self.row(2, 1, "goalkeeper", 0, goals_prevented=-0.4),  # keeper statistics recorded
            self.row(3, 1, "full_back", 32),  # the keeper of one shot of match 1
            self.row(4, 1, "goalkeeper", 0, minutes=12.0),  # a substitute filed in goal by the fallback, no statistic
            self.row(5, 1, "goalkeeper", 11, goals_prevented=0.3),  # a keeper
            self.row(3, 2, "full_back", 32),  # the same full-back in a match where he faced no shot
        ]
        kept = level.judge(rows, main, {(1, 3)})
        got = {(r["player_id"], r["match_id"]): r["position"] for r in kept}
        self.assertEqual(got, {(4, 1): WG, (5, 1): GK, (3, 2): FB})
        self.assertFalse(next(r for r in kept if r["player_id"] == 4)["slot"])


class DefenceScaleTest(unittest.TestCase):
    def test_49j_one_great_match_weighs_less_than_the_same_total_spread(self):
        expected, s = 3.0, 2.0
        linear = lambda xs: sum(level.deviation(x, expected, 90.0, 1, s, None) for x in xs)
        stabilised = lambda xs: sum(level.deviation(x, expected, 90.0, 1, s, 1.0) for x in xs)
        once, spread = (15.0, 0.0, 0.0, 0.0, 0.0), (3.0, 3.0, 3.0, 3.0, 3.0)
        self.assertAlmostEqual(linear(once), linear(spread))  # the linear scale only sees the total
        self.assertLess(stabilised(once), stabilised(spread) - 1.0)
        # A match at the expectation is near zero; a direction of -1 turns the sign; a cameo counts for its minutes.
        self.assertAlmostEqual(level.deviation(3.0, 3.0, 90.0, 1, s, 1.0), 2 * sqrt(3.375) - level.stabilised_centre(3.0))
        self.assertAlmostEqual(level.deviation(5.0, 3.0, 90.0, -1, s, 1.0), -level.deviation(5.0, 3.0, 90.0, 1, s, 1.0))
        self.assertAlmostEqual(level.deviation(1.0, 0.5, 22.5, 1, s, 1.0), 0.5 * (2 * sqrt(1.375) - level.stabilised_centre(0.5)))
        self.assertAlmostEqual(level.deviation(5.0, 3.0, 90.0, 1, s, None), 1.0)  # no stabilised spread: (x - x̂) / s


class LevelsTest(unittest.TestCase):
    def test_49k_the_defence_talent_is_bounded(self):
        refs = references(lam=1375.0)
        high, plain = [0.0] * NB, [0.0] * NB
        high[DEFENCE] = 6.0 * 1250 / 90  # + 6 sd per 90 over 1,250 minutes
        plain[DEFENCE] = 1.5 * 1250 / 90
        now = {(1, CB, 1): cell(1250.0, high), (2, CB, 1): cell(1250.0, plain), (3, CB, 1): cell(1250.0)}
        out = level.levels(now, {}, refs, {p: person() for p in (1, 2, 3)})
        kept = 1250 / (1250 + 1375.0)
        self.assertGreater(6.0 * kept, level.DEFENCE_BOUND)
        self.assertAlmostEqual(out[1]["positions"][CB]["talents"][DEFENCE], level.DEFENCE_BOUND)
        self.assertAlmostEqual(out[2]["positions"][CB]["talents"][DEFENCE], 1.5 * kept)
        # The bound is the defence's alone: the same rate in creation is kept whole.
        creation = [0.0] * NB
        creation[1] = 6.0 * 1250 / 90
        out = level.levels({(1, CB, 1): cell(1250.0, creation), (3, CB, 1): cell(1250.0)}, {}, refs, {1: person(), 3: person()})
        self.assertAlmostEqual(out[1]["positions"][CB]["talents"][1], 6.0 * kept)

    def test_49l_a_second_position_is_acquired_at_450_minutes_over_two_seasons(self):
        refs = references()
        good = [90.0] * NB  # + 1 sd per 90 in every block over 90 minutes … scaled below
        at = lambda minutes: cell(minutes, [x * minutes / 90 for x in [1.0] * NB])
        people = {1: person(), 2: person()}
        # 300 minutes at full-back over the two seasons: not acquired.
        out = level.levels({(1, CB, 1): at(1800.0), (1, FB, 1): at(200.0), (2, CB, 1): cell(1800.0)},
                           {(1, FB, 1): at(100.0)}, refs, people)
        self.assertEqual(out[1]["position"], CB)
        self.assertEqual(set(out[1]["positions"]), {CB})
        self.assertEqual(out[1]["unjudged"], {FB: 300.0})
        self.assertAlmostEqual(out[1]["positions"][CB]["share"], 1.0)
        # 500 minutes: acquired, a level per position, shares by the year's minutes at each.
        out = level.levels({(1, CB, 1): at(1800.0), (1, FB, 1): at(200.0), (2, CB, 1): cell(1800.0)},
                           {(1, FB, 1): at(300.0)}, refs, people)
        self.assertEqual(set(out[1]["positions"]), {CB, FB})
        self.assertEqual(out[1]["unjudged"], {})
        self.assertAlmostEqual(out[1]["positions"][CB]["share"], 0.9)
        self.assertAlmostEqual(out[1]["positions"][FB]["share"], 0.1)
        self.assertAlmostEqual(out[1]["positions"][FB]["minutes"], 200.0)
        self.assertAlmostEqual(out[1]["positions"][FB]["minutes_two_seasons"], 500.0)
        del good

    def test_49m_a_keeper_is_worth_his_goals_prevented(self):
        refs = references()
        prevented = 0.2 * 3000 / 90
        now = {(1, GK, 1): cell(3000.0, keeper=prevented), (2, GK, 2): cell(3000.0, keeper=0.0)}
        out = level.levels(now, {}, refs, {1: person(team=1), 2: person(team=2)})
        self.assertEqual(out[1]["position"], GK)
        self.assertEqual(level.KEEPER_LAMBDA, 13291.0)
        self.assertAlmostEqual(out[1]["positions"][GK]["value"], level.GOAL * 0.2 * 3000 / (3000 + 13291.0))
        # Centred on the keepers: the two differ by the value, around zero.
        self.assertAlmostEqual(out[1]["own"] - out[2]["own"], out[1]["positions"][GK]["value"])
        self.assertAlmostEqual(out[1]["own"] + out[2]["own"], 0.0)

    def test_49n_the_club_adds_psi_and_the_score_follows_one_curve(self):
        refs = references()
        now = {(p, CM, p): cell(1800.0) for p in (1, 2, 3)}
        out = level.levels(now, {}, refs, {1: person(club=1.0, team=1), 2: person(club=0.0, team=2), 3: person(club=-1.0, team=3)})
        self.assertEqual(level.PSI, 10.0)
        self.assertAlmostEqual(out[1]["level"] - out[2]["level"], 10.0)
        self.assertAlmostEqual(out[1]["club"], 10.0)
        self.assertAlmostEqual(out[2]["score"], 50.0)  # the median of the reference population
        self.assertAlmostEqual(out[1]["score"], 100 / (1 + 10 ** (-10.0 / 36)))
        self.assertAlmostEqual(out[3]["score"], 100 / (1 + 10 ** (10.0 / 36)))
        self.assertEqual([out[p]["rank"] for p in (1, 2, 3)], [1, 2, 3])
        self.assertEqual([out[p]["position_rank"] for p in (1, 2, 3)], [1, 2, 3])
        # A starter is above a substitute of the same play: E_s between never and always.
        out = level.levels(now, {}, refs, {1: person(share=1.0), 2: person(share=0.5), 3: person(share=0.0)})
        self.assertAlmostEqual(out[1]["starts"] - out[3]["starts"], level.E_STARTS)
        self.assertAlmostEqual(out[2]["starts"], 0.0)
        for r in out.values():
            self.assertAlmostEqual(r["level"], r["blocks"] + r["starts"] + r["club"])
            self.assertAlmostEqual(r["own"], r["blocks"] + r["starts"])

    def test_49o_the_season_before_counts_for_half(self):
        lam = 1000.0
        refs = references(lam=lam)
        now_sum, before_sum = 30.0, 80.0
        sums = lambda s: [s if b == 0 else 0.0 for b in range(NB)]
        now = {(1, CF, 1): cell(900.0, sums(now_sum)), (2, CF, 1): cell(900.0)}
        before = {(1, CF, 1): cell(1800.0, sums(before_sum))}
        people = {1: person(), 2: person()}
        with_before = level.levels(now, before, refs, people)[1]["positions"][CF]["talents"][0]
        alone = level.levels(now, {}, refs, people)[1]["positions"][CF]["talents"][0]
        self.assertAlmostEqual(with_before, 90 * (now_sum + 0.5 * before_sum) / (900 + 0.5 * 1800 + lam))
        self.assertAlmostEqual(alone, 90 * now_sum / (900 + lam))
        # A player of the season before who has not played this year has no level this year.
        self.assertNotIn(9, level.levels(now, {(9, CF, 1): cell(1800.0)}, refs, people))

    def test_the_level_values_a_block_at_its_price(self):
        refs = references(lam=0.0)  # no noise: the talent is the rate
        sums = [0.0] * NB
        sums[1] = 2.0 * 1800 / 90  # + 2 sd of creation
        now = {(1, FB, 1): cell(1800.0, sums), (2, FB, 1): cell(1800.0)}
        out = level.levels(now, {}, refs, {1: person(), 2: person()})
        value = level.E * power.WEIGHTS["full_back"]["creation"] * 2.0
        self.assertAlmostEqual(out[1]["positions"][FB]["value"], value)
        self.assertAlmostEqual(out[1]["blocks"], value / 2 - 1.05)  # centred on the two full-backs, and their offset (54c)
        self.assertAlmostEqual(out[2]["blocks"], -value / 2 - 1.05)

    def test_universes_are_scored_and_ranked_apart(self):
        refs = references()
        now = {(p, CM, 1): cell(1800.0) for p in (1, 2, 3, 4)}
        people = {1: person(club=1.0), 2: person(club=0.0), 3: person(club=0.5, universe="women"), 4: person(club=0.0, universe="women")}
        out = level.levels(now, {}, refs, people)
        self.assertEqual((out[1]["rank"], out[2]["rank"], out[3]["rank"], out[4]["rank"]), (1, 2, 1, 2))
        # A player outside the reference population is placed against it, and moves neither its means nor its median.
        people[5] = person(club=3.0, reference=False)
        now[(5, CM, 1)] = cell(1800.0)
        again = level.levels(now, {}, refs, people)
        self.assertAlmostEqual(again[1]["score"], out[1]["score"])
        self.assertEqual((again[5]["rank"], again[1]["rank"]), (1, 2))

    def test_54a_a_keeper_reads_one_reference_whatever_a_year_measured(self):
        # Measured on each finished year, the keeper's λ was 5 395 minutes for 2024/25 and 13 291 for 2025/26,
        # and 2024/25 had 36 keepers in its first 100 players. It is a setting now: a measure kept by a run
        # from before the correction is neither read nor written again.
        prevented = 0.2 * 3000 / 90
        now = {(1, GK, 1): cell(3000.0, keeper=prevented), (2, GK, 2): cell(3000.0, keeper=0.0)}
        people = {1: person(team=1), 2: person(team=2)}
        plain = level.levels(now, {}, references(), people)
        earlier = level.levels(now, {}, {**references(), "keeper": (5395.0, 0.099)}, people)
        self.assertAlmostEqual(earlier[1]["positions"][GK]["value"], level.GOAL * 0.2 * 3000 / (3000 + 13291.0))
        self.assertEqual(earlier[1]["positions"][GK]["value"], plain[1]["positions"][GK]["value"])
        self.assertEqual(level.SETTINGS["keeper_lambda"], 13291.0)
        kept = level.pack(references())
        self.assertNotIn("keeper", kept)
        self.assertNotIn("keeper", level.unpack({**kept, "keeper": [5395.0, 0.099]}))


    def test_54b_a_keeper_is_measured_when_goals_prevented_cover_half_his_year_in_goal(self):
        # Goals prevented are missing before 2024/25 and for one keeper in three since: without them a keeper's
        # value is 0. The flag reads the year's minutes in goal alone, clubs added, and changes no number.
        now = {(1, GK, 1): keeper_cell(3000.0, 3000.0, 6.0), (2, GK, 2): keeper_cell(3000.0, 1500.0, 2.0),
               (3, GK, 3): keeper_cell(3000.0, 1499.0, 2.0), (4, GK, 4): keeper_cell(3000.0, 0.0),
               (5, GK, 5): keeper_cell(3000.0, 1499.0, 2.0),
               (6, GK, 6): keeper_cell(1000.0, 1000.0, 1.0), (6, GK, 7): keeper_cell(2000.0, 499.0, 1.0),  # two clubs: 1 499 of 3 000
               (7, CB, 1): cell(3000.0)}
        before = {(5, GK, 5): keeper_cell(3000.0, 3000.0, 4.0)}  # the year before, whole: it does not decide
        people = {p: person(team=p) for p in range(1, 8)}
        out = level.levels(now, before, references(), people)
        self.assertEqual(level.KEEPER_MEASURED_SHARE, 0.5)
        self.assertEqual([out[p]["measured"] for p in range(1, 8)], [True, True, False, False, False, False, True])
        keepers = range(1, 7)
        self.assertAlmostEqual(out[4]["positions"][GK]["value"], 0.0)
        self.assertAlmostEqual(out[3]["positions"][GK]["value"], level.GOAL * 90 * 2.0 / (1499 + 13291.0))
        self.assertAlmostEqual(out[5]["positions"][GK]["value"], level.GOAL * 90 * (2.0 + 0.5 * 4.0) / (1499 + 0.5 * 3000 + 13291.0))
        # The keepers' centre is the mean of all six, measured or not: their blocks add up to nothing.
        self.assertAlmostEqual(sum(out[p]["blocks"] for p in keepers), 0.0)
        self.assertEqual(sorted(out[p]["position_rank"] for p in keepers), list(range(1, 7)))
        self.assertTrue(all(0 <= out[p]["score"] <= 100 and out[p]["rank"] >= 1 for p in out))

    def test_54c_the_full_backs_centre_is_their_mean_and_their_offset(self):
        # Players judged at two positions are valued 1.05 higher against the full-backs than against the
        # players of their other positions: the full-backs' mean is that much too low a centre (men).
        self.assertEqual(level.POSITION_OFFSETS, {"men": {FB: -1.05}})
        refs = references(lam=0.0)  # no noise: the talent is the rate
        sums = [0.0] * NB
        sums[1] = 2.0 * 1800 / 90  # + 2 sd of creation
        now = {(1, FB, 1): cell(1800.0, sums), (2, FB, 1): cell(1800.0), (3, CB, 1): cell(1800.0, sums), (4, CB, 1): cell(1800.0)}
        out = level.levels(now, {}, refs, {p: person() for p in (1, 2, 3, 4)})
        wide = level.E * power.WEIGHTS["full_back"]["creation"] * 2.0
        central = level.E * power.WEIGHTS["centre_back"]["creation"] * 2.0
        self.assertAlmostEqual(out[1]["positions"][FB]["value"], wide)  # the value itself is unchanged
        self.assertEqual([round(out[p]["blocks"], 6) for p in (1, 2, 3, 4)],
                         [round(wide / 2 - 1.05, 6), round(-wide / 2 - 1.05, 6), round(central / 2, 6), round(-central / 2, 6)])
        # A full-back at his position's mean is 1.05 under a centre-back at his: blocks, own level, level, and level at the position.
        mean = level.levels({(1, FB, 1): cell(1800.0), (2, FB, 1): cell(1800.0), (3, CB, 1): cell(1800.0), (4, CB, 1): cell(1800.0)},
                            {}, refs, {p: person() for p in (1, 2, 3, 4)})
        for key in ("blocks", "own", "level"):
            self.assertAlmostEqual(mean[1][key] - mean[3][key], -1.05)
        self.assertAlmostEqual(mean[1]["positions"][FB]["level"] - mean[3]["positions"][CB]["level"], -1.05)
        for r in list(out.values()) + list(mean.values()):
            self.assertAlmostEqual(r["level"], r["blocks"] + r["starts"] + r["club"])
            self.assertAlmostEqual(r["own"], r["blocks"] + r["starts"])
            self.assertTrue(r["measured"])

    def test_54d_the_offset_follows_the_share_of_the_minutes_at_full_back(self):
        now = {(1, CB, 1): cell(1080.0), (1, FB, 1): cell(720.0), (2, CB, 1): cell(1800.0), (3, FB, 1): cell(1800.0)}
        out = level.levels(now, {}, references(), {p: person() for p in (1, 2, 3)})
        self.assertEqual(out[1]["position"], CB)
        self.assertAlmostEqual(out[1]["positions"][FB]["share"], 0.4)
        self.assertAlmostEqual(out[1]["blocks"], 0.4 * -1.05)
        self.assertAlmostEqual(out[1]["positions"][FB]["level"], -1.05 + out[1]["starts"] + out[1]["club"])
        self.assertAlmostEqual(out[1]["positions"][CB]["level"], out[1]["starts"] + out[1]["club"])
        self.assertAlmostEqual(out[2]["blocks"], 0.0)
        self.assertAlmostEqual(out[3]["blocks"], -1.05)

    def test_54e_the_offset_is_the_mens_universe_s(self):
        # Measured on the men's reference players; the women's universe keeps its positions' means.
        now = {(p, FB if p % 2 else CB, 1): cell(1800.0) for p in range(1, 9)}
        people = {p: person(universe="men" if p <= 4 else "women") for p in range(1, 9)}
        out = level.levels(now, {}, references(), people)
        self.assertEqual([round(out[p]["blocks"], 6) for p in range(1, 9)], [-1.05, 0.0, -1.05, 0.0, 0.0, 0.0, 0.0, 0.0])
        men = level.levels({key: c for key, c in now.items() if key[0] <= 4}, {}, references(), {p: people[p] for p in range(1, 5)})
        self.assertEqual({p: (r["level"], r["score"], r["rank"]) for p, r in men.items()}, {p: (out[p]["level"], out[p]["score"], out[p]["rank"]) for p in men})

    def test_54f_full_backs_alone_keep_their_order_and_their_scores(self):
        now = {(p, FB, p): cell(1800.0) for p in (1, 2, 3)}
        out = level.levels(now, {}, references(), {1: person(club=1.0, team=1), 2: person(club=0.0, team=2), 3: person(club=-1.0, team=3)})
        self.assertEqual([round(out[p]["blocks"], 6) for p in (1, 2, 3)], [-1.05] * 3)
        self.assertEqual([out[p]["rank"] for p in (1, 2, 3)], [1, 2, 3])
        self.assertAlmostEqual(out[2]["score"], 50.0)  # the median moves with them
        self.assertAlmostEqual(out[1]["score"], 100 / (1 + 10 ** (-10.0 / 36)))

    def test_54g_the_version_and_the_settings_of_the_v9_1(self):
        self.assertEqual(level.LEVEL_VERSION, "score-vega-v9.1")
        self.assertEqual((level.SETTINGS["keeper_lambda"], level.SETTINGS["keeper_measured_share"]), (13291.0, 0.5))
        self.assertEqual(level.SETTINGS["position_offsets"], {"men": {"full_back": -1.05}})
        # As the base keeps and compares them (agg.level_runs.settings, stale).
        self.assertEqual(json.loads(json.dumps(level.SETTINGS)), level.SETTINGS)


if __name__ == "__main__":
    unittest.main()
