"""The Ballon d'Or race on the Score Vega v9.1 with the three criteria, stage 1 (issue #105, FAILURE_MODES §59,
59a–59c, 59f–59n, 59u–59w): the formulas, without a database. The database pass over the synthetic season is in
test_models.py (59b, 59d–59k, 59o, 59p, 59s, 59t, 59v), the worker's in test_collection_wakeups.py (59p), the partial
year in test_award_year_2020_order.py (59r), the migration in test_deploy_migrations.py (59u), the reads in
backend/api/test/rankings.test.mjs (59q, 59s)."""

import importlib
import json
from pathlib import Path
import random
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))
from vega import level, power  # noqa: E402
from test_level import cell, person, references  # noqa: E402

CB, CM, CF, FB, GK = level.CENTRE_BACK, level.CENTRAL_MIDFIELDER, level.CENTRE_FORWARD, level.FULL_BACK, level.GOALKEEPER
NB = len(level.BLOCKS)
# A side of the synthetic season: (slot, v8 role).
SIDE = ((11, "goalkeeper"), (32, "full_back"), (33, "centre_back"), (34, "centre_back"), (35, "full_back"),
        (63, "central_midfielder"), (64, "central_midfielder"), (93, "centre_forward"))
CLUBS = (1, 2, 3, 4)
NATIONS = (900, 901)
CENTRE = 1500.0
BACK = 133  # club 1's centre-back (slot 33): his position is not recentred


def award():
    """vega.award, imported per test: until it exists each case fails on its own."""
    return importlib.import_module("vega.award")


def stats(rng, slot, minutes):
    """One player-match's indicators, every one the level reads."""
    n = lambda top: rng.randint(0, top)
    tried = {"dribbles_total": n(5), "duels_attempted": n(12), "aerials_total": n(6), "accurate_passes_total": 20 + n(50), "long_balls_total": n(8)}
    return {
        "np_goals": n(1), "npxg": round(rng.random() * 0.6, 2), "shots_on_target": n(3), "big_chances_missed": n(1),
        "assists": n(1), "xa": round(rng.random() * 0.4, 2), "chances_created": n(3), "big_chances_created": n(1),
        "passes_into_final_third": n(8), "progressive_passes": n(7), "progressive_carries": n(5),
        "dribbles_succeeded": rng.randint(0, tried["dribbles_total"]), "dribbles_total": tried["dribbles_total"],
        "tackles": n(5), "interceptions": n(4), "recoveries": n(9), "clearances": n(6), "shot_blocks": n(2),
        "duels_won": rng.randint(0, tried["duels_attempted"]), "duels_attempted": tried["duels_attempted"],
        "aerials_won": rng.randint(0, tried["aerials_total"]), "aerials_total": tried["aerials_total"],
        "dribbled_past": n(3), "errors_led_to_goal": int(rng.random() < 0.05),
        "accurate_passes": rng.randint(tried["accurate_passes_total"] // 2, tried["accurate_passes_total"]),
        "accurate_passes_total": tried["accurate_passes_total"], "dispossessed": n(3), "touches": 30 + n(60),
        "goals_prevented": round(rng.gauss(0, 0.4), 2) if slot == 11 else None,
        "high_claims": n(3) if slot == 11 else None, "punches": n(2) if slot == 11 else None,
        "sweeper_actions": n(2) if slot == 11 else None,
        "long_balls_accurate": rng.randint(0, tried["long_balls_total"]), "long_balls_total": tried["long_balls_total"],
        "minutes_played": float(minutes),
    }


def season_rows(*, national=False, seed=3):
    """A season of player-matches as power.refresh_players hands them to level.read: four clubs, each meeting each
    other four times (24 matches), eight players a side; with `national`, three matches between two national teams
    (900: club 1's players, 901: club 2's), ids 1001 to 1003."""
    rng = random.Random(seed)
    rows, mid = [], 0
    fixtures = [(h, a) for _ in range(2) for h in CLUBS for a in CLUBS if h != a]
    if national:
        fixtures += [(900, 901)] * 3
    for home, away in fixtures:
        mid = mid + 1 if home not in NATIONS else max(mid, 1000) + 1
        delta = rng.gauss(0, 0.3)
        for team, other, sign in ((home, away, 1), (away, home, -1)):
            squad = {900: 1, 901: 2}.get(team, team)
            for slot, role in SIDE:
                r = {"player_id": squad * 100 + slot, "match_id": mid, "team_id": team, "role": role, "position_id": slot,
                     "is_starter": True, "national": team in NATIONS, "own_elo": CENTRE + 10 * squad, "delta": sign * delta,
                     "competition_season_id": 2 if team in NATIONS else 1}
                r.update(stats(rng, slot, 90))
                rows.append(r)
    return rows


def read(rows, stakes):
    # level.read changes its rows (position, group, situation): each read has its own copy.
    return level.read([dict(r) for r in rows], centre=CENTRE, faced=frozenset(), team_passes=None, samples=False, stakes=stakes)


class StakesTest(unittest.TestCase):
    """59a–59c: the individual part is the year's v9.1 level, each match's values times its stakes."""

    def test_59a_a_match_s_values_count_for_its_stakes_and_its_minutes_do_not(self):
        rows = season_rows()
        match = next(r["match_id"] for r in rows if r["player_id"] == BACK)
        base, twice, thrice = read(rows, {}), read(rows, {match: 2.0}), read(rows, {match: 3.0})
        key = (BACK, CB, 1)
        one = [twice["award_cells"][key][level.BLOCK_SUMS + b] - base["award_cells"][key][level.BLOCK_SUMS + b] for b in range(NB)]
        two = [thrice["award_cells"][key][level.BLOCK_SUMS + b] - base["award_cells"][key][level.BLOCK_SUMS + b] for b in range(NB)]
        self.assertTrue(any(abs(x) > 1e-9 for x in one))  # the match moves him
        for b in range(NB):
            self.assertAlmostEqual(two[b], 2 * one[b], places=9)
        for reading in (twice, thrice):
            self.assertEqual(reading["award_cells"][key][level.MINUTES], base["award_cells"][key][level.MINUTES])
            self.assertEqual(reading["award_cells"][key][level.BLOCK_MINUTES:level.BLOCK_SUMS],
                             base["award_cells"][key][level.BLOCK_MINUTES:level.BLOCK_SUMS])
            self.assertEqual(reading["cells"], base["cells"])  # the level's cells never read the stakes
        # Every stake 1 and no national match: the award cells are the level's cells.
        self.assertEqual(set(base["award_cells"]), set(base["cells"]))
        for k, c in base["cells"].items():
            for i in range(level.CELL):
                self.assertAlmostEqual(base["award_cells"][k][i], c[i], places=9)

    def test_59b_the_individual_part_is_the_award_year_s_level_alone(self):
        refs = references()
        rng = random.Random(9)
        now = {(p, CB, 1 + p % 4): cell(1800.0, [rng.gauss(0, 20) for _ in range(NB)]) for p in range(1, 41)}
        before = {(1, CB, 1): cell(2700.0, [200.0] * NB)}  # a strong year before
        people = {p: person(team=1 + p % 4) for p in range(1, 41)}
        alone = level.levels(now, {}, refs, people)
        with_before = level.levels(now, before, refs, people)
        individual = award().individual(now, refs, people)
        self.assertNotAlmostEqual(with_before[1]["level"], alone[1]["level"], places=3)
        for p in people:
            self.assertAlmostEqual(individual[p]["level"], alone[p]["level"], places=9)
        # The level of v9.1 is untouched: its version and settings.
        self.assertEqual(level.LEVEL_VERSION, "score-vega-v9.1")
        self.assertNotIn("stakes", level.SETTINGS)

    def test_59c_national_matches_enter_the_award_cells_alone_with_their_stakes(self):
        rows = season_rows(national=True)
        clubs = [r for r in rows if not r["national"]]
        base, doubled = read(rows, {}), read(rows, {m: 2.0 for m in (1001, 1002, 1003)})
        national = (BACK, CB, 900)
        self.assertNotIn(national, base["cells"])
        self.assertFalse([k for k in base["cells"] if k[2] in NATIONS])
        self.assertIn(national, base["award_cells"])
        self.assertEqual(base["award_cells"][national][level.MINUTES], 270.0)
        for b in range(NB):
            self.assertAlmostEqual(doubled["award_cells"][national][level.BLOCK_SUMS + b], 2 * base["award_cells"][national][level.BLOCK_SUMS + b], places=9)
        # His club cells are the level's; the start shares and the club part do not read the national matches.
        for k, c in base["cells"].items():
            for i in range(level.CELL):
                self.assertAlmostEqual(base["award_cells"][k][i], c[i], places=9)
        alone = read(clubs, {})
        self.assertEqual(base["shares"], alone["shares"])
        self.assertEqual(base["club"].keys(), alone["club"].keys())
        for p, x in alone["club"].items():
            self.assertAlmostEqual(base["club"][p], x, places=12)
        self.assertTrue(award().NATIONAL_MATCHES)


class HonoursTest(unittest.TestCase):
    """59f, 59g, 59u, 59w: rounds, winners, values and shares."""

    def test_59f_the_winner_of_a_final(self):
        a = award()
        self.assertEqual(a.final_winner((2, 1), None, None), "home")
        self.assertEqual(a.final_winner((0, 3), None, None), "away")
        self.assertEqual(a.final_winner((1, 1), (2, 1), None), "home")  # extra time
        self.assertEqual(a.final_winner((1, 1), (1, 1), (4, 3)), "home")  # then the shoot-out
        self.assertEqual(a.final_winner((1, 1), None, (3, 5)), "away")
        self.assertIsNone(a.final_winner((1, 1), None, None))  # drawn, no shoot-out written: no winner
        self.assertIsNone(a.final_winner(None, None, None))  # not played

    def test_59g_the_round_a_team_reached(self):
        a = award()
        for stage, name, reached in (("knockout", "1/8", "round_of_16"), ("knockout", "1/4", "quarter_final"), ("knockout", "1/2", "semi_final"),
                                     ("final", "final", "final"), (None, "Round of 16", "round_of_16"), (None, "Quarter-finals", "quarter_final"),
                                     (None, "Semi-finals", "semi_final"), (None, "Final", "final"), (None, "Achtelfinale", "round_of_16"),
                                     (None, "Viertelfinale", "quarter_final"), (None, "Halbfinale", "semi_final"),
                                     ("regular", "Matchday 3", None), ("group", "Group A", None), ("knockout", "1/16", None),
                                     (None, "Round of 32", None), (None, "Third place", None), (None, "1. Runde", None)):
            self.assertEqual(a.reached_round(stage, name), reached, (stage, name))
        # The order of the rounds, the best last: a team keeps the furthest it has a match of.
        self.assertEqual(a.ROUNDS, ("round_of_16", "quarter_final", "semi_final", "final", "winner"))

    def test_59u_the_value_tables(self):
        a = award()
        self.assertEqual(a.ROUND_VALUE, {"winner": 1.0, "final": 0.6, "semi_final": 0.4, "quarter_final": 0.25, "round_of_16": 0.15})
        self.assertEqual(a.LEAGUE_RANKS, {1: 1.0, 2: 0.4, 3: 0.2, 4: 0.1})
        self.assertEqual((a.LEAGUE_VALUE, a.CUP_VALUE), (0.5, 0.15))
        # The prestige of power.PRESTIGE / CUP_PRESTIGE on 0..1: the World Cup 1, the Champions League 0.5, the Euro 2/3.
        self.assertAlmostEqual(a.competition_value(power.PRESTIGE["l_1XLtP0"]), 1.0)
        self.assertAlmostEqual(a.competition_value(power.PRESTIGE["l_0bfbkO"]), 0.5)
        self.assertAlmostEqual(a.competition_value(power.CUP_PRESTIGE["euro"]), 2 / 3)
        self.assertAlmostEqual(a.competition_value(power.PRESTIGE["l_2WZ2tt"]), 0.04 / 0.30)
        self.assertAlmostEqual(a.competition_value(1.0), 0.0)
        # The league factor: 1 for the strongest league, 2 / (1 + 10^(gap / 400)) below it.
        self.assertAlmostEqual(a.league_factor(1700.0, 1700.0), 1.0)
        self.assertAlmostEqual(a.league_factor(1500.0, 1700.0), 2 / (1 + 10 ** 0.5))
        self.assertAlmostEqual(a.league_factor(1500.0, 1700.0), 0.4805, places=4)
        # Values: a league by its rank, its factor and its progress; a national cup by its round and factor; an
        # international competition by its round and prestige.
        self.assertAlmostEqual(a.honour_value("league", league_rank=1), 0.5)
        self.assertAlmostEqual(a.honour_value("league", league_rank=2), 0.2)
        self.assertAlmostEqual(a.honour_value("league", league_rank=4), 0.05)
        self.assertAlmostEqual(a.honour_value("league", league_rank=5), 0.0)
        self.assertAlmostEqual(a.honour_value("league", league_rank=1, progress=0.5), 0.25)
        self.assertAlmostEqual(a.honour_value("league", league_rank=1, factor=0.4805), 0.5 * 0.4805)
        self.assertAlmostEqual(a.honour_value("national_cup", reached="winner", factor=0.5), 0.075)
        self.assertAlmostEqual(a.honour_value("national_cup", reached="semi_final"), 0.06)
        self.assertAlmostEqual(a.honour_value("international", reached="winner", prestige=1.15), 0.5)
        self.assertAlmostEqual(a.honour_value("international", reached="final", prestige=1.30), 0.6)
        self.assertAlmostEqual(a.honour_value("international", reached="quarter_final", prestige=1.20), 0.25 * 2 / 3)
        # The share: minutes over the team's matches of 90, at most 1.
        self.assertAlmostEqual(a.share(630, 14), 0.5)
        self.assertAlmostEqual(a.share(1260, 14), 1.0)
        self.assertAlmostEqual(a.share(1400, 14), 1.0)
        self.assertEqual(a.share(0, 0), 0.0)

    def test_59u_the_migration_is_the_last_and_reviewed(self):
        from vega import open_matchday_restore

        files = sorted(p.name for p in (ROOT / "sql").glob("[0-9][0-9][0-9]_*.sql"))
        self.assertEqual(files[-1], "174_player_award.sql")
        self.assertIn("174_player_award.sql", open_matchday_restore.REVIEWED_SCHEMAS)
        text = (ROOT / "sql" / "174_player_award.sql").read_text(encoding="utf-8")
        for name in ("agg.award_runs", "agg.player_award", "agg.player_award_honours", "api.award_race", "api.award_honours"):
            self.assertIn(name, text)
        self.assertNotIn("agg.player_award_ranking", text)  # the v8 race's table is not touched

    def test_59w_a_national_tournament_without_player_rows(self):
        a = award()
        self.assertEqual(a.NATIONAL_PROXY_SHARE, 0.5)
        self.assertEqual(a.national_share(True), 0.5)  # seen with that national team
        self.assertEqual(a.national_share(False), 0.0)


class FairPlayTest(unittest.TestCase):
    """59i, 59j: the FIFA team conduct points and the rate pulled to the position's mean."""

    def test_59i_card_points_of_a_player_match(self):
        a = award()
        self.assertEqual(a.card_points([]), 0)
        self.assertEqual(a.card_points([(20, "yellow_card")]), 1)
        self.assertEqual(a.card_points([(20, "yellow_card"), (60, "second_yellow"), (60, "red_card")]), 3)  # its red not again
        self.assertEqual(a.card_points([(20, "yellow_card"), (60, "second_yellow")]), 3)
        self.assertEqual(a.card_points([(30, "red_card")]), 4)
        self.assertEqual(a.card_points([(10, "yellow_card"), (50, "red_card")]), 5)
        self.assertEqual(a.card_points([(10, "goal"), (50, "substitution")]), 0)

    def test_59j_the_rate_is_pulled_to_the_position_s_mean(self):
        a = award()
        self.assertEqual(a.CARD_PRIOR_MINUTES, 900)
        self.assertAlmostEqual(a.pulled_rate(3, 900, 0.2), 90 * (3 + 0.2 * 900 / 90) / 1800)
        self.assertAlmostEqual(a.pulled_rate(3, 900, 0.2), 0.25)
        self.assertAlmostEqual(a.pulled_rate(0, 0, 0.2), 0.2)  # no covered minute: the mean
        self.assertAlmostEqual(a.pulled_rate(0, 9000, 0.2), 90 * 2 / 9900)
        self.assertAlmostEqual(a.pulled_rate(5, 90, 0.0, 900), 90 * 5 / 990)


def people_of(levels_out, collective, fair_play):
    """combine()'s input from a levels() result: every player a men's reference, eligible, of a measured top division."""
    return {p: {"individual": r["level"], "collective": collective(p), "fair_play": fair_play(p, r["position"]), "position": r["position"],
                "universe": "men", "reference": True, "eligible": True, "linked": True, "top_division": True, "measured": True}
            for p, r in levels_out.items()}


class RaceTest(unittest.TestCase):
    """59k–59n: the scale, the reasons and the race."""

    def test_59k_59l_the_first_reason_that_holds(self):
        a = award()
        ok = {"eligible": True, "linked": True, "top_division": True, "measured": True}
        self.assertIsNone(a.race_reason(ok))
        self.assertEqual(a.race_reason({**ok, "measured": False}), "keeper_data")
        self.assertEqual(a.race_reason({**ok, "top_division": False, "measured": False}), "not_top_division")
        self.assertEqual(a.race_reason({**ok, "linked": False, "top_division": False}), "league")
        self.assertEqual(a.race_reason({**ok, "eligible": False, "linked": False}), "minutes")
        self.assertFalse(a.KEEPER_IN_RACE)

    def test_59k_a_keeper_not_measured_has_his_parts_and_his_score_and_no_rank(self):
        a = award()
        people = {p: {"individual": float(p), "collective": 0.1 * (p % 3), "fair_play": -0.02 * (p % 4), "position": CB, "universe": "men",
                      "reference": True, "eligible": True, "linked": True, "top_division": True, "measured": True} for p in range(1, 31)}
        people[99] = {**people[1], "individual": 50.0, "position": GK, "measured": False}
        rows, _ = a.combine(people)
        keeper = rows[99]
        self.assertIsNone(keeper["rank"])
        self.assertEqual(keeper["reason"], "keeper_data")
        self.assertTrue(0 < keeper["score"] < 100)
        self.assertIsNotNone(keeper["level"])
        self.assertEqual(sorted(r["rank"] for p, r in rows.items() if p != 99), list(range(1, 31)))

    def test_59l_out_of_the_race_by_minutes_league_or_division(self):
        a = award()
        base = {"collective": 0.0, "fair_play": 0.0, "position": CB, "universe": "men", "reference": True, "eligible": True, "linked": True,
                "top_division": True, "measured": True}
        people = {p: {**base, "individual": float(p)} for p in range(1, 31)}
        people[91] = {**base, "individual": 90.0, "eligible": False, "reference": False}
        people[92] = {**base, "individual": 90.0, "linked": False, "reference": False}
        people[93] = {**base, "individual": 90.0, "top_division": False, "reference": False}
        rows, _ = a.combine(people)
        self.assertEqual([(rows[p]["rank"], rows[p]["reason"]) for p in (91, 92, 93)], [(None, "minutes"), (None, "league"), (None, "not_top_division")])
        self.assertEqual(rows[30]["rank"], 1)  # the best player in the race
        self.assertTrue(all(rows[p]["score"] > rows[30]["score"] for p in (91, 92, 93)))  # scored, not ranked

    def test_59m_a_player_at_the_mean_on_c_and_f_keeps_his_year_only_score(self):
        a = award()
        refs = references()
        rng = random.Random(4)
        now = {(p, (CB, CM, CF)[p % 3], 1 + p % 4): cell(1800.0, [rng.gauss(0, 25) for _ in range(NB)]) for p in range(1, 61)}
        out = level.levels(now, {}, refs, {p: person(team=1 + p % 4) for p in range(1, 61)})
        rows, spreads = a.combine(people_of(out, lambda p: 0.3, lambda p, position: -0.1))
        for p, r in out.items():
            self.assertAlmostEqual(rows[p]["z_collective"], 0.0)
            self.assertAlmostEqual(rows[p]["z_fair_play"], 0.0)
            self.assertAlmostEqual(rows[p]["level"], r["level"], places=9)
            self.assertAlmostEqual(rows[p]["score"], r["score"], places=9)
        self.assertEqual([p for p, _ in sorted(rows.items(), key=lambda x: x[1]["rank"])], [p for p, _ in sorted(out.items(), key=lambda x: x[1]["rank"])])
        self.assertEqual(json.loads(json.dumps(spreads)), spreads)  # kept with the run (agg.award_runs.spreads)

    def test_59m_the_weights_and_the_scale(self):
        a = award()
        self.assertEqual(a.WEIGHTS, {"individual": 0.6, "collective": 0.3, "fair_play": 0.1})
        self.assertAlmostEqual(a.combined(1.0, 2.0, -1.0), 0.6 + 0.6 - 0.1)
        self.assertAlmostEqual(a.award_level(0.6, 10.0, 15.0), 25.0)  # A = μ_I + σ_I B / 0.6
        self.assertAlmostEqual(a.award_level(0.0, 10.0, 15.0), 10.0)
        self.assertAlmostEqual(a.score(10.0, 10.0), 50.0)
        self.assertAlmostEqual(a.score(46.0, 10.0), 100 / 1.1)  # ten to one 36 points above the median
        # Given the reference year's spreads, the year in progress is placed on them.
        people = {p: {"individual": float(p), "collective": 0.1 * p, "fair_play": -0.01 * p, "position": CB, "universe": "men", "reference": True,
                      "eligible": True, "linked": True, "top_division": True, "measured": True} for p in range(1, 31)}
        spreads = {"individual": [10.0, 5.0], "collective": [1.0, 0.5], "fair_play": {CB: [-0.2, 0.1]}}
        rows, kept = a.combine(people, spreads)
        self.assertEqual(kept, spreads)
        self.assertAlmostEqual(rows[20]["z_individual"], 2.0)
        self.assertAlmostEqual(rows[20]["z_collective"], 2.0)
        self.assertAlmostEqual(rows[20]["z_fair_play"], 0.0)
        self.assertAlmostEqual(rows[20]["level"], 10.0 + 5.0 * (0.6 * 2 + 0.3 * 2) / 0.6)

    def test_59n_z_c_and_z_f_are_bounded_at_4(self):
        a = award()
        self.assertEqual(a.Z_CAP, 4.0)
        self.assertEqual(a.zscore(7.0, 0.0, 1.0, cap=4.0), 4.0)
        self.assertEqual(a.zscore(-7.0, 0.0, 1.0, cap=4.0), -4.0)
        self.assertAlmostEqual(a.zscore(7.0, 0.0, 1.0), 7.0)  # z_I is not bounded
        self.assertEqual(a.zscore(3.0, 3.0, 0.0, cap=4.0), 0.0)  # no spread: no deviation
        people = {p: {"individual": float(p % 7), "collective": 0.0, "fair_play": 0.0, "position": CB, "universe": "men", "reference": True,
                      "eligible": True, "linked": True, "top_division": True, "measured": True} for p in range(1, 101)}
        people[1]["collective"] = 50.0
        rows, _ = a.combine(people)
        self.assertEqual(rows[1]["z_collective"], 4.0)


class SettingsTest(unittest.TestCase):
    """59p, 59u: the version and the settings a run keeps and stale() compares."""

    def test_59p_59u_the_version_and_the_settings(self):
        a = award()
        self.assertEqual(a.AWARD_VERSION, "vega-award-v1")
        self.assertEqual(a.SETTINGS, {
            "weights": {"individual": 0.6, "collective": 0.3, "fair_play": 0.1}, "z_cap": 4.0, "league_value": 0.5, "cup_value": 0.15,
            "league_ranks": {"1": 1.0, "2": 0.4, "3": 0.2, "4": 0.1},
            "round_value": {"winner": 1.0, "final": 0.6, "semi_final": 0.4, "quarter_final": 0.25, "round_of_16": 0.15},
            "card_prior_minutes": 900, "national_matches": True, "national_proxy_share": 0.5, "keeper_in_race": False,
            "level_version": level.LEVEL_VERSION})
        self.assertEqual(json.loads(json.dumps(a.SETTINGS)), a.SETTINGS)  # as agg.award_runs.settings keeps it
        self.assertEqual(a.settings()["league_ranks"], {"1": 1.0, "2": 0.4, "3": 0.2, "4": 0.1})  # read from the tables each time


if __name__ == "__main__":
    unittest.main()
