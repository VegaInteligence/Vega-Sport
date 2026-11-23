"""Power rankings (docs/METHODE_CLASSEMENT_BALLON_D_OR.md): the formulas, without a database.
The database pass over a synthetic season is in test_models.py."""

from math import exp
from pathlib import Path
import random
import sys
import unittest
from math import sqrt
from statistics import NormalDist

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
        # The leagues' levels read the same weighted Elo: with no match between the two leagues, each holds its prior.
        levels = power.league_model(matches, {"A": 1, "B": 1, "C": 2, "D": 2}, weights={2: 1.3225})[0]
        self.assertEqual({round(v) for v in levels.values()}, {1500})

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
        for k in range(12):
            for home, away in (("A", "C"), ("D", "B")):
                i += 1
                # The first league's clubs win three in four.
                won = k % 4 != 3
                rows.append(m(i, home, away, *((2, 0) if (home == "A") == won else (0, 2)), 9, international=True))
        return rows

    def test_a_club_s_league_is_the_domestic_one_of_its_first_season(self):
        rows = self.season() + [self.match(900, "A", "C", 1, 0, 2, season=2026)]
        self.assertEqual(power.home_leagues(rows), {"A": 1, "B": 1, "C": 2, "D": 2})
        # A club whose league the base does not hold (it plays a European competition only) has its country's.
        rows += [self.match(901, "A", "Q", 0, 1, 9, international=True), self.match(902, "N", "A", 1, 1, 9, international=True)]
        leagues = power.home_leagues(rows, {"A": "ENG", "Q": "AZE"})
        self.assertEqual((leagues["A"], leagues["Q"], "N" in leagues), (1, (power.COUNTRY_LEAGUE, "AZE"), False))
        # It is fitted like a league, with its confederation's prior, and holds no reference.
        levels, se, settings = power.league_model(rows, leagues, countries={1: "ENG", 2: "GER", (power.COUNTRY_LEAGUE, "AZE"): "AZE"})
        self.assertIn((power.COUNTRY_LEAGUE, "AZE"), levels)
        self.assertNotIn((power.COUNTRY_LEAGUE, "AZE"), settings["reference"])
        self.assertEqual(dict(power.league_links(rows, leagues)), {(1, 2): 25, (1, (power.COUNTRY_LEAGUE, "AZE")): 1})  # 900 is a match between the two leagues too

    def test_every_country_has_its_confederation(self):
        # A country's group takes its confederation's prior, not the world's: every FIFA member is mapped (17 Nov 2026,
        # the CAF Champions League in the Elo brought clubs of Tanzania, Angola, DR Congo, Guinea… into it).
        for code, conf in (("TAN", "CAF"), ("ANG", "CAF"), ("COD", "CAF"), ("CIV", "CAF"), ("GUI", "CAF"), ("SEN", "CAF"), ("SDN", "CAF"),
                           ("MAR", "CAF"), ("ZAN", "CAF"), ("URU", "CONMEBOL"), ("HAI", "CONCACAF"), ("DOM", "CONCACAF"), ("ARM", "UEFA"),
                           ("AZE", "UEFA"), ("KOS", "UEFA"), ("UAE", "AFC"), ("JOR", "AFC"), ("NZL", "OFC"), ("FIJ", "OFC")):
            self.assertEqual(power.CONFEDERATIONS.get(code), conf, code)

    def test_a_closed_continental_cluster_does_not_lift_its_held_league(self):
        # The CAF Champions League (17 Nov 2026): a league the base holds (Egypt's), measured against the world, whose
        # clubs beat a dozen country groups that play no one else. The groups and Egypt share their confederation's
        # mean, itself estimated: beating them says how far above them Egypt stands, not where Africa stands against
        # the world. Egypt's level against the world's leagues moves by less than its error (measured in production
        # with independent priors at the world mean: +108, twice its error; here +139 against +50 now).
        m, rows, i = self.match, [], 0
        world = {"A": 1, "B": 1, "C": 2, "D": 2, "E": 3, "F": 3, "X": 10, "Y": 10}
        for k in range(10):
            for home, away in (("A", "C"), ("D", "E"), ("F", "B"), ("C", "E")):
                i += 1
                rows.append(m(i, home, away, *((1, 0) if k % 3 else (0, 1)), 9, international=True))
        for k in range(40):  # Egypt's clubs against the world: they lose most.
            i += 1
            rows.append(m(i, "X" if k % 2 else "Y", "ABCDEF"[k % 6], *((0, 1) if k % 4 else (1, 1)), 9, international=True))
        codes = ("TAN", "ANG", "COD", "CIV", "GUI", "SEN", "MLI", "ETH", "SDN", "GHA", "ZAM", "KEN")
        cluster = []
        for code in codes:
            for k in range(6):  # Egypt's clubs beat each group three times in four.
                i += 1
                cluster.append(m(i, "X" if k % 2 else "Y", "G" + code, *((2, 0) if k % 4 != 3 else (0, 1)), 8, international=True))
        countries = {1: "ENG", 2: "GER", 3: "ITA", 10: "EGY", **{(power.COUNTRY_LEAGUE, c): c for c in codes}}
        before, se, _ = power.league_model(rows, world, countries=countries)
        leagues = {**world, **{"G" + c: (power.COUNTRY_LEAGUE, c) for c in codes}}
        after, _, settings = power.league_model(rows + cluster, leagues, countries=countries)
        against_world = lambda levels: levels[10] - (levels[1] + levels[2] + levels[3]) / 3  # the scale itself is a gauge
        self.assertLess(abs(against_world(after) - against_world(before)), se[10])
        self.assertLess(max(after[(power.COUNTRY_LEAGUE, c)] for c in codes), after[10])  # beaten, they stand below Egypt
        self.assertIn("CAF", settings["confederations"])

    def test_a_club_only_a_complementary_source_holds_has_its_group(self):
        # One Elo for every club (the user, 16 Nov 2026; VI-21): a club no PitchAPI league holds enters
        # at the level of its group: the complementary league it plays in (its folder: country and
        # division), else its country's clubs of the national cups, else, for a club of a continental cup
        # written « Name (XXX) », its country's league; a PitchAPI club keeps its league.
        from datetime import date

        m = lambda i, h, a, key, competition=50: (i, 2026, None, h, a, 1, 0, False, date(2026, 9, 1 + i), competition, True, False, key)
        rows = [self.match(1, "P", "Q", 1, 0, 1, season=2026)]
        rows += [m(2, "N1", "N2", "open-matchday:ENG_5_national-league:2026/2027", 60), m(3, "P", "N1", "open-matchday:ENG_CUP_fa-cup:2026/2027", 61),
                 m(4, "N2", "AM", "open-matchday:ENG_CUP_fa-cup:2026/2027", 61), m(5, "FR", "P", "open-cups:france-cup:2024/2025", 62),
                 m(6, "UY", "AR", "open-cups:copa-libertadores:2026", 63), m(7, "IE", "AM", "open-matchday:IRE_2_first-division:2026/2027", 64),
                 m(8, "DE", "P", "openligadb:germany-cup:2026/2027", 65)]
        leagues = power.home_leagues(rows, {"P": "ENG", "Q": "ENG", "AR": "ARG"})
        names = {"UY": "Peñarol (URU)", "AR": "Boca Juniors (ARG)"}
        leagues = power.complementary_leagues(rows, leagues, names)
        self.assertEqual(leagues["P"], 1)
        self.assertEqual((leagues["N1"], leagues["N2"]), (("league", "ENG_5_national-league"),) * 2)
        self.assertEqual(leagues["AM"], ("league", "IRE_2_first-division"))  # a league it plays in, before a cup
        self.assertEqual((leagues["FR"], leagues["DE"]), (("cup", "FRA"), ("cup", "GER")))
        self.assertEqual(leagues["UY"], (power.COUNTRY_LEAGUE, "URU"))
        self.assertEqual(leagues["AR"], (power.COUNTRY_LEAGUE, "ARG"))  # its country, as before
        self.assertEqual(leagues["IE"], ("league", "IRE_2_first-division"))

    def test_a_complementary_group_s_country_and_division(self):
        self.assertEqual(power.group_facts(("league", "ENG_5_national-league")), ("ENG", 5))
        self.assertEqual(power.group_facts(("league", "IRE_2_first-division")), ("IRL", 2))
        self.assertEqual(power.group_facts(("league", "BEL_U21_pro-league")), ("BEL", 3))  # a reserve league: below the second division
        # A country's cup clubs stand one division below the lowest league the Elo holds of that country.
        tiers = {1: 1, 2: 2, ("league", "ENG_5_national-league"): 5, ("league", "ENG_7_northern-premier-league"): 7, 9: 1}
        countries = {1: "ENG", 2: "ENG", ("league", "ENG_5_national-league"): "ENG", ("league", "ENG_7_northern-premier-league"): "ENG", 9: "ESP"}
        self.assertEqual(power.cup_tiers([("cup", "ENG"), ("cup", "ESP"), ("cup", "SUI")], tiers, countries), {("cup", "ENG"): 8, ("cup", "ESP"): 2, ("cup", "SUI"): 2})
        # Every national cup the sources hold names its country.
        from vega.sources import cups

        self.assertTrue(all(power.CUP_COUNTRIES.get(key) for key in cups.NATIONAL_CUP_ARCHIVES))

    def test_complementary_groups_measure_no_reference(self):
        # A complementary league or cup group is fitted with its prior, but holds no reference and sets no tier gap.
        rows = self.season()
        from datetime import date

        rows += [(900 + k, 2025, None, "A" if k % 2 else "X", "X" if k % 2 else "A", 2, 0, False, date(2026, 1, 1 + k), 70, True, False,
                  "open-matchday:ENG_CUP_fa-cup:2025/2026") for k in range(6)]
        leagues = dict(power.home_leagues(rows), X=("cup", "ENG"))
        levels, se, settings = power.league_model(rows, leagues, countries={1: "ENG", 2: "GER", ("cup", "ENG"): "ENG"}, tiers={1: 1, 2: 1, ("cup", "ENG"): 2})
        self.assertIn(("cup", "ENG"), levels)
        self.assertNotIn(("cup", "ENG"), settings["reference"])
        self.assertLess(levels[("cup", "ENG")], levels[1])

    def test_a_copy_of_a_pitchapi_league_never_enters_the_elo(self):
        # open-matchday's copies of PitchAPI's leagues (open_matchday.COVERED) double PitchAPI's matches under
        # other names: the Elo never reads them, whether or not the reader has removed them yet (17 Nov 2026,
        # the Elo ran at 00:32 with the copies still in the base).
        from datetime import date

        row = lambda i, key: (i, 2026, None, "A", "B", 1, 0, False, date(2026, 9, i), 50, True, False, key)
        rows = [row(1, "open-matchday:ENG_1_premier-league:2026/2027"), row(2, "open-matchday:ENG_5_national-league:2026/2027"),
                row(3, "open-matchday:UEFA_1_champions-league:2026/2027"), row(4, "open-matchday:ENG_CUP_fa-cup:2026/2027")]
        self.assertEqual([r[0] for r in power.elo_matches(rows)], [2, 4])

    def test_a_cup_two_sources_hold_is_read_from_one(self):
        # The German cup comes from OpenLigaDB (its rounds) and open-matchday: the Elo reads OpenLigaDB's, since the
        # two write the same amateur clubs two ways (« HEBC Hamburg », « Hamburg Eimsbütteler BC »), one match counting twice.
        from datetime import date

        row = lambda i, key: (i, 2026, None, "A", "B", 1, 0, False, date(2026, 9, i), 50, True, False, key)
        rows = [row(1, "open-matchday:GER_CUP_dfb-pokal:2026/2027"), row(2, "openligadb:germany-cup:2026/2027")]
        self.assertEqual([r[0] for r in power.elo_matches(rows)], [2])

    def test_the_elo_reads_each_team_as_the_identity_rules_name_it(self):
        # A copy the identity pass has not merged yet (it runs once a day) plays as its club: never a club of its own.
        from datetime import date

        rows = [(1, 2026, None, "copy", "B", 1, 0, False, date(2026, 9, 1), 50, True, False, "x"),
                (2, 2026, None, "copy", "club", 1, 0, False, date(2026, 9, 2), 50, True, False, "x"),
                (3, 2026, None, "C", "D", 1, 0, False, date(2026, 9, 3), 1, False, False, None)]
        merged = power.merged_rows(rows, {"copy": "club"})
        self.assertEqual([(r[0], r[3], r[4]) for r in merged], [(1, "club", "B"), (3, "C", "D")])  # a club against itself is no match

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
        levels, se, settings = power.league_model(rows, leagues)
        self.assertGreater(levels[1], levels[2] + 80)
        self.assertAlmostEqual(levels[1] + levels[2], 3000, places=3)  # the matches say only the gap; the priors are alike
        self.assertLess(settings["rounds"], power.NEWTON_ROUNDS)
        # The clubs start there: before its first match, a club of the first league stands above one of the second.
        first = {}
        for _, team, _, _, before, *_ in power.elo_updates(rows, seeds=levels, leagues=leagues):
            first.setdefault(team, before)
        self.assertEqual((first["A"], first["C"]), (levels[1], levels[2]))
        # Without a match between them, the two leagues hold their prior: an Elo only moves points inside a league.
        alone = [r for r in rows if not r[11]]
        self.assertEqual({round(v) for v in power.league_model(alone, leagues)[0].values()}, {1500})
        # Fewer matches between them, the first league winning two in three: a smaller gap, known less well.
        cross = [r for r in rows if r[11]]
        few = alone + [cross[k] for k in (0, 1, 2, 3, 6, 7)]
        held, held_se, _ = power.league_model(few, leagues)
        self.assertTrue(0 < held[1] - held[2] < levels[1] - levels[2])
        self.assertGreater(held_se[2], se[2])

    def test_a_league_without_matches_against_others_takes_its_division_and_its_moves(self):
        m, rows, i = self.match, self.season(), 1000
        # A second division (3, under league 1's country) and a far league (4), whose clubs only meet each other.
        for home, away, competition in (("E", "F", 3), ("F", "E", 3), ("G", "H", 4), ("H", "G", 4)):
            i += 1
            rows.append(m(i, home, away, 1, 1, competition))
        leagues = power.home_leagues(rows)
        countries, tiers = {1: "ENG", 2: "GER", 3: "ENG", 4: "USA"}, {3: 2}
        levels, se, _ = power.league_model(rows, leagues, tiers=tiers, countries=countries)
        self.assertAlmostEqual(levels[1] - levels[3], power.TIER_GAP, places=6)  # a division below, nothing else said
        alone = levels[4]
        # Twenty players left league 1 for league 4 and did much better there: league 4 is well below league 1.
        moves = ([(1, 4, 20, 0.10)], 0.02)
        moved, moved_se, _ = power.league_model(rows, leagues, tiers=tiers, countries=countries, moves=moves)
        self.assertLess(moved[4], alone - 50)
        self.assertLess(moved_se[4], se[4])
        # The same move told from league 4's side says the same.
        back, *_ = power.league_model(rows, leagues, tiers=tiers, countries=countries, moves=([(4, 1, 20, -0.10)], 0.02))
        self.assertAlmostEqual(back[4], moved[4], places=6)
        # A women's league is apart: no level on this scale.
        self.assertNotIn(4, power.league_model(rows, leagues, countries=countries, apart={4})[0])

    def test_moves_between_leagues_with_the_regression_of_a_good_season_removed(self):
        from datetime import date

        d = lambda y, mth: date(y, mth, 1)
        stints = []
        # Stayers in league 1: a year's rate (per 90, against the league-season's) keeps half of itself the next year.
        for k in range(40):
            first = 0.2 if k % 2 else -0.2
            stints += [(2024, 100 + k, 1, 1800, (1.0 + first) * 20, d(2023, 8), d(2024, 5), "winger"),
                       (2025, 100 + k, 1, 1800, (1.0 + first / 2) * 20, d(2024, 8), d(2025, 5), "winger")]
        # Two movers from 1 to 2 after a good season, a mover from 2 to 1, and a goalkeeper (left out).
        stints += [(2024, 1, 1, 1800, 1.4 * 20, d(2023, 8), d(2024, 5), "winger"), (2025, 1, 2, 1800, 1.0 * 20, d(2024, 8), d(2025, 5), "winger"),
                   (2024, 2, 1, 1800, 1.4 * 20, d(2023, 8), d(2024, 5), "winger"), (2025, 2, 2, 1800, 1.0 * 20, d(2024, 8), d(2025, 5), "winger"),
                   (2024, 3, 2, 1800, 1.0 * 20, d(2023, 8), d(2024, 5), "winger"), (2025, 3, 1, 1800, 1.2 * 20, d(2024, 8), d(2025, 5), "winger"),
                   (2024, 4, 1, 1800, 9.0 * 20, d(2023, 8), d(2024, 5), "goalkeeper"), (2025, 4, 2, 1800, 0.0, d(2024, 8), d(2025, 5), "goalkeeper")]
        pairs, variance, facts = power.move_evidence(stints)
        self.assertEqual((facts["stayers"], facts["moves"]), (40, 3))
        self.assertAlmostEqual(facts["persistence"], 0.5, places=6)
        ((a, b, movers, change),) = pairs
        self.assertEqual((a, b, movers), (1, 2, 3))  # the move from 2 to 1 counts with its sign changed
        self.assertGreater(variance, 0)
        # Against the regression the stayers show, a good season before the move says nothing of the leagues.
        naive = sum([(1.0 - 1.4), (1.0 - 1.4), -(1.2 - 1.0)]) / 3
        self.assertGreater(change, naive)
        # A European competition's stint between two years of one league hides the stay; only the leagues count.
        europe = stints + [(2024, 100 + k, 9, 900, 18.0, d(2023, 9), d(2024, 4), "winger") for k in range(40)]
        self.assertEqual(power.move_evidence(europe, leagues={1, 2})[2]["stayers"], 40)
        self.assertLess(power.move_evidence(europe)[2]["stayers"], 40)

    def test_the_linear_algebra(self):
        a = [[4.0, 1.0, 0.0], [1.0, 3.0, 1.0], [0.0, 1.0, 2.0]]
        x = power._solve(a, [1.0, 2.0, 3.0])
        self.assertTrue(all(abs(sum(a[i][j] * x[j] for j in range(3)) - b) < 1e-12 for i, b in enumerate([1.0, 2.0, 3.0])))
        inv = power._inverse(a)
        for i in range(3):
            for j in range(3):
                self.assertAlmostEqual(sum(a[i][k] * inv[k][j] for k in range(3)), 1.0 if i == j else 0.0, places=12)
        # Against the mean of a reference set, the reference itself has the error of its own spread.
        self.assertAlmostEqual(power._relative_se([[1.0, 0.0], [0.0, 1.0]], [0])[0], 0.0)
        self.assertAlmostEqual(power._relative_se([[1.0, 0.0], [0.0, 1.0]], [0])[1], 2 ** 0.5)

    def test_a_league_s_level_season_by_season(self):
        # Each club's strength after its last match of the season, in the league it played that season.
        m = lambda mid, season, home, away, league, cup=False, international=False: (mid, season, None, home, away, 1, 0, False, None, league, cup, international)
        matches = [m(1, 2024, "A", "B", 1), m(2, 2024, "C", "D", 2), m(3, 2024, "A", "C", 9, international=True),
                   m(4, 2025, "A", "C", 1), m(5, 2025, "B", "D", 2), m(6, 2025, "A", "D", 8, cup=True)]
        rows = list(power.elo_updates(matches))
        last = {(season, team): after for _, team, season, _, _, after, _, _ in rows}
        levels = power.league_seasons(rows, matches)
        self.assertEqual(set(levels), {(1, 2024), (2, 2024), (1, 2025), (2, 2025)})  # a European night and a cup are no league
        self.assertAlmostEqual(levels[(1, 2024)][0], (last[(2024, "A")] + last[(2024, "B")]) / 2)
        # C was promoted and B relegated: the league of 2025 is A and C, whatever league they started in.
        self.assertEqual(levels[(1, 2025)][1], 2)
        self.assertAlmostEqual(levels[(1, 2025)][0], (last[(2025, "A")] + last[(2025, "C")]) / 2)
        self.assertAlmostEqual(levels[(2, 2025)][0], (last[(2025, "B")] + last[(2025, "D")]) / 2)


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
        # Clubs: the teams of a league, measured or not (D plays a European competition only).
        self.assertEqual(power.team_leagues(rows, leagues), ({"A", "B"}, {"A"}, set(), {"A", "B", "C"}))


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

    def test_duel_attempts_are_added_once_the_blanks_have_their_zeros(self):
        # Issue #71 (calculation audit of 16 November 2026, item 1). The attempts are the duels won
        # and lost. Added in SQL, a blank side made the sum a blank, which was then read as no
        # attempt: five duels won and none lost stood five above an expectation of 0.
        row = lambda match, measured=True, **values: {"match_id": match, "competition_season_id": 10, "measured": measured, **values}
        rows = [
            row(1, duels_won=4.0, duels_lost=3.0),  # D6: both written
            row(1, duels_won=5.0, duels_lost=None),  # D1: none lost
            row(1, duels_won=None, duels_lost=3.0),  # D2: none won
            row(1, duels_won=None, duels_lost=None),  # D3: no duel
            row(1, measured=False, duels_won=None, duels_lost=None),  # D4: a row without statistics stays unknown
            row(2, duels_won=2.0, duels_lost=None),  # D5: this match shows no duel lost, the attempts stay unknown
        ]
        self.assertEqual(power.restore_zeros(rows), 4)
        self.assertEqual([r["duels_attempted"] for r in rows], [7.0, 5.0, 3.0, 0.0, None, None])
        # D7: nobody wins more duels than he attempts.
        self.assertTrue(all(0 <= r["duels_won"] <= r["duels_attempted"] for r in rows if r["duels_attempted"] is not None))
        # A total is never given a zero of its own: it comes from its parts.
        self.assertNotIn("duels_attempted", power.ZERO_IN_MATCH + power.ZERO_IN_EDITION)


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
        # By the year's own index; equal indices by total, then minutes.
        scored = {
            1: {"eligible": True, "rank": 1, "total": 5.0, "minutes": 1000, "team": 9, "index": 2.0, "index_season": 2.4},
            2: {"eligible": True, "rank": 2, "total": 4.0, "minutes": 1000, "team": 9, "index": 1.6, "index_season": 1.5},
            3: {"eligible": True, "rank": 2, "total": 4.0, "minutes": 1200, "team": 8, "index": 1.6, "index_season": 1.5},
            4: {"eligible": False, "rank": None, "total": 9.0, "minutes": 300, "team": 8, "index": 3.0, "index_season": 3.0},
        }
        self.assertEqual(power.award_race(scored), [(1, 1, 9, power.score_of(2.4)), (2, 3, 8, power.score_of(1.5)), (3, 2, 9, power.score_of(1.5))])
        self.assertEqual(len(power.award_race({i: dict(scored[1], rank=i) for i in range(1, 50)})), 30)

    def test_season_score_regularises_and_ranks_within_the_role(self):
        contributions = {
            1: [("winger", 900, 3.0, 10, None), ("winger", 900, 1.0, 10, None)],
            2: [("winger", 1800, 2.0, 11, None)],
            3: [("winger", 200, 9.0, 11, None)],  # not eligible: under 900 minutes
            4: [("centre_back", 1000, -1.0, 12, None)],
        }
        out, settings = power.season_scores(contributions)
        self.assertEqual(settings, {"eligibility": 900.0, "level_weight": 0.0, "level_weights": {"men": 0.0}})  # no club strength known: no level
        self.assertAlmostEqual(out[1]["rate"], 90 * 4.0 / (1800 + 450))
        self.assertFalse(out[3]["eligible"])
        self.assertNotIn("total_percentile", out[3])  # percentiles stay among the eligible
        self.assertEqual((out[1]["total_percentile"], out[2]["total_percentile"]), (75.0, 25.0))
        # Two players of a role stand one standard deviation either side of its mean on both measures.
        self.assertAlmostEqual(out[1]["index"], 1.0)
        self.assertAlmostEqual(out[2]["index"], -1.0)
        self.assertAlmostEqual(out[1]["score"], 100 / (1 + 10 ** (-1 / 4)))
        self.assertEqual((out[4]["index"], out[4]["score"]), (0.0, 50.0))  # alone in his role
        # Under the bar: from the role's floor (its 10th percentile, here the lower of two) to his own
        # index, in proportion to his minutes. 200 of 900: two ninths of the way.
        own = 0.75 * (9.0 - 3.0) / 1.0 + 0.25 * (90 * 9.0 / 650 - 0.12) / 0.04
        self.assertAlmostEqual(out[3]["index"], -1.0 + 200 / 900 * (own + 1.0))
        self.assertAlmostEqual(out[3]["score"], power.score_of(out[3]["index"]))
        # Everyone is ranked; an extreme short run (nine times the regulars' output in a ninth of their minutes) can lead.
        self.assertEqual([out[p]["rank"] for p in (3, 1, 4, 2)], [1, 2, 3, 4])
        self.assertEqual([out[p]["role_rank"] for p in (3, 1, 2, 4)], [1, 2, 3, 1])
        # A short run like the regulars' stays below them: half their rate over 100 minutes.
        modest = power.season_scores({**contributions, 3: [("winger", 100, 0.1, 11, None)]})[0]
        self.assertLess(modest[3]["index"], modest[2]["index"])

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

    def test_a_provisional_league_s_player_is_ranked_and_out_of_the_award_race(self):
        contributions = {
            1: [("winger", 1800, 2.0, 10, None)], 2: [("winger", 1800, 1.0, 10, None)], 3: [("winger", 1800, 0.0, 10, None)],
            4: [("winger", 1800, 9.0, 20, None)],  # the best output, in a league nothing ties to the others
            5: [("winger", 1800, 3.0, 30, None)],  # on the scale, in a second division
        }
        out, _ = power.season_scores(contributions, linked={10, 30}, top={10})
        # Ranked, marked provisional (linked false); the references stay those of measured leagues.
        self.assertTrue(out[4]["eligible"] and not out[4]["linked"] and out[4]["score"] > out[5]["score"])
        self.assertEqual([out[p]["rank"] for p in (4, 5, 1, 2, 3)], [1, 2, 3, 4, 5])
        # A player of a team the base knows in no league (a national team, a club seen in European
        # cups only) is ranked among the men all the same, provisionally (not linked), not in_league.
        alone = power.season_scores(contributions, linked={10, 30}, top={10}, clubs={10, 20})[0]
        self.assertEqual([alone[p]["rank"] for p in (4, 5, 1, 2, 3)], [1, 2, 3, 4, 5])
        self.assertEqual([alone[p]["club"] for p in (4, 5)], [True, False])
        self.assertEqual([out[p]["top_division"] for p in (1, 4, 5)], [True, False, False])
        # The award race: the ranked players of a top division, numbered in their order.
        self.assertEqual([(no, player) for no, player, _, _ in power.award_race(out)], [(1, 1), (2, 2), (3, 3)])

    def test_last_season_is_a_prior_that_fades_with_the_minutes(self):
        contributions = {p: [("winger", 1800, 1.0 + 0.1 * p, 10, None)] for p in range(1, 9)}
        contributions[9] = [("winger", 180, 0.4, 10, None)]  # two matches so far
        base, _ = power.season_scores(contributions)
        previous = {9: (2.0, "winger", 10), 1: (-3.0, "winger", 10)}
        out, _ = power.season_scores(contributions, previous=previous)
        # The year's own index is kept; the index shown leans on last season while he has hardly played.
        self.assertEqual(out[9]["index_season"], base[9]["index"])
        m, w0 = 180, power.PRIOR_MINUTES
        w = w0 / (m + w0) * (1 - m / power.PRIOR_FADE)
        self.assertAlmostEqual(out[9]["index"], w * power.PRIOR_RHO * 2.0 + (1 - w) * base[9]["index"])
        self.assertGreater(out[9]["index"], base[9]["index"])
        self.assertAlmostEqual(out[9]["score"], power.score_of(out[9]["index"]))
        # From PRIOR_FADE minutes on, the prior is gone.
        self.assertEqual(out[1]["index"], base[1]["index"])
        # A change of club or role halves its weight.
        moved, _ = power.season_scores(contributions, previous={9: (2.0, "winger", 99)})
        wh = (w0 / 2) / (m + w0 / 2) * (1 - m / power.PRIOR_FADE)
        self.assertAlmostEqual(moved[9]["index"], wh * power.PRIOR_RHO * 2.0 + (1 - wh) * base[9]["index"])
        # The award race reads the year's own index.
        self.assertEqual(power.award_race(out), power.award_race(base))

    def test_the_women_have_a_ranking_of_their_own_and_a_lone_role_is_placed(self):
        contributions = {
            1: [("winger", 1800, 2.0, 10, None)], 2: [("winger", 1800, 1.0, 10, None)],
            3: [("winger", 1800, 3.0, 50, None)], 4: [("winger", 1800, 0.5, 50, None)],
            5: [("goalkeeper", 300, 0.4, 50, None)],  # the only keeper of the women, under the bar
        }
        out, settings = power.season_scores(contributions, linked={10}, top={10}, women={50})
        # Each universe is numbered from 1, and so is each role within it.
        self.assertEqual([(out[p]["universe"], out[p]["rank"]) for p in (1, 2)], [("men", 1), ("men", 2)])
        self.assertEqual(sorted(out[p]["rank"] for p in (3, 4, 5)), [1, 2, 3])
        self.assertEqual(out[3]["rank"], 1)
        self.assertEqual([out[p]["role_rank"] for p in (1, 3, 5)], [1, 1, 1])
        # A role without an eligible player of its universe is placed against the universe's eligible
        # players: between their floor and his own index, as any player under the bar.
        self.assertIsNotNone(out[5]["index"])
        self.assertIn("women", settings["level_weights"])

    def test_a_match_grade_reads_the_match_alone_against_its_role(self):
        # Reference year: wingers' full matches spread around 0 in two competitions, one wider; keepers' around 0.
        rows = [("winger", 1, 90, c) for c in (-0.5, -0.25, 0.0, 0.25, 0.5) * 80] + [("winger", 2, 90, c) for c in (-1.0, 0.0, 1.0) * 120]
        rows += [("goalkeeper", 1, 90, c) for c in (-2.0, -0.5, 0.0, 0.0, 0.3, 0.4) * 50] + [("winger", 1, 15, 3.0)]  # a cameo: not a reference
        refs = power.grade_references(rows)
        n, mean, sd = refs["roles"]["winger"]
        self.assertEqual(n, 760)
        # A competition's spread is drawn to its role's: n / (n + 300) of its own.
        n2, sd2 = refs["spreads"][("winger", 2)]
        self.assertEqual(n2, 360)
        self.assertTrue(sd < sd2 < sqrt(sum((c - mean) ** 2 for r, comp, m, c in rows if r == "winger" and comp == 2) / 360))
        # An ordinary match of the role is 50; the same contribution weighs less where matches spread wider.
        self.assertAlmostEqual(power.score_of(power.match_index("winger", 1, mean, refs)), 50.0, delta=1.0)
        one, two = power.match_index("winger", 1, 0.5, refs), power.match_index("winger", 2, 0.5, refs)
        self.assertGreater(one, two)
        # Above every reference match: half a match from the edge, the normal score of the best ever seen.
        self.assertAlmostEqual(power.match_index("winger", 1, 99.0, refs), NormalDist().inv_cdf(1 - 0.5 / 760))
        # The same share of the role's matches below is the same grade, whatever the role.
        best_keeper = power.match_index("goalkeeper", 1, 0.45, refs)
        self.assertAlmostEqual(best_keeper, NormalDist().inv_cdf(1 - 0.5 / 300))
        self.assertIsNone(power.match_index("centre_back", 1, 0.5, refs))  # no reference for the role

    def test_a_match_grade_is_read_against_a_finished_year_only(self):
        from datetime import date

        today = date(2026, 11, 15)  # the 2026 award year is in progress, 2025's is over
        self.assertEqual(power.grade_reference_year(2024, today), 2024)  # over: itself
        self.assertEqual(power.grade_reference_year(2025, today), 2025)
        self.assertEqual(power.grade_reference_year(2026, today), 2025)  # in progress: the year before
        self.assertIsNone(power.grade_reference_year(2027, today))  # after it: no finished year before
        self.assertEqual(power.grade_reference_year(2026, date(2027, 8, 1)), 2026)  # over on 1 August

    def test_the_award_year(self):
        from datetime import date

        self.assertEqual(power.award_year(2026), (date(2026, 8, 1), date(2027, 8, 1)))


if __name__ == "__main__":
    unittest.main()
