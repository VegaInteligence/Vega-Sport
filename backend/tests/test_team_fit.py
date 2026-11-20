"""Team fit of « Remplaçant » (VI-40): the pure steps, written before vega/team_fit.py, from the
note docs/calculs/05-joueurs/13-remplacant-compatibilite-equipe.md (edge cases 1–10 there)."""

from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from vega import team_fit


class CentileTest(unittest.TestCase):
    def test_share_of_peers_below_plus_half_the_ties(self):
        peers = [1.0, 2.0, 2.0, 3.0]
        self.assertEqual(team_fit.centile(peers, 2.0), 50)  # 1 below + half of 2 ties, of 4
        self.assertEqual(team_fit.centile(peers, 0.5), 0)
        self.assertEqual(team_fit.centile(peers, 9.0), 100)
        self.assertIsNone(team_fit.centile([], 1.0))
        self.assertIsNone(team_fit.centile(peers, None))

    def test_role_cohort_then_line_then_nothing(self):
        # 30 centre-backs have the value: placed among centre-backs. 10 full-backs: placed among
        # the defenders' line (40). 5 wingers alone in the attackers' line: no centile.
        rows = [("centre_back", float(i)) for i in range(30)] + [("full_back", 100.0 + i) for i in range(10)] + [("winger", 1.0)] * 5
        out = team_fit.cohort_centiles(rows)
        self.assertEqual(out[0], round(100 * 0.5 / 30))  # lowest of 30 centre-backs
        self.assertEqual(out[30], round(100 * 30.5 / 40))  # lowest full-back, above the 30 centre-backs of his line
        self.assertEqual(out[40:], [None] * 5)

    def test_a_player_without_value_or_role_gets_no_centile(self):
        rows = [("centre_back", float(i)) for i in range(30)] + [("centre_back", None), (None, 5.0)]
        out = team_fit.cohort_centiles(rows)
        self.assertEqual(out[30:], [None, None])
        # The two do not count among the peers either.
        self.assertEqual(out[29], round(100 * 29.5 / 30))

    def test_goalkeepers_are_their_own_line(self):
        self.assertEqual(team_fit.LINE["goalkeeper"], "G")
        self.assertEqual({team_fit.LINE[r] for r in ("centre_back", "full_back")}, {"D"})


class ShareTest(unittest.TestCase):
    def test_his_total_over_the_team_total_spread_over_his_minutes(self):
        # Two matches: 10 of the team's 50 passes in 90 minutes, 6 of 40 in 45 minutes.
        self.assertAlmostEqual(team_fit.share(16, 50 * 1 + 40 * 0.5), 16 / 70)

    def test_a_team_total_of_zero_leaves_it_unknown(self):
        self.assertIsNone(team_fit.share(0, 0))
        self.assertIsNone(team_fit.share(None, 10))


class DefenceTest(unittest.TestCase):
    def test_actions_per_ninety_adjusted_to_the_opponents_possession(self):
        # 6 actions each match when his team had 70 % (opponents 30 %): worth 6 × 50 / 30 = 10 per 90
        # (five matches: the 450 minutes needed).
        five = [(6, 70.0, 90)] * 5
        self.assertAlmostEqual(team_fit.defensive_rate(five), 10.0)
        # 100 % possession or unknown: the match is left out.
        self.assertAlmostEqual(team_fit.defensive_rate(five + [(9, 100.0, 90), (9, None, 90)]), 10.0)

    def test_fewer_than_450_measured_minutes_is_unknown(self):
        self.assertIsNone(team_fit.defensive_rate([(6, 50.0, 90)] * 4))
        self.assertIsNotNone(team_fit.defensive_rate([(6, 50.0, 90)] * 5))


class DisciplineTest(unittest.TestCase):
    def test_card_points_are_pulled_to_the_role_mean_by_900_minutes(self):
        # 2 points in 900 minutes, role mean 0.1 per 90: (2 + 0.1 × 10) / ((900 + 900) / 90) = 0.15 per 90.
        self.assertAlmostEqual(team_fit.shrunk_rate(2, 900, 0.1), 0.15)

    def test_the_index_averages_the_known_ratios(self):
        self.assertAlmostEqual(team_fit.discipline_index(1.2, 0.8), 1.0)
        self.assertAlmostEqual(team_fit.discipline_index(1.2, None), 1.2)  # no card in his team: fouls only
        self.assertIsNone(team_fit.discipline_index(None, None))

    def test_a_ratio_needs_a_team_rate_above_zero(self):
        self.assertIsNone(team_fit.ratio(0.3, 0))
        self.assertAlmostEqual(team_fit.ratio(0.3, 0.2), 1.5)


class EffortTest(unittest.TestCase):
    def test_mean_of_the_known_centiles_with_distance_required(self):
        self.assertEqual(team_fit.effort(80, 60, None), 70)
        self.assertEqual(team_fit.effort(80, 60, 40), 60)
        self.assertIsNone(team_fit.effort(None, 60, 40))


if __name__ == "__main__":
    unittest.main()


class PlayersOfTest(unittest.TestCase):
    """The plain reads summed per player (edge cases 1, 2 and 3 of the note)."""

    @staticmethod
    def stat(player, team, match, minutes, touches=10, tackles=1, fouls=1, distance=None):
        # (player, team, match, minutes, 6 shares, tackles, interceptions, recoveries, fouls, distance, running, sprints)
        return (player, team, match, minutes, touches, 20, 3, 1, 1, 2, tackles, 1, 2, fouls, distance, None, None)

    def test_the_main_club_is_the_one_of_most_minutes_and_only_its_matches_count(self):
        stats = [self.stat(1, 10, m, 90) for m in range(1, 7)] + [self.stat(1, 20, 7, 90, touches=99)]
        # A team-mate in each club match, so the team totals are known.
        stats += [self.stat(2, 10, m, 90, touches=30) for m in range(1, 7)] + [self.stat(3, 20, 7, 90)]
        rows = {r[0]: r for r in team_fit.players_of(stats, [(10, m, 60.0) for m in range(1, 7)], [], [(1, "winger"), (2, "winger")])}
        player = rows[1]
        self.assertEqual((player[1], player[2], player[3]), (10, 540, "winger"))
        # Touches: 6 × 10 of his own over the team's 6 × 40 spread over his 90 minutes; match 7 (club 20) left out.
        self.assertEqual(player[4:7], (60.0, 240.0, 540))
        self.assertNotIn(3, rows)  # 90 minutes: no row

    def test_a_team_total_with_an_unknown_value_is_not_counted(self):
        stats = [self.stat(1, 10, m, 90) for m in range(1, 7)] + [self.stat(2, 10, m, 90, touches=None) for m in range(1, 7)]
        player = {r[0]: r for r in team_fit.players_of(stats, [], [], [])}[1]
        self.assertEqual(player[4:7], (0.0, 0.0, 0))
        self.assertIsNone(team_fit.rows_of([player])[0][4])  # its share is unknown
