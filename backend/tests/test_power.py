"""Power rankings (docs/METHODE_CLASSEMENT_BALLON_D_OR.md): the formulas, without a database.
The database pass over a synthetic season is in test_models.py."""

from math import exp
from pathlib import Path
import random
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from vega import power


class EloTest(unittest.TestCase):
    def test_expected_score_and_update(self):
        self.assertAlmostEqual(power.expected_score(1500, 1500, 0), 0.5)
        self.assertAlmostEqual(power.expected_score(1500, 1500, 60), 1 / (1 + 10 ** (-60 / 400)))
        rows = list(power.elo_updates([(1, 2025, None, "A", "B", 2, 0, False)]))
        (_, a, _, _, before_a, after_a, ea, ra), (_, b, _, _, before_b, after_b, eb, rb) = rows
        self.assertEqual((a, b, ra, rb, before_a, before_b), ("A", "B", 1.0, 0.0, 1500, 1500))
        self.assertAlmostEqual(after_a, 1500 + 20 * (1 - ea))
        self.assertAlmostEqual(after_a + after_b, 3000)  # what one side wins, the other loses
        self.assertAlmostEqual(ea + eb, 1)

    def test_strength_before_the_match_is_the_context(self):
        rows = list(power.elo_updates([(1, 2025, None, "A", "B", 1, 0, True), (2, 2025, None, "B", "A", 1, 1, True)]))
        self.assertAlmostEqual(rows[2][4], rows[1][5])  # B starts match 2 where match 1 left it
        self.assertEqual(rows[2][7], 0.5)  # a draw (a shoot-out is one too)
        self.assertAlmostEqual(rows[0][6], 0.5)  # neutral ground: no home advantage


class RoleTest(unittest.TestCase):
    def test_slots(self):
        cases = {11: "goalkeeper", 0: "goalkeeper", 32: "full_back", 38: "full_back", 34: "centre_back", 35: "centre_back", 51: "full_back",
                 59: "full_back", 64: "defensive_midfielder", 55: "defensive_midfielder", 73: "central_midfielder", 83: "winger", 85: "winger",
                 115: "centre_forward", 104: "centre_forward", 92: "winger", 1: None, 3: None}
        for slot, role in cases.items():
            self.assertEqual(power.ROLE_OF_SLOT(slot), role, slot)

    def test_substitutes_take_their_most_played_role(self):
        rows = [
            {"match_id": 1, "player_id": 7, "position_id": 115, "minutes_played": 90.0},
            {"match_id": 2, "player_id": 7, "position_id": 3, "minutes_played": 20.0},
            {"match_id": 2, "player_id": 8, "position_id": 2, "minutes_played": 30.0},
            {"match_id": 2, "player_id": 9, "position_id": None, "minutes_played": 30.0},
        ]
        out = {(r["match_id"], r["player_id"]): r["role"] for r in power.assign_roles(rows)}
        self.assertEqual(out, {(1, 7): "centre_forward", (2, 7): "centre_forward", (2, 8): "central_midfielder"})


class ExpectationTest(unittest.TestCase):
    def test_poisson_fit_recovers_the_opponent_effect(self):
        rng = random.Random(7)
        obs = []
        for _ in range(4000):
            d, w = rng.uniform(-1, 1), rng.choice((0.5, 1.0))
            lam, k, p = w * exp(0.2 - 0.6 * d), 0, exp(-w * exp(0.2 - 0.6 * d))
            # Poisson draw by inversion
            u, cum = rng.random(), p
            while u > cum:
                k += 1
                p *= lam / k
                cum += p
            obs.append((k, w, d))
        a, b = power.fit_poisson(obs)
        self.assertAlmostEqual(a, 0.2, delta=0.05)
        self.assertAlmostEqual(b, -0.6, delta=0.08)

    def test_too_few_matches_keep_the_role_rate(self):
        a, b = power.fit_poisson([(1, 1.0, 0.5), (3, 1.0, -0.5)])
        self.assertAlmostEqual(exp(a), 2.0)
        self.assertEqual(b, 0.0)


class ScoreTest(unittest.TestCase):
    def test_contribution_renormalises_over_measured_blocks(self):
        refs = {("centre_forward", "npxg"): (lambda r: 0.5, 0.25), ("centre_forward", "assists"): (lambda r: 0.25, 0.5)}
        row = {"role": "centre_forward", **{spec[0]: None for b in power.OUTFIELD_BLOCKS.values() for spec in b}, "npxg": 1.0, "assists": 0.0}
        row.update(dribbles_total=None, duels_attempted=None, aerials_total=None, accurate_passes_total=None)
        scores, c = power.match_contribution(row, refs)
        self.assertEqual(scores, {"finishing": 2.0, "creation": -0.5})
        self.assertAlmostEqual(c, (0.45 * 2.0 + 0.20 * -0.5) / 0.65)

    def test_block_shares_add_up_to_the_contribution(self):
        scores = {"finishing": 1.2, "creation": -0.4, "defence": 0.5}  # progression and retention not measured
        shares = power.block_shares("centre_forward", scores)
        weights = {"finishing": 0.45, "creation": 0.20, "defence": 0.10}
        expected_c = sum(w * scores[b] for b, w in weights.items()) / sum(weights.values())
        self.assertAlmostEqual(sum(shares.values()), expected_c, places=12)
        self.assertAlmostEqual(shares["finishing"], 0.45 * 1.2 / 0.75, places=12)

    def test_season_details_by_block_and_role(self):
        detailed = {
            1: [("winger", 90, 1.0, 9, {"creation": 0.7, "finishing": 0.3}), ("centre_forward", 60, -0.5, 9, {"finishing": -0.5})],
            2: [("winger", 90, 0.2, 8, {"creation": 0.2})],
        }
        scored = {1: {"role": "winger", "eligible": True}, 2: {"role": "winger", "eligible": True}}
        blocks, roles = power.season_details(detailed, scored)
        self.assertAlmostEqual(blocks[1]["totals"]["finishing"], -0.2)
        self.assertEqual(blocks[1]["percentiles"]["creation"], 75.0)
        self.assertEqual(blocks[2]["percentiles"]["finishing"], 75.0)  # 0 against -0.2
        self.assertEqual(set(blocks[1]["percentiles"]), set(power.blocks_of("winger")))
        self.assertEqual(roles[1]["centre_forward"], {"matches": 1, "minutes": 60, "total": -0.5, "rate": 90 * -0.5 / (60 + 450)})
        self.assertEqual(roles[1]["winger"]["minutes"], 90)

    def test_award_race_numbers_ties_in_ranking_order(self):
        scored = {
            1: {"eligible": True, "rank": 1, "total": 5.0, "minutes": 1000, "team": 9, "score": 80.0},
            2: {"eligible": True, "rank": 2, "total": 4.0, "minutes": 1000, "team": 9, "score": 70.0},
            3: {"eligible": True, "rank": 2, "total": 4.0, "minutes": 1200, "team": 8, "score": 70.0},
            4: {"eligible": False, "rank": None, "total": 9.0, "minutes": 300, "team": 8, "score": None},
        }
        self.assertEqual(power.award_race(scored), [(1, 1, 9, 80.0), (2, 3, 8, 70.0), (3, 2, 9, 70.0)])
        self.assertEqual(len(power.award_race({i: dict(scored[1], rank=i) for i in range(1, 50)})), 30)

    def test_season_score_regularises_and_ranks_within_the_role(self):
        contributions = {
            1: [("winger", 900, 3.0, 10), ("winger", 900, 1.0, 10)],
            2: [("winger", 1800, 2.0, 11)],
            3: [("winger", 200, 9.0, 11)],  # not eligible: under 900 minutes
            4: [("centre_back", 1000, -1.0, 12)],
        }
        out = power.season_scores(contributions)
        self.assertAlmostEqual(out[1]["rate"], 90 * 4.0 / (1800 + 450))
        self.assertFalse(out[3]["eligible"])
        self.assertNotIn("score", out[3])
        self.assertEqual((out[1]["total_percentile"], out[2]["total_percentile"]), (75.0, 25.0))
        self.assertAlmostEqual(out[1]["score"], 0.75 * 75 + 0.25 * 75)
        self.assertEqual(out[4]["score"], 50.0)  # alone in his role
        self.assertEqual([out[p]["rank"] for p in (1, 4, 2)], [1, 2, 3])


if __name__ == "__main__":
    unittest.main()
