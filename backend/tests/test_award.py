"""The Ballon d'Or race on the Score Vega v9.1 with the three criteria, stage 1 (issue #105, FAILURE_MODES §60,
60a–60c, 60f–60n, 60u–60w, 60ac, 60af; stage 1.1, §60.3: 60ag–60aj, 60al, 60am, 60an–60at): the formulas, without a database. The database pass over the synthetic season
is in test_models.py (60b, 60d–60k, 60o, 60p, 60s, 60t, 60v, 60y–60aa, 60ac–60af), the worker's in
test_collection_wakeups.py (60p) and test_worker.py (60x), the partial year in test_award_year_2020_order.py (60r), the
migration in test_deploy_migrations.py (60u), the reads in backend/api/test/rankings.test.mjs (60q, 60s, 60ab)."""

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
    """60a–60c: the individual part is the year's v9.1 level, each match's values times its stakes."""

    def test_60a_a_match_s_values_count_for_its_stakes_and_its_minutes_do_not(self):
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

    def test_60b_the_individual_part_is_the_award_year_s_level_alone(self):
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

    def test_60c_national_matches_enter_the_award_cells_alone_with_their_stakes(self):
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
    """60f, 60g, 60u, 60w: rounds, winners, values and shares."""

    def test_60f_the_winner_of_a_final(self):
        a = award()
        self.assertEqual(a.final_winner((2, 1), None, None), "home")
        self.assertEqual(a.final_winner((0, 3), None, None), "away")
        self.assertEqual(a.final_winner((1, 1), (2, 1), None), "home")  # extra time
        self.assertEqual(a.final_winner((1, 1), (1, 1), (4, 3)), "home")  # then the shoot-out
        self.assertEqual(a.final_winner((1, 1), None, (3, 5)), "away")
        self.assertIsNone(a.final_winner((1, 1), None, None))  # drawn, no shoot-out written: no winner
        self.assertIsNone(a.final_winner(None, None, None))  # not played

    def test_60g_the_round_a_team_reached(self):
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

    def test_60u_the_value_tables(self):
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

    def test_60u_the_migration_is_the_last_and_reviewed(self):
        from vega import open_matchday_restore

        files = sorted(p.name for p in (ROOT / "sql").glob("[0-9][0-9][0-9]_*.sql"))
        self.assertIn("175_player_award.sql", files)  # 176 (§61) came after it
        self.assertIn("175_player_award.sql", open_matchday_restore.REVIEWED_SCHEMAS)
        text = (ROOT / "sql" / "175_player_award.sql").read_text(encoding="utf-8")
        for name in ("agg.award_runs", "agg.player_award", "agg.player_award_honours", "api.award_race", "api.award_honours"):
            self.assertIn(name, text)
        self.assertNotIn("agg.player_award_ranking", text)  # the v8 race's table is not touched

    def test_60w_a_national_tournament_without_player_rows(self):
        a = award()
        self.assertEqual(a.NATIONAL_PROXY_SHARE, 0.5)
        self.assertEqual(a.national_share(True), 0.5)  # seen with that national team
        self.assertEqual(a.national_share(False), 0.0)


class FairPlayTest(unittest.TestCase):
    """60i, 60j: the FIFA team conduct points and the rate pulled to the position's mean."""

    def test_60i_card_points_of_a_player_match(self):
        a = award()
        self.assertEqual(a.card_points([]), 0)
        self.assertEqual(a.card_points([(20, "yellow_card")]), 1)
        self.assertEqual(a.card_points([(20, "yellow_card"), (60, "second_yellow"), (60, "red_card")]), 3)  # its red not again
        self.assertEqual(a.card_points([(20, "yellow_card"), (60, "second_yellow")]), 3)
        self.assertEqual(a.card_points([(30, "red_card")]), 4)
        self.assertEqual(a.card_points([(10, "yellow_card"), (50, "red_card")]), 5)
        self.assertEqual(a.card_points([(10, "goal"), (50, "substitution")]), 0)

    def test_60j_the_rate_is_pulled_to_the_position_s_mean(self):
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
    """60k–60n: the scale, the reasons and the race."""

    def test_60k_60l_the_first_reason_that_holds(self):
        a = award()
        ok = {"eligible": True, "linked": True, "top_division": True, "measured": True}
        self.assertIsNone(a.race_reason(ok))
        self.assertEqual(a.race_reason({**ok, "measured": False}), "keeper_data")
        self.assertEqual(a.race_reason({**ok, "top_division": False, "measured": False}), "not_top_division")
        self.assertEqual(a.race_reason({**ok, "linked": False, "top_division": False}), "league")
        self.assertEqual(a.race_reason({**ok, "eligible": False, "linked": False}), "minutes")
        self.assertFalse(a.KEEPER_IN_RACE)

    def test_60k_a_keeper_not_measured_has_his_parts_and_his_score_and_no_rank(self):
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

    def test_60l_out_of_the_race_by_minutes_league_or_division(self):
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

    def test_60m_a_player_at_the_mean_on_c_and_f_keeps_his_year_only_score(self):
        a = award()
        refs = references()
        rng = random.Random(4)
        now = {(p, (CB, CM, CF)[p % 3], 1 + p % 4): cell(1800.0, [rng.gauss(0, 25) for _ in range(NB)]) for p in range(1, 61)}
        out = level.levels(now, {}, refs, {p: person(team=1 + p % 4) for p in range(1, 61)})
        # v1.1 (60ao): z_C = k × C, so the player with no honour (C = 0) keeps it; F at the mean.
        rows, spreads = a.combine(people_of(out, lambda p: 0.0, lambda p, position: -0.1))
        for p, r in out.items():
            self.assertAlmostEqual(rows[p]["z_collective"], 0.0)
            self.assertAlmostEqual(rows[p]["z_fair_play"], 0.0)
            self.assertAlmostEqual(rows[p]["level"], r["level"], places=9)
            self.assertAlmostEqual(rows[p]["score"], r["score"], places=9)
        self.assertEqual([p for p, _ in sorted(rows.items(), key=lambda x: x[1]["rank"])], [p for p, _ in sorted(out.items(), key=lambda x: x[1]["rank"])])
        self.assertEqual(json.loads(json.dumps(spreads)), spreads)  # kept with the run (agg.award_runs.spreads)

    def test_60m_the_weights_and_the_scale(self):
        a = award()
        self.assertEqual(a.WEIGHTS, {"individual": 0.6, "collective": 0.3, "fair_play": 0.1})
        self.assertAlmostEqual(a.combined(1.0, 2.0, -1.0), 0.6 + 0.6 - 0.1)
        self.assertAlmostEqual(a.award_level(0.6, 10.0, 15.0), 25.0)  # A = μ_I + σ_I B / 0.6
        self.assertAlmostEqual(a.award_level(0.0, 10.0, 15.0), 10.0)
        self.assertAlmostEqual(a.score(10.0, 10.0), 50.0)
        self.assertAlmostEqual(a.score(46.0, 10.0), 100 / 1.1)  # ten to one 36 points above the median
        # Given the reference year's spreads and k (v1.1, 60ar), the year in progress is placed on them.
        people = {p: {"individual": float(p), "collective": 0.1 * p, "fair_play": -0.01 * p, "position": CB, "universe": "men", "reference": True,
                      "eligible": True, "linked": True, "top_division": True, "measured": True} for p in range(1, 31)}
        scale = {"k": 1.0, "mean_top_individual": 2.0, "mean_top_collective": 2.0, "top": 30, "source": "own"}
        spreads = {"individual": [10.0, 5.0], "collective": [1.0, 0.5], "fair_play": {CB: [-0.2, 0.1]}, "collective_scale": scale}
        rows, kept = a.combine(people, spreads)
        self.assertEqual(kept, {**spreads, "collective_scale": {**scale, "source": "reference"}})
        self.assertAlmostEqual(rows[20]["z_individual"], 2.0)
        self.assertAlmostEqual(rows[20]["z_collective"], 2.0)  # k 1 × C 2.0
        self.assertAlmostEqual(rows[20]["z_fair_play"], 0.0)
        self.assertAlmostEqual(rows[20]["level"], 10.0 + 5.0 * (0.6 * 2 + 0.3 * 2) / 0.6)

    def test_60n_z_f_is_bounded_at_4_and_z_c_is_not(self):
        # v1.1 (60.3, « The collective scale »): Z_CAP bounds z_F alone; z_C = k × C has no cap.
        a = award()
        self.assertEqual(a.Z_CAP, 4.0)
        self.assertEqual(a.zscore(7.0, 0.0, 1.0, cap=4.0), 4.0)
        self.assertEqual(a.zscore(-7.0, 0.0, 1.0, cap=4.0), -4.0)
        self.assertAlmostEqual(a.zscore(7.0, 0.0, 1.0), 7.0)  # z_I is not bounded
        self.assertEqual(a.zscore(3.0, 3.0, 0.0, cap=4.0), 0.0)  # no spread: no deviation
        people = {p: {"individual": float(p % 7), "collective": 0.0, "fair_play": 0.0, "position": CB, "universe": "men", "reference": True,
                      "eligible": True, "linked": True, "top_division": True, "measured": True} for p in range(1, 101)}
        people[1]["collective"] = 50.0
        people[2]["fair_play"] = -50.0
        rows, spreads = a.combine(people)
        k = spreads["collective_scale"]["k"]
        self.assertGreater(k, 0)
        self.assertAlmostEqual(rows[1]["z_collective"], 50.0 * k)
        self.assertGreater(rows[1]["z_collective"], 4.0)
        self.assertEqual(rows[2]["z_fair_play"], -4.0)


class EdgesTest(unittest.TestCase):
    """60ac, 60af: the players at the edges of the individual part, and a final of two legs."""

    @staticmethod
    def row(position, universe="men", team=1, level_=10.0):
        return {"position": position, "universe": universe, "team": team, "level": level_, "measured": True}

    def test_60ac_whose_row(self):
        a = award()
        flags = {"eligible": True, "linked": True, "top_division": True}
        # 1: a level row and its award cells; 2: national matches alone (award cells, no level row); 3: a level row and
        # no award cell; 4: a women's player with national matches; 5: a ranking row without a role.
        individual_rows = {1: self.row(CB), 2: self.row(CF, team=900), 4: self.row(CM, team=900), 5: self.row(FB, level_=-3.0)}
        level_rows = {1: self.row(CB), 3: self.row(CM), 4: self.row(CM, universe="women", team=7), 5: self.row(FB, team=2)}
        scored = {1: {**flags, "role": "centre_back"}, 3: {**flags, "role": "central_midfielder"}, 4: {**flags, "role": "central_midfielder"},
                  5: dict(flags)}
        people = a.people_of(individual_rows, level_rows, scored)
        self.assertEqual(sorted(people), [1, 5])
        self.assertEqual((people[5]["position"], people[5]["team"], people[5]["individual"]), (FB, 2, -3.0))
        inputs = {"editions": {}, "teams": {}, "progress": {}, "ranks": {}, "strongest": None, "club_leagues": {}, "minutes": {}, "honoured": {},
                  "windows": {}, "seen": set(), "cards": {}}
        rows, honours, _ = a.compute(people, inputs, None)
        self.assertEqual((sorted(rows), honours), ([1, 5], []))
        self.assertEqual(a.compute({}, inputs, None), ({}, [], {}))

    def test_60af_a_final_of_two_legs(self):
        from datetime import date

        a = award()
        editions = {e: (a.NATIONAL_CUP, None, None, f"open-cups:c{e}:2025/2026") for e in range(1, 7)}
        first, second = date(2026, 5, 1), date(2026, 5, 8)

        def leg(edition, day, home, away, finished, score=None, extra=None, shootout=None):
            return (edition, day, home, away, finished, *(score or (None, None)), *(extra or (None, None)), *(shootout or (None, None)), None, "Final")

        knockouts = [
            leg(1, first, 1, 2, True, (2, 1)), leg(1, second, 2, 1, True, (1, 1)),  # 3–2 on aggregate
            leg(2, first, 3, 4, True, (1, 0)), leg(2, second, 4, 3, True, (1, 0), (1, 0), (4, 2)),  # 1–1, the second leg's shoot-out
            leg(3, first, 5, 6, True, (0, 0)), leg(3, second, 6, 5, True, (1, 1)),  # level, no shoot-out
            leg(4, first, 7, 8, True, (2, 0)), leg(4, second, 8, 7, False),  # the second leg to play
            leg(5, first, 1, 2, True, (1, 0)), leg(5, second, 2, 1, True, (1, 0), (2, 0)),  # extra time decides: 2–1 for 2
            leg(6, first, 3, 4, True, (0, 1)),  # one final, as before
        ]
        self.assertEqual(a._reached(editions, knockouts), {
            (1, 1): ("winner", None), (1, 2): ("final", None),
            (2, 4): ("winner", None), (2, 3): ("final", None),
            (3, 5): ("final", "no_winner"), (3, 6): ("final", "no_winner"),
            (4, 7): ("final", None), (4, 8): ("final", None),
            (5, 2): ("winner", None), (5, 1): ("final", None),
            (6, 4): ("winner", None), (6, 3): ("final", None)})


class ShootoutTest(unittest.TestCase):
    """60ag, 60ai, 60aj (§60.3): a final's shoot-out taken from its copy, the copy test of rule 43.2."""

    from datetime import date as _date

    DAY = _date(2022, 12, 18)
    # Edition 1: PitchAPI's World Cup (l_1XLtP0); 2: OpenFootball's (SAME_COMPETITION); 3: another competition.
    COMPETITIONS = {1: ("l_1XLtP0", 0), 2: ("l_1XLtP0", 2), 3: ("open-cups:euro", 2)}
    # (match, edition, home, away, day, score, score after extra time): PitchAPI's score of a final that went to
    # extra time is the score after it (3–3), with no extra-time column, as production holds the World Cup 2022 final.
    FINAL = (10, 1, 85, 86, DAY, 3, 3, None, None)

    @classmethod
    def copy(cls, *, edition=2, key="open-cups:world-cup-history:2022", provider=None, day=None, home=85, away=86, score=(3, 3),
             extra=(3, 3), shootout=(4, 2)):
        """A candidate copy of match 10: (final, copy's edition, its cup key, its PitchAPI key, day, home, away, score,
        score after extra time, shoot-out). By default OpenFootball's copy as production holds it: the same day, the
        same sides, score 3–3 (after extra time), extra time 3–3, shoot-out 4–2."""
        return (10, edition, key, provider, day or cls.DAY, home, away, *score, *extra, *shootout)

    def lent(self, copies=(), finals=None):
        return award().lent_shootouts(finals or [self.FINAL], list(copies), self.COMPETITIONS)

    def test_60ag_the_copy_of_the_same_match_lends_its_shoot_out(self):
        from datetime import timedelta

        a = award()
        self.assertEqual(self.lent([self.copy()]), {10: (4, 2)})  # the same day, the same sides
        self.assertEqual(self.lent([self.copy(day=self.DAY - timedelta(days=1))]), {10: (4, 2)})  # one day apart
        self.assertEqual(self.lent([self.copy(day=self.DAY + timedelta(days=1))]), {10: (4, 2)})
        self.assertEqual(self.lent([self.copy(home=86, away=85, shootout=(2, 4))]), {10: (4, 2)})  # sides swapped: read team by team
        self.assertEqual(self.lent([self.copy(score=(3, 3), extra=(None, None))]), {10: (4, 2)})  # a copy without its extra-time score
        self.assertEqual(self.lent([self.copy(), self.copy(edition=4, key="open-cups:world-cup-history:2022-b")]), {10: (4, 2)})  # two that agree
        # The final read then: PitchAPI's home side the winner.
        row = (1, self.DAY, 85, 86, True, 3, 3, None, None, *self.lent([self.copy()])[10], "final", "final")
        self.assertEqual(a._reached({1: (a.INTERNATIONAL, None, 1.3, None)}, [row]), {(1, 85): ("winner", None), (1, 86): ("final", None)})

    def test_60ai_nothing_is_lent_otherwise(self):
        from datetime import timedelta

        for name, copies in (
                ("no copy", []),
                ("another score", [self.copy(score=(2, 1), extra=(2, 1))]),
                ("the score at 90 minutes alone equal", [self.copy(score=(2, 2), extra=(2, 2))]),
                ("another competition", [self.copy(edition=3, key="open-cups:euro:2024")]),
                ("two days apart", [self.copy(day=self.DAY - timedelta(days=2))]),
                ("the same edition", [self.copy(edition=1, key=None, provider="l_1XLtP0")]),
                ("other teams", [self.copy(home=86, away=87)]),
                ("copies that disagree", [self.copy(), self.copy(edition=4, key="open-cups:world-cup-history:2022-b", shootout=(2, 4))]),
                ("a copy without its shoot-out", [self.copy(shootout=(None, 4))]),
                ("a level shoot-out", [self.copy(shootout=(4, 4))])):
            self.assertEqual(self.lent(copies), {}, name)
        # The final read without a lent shoot-out: both `final`, `no_winner` (60.1), as the Champions League 2026 and
        # the Europa League 2022 and 2023 finals stay (no copy, no shoot-out anywhere in the base).
        a = award()
        row = (1, self.DAY, 85, 86, True, 3, 3, None, None, None, None, "final", "final")
        self.assertEqual(a._reached({1: (a.INTERNATIONAL, None, 1.3, None)}, [row]), {(1, 85): ("final", "no_winner"), (1, 86): ("final", "no_winner")})

    def test_60aj_the_second_leg_of_a_final_of_two_legs(self):
        from datetime import date

        a = award()
        first, second = date(2026, 5, 1), date(2026, 5, 8)
        finals = [(20, 5, 3, 4, first, 1, 0, None, None), (21, 5, 4, 3, second, 1, 0, None, None)]  # 1–1 on aggregate
        copies = [(21, 6, "open-matchday:POR_CUP_taca-de-portugal:2025/2026", None, second, 4, 3, 1, 0, None, None, 2, 4)]
        competitions = {5: ("open-cups:portugal-cup-archive", 2)}
        self.assertEqual(a._competition(6, None, copies[0][2])[0], "open-cups:portugal-cup-archive")
        lent = a.lent_shootouts(finals, copies, competitions)
        self.assertEqual(lent, {21: (2, 4)})
        legs = [(5, first, 3, 4, True, 1, 0, None, None, None, None, None, "Final"),
                (5, second, 4, 3, True, 1, 0, None, None, *lent[21], None, "Final")]
        editions = {5: (a.NATIONAL_CUP, None, None, "open-cups:portugal-cup-archive:2025/2026")}
        self.assertEqual(a._reached(editions, legs), {(5, 3): ("winner", None), (5, 4): ("final", None)})


class ListedShootoutTest(unittest.TestCase):
    """60at (§60.3): the reviewed list of three finals' shoot-outs (hugo, 24 Nov 2026, 21:05 Paris): used only for its
    match, when the row holds no shoot-out and no copy lends one, and its score after extra time is the row's."""

    from datetime import date as _date

    DAY = _date(2022, 5, 18)
    ENTRY = {"m_test": {"competition": "l_38d9HA", "date": "2022-05-18", "team1": "Eintracht Frankfurt", "team2": "Rangers FC", "score": [1, 1],
                        "kicks": [5, 4], "source": "https://example.invalid/el.txt", "line": "Eintracht Frankfurt v Rangers FC 5-4 pen. 1-1 a.e.t."}}
    COMPETITIONS = {1: ("l_38d9HA", 0), 2: ("l_0bfbkO", 0)}

    def listed(self, final=None, keys=None):
        final = final or (10, 1, 31, 32, self.DAY, 1, 1, None, None)
        keys = {10: ("m_test", "Eintracht Frankfurt", "Rangers")} if keys is None else keys
        return award().listed_shootouts([final], keys, self.COMPETITIONS, self.ENTRY)

    def test_60at_a_listed_final_gives_its_winner(self):
        a = award()
        self.assertEqual(self.listed(), {10: (5, 4)})
        # The base puts Rangers at home: the entry is read by team.
        self.assertEqual(self.listed(keys={10: ("m_test", "Rangers", "Eintracht Frankfurt")}), {10: (4, 5)})
        row = (1, self.DAY, 31, 32, True, 1, 1, None, None, *self.listed()[10], "final", "final")
        self.assertEqual(a._reached({1: (a.INTERNATIONAL, None, 1.15, None)}, [row]), {(1, 31): ("winner", None), (1, 32): ("final", None)})
        for name, final, keys in (
                ("another score", (10, 1, 31, 32, self.DAY, 2, 1, None, None), None),
                ("another score after extra time", (10, 1, 31, 32, self.DAY, 1, 1, 2, 1), None),
                ("another competition", (10, 2, 31, 32, self.DAY, 1, 1, None, None), None),
                ("another day", (10, 1, 31, 32, self._date(2022, 5, 19), 1, 1, None, None), None),
                ("another match's key", None, {10: ("m_other", "Eintracht Frankfurt", "Rangers")}),
                ("not its teams", None, {10: ("m_test", "Eintracht Frankfurt", "Celtic")}),
                ("no key", None, {})):
            self.assertEqual(self.listed(final, keys), {}, name)
        self.assertTrue(a.same_team("Paris Saint-Germain FC", "Paris Saint Germain"))
        self.assertTrue(a.same_team("AS Roma", "Roma"))
        self.assertFalse(a.same_team("Sevilla FC", "Real Betis"))

    def test_60at_the_row_and_a_copy_come_before_the_list(self):
        a = award()

        class Conn:
            """Answers COPIES and LISTED with the given rows; records what was asked."""

            def __init__(self, copies, listed):
                self.copies, self.listed, self.asked = copies, listed, []

            def execute(self, sql, params=None):
                self.asked.append("copies" if sql is a.COPIES else "listed" if sql is a.LISTED else sql)
                rows = self.copies if sql is a.COPIES else self.listed
                return type("R", (), {"fetchall": lambda _self: rows})()

        editions, competitions = {1: (a.INTERNATIONAL, None, 1.15, None)}, {1: ("l_38d9HA", 0), 2: ("l_38d9HA", 3)}
        real = a.REVIEWED_SHOOTOUTS["m_0mZCDy"]
        final = lambda pens: (1, self.DAY, 31, 32, True, 1, 1, None, None, *pens, "final", "final", 10)
        listed = [(10, "m_0mZCDy", "Eintracht Frankfurt", "Rangers")]
        # Listed: the list gives it.
        conn = Conn([], listed)
        self.assertEqual(a.with_shootouts(conn, editions, competitions, [final((None, None))])[0][9:11], tuple(real["kicks"]))
        # The row has its own shoot-out: the row wins, nothing is asked.
        conn = Conn([], listed)
        self.assertEqual(a.with_shootouts(conn, editions, competitions, [final((3, 4))])[0][9:11], (3, 4))
        self.assertEqual(conn.asked, [])
        # A copy lends one: the copy's, and the list is not consulted.
        conn = Conn([(10, 2, "open-matchday:UEFA_1_europa-league:2021/2022", None, self.DAY, 31, 32, 1, 1, None, None, 2, 3)], listed)
        self.assertEqual(a.with_shootouts(conn, editions, competitions, [final((None, None))])[0][9:11], (2, 3))
        self.assertEqual(conn.asked, ["copies"])
        # Neither: the row as it is, 13 columns.
        conn = Conn([], [])
        self.assertEqual(a.with_shootouts(conn, editions, competitions, [final((None, None))]), [final((None, None))[:13]])

    def test_60at_the_three_reviewed_entries(self):
        a = award()
        self.assertEqual(sorted(a.REVIEWED_SHOOTOUTS), ["m_0DIsqq", "m_0mZCDy", "m_2JTU0J"])  # these three, no other (the owner's approval)
        expected = {"m_0mZCDy": ("l_38d9HA", "2022-05-18", "Eintracht Frankfurt", "Rangers FC", [5, 4], "2021-22/el.txt"),
                    "m_2JTU0J": ("l_38d9HA", "2023-05-31", "Sevilla FC", "AS Roma", [4, 1], "2022-23/el.txt"),
                    "m_0DIsqq": ("l_0bfbkO", "2026-05-30", "Paris Saint-Germain FC", "Arsenal FC", [4, 3], "2025-26/cl.txt")}
        for key, e in a.REVIEWED_SHOOTOUTS.items():
            competition, day, team1, team2, kicks, path = expected[key]
            self.assertEqual((e["competition"], e["date"], e["team1"], e["team2"], e["score"], e["kicks"]), (competition, day, team1, team2, [1, 1], kicks))
            self.assertNotEqual(e["kicks"][0], e["kicks"][1])
            self.assertFalse(a.same_team(e["team1"], e["team2"]))
            self.assertTrue(e["source"].startswith("https://raw.githubusercontent.com/openfootball/champions-league/") and e["source"].endswith(path))
            self.assertIn(f"{e['kicks'][0]}-{e['kicks'][1]} pen. 1-1 a.e.t.", e["line"])
            self.assertLess(e["line"].index(e["team1"]), e["line"].index(e["team2"]))  # team1's kicks first, as the line reads
            self.assertIn(e["competition"], power.PRESTIGE)


class RoundNameTest(unittest.TestCase):
    """60ah (§60.3): OpenFootball's « Finals, Final » (the Copa Libertadores of 2023 to 2025) is a final."""

    def test_60ah_finals_final_is_a_final(self):
        a = award()
        self.assertEqual(a.reached_round(None, "Finals, Final"), "final")
        self.assertEqual(a.reached_round(None, "finals, final"), "final")
        self.assertEqual(a.reached_round(None, "  FINALS, FINAL  "), "final")
        self.assertEqual(a.reached_round("knockout", "Finals, Final"), "final")
        # « Finals, Final » exactly: another name ending « , final » is not a final, nor a regular-season match.
        for name in ("Qualifying, Final", "Preliminary round, Final", "Group A, Final"):
            self.assertIsNone(a.reached_round(None, name), name)
        self.assertIsNone(a.reached_round("regular", "Finals, Final"))
        # The names production holds and that already read (60.2's 60g kept): unchanged.
        for name, reached in (("Quarterfinals", "quarter_final"), ("Semifinals", "semi_final"), ("Final", "final"),
                              ("Quarts de finale", "quarter_final"), ("Demi-finales", "semi_final"), ("Finale", "final"),
                              ("Huitièmes de finale", "round_of_16"), ("Third place", None), ("Matchday 3", None)):
            self.assertEqual(a.reached_round(None, name), reached, name)
        # open-matchday's numbered rounds (« 1 » to « 7 ») stay unread: a known limit, no round is guessed.
        for name in ("1", "6", "7"):
            self.assertIsNone(a.reached_round(None, name), name)
        # power.round_of, which the v8 ranking's stakes and 171_home_importance_v2.sql read, is not changed.
        self.assertIsNone(power.round_of(None, "Finals, Final"))


class NationalCupTest(unittest.TestCase):
    """60al, 60am, 60as (§60.3): a national cup by its key, one cup of two sources, the five countries' cups."""

    def test_60al_a_national_cup_is_named_by_its_key(self):
        for key, country in (("open-cups:fa-cup-archive:2024/2025", "ENG"), ("open-cups:efl-cup-archive:2024/2025", "ENG"),
                             ("open-cups:copa-del-rey-archive:2024/2025", "ESP"), ("open-cups:coppa-italia-archive:2024/2025", "ITA"),
                             ("open-cups:france-cup:2024/2025", "FRA"), ("openligadb:germany-cup:2025/2026", "GER"),
                             ("open-cups:germany-cup-archive:2024/2025", "GER"), ("open-matchday:ENG_CUP_fa-cup:2026/2027", "ENG"),
                             ("open-matchday:ESP_CUP_copa-del-rey:2026/2027", "ESP"),
                             ("open-matchday:ENG_1_premier-league:2026/2027", None), ("open-matchday:UEFA_1_champions-league:2026/2027", None),
                             ("open-cups:copa-libertadores:2025", None), ("open-cups:world-cup-history:2022", None), ("open-cups:euro:2024", None),
                             ("nations-results:internationals:2025/2026", None), ("openligadb:nations-league:2026/2027", None), (None, None)):
            self.assertEqual(power._cup_country(key), country, key)

    def test_60am_one_cup_two_sources_one_competition(self):
        from vega.sources.curated import CUP_LOGO_ALSO

        a = award()
        fa = a._competition(5, None, "open-cups:fa-cup-archive:2024/2025")
        copy = a._competition(6, None, "open-matchday:ENG_CUP_fa-cup:2024/2025")
        self.assertEqual(fa[0], copy[0])
        self.assertEqual((fa[1], copy[1]), (2, 3))  # OpenFootball read before open-matchday
        german = [a._competition(e, None, key) for e, key in ((7, "openligadb:germany-cup:2025/2026"), (8, "open-cups:germany-cup-archive:2025/2026"),
                                                                (9, "open-matchday:GER_CUP_dfb-pokal:2025/2026"))]
        self.assertEqual({k for k, _ in german}, {"openligadb:germany-cup"})
        self.assertEqual([o for _, o in german], [1, 2, 3])
        self.assertEqual(a._competition(1, "l_1XLtP0", None), ("l_1XLtP0", 0))
        self.assertEqual(a._competition(2, None, "open-cups:world-cup-history:2022"), ("l_1XLtP0", 2))
        self.assertEqual(a._competition(3, None, "open-matchday:UEFA_1_champions-league:2025/2026"), ("l_0bfbkO", 3))
        self.assertEqual(a._competition(4, None, None), (("edition", 4), 0))
        # Every national cup group of CUP_LOGO_ALSO is one competition; the Nations League pair is not a national cup.
        for site, also in CUP_LOGO_ALSO.items():
            keys = {a._competition(1, None, f"{k}:2025/2026")[0] for k in (site, *(x.removeprefix("cup:") for x in also))}
            national = any(power._cup_country(f"{k}:2025/2026") for k in (site, *(x.removeprefix("cup:") for x in also)))
            self.assertEqual(len(keys), 1 if national else 1 + len(also), site)
        # Two editions of one source stay two competitions.
        self.assertNotEqual(a._competition(1, None, "open-cups:fa-cup-archive:2024/2025")[0], a._competition(2, None, "open-cups:efl-cup-archive:2024/2025")[0])

    def test_60as_the_national_cups_are_counted_only_with_the_five_countries(self):
        a = award()
        self.assertEqual(a.NATIONAL_CUP_COUNTRIES, ("ENG", "ESP", "GER", "ITA", "FRA"))
        self.assertEqual(a.national_cups({"GER"}), {"counted": False, "held": ["GER"]})
        self.assertEqual(a.national_cups(set()), {"counted": False, "held": []})
        self.assertEqual(a.national_cups({"ENG", "ESP", "GER", "ITA"}), {"counted": False, "held": ["ENG", "ESP", "GER", "ITA"]})
        self.assertEqual(a.national_cups({"ENG", "ESP", "GER", "ITA", "FRA", "NED"}), {"counted": True, "held": ["ENG", "ESP", "FRA", "GER", "ITA", "NED"]})
        self.assertEqual(a.national_cups({None, "ENG", "ESP", "GER", "ITA", "FRA"})["counted"], True)


def ranked(p, individual, collective, **flags):
    return {"individual": individual, "collective": collective, "fair_play": 0.0, "position": CB, "universe": "men", "reference": True,
            "eligible": True, "linked": True, "top_division": True, "measured": True, **flags}


class ScaleTest(unittest.TestCase):
    """60an–60ar (§60.3): z_C = k × C, k = mean of the 30 highest z_I / mean of the 30 highest C of the ranked players."""

    @staticmethod
    def k_of(rows, people):
        mine = [p for p, r in rows.items() if r["reason"] is None]
        top_i = sorted((rows[p]["z_individual"] for p in mine), reverse=True)[:30]
        top_c = sorted((people[p]["collective"] for p in mine), reverse=True)[:30]
        return (sum(top_i) / len(top_i)) / (sum(top_c) / len(top_c)), sum(top_i) / len(top_i), sum(top_c) / len(top_c), len(top_i)

    def test_60an_a_larger_c_ranks_above_where_v1_tied_them_at_the_cap(self):
        a = award()
        people = {p: ranked(p, float(p % 7), 0.0) for p in range(1, 201)}
        people[1] = ranked(1, 10.0, 0.37)
        people[2] = ranked(2, 10.0, 0.73)
        own = a.own_spreads(people)
        mean, sd = own["collective"]
        self.assertLess(mean + a.Z_CAP * sd, 0.37)  # both above the v1 cap: v1 gave both z_C 4
        rows, spreads = a.combine(people)
        k, top_i, top_c, top = self.k_of(rows, people)
        self.assertAlmostEqual(rows[1]["z_collective"], k * 0.37)
        self.assertAlmostEqual(rows[2]["z_collective"], k * 0.73)
        self.assertLess(rows[2]["rank"], rows[1]["rank"])
        self.assertEqual(rows[2]["rank"], 1)
        scale = spreads["collective_scale"]
        self.assertEqual(scale["source"], "own")
        self.assertEqual(scale["top"], 30)
        for name, value in (("k", k), ("mean_top_individual", top_i), ("mean_top_collective", top_c)):
            self.assertAlmostEqual(scale[name], value, places=12)
        self.assertEqual(a.SCALE_TOP, 30)
        self.assertEqual(json.loads(json.dumps(spreads)), spreads)

    def test_60ao_no_honour_no_collective_part(self):
        a = award()
        people = {p: ranked(p, float(p), 0.1 * (p % 3)) for p in range(1, 41)}
        rows, spreads = a.combine(people)
        self.assertGreater(spreads["collective_scale"]["k"], 0)
        for p in people:
            if people[p]["collective"] == 0:
                self.assertEqual(rows[p]["z_collective"], 0.0)
            else:
                self.assertAlmostEqual(rows[p]["z_collective"], spreads["collective_scale"]["k"] * people[p]["collective"])

    def test_60ap_fewer_than_30_ranked_players_and_those_out_of_the_race(self):
        a = award()
        people = {p: ranked(p, float(p), 0.05 * p) for p in range(1, 13)}
        for p in range(90, 96):  # out of the race (minutes), the highest I and C
            people[p] = ranked(p, 100.0 + p, 5.0, eligible=False, reference=False)
        rows, spreads = a.combine(people)
        k, top_i, top_c, top = self.k_of(rows, people)
        self.assertEqual(top, 12)
        scale = spreads["collective_scale"]
        self.assertEqual(scale["top"], 12)
        self.assertAlmostEqual(scale["k"], k, places=12)
        self.assertAlmostEqual(scale["mean_top_collective"], sum(0.05 * p for p in range(1, 13)) / 12, places=12)
        self.assertAlmostEqual(rows[95]["z_collective"], k * 5.0)  # out of the race: the same k
        self.assertIsNone(rows[95]["rank"])

    def test_60aq_k_is_zero_when_a_mean_is_not_positive(self):
        a = award()
        for name, people in (("every C at zero", {p: ranked(p, float(p), 0.0) for p in range(1, 41)}),
                             ("every z_I zero", {p: ranked(p, 5.0, 0.1 * p) for p in range(1, 41)}),
                             ("no ranked player", {p: ranked(p, float(p), 0.1, eligible=False, reference=False) for p in range(1, 6)})):
            rows, spreads = a.combine(people)
            self.assertEqual(spreads["collective_scale"]["k"], 0.0, name)
            self.assertTrue(all(r["z_collective"] == 0.0 for r in rows.values()), name)
            ranks = sorted(r["rank"] for r in rows.values() if r["rank"] is not None)
            self.assertEqual(ranks, list(range(1, len(ranks) + 1)), name)

    def test_60ar_a_year_in_progress_takes_its_reference_year_s_k(self):
        a = award()
        people = {p: ranked(p, float(p), 0.01 * p) for p in range(1, 41)}  # early in a season: a small C
        _, own = a.combine(people)
        reference = {**own, "collective_scale": {"k": 2.5, "mean_top_individual": 3.0, "mean_top_collective": 1.2, "top": 30, "source": "own"}}
        rows, used = a.combine(people, reference)
        self.assertEqual(used["collective_scale"], {**reference["collective_scale"], "source": "reference"})
        self.assertNotAlmostEqual(own["collective_scale"]["k"], 2.5)
        for p, r in rows.items():
            self.assertAlmostEqual(r["z_collective"], 2.5 * people[p]["collective"])
        # Its reference year without a published run of this version: k 0, its own spreads otherwise, never its own k.
        rows, used = a.combine(people, {})
        self.assertEqual(used["collective_scale"]["k"], 0.0)
        self.assertEqual(used["collective_scale"]["source"], "none")
        self.assertEqual((used["individual"], used["collective"]), (own["individual"], own["collective"]))
        self.assertTrue(all(r["z_collective"] == 0.0 for r in rows.values()))
        # evaluate keeps each position's mean card rate with its own spreads, as for a year without a reference.
        cards = {p: (0, 0.0) for p in people}
        bare = {p: {k: v for k, v in r.items() if k != "collective"} for p, r in people.items()}
        _, _, kept = a.evaluate(bare, [], cards, {})
        self.assertEqual(len(kept["fair_play"][CB]), 3)
        self.assertEqual(kept["collective_scale"]["source"], "none")
        # A reference year's run kept without a scale (another version cannot be read, 60.3): k 0.
        rows, used = a.combine(people, {k: v for k, v in reference.items() if k != "collective_scale"})
        self.assertEqual((used["collective_scale"]["k"], used["collective_scale"]["source"]), (0.0, "none"))


class SettingsTest(unittest.TestCase):
    """60p, 60u: the version and the settings a run keeps and stale() compares."""

    def test_60p_60u_the_version_and_the_settings(self):
        a = award()
        self.assertEqual(a.AWARD_VERSION, "vega-award-v1.1")
        self.assertEqual(a.SETTINGS, {
            "weights": {"individual": 0.6, "collective": 0.3, "fair_play": 0.1}, "z_cap": 4.0, "collective_scale": "proportional", "scale_top": 30,
            "national_cup_countries": ["ENG", "ESP", "GER", "ITA", "FRA"], "league_value": 0.5, "cup_value": 0.15,
            "league_ranks": {"1": 1.0, "2": 0.4, "3": 0.2, "4": 0.1},
            "round_value": {"winner": 1.0, "final": 0.6, "semi_final": 0.4, "quarter_final": 0.25, "round_of_16": 0.15},
            "card_prior_minutes": 900, "national_matches": True, "national_proxy_share": 0.5, "keeper_in_race": False,
            "level_version": level.LEVEL_VERSION})
        self.assertEqual(json.loads(json.dumps(a.SETTINGS)), a.SETTINGS)  # as agg.award_runs.settings keeps it
        self.assertEqual(a.settings()["league_ranks"], {"1": 1.0, "2": 0.4, "3": 0.2, "4": 0.1})  # read from the tables each time


if __name__ == "__main__":
    unittest.main()
