"""« Composition probable »: our probable eleven before the provider's line-ups (FAILURE_MODES.md §61, 61a–61m,
61u–61ad and 61ae–61an, written before these tests).

probable-v1 is the study's P5 (`etude_onze_probable.py`, `guess()` and the absence rule « B connue »): its self-test's
cases are ported in GuessTest, and its outputs before probable-v2 are frozen in V1FrozenTest. probable-v2 is the study
v4's H1 (`v4/etude_onze_melange.py`: P11 for a club of the five leagues, P1a elsewhere): its self-test's cases are ported
in ScoreTest, SimilarityTest and RouteTest. The worker's step (`probable.refresh`) runs on a disposable local PostgreSQL
(VEGA_V2_PROBABLE_TEST_DSN, database vega_v2_probable_test) under the calculation role (vega_calc), as the side process
runs it.
"""

from datetime import date, datetime, timedelta, timezone
from math import exp
import os
from pathlib import Path
import sys
import unittest
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))

from prerequisites import required  # noqa: E402
from template_base import fresh  # noqa: E402

try:
    import psycopg
except ImportError:
    psycopg = None

DSN = os.environ.get("VEGA_V2_PROBABLE_TEST_DSN")


def probable():
    from vega import probable as module

    return module


# The study's self-test world (etude_onze_probable.py, selftest()): 1 and 20 keepers, 2–6 centre backs, 7–11 central
# midfielders, 12–14 centre forwards.
ROLE = {1: "goalkeeper", 20: "goalkeeper", **{p: "centre_back" for p in range(2, 7)}, **{p: "central_midfielder" for p in range(7, 12)},
        **{p: "centre_forward" for p in range(12, 15)}}
A442 = (1, 2, 3, 4, 5, 7, 8, 9, 10, 12, 13)
B352 = (1, 2, 3, 4, 7, 8, 9, 10, 11, 12, 13)


def mr(p):
    return ROLE.get(p)


def ent(k, starters, bench=()):
    return (date(2026, 9, 1) + timedelta(days=7 * k), tuple(starters), {p: ROLE.get(p) for p in (*starters, *bench)}, frozenset((*starters, *bench)))


def ids(xi):
    return sorted(p for p, _ in xi)


class GuessTest(unittest.TestCase):
    """61a: the study's cases, to the player."""

    def setUp(self):
        self.p = probable()
        # Four 4-4-2 then three 3-5-2 (the most recent last).
        self.hist = [ent(k, A442) for k in range(4)] + [ent(k, B352) for k in range(4, 7)]
        self.w = self.p.weights(len(self.hist))

    def test_61a_weights_and_method(self):
        # 61.4: the worker writes probable-v3; probable-v1 and probable-v2 stay selectable.
        self.assertEqual(self.p.METHOD, "probable-v3")
        self.assertEqual(self.p.METHODS, ("probable-v1", "probable-v2", "probable-v3"))
        self.assertEqual((self.p.WINDOW, self.p.LONG, self.p.MIN_RECENT, self.p.DECAY), (10, 30, 5, 0.8))
        self.assertEqual(self.p.weights(3), [0.8 ** 2, 0.8, 1.0])
        # The one place a window's weights are computed (hugo, 25 Nov: a later method may weigh each eleven otherwise).
        self.assertEqual(self.p.window_weights("probable-v1", self.hist, None), self.w)
        with self.assertRaises(ValueError):
            self.p.window_weights("probable-v0", self.hist, None)
        with self.assertRaises(ValueError):
            self.p.predict([], None, mr, {}, set(), method="probable-v0")

    def test_61a_the_weighted_split_wins(self):
        # P4: weights 2.44 (3-5-2) against 1.51 (4-4-2): the 3-5-2 and its players.
        xi, rep = self.p.guess(self.hist, self.w, mr)
        self.assertEqual(ids(xi), sorted(B352))
        self.assertEqual(rep, [])
        # Unweighted (P3): the 4-4-2.
        self.assertEqual(ids(self.p.guess(self.hist, [1.0] * 7, mr)[0]), sorted(A442))

    def test_61a_an_absent_is_replaced_in_his_line(self):
        xi, rep = self.p.guess(self.hist, self.w, mr, {3})
        self.assertEqual(ids(xi), sorted(set(B352) - {3} | {5}))
        self.assertEqual(rep, [(3, "D", 5)])

    def test_61a_no_outfield_player_in_goal(self):
        xi, rep = self.p.guess(self.hist, self.w, mr, {1})
        self.assertEqual(len(xi), 10)
        self.assertEqual(rep, [(1, "G", None)])

    def test_61a_all_midfielders_out(self):
        xi, rep = self.p.guess(self.hist, self.w, mr, {11, 7, 8, 9, 10})
        self.assertEqual([q for _, _, q in rep], [5, None, None, None, None])
        self.assertIn((5, "M"), xi)

    def test_61a_ties(self):
        p = self.p
        # Same starts: the one who also came on (5) wins.
        tie = [ent(0, (1, 2, 3, 4, 5, 7, 8, 9, 10, 12, 13)), ent(1, (1, 2, 3, 4, 6, 7, 8, 9, 10, 12, 13), bench=(5,))]
        g = ids(p.guess(tie, [1.0, 1.0], mr)[0])
        self.assertTrue(5 in g and 6 not in g, g)
        # Same starts and appearances: the most recent (6).
        tie2 = [ent(0, (1, 2, 3, 4, 5, 7, 8, 9, 10, 12, 13)), ent(1, (1, 2, 3, 4, 6, 7, 8, 9, 10, 12, 13))]
        g = ids(p.guess(tie2, [1.0, 1.0], mr)[0])
        self.assertTrue(6 in g and 5 not in g, g)
        # Everything level: the smallest id (5).
        tie3 = tie2 + [ent(2, (1, 2, 3, 4, 7, 8, 9, 10, 11, 12, 13), bench=(5, 6))]
        g = ids(p.guess(tie3, [1.0] * 3, mr)[0])
        self.assertTrue(5 in g and 6 not in g, g)
        # Two splits of the same weight: the most recent.
        self.assertEqual(ids(p.guess([ent(0, A442), ent(1, B352)], [1.0, 1.0], mr)[0]), sorted(B352))


# The elevens of V1FrozenTest: each starter at a fixed place of his role.
def spot(p):
    role = ROLE2[p]
    if role == "goalkeeper":
        return (11, 0.1, 0.5)
    if role == "centre_back":
        return (30 + p, 0.35, round(0.1 + 0.18 * (p - 2), 2))
    if role == "central_midfielder":
        return (70 + p, 0.6, round(0.1 + 0.18 * (p - 7), 2))
    return (100 + p, 0.85, round(0.2 + 0.3 * (p - 12), 2))


# The study v4's self-test world (etude_onze_melange.py, selftest()): 15 is a centre forward too.
ROLE2 = {**ROLE, 15: "centre_forward"}
V442 = (1, 2, 3, 4, 6, 7, 8, 9, 10, 12, 13)
X442 = (1, 2, 3, 4, 5, 7, 8, 9, 10, 12, 14)
INJURY = {"kind": "injury", "label": "Knee injury", "start": date(2026, 11, 10), "end": None, "remaining": None}


def mr2(p):
    return ROLE2.get(p)


def entry(k, starters, bench=(), unused=(), ctype="L", elo=1500.0, formation="4-4-2", spots=False):
    """An eleven of the study v4's self-test (its `ent`): the starters, the substitutes who came on (`bench`), the others
    on the sheet who did not (`unused`), the competition type and the opponent's Elo."""
    came = (*starters, *bench)
    return probable().Entry(
        day=date(2026, 9, 6) + timedelta(days=7 * k), starters=tuple(starters), roles={p: ROLE2.get(p) for p in came},
        came=frozenset(came), match_id=5000 + k, competition_id=30, opponent_id=3, formation=formation,
        spots={p: spot(p) for p in starters} if spots else {}, shirts={p: p for p in (*came, *unused)},
        sheet=frozenset((*came, *unused)), ctype=ctype, opp_elo=elo)


def target(five=False, ctype="L", elo=1500.0):
    return probable().Target(match_id=7000, season_id=2026, day=date(2026, 12, 1), team_id=1, opponent_id=2, side="home",
                             competition_id=30, ctype=ctype, opp_elo=elo, five=five)


def xi_of(result):
    return sorted(p for p, *_ in result["starters"])


class V1FrozenTest(unittest.TestCase):
    """61aa: probable-v1 selected after probable-v2 gives what main gave before it (c83c53e, run on this window)."""

    def test_61aa_probable_v1_unchanged(self):
        p = probable()
        window = ([entry(k, A442, bench=(6, 11), spots=True) for k in range(3)]
                  + [entry(k, B352, bench=(5, 14), formation="3-5-2", spots=True) for k in range(3, 7)]
                  + [entry(k, V442[:-1] + (14,), bench=(13,), spots=True) for k in range(7, 10)])
        run = lambda absent, gone: p.predict(window, None, mr2, absent, gone, method="probable-v1")
        r = run({}, set())
        self.assertEqual(r["formation"], "4-4-2")
        self.assertEqual(r["starters"], [
            (1, 11, 0.1, 0.5, 1.0, None), (2, 32, 0.35, 0.1, 1.0, None), (3, 33, 0.35, 0.28, 1.0, None), (4, 34, 0.35, 0.46, 1.0, None),
            (6, 36, 0.35, 0.82, 0.3, None), (7, 77, 0.6, 0.1, 1.0, None), (8, 78, 0.6, 0.28, 1.0, None), (9, 79, 0.6, 0.46, 1.0, None),
            (10, 80, 0.6, 0.64, 1.0, None), (12, 112, 0.85, 0.2, 1.0, None), (14, 114, 0.85, 0.8, 0.3, None)])
        r = run({3: INJURY}, {12})
        self.assertEqual(r["starters"], [
            (1, 11, 0.1, 0.5, 1.0, None), (2, 32, 0.35, 0.1, 1.0, None), (5, 33, 0.35, 0.28, 0.3, 3), (4, 34, 0.35, 0.46, 1.0, None),
            (6, 36, 0.35, 0.82, 0.3, None), (7, 77, 0.6, 0.1, 1.0, None), (8, 78, 0.6, 0.28, 1.0, None), (9, 79, 0.6, 0.46, 1.0, None),
            (10, 80, 0.6, 0.64, 1.0, None), (13, 112, 0.85, 0.2, 0.7, None), (14, 114, 0.85, 0.8, 0.3, None)])
        self.assertEqual([q for q, _ in r["absent"]], [3])
        r = run({1: INJURY}, set())
        self.assertEqual(xi_of(r), [2, 3, 4, 6, 7, 8, 9, 10, 12, 14])
        r = run({7: INJURY, 8: INJURY}, {14})
        self.assertEqual(r["starters"], [
            (1, 11, 0.1, 0.5, 1.0, None), (2, 32, 0.35, 0.1, 1.0, None), (3, 33, 0.35, 0.28, 1.0, None), (4, 34, 0.35, 0.46, 1.0, None),
            (6, 36, 0.35, 0.82, 0.3, None), (11, 77, 0.6, 0.1, 0.4, 7), (13, 78, 0.6, 0.28, 0.7, 8), (9, 79, 0.6, 0.46, 1.0, None),
            (10, 80, 0.6, 0.64, 1.0, None), (12, 112, 0.85, 0.2, 1.0, None), (5, 114, 0.85, 0.8, 0.3, None)])
        self.assertEqual([q for q, _ in r["absent"]], [7, 8])


class ScoreTest(unittest.TestCase):
    """61x, 61y: P10's score (the study v3 and v4): a match counts for a player only if he was on its sheet."""

    def test_61y_prior_and_a_by_hand(self):
        p = probable()
        self.assertEqual((p.PULL, p.PRIOR), (2.0, 0.6))
        e0, e1, e2 = entry(0, A442, unused=(14,)), entry(1, X442, unused=(15,)), entry(2, A442)
        # Two elevens with a substitute (sheets of 12): prior 11 × 1.8 / (12 × 1.8) = 11/12.
        started, listed, prior = p.availability([e0, e1], [0.8, 1.0])
        self.assertAlmostEqual(prior, 11 / 12, places=12)
        self.assertEqual((started[13], listed[13], started[14]), (0.8, 0.8, 1.0))
        self.assertAlmostEqual(listed[14], 1.8, places=12)
        self.assertEqual((started[15], listed[15]), (0, 1.0))
        # An eleven without substitute: it counts for its 11 starters only, and not in the prior.
        started, listed, prior = p.availability([e0, e1, e2], p.weights(3))
        self.assertAlmostEqual(prior, 11 / 12, places=12)
        self.assertAlmostEqual(listed[14], 1.44, places=12)
        self.assertAlmostEqual(listed[13], 1.64, places=12)
        self.assertAlmostEqual(listed[15], 0.8, places=12)
        s = p.scores([e0, e1, e2], p.weights(3))
        self.assertAlmostEqual(s[15], 2 * prior / 2.8, places=12)
        self.assertAlmostEqual(s[14], (0.8 + 2 * prior) / 3.44, places=12)
        self.assertAlmostEqual(s[13], (1.64 + 2 * prior) / 3.64, places=12)
        # No substitute anywhere: the prior is 0.6.
        self.assertEqual(p.availability([e2, entry(3, B352)], [0.8, 1.0])[2], 0.6)

    def test_61x_a_starter_back_from_injury_is_not_penalised(self):
        # The Dembélé case: 13 started the first six, then was off the sheet (injured) for four, where 14 started.
        p = probable()
        back = [entry(k, A442, unused=(14, 15, 6, 11, 20)) for k in range(6)] + [entry(k, X442, unused=(15, 6, 11, 20)) for k in range(6, 10)]
        bench = back[:6] + [entry(k, X442, unused=(13, 15, 6, 11, 20)) for k in range(6, 10)]  # on the bench instead
        w = p.weights(10)
        off, on_bench = p.scores(back, w), p.scores(bench, w)
        first, last = sum(w[:6]), sum(w[6:])
        prior = 11 * sum(w) / (16 * first + 15 * last)
        self.assertAlmostEqual(off[13], (first + 2 * prior) / (first + 2), places=12)  # his missed matches do not count
        self.assertAlmostEqual(off[14], (last + 2 * prior) / (sum(w) + 2), places=12)
        self.assertGreater(off[13], off[14])
        self.assertLess(on_bench[13], off[13])  # on the bench, unused: those matches count against him
        # P11 (a club of the five leagues) takes him back; probable-v1 keeps 14; so does P1a (the latest eleven).
        self.assertIn(13, xi_of(p.predict(back, target(five=True), mr2, {}, set(), method="probable-v2")))
        self.assertNotIn(14, xi_of(p.predict(back, target(five=True), mr2, {}, set(), method="probable-v2")))
        self.assertEqual(xi_of(p.predict(back, target(five=False), mr2, {}, set(), method="probable-v2")), sorted(X442))
        self.assertEqual(xi_of(p.predict(back, target(five=True), mr2, {}, set(), method="probable-v1")), sorted(X442))


class SimilarityTest(unittest.TestCase):
    """61z: P7's weights (s 400, λ 0.3, W 10), as the study v4 froze them."""

    def test_61z_similarity_by_hand(self):
        p = probable()
        self.assertEqual((p.SIMILARITY, p.OTHER_KIND, p.MISSING_GAP), (400.0, 0.3, 150.0))
        es = [entry(0, A442, ctype="E", elo=1800.0), entry(1, A442, ctype="L", elo=None), entry(2, A442, ctype="L", elo=1600.0)]
        got = p.similarity_weights(es, target(ctype="L", elo=1600.0))
        want = [0.64 * exp(-200 / 400) * 0.3, 0.8 * exp(-150 / 400), 1.0]
        for a, b in zip(got, want):
            self.assertAlmostEqual(a, b, places=12)
        # A European match: the league elevens weigh 0.3 more; then all divided by the largest.
        got = p.similarity_weights(es, target(ctype="E", elo=1800.0))
        raw = [0.64, 0.8 * exp(-150 / 400) * 0.3, exp(-200 / 400) * 0.3]
        for a, b in zip(got, [x / max(raw) for x in raw]):
            self.assertAlmostEqual(a, b, places=12)
        self.assertEqual(max(got), 1.0)
        # The match's type and opponent's Elo unknown: one factor for all, divided out (the weights of v1).
        for a, b in zip(p.similarity_weights(es, target(ctype=None, elo=None)), p.weights(3)):
            self.assertAlmostEqual(a, b, places=12)
        # The one place a window's weights are computed.
        t = target(ctype="L", elo=1600.0)
        self.assertEqual(p.window_weights("probable-v2", es, t), p.similarity_weights(es, t))
        self.assertEqual(p.window_weights("probable-v1", es, t), p.weights(3))


class RouteTest(unittest.TestCase):
    """61u, 61w: H1 sends a club of the five leagues to P11, any other to P1a (the latest eleven less the removed)."""

    def setUp(self):
        self.p = probable()
        # The study's h5: 5 started the first six (off the sheet after), 6 the next three; 14 on every bench, 15 on the last.
        self.h5 = ([entry(k, A442, bench=(14,), unused=(6,)) for k in range(6)] + [entry(k, V442, bench=(14,), unused=(20,)) for k in range(6, 9)]
                   + [entry(9, B352, bench=(14, 15), unused=(6, 20))])

    def test_61u_the_route(self):
        p = self.p
        back = [entry(k, A442, unused=(14, 15, 6, 11, 20)) for k in range(6)] + [entry(k, X442, unused=(15, 6, 11, 20)) for k in range(6, 10)]
        five, other = p.predict(back, target(five=True), mr2, {}, set(), method="probable-v2"), p.predict(back, target(five=False), mr2, {}, set(), method="probable-v2")
        self.assertEqual(xi_of(five), sorted(A442))  # P11: 13 back
        self.assertEqual(xi_of(other), sorted(X442))  # P1a: the latest eleven
        # share: the score (P11's) of each starter, either way.
        s = p.scores(back, p.window_weights("probable-v2", back, target()))
        for r in (five, other):
            for q, _, _, _, share, _ in r["starters"]:
                self.assertAlmostEqual(share, s[q], places=12)

    def test_61w_p1a_replaces_by_the_best_score_of_his_line(self):
        p, h5 = self.p, self.h5
        r = p.predict(h5, target(), mr2, {3: INJURY}, set(), method="probable-v2")
        self.assertEqual(xi_of(r), sorted(set(B352) - {3} | {5}))
        self.assertEqual({q: rep for q, *_, rep in r["starters"]}[5], 3)
        self.assertEqual([q for q, _ in r["absent"]], [3])
        # v1's order (weighted starts first) would take 6.
        base = p.latest_eleven(h5, mr2)
        self.assertEqual(base, [(q, p.LINE[ROLE2[q]]) for q in B352])
        self.assertEqual(p.guess(h5, p.weights(10), mr2, {3}, None, base)[1], [(3, "D", 6)])
        # No centre back available: the best score of the outfield lines (15), not v1's order (14).
        r = p.predict(h5, target(), mr2, {3: INJURY, 5: INJURY, 6: INJURY}, set(), method="probable-v2")
        self.assertEqual({q: rep for q, *_, rep in r["starters"]}.get(15), 3)
        self.assertNotIn(14, xi_of(r))
        self.assertEqual(p.guess(h5, p.weights(10), mr2, {3, 5, 6}, None, base)[1], [(3, "D", 14)])

    def test_61w_a_keeper_only_by_a_keeper(self):
        p = self.p
        hist = [entry(k, A442) for k in range(4)] + [entry(k, B352) for k in range(4, 7)]
        r = p.predict(hist, target(), mr2, {1: INJURY}, set(), method="probable-v2")  # no other keeper: one short, 5 (on the sheets) not in goal
        self.assertEqual(xi_of(r), sorted(set(B352) - {1}))
        r = p.predict(hist[:-1] + [entry(6, B352, bench=(20,))], target(), mr2, {1: INJURY}, set(), method="probable-v2")  # 20 came on once
        self.assertEqual(xi_of(r), sorted(set(B352) - {1} | {20}))
        self.assertEqual({q: rep for q, *_, rep in r["starters"]}[20], 1)
        # The same under P11.
        self.assertEqual(len(p.predict(hist, target(five=True), mr2, {1: INJURY}, set(), method="probable-v2")["starters"]), 10)

    def test_61w_a_gone_forward(self):
        p = self.p
        back = [entry(k, A442, unused=(14, 15, 6, 11, 20)) for k in range(6)] + [entry(k, X442, unused=(15, 6, 11, 20)) for k in range(6, 10)]
        r = p.predict(back, target(), mr2, {}, {12}, method="probable-v2")
        self.assertEqual(xi_of(r), sorted(set(X442) - {12} | {13}))
        self.assertIsNone({q: rep for q, *_, rep in r["starters"]}[13])  # gone: named by no one
        self.assertEqual(r["absent"], [])

    def test_61w_p1a_keeps_the_latest_eleven_s_slots(self):
        p = self.p
        window = [entry(k, A442, bench=(6,), spots=True) for k in range(8)] + [entry(k, B352, bench=(5, 6), formation="3-5-2", spots=True) for k in range(8, 10)]
        # The 4-4-2 weighs more, but P1a draws the latest eleven (3-5-2) in its own slots; 5 (best score) takes 3's.
        r = p.predict(window, target(), mr2, {3: INJURY}, set(), method="probable-v2")
        self.assertEqual(r["formation"], "3-5-2")
        slots = {q: (pos, x, y) for q, pos, x, y, _, _ in r["starters"]}
        self.assertEqual(slots[5], spot(3))
        for q in set(B352) - {3}:
            self.assertEqual(slots[q], spot(q))
        # P11 takes the 4-4-2 of greatest weight.
        self.assertEqual(p.predict(window, target(five=True), mr2, {}, set(), method="probable-v2")["formation"], "4-4-2")


# probable-v3 (FAILURE_MODES §61.4, the study v5.1's V51): a 4-3-3 in the provider's slots (power.role_of with top 107).
POS433 = ((11, 0.1, 0.5), (32, 0.3, 0.88), (34, 0.3, 0.63), (36, 0.3, 0.38), (38, 0.3, 0.13), (73, 0.6, 0.79), (75, 0.6, 0.5),
          (77, 0.6, 0.21), (103, 0.87, 0.79), (105, 0.87, 0.5), (107, 0.87, 0.21))
# 1 and 15 keepers; 2, 5 full backs; 3, 4, 6 centre backs; 7–9 midfielders; 10, 12, 14 wingers (10 on the right, 12 and 14
# on the left); 11 and 13 centre forwards (13 never wide).
ROLE3 = {1: "goalkeeper", 15: "goalkeeper", 2: "full_back", 5: "full_back", 3: "centre_back", 4: "centre_back", 6: "centre_back",
         7: "central_midfielder", 8: "central_midfielder", 9: "central_midfielder", 10: "winger", 12: "winger", 14: "winger",
         11: "centre_forward", 13: "centre_forward", 16: "full_back"}
XI_A = (1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12)  # in POS433's order
XI_B = (1, 2, 3, 4, 5, 7, 8, 9, 10, 13, 12)  # 13 at centre forward
XI_C = (1, 2, 3, 4, 5, 7, 8, 9, 10, 13, 14)  # and 14 on the left wing


def mr3(p):
    return ROLE3.get(p)


def e433(k, xi, bench=(), unused=(), spots=True):
    came = (*xi, *bench)
    return probable().Entry(
        day=date(2026, 9, 6) + timedelta(days=7 * k), starters=tuple(xi), roles={p: ROLE3.get(p) for p in came}, came=frozenset(came),
        match_id=6000 + k, competition_id=30, opponent_id=3, formation="4-3-3",
        spots={p: POS433[i] for i, p in enumerate(xi)} if spots else {}, shirts={p: p for p in (*came, *unused)},
        sheet=frozenset((*came, *unused)), ctype="L", opp_elo=1500.0)


def psg_window(spots=True, keeper_on=False):
    """The PSG – Roma case (61ae): 12 (left winger) started nine of ten; 13 (centre forward) three, at centre forward; 14 (left
    winger) once, on the left; 6 and 15 on the sheet, never on the pitch (15 on once when keeper_on)."""
    w = [e433(k, XI_A, (13,), (14, 6, 15), spots) for k in range(6)] + [e433(k, XI_B, (11,), (14, 6, 15), spots) for k in (6, 7)]
    w += [e433(8, XI_C, (11, 12), (6, 15), spots), e433(9, XI_A, (13, 15) if keeper_on else (13,), (14, 6) if keeper_on else (14, 6, 15), spots)]
    return w


def slots_of(result):
    return {p: pos for p, pos, *_ in result["starters"]}


class V3Test(unittest.TestCase):
    """61ae–61am: probable-v3 in the clubs of the five leagues; v2 elsewhere and wherever v3 cannot fill the slots."""

    def setUp(self):
        self.p = probable()
        self.win = psg_window()

    def v(self, method, window=None, absent=None, gone=(), five=True, **kw):
        return self.p.predict(window or self.win, target(five=five), mr3, absent or {}, set(gone), method=method, **kw)

    def test_61aj_labels_by_hand(self):
        p = self.p
        f532 = {1: (11, .1, .5), 2: (51, .37, .89), 3: (33, .36, .7), 4: (35, .36, .5), 5: (37, .36, .31), 6: (59, .37, .11),
                7: (73, .61, .79), 8: (75, .61, .5), 9: (77, .61, .21), 10: (104, .87, .7), 11: (106, .87, .3)}
        lb = p.labels("5-3-2", f532)
        self.assertEqual((lb[1], lb[6], lb[5], lb[4], lb[3], lb[2], lb[9], lb[8], lb[7], lb[10], lb[11]),
                         (("G", "C"), ("D", "L"), ("D", "C"), ("D", "C"), ("D", "C"), ("D", "R"), ("M", "L"), ("M", "C"), ("M", "R"), ("A", "C"), ("A", "C")))
        f4231 = {1: (11, .1, .5), 2: (32, .29, .88), 3: (34, .29, .63), 4: (36, .29, .38), 5: (38, .29, .13), 6: (64, .49, .7), 7: (66, .49, .3),
                 8: (83, .68, .84), 9: (85, .68, .5), 10: (87, .68, .16), 11: (115, .87, .5)}
        lc = p.labels("4-2-3-1", f4231)
        self.assertEqual((lc[5], lc[6], lc[7], lc[10], lc[9], lc[11], lc[8]), (("D", "L"), ("M", "C"), ("M", "C"), ("A", "L"), ("A", "C"), ("A", "C"), ("A", "R")))
        self.assertNotIn(4, p.labels("5-3-2", {**f532, 4: (35, .36, None)}))  # no pitch_y: no label
        self.assertNotIn(1, p.labels("5-3-2", {**f532, 1: (None, .1, .5)}))  # no slot: no label
        self.assertEqual(p.labels("4-3-3", {}), {})

    def test_61aj_role_shares_and_fit_by_hand(self):
        p, win = self.p, self.win
        sh = p.role_shares(win, mr3)
        # Wingers: 20 labelled starts (10 on the right ten times, 12 on the left nine, 14 once): A-L half of them.
        self.assertAlmostEqual(sh.label("winger", ("A", "L")), 0.5, places=12)
        self.assertAlmostEqual(sh.line("winger", "A"), 1.0, places=12)
        # Centre forwards: 10 labelled starts, under 20: the share of A-L among every labelled start (10 of 110); no line share.
        self.assertAlmostEqual(sh.label("centre_forward", ("A", "L")), 10 / 110, places=12)
        self.assertEqual(sh.line("centre_forward", "A"), 0.0)
        self.assertAlmostEqual(sh.label(None, ("G", "C")), 10 / 110, places=12)  # no role: the all-starts share (« none » under 20)
        wts = p.window_weights("probable-v3", win, target(five=True))
        self.assertEqual(wts, p.similarity_weights(win, target(five=True)))
        counts = p.fit_counts(win, wts)
        self.assertAlmostEqual(p.fit(14, ("A", "L"), counts, sh, mr3), (wts[8] + 2 * 0.5) / (wts[8] + 2), places=12)
        n13 = wts[6] + wts[7] + wts[8]
        self.assertAlmostEqual(p.fit(13, ("A", "L"), counts, sh, mr3), (0 + 2 * 10 / 110) / (n13 + 2), places=12)
        self.assertAlmostEqual(p.fit(13, ("A", "C"), counts, sh, mr3), (n13 + 2 * sh.label("centre_forward", ("A", "C"))) / (n13 + 2), places=12)
        self.assertAlmostEqual(p.fit(15, ("G", "C"), counts, sh, mr3), sh.label("goalkeeper", ("G", "C")), places=12)  # never started: the share

    def test_61ae_the_left_winger_takes_the_left_wing(self):
        absent = {12: INJURY}
        v2, v3 = self.v("probable-v2", absent=absent), self.v("probable-v3", absent=absent)
        # v2 (P11): the best attacking score (13, a centre forward) in the absent left winger's slot.
        self.assertEqual(slots_of(v2)[13], 107)
        self.assertNotIn(14, slots_of(v2))
        # v3: 14, a left winger, on the left; 11 at centre forward, 10 on the right; 13 out.
        got = slots_of(v3)
        self.assertEqual((got[14], got[11], got[10]), (107, 105, 103))
        self.assertNotIn(13, got)
        self.assertEqual(len(got), 11)
        s = self.p.scores(self.win, self.p.window_weights("probable-v3", self.win, target(five=True)))
        self.assertTrue(all(abs(share - s[q]) < 1e-12 for q, *_, share, _ in v3["starters"]))  # share: the score
        self.assertEqual([q for q, _ in v3["absent"]], [12])

    def test_61al_whom_each_replaces(self):
        rep = {q: r for q, *_, r in self.v("probable-v3", absent={12: INJURY})["starters"]}
        self.assertEqual(rep[14], 12)
        self.assertTrue(all(r is None for q, r in rep.items() if q != 14))
        gone = self.v("probable-v3", gone={12})
        self.assertEqual(slots_of(gone)[14], 107)
        self.assertTrue(all(r is None for *_, r in gone["starters"]))
        self.assertEqual(gone["absent"], [])

    def permitted_everywhere(self, result, history=None):
        p, win = self.p, self.win
        ok = p.permitted(history or win, mr3, p.role_shares(history or win, mr3))
        line = {pos: ln for (pos, _, _), ln in zip(POS433, "GDDDDMMMAAA")}
        for q, pos, *_ in result["starters"]:
            self.assertIn(line[pos], ok(q), q)
            self.assertEqual(line[pos] == "G", ROLE3[q] == "goalkeeper", q)

    def test_61af_61ah_only_in_permitted_lines_and_keepers_in_goal(self):
        for absent in ({12: INJURY}, {12: INJURY, 14: INJURY}, {10: INJURY, 12: INJURY}):
            with self.subTest(absent=sorted(absent)):
                self.permitted_everywhere(self.v("probable-v3", absent=absent))
        # Two midfielders, or a full back, out: no assignment within the permitted lines (6 never came on): v2's (61ai).
        for absent in ({7: INJURY, 8: INJURY}, {2: INJURY}):
            with self.subTest(absent=sorted(absent)):
                self.assertEqual(self.v("probable-v3", absent=absent), self.v("probable-v2", absent=absent))
        # A full back who started in midfield only in the history's older elevens (beyond the window) may play there.
        p, old = self.p, [e433(k - 20, (1, 2, 3, 4, 6, 7, 8, 5, 10, 11, 12), (13,), (14, 15)) for k in range(3)]
        history = old + self.win
        self.assertEqual(p.permitted(self.win, mr3, p.role_shares(self.win, mr3))(5), {"D"})
        self.assertEqual(p.permitted(history, mr3, p.role_shares(history, mr3))(5), {"D", "M"})
        # 16 (a full back) on from the bench every match, 7 out: 8 and 9 the only midfielders of the window.
        win = [e._replace(came=e.came | {16}, sheet=e.sheet | {16}, roles={**e.roles, 16: ROLE3[16]}) for e in self.win]
        alone = self.v("probable-v3", window=win, absent={7: INJURY})
        self.assertEqual(alone, self.v("probable-v2", window=win, absent={7: INJURY}))
        r = self.v("probable-v3", window=win, absent={7: INJURY}, history=old + win)
        self.assertNotEqual(r, alone)
        self.permitted_everywhere(r, old + win)
        line = {pos: ln for (pos, _, _), ln in zip(POS433, "GDDDDMMMAAA")}
        mid = {q for q, pos, *_ in r["starters"] if line[pos] == "M"}
        self.assertEqual(len(mid), 3)
        self.assertLessEqual({8, 9}, mid)
        self.assertEqual(len(mid & {5, 16}), 1)

    def test_61ag_few_starts_take_their_role_s_lines(self):
        p = self.p
        # 25 elevens where the wingers (10 right, 14 left) start: 10 in midfield (M-R, slot 73) five times, 14 on the left wing.
        els = [e433(k, (1, 2, 3, 4, 5, 10 if k < 5 else 7, 8, 9, 13 if k < 5 else 10, 11, 14)) for k in range(25)]
        sh = p.role_shares(els, lambda q: {**ROLE3, 60: "winger", 61: "attacking_midfielder"}.get(q))
        self.assertAlmostEqual(sh.line("winger", "M"), 5 / 50, places=12)
        ok = p.permitted(els, lambda q: {**ROLE3, 60: "winger", 61: "attacking_midfielder"}.get(q), sh)
        self.assertEqual(ok(60), {"A", "M"})  # a newcomer winger: his role's line, and midfield (10 % of the wingers' starts)
        self.assertEqual(ok(61), {"M"})  # a role under 20 labelled starts: his role's line only
        self.assertEqual(ok(14), {"A"})  # 25 labelled starts, all on the left wing
        self.assertEqual(ok(99), {"?"})  # no role, no start: nothing

    def test_61ai_no_assignment_within_the_permitted_lines_gives_v2(self):
        for absent in ({3: INJURY, 4: INJURY}, {1: INJURY}):  # 6 and 15 never came on: no centre back, no keeper in the pool
            with self.subTest(absent=sorted(absent)):
                self.assertEqual(self.v("probable-v3", absent=absent), self.v("probable-v2", absent=absent))
        # 15 on once: in goal under v3.
        win = psg_window(keeper_on=True)
        self.assertEqual(slots_of(self.v("probable-v3", window=win, absent={1: INJURY}))[15], 11)

    def test_61ak_v2_elsewhere_and_without_a_template(self):
        absent = {12: INJURY}
        self.assertEqual(self.v("probable-v3", absent=absent, five=False), self.v("probable-v2", absent=absent, five=False))
        bare = psg_window(spots=False)
        self.assertEqual(self.v("probable-v3", window=bare, absent=absent), self.v("probable-v2", window=bare, absent=absent))

    def test_61am_v1_and_v2_unchanged(self):
        # v2's eleven on this window, by v2's own rules (P11: 13 back in the attack, in 12's slot) and v1's.
        self.assertEqual(xi_of(self.v("probable-v2", absent={12: INJURY})), sorted(set(XI_A) - {12} | {13}))
        self.assertEqual(xi_of(self.v("probable-v1", absent={12: INJURY})), sorted(set(XI_A) - {12} | {13}))


class MigrationTest(unittest.TestCase):
    def test_61d_the_migration_is_the_last_reviewed_and_names_its_match_tables(self):
        from vega import open_matchday_restore

        files = sorted(p.name for p in (ROOT / "sql").glob("[0-9][0-9][0-9]_*.sql"))
        self.assertIn("176_match_probable_lineups.sql", files)  # 177 (GH137) came after it
        self.assertIn("176_match_probable_lineups.sql", open_matchday_restore.REVIEWED_SCHEMAS)
        self.assertLessEqual({"agg.match_probable_lineups", "agg.match_probable_lineup_players"}, open_matchday_restore.ADDED_DEPENDENCIES)
        text = "\n".join(line.split("--")[0] for line in (ROOT / "sql" / "176_match_probable_lineups.sql").read_text(encoding="utf-8").splitlines())
        # Display only: no statement names a forecast, line-up model or provider line-up table.
        for name in ("agg.match_forecasts", "agg.match_lineup_forecasts", "agg.lineup_usuals", "core.lineups", "core.lineup_players"):
            self.assertNotIn(name, text)


class AbsenceRuleTest(unittest.TestCase):
    """61e: the study's « B connue » (started before the day, no match for his club since); its end is not read."""

    def test_61e_injury_rule(self):
        p = probable()
        s = date(2026, 9, 1)
        ep = lambda start, end=None: {"start": start, "end": end, "kind": "injury", "label": "Knee injury"}
        # The study's self-test: on the start day no, after yes, played since no, without an episode no.
        self.assertIsNone(p.injury_absence([ep(s)], s - timedelta(days=4), s))
        self.assertEqual(p.injury_absence([ep(s)], s - timedelta(days=4), s + timedelta(days=30))["start"], s)
        self.assertIsNone(p.injury_absence([ep(s, s + timedelta(days=5))], s + timedelta(days=3), s + timedelta(days=10)))
        self.assertIsNone(p.injury_absence([], s, s + timedelta(days=10)))
        # Played on the start day itself: still out (last appearance <= start).
        self.assertIsNotNone(p.injury_absence([ep(s)], s, s + timedelta(days=3)))
        # Ended before the day, no appearance since: out (the end is not read).
        self.assertIsNotNone(p.injury_absence([ep(s, s + timedelta(days=2))], s - timedelta(days=1), s + timedelta(days=10)))
        # Two episodes: the latest that applies is the one shown.
        got = p.injury_absence([ep(s), ep(s + timedelta(days=5))], s - timedelta(days=1), s + timedelta(days=10))
        self.assertEqual(got["start"], s + timedelta(days=5))

    def test_61f_suspension_rule(self):
        p = probable()
        day, today = date(2026, 11, 28), date(2026, 11, 25)
        base = {"start": date(2026, 11, 22), "end": None, "competition_id": 30, "remaining": 1, "read_on": today - timedelta(days=3),
                "label": "Yellow card suspension"}
        self.assertTrue(p.suspension_applies(base, 30, day, today))
        self.assertFalse(p.suspension_applies(base, 31, day, today))  # another competition
        self.assertFalse(p.suspension_applies(base, None, day, today))  # the match's competition unknown
        self.assertFalse(p.suspension_applies(dict(base, competition_id=None), 30, day, today))  # not linked
        self.assertFalse(p.suspension_applies(dict(base, remaining=0), 30, day, today))
        self.assertTrue(p.suspension_applies(dict(base, remaining=None), 30, day, today))
        self.assertFalse(p.suspension_applies(dict(base, read_on=today - timedelta(days=50)), 30, day, today))  # empty end, stale read
        self.assertFalse(p.suspension_applies(dict(base, read_on=None), 30, day, today))
        self.assertTrue(p.suspension_applies(dict(base, end=day, read_on=None), 30, day, today))  # dated end on the day
        self.assertFalse(p.suspension_applies(dict(base, end=day - timedelta(days=1)), 30, day, today))
        self.assertFalse(p.suspension_applies(dict(base, start=day + timedelta(days=1)), 30, day, today))


# ---------------------------------------------------------------------------------------------- the worker's step

NOW = datetime(2026, 11, 25, 12, 0, tzinfo=timezone.utc)
L1, CUP = 30, 31
PSG, LORIENT, OPP, OPP2, FRANCE, MONACO, ITALY = 1, 2, 3, 4, 7, 8, 9
TARGET, LATER, NATIONAL, STALE, CUP_TIE = 900, 901, 902, 903, 904
# PSG's eleven: keeper 100; full backs 102, 105; centre backs 103, 104; midfielders 106–108; forwards 109–111.
# Bench: 101 (keeper), 112 (centre back), 113 (midfielder), 114 (forward, comes on every match).
SLOTS = {100: (11, 0.10, 0.50), 102: (32, 0.36, 0.88), 103: (34, 0.36, 0.63), 104: (36, 0.36, 0.38), 105: (38, 0.36, 0.13),
         106: (73, 0.61, 0.79), 107: (75, 0.61, 0.50), 108: (77, 0.61, 0.21), 109: (102, 0.86, 0.84), 110: (105, 0.86, 0.50),
         111: (108, 0.86, 0.16)}
BASE = tuple(SLOTS)
BENCH = (101, 112, 113, 114)
LINKS = {p: str(9000 + p) for p in (*BASE, *BENCH)}  # Transfermarkt keys of PSG's players
# PSG's finished matches, weekly to 22 Nov (1012); 1003 and 1008 cup ties where 112 starts for 103 (and 113 for 108 in 1008).
HISTORY = [(1000 + k, datetime(2026, 9, 6, 19, 0, tzinfo=timezone.utc) + timedelta(days=7 * (k - 1))) for k in range(1, 13)]


def eleven(match):
    xi = dict(SLOTS)
    if match in (1003, 1008):
        xi[112] = xi.pop(103)
    if match == 1008:
        xi[113] = xi.pop(108)
    return xi


@required(DSN and psycopg, "requires a disposable local probable line-ups DB (VEGA_V2_PROBABLE_TEST_DSN) and psycopg")
class RefreshBase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        target = urlparse(DSN)
        if target.hostname not in ("localhost", "127.0.0.1", "::1") or target.path != "/vega_v2_probable_test":
            raise RuntimeError("dedicated local probable line-ups DB required")
        cls.db = fresh(DSN)
        cls.seed()

    @classmethod
    def tearDownClass(cls):
        cls.db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        cls.db.close()

    @classmethod
    def seed(cls):
        x = cls.db.execute
        x("INSERT INTO core.countries(code) VALUES ('FRA') ON CONFLICT DO NOTHING")
        x("INSERT INTO core.seasons(id, label) VALUES (2025, '2025/2026'), (2026, '2026/2027') ON CONFLICT DO NOTHING")
        x("SELECT core.ensure_season_partitions(2025)")
        x("SELECT core.ensure_season_partitions(2026)")
        x(f"INSERT INTO core.competitions(id, name, country_code, kind) VALUES ({L1}, 'Ligue 1', 'FRA', 'league'), ({CUP}, 'Coupe de France', 'FRA', 'cup'), (32, 'Friendlies', NULL, 'international')")
        x(f"INSERT INTO core.competition_seasons(id, competition_id, season_id, native_label) VALUES ({L1}, {L1}, 2026, '2026/2027'), ({CUP}, {CUP}, 2026, '2026/2027'), (32, 32, 2026, '2026')")
        x(f"""INSERT INTO core.teams(id, name, country_code, is_national) VALUES ({PSG}, 'Paris Saint-Germain', 'FRA', false), ({LORIENT}, 'Lorient', 'FRA', NULL),
              ({OPP}, 'Stade Nord', 'FRA', false), ({OPP2}, 'Union Sud', 'FRA', false), ({FRANCE}, 'France', 'FRA', true), ({MONACO}, 'Monaco', 'FRA', false),
              ({ITALY}, 'Italy', NULL, true)""")
        players = [*BASE, *BENCH, *range(200, 215), 300]
        x("INSERT INTO core.players(id, name) SELECT p, 'Player ' || p FROM unnest(%s::int[]) p", (players,))
        roles = {p: r for p, r in [(100, "goalkeeper"), (101, "goalkeeper"), (112, "centre_back"), (113, "central_midfielder"), (114, "centre_forward")]}
        x("INSERT INTO agg.power_runs(id, kind, method_version, season_id) VALUES (1, 'players', 'test', 2026)")
        for p, role in roles.items():
            x("""INSERT INTO agg.player_power(season_id, player_id, role, team_id, matches, minutes, total, rate, eligible, run_id)
                 VALUES (2026, %s, %s, 1, 10, 500, 0, 0, true, 1)""", (p, role))
        match = lambda mid, comp, home, away, status, kickoff: x(
            """INSERT INTO core.matches(id, competition_season_id, season_id, source, status, home_team_id, away_team_id, kickoff_at, match_date)
               VALUES (%s, %s, 2026, 'pitchapi', %s, %s, %s, %s, (%s AT TIME ZONE 'UTC')::date)""", (mid, comp, status, home, away, kickoff, kickoff))
        lineup = lambda mid, team, xi, bench=(), confirmed=True, formation="4-3-3": cls.lineup(mid, team, xi, bench, confirmed, formation)
        for mid, kickoff in HISTORY:
            match(mid, CUP if mid in (1003, 1008) else L1, PSG, OPP, "finished", kickoff)
            xi = eleven(mid)
            lineup(mid, PSG, xi, [p for p in BENCH if p not in xi])
        # Not in a window: ten starters; confirmed false; confirmed unknown (after 1012, before now).
        for mid, day, confirmed, size in ((1013, 23, True, 10), (1014, 24, False, 11), (1015, 24, None, 11)):
            match(mid, L1, PSG, OPP2, "finished", datetime(2026, 11, day, 8 + mid - 1013, 0, tzinfo=timezone.utc))
            xi = {p: SLOTS[p] for p in list(SLOTS)[:size] if p not in (103, 106, 111)}
            xi.update({112: SLOTS[103], 113: SLOTS[106], 114: SLOTS[111]} if size == 11 else {112: SLOTS[103], 113: SLOTS[106]})
            lineup(mid, PSG, dict(list(xi.items())[:size]), confirmed=confirmed)
        # Lorient: four complete elevens only.
        for k in range(4):
            mid = 2001 + k
            match(mid, L1, LORIENT, OPP, "finished", datetime(2026, 10, 4 + 7 * k, 15, 0, tzinfo=timezone.utc))
            lineup(mid, LORIENT, {200 + i: (11 if i == 0 else 30 + i, 0.1 + i / 20, 0.5) for i in range(11)})
        match(TARGET, L1, PSG, LORIENT, "not_started", datetime(2026, 11, 28, 19, 45, tzinfo=timezone.utc))
        match(LATER, L1, OPP, PSG, "not_started", datetime(2026, 12, 3, 19, 45, tzinfo=timezone.utc))  # in 8 days
        match(CUP_TIE, CUP, OPP2, PSG, "not_started", datetime(2026, 11, 30, 19, 45, tzinfo=timezone.utc))
        match(NATIONAL, 32, FRANCE, ITALY, "not_started", datetime(2026, 11, 27, 19, 45, tzinfo=timezone.utc))
        match(STALE, L1, OPP, OPP2, "finished", datetime(2026, 11, 24, 19, 45, tzinfo=timezone.utc))
        # France's eleven (all of PSG's players, national team): ten matches, so a national side would have a window.
        for k in range(10):
            mid = 4001 + k
            match(mid, 32, FRANCE, ITALY, "finished", datetime(2026, 6, 1, 19, 0, tzinfo=timezone.utc) + timedelta(days=7 * k))
            lineup(mid, FRANCE, dict(SLOTS))
        for p, key in LINKS.items():
            x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('player', 'transfermarkt', %s, %s)", (key, p))
            for kind in ("injuries", "suspensions"):
                x("""INSERT INTO ops.transfermarkt_reads(kind, provider_key, priority, next_due_at, read_at)
                     VALUES (%s, %s, 1, %s, %s)""", (kind, key, NOW + timedelta(days=1), NOW - timedelta(days=2)))

    @classmethod
    def lineup(cls, mid, team, xi, bench=(), confirmed=True, formation="4-3-3"):
        x = cls.db.execute
        x("""INSERT INTO core.lineups(season_id, match_id, team_id, side, formation, confirmed)
             SELECT 2026, %s, %s, CASE WHEN m.home_team_id = %s THEN 'home' ELSE 'away' END::core.side, %s, %s FROM core.matches m WHERE m.id = %s""",
          (mid, team, team, formation, confirmed, mid))
        for n, (p, (pos, px, py)) in enumerate(xi.items()):
            x("""INSERT INTO core.lineup_players(season_id, match_id, team_id, player_id, is_starter, shirt_number, position_id, pitch_x, pitch_y)
                 VALUES (2026, %s, %s, %s, true, %s, %s, %s, %s)""", (mid, team, p, p % 100, pos, px, py))
            x("INSERT INTO core.player_match_stats(season_id, match_id, team_id, player_id, minutes_played) VALUES (2026, %s, %s, %s, 90)", (mid, team, p))
        for p in bench:
            x("""INSERT INTO core.lineup_players(season_id, match_id, team_id, player_id, is_starter, shirt_number, pitch_x, pitch_y)
                 VALUES (2026, %s, %s, %s, false, %s, 0, 0)""", (mid, team, p, p % 100))
            x("INSERT INTO core.player_match_stats(season_id, match_id, team_id, player_id, minutes_played) VALUES (2026, %s, %s, %s, %s)",
              (mid, team, p, 20 if p == 114 else 0))

    def run_step(self, now=NOW, method=None):
        """probable.refresh under the calculation role, as the side process runs it (its default method unless given)."""
        self.db.execute("SET ROLE vega_calc")
        try:
            return probable().refresh(self.db, now, **({"method": method} if method else {}))
        finally:
            self.db.execute("RESET ROLE")

    def sides(self):
        return {(m, t): r for m, t, *r in self.db.execute(
            """SELECT match_id, team_id, season_id, method, basis_lineups, basis_from, basis_to, formation, computed_at
               FROM agg.match_probable_lineups ORDER BY 1, 2""").fetchall()}

    def starters(self, match=TARGET, team=PSG):
        return {p: (pos, x, y, share, rep) for p, pos, x, y, share, rep in self.db.execute(
            """SELECT player_id, position_id, pitch_x, pitch_y, share, replaces_player_id FROM agg.match_probable_lineup_players
               WHERE match_id = %s AND team_id = %s AND role = 'starter' ORDER BY ord""", (match, team)).fetchall()}

    def absent(self, match=TARGET, team=PSG):
        return self.db.execute(
            """SELECT player_id, absence_kind, absence_label, expected_return, matches_remaining FROM agg.match_probable_lineup_players
               WHERE match_id = %s AND team_id = %s AND role = 'absent' ORDER BY ord""", (match, team)).fetchall()

    def scenario(self, sql_rows=()):
        """Rows added for one test, removed after it."""
        for sql, args in sql_rows:
            self.db.execute(sql, args)
        self.addCleanup(self.cleanup)

    def cleanup(self):
        x = self.db.execute
        x("DELETE FROM agg.match_probable_lineup_players")
        x("DELETE FROM agg.match_probable_lineups")
        x("DELETE FROM core.player_injuries")
        x("DELETE FROM core.player_suspensions")
        x("DELETE FROM core.provider_squads")
        x("DELETE FROM core.provider_ids WHERE entity_type IN ('team', 'competition')")
        x("DELETE FROM ops.provider_links")
        x("DELETE FROM agg.team_elo")
        x("DELETE FROM core.lineup_players WHERE match_id >= 3000 AND match_id < 4000")
        x("DELETE FROM core.player_match_stats WHERE match_id >= 3000 AND match_id < 4000")
        x("DELETE FROM core.lineups WHERE match_id >= 3000 AND match_id < 4000")
        x("DELETE FROM core.matches WHERE id >= 3000 AND id < 4000")
        x("DELETE FROM core.competition_seasons WHERE id >= 3000")
        x("DELETE FROM core.competitions WHERE id >= 3000")
        x("DELETE FROM core.teams WHERE id >= 3000")
        x("UPDATE ops.transfermarkt_reads SET read_at = %s", (NOW - timedelta(days=2),))


class RefreshTest(RefreshBase):
    def test_61b_61c_61d_scope_window_and_basis(self):
        # 61aa: under probable-v1, as before probable-v2 (61ab: the same scope and basis under probable-v2).
        self.scenario()
        counts = self.run_step(method="probable-v1")
        sides = self.sides()
        # PSG in the Ligue 1 match and in the cup tie (30 Nov); Lorient (4 elevens), the match in 8 days and the national match: none.
        self.assertEqual(sorted(sides), [(TARGET, PSG), (CUP_TIE, PSG)])
        self.assertEqual(counts["sides"], 2)
        season, method, lineups, start, end, formation, computed = sides[(TARGET, PSG)]
        # The ten latest complete confirmed elevens: 1003 (20 Sep) to 1012 (22 Nov); 1013 (ten), 1014 (not confirmed), 1015 (unknown) left out.
        self.assertEqual((season, method, lineups, start, end, formation), (2026, "probable-v1", 10, date(2026, 9, 20), date(2026, 11, 22), "4-3-3"))
        self.assertEqual(computed, NOW)
        starters = self.starters()
        self.assertEqual(sorted(starters), sorted(BASE))
        # The template's slots (the latest eleven of the formation): each player in his own.
        for p, (pos, x, y, share, rep) in starters.items():
            self.assertEqual((pos, round(x, 2), round(y, 2)), SLOTS[p], p)
            self.assertIsNone(rep)
        self.assertAlmostEqual(starters[103][3], 0.8)  # 8 starts in 10
        self.assertAlmostEqual(starters[108][3], 0.9)
        self.assertAlmostEqual(starters[100][3], 1.0)
        self.assertEqual(self.absent(), [])

    def test_61d_stale_rows_go(self):
        self.scenario()
        x = self.db.execute
        for match, team in ((STALE, OPP), (LATER, PSG), (NATIONAL, FRANCE)):
            x("""INSERT INTO agg.match_probable_lineups(match_id, season_id, team_id, side, method, computed_at, basis_lineups, basis_from, basis_to, formation)
                 VALUES (%s, 2026, %s, 'home', 'probable-v1', %s, 10, '2026-09-01', '2026-11-01', '4-3-3')""", (match, team, NOW - timedelta(days=1)))
            x("""INSERT INTO agg.match_probable_lineup_players(match_id, team_id, player_id, role, ord, share)
                 VALUES (%s, %s, 100, 'starter', 0, 1)""", (match, team))
        counts = self.run_step()
        self.assertEqual(sorted(self.sides()), [(TARGET, PSG), (CUP_TIE, PSG)])
        self.assertEqual(counts["deleted"], 3)
        self.assertEqual(x("SELECT count(*) FROM agg.match_probable_lineup_players WHERE match_id IN (%s, %s, %s)", (STALE, LATER, NATIONAL)).fetchone()[0], 0)
        # The match kicked off since: its rows go at the next run.
        self.run_step(datetime(2026, 11, 28, 19, 50, tzinfo=timezone.utc))
        self.assertNotIn((TARGET, PSG), self.sides())

    def test_61e_61g_an_injured_starter_is_replaced_in_his_slot(self):
        # 103 hurt on 23 Nov, after his last appearance (22 Nov): out, 112 (the centre back most started) in his slot.
        injury = """INSERT INTO core.player_injuries(player_id, kind, label, start_date, end_date, source, as_of)
                    VALUES (%s, %s, %s, %s, %s, 'transfermarkt', '2026-11-24')"""
        self.scenario([(injury, (103, "injury", "Thigh injury", date(2026, 11, 23), date(2026, 12, 6))),
                       # 104 hurt on 20 Nov, played on 22 Nov: not out; 105 from the match day: not out.
                       (injury, (104, "injury", "Knock", date(2026, 11, 20), None)),
                       (injury, (105, "illness", "Flu", date(2026, 11, 28), None))])
        self.run_step(method="probable-v1")  # 61aa (61w: the same under probable-v2)
        starters = self.starters()
        self.assertNotIn(103, starters)
        self.assertIn(104, starters)
        self.assertIn(105, starters)
        pos, x, y, share, rep = starters[112]
        self.assertEqual((pos, round(x, 2), round(y, 2), rep), (34, 0.36, 0.63, 103))
        self.assertAlmostEqual(share, 0.2)
        self.assertEqual(self.absent(), [(103, "injury", "Thigh injury", date(2026, 12, 6), None)])

    def test_61f_suspensions_of_the_match_s_competition(self):
        suspension = """INSERT INTO core.player_suspensions(player_id, label, start_date, end_date, matches_missed, matches_possible,
                          competition_code, competition_id, season_year, source, as_of)
                        VALUES (%s, %s, '2026-11-22', NULL, %s, %s, %s, %s, 2026, 'transfermarkt', '2026-11-23')"""
        self.scenario([(suspension, (106, "Yellow card suspension", 0, 1, "FR1", L1)),  # Ligue 1: out of the Ligue 1 match only
                       (suspension, (107, "Red card suspension", 1, 1, "FR1", L1)),  # served: not out
                       (suspension, (108, "Red card suspension", 0, 2, "CL", None)),  # not linked: not out
                       (suspension, (109, "Yellow card suspension", 0, 1, "FR1", L1)),  # his link in quarantine: not out
                       ("""INSERT INTO ops.provider_links(entity_type, provider, provider_key, entity_id, rule, quarantined_at)
                           VALUES ('player', 'transfermarkt', %s, 109, 'name_match', now())""", (LINKS[109],)),
                       (suspension, (110, "Yellow card suspension", 0, 1, "FR1", L1))])  # empty end, read 50 days ago: not out
        self.db.execute("UPDATE ops.transfermarkt_reads SET read_at = %s WHERE provider_key = %s AND kind = 'suspensions'",
                        (NOW - timedelta(days=50), LINKS[110]))
        self.run_step()
        starters = self.starters()
        self.assertNotIn(106, starters)
        self.assertEqual(starters[113][4], 106)  # the midfielder most used
        self.assertEqual(starters[113][0], 73)  # in 106's slot
        for p in (107, 108, 109, 110):
            self.assertIn(p, starters)
        self.assertEqual(self.absent(), [(106, "suspension", "Yellow card suspension", None, 1)])
        # The cup tie: the Ligue 1 suspension does not count.
        self.assertIn(106, self.starters(CUP_TIE))
        self.assertEqual(self.absent(CUP_TIE), [])

    def test_61h_a_player_gone_to_another_club(self):
        x = self.db.execute
        self.scenario()
        # 111 in Monaco's eleven on 24 Nov; 110 in France's on 24 Nov (a national team: kept).
        x("""INSERT INTO core.matches(id, competition_season_id, season_id, source, status, home_team_id, away_team_id, kickoff_at, match_date)
             VALUES (3001, 30, 2026, 'pitchapi', 'finished', %s, %s, '2026-11-24T15:00Z', '2026-11-24'),
                    (3002, 32, 2026, 'pitchapi', 'finished', %s, %s, '2026-11-24T19:00Z', '2026-11-24')""", (MONACO, OPP, FRANCE, ITALY))
        self.lineup(3001, MONACO, {111: SLOTS[111]})
        self.lineup(3002, FRANCE, {110: SLOTS[110]})
        self.run_step()
        starters = self.starters()
        self.assertNotIn(111, starters)
        self.assertIn(110, starters)
        pos, _, _, _, rep = starters[114]
        self.assertEqual((pos, rep), (108, None))  # in 111's slot, naming no one
        self.assertEqual(self.absent(), [])

    def test_61i_the_club_s_squad(self):
        x = self.db.execute
        self.scenario()
        x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('team', 'transfermarkt', '583', %s)", (PSG,))
        # The squad read on 24 Nov: every player but 109; 108's link removed (not linked: kept).
        x("""INSERT INTO core.provider_squads(provider, club_key, season_year, player_key, read_on)
             SELECT 'transfermarkt', '583', 2026, k, '2026-11-24' FROM unnest(%s::text[]) k""", ([k for p, k in LINKS.items() if p != 109],))
        x("DELETE FROM core.provider_ids WHERE entity_type = 'player' AND entity_id = 108")
        self.run_step()
        starters = self.starters()
        self.assertNotIn(109, starters)
        self.assertIn(108, starters)
        self.assertEqual(self.absent(), [])
        x("""INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('player', 'transfermarkt', %s, 108)""", (LINKS[108],))
        # A squad read before his last appearance for the club says nothing of him (read 1 Nov, he played on 22 Nov): kept.
        x("UPDATE core.provider_squads SET read_on = '2026-11-01'")
        self.run_step()
        self.assertIn(109, self.starters())
        # No squad read: kept.
        x("DELETE FROM core.provider_squads")
        self.run_step()
        self.assertIn(109, self.starters())

    def test_61k_61l_nothing_else_is_written_and_a_rerun_is_the_same(self):
        self.scenario()
        tables = ("core.lineups", "core.lineup_players", "agg.match_forecasts", "agg.match_lineup_forecasts", "agg.lineup_usuals",
                  "core.player_injuries", "core.player_suspensions", "core.matches")
        print_ = lambda: {t: self.db.execute(f"SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) FROM {t} t").fetchone()[0] for t in tables}
        before = print_()
        self.run_step()
        rows = lambda: self.db.execute(
            """SELECT p.* FROM agg.match_probable_lineup_players p ORDER BY match_id, team_id, role, ord""").fetchall()
        first, first_sides = rows(), {k: v[:-1] for k, v in self.sides().items()}
        self.run_step(NOW + timedelta(minutes=15))
        self.assertEqual(print_(), before)
        self.assertEqual(rows(), first)
        self.assertEqual({k: v[:-1] for k, v in self.sides().items()}, first_sides)
        self.assertEqual({v[-1] for v in self.sides().values()}, {NOW + timedelta(minutes=15)})

    def test_61d_the_read_views(self):
        self.scenario()
        self.run_step()
        x = self.db.execute
        x("SET ROLE vega_read")
        try:
            side = x("""SELECT match_key, match_id, team_key, team_id, side, method, basis_lineups, formation
                        FROM api.match_probable_lineups WHERE match_key = %s""", (TARGET,)).fetchall()
            players = x("""SELECT player_id, name, role, shirt_number FROM api.match_probable_lineup_players
                           WHERE match_key = %s AND team_key = %s ORDER BY role, ord""", (TARGET, PSG)).fetchall()
        finally:
            x("RESET ROLE")
        self.assertEqual(len(side), 1)
        self.assertRegex(side[0][1], r"^m_")
        self.assertRegex(side[0][3], r"^t_")
        self.assertEqual((side[0][4], side[0][5], side[0][6], side[0][7]), ("home", "probable-v3", 10, "4-3-3"))
        self.assertEqual(len(players), 11)
        self.assertTrue(all(p[0].startswith("p_") and p[1].startswith("Player ") and p[2] == "starter" for p in players))


# The window's weights of PSG's Ligue 1 match (TARGET) under probable-v2, oldest first (1003 … 1012): 0.8^k, the cup
# ties 1003 and 1008 × 0.3 (another type), no Elo anywhere (one factor for all, divided out). Sheets: 15 (11 + 101, 112,
# 113, 114), 14 for 1003 (112 starts), 13 for 1008 (112 and 113 start).
W_TARGET = [0.3 * 0.8 ** 9, 0.8 ** 8, 0.8 ** 7, 0.8 ** 6, 0.8 ** 5, 0.3 * 0.8 ** 4, 0.8 ** 3, 0.8 ** 2, 0.8, 1.0]
SHEET_TARGET = [14, 15, 15, 15, 15, 13, 15, 15, 15, 15]


def hand_score(w, sizes, started, listed):
    prior = 11 * sum(w) / sum(a * b for a, b in zip(w, sizes))
    return (sum(w[i] for i in started) + 2 * prior) / (sum(w[i] for i in listed) + 2)


class RefreshV2Test(RefreshBase):
    """61u, 61v, 61w, 61ab: probable-v2 in the worker's step, under the calculation role."""

    def compute(self):
        self.db.execute("SET ROLE vega_calc")
        try:
            return {(t.match_id, t.team_id): (t, window, result) for t, window, result in probable().compute(self.db, NOW, "probable-v2")}
        finally:
            self.db.execute("RESET ROLE")

    def test_61ab_scope_basis_and_share_under_v2(self):
        self.scenario()
        counts = self.run_step(method="probable-v2")
        sides = self.sides()
        self.assertEqual(sorted(sides), [(TARGET, PSG), (CUP_TIE, PSG)])
        self.assertEqual(counts["sides"], 2)
        self.assertEqual(tuple(sides[(TARGET, PSG)][:5]), (2026, "probable-v2", 10, date(2026, 9, 20), date(2026, 11, 22)))
        starters = self.starters()
        # PSG is not of the five leagues here (Ligue 1 has no PitchAPI key): P1a, the latest eleven (1012) in its slots.
        self.assertEqual(sorted(starters), sorted(BASE))
        for p, (pos, x, y, share, rep) in starters.items():
            self.assertEqual((pos, round(x, 2), round(y, 2)), SLOTS[p], p)
            self.assertIsNone(rep)
        # share: the score. 100 started all ten; 103 the eight he was on the sheet for (off it in 1003 and 1008).
        self.assertAlmostEqual(starters[100][3], hand_score(W_TARGET, SHEET_TARGET, range(10), range(10)), places=6)
        self.assertAlmostEqual(starters[103][3], hand_score(W_TARGET, SHEET_TARGET, (1, 2, 3, 4, 6, 7, 8, 9), (1, 2, 3, 4, 6, 7, 8, 9)), places=6)

    def test_61w_an_injured_starter_under_v2(self):
        injury = """INSERT INTO core.player_injuries(player_id, kind, label, start_date, end_date, source, as_of)
                    VALUES (%s, %s, %s, %s, %s, 'transfermarkt', '2026-11-24')"""
        self.scenario([(injury, (103, "injury", "Thigh injury", date(2026, 11, 23), date(2026, 12, 6)))])
        self.run_step(method="probable-v2")
        starters = self.starters()
        self.assertNotIn(103, starters)
        pos, x, y, share, rep = starters[112]  # the only centre back left: in 103's slot, naming him
        self.assertEqual((pos, round(x, 2), round(y, 2), rep), (34, 0.36, 0.63, 103))
        self.assertAlmostEqual(share, hand_score(W_TARGET, SHEET_TARGET, (0, 5), range(10)), places=6)
        self.assertEqual(self.absent(), [(103, "injury", "Thigh injury", date(2026, 12, 6), None)])

    def back_from_injury(self):
        """The Dembélé case: 110 off PSG's sheets of four Ligue 1 elevens after 1012 (3001–3004, 23–25 Nov), 114 in his
        slot; no episode, so neither absent nor gone."""
        for k, at in enumerate((datetime(2026, 11, 23, 12, 0), datetime(2026, 11, 23, 18, 0), datetime(2026, 11, 24, 12, 0),
                                datetime(2026, 11, 25, 8, 0))):
            mid = 3001 + k
            self.db.execute(
                """INSERT INTO core.matches(id, competition_season_id, season_id, source, status, home_team_id, away_team_id, kickoff_at, match_date)
                   VALUES (%s, %s, 2026, 'pitchapi', 'finished', %s, %s, %s, %s)""",
                (mid, L1, PSG, OPP, at.replace(tzinfo=timezone.utc), at.date()))
            xi = dict(SLOTS)
            xi[114] = xi.pop(110)
            self.lineup(mid, PSG, xi, [101, 112, 113])

    def test_61u_the_route_end_to_end(self):
        x = self.db.execute
        self.scenario()
        self.back_from_injury()
        # The window: 1007 … 1012, then 3001 … 3004 (k = 0); 1008 a cup tie. 110 on the first six sheets, 114 on all ten.
        w = [0.8 ** 9, 0.3 * 0.8 ** 8, 0.8 ** 7, 0.8 ** 6, 0.8 ** 5, 0.8 ** 4, 0.8 ** 3, 0.8 ** 2, 0.8, 1.0]
        sizes = [15, 13, 15, 15, 15, 15, 14, 14, 14, 14]
        s110, s114 = hand_score(w, sizes, range(6), range(6)), hand_score(w, sizes, range(6, 10), range(10))
        self.assertGreater(s110, s114)
        # Not of the five leagues: P1a keeps the latest eleven, 114 in 110's slot.
        self.run_step(method="probable-v2")
        starters = self.starters()
        self.assertNotIn(110, starters)
        self.assertEqual((starters[114][0], round(starters[114][1], 2), round(starters[114][2], 2)), SLOTS[110])
        self.assertAlmostEqual(starters[114][3], s114, places=6)
        self.assertEqual(self.sides()[(TARGET, PSG)][1], "probable-v2")
        # Ligue 1 given its PitchAPI key of tm_history.LEAGUES: PSG is of the five leagues, P11 takes 110 back, in that slot.
        x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('competition', 'pitchapi', 'l_3FJFUl', %s)", (L1,))
        self.run_step(method="probable-v2")
        starters = self.starters()
        self.assertNotIn(114, starters)
        self.assertEqual(sorted(starters), sorted(BASE))
        self.assertEqual((starters[110][0], round(starters[110][1], 2), round(starters[110][2], 2)), SLOTS[110])
        self.assertAlmostEqual(starters[110][3], s110, places=6)
        # probable-v1 on the same base: 114 keeps it.
        self.run_step(method="probable-v1")
        self.assertIn(114, self.starters())
        self.assertNotIn(110, self.starters())
        self.assertEqual(self.sides()[(TARGET, PSG)][1], "probable-v1")

    def test_61ab_types_elo_and_sheets_read(self):
        x = self.db.execute
        self.scenario()
        kickoff = dict(HISTORY)
        elo = """INSERT INTO agg.team_elo(match_id, team_id, season_id, kickoff_at, elo_before, elo_after, expected, result, run_id)
                 VALUES (%s, %s, 2026, %s, %s, %s, 0.5, 0.5, 1)"""
        # OPP rated in 1010 (1580 -> 1590) and 1012 (1600 -> 1610), not in 1011 (his latest before it: 1590) nor before 1010.
        x(elo, (1010, OPP, kickoff[1010], 1580, 1590))
        x(elo, (1012, OPP, kickoff[1012], 1600, 1610))
        x(elo, (2004, LORIENT, datetime(2026, 10, 25, 15, 0, tzinfo=timezone.utc), 1440, 1450))  # Lorient's latest: 1450
        # The cup given the Champions League's PitchAPI key (forecast.LEAGUE_PHASE_CUPS): its matches are « E ».
        x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('competition', 'pitchapi', 'l_0bfbkO', %s)", (CUP,))
        got = self.compute()
        t, window, _ = got[(TARGET, PSG)]
        self.assertEqual((t.ctype, t.opp_elo, t.five), ("L", 1450.0, False))
        self.assertEqual({e.match_id: e.ctype for e in window}, {m: "E" if m in (1003, 1008) else "L" for m in range(1003, 1013)})
        elos = {e.match_id: e.opp_elo for e in window}
        self.assertEqual((elos[1012], elos[1011], elos[1010], elos[1009]), (1600.0, 1590.0, 1580.0, None))
        last = window[-1]
        self.assertEqual(last.match_id, 1012)
        self.assertEqual(last.sheet, frozenset(BASE) | frozenset(BENCH))  # starters and substitutes
        t, _, _ = got[(CUP_TIE, PSG)]
        self.assertEqual((t.ctype, t.opp_elo, t.five), ("E", None, False))

    def test_61v_the_clubs_of_the_five_leagues(self):
        x = self.db.execute
        self.scenario()
        x("INSERT INTO core.seasons(id, label) VALUES (2024, '2024/2025') ON CONFLICT DO NOTHING")
        x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('competition', 'pitchapi', 'l_3FJFUl', %s)", (L1,))
        x("INSERT INTO core.competitions(id, name, country_code, kind) VALUES (3201, 'Ligue 2', 'FRA', 'league')")
        x(f"""INSERT INTO core.competition_seasons(id, competition_id, season_id, native_label, archive_key)
              VALUES (3025, {L1}, 2025, '2025/2026', NULL), (3201, 3201, 2026, '2026/2027', NULL), (3024, {L1}, 2024, '2024/2025', '2024-25/fr.1')""")
        x("INSERT INTO core.teams(id, name, country_code, is_national) SELECT t, 'Club ' || t, 'FRA', false FROM generate_series(3101, 3106) t")
        for mid, cs, season, status, day, home, away in (
                (3101, L1, 2026, "finished", date(2026, 10, 10), 3101, OPP),  # a Ligue 1 match this award year
                (3102, L1, 2026, "not_started", date(2026, 12, 12), OPP, 3102),  # only one not started (a promoted club)
                (3103, 3025, 2025, "finished", date(2026, 3, 1), 3103, OPP2),  # only last award year's
                (3104, CUP, 2026, "finished", date(2026, 10, 20), 3104, OPP2),  # only a cup match
                (3105, 3201, 2026, "finished", date(2026, 10, 20), 3105, OPP2),  # only a league without a key of the five
                (3106, 3024, 2024, "finished", date(2024, 10, 10), 3106, OPP2)):  # only an archive edition of Ligue 1
            x("""INSERT INTO core.matches(id, competition_season_id, season_id, source, status, home_team_id, away_team_id, kickoff_at, match_date)
                 VALUES (%s, %s, %s, 'pitchapi', %s, %s, %s, %s, %s)""",
              (mid, cs, season, status, home, away, datetime(day.year, day.month, day.day, 15, 0, tzinfo=timezone.utc), day))
        x("SET ROLE vega_calc")
        try:
            got = probable().five_clubs(self.db, [PSG, *range(3101, 3107)], [2024, 2025, 2026])
        finally:
            x("RESET ROLE")
        self.assertEqual(got, {(PSG, 2026), (3101, 2026), (3102, 2026), (3103, 2025)})
        # In the step: PSG's sides are of the five leagues once Ligue 1 has its key.
        self.assertTrue(all(t.five for t, _, _ in self.compute().values()))


class RefreshV3Test(RefreshBase):
    """61an: probable-v3 in the worker's step, under the calculation role."""

    def test_61an_label_basis_and_history(self):
        x = self.db.execute
        self.scenario()
        x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('competition', 'pitchapi', 'l_3FJFUl', %s)", (L1,))
        counts = self.run_step()
        sides = self.sides()
        self.assertEqual(counts["sides"], 2)
        self.assertEqual(tuple(sides[(TARGET, PSG)][:5]), (2026, "probable-v3", 10, date(2026, 9, 20), date(2026, 11, 22)))
        # The history: PSG's twelve complete confirmed elevens (LONG 30); the window, its last ten.
        x("SET ROLE vega_calc")
        try:
            history = probable()._windows(self.db, {PSG}, NOW, probable().LONG)[PSG]
            window = probable()._windows(self.db, {PSG}, NOW)[PSG]
            got = {(t.match_id, t.team_id): (t, w, r) for t, w, r in probable().compute(self.db, NOW)}
        finally:
            x("RESET ROLE")
        self.assertEqual([e.match_id for e in history], list(range(1001, 1013)))
        self.assertEqual(window, history[-10:])
        t, w, result = got[(TARGET, PSG)]
        self.assertTrue(t.five)
        self.assertEqual(w, window)
        # The stored eleven is predict's on that window, with the history and the run's role shares.
        stored = self.starters()
        self.assertEqual([q for q, *_ in result["starters"]], list(stored))
        self.assertEqual(sorted(stored), sorted(BASE))  # nobody absent: the eleven of the template
        for q, (pos, px, py, share, rep) in stored.items():
            self.assertEqual((pos, round(px, 2), round(py, 2)), SLOTS[q], q)
            self.assertIsNone(rep)


if __name__ == "__main__":
    unittest.main()
