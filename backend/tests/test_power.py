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


class StakesTest(unittest.TestCase):
    """Version 3: a match counts for its competition's prestige × its round's."""

    LEAGUE, CHAMPIONS, EUROPA, CONFERENCE, WORLD_CUP = "l_0ErfuF", "l_0bfbkO", "l_38d9HA", "l_2WZ2tt", "l_1XLtP0"

    def test_rounds(self):
        for stage, name, expected in (
            ("regular", "12", None), ("regular", "21/22", None), ("regular", "bronze", None), ("regular", "League Stage - Round 3", None),
            ("knockout", "1/16", "knockout"), ("knockout", "1/8", "knockout"), ("knockout", "1/4", "knockout"), ("knockout", "1/2", "semi_final"),
            ("final", "final", "final"), ("playoff", "Promotion Play-offs - Final", "final"), ("playoff", "Promotion Play-offs - Semi-finals", "semi_final"),
            # A cup source's rounds, by their name.
            (None, "Final", "final"), (None, "Semifinals", "semi_final"), (None, "Semi-final", "semi_final"), (None, "Quarter-finals, Replays", "knockout"),
            (None, "Round of 16", "knockout"), (None, "Round of 32", "knockout"), (None, "Match 3rd place", None), (None, "Third-place play-off", None),
            (None, "Qualification, Playoffs", None), (None, "Matchday 21", None), (None, "Group A", None), (None, None, None),
        ):
            self.assertEqual(power.round_of(stage, name), expected, (stage, name))

    def test_the_orders_the_stakes_must_keep(self):
        s = power.stakes
        league, champions = s(self.LEAGUE, None, "regular", "12"), s(self.CHAMPIONS, None, "regular", "3")
        self.assertEqual(league, 1.0)
        self.assertGreater(champions, league)  # a Champions League match outweighs a league match
        self.assertGreater(s(self.CHAMPIONS, None, "knockout", "1/8"), champions)
        self.assertGreater(s(self.CHAMPIONS, None, "knockout", "1/2"), s(self.CHAMPIONS, None, "knockout", "1/4"))
        final = s(self.CHAMPIONS, None, "final", "final")
        self.assertAlmostEqual(final, 1.15 * 1.15)
        # … its final every other club final: the other European ones, a league's, a national cup's, the Club World Cup's.
        others = [s(self.EUROPA, None, "final", "final"), s(self.CONFERENCE, None, "final", "final"), s("l_3v84VE", None, "final", "final"),
                  s(None, "open-cups:fa-cup-archive:2024/2025", "regular", "Final"), s(None, "open-cups:club-world-cup:2025", "regular", "Final")]
        self.assertTrue(all(1.0 < other < final for other in others), others)
        # … and the World Cup final every match.
        world = s(self.WORLD_CUP, None, "final", "final")
        every = [final, *others, s(None, "open-cups:euro:2024", "regular", "Final"), s(self.WORLD_CUP, None, "knockout", "1/2"),
                 s(None, "open-cups:world-cup-history:2022", "regular", "Semi-finals")]
        self.assertTrue(all(world > other for other in every), every)
        self.assertAlmostEqual(s(None, "open-cups:world-cup-history:2022", "regular", "Final"), world)  # the same final, read from a cup source
        # A cup source's rounds are read by their name, whatever stage their rows hold.
        self.assertAlmostEqual(s(None, "open-cups:club-world-cup:2025", "regular", "Semifinals"), 1.10 * 1.10)
        self.assertEqual(s(None, "open-matchday:ENG_1_premier-league:2026/2027", "regular", "7"), 1.0)

    def test_a_match_moves_the_strengths_by_its_stakes(self):
        matches = [(1, 2025, None, "A", "B", 1, 0, True), (2, 2025, None, "C", "D", 1, 0, True)]
        rows = list(power.elo_updates(matches, weights={2: 1.3225}))
        plain, staked = rows[0][5] - rows[0][4], rows[2][5] - rows[2][4]
        self.assertAlmostEqual(plain, 10.0)  # K 20, level teams on neutral ground
        self.assertAlmostEqual(staked, 13.225)
        self.assertAlmostEqual(rows[2][5] + rows[3][5], 3000)  # still zero-sum
        # The leagues' levels are the fixed point of the same weighted Elo.
        levels = power.league_levels(matches, {"A": 1, "B": 1, "C": 2, "D": 2}, weights={2: 1.3225})[0]
        self.assertEqual({round(v) for v in levels.values()}, {1500})  # no match between the two leagues

    def test_a_player_s_match_counts_for_its_stakes(self):
        role, minutes, c, team, shares, level = power.staked("winger", 90, 2.0, "T", {"finishing": 1.5, "creation": 0.5}, -0.4, 1.3)
        self.assertEqual((role, minutes, team), ("winger", 90, "T"))
        self.assertAlmostEqual(c, 2.6)
        self.assertAlmostEqual(sum(shares.values()), c)  # the blocks still add up to the contribution
        self.assertAlmostEqual(level, -0.52)  # "pénalités comprises": what counts against him counts more too
        self.assertIsNone(power.staked("winger", 90, 2.0, "T", {}, None, 1.3)[5])

    def test_the_level_is_measured_among_clubs_or_among_national_teams(self):
        rows = [{"own_elo": 1900, "minutes_played": 90, "national": False}, {"own_elo": 1500, "minutes_played": 270, "national": False},
                {"own_elo": 1650, "minutes_played": 90, "national": True}, {"own_elo": None, "minutes_played": 90, "national": True}]
        self.assertEqual(power.level_centres(rows), {False: 1600.0, True: 1650.0})
        self.assertEqual(power.level_centres([]), {False: power.ELO_INITIAL, True: power.ELO_INITIAL})


class LeagueLevelTest(unittest.TestCase):
    # (match, season, kickoff, home, away, home score, away score, neutral, day, competition, complementary, international)
    @staticmethod
    def match(i, home, away, hs, as_, competition, *, season=2025, complementary=False, international=False, day=None):
        from datetime import date, timedelta

        return (i, season, None, home, away, hs, as_, True, day or date(2025, 8, 1) + timedelta(days=i), competition, complementary, international)

    def season(self):
        # Two leagues of two clubs, and a European competition where the first league's clubs beat the second's.
        m, rows, i = self.match, [], 0
        for _ in range(6):
            for home, away, competition in (("A", "B", 1), ("B", "A", 1), ("C", "D", 2), ("D", "C", 2)):
                i += 1
                rows.append(m(i, home, away, 1, 1, competition))
        for _ in range(12):
            for home, away in (("A", "C"), ("D", "B")):
                i += 1
                rows.append(m(i, home, away, *((2, 0) if home == "A" else (0, 2)), 9, international=True))
        return rows

    def test_a_club_s_league_is_the_domestic_one_of_its_first_season(self):
        rows = self.season() + [self.match(900, "A", "C", 1, 0, 2, season=2026)]
        self.assertEqual(power.home_leagues(rows), {"A": 1, "B": 1, "C": 2, "D": 2})

    def test_complementary_matches_copy_no_other(self):
        from datetime import date

        m = self.match
        rows = [
            m(1, "A", "B", 1, 0, 1, day=date(2025, 9, 1)),
            m(2, "A", "B", 1, 0, 7, complementary=True, day=date(2025, 9, 2)),  # the league match, in another source
            m(3, "A", "C", 2, 1, 8, complementary=True, day=date(2025, 10, 1)),  # a cup match
            m(4, "A", "C", 2, 1, 8, complementary=True, day=date(2025, 10, 2)),  # the same, from a second cup source
            m(5, "A", "B", 0, 0, 8, complementary=True, day=date(2025, 12, 1)),  # another meeting, in the cup
        ]
        self.assertEqual([r[0] for r in power.elo_matches(rows)], [1, 3, 5])

    def test_leagues_enter_at_the_level_their_results_against_each_other_give(self):
        rows = self.season()
        leagues = power.home_leagues(rows)
        pairs = power.league_links(rows, leagues)
        self.assertEqual((dict(pairs), dict(power.links_of(pairs))), ({(1, 2): 24}, {1: 24, 2: 24}))
        levels, rounds, move = power.league_levels(rows, leagues)
        self.assertGreater(levels[1], 1500 + 40)
        self.assertAlmostEqual(levels[1] + levels[2], 3000, places=3)  # what one league takes, the other gives
        self.assertLess(move, power.SEED_TOLERANCE)
        self.assertLess(rounds, power.SEED_ROUNDS)
        # The clubs start there: before its first match, a club of the first league stands above one of the second.
        first = {}
        for _, team, _, _, before, *_ in power.elo_updates(rows, seeds=levels, leagues=leagues):
            first.setdefault(team, before)
        self.assertEqual((first["A"], first["C"]), (levels[1], levels[2]))
        # Without a match between them, the two leagues keep 1500: an Elo only moves points inside a league.
        alone = [r for r in rows if not r[11]]
        self.assertEqual(power.league_levels(alone, leagues)[0], {1: 1500.0, 2: 1500.0})
        # Few matches against the others: the level is held towards 1500.
        few = alone + [r for r in rows if r[11]][:4]
        held = power.league_levels(few, leagues)[0]
        free = power.league_levels(few, leagues, prior=0)[0]
        self.assertTrue(1500 < held[1] < free[1])

    def test_the_common_scale_grows_from_the_most_connected_league(self):
        # 1 and 2 met often; 3 met each of them a little (enough together); 4 and 5 only each other; 6 nobody.
        pairs = {(1, 2): 40, (1, 3): 6, (2, 3): 5, (4, 5): 30, (3, 4): 2}
        self.assertEqual(power.common_scale(pairs), {1, 2, 3})
        self.assertEqual(power.common_scale({}), set())
        self.assertEqual(power.common_scale({(1, 2): 3}), set())


class RoleTest(unittest.TestCase):
    def test_slots(self):
        cases = [
            # (formation, slot, the team's highest slot, role)
            ("4-2-3-1", 11, 115, "goalkeeper"), ("4-2-3-1", 32, 115, "full_back"), ("4-2-3-1", 34, 115, "centre_back"),
            ("4-2-3-1", 64, 115, "defensive_midfielder"), ("4-2-3-1", 83, 115, "winger"), ("4-2-3-1", 85, 115, "winger"),
            ("4-2-3-1", 115, 115, "centre_forward"),
            # The wide forwards of a front three are wingers; those of a front four's centre are strikers.
            ("4-3-3", 103, 107, "winger"), ("4-3-3", 105, 107, "centre_forward"), ("4-3-3", 107, 107, "winger"),
            ("4-2-4", 103, 107, "centre_forward"), ("4-2-4", 92, 107, "winger"),
            ("4-3-3", 73, 107, "central_midfielder"), ("4-3-3", 75, 107, "central_midfielder"),
            # The wide players of a midfield line: wing-backs behind three defenders, wingers otherwise.
            ("4-4-2", 72, 106, "winger"), ("4-4-2", 74, 106, "central_midfielder"), ("4-4-2", 104, 106, "centre_forward"),
            ("3-4-3", 72, 107, "full_back"), ("3-4-3", 33, 107, "centre_back"), ("3-4-2-1", 62, 105, "full_back"),
            ("3-4-2-1", 64, 105, "defensive_midfielder"), ("3-4-2-1", 84, 105, "winger"), ("3-5-2", 71, 106, "full_back"),
            ("4-5-1", 71, 115, "winger"), ("5-3-2", 51, 106, "full_back"), ("5-2-3", 41, 105, "full_back"),
            # Behind a single holding midfielder the row above is the midfield.
            ("4-1-4-1", 65, 115, "defensive_midfielder"), ("4-1-4-1", 82, 115, "winger"), ("4-1-4-1", 84, 115, "central_midfielder"),
            ("3-1-4-2", 82, 106, "full_back"), ("4-3-2-1", 63, 115, "central_midfielder"), ("4-3-2-1", 65, 115, "defensive_midfielder"),
            # A lone man in the 90s row: the striker when nobody stands above him, a playmaker otherwise.
            ("4-4-1-1", 95, 115, "winger"), ("5-2-2-1", 95, 95, "centre_forward"),
            # A substitute's line code is no slot; a formation that is none leaves the slot's own reading.
            ("4-3-3", 1, 107, None), ("4-3-3", 3, 107, None), (None, 105, 105, "centre_forward"), ("343d", 34, 105, "centre_back"),
        ]
        for formation, slot, top, role in cases:
            self.assertEqual(power.role_of(formation, slot, top), role, (formation, slot))

    def test_substitutes_take_their_most_played_role(self):
        rows = [
            {"match_id": 1, "team_id": 5, "player_id": 7, "position_id": 115, "formation": "4-2-3-1", "minutes_played": 90.0},
            {"match_id": 2, "team_id": 5, "player_id": 7, "position_id": 3, "formation": "4-2-3-1", "minutes_played": 20.0},
            {"match_id": 2, "team_id": 5, "player_id": 8, "position_id": 2, "formation": "4-2-3-1", "minutes_played": 30.0},
            {"match_id": 2, "team_id": 5, "player_id": 9, "position_id": None, "formation": "4-2-3-1", "minutes_played": 30.0},
        ]
        out = {(r["match_id"], r["player_id"]): r["role"] for r in power.assign_roles(rows)}
        self.assertEqual(out, {(1, 7): "centre_forward", (2, 7): "centre_forward", (2, 8): "central_midfielder"})

    def test_a_team_s_league_of_the_year(self):
        leagues = {1: (True, True), 2: (True, False), 3: (False, False)}
        rows = [{"team_id": "A", "competition_id": 1}] * 3 + [{"team_id": "A", "competition_id": 9}] * 5  # 9: a European competition
        rows += [{"team_id": "B", "competition_id": 2}] * 2 + [{"team_id": "C", "competition_id": 3}] * 2 + [{"team_id": "D", "competition_id": 9}]
        self.assertEqual(power.team_leagues(rows, leagues), ({"A", "B"}, {"A"}))


class OmittedZeroTest(unittest.TestCase):
    def test_a_blank_is_a_zero_where_the_source_publishes_the_statistic(self):
        row = lambda match, edition, measured=True, **values: {"match_id": match, "competition_season_id": edition, "measured": measured, **values}
        rows = [
            row(1, 10, npxg=0.4, big_chances_missed=None, assists=1.0),  # the match has an xG, the edition an assist
            row(1, 10, npxg=None, big_chances_missed=None, assists=None),
            row(1, 10, measured=False, npxg=None, assists=None),  # a row without statistics stays unknown
            row(2, 10, npxg=None, assists=None, big_chances_missed=1.0),  # no xG in this match: unknown; a missed chance in the edition
            row(3, 20, npxg=None, assists=None, big_chances_missed=None),  # another edition, which shows nothing
        ]
        self.assertEqual(power.restore_zeros(rows), 5)
        self.assertEqual([(r.get("npxg"), r.get("assists"), r.get("big_chances_missed")) for r in rows],
                         [(0.4, 1.0, 0.0), (0.0, 0.0, 0.0), (None, None, None), (None, 0.0, 1.0), (None, None, None)])


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
            1: [("winger", 900, 3.0, 10, None), ("winger", 900, 1.0, 10, None)],
            2: [("winger", 1800, 2.0, 11, None)],
            3: [("winger", 200, 9.0, 11, None)],  # not eligible: under 900 minutes
            4: [("centre_back", 1000, -1.0, 12, None)],
        }
        out, settings = power.season_scores(contributions)
        self.assertEqual(settings, {"eligibility": 900.0, "level_weight": 0.0})  # no club strength known: no level
        self.assertAlmostEqual(out[1]["rate"], 90 * 4.0 / (1800 + 450))
        self.assertFalse(out[3]["eligible"])
        self.assertNotIn("score", out[3])
        self.assertEqual((out[1]["total_percentile"], out[2]["total_percentile"]), (75.0, 25.0))
        # Two players of a role stand one standard deviation either side of its mean on both measures.
        self.assertAlmostEqual(out[1]["index"], 1.0)
        self.assertAlmostEqual(out[2]["index"], -1.0)
        self.assertAlmostEqual(out[1]["score"], 100 / (1 + 10 ** (-1 / 4)))
        self.assertEqual((out[4]["index"], out[4]["score"]), (0.0, 50.0))  # alone in his role
        self.assertEqual([out[p]["rank"] for p in (1, 4, 2)], [1, 2, 3])
        self.assertEqual([out[p]["role_rank"] for p in (1, 2, 4)], [1, 2, 1])

    def test_a_young_year_asks_for_half_the_most_used_player_s_minutes(self):
        self.assertEqual(power.eligibility_minutes([3000, 1200]), 900)
        self.assertEqual(power.eligibility_minutes([1000, 300]), 500)
        self.assertEqual(power.eligibility_minutes([]), 0)
        contributions = {1: [("winger", 600, 1.0, 10, None)], 2: [("winger", 320, 2.0, 11, None)], 3: [("winger", 200, 3.0, 11, None)]}
        out, settings = power.season_scores(contributions)
        self.assertEqual(settings["eligibility"], 300)
        self.assertEqual([out[p]["eligible"] for p in (1, 2, 3)], [True, True, False])

    def test_the_club_level_takes_its_share_of_the_spread(self):
        # (role, rate of what the player does, rate of his club's level): the first centred by role.
        players = [("winger", 0.2, 0.5), ("winger", -0.2, -0.5), ("centre_back", 1.1, 0.25), ("centre_back", 0.9, -0.25)]
        own = (2 * 0.2**2 / 4 + 2 * 0.1**2 / 4) ** 0.5
        level = ((2 * 0.5**2 + 2 * 0.25**2) / 4) ** 0.5
        self.assertAlmostEqual(power.level_weight(players), own / level)
        self.assertAlmostEqual(power.level_weight(players, share=0.8), 2 * own / level)
        self.assertEqual(power.level_weight(players[:1]), 0.0)
        self.assertEqual(power.level_weight([("winger", 0.2, 0.0), ("winger", -0.2, 0.0)]), 0.0)
        # In a season: the same output in a stronger club ranks higher, and the total keeps its two parts.
        contributions = {
            1: [("winger", 1800, 2.0, 10, 4.0)], 2: [("winger", 1800, 2.0, 11, -4.0)],
            3: [("winger", 1800, 3.0, 12, 0.0)], 4: [("winger", 1800, 1.0, 13, 0.0)],
        }
        out, settings = power.season_scores(contributions)
        kappa = settings["level_weight"]
        self.assertGreater(kappa, 0)
        self.assertAlmostEqual(out[1]["total"], 2.0 + kappa * 4.0)
        self.assertAlmostEqual(out[1]["own"] + kappa * out[1]["level"], out[1]["total"])
        self.assertLess(out[1]["rank"], out[2]["rank"])

    def test_a_league_off_the_common_scale_has_a_score_and_no_rank(self):
        contributions = {
            1: [("winger", 1800, 2.0, 10, None)], 2: [("winger", 1800, 1.0, 10, None)], 3: [("winger", 1800, 0.0, 10, None)],
            4: [("winger", 1800, 9.0, 20, None)],  # the best output, in a league nothing ties to the others
            5: [("winger", 1800, 3.0, 30, None)],  # on the scale, in a second division
        }
        out, _ = power.season_scores(contributions, linked={10, 30}, top={10})
        self.assertNotIn("rank", out[4])
        self.assertTrue(out[4]["eligible"] and out[4]["score"] > out[5]["score"])
        self.assertEqual([out[p]["rank"] for p in (5, 1, 2, 3)], [1, 2, 3, 4])
        self.assertEqual([out[p]["top_division"] for p in (1, 4, 5)], [True, False, False])
        # The award race: the ranked players of a top division, numbered in their order.
        self.assertEqual([(no, player) for no, player, _, _ in power.award_race(out)], [(1, 1), (2, 2), (3, 3)])

    def test_the_award_year(self):
        from datetime import date

        self.assertEqual(power.award_year(2026), (date(2026, 8, 1), date(2027, 8, 1)))


if __name__ == "__main__":
    unittest.main()
