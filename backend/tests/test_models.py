"""Models against docs/calculs: a synthetic Ligue 1 of 8 clubs, 56 matches, 88 players.

Expected values are recomputed here, in plain Python, from the rows inserted, with the
formulas of the docs; the database must agree.
"""

from collections import Counter, defaultdict
from datetime import date, timedelta
import os
from pathlib import Path
import sys
import unittest
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from vega import models
from vega.models import half_up

try:
    import psycopg
except ImportError:
    psycopg = None
DSN = os.environ.get("VEGA_V2_MODELS_TEST_DSN")
TEAMS = range(1, 9)
SQUAD = (("G", 11), ("D", 32), ("D", 33), ("D", 34), ("D", 35), ("M", 62), ("M", 63), ("M", 64), ("M", 65), ("O", 92), ("O", 93))


def centile(values, x, direction=1):
    """docs/calculs/04-clubs/02: round(100 × (#below + ½ #equal) / n), inverted if lower is better."""
    raw = half_up(100 * (sum(v < x for v in values) + 0.5 * sum(v == x for v in values)) / len(values))
    return 100 - raw if direction == -1 else raw


class FormulaTest(unittest.TestCase):
    def test_rounding_and_centile_examples(self):
        self.assertEqual((half_up(64.5), half_up(63.9), half_up(2.5)), (65, 64, 3))
        # 18 clubs, 11 below, none equal but the club itself -> 64.
        self.assertEqual(centile(list(range(11)) + [11] + list(range(12, 18)), 11), 64)
        # Vega index example: 0.30×80 + 0.30×60 + 0.15×70 + 0.10×50 + 0.10×40 + 0.05×55 = 64.25 -> 64.
        phases = {"attack": 80, "defence": 60, "control": 70, "pressing": 50, "finishing": 40, "set_pieces": 55}
        self.assertEqual(half_up(sum(models.PHASE_WEIGHTS[p] * v for p, v in phases.items())), 64)

    def test_generated_labels_migration_is_current(self):
        self.assertEqual((ROOT / "sql" / "015_metric_labels.sql").read_text(encoding="utf-8"), models.definitions_sql())


@unittest.skipUnless(DSN and psycopg, "requires disposable local models DB and psycopg")
class ModelsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        target = urlparse(DSN)
        if target.hostname not in ("localhost", "127.0.0.1", "::1") or target.path != "/vega_v2_models_test":
            raise RuntimeError("dedicated local models DB required")
        from vega.calculator import refresh_competition_season
        from vega.store import Store, connect_local, migrate

        cls.db = connect_local(DSN)
        cls.db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        migrate(cls.db)
        with cls.db.transaction():
            Store(cls.db).season("2025/2026")
        cls.facts = cls.build()
        refresh_competition_season(cls.db, 1)
        cls.cohorts = models.refresh_season(cls.db, 2025)

    def test_a_league_round_closes_with_its_team_and_the_race(self):
        from vega import rounds

        # The synthetic league's matches carry no round: one week, long over, closes.
        closed = rounds.refresh(self.db, 2025)
        self.assertEqual(closed, {1})
        status, played, matches = self.one("SELECT status, played, matches FROM agg.league_rounds WHERE competition_season_id = 1")
        self.assertEqual(status, "closed")
        self.assertEqual(played, matches)
        self.assertEqual(self.one("SELECT count(*) FROM agg.league_round_matches WHERE competition_season_id = 1")[0], matches)
        # The Team of the Round: eleven distinct players, each in a slot of his role, or none when the round cannot fill one.
        team = self.db.execute("SELECT slot, slot_role, role, player_id, minutes FROM agg.round_teams WHERE competition_season_id = 1 ORDER BY slot").fetchall()
        self.assertIn(len(team), (0, 11))
        if team:
            self.assertEqual(len({t[3] for t in team}), 11)
            self.assertTrue(all(t[2] in rounds.SLOT_ROLES[t[1]] for t in team))
        # The race: best first, its players read with their grade.
        race = self.db.execute("SELECT rank, z FROM agg.round_season_race WHERE competition_season_id = 1 ORDER BY rank").fetchall()
        self.assertTrue(race)
        self.assertEqual([r[1] for r in race], sorted((r[1] for r in race), reverse=True))
        self.assertEqual(self.one("SELECT count(*) FROM api.round_season_race WHERE competition_season_id = 1")[0], len(race))
        # The whole race is kept, not its first ten (VI-44): every eligible player, in the race's order.
        self.assertFalse(hasattr(rounds, "RACE_KEPT"))
        key = self.one("SELECT round_key FROM agg.league_rounds WHERE competition_season_id = 1")[0]
        eligible = rounds.race_after(self.db, 1, key, 2025)
        stored = self.db.execute("SELECT player_id FROM agg.round_season_race WHERE competition_season_id = 1 ORDER BY rank").fetchall()
        self.assertEqual([r[0] for r in stored], [r[0] for r in eligible])
        # A second pass closes nothing again and rewrites nothing.
        self.assertEqual(rounds.refresh(self.db, 2025), set())
        self.assertEqual(self.one("SELECT count(*) FROM agg.round_season_race WHERE competition_season_id = 1")[0], len(race))
        self.assertEqual(rounds.open_league_matches(self.db, 2025), set())

    def test_power_rankings_of_clubs(self):
        rows = self.db.execute("SELECT team_id, elo, rank, matches, scope FROM agg.team_power WHERE season_id=2025 ORDER BY rank").fetchall()
        self.assertEqual(len(rows), 8)
        self.assertTrue(all(r[4] == "clubs" and r[3] == 14 for r in rows))
        self.assertAlmostEqual(sum(r[1] for r in rows) / 8, 1500, places=2)  # Elo only moves points between clubs
        self.assertEqual([r[2] for r in rows], sorted(r[2] for r in rows))
        # The season in Elo terms: start + change = Elo, the record adds up, peak ≥ Elo ≥ low.
        for elo, change, matches, start, peak, low, w, d, l, result, expected in self.db.execute(
            """SELECT elo, elo_change, matches, elo_start, elo_peak, elo_low, wins, draws, losses, result_sum, expected_sum
               FROM agg.team_power WHERE season_id=2025"""
        ).fetchall():
            self.assertAlmostEqual(start + change, elo, places=2)
            self.assertEqual(w + d + l, matches)
            self.assertAlmostEqual(result, w + 0.5 * d, places=3)
            self.assertTrue(peak + 1e-3 >= elo >= low - 1e-3)
            self.assertTrue(0 < expected < matches)
        points = self.facts["points"]
        self.assertGreater(points[rows[0][0]], points[rows[-1][0]])

    def test_power_rankings_of_players(self):
        from vega import power

        # One league in the base: it is its own scale, and its country's top division.
        self.assertEqual(self.db.execute("SELECT count(*), bool_and(linked), sum(links) FROM agg.league_levels").fetchone(), (1, True, 0))
        ranked = self.db.execute(
            "SELECT player_id, role, minutes, total, rate, score, rank, role_rank FROM agg.player_power WHERE season_id=2025 AND eligible ORDER BY rank"
        ).fetchall()
        self.assertEqual(len(ranked), 88)  # 14 matches of 90 minutes: everyone is eligible
        # The synthetic line-ups name no formation: each slot keeps its own reading (role_of).
        self.assertEqual({r[1] for r in ranked}, {"goalkeeper", "full_back", "centre_back", "defensive_midfielder", "central_midfielder", "winger", "centre_forward"})
        self.assertTrue(all(0 <= r[5] <= 100 for r in ranked))
        self.assertEqual(ranked[0][6], 1)
        weight = self.db.execute("SELECT level_weight FROM agg.power_runs WHERE kind='players' AND status='published'").fetchone()[0]
        self.assertGreater(weight, 0)
        own_of = {}
        for player, role, minutes, total, rate, *_ in ranked:
            own, level, index, linked, top = self.db.execute(
                "SELECT own_total, level_total, index, linked, top_division FROM agg.player_power WHERE season_id=2025 AND player_id=%s", (player,)
            ).fetchone()
            own_of[player] = own
            self.assertTrue(linked and top)
            self.assertAlmostEqual(own + level, total, places=3)  # what he does, and the level of his club
            self.assertAlmostEqual(rate, 90 * total / (minutes + 450), places=3)
            summed = self.db.execute(
                "SELECT sum(contribution), sum(level), sum(minutes) FROM agg.player_power_matches WHERE season_id=2025 AND player_id=%s", (player,)
            ).fetchone()
            self.assertAlmostEqual(summed[0], own, places=3)
            self.assertAlmostEqual(weight * summed[1], level, places=3)
            self.assertEqual(summed[2], minutes)
        # The rank is the index's; the score shown follows it.
        indexes = [r[0] for r in self.db.execute("SELECT index FROM agg.player_power WHERE season_id=2025 AND eligible ORDER BY rank").fetchall()]
        self.assertEqual(indexes, sorted(indexes, reverse=True))
        self.assertEqual([r[5] for r in ranked], sorted((r[5] for r in ranked), reverse=True))
        # Each block's share of T: they add up to T; percentiles within the role for its blocks.
        blocks = ("finishing", "creation", "progression", "defence", "retention", "shot_stopping", "aerial", "depth", "distribution")
        for player, role, minutes, total, *_ in ranked:
            row = self.db.execute(
                f"SELECT {', '.join(b + '_total' for b in blocks)}, {', '.join(b + '_percentile' for b in blocks)} FROM agg.player_power WHERE season_id=2025 AND player_id=%s",
                (player,),
            ).fetchone()
            totals, percentiles = row[:9], row[9:]
            self.assertAlmostEqual(sum(v or 0 for v in totals), own_of[player], places=3)
            mine = dict(zip(blocks, percentiles))
            self.assertEqual({b for b, v in mine.items() if v is not None}, set(power.blocks_of(role)))
            self.assertTrue(all(0 <= v <= 100 for v in mine.values() if v is not None))
            # One row per role played; they add up to the season.
            roles = self.db.execute("SELECT sum(minutes), sum(total), sum(matches) FROM agg.player_power_roles WHERE season_id=2025 AND player_id=%s", (player,)).fetchone()
            self.assertEqual(roles[0], minutes)
            self.assertAlmostEqual(roles[1], own_of[player], places=3)
        # The best of each role is first of his role.
        for role in {r[1] for r in ranked}:
            mine = [r for r in ranked if r[1] == role]
            self.assertEqual(min(r[7] for r in mine), 1)
        run = self.db.execute(
            """SELECT method_version, elo_k, regularisation_minutes, eligibility_minutes, eligibility_share, level_share, score_scale, year_start, year_end
               FROM agg.power_runs WHERE kind='players' AND status='published'"""
        ).fetchone()
        # 14 matches of 90 minutes: the year is young, half the most used player's minutes make a player eligible.
        self.assertEqual(run[:7], ("power-ranking-v8", 20.0, 450.0, 630.0, 0.5, 0.5, 4.0))
        self.assertEqual([d.isoformat() for d in run[7:]], ["2025-08-01", "2026-07-31"])
        elo = self.db.execute("SELECT seed_rounds, level_exchange, measured_se FROM agg.power_runs WHERE kind='elo' AND status='published'").fetchone()
        self.assertEqual(elo[0], 1)  # nothing ties the league to another: its level does not move
        self.assertAlmostEqual(elo[1], power.LEVEL_EXCHANGE, places=5)
        self.assertEqual(elo[2], power.MEASURED_SE)
        # Every player-match has its grade, read against the reference the run kept (the year before
        # being absent, its own); an ordinary match of the role is near 50.
        graded, total = self.one("SELECT count(match_index), count(*) FROM agg.player_power_matches WHERE season_id=2025 AND contribution IS NOT NULL")
        self.assertEqual(graded, total)
        self.assertGreater(self.one("SELECT count(*) FROM agg.match_grade_roles")[0], 0)
        self.assertLess(abs(self.one("SELECT avg(match_index) FROM agg.player_power_matches WHERE season_id=2025 AND minutes >= 60")[0]), 0.5)
        # The grades are kept where the statistics are, one per graded player-match, with the
        # finished year they were read against (none: the year's own rows) and their first value.
        kept, same, firsts = self.one("""SELECT count(*), count(*) FILTER (WHERE g.z = p.match_index), count(*) FILTER (WHERE g.first_z = g.z)
            FROM agg.player_match_grades g JOIN agg.player_power_matches p ON p.season_id = g.award_season AND p.match_id = g.match_id AND p.player_id = g.player_id""")
        self.assertEqual((kept, same, firsts), (graded, graded, graded))
        self.assertEqual(self.one("SELECT count(*) FROM agg.player_match_grades")[0], graded)
        # The editions' sums: matches of 20 minutes or more, the minutes-weighted z.
        sums = self.one("""SELECT sum(grade_count), sum(grade_minutes), round(sum(zm_sum)::numeric, 3) FROM agg.player_grade_editions""")
        direct = self.one("""SELECT count(*), sum(minutes), round(sum(minutes * z::float8)::numeric, 3) FROM agg.player_match_grades WHERE minutes >= 20""")
        self.assertEqual(sums, direct)
        # A second run rewrites no grade that did not move.
        changed = self.one("SELECT max(changed_at) FROM agg.player_match_grades")[0]
        power.refresh_players(self.db, 2025)
        self.assertEqual(self.one("SELECT max(changed_at) FROM agg.player_match_grades")[0], changed)
        self.assertEqual(self.one("SELECT count(*) FROM agg.player_match_grades")[0], graded)
        # Its level is known exactly against itself: measured, a top division of the men's universe.
        self.assertEqual(self.db.execute("SELECT level_se, tier, universe, movers FROM agg.league_levels").fetchone(), (0.0, 1, "men", 0))
        # The season before has no statistics: its award year is not computed from this season's first months.
        self.assertFalse(power.previous_year_changed(self.db, 2025))
        # The award race: the first 30 of the ranking, numbered 1..30, with its calc run.
        race = self.db.execute(
            """SELECT a.rank, a.player_id, a.score, r.kind, r.status FROM agg.player_award_ranking a JOIN agg.calc_runs r ON r.id=a.calc_run_id
               WHERE a.season_id=2025 AND a.award='ballon_dor' ORDER BY a.rank"""
        ).fetchall()
        self.assertEqual([r[0] for r in race], list(range(1, 31)))
        rank_of = {r[0]: r[6] for r in ranked}
        self.assertEqual([rank_of[r[1]] for r in race], [r[6] for r in ranked[:30]])  # ties may come in either order
        self.assertTrue(all(r[3] == "award" and r[4] == "published" for r in race))
        self.assertAlmostEqual(race[0][2], ranked[0][5], places=3)

    def level_run(self, season=2025):
        return self.one("""SELECT id, version, reference_season, players, settings, measured FROM agg.level_runs
                           WHERE season_id = %s AND status = 'published'""", season)

    def test_player_levels_beside_the_ranking(self):
        # Score Vega v9 (issue #82, FAILURE_MODES §49, 49p and 49q) and v9.1 (issue #90, §54, 54h): the level is
        # computed by the ranking's run, beside it. Expected values are recomputed here from the rows the run
        # kept and the rows inserted.
        from vega import level, power

        x = self.db.execute
        run, version, reference, players, settings, measured = self.level_run()
        self.assertEqual((version, players), ("score-vega-v9.1", 88))
        self.assertEqual(reference, 2025)  # the award year is over: it measures its own references and keeps them
        self.assertEqual({k: settings[k] for k in ("psi", "e", "e_starts", "goal", "keeper_lambda", "defence_bound", "scale", "previous_weight", "acquired_minutes")},
                         {"psi": 10.0, "e": level.E, "e_starts": level.E_STARTS, "goal": level.GOAL, "keeper_lambda": 13291.0, "defence_bound": 2.0, "scale": 36.0,
                          "previous_weight": 0.5, "acquired_minutes": 450})
        self.assertEqual((settings["keeper_measured_share"], settings["position_offsets"]), (0.5, {"men": {"full_back": -1.05}}))
        self.assertEqual(settings, level.SETTINGS)
        self.assertEqual(set(measured["lam"]), set(level.OUTFIELD))
        self.assertTrue(all(len(measured[k][p]) == 5 for k in ("lam", "sd", "prices") for p in level.OUTFIELD))
        rows = x("""SELECT player_id, position, team_id, universe, eligible, linked, minutes, level, own, blocks, starts, club, start_share,
                           score, rank, position_rank, run_id FROM agg.player_level WHERE season_id = 2025 ORDER BY rank""").fetchall()
        # Every player of the league has a level: 14 club matches each, all judged.
        self.assertEqual(len(rows), 88)
        self.assertEqual({r[0] for r in rows}, {p for p, *_ in self.facts["players"]})
        self.assertTrue(all(r[16] == run and r[3] == "men" and r[4] and r[5] and r[6] == 14 * 90 for r in rows))
        # The position: the v8 role of the slot, a winger's slot read as one of three.
        role = dict(x("SELECT player_id, role FROM agg.player_power WHERE season_id = 2025").fetchall())
        slot = {p: position for p, _, _, position in self.facts["players"]}

        def position_of(player):
            if role[player] != "winger":
                return role[player]
            row, place = divmod(slot[player], 10)
            return "attacking_midfielder" if row in (8, 9) and place in (4, 5, 6) else "wide_midfielder" if row in (6, 7) and place in (1, 2, 8, 9) else "winger"

        self.assertEqual({r[0]: r[1] for r in rows}, {p: position_of(p) for p in role})
        self.assertEqual(sum(r[1] == "goalkeeper" for r in rows), 8)
        # 54h: every keeper has goals prevented in each of his matches, so everybody is measured.
        self.assertEqual(self.one("SELECT count(*), bool_and(measured) FROM agg.player_level WHERE season_id = 2025"), (88, True))
        self.assertEqual(self.one("SELECT count(*), bool_and(measured) FROM api.player_levels WHERE season_id = 2025"), (88, True))
        self.assertTrue({r[1] for r in rows} <= set(level.POSITIONS))
        # The parts add up; everybody started every match, so starting separates nobody.
        for r in rows:
            self.assertAlmostEqual(r[8], r[9] + r[10], places=3)
            self.assertAlmostEqual(r[7], r[8] + r[11], places=3)
            self.assertEqual((r[12], round(r[10], 4)), (1.0, 0.0))
        # The club: ψ × the club's Elo before its matches, above the mean of the year, in units of 400.
        elo = defaultdict(list)
        for team, before in x("SELECT team_id, elo_before FROM agg.team_elo WHERE season_id = 2025").fetchall():
            elo[team].append(before)
        centre = sum(sum(v) for v in elo.values()) / sum(len(v) for v in elo.values())
        for r in rows:
            self.assertAlmostEqual(r[11], level.PSI * (sum(elo[r[2]]) / len(elo[r[2]]) - centre) / 400, places=3)
        # The score: one curve around the median level; the rank is the level's, the position's rank too.
        ordered = sorted(r[7] for r in rows)
        median = ordered[len(ordered) // 2]
        for r in rows:
            self.assertAlmostEqual(r[13], 100 / (1 + 10 ** (-(r[7] - median) / 36)), places=2)
            self.assertTrue(0 <= r[13] <= 100)
        self.assertEqual([r[14] for r in rows], list(range(1, 89)))
        self.assertEqual([r[7] for r in rows], sorted((r[7] for r in rows), reverse=True))
        for position in {r[1] for r in rows}:
            self.assertEqual([r[15] for r in rows if r[1] == position], list(range(1, sum(r[1] == position for r in rows) + 1)))
        # One position each: its share is whole, its talents are the cell's rates drawn towards the position's
        # mean by the minutes, its value their sum at the position's prices; the blocks are the value above
        # the position's mean.
        blocks = level.BLOCKS
        cells = {(p, position): (minutes, block_minutes, sums, keeper_minutes, prevented) for p, position, minutes, *rest in x(
            f"""SELECT player_id, position, minutes, {', '.join(b + '_minutes' for b in blocks)}, {', '.join(b + '_sum' for b in blocks)},
                       keeper_minutes, goals_prevented FROM agg.player_level_cells WHERE season_id = 2025""").fetchall()
            for block_minutes, sums, keeper_minutes, prevented in [(rest[:5], rest[5:10], rest[10], rest[11])]}
        self.assertEqual(len(cells), 88)
        positions = x(f"""SELECT player_id, position, acquired, minutes, minutes_two_seasons, share, value, level, {', '.join(blocks)}
                          FROM agg.player_level_positions WHERE season_id = 2025""").fetchall()
        self.assertEqual(len(positions), 88)
        by_position = defaultdict(list)
        for player, position, acquired, minutes, both, share, value, own_level, *talents in positions:
            by_position[position].append(value)
            self.assertEqual((acquired, minutes, both, share), (True, 1260, 1260, 1.0))
            cell = cells[(player, position)]
            self.assertEqual(cell[0], 1260)
            if position == "goalkeeper":
                prevented = float(self.one("SELECT sum(goals_prevented) FROM core.player_match_stats WHERE season_id = 2025 AND player_id = %s", player)[0])
                self.assertAlmostEqual(cell[4], prevented, places=3)
                self.assertAlmostEqual(value, level.GOAL * 90 * prevented / (1260 + level.KEEPER_LAMBDA), places=3)
                self.assertEqual(talents, [None] * 5)
                continue
            expected = 0.0
            for b, name in enumerate(blocks):
                self.assertTrue(0 <= cell[1][b] <= 1260)  # the minutes of the matches that measure the block
                if not cell[1][b]:
                    self.assertAlmostEqual(talents[b], 0.0, places=5)  # nothing seen: the position's mean
                    continue
                talent = 90 * cell[2][b] / measured["sd"][position][b] / (cell[1][b] + measured["lam"][position][b])
                if name == "defence":
                    talent = max(-2.0, min(2.0, talent))
                self.assertAlmostEqual(talents[b], talent, places=3)
                expected += measured["prices"][position][b] * talent
            self.assertAlmostEqual(value, expected, places=2)
        mean = {position: sum(values) / len(values) for position, values in by_position.items()}
        of = {r[0]: r for r in rows}
        # 54h: the men's full-backs are centred 1.05 under their mean, the other positions on theirs.
        offset = {"full_back": -1.05}
        self.assertEqual(sum(position == "full_back" for _, position, *_ in positions), 8)  # one per club (slot 32)
        for player, position, _, _, _, _, value, own_level, *_ in positions:
            self.assertAlmostEqual(of[player][9], value - mean[position] + offset.get(position, 0.0), places=3)
            self.assertAlmostEqual(own_level, of[player][7], places=3)  # one position: its level is the player's
        for position in by_position:
            held = [of[player][9] for player, at, *_ in positions if at == position]
            self.assertAlmostEqual(sum(held) / len(held), offset.get(position, 0.0), places=3)
        # An attacking position's blocks are centred on the year: their sums over its players are nil.
        for position in set(level.ATTACK) & set(by_position):
            for b in range(5):
                self.assertAlmostEqual(sum(c[2][b] for (_, at), c in cells.items() if at == position), 0.0, places=2)
        # A non-attacking position is priced by the announced weights; too few players for a measure of
        # their own: the stated defaults.
        for position in set(by_position) - set(level.ATTACK) - {"goalkeeper"}:
            for b, name in enumerate(blocks):
                self.assertAlmostEqual(measured["prices"][position][b], level.E * power.WEIGHTS[position][name], places=6)
        self.assertEqual({measured["lam"][p][b] for p in level.OUTFIELD for b in range(5)}, {level.DEFAULT_LAMBDA})
        self.assertNotIn("keeper", measured)  # 54a: the keeper's reference is a setting, not a measure
        # The reads: one row per player and per position, with the run's version.
        self.assertEqual(self.one("SELECT count(*), min(version), max(version) FROM api.player_levels WHERE season_id = 2025"), (88, level.LEVEL_VERSION, level.LEVEL_VERSION))
        self.assertEqual(self.one("SELECT count(*) FROM api.player_level_positions WHERE season_id = 2025")[0], 88)
        # 49q: a second run gives the same levels, publishes its own run and supersedes the earlier.
        kept = x("SELECT player_id, level, score, rank FROM agg.player_level WHERE season_id = 2025 ORDER BY player_id").fetchall()
        runs = self.one("SELECT count(*) FROM agg.level_runs WHERE season_id = 2025")[0]
        self.assertEqual(power.refresh_players(self.db, 2025), 88)
        self.assertEqual(x("SELECT player_id, level, score, rank FROM agg.player_level WHERE season_id = 2025 ORDER BY player_id").fetchall(), kept)
        self.assertEqual(self.one("""SELECT count(*), count(*) FILTER (WHERE status = 'published'), count(*) FILTER (WHERE status = 'running')
                                     FROM agg.level_runs WHERE season_id = 2025"""), (runs + 1, 1, 0))
        self.assertNotEqual(self.level_run()[0], run)
        self.assertEqual(self.one("SELECT count(DISTINCT run_id) FROM agg.player_level WHERE season_id = 2025")[0], 1)
        self.assertEqual(power.stale_rankings(self.db), [])

    def test_player_levels_of_two_years_are_computed_oldest_first(self):
        # 49r, 49o: a year's level reads half of the year before's sums, so the years the level leaves stale
        # are run oldest first; a year whose level is older than the year before's is run again.
        from vega import level, power
        from vega.store import Store

        x = self.db.execute
        with self.db.transaction():
            before = Store(self.db).season("2024/2025")
        self.assertEqual(before, 2024)
        player, position = self.one("SELECT player_id, position FROM agg.player_level WHERE season_id = 2025 AND position = 'centre_back' ORDER BY player_id LIMIT 1")
        alone = self.one("SELECT minutes_two_seasons, defence FROM agg.player_level_positions WHERE season_id = 2025 AND player_id = %s", player)
        try:
            # A base ranked before the level existed: two published rankings with players, no level.
            x("DELETE FROM agg.player_level WHERE season_id = 2025")
            x("DELETE FROM agg.player_level_positions WHERE season_id = 2025")
            x("DELETE FROM agg.player_level_cells WHERE season_id = 2025")
            x("DELETE FROM agg.level_runs")
            x("""INSERT INTO agg.power_runs(kind, season_id, method_version, status, finished_at, players)
                 VALUES ('players', 2024, %s, 'published', now(), 3)""", (power.METHOD_VERSION,))
            self.assertEqual(power.stale_rankings(self.db), [2024, 2025])
            for season in power.stale_rankings(self.db):
                power.refresh_players(self.db, season)
            self.assertEqual(power.stale_rankings(self.db), [])
            self.assertEqual(self.level_run(2024)[1:4], (level.LEVEL_VERSION, None, 0))  # no statistics that year: an empty level
            self.assertEqual(self.one("SELECT count(*) FROM agg.player_level WHERE season_id = 2025")[0], 88)
            # The year before now has sums for one centre-back: 900 minutes, a defence of + 1 per 90.
            previous = self.level_run(2024)[0]
            x("""INSERT INTO agg.player_level_cells(season_id, player_id, position, team_id, minutes, finishing_minutes, creation_minutes,
                   progression_minutes, defence_minutes, retention_minutes, finishing_sum, creation_sum, progression_sum, defence_sum, retention_sum,
                   keeper_minutes, goals_prevented, run_id)
                 VALUES (2024, %s, %s, 1, 900, 900, 900, 900, 900, 900, 0, 0, 0, 10, 0, 0, 0, %s)""", (player, position, previous))
            x("UPDATE agg.level_runs SET players = 1, started_at = clock_timestamp() WHERE id = %s", (previous,))
            self.assertEqual(power.stale_rankings(self.db), [2025])  # its level is older than the year before's
            power.refresh_players(self.db, 2025)
            self.assertEqual(power.stale_rankings(self.db), [])
            both, defence = self.one("SELECT minutes_two_seasons, defence FROM agg.player_level_positions WHERE season_id = 2025 AND player_id = %s", player)
            self.assertEqual((alone[0], both), (1260, 2160))
            minutes, total = self.one("SELECT defence_minutes, defence_sum FROM agg.player_level_cells WHERE season_id = 2025 AND player_id = %s", player)
            measured = self.level_run()[5]
            lam, sd = measured["lam"][position][3], measured["sd"][position][3]
            self.assertAlmostEqual(defence, max(-2.0, min(2.0, 90 * (total + 0.5 * 10) / sd / (minutes + 0.5 * 900 + lam))), places=3)
            self.assertNotAlmostEqual(defence, alone[1], places=3)
        finally:
            # The other tests read the published seasons: this one leaves 2025 alone behind, as it was.
            x("DELETE FROM agg.player_level_cells WHERE season_id = 2024")
            x("DELETE FROM agg.level_runs WHERE season_id = 2024")
            x("DELETE FROM agg.calc_runs WHERE kind = 'award' AND cohort_definition = 'ballon_dor:2024'")
            x("DELETE FROM agg.power_runs WHERE season_id = 2024")
            power.refresh_players(self.db, 2025)
        self.assertEqual(self.one("SELECT minutes_two_seasons FROM agg.player_level_positions WHERE season_id = 2025 AND player_id = %s", player)[0], 1260)
        self.assertEqual(power.stale_rankings(self.db), [])

    def test_a_keeper_without_goals_prevented_on_half_his_minutes_is_not_measured(self):
        # 54i: goals prevented are missing for whole leagues and years. The keeper stays in the level, flagged.
        from vega import power

        x = self.db.execute
        keeper = 100
        matches = [m for (m,) in x("SELECT match_id FROM core.player_match_stats WHERE season_id = 2025 AND player_id = %s ORDER BY match_id", (keeper,)).fetchall()]
        kept = dict(x("SELECT match_id, goals_prevented FROM core.player_match_stats WHERE season_id = 2025 AND player_id = %s", (keeper,)).fetchall())
        self.assertEqual(len(matches), 14)
        flags = "SELECT player_id, measured FROM agg.player_level WHERE season_id = 2025 AND position = 'goalkeeper' ORDER BY player_id"
        others = [(team * 100, True) for team in range(2, 9)]
        self.assertEqual(x(flags).fetchall(), [(keeper, True)] + others)
        blank = "UPDATE core.player_match_stats SET goals_prevented = NULL WHERE season_id = 2025 AND player_id = %s AND match_id = ANY(%s)"
        try:
            x(blank, (keeper, matches[:7]))  # 630 of his 1 260 minutes keep them: half
            power.refresh_players(self.db, 2025)
            self.assertEqual(x(flags).fetchall(), [(keeper, True)] + others)
            x(blank, (keeper, matches[:8]))  # 540: under half
            power.refresh_players(self.db, 2025)
            self.assertEqual(x(flags).fetchall(), [(keeper, False)] + others)
            minutes, covered = self.one("SELECT minutes, keeper_minutes FROM agg.player_level_cells WHERE season_id = 2025 AND player_id = %s", keeper)
            self.assertEqual((minutes, covered), (1260, 540))
            row = self.one("SELECT level, score, rank, position_rank FROM agg.player_level WHERE season_id = 2025 AND player_id = %s", keeper)
            self.assertTrue(all(v is not None for v in row) and 0 <= row[1] <= 100)
            self.assertEqual(self.one("SELECT measured FROM api.player_levels WHERE season_id = 2025 AND player_key = %s", keeper)[0], False)
        finally:
            for match, prevented in kept.items():
                x("UPDATE core.player_match_stats SET goals_prevented = %s WHERE season_id = 2025 AND player_id = %s AND match_id = %s", (prevented, keeper, match))
            power.refresh_players(self.db, 2025)
        self.assertEqual(x(flags).fetchall(), [(keeper, True)] + others)

    def test_a_level_of_another_version_is_computed_again(self):
        # 54j: after the deployment the levels in place are of `score-vega-v9`. Their years are listed, and
        # no other year reads their sums.
        from vega import level, power
        from vega.store import Store

        x = self.db.execute
        with self.db.transaction():
            self.assertEqual(Store(self.db).season("2024/2025"), 2024)
        player, position = self.one("SELECT player_id, position FROM agg.player_level WHERE season_id = 2025 AND position = 'centre_back' ORDER BY player_id LIMIT 1")
        levels = "SELECT player_id, level, score, rank FROM agg.player_level WHERE season_id = 2025 ORDER BY player_id"
        kept = x(levels).fetchall()
        self.assertEqual(power.stale_rankings(self.db), [])
        try:
            x("UPDATE agg.level_runs SET version = 'score-vega-v9' WHERE season_id = 2025 AND status = 'published'")
            self.assertEqual(power.stale_rankings(self.db), [2025])
            # The year before, as a run of the earlier version left it: sums for one centre-back.
            previous = x("""INSERT INTO agg.level_runs(season_id, version, status, started_at, finished_at, players, settings)
                            VALUES (2024, 'score-vega-v9', 'published', now(), now(), 1, '{}') RETURNING id""").fetchone()[0]
            x("""INSERT INTO agg.player_level_cells(season_id, player_id, position, team_id, minutes, finishing_minutes, creation_minutes,
                   progression_minutes, defence_minutes, retention_minutes, finishing_sum, creation_sum, progression_sum, defence_sum, retention_sum,
                   keeper_minutes, goals_prevented, run_id)
                 VALUES (2024, %s, %s, 1, 900, 900, 900, 900, 900, 900, 0, 0, 0, 10, 0, 0, 0, %s)""", (player, position, previous))
            self.assertEqual(power.refresh_players(self.db, 2025), 88)
            self.assertEqual(power.stale_rankings(self.db), [])  # 2024 has no published ranking: nothing asks for its level
            self.assertEqual(self.level_run()[1], "score-vega-v9.1")
            self.assertEqual(level.LEVEL_VERSION, "score-vega-v9.1")
            self.assertEqual(self.one("SELECT minutes_two_seasons FROM agg.player_level_positions WHERE season_id = 2025 AND player_id = %s", player)[0], 1260)
            self.assertEqual(x(levels).fetchall(), kept)
        finally:
            x("DELETE FROM agg.player_level_cells WHERE season_id = 2024")
            x("DELETE FROM agg.level_runs WHERE season_id = 2024")
            x("UPDATE agg.level_runs SET version = %s WHERE season_id = 2025 AND status = 'published'", (level.LEVEL_VERSION,))
        self.assertEqual(power.stale_rankings(self.db), [])

    def test_a_level_of_other_settings_is_computed_again(self):
        # 54k: the keeper's reference became a setting, so the level runs published before it hold no
        # `keeper_lambda`. A year whose level was computed with other settings than the code's is listed again;
        # its new run holds the code's settings and, here, the same levels.
        from psycopg.types.json import Jsonb
        from vega import level, power

        x = self.db.execute
        levels = "SELECT player_id, level, score, rank FROM agg.player_level WHERE season_id = 2025 ORDER BY player_id"
        kept = x(levels).fetchall()
        self.assertEqual(power.stale_rankings(self.db), [])
        run = self.level_run()[0]
        try:
            x("UPDATE agg.level_runs SET settings = settings - 'keeper_lambda' WHERE id = %s", (run,))
            self.assertEqual(power.stale_rankings(self.db), [2025])
            self.assertEqual(power.refresh_players(self.db, 2025), 88)
            self.assertEqual(power.stale_rankings(self.db), [])
            again, _, _, _, settings, measured = self.level_run()
            self.assertNotEqual(again, run)
            self.assertEqual(settings, level.SETTINGS)
            self.assertEqual(settings["keeper_lambda"], 13291.0)
            self.assertNotIn("keeper", measured)
            self.assertEqual(x(levels).fetchall(), kept)
            # Another value of a setting, not only a missing one.
            x("UPDATE agg.level_runs SET settings = jsonb_set(settings, '{keeper_lambda}', '5395') WHERE id = %s", (again,))
            self.assertEqual(power.stale_rankings(self.db), [2025])
        finally:
            x("UPDATE agg.level_runs SET settings = %s WHERE season_id = 2025 AND status = 'published'", (Jsonb(level.SETTINGS),))
        self.assertEqual(power.stale_rankings(self.db), [])

    def test_a_year_that_read_another_national_elo_is_ranked_again(self):
        # §56 (56a–56h): a year's ranking and level read the national teams' Elo. When the published Elo run is of
        # other national teams (or of another national method) than the run the ranking read, the year is listed.
        from psycopg.types.json import Jsonb
        from vega import level, power
        from vega.store import Store

        x = self.db.execute
        published = "SELECT id FROM agg.power_runs WHERE kind = 'elo' AND status = 'published'"
        row = "SELECT version, k, start_date, seed_edition, national_teams, national_teams_md5 FROM agg.nation_elo_runs WHERE run_id = %s"
        write = "INSERT INTO agg.nation_elo_runs(run_id, version, k, start_date, seed_edition, national_teams, national_teams_md5) VALUES (%s,%s,%s,%s,%s,%s,%s)"
        ranking = "SELECT player_id, index, rank FROM agg.player_power WHERE season_id = 2025 ORDER BY player_id"
        levels = "SELECT player_id, level, score, rank FROM agg.player_level WHERE season_id = 2025 ORDER BY player_id"
        with self.db.transaction():
            years = [Store(self.db).season(label) for label in ("2022/2023", "2023/2024", "2024/2025")]
        self.assertEqual(years, [2022, 2023, 2024])
        self.assertEqual(power.stale_rankings(self.db), [])
        kept = x(ranking).fetchall(), x(levels).fetchall()
        team = x("INSERT INTO core.teams(id, name, is_national) VALUES (920, 'Nation Z', true) RETURNING id").fetchone()[0]
        try:
            # 56a: a team marked national, the Elo run again: the year's ranking read the earlier national teams.
            power.refresh_elo(self.db)
            self.assertEqual(power.stale_rankings(self.db), [2025])
            # 56b: ranked again, on the same numbers (the team has no match), it is listed no more.
            self.assertEqual(power.refresh_players(self.db, 2025), 88)
            self.assertEqual(power.stale_rankings(self.db), [])
            self.assertEqual((x(ranking).fetchall(), x(levels).fetchall()), kept)
            # 56c: the Elo run again with the same national teams, as every pass with a due season does.
            read = x(published).fetchone()[0]
            power.refresh_elo(self.db)
            served = x(published).fetchone()[0]
            self.assertNotEqual(read, served)
            self.assertEqual(x(row, (read,)).fetchone(), x(row, (served,)).fetchone())
            self.assertEqual(power.stale_rankings(self.db), [])
            read_row, served_row = x(row, (read,)).fetchone(), x(row, (served,)).fetchone()
            # 56d: the run the ranking read holds no national set (a run from before 170): production after #92.
            x("UPDATE agg.nation_elo_runs SET national_teams = NULL, national_teams_md5 = NULL WHERE run_id = %s", (read,))
            self.assertEqual(power.stale_rankings(self.db), [2025])
            # 56e: it has no row at all (a run from before 168).
            x("DELETE FROM agg.nation_elo_runs WHERE run_id = %s", (read,))
            self.assertEqual(power.stale_rankings(self.db), [2025])
            # 56g: neither run has a row: nothing to compare. Nor without a published Elo run.
            x("DELETE FROM agg.nation_elo_runs WHERE run_id = %s", (served,))
            self.assertEqual(power.stale_rankings(self.db), [])
            x(write, (served, *served_row))
            x("UPDATE agg.power_runs SET status = 'superseded' WHERE id = %s", (served,))
            self.assertEqual(power.stale_rankings(self.db), [])
            x("UPDATE agg.power_runs SET status = 'published' WHERE id = %s", (served,))
            # 56f: the run it read is of another national method, with the same national teams.
            x(write, (read, "nations-elo-v0", *read_row[1:]))
            self.assertEqual(power.stale_rankings(self.db), [2025])
            # 56h: with 2025, a year with players ranked before any Elo run (its level in place), a year without
            # players, and a year of an older method: that one first, then the years oldest first.
            x("""INSERT INTO agg.power_runs(kind, season_id, method_version, status, started_at, finished_at, players) VALUES
                   ('players', 2022, 'power-ranking-v1', 'published', '2020-01-01', '2020-01-01', NULL),
                   ('players', 2023, %(method)s, 'published', '2020-01-01', '2020-01-01', 3),
                   ('players', 2024, %(method)s, 'published', '2020-01-01', '2020-01-01', 0)""", {"method": power.METHOD_VERSION})
            x("""INSERT INTO agg.level_runs(season_id, version, status, started_at, finished_at, players, settings)
                 VALUES (2023, %s, 'published', '2020-01-01', '2020-01-01', 0, %s)""", (level.LEVEL_VERSION, Jsonb(level.SETTINGS)))
            self.assertEqual(power.stale_rankings(self.db), [2022, 2023, 2025])
            x("DELETE FROM agg.nation_elo_runs WHERE run_id = %s", (read,))
            x(write, (read, *read_row))
            self.assertEqual(power.stale_rankings(self.db), [2022, 2023])
        finally:
            # The other tests read the published seasons: this one leaves 2025 alone behind, on the earlier national teams.
            x("DELETE FROM agg.level_runs WHERE season_id = 2023")
            x("DELETE FROM agg.power_runs WHERE season_id IN (2022, 2023, 2024)")
            x("DELETE FROM core.teams WHERE id = %s", (team,))
            power.refresh_elo(self.db)
            power.refresh_players(self.db, 2025)
        self.assertEqual(power.stale_rankings(self.db), [])
        self.assertEqual((x(ranking).fetchall(), x(levels).fetchall()), kept)

    def test_a_blank_duel_side_reads_like_a_written_zero(self):
        # Issue #71 (calculation audit of 16 November 2026, item 1): a defender's duel attempts are
        # his duels won and lost, added once the blanks have their zeros. The same match is graded
        # the same whether the source writes a 0 or leaves it blank.
        from vega import power

        x = self.db.execute
        match, player = 1, 103  # a defender of club 1, at home to club 2
        key = "season_id=2025 AND match_id=%s AND player_id=%s"
        before = self.one(f"SELECT duels_won, duels_lost FROM core.player_match_stats WHERE {key}", match, player)
        # The match publishes both sides of the duels, and his row carries statistics.
        self.assertEqual(self.one(
            f"""SELECT (SELECT touches IS NOT NULL FROM core.player_match_stats WHERE {key}),
                       EXISTS (SELECT 1 FROM core.player_match_stats WHERE season_id=2025 AND match_id=%s AND player_id<>%s AND duels_won > 0),
                       EXISTS (SELECT 1 FROM core.player_match_stats WHERE season_id=2025 AND match_id=%s AND player_id<>%s AND duels_lost > 0)""",
            match, player, match, player, match, player), (True, True, True))

        def defence(won, lost):
            x(f"UPDATE core.player_match_stats SET duels_won=%s, duels_lost=%s WHERE {key}", (won, lost, match, player))
            power.refresh_players(self.db, 2025)
            return self.one(f"SELECT defence FROM agg.player_power_matches WHERE {key}", match, player)[0]

        try:
            # D1: five duels won, none lost.
            written = defence(5, 0)
            self.assertIsNotNone(written)
            self.assertAlmostEqual(defence(5, None), written, places=5)
            # D2: none won, three lost.
            written = defence(0, 3)
            self.assertAlmostEqual(defence(None, 3), written, places=5)
            # And the two readings differ from each other: the duels do count in the block.
            self.assertNotAlmostEqual(defence(5, 0), written, places=3)
        finally:
            x(f"UPDATE core.player_match_stats SET duels_won=%s, duels_lost=%s WHERE {key}", (*before, match, player))
            power.refresh_players(self.db, 2025)

    def test_zzz_a_world_cup_final_counts_for_its_stakes(self):
        # Version 3 (072): the World Cup's matches enter the players' ranking, each match
        # counted for its stakes, the clubs' Elo and the national teams' alike.
        from vega import power

        x = self.db.execute
        x("INSERT INTO core.competitions(id,name,kind) VALUES(90,'World Cup','international')")
        x("INSERT INTO core.provider_ids(entity_type,provider,provider_key,entity_id) VALUES('competition','pitchapi','l_1XLtP0',90)")
        x("INSERT INTO core.competition_seasons(id,competition_id,season_id,native_label) VALUES(90,90,2025,'2026')")
        x("INSERT INTO core.teams(id,name,is_national) VALUES(900,'Nation A',true),(901,'Nation B',true)")
        final = x("INSERT INTO core.rounds(competition_season_id,name,stage) VALUES(90,'final','final') RETURNING id").fetchone()[0]
        x("""INSERT INTO core.matches(id,competition_season_id,season_id,source,status,home_team_id,away_team_id,home_score,away_score,match_date,round_id,is_neutral)
             VALUES(9000,90,2025,'pitchapi','finished',900,901,2,1,'2026-07-19',%s,true)""", (final,))
        x("INSERT INTO core.match_coverage(season_id,match_id) VALUES(2025,9000)")
        for player, nation, position in ((100, 900, 11), (201, 901, 32)):  # club 1's keeper, a defender of club 2
            x("INSERT INTO core.lineup_players(season_id,match_id,team_id,player_id,is_starter,position_id) VALUES(2025,9000,%s,%s,true,%s)", (nation, player, position))
            x("""INSERT INTO core.player_match_stats(season_id,match_id,team_id,player_id,minutes_played,goals,total_shots,recoveries,interceptions,tackles,
                   clearances,shot_blocks,duels_won,duels_lost,accurate_passes,accurate_passes_total,touches,saves,goals_prevented)
                 VALUES(2025,9000,%s,%s,90,0,0,9,3,4,5,2,6,2,40,45,60,%s,%s)""", (nation, player, 4 if position == 11 else None, 0.2 if position == 11 else None))
        power.refresh_power(self.db, 2025)
        final_stakes = power.stakes("l_1XLtP0", None, "final", "final")
        self.assertAlmostEqual(final_stakes, 1.30 * 1.15)
        # The national teams' Elo moved by K × the stakes; a league match by K.
        elo = dict(x("SELECT team_id, stakes FROM agg.team_elo WHERE match_id=9000").fetchall())
        self.assertEqual({k: round(v, 4) for k, v in elo.items()}, {900: 1.495, 901: 1.495})
        before, after, expected = self.one("SELECT elo_before, elo_after, expected FROM agg.team_elo WHERE match_id=9000 AND team_id=900")
        # §51 (51i): a national match from 1 July 2021 moves by K_n 30 × its weight (a final's stakes) × the goal margin's G.
        self.assertAlmostEqual(after - before, power.NATION_K * final_stakes * power.goal_factor(1) * (1 - expected), places=3)
        self.assertEqual(before, 1500.0)  # no FIFA edition held: every nation starts at 1500
        # §53 (53b): the run's national settings in their own table: a row for the published Elo run (a superseded one
        # keeps its own), none for a run of another kind.
        self.assertEqual(self.one("""SELECT r.method_version, n.version, n.k, n.start_date, n.seed_edition FROM agg.power_runs r
                                     JOIN agg.nation_elo_runs n ON n.run_id = r.id WHERE r.kind='elo' AND r.status='published'"""),
                         (power.METHOD_VERSION, "nations-elo-v1", 30.0, date(2021, 7, 1), None))
        self.assertEqual(self.one("""SELECT count(*) FROM agg.nation_elo_runs n JOIN agg.power_runs r ON r.id = n.run_id
                                     WHERE r.kind <> 'elo'""")[0], 0)
        self.assertEqual(x("SELECT team_id, matches, rank, provisional FROM agg.team_power WHERE scope='nations' AND season_id=2025 ORDER BY 1").fetchall(),
                         [(900, 1, 1, True), (901, 1, 2, True)])
        self.assertFalse(power.stale_rankings(self.db))
        self.assertEqual(self.one("SELECT count(*), min(stakes), max(stakes) FROM agg.team_elo WHERE match_id<>9000"), (112, 1.0, 1.0))
        # The two players' final is one of their matches of the year, with their national team.
        rows = x("SELECT player_id, team_id, role, round(stakes::numeric, 4), contribution IS NOT NULL FROM agg.player_power_matches WHERE match_id=9000 ORDER BY 1").fetchall()
        self.assertEqual([(r[0], r[1], float(r[3]), r[4]) for r in rows], [(100, 900, 1.495, True), (201, 901, 1.495, True)])
        self.assertEqual(rows[0][2], "goalkeeper")
        for player, club in ((100, 1), (201, 2)):
            team, matches, own = self.one("SELECT team_id, matches, own_total FROM agg.player_power WHERE season_id=2025 AND player_id=%s", player)
            self.assertEqual((team, matches), (club, 15))  # he is ranked through his club
            self.assertAlmostEqual(own, self.one("SELECT sum(stakes * contribution) FROM agg.player_power_matches WHERE season_id=2025 AND player_id=%s", player)[0], places=3)
            self.assertIsNotNone(self.one("SELECT rank FROM agg.player_power WHERE season_id=2025 AND player_id=%s", player)[0])
        self.assertEqual(self.one("SELECT max(stakes), min(stakes) FROM agg.player_power_matches WHERE match_id<>9000"), (1.0, 1.0))
        # The run keeps the scale it read (worker.due_seasons compares it with the present one).
        self.assertEqual(
            self.one("SELECT linked_leagues FROM agg.power_runs WHERE kind='players' AND season_id=2025 AND status='published'")[0],
            self.one("SELECT count(*) FROM agg.league_levels WHERE linked")[0],
        )

    def test_the_national_seed_reads_the_fifa_edition_of_18_february_2021(self):
        # §51 (51j): 1500 + the points less the edition's mean; without that edition, the earliest held, traced.
        from vega import power

        x = self.db.execute
        self.addCleanup(lambda: [x(q) for q in (
            "DELETE FROM agg.team_power WHERE team_id IN (910, 911)", "DELETE FROM agg.team_elo WHERE team_id IN (910, 911)",
            "DELETE FROM core.ranking_editions WHERE kind='fifa_men'", "DELETE FROM core.matches WHERE id=9100",
            "DELETE FROM core.competition_seasons WHERE id=91", "DELETE FROM core.competitions WHERE id=91", "DELETE FROM core.teams WHERE id IN (910, 911)")])
        x("INSERT INTO core.teams(id,name,is_national) VALUES(910,'Nation C',true),(911,'Nation D',true)")
        x("INSERT INTO core.competitions(id,name) VALUES(91,'internationals')")
        x("INSERT INTO core.competition_seasons(id,competition_id,season_id,native_label,cup_key) VALUES(91,91,2025,'2025/2026','nations-results:internationals:2025/2026')")
        x("""INSERT INTO core.matches(id,competition_season_id,season_id,source,status,home_team_id,away_team_id,home_score,away_score,match_date,is_neutral)
             VALUES(9100,91,2025,'international_results','finished',910,911,1,0,'2026-03-27',false)""")
        for edition, label, points in ((9101, "2021-04-07", (1550, 1450)), (9102, "2021-02-18", (1600, 1400))):
            x("INSERT INTO core.ranking_editions(id,kind,provider,label) VALUES(%s,'fifa_men','fifa',%s)", (edition, label))
            x("INSERT INTO core.ranking_rows(edition_id,row_no,team_id,points) VALUES(%s,1,910,%s),(%s,2,911,%s)", (edition, points[0], edition, points[1]))
        for label, seeds in (("2021-02-18", (1600, 1400)), ("2021-04-07", (1550, 1450))):
            power.refresh_elo(self.db)
            self.assertEqual(x("SELECT team_id, elo_before FROM agg.team_elo WHERE match_id=9100 ORDER BY 1").fetchall(), [(910, seeds[0]), (911, seeds[1])])
            self.assertEqual(self.one("""SELECT n.seed_edition FROM agg.nation_elo_runs n JOIN agg.power_runs r ON r.id = n.run_id
                                         WHERE r.kind='elo' AND r.status='published'""")[0], label)
            stakes = self.one("SELECT stakes FROM agg.team_elo WHERE match_id=9100 AND team_id=910")[0]
            self.assertEqual(stakes, 1.0)  # I_m of a friendly-less round: as `stakes` gives it
            x("DELETE FROM core.ranking_editions WHERE label='2021-02-18'")

        # 51j': a row fifa.save could not link (a nation the base names otherwise) is linked by its FIFA name through the
        # measurement's map to the national team International Results keys by that name.
        x("INSERT INTO core.provider_ids(entity_type,provider,provider_key,entity_id) VALUES('team','international_results','South Korea',911)")
        self.addCleanup(lambda: x("DELETE FROM core.provider_ids WHERE entity_type='team' AND entity_id=911"))
        x("INSERT INTO core.countries(code) VALUES ('KOR') ON CONFLICT DO NOTHING")
        x("DELETE FROM core.ranking_rows WHERE edition_id=9101 AND team_id=911")
        x("INSERT INTO core.ranking_rows(edition_id,row_no,country_code,entity_name,points) VALUES(9101,2,'KOR','Korea Republic',1450)")
        power.refresh_elo(self.db)
        self.assertEqual(x("SELECT team_id, elo_before FROM agg.team_elo WHERE match_id=9100 ORDER BY 1").fetchall(), [(910, 1550), (911, 1450)])

    def test_a_season_ranked_by_an_older_method_is_ranked_again(self):
        from vega import power
        from vega.store import Store

        with self.db.transaction():
            season = Store(self.db).season("1999/2000")
        self.db.execute(
            "INSERT INTO agg.power_runs(kind, season_id, method_version, status, finished_at) VALUES ('players', %s, 'power-ranking-v1', 'published', now())",
            (season,),
        )
        self.assertIn(season, power.stale_rankings(self.db))
        # No player statistics that year: a quick, empty run of the present method.
        self.assertEqual(power.refresh_players(self.db, season), 0)
        self.assertNotIn(season, power.stale_rankings(self.db))
        self.assertEqual(self.one("SELECT method_version FROM agg.power_runs WHERE kind='players' AND season_id=%s AND status='published'", season)[0],
                         power.METHOD_VERSION)
        # The other tests read the published seasons: this one leaves none behind.
        self.db.execute("DELETE FROM agg.calc_runs WHERE kind = 'award' AND cohort_definition = %s", (f"ballon_dor:{season}",))
        self.db.execute("DELETE FROM agg.power_runs WHERE season_id = %s", (season,))

    def test_zzzz_matches_to_play_are_forecast_and_the_league_projected(self):
        # 076: forecast.refresh, from the Elo the season's models have settled.
        from vega import forecast

        x = self.db.execute
        self.assertEqual(self.one("SELECT count(*) FROM agg.match_forecasts")[0], 0)  # nothing left to play in the seed
        x("INSERT INTO core.countries(code) VALUES ('FRA') ON CONFLICT DO NOTHING")
        x("UPDATE core.competitions SET country_code='FRA' WHERE id=1")  # a domestic league
        x("""INSERT INTO core.matches(id,competition_season_id,season_id,source,status,home_team_id,away_team_id,match_date)
             VALUES (9100,1,2025,'pitchapi','not_started',1,2,'2026-05-20'), (9101,1,2025,'pitchapi','not_started',3,4,'2026-05-20')""")
        minimum, forecast.MIN_FIT = forecast.MIN_FIT, 20  # the seed has 56 club matches
        try:
            self.assertEqual(forecast.refresh(self.db, 2025), (2, 1))
            rows = x("SELECT match_id, home_win + draw + away_win, home_goals, away_goals, likely_home, likely_away FROM agg.match_forecasts ORDER BY 1").fetchall()
            self.assertEqual([r[0] for r in rows], [9100, 9101])
            for _, total, home_goals, away_goals, likely_home, likely_away in rows:
                self.assertAlmostEqual(total, 1.0, places=5)
                self.assertTrue(home_goals > 0 and away_goals > 0 and likely_home >= 0 and likely_away >= 0)
            model = self.one("SELECT version, matches, strength_spread, simulations FROM agg.forecast_models")
            self.assertEqual(model, (forecast.MODEL_VERSION, 56, forecast.STRENGTH_SPREAD, forecast.SIMULATIONS))  # the World Cup final is no club match
            # Version 2: what a club's recent form adds, fitted on the matches where both sides have one; each
            # side's form in Elo points beside its forecast, 0 for a match further ahead than the horizon.
            weights = self.one("SELECT form_xg, form_luck, form_matches FROM agg.forecast_models")
            self.assertTrue(weights[2] >= 0 and (weights[2] >= forecast.MIN_FIT or weights[:2] == (0.0, 0.0)))
            x("UPDATE core.matches SET kickoff_at = now() + interval '60 days' WHERE id = 9101")
            forecast.refresh(self.db, 2025)
            self.assertEqual(self.one("SELECT home_form, away_form FROM agg.match_forecasts WHERE match_id = 9101"), (0.0, 0.0))
            self.assertEqual(self.one("SELECT count(*) FROM api.match_forecasts WHERE match_key = 9100 AND home_form IS NOT NULL")[0], 1)
            x("UPDATE core.matches SET kickoff_at = NULL WHERE id = 9101")
            # The league: eight clubs, each somewhere, each place taken once; nobody loses points.
            teams = x("SELECT team_id, played, points, projected_points FROM agg.season_projections WHERE competition_season_id=1 ORDER BY 1").fetchall()
            self.assertEqual([t[0] for t in teams], list(TEAMS))
            self.assertTrue(all(played == 14 and projected >= points for _, played, points, projected in teams))
            self.assertEqual([round(v, 4) for (v,) in x("SELECT sum(probability) FROM agg.season_projection_places WHERE competition_season_id=1 GROUP BY team_id")], [1.0] * 8)
            self.assertEqual([round(v, 4) for (v,) in x("SELECT sum(probability) FROM agg.season_projection_places WHERE competition_season_id=1 GROUP BY place ORDER BY place")], [1.0] * 8)
            # Only the four clubs with a match left can still move.
            fixed = x("SELECT team_id FROM agg.season_projection_places WHERE competition_season_id=1 GROUP BY team_id HAVING count(*) = 1 ORDER BY 1").fetchall()
            self.assertTrue(set(t for (t,) in fixed) <= {5, 6, 7, 8})
            # A second pass replaces the first: one model, the same rows.
            self.assertEqual(forecast.refresh(self.db, 2025), (2, 1))
            self.assertEqual(self.one("SELECT count(*) FROM agg.forecast_models")[0], 1)
            self.assertEqual(self.one("SELECT count(*) FROM agg.match_forecasts")[0], 2)
            # The reads.
            self.assertEqual(self.one("SELECT count(*) FROM api.match_forecasts WHERE match_key = 9100")[0], 1)
            self.assertEqual(self.one("SELECT count(*) FROM api.season_projections WHERE competition_season_id = 1")[0], 8)
        finally:
            forecast.MIN_FIT = minimum
        # Too few matches to fit a model: nothing is forecast, and what was is gone.
        self.assertEqual(forecast.refresh(self.db, 2025), (0, 0))
        self.assertEqual(self.one("SELECT (SELECT count(*) FROM agg.match_forecasts), (SELECT count(*) FROM agg.season_projections)"), (0, 0))

    def test_zzzzz_every_competition_s_matches_are_forecast(self):
        # Every competition has its predictions (the user, 17 Nov 2026): a complementary source's league (open-matchday's
        # National League) is projected like a league, and every match still to play between two rated teams is
        # forecast, a cup's included. A cup is no league: it is never projected as one.
        from vega import forecast

        x = self.db.execute
        x("INSERT INTO core.competitions(id, name) VALUES (9200, 'national-league'), (9201, 'fa-cup')")
        x("""INSERT INTO core.competition_seasons(id, competition_id, season_id, native_label, cup_key) VALUES
             (9200, 9200, 2025, '2025/2026', 'open-matchday:ENG_5_national-league:2025/2026'),
             (9201, 9201, 2025, '2025/2026', 'open-matchday:ENG_CUP_fa-cup:2025/2026')""")
        from datetime import date, timedelta

        day = lambda n: (date.today() + timedelta(days=n)).isoformat()
        rows = []
        for k, (h, a) in enumerate(((1, 2), (3, 4), (5, 6), (7, 8))):
            rows += [(9200 + k, 9200, 'finished', h, a, 1, 0, day(-40)), (9210 + k, 9201, 'finished', h, a, 2, 1, day(-39))]
        rows += [(9204, 9200, 'not_started', 2, 3, None, None, day(10)), (9205, 9200, 'not_started', 6, 7, None, None, day(10)),
                 (9214, 9201, 'not_started', 1, 3, None, None, day(11)), (9215, 9201, 'not_started', 5, 7, None, None, day(11)),
                 # A source that stopped updating (OpenFootball's Libertadores 2026, at its August play-offs): a match still
                 # « to play » weeks after its day is no match to forecast.
                 (9206, 9200, 'not_started', 4, 8, None, None, day(-20))]
        for row in rows:
            x("""INSERT INTO core.matches(id, competition_season_id, season_id, source, status, home_team_id, away_team_id, home_score, away_score, match_date)
                 VALUES (%s, %s, 2025, 'openfootball', %s, %s, %s, %s, %s, %s)""", row)
        minimum, forecast.MIN_FIT = forecast.MIN_FIT, 20
        try:
            forecast.refresh(self.db, 2025)
            forecast_ids = {m for (m,) in x("SELECT match_id FROM agg.match_forecasts").fetchall()}
            self.assertTrue({9204, 9205, 9214, 9215} <= forecast_ids)
            self.assertNotIn(9206, forecast_ids)
            self.assertEqual(self.one("SELECT count(*) FROM agg.season_projections WHERE competition_season_id = 9200")[0], 8)
            self.assertEqual(self.one("SELECT count(DISTINCT team_id) FROM agg.season_projection_places WHERE competition_season_id = 9200")[0], 8)
            # The cup's drawn round is replayed as a cup (its stages), never as a league table (no places).
            self.assertEqual(self.one("SELECT count(*) FROM agg.season_projection_places WHERE competition_season_id = 9201")[0], 0)
            self.assertGreater(self.one("SELECT count(*) FROM agg.cup_stage_odds WHERE competition_season_id = 9201")[0], 0)
        finally:
            forecast.MIN_FIT = minimum
            x("DELETE FROM agg.match_forecasts WHERE match_id BETWEEN 9200 AND 9216")
            x("DELETE FROM core.matches WHERE id BETWEEN 9200 AND 9215")

    # §59 (issue #105): the Ballon d'Or race on the Score Vega v9.1 with the three criteria, stage 1, computed by the
    # ranking's run beside the v8 race. The cases are named test_59*: they run before the cases that add a World Cup
    # final or matches to play (test_zzz*), and each puts the base back as it found it.

    AWARD = """SELECT player_id, team_id, position, universe, eligible, linked, top_division, measured, individual, collective, card_points,
                      fair_play_minutes, fair_play, z_individual, z_collective, z_fair_play, level, score, rank, reason
               FROM agg.player_award WHERE season_id = 2025 ORDER BY player_id"""
    HONOURS = """SELECT player_id, team_id, competition_season_id, kind, reached, league_rank, progress, factor, prestige, share, value, reason
                 FROM agg.player_award_honours WHERE season_id = 2025 ORDER BY player_id, competition_season_id, team_id"""
    V8_AWARD = "SELECT season_id, award, rank, player_id, team_id, score, calc_run_id FROM agg.player_award_ranking ORDER BY season_id, rank"
    V8_AWARD_RUNS = "SELECT id, status, model_version, cohort_definition FROM agg.calc_runs WHERE kind = 'award' ORDER BY id"
    LEVEL_TABLES = {
        "player_level": "SELECT * FROM agg.player_level WHERE season_id = 2025 ORDER BY player_id",
        "player_level_cells": "SELECT * FROM agg.player_level_cells WHERE season_id = 2025 ORDER BY player_id, position, team_id",
        "player_power": "SELECT * FROM agg.player_power WHERE season_id = 2025 ORDER BY player_id",
        "level_runs": "SELECT id, status, started_at FROM agg.level_runs WHERE season_id = 2025 ORDER BY id",
        "power_runs": "SELECT id, status, started_at FROM agg.power_runs WHERE kind = 'players' AND season_id = 2025 ORDER BY id",
    }

    def award_rows(self):
        names = ("player", "team", "position", "universe", "eligible", "linked", "top_division", "measured", "individual", "collective", "card_points",
                 "fair_play_minutes", "fair_play", "z_individual", "z_collective", "z_fair_play", "level", "score", "rank", "reason")
        return {r[0]: dict(zip(names, r)) for r in self.db.execute(self.AWARD).fetchall()}

    def honours(self, edition=None):
        names = ("player", "team", "edition", "kind", "reached", "league_rank", "progress", "factor", "prestige", "share", "value", "reason")
        rows = [dict(zip(names, r)) for r in self.db.execute(self.HONOURS).fetchall()]
        return [r for r in rows if edition is None or r["edition"] == edition]

    def award_run(self):
        return self.one("""SELECT id, version, status, level_run_id, reference_season, players, settings, spreads, started_at
                           FROM agg.award_runs WHERE season_id = 2025 AND status = 'published'""")

    def snapshot(self, queries):
        return {name: self.db.execute(sql).fetchall() for name, sql in queries.items()}

    def standings(self):
        return dict(self.db.execute("""SELECT team_id, position FROM api.standings
                                       WHERE competition_season_id = 1 AND stage IS NULL AND group_name IS NULL""").fetchall())

    def award_cup(self, edition, key, matches):
        """A complementary cup edition of 2025 (results only, no player rows), as cups.save writes it: matches are
        (id, round name, home, away, status, score, extra time, shoot-out[, day], 1 October 2025 by default). Removed, and
        the race read again, after the case."""
        from vega import award

        x = self.db.execute
        x("INSERT INTO core.competitions(id,name,kind) VALUES(%s,%s,'cup')", (edition, f"Coupe {edition}"))
        x("INSERT INTO core.competition_seasons(id,competition_id,season_id,native_label,cup_key) VALUES(%s,%s,2025,'2025/2026',%s)",
          (edition, edition, key))
        rounds = {}
        for mid, name, home, away, status, score, extra, shootout, *day in matches:
            if name not in rounds:
                rounds[name] = x("INSERT INTO core.rounds(competition_season_id,name) VALUES(%s,%s) RETURNING id", (edition, name)).fetchone()[0]
            x("""INSERT INTO core.matches(id,competition_season_id,season_id,source,status,round_id,home_team_id,away_team_id,home_score,away_score,
                   home_score_et,away_score_et,home_penalty_score,away_penalty_score,match_date)
                 VALUES(%s,%s,2025,'openfootball',%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
              (mid, edition, status, rounds[name], home, away, *(score or (None, None)), *(extra or (None, None)), *(shootout or (None, None)),
               day[0] if day else "2025-10-01"))

        def remove():
            x("DELETE FROM core.matches WHERE competition_season_id = %s", (edition,))
            x("DELETE FROM core.rounds WHERE competition_season_id = %s", (edition,))
            x("DELETE FROM core.competition_seasons WHERE id = %s", (edition,))
            x("DELETE FROM core.competitions WHERE id = %s", (edition,))
            award.reread(self.db, 2025)

        self.addCleanup(remove)

    def test_59_the_race_is_computed_and_stored_by_the_ranking_s_run(self):
        # 59.1, « Stored » and « When »: one published run of the present version and settings, reading the year's
        # published level; a row per men's player with a level; the synthetic league's 88 players all in the race.
        from vega import award, level

        run, version, status, level_run, reference, players, settings, spreads, _ = self.award_run()
        self.assertEqual((version, status, players, reference), (award.AWARD_VERSION, "published", 88, 2025))
        self.assertEqual(settings, award.SETTINGS)
        self.assertEqual(level_run, self.level_run()[0])
        self.assertEqual(set(spreads), {"individual", "collective", "fair_play"})
        self.assertTrue(set(spreads["fair_play"]) <= set(level.POSITIONS))
        rows = self.award_rows()
        self.assertEqual(set(rows), {p for p, *_ in self.facts["players"]})
        self.assertEqual(sorted(r["rank"] for r in rows.values()), list(range(1, 89)))
        self.assertTrue(all(r["reason"] is None and r["universe"] == "men" and r["eligible"] and r["linked"] and r["top_division"] and r["measured"]
                            for r in rows.values()))
        self.assertTrue(all(0 < r["score"] < 100 for r in rows.values()))
        # The race in its order: by A, the best first.
        ordered = sorted(rows.values(), key=lambda r: r["rank"])
        self.assertTrue(all(a["level"] >= b["level"] for a, b in zip(ordered, ordered[1:])))
        self.assertEqual(self.one("SELECT count(*) FROM agg.award_runs WHERE season_id = 2025 AND status = 'published'")[0], 1)
        self.assertEqual(self.one("SELECT count(*) FROM api.award_race WHERE season_id = 2025")[0], 88)

    def test_59b_the_individual_part_is_the_year_s_level_without_the_year_before(self):
        # The base holds no year before and no stakes other than 1, no national match: I is the stored v9.1 level.
        from vega import award  # noqa: F401

        level = dict(self.db.execute("SELECT player_id, level FROM agg.player_level WHERE season_id = 2025").fetchall())
        rows = self.award_rows()
        self.assertEqual(set(rows), set(level))
        for p, r in rows.items():
            self.assertAlmostEqual(r["individual"], level[p], places=4)

    def test_59d_league_honours_by_the_final_table(self):
        from vega import award

        ranks = self.standings()
        self.assertEqual(ranks, {8: 1, 6: 2, 2: 3, 5: 4, 4: 5, 7: 6, 3: 7, 1: 8})
        values = {1: 0.5, 2: 0.2, 3: 0.1, 4: 0.05}
        league = self.honours(1)
        self.assertEqual(len(league), 88)  # every league honour is kept, whatever its rank
        rows = self.award_rows()
        for h in league:
            self.assertEqual((h["kind"], h["reached"], h["league_rank"], h["reason"]), ("league", None, ranks[h["team"]], None), h)
            self.assertAlmostEqual(h["progress"], 1.0)
            self.assertAlmostEqual(h["factor"], 1.0)  # the strongest league of the base
            self.assertAlmostEqual(h["share"], 1.0)  # 14 of 14 matches
            self.assertAlmostEqual(h["value"], values.get(ranks[h["team"]], 0.0), places=6)
            self.assertAlmostEqual(rows[h["player"]]["collective"], h["value"], places=6)
        self.assertEqual(len(self.honours()), 88)  # no other honour in the base
        self.assertEqual(award.LEAGUE_VALUE, 0.5)

    def test_59e_a_player_of_two_clubs_has_the_honours_of_each(self):
        # 105 plays 7 matches for club 1 (rank 8), then 7 for club 2 (rank 3), in 205's place; club 1 fields 9105
        # in the other 7.
        from vega import award, power  # noqa: F401

        x = self.db.execute
        mine = [m for (m,) in x("""SELECT p.match_id FROM core.player_match_stats p JOIN core.matches m ON m.id = p.match_id
                                   WHERE p.season_id = 2025 AND p.player_id = 105 AND 2 NOT IN (m.home_team_id, m.away_team_id)
                                   ORDER BY p.match_id LIMIT 7""").fetchall()]
        theirs = [m for (m,) in x("""SELECT p.match_id FROM core.player_match_stats p JOIN core.matches m ON m.id = p.match_id
                                     WHERE p.season_id = 2025 AND p.player_id = 205 AND 1 NOT IN (m.home_team_id, m.away_team_id)
                                     ORDER BY p.match_id LIMIT 7""").fetchall()]
        self.assertEqual((len(mine), len(theirs)), (7, 7))
        move = ["UPDATE core.player_match_stats SET player_id = %s WHERE season_id = 2025 AND player_id = %s AND match_id = ANY(%s)",
                "UPDATE core.lineup_players SET player_id = %s WHERE season_id = 2025 AND player_id = %s AND match_id = ANY(%s)"]
        x("INSERT INTO core.players(id,name) VALUES(9105,'P9105')")
        try:
            for sql in move:
                x(sql, (9105, 105, mine))
                x(sql, (105, 205, theirs))
            power.refresh_players(self.db, 2025)
            got = [(h["team"], h["league_rank"], h["share"], h["value"]) for h in self.honours(1) if h["player"] == 105]
            self.assertEqual([g[:2] for g in got], [(1, 8), (2, 3)])
            self.assertAlmostEqual(got[0][2], 0.5)
            self.assertAlmostEqual(got[1][2], 0.5)
            self.assertAlmostEqual(got[0][3], 0.0)
            self.assertAlmostEqual(got[1][3], 0.5 * 0.2 * 0.5)
            self.assertAlmostEqual(self.award_rows()[105]["collective"], 0.05, places=6)
        finally:
            for sql in move:
                x(sql, (205, 105, theirs))
                x(sql, (105, 9105, mine))
            power.refresh_players(self.db, 2025)
            x("DELETE FROM core.players WHERE id = 9105")
        self.assertEqual(len(self.honours(1)), 88)

    def test_59f_a_final_won_on_penalties_and_one_without_a_winner(self):
        from vega import award

        self.award_cup(70, "open-cups:coupe-70:2025/2026", [(9701, "Final", 1, 2, "finished", (1, 1), (1, 1), (4, 3))])
        self.award_cup(71, "open-cups:coupe-71:2025/2026", [(9711, "Final", 3, 4, "finished", (1, 1), None, None)])
        award.reread(self.db, 2025)
        reached = {(h["edition"], h["team"]): (h["kind"], h["reached"], h["reason"]) for h in self.honours() if h["edition"] in (70, 71)}
        self.assertEqual(reached, {(70, 1): ("national_cup", "winner", None), (70, 2): ("national_cup", "final", None),
                                   (71, 3): ("national_cup", "final", "no_winner"), (71, 4): ("national_cup", "final", "no_winner")})
        # No player rows: the share is his minutes in the club's PitchAPI matches of the edition's window, all of them.
        cup = self.honours(70)
        self.assertEqual(len(cup), 22)
        self.assertTrue(all(abs(h["share"] - 1.0) < 1e-9 for h in cup))
        self.assertTrue(all(abs(h["value"] - (0.15 if h["team"] == 1 else 0.09)) < 1e-6 for h in cup))

    def test_59g_quarter_finalists_eliminated_or_still_to_play(self):
        from vega import award

        self.award_cup(72, "open-cups:coupe-72:2025/2026", [(9721, "Quarter-finals", 5, 6, "finished", (0, 2), None, None),
                                                            (9722, "Quarter-finals", 7, 8, "not_started", None, None, None)])
        award.reread(self.db, 2025)
        reached = {(h["team"], h["reached"]) for h in self.honours(72)}
        self.assertEqual(reached, {(5, "quarter_final"), (6, "quarter_final"), (7, "quarter_final"), (8, "quarter_final")})

    def test_59h_a_league_with_one_match_to_play(self):
        from vega import award

        x = self.db.execute
        x("""INSERT INTO core.matches(id,competition_season_id,season_id,source,status,home_team_id,away_team_id,match_date)
             VALUES(9057,1,2025,'pitchapi','not_started',1,2,'2025-10-08')""")
        try:
            award.reread(self.db, 2025)
            league = self.honours(1)
            self.assertEqual(len(league), 88)
            self.assertTrue(all(abs(h["progress"] - 56 / 57) < 1e-9 for h in league))
            champion = [h for h in league if h["league_rank"] == 1]
            self.assertTrue(all(abs(h["value"] - 0.5 * 56 / 57) < 1e-6 for h in champion))
            self.assertEqual(sorted(r["rank"] for r in self.award_rows().values()), list(range(1, 89)))  # the race exists
        finally:
            x("DELETE FROM core.matches WHERE id = 9057")
            award.reread(self.db, 2025)
        self.assertTrue(all(abs(h["progress"] - 1.0) < 1e-9 for h in self.honours(1)))

    def test_59i_card_points_of_the_covered_matches(self):
        # Match 17, club 3 at club 4: 301 a yellow, a second yellow and its red; 302 a direct red; 303 a yellow then a
        # direct red. Its events are covered; no other match's are.
        from vega import award

        x = self.db.execute
        self.assertEqual(self.one("SELECT home_team_id, away_team_id FROM core.matches WHERE id = 17"), (3, 4))
        events = [(301, 20, "yellow_card"), (301, 60, "second_yellow"), (301, 60, "red_card"), (302, 30, "red_card"),
                  (303, 10, "yellow_card"), (303, 50, "red_card")]
        try:
            for seq, (player, minute, kind) in enumerate(events, 1):
                x("""INSERT INTO core.match_events(season_id,match_id,team_id,seq,event_type,minute,player_id)
                     VALUES(2025,17,3,%s,%s,%s,%s)""", (seq, kind, minute, player))
            x("UPDATE core.match_coverage SET events = 'ok' WHERE season_id = 2025 AND match_id = 17")
            award.reread(self.db, 2025)
            rows = self.award_rows()
            self.assertEqual([rows[p]["card_points"] for p in (301, 302, 303)], [3, 4, 5])
            played = {p for (p,) in x("SELECT player_id FROM core.player_match_stats WHERE season_id = 2025 AND match_id = 17").fetchall()}
            self.assertEqual(len(played), 22)
            self.assertEqual({p for p, r in rows.items() if r["fair_play_minutes"] > 0}, played)
            self.assertTrue(all(rows[p]["fair_play_minutes"] == 90 for p in played))
            self.assertEqual(sum(r["card_points"] for r in rows.values()), 12)
            # Pulled to the centre-backs' mean: the clean covered centre-back above, the direct reds below, the worst last.
            self.assertEqual({rows[p]["position"] for p in (302, 303, 402)}, {"centre_back"})
            self.assertGreater(rows[402]["fair_play"], rows[302]["fair_play"])
            self.assertGreater(rows[302]["fair_play"], rows[303]["fair_play"])
            self.assertTrue(all(abs(r["z_fair_play"]) <= award.Z_CAP for r in rows.values()))
        finally:
            x("DELETE FROM core.match_events WHERE season_id = 2025 AND match_id = 17")
            x("UPDATE core.match_coverage SET events = 'pending' WHERE season_id = 2025 AND match_id = 17")
            award.reread(self.db, 2025)

    def test_59j_a_season_without_covered_events(self):
        from vega import award  # noqa: F401

        rows = self.award_rows()
        self.assertTrue(all(r["card_points"] == 0 and r["fair_play_minutes"] == 0 and r["z_fair_play"] == 0 for r in rows.values()))
        by_position = defaultdict(set)
        for r in rows.values():
            by_position[r["position"]].add(round(r["fair_play"], 9))
        self.assertTrue(all(len(values) == 1 for values in by_position.values()), by_position)  # the position's mean

    def test_59k_a_keeper_not_measured_is_out_of_the_race(self):
        from vega import award, power  # noqa: F401

        x = self.db.execute
        keeper = 100
        matches = [m for (m,) in x("SELECT match_id FROM core.player_match_stats WHERE season_id = 2025 AND player_id = %s ORDER BY match_id", (keeper,)).fetchall()]
        kept = dict(x("SELECT match_id, goals_prevented FROM core.player_match_stats WHERE season_id = 2025 AND player_id = %s", (keeper,)).fetchall())
        try:
            x("UPDATE core.player_match_stats SET goals_prevented = NULL WHERE season_id = 2025 AND player_id = %s AND match_id = ANY(%s)",
              (keeper, matches[:8]))  # 540 of his 1 260 minutes in goal: under half
            power.refresh_players(self.db, 2025)
            row = self.award_rows()[keeper]
            self.assertEqual((row["measured"], row["rank"], row["reason"]), (False, None, "keeper_data"))
            self.assertTrue(all(row[k] is not None for k in ("individual", "collective", "fair_play", "level", "score")))
            self.assertEqual(sorted(r["rank"] for p, r in self.award_rows().items() if p != keeper), list(range(1, 88)))
            self.assertEqual(self.award_run()[5], 88)  # computed and kept, out of the race
        finally:
            for match, prevented in kept.items():
                x("UPDATE core.player_match_stats SET goals_prevented = %s WHERE season_id = 2025 AND player_id = %s AND match_id = %s", (prevented, keeper, match))
            power.refresh_players(self.db, 2025)
        self.assertIsNotNone(self.award_rows()[keeper]["rank"])

    def test_59o_a_cup_written_after_its_race_is_read_again_alone(self):
        from vega import award, power

        x = self.db.execute
        self.assertEqual(award.due(self.db), [])
        before = self.snapshot(self.LEVEL_TABLES)
        run = self.award_run()[0]
        collective = {p: r["collective"] for p, r in self.award_rows().items()}
        self.award_cup(73, "open-cups:coupe-73:2025/2026", [(9731, "Final", 1, 3, "finished", (2, 0), None, None)])
        self.assertEqual(award.due(self.db), [2025])
        self.assertEqual(power.stale_rankings(self.db), [])  # the ranking and the level are not run again
        award.reread(self.db, 2025)
        self.assertEqual({(h["team"], h["reached"]) for h in self.honours(73)}, {(1, "winner"), (3, "final")})
        rows = self.award_rows()
        for p, r in rows.items():
            gained = {1: 0.15, 3: 0.09}.get(p // 100, 0.0)
            self.assertAlmostEqual(r["collective"], collective[p] + gained, places=6)
        self.assertEqual(self.snapshot(self.LEVEL_TABLES), before)
        self.assertNotEqual(self.award_run()[0], run)  # a new run of the race, published
        self.assertEqual(self.one("SELECT count(*) FROM agg.award_runs WHERE season_id = 2025 AND status = 'published'")[0], 1)
        self.assertEqual(award.due(self.db), [])
        self.assertEqual(x("SELECT count(*) FROM agg.player_award WHERE season_id = 2025").fetchone()[0], 88)

    def test_59p_a_race_of_another_version_or_other_settings_or_missing(self):
        from vega import award, power

        x = self.db.execute
        self.assertEqual(power.stale_rankings(self.db), [])
        self.assertEqual(award.stale(self.db), [])
        for change in ("UPDATE agg.award_runs SET version = 'vega-award-v0' WHERE season_id = 2025 AND status = 'published'",
                       "UPDATE agg.award_runs SET settings = '{}' WHERE season_id = 2025 AND status = 'published'",
                       "UPDATE agg.award_runs SET status = 'superseded' WHERE season_id = 2025 AND status = 'published'"):
            x(change)
            self.assertEqual(award.stale(self.db), [2025], change)
            self.assertEqual(power.stale_rankings(self.db), [2025], change)
            power.refresh_players(self.db, 2025)
            self.assertEqual(power.stale_rankings(self.db), [], change)
            self.assertEqual(self.award_run()[1:3], (award.AWARD_VERSION, "published"))
        # A race started before the year's level: computed again.
        x("UPDATE agg.award_runs SET started_at = started_at - interval '1 day' WHERE season_id = 2025 AND status = 'published'")
        self.assertEqual(power.stale_rankings(self.db), [2025])
        power.refresh_players(self.db, 2025)
        self.assertEqual(power.stale_rankings(self.db), [])

    def test_59s_the_v8_race_is_what_the_v8_gives(self):
        from vega import award, power

        x = self.db.execute
        v8 = self.snapshot({"award": self.V8_AWARD, "runs": self.V8_AWARD_RUNS})
        scored = {}
        for p, eligible, rank, index_season, index, total, minutes, team in x(
                "SELECT player_id, eligible, rank, index_season, index, total, minutes, team_id FROM agg.player_power WHERE season_id = 2025").fetchall():
            scored[p] = {"eligible": eligible, "rank": rank, "index": index, "total": total, "minutes": minutes, "team": team}
            if index_season is not None:
                scored[p]["index_season"] = index_season
        race = power.award_race(scored)
        stored = [r for r in v8["award"] if r[0] == 2025]
        self.assertEqual([(r[2], r[3], r[4]) for r in stored], [(rank, p, team) for rank, p, team, _ in race])
        self.assertEqual(len(stored), 30)
        self.assertEqual([r[2] for r in v8["runs"] if r[1] == "published"], [power.METHOD_VERSION])
        award.refresh(self.db, 2025)
        award.reread(self.db, 2025)
        self.assertEqual(self.snapshot({"award": self.V8_AWARD, "runs": self.V8_AWARD_RUNS}), v8)

    def test_59t_the_level_and_the_ranking_are_not_touched_by_the_race(self):
        from vega import award

        before = self.snapshot(self.LEVEL_TABLES)
        award.refresh(self.db, 2025)
        award.reread(self.db, 2025)
        award.refresh(self.db, 2025)
        self.assertEqual(self.snapshot(self.LEVEL_TABLES), before)

    def test_59v_a_value_table_changed_then_refresh_from_the_stored_rows(self):
        # LEAGUE_RANKS given a fifth place: club 4 (fifth) gains it, from the stored honours, no match read.
        from unittest import mock
        from vega import award

        class NoMatchRead:
            """The connection, refusing any read of a match, its events or its statistics."""

            def __init__(self, conn):
                self.conn = conn

            def execute(self, sql, *args, **kwargs):
                for table in ("core.matches", "core.match_events", "core.player_match_stats", "core.lineup_players", "api.standings"):
                    if table in str(sql):
                        raise AssertionError(f"award.refresh read {table}")
                return self.conn.execute(sql, *args, **kwargs)

            def __getattr__(self, name):
                return getattr(self.conn, name)

        self.assertEqual(self.standings()[4], 5)
        try:
            with mock.patch.dict(award.LEAGUE_RANKS, {5: 0.05}):
                award.refresh(NoMatchRead(self.db), 2025)
                self.assertEqual(self.award_run()[6]["league_ranks"]["5"], 0.05)
            rows = self.award_rows()
            for h in self.honours(1):
                if h["team"] == 4:
                    self.assertAlmostEqual(h["value"], 0.5 * 0.05, places=6)
                    self.assertAlmostEqual(rows[h["player"]]["collective"], 0.025, places=6)
            self.assertEqual(award.stale(self.db), [2025])  # other settings than the present ones
        finally:
            award.refresh(self.db, 2025)
        self.assertTrue(all(h["value"] == 0 for h in self.honours(1) if h["team"] == 4))
        self.assertEqual(award.stale(self.db), [])

    def test_59y_award_due_is_bounded_by_the_award_year(self):
        # After the 2025 race: a match of season 2026 dated 1 September 2026 (award year 2026) updated, then an event of
        # it, list nothing; a match of season 2026 dated 1 May 2026 (inside award year 2025) lists 2025.
        from vega import award
        from vega.store import Store

        x = self.db.execute
        with self.db.transaction():
            Store(self.db).season("2026/2027")
        self.assertEqual(award.due(self.db), [])
        x("INSERT INTO core.competitions(id,name,kind) VALUES(75,'Ligue 75','league')")
        x("INSERT INTO core.competition_seasons(id,competition_id,season_id,native_label) VALUES(75,75,2026,'2026/2027')")
        try:
            x("""INSERT INTO core.matches(id,competition_season_id,season_id,source,status,home_team_id,away_team_id,home_score,away_score,match_date)
                 VALUES(9751,75,2026,'pitchapi','finished',1,2,1,0,'2026-09-01')""")
            self.assertEqual(award.due(self.db), [])
            x("UPDATE core.matches SET home_score = 2, updated_at = clock_timestamp() WHERE season_id = 2026 AND id = 9751")
            self.assertEqual(award.due(self.db), [])
            x("INSERT INTO core.match_events(season_id,match_id,team_id,seq,event_type,minute,player_id) VALUES(2026,9751,1,1,'yellow_card',10,101)")
            self.assertEqual(award.due(self.db), [])
            x("""INSERT INTO core.matches(id,competition_season_id,season_id,source,status,home_team_id,away_team_id,home_score,away_score,match_date)
                 VALUES(9752,75,2026,'pitchapi','finished',2,1,0,0,'2026-05-01')""")
            self.assertEqual(award.due(self.db), [2025])
        finally:
            x("DELETE FROM core.match_events WHERE season_id = 2026 AND match_id = 9751")
            x("DELETE FROM core.matches WHERE season_id = 2026 AND id IN (9751, 9752)")
            x("DELETE FROM core.competition_seasons WHERE id = 75")
            x("DELETE FROM core.competitions WHERE id = 75")
        self.assertEqual(award.due(self.db), [])

    # The ranking's own tables, without their run's ids and times: what a run without the race writes.
    RUN_TABLES = {name: f"""SELECT to_jsonb(t) - ARRAY['run_id', 'calc_run_id', 'updated_at', 'graded_at', 'changed_at', 'computed_at', 'created_at']
                            FROM agg.{name} t WHERE season_id = 2025 ORDER BY {order}""" for name, order in (
        ("player_level", "player_id"), ("player_level_cells", "player_id, position, team_id"), ("player_power", "player_id"),
        ("player_power_matches", "match_id, player_id"), ("player_power_roles", "player_id, role"), ("player_match_grades", "match_id, player_id"),
        ("player_award_ranking", "award, rank"))}

    def test_59z_a_failure_of_the_race_never_blocks_the_ranking_or_the_level(self):
        # award.read_inputs (a statement error inside the read's transaction), award.compute, then award.write (after its
        # rows, a statement error inside the write's transaction) made to fail in turn.
        import contextlib
        import io
        from unittest import mock
        from vega import award, power

        x = self.db.execute
        power.refresh_players(self.db, 2025)  # the reference: a run whose race is published
        expected = self.snapshot(self.RUN_TABLES)
        race, rows, honours = self.award_run(), self.award_rows(), self.honours()
        real_write = award.write

        def read_fails(conn, season):
            conn.execute("SELECT 1 / 0")

        def compute_fails(people, inputs, spreads):
            raise ZeroDivisionError("a player's name")

        def write_fails(conn, *args):
            real_write(conn, *args)
            conn.execute("SELECT 1 / 0")

        failed = "SELECT version, settings, started_at, level_run_id, players, finished_at IS NOT NULL FROM agg.award_runs WHERE season_id = 2025 AND status = 'failed' ORDER BY id"
        before = len(x(failed).fetchall())
        for n, (step, target, broken) in enumerate((("read", "read_inputs", read_fails), ("compute", "compute", compute_fails),
                                                    ("write", "write", write_fails)), 1):
            out = io.StringIO()
            with mock.patch.object(award, target, broken), contextlib.redirect_stdout(out):
                power.refresh_players(self.db, 2025)
            ranking = self.one("SELECT id, started_at FROM agg.power_runs WHERE kind = 'players' AND season_id = 2025 AND status = 'published'")
            self.assertEqual(self.snapshot(self.RUN_TABLES), expected, step)
            runs = x(failed).fetchall()
            self.assertEqual(len(runs), before + n, step)
            self.assertEqual(runs[-1], (award.AWARD_VERSION, award.SETTINGS, ranking[1], self.level_run()[0], None, True), step)
            self.assertEqual(self.award_run(), race, step)  # the race published before, as it was
            self.assertEqual((self.award_rows(), self.honours()), (rows, honours), step)
            self.assertRegex(out.getvalue(), rf"award race failed season=2025 step={step} error=\S+")
            self.assertNotIn("a player's name", out.getvalue())
            self.assertNotIn("division by zero", out.getvalue())
            self.assertEqual((power.stale_rankings(self.db), award.stale(self.db)), ([], []), step)  # no loop
        # Repaired: the next ranking run publishes the race on its level.
        power.refresh_players(self.db, 2025)
        self.assertNotEqual(self.award_run()[0], race[0])
        self.assertEqual(self.award_run()[3], self.level_run()[0])
        self.assertEqual(self.award_rows(), rows)
        self.assertEqual(len(x(failed).fetchall()), before + 3)
        self.assertEqual((power.stale_rankings(self.db), award.stale(self.db)), ([], []))

    def test_59aa_a_memory_error_in_the_race_is_not_caught(self):
        from unittest import mock
        from vega import award, power

        runs = """SELECT 'power', id, status FROM agg.power_runs WHERE season_id = 2025 UNION ALL SELECT 'level', id, status FROM agg.level_runs
                  WHERE season_id = 2025 UNION ALL SELECT 'award', id, status FROM agg.award_runs WHERE season_id = 2025 ORDER BY 1, 2"""
        before = self.db.execute(runs).fetchall()

        def compute(people, inputs, spreads):
            raise MemoryError

        with mock.patch.object(award, "compute", compute), self.assertRaises(MemoryError):
            power.refresh_players(self.db, 2025)
        self.assertEqual(self.db.execute(runs).fetchall(), before)

    def test_59ac_players_at_the_edges_of_the_individual_part(self):
        # 9301 and 9302 play a national-team match alone (award cells, no club cell); 9303 comes on for club 1 in match 1
        # with no position in his line-up or his statistics. Nothing raises; a row is a men's level row's.
        from vega import award, power

        x = self.db.execute
        men = "SELECT player_id FROM agg.player_level WHERE season_id = 2025 AND universe = 'men'"
        x("INSERT INTO core.competitions(id,name,kind) VALUES(74,'Amicaux 74','cup')")
        x("INSERT INTO core.competition_seasons(id,competition_id,season_id,native_label) VALUES(74,74,2025,'2025/2026')")
        x("INSERT INTO core.teams(id,name,is_national) VALUES(83,'Nation 83',true),(84,'Nation 84',true)")
        x("INSERT INTO core.players(id,name) VALUES(9301,'P9301'),(9302,'P9302'),(9303,'P9303')")
        x("""INSERT INTO core.matches(id,competition_season_id,season_id,source,status,home_team_id,away_team_id,home_score,away_score,match_date)
             VALUES(9741,74,2025,'pitchapi','finished',83,84,1,1,'2025-11-15')""")
        x("INSERT INTO core.match_coverage(season_id,match_id) VALUES(2025,9741)")

        def plays(match, team, player, position, minutes):
            x("INSERT INTO core.lineup_players(season_id,match_id,team_id,player_id,is_starter,position_id) VALUES(2025,%s,%s,%s,%s,%s)",
              (match, team, player, position is not None, position))
            x("""INSERT INTO core.player_match_stats(season_id,match_id,team_id,player_id,minutes_played,goals,xg,total_shots,recoveries,tackles,
                   accurate_passes,accurate_passes_total,touches) VALUES(2025,%s,%s,%s,%s,0,0.1,1,3,2,20,25,40)""", (match, team, player, minutes))

        try:
            plays(9741, 83, 9301, 93, 90)
            plays(9741, 84, 9302, 33, 90)
            power.refresh_players(self.db, 2025)
            rows = self.award_rows()
            self.assertFalse({9301, 9302} & set(rows))
            self.assertFalse({9301, 9302} & {p for (p,) in x(men).fetchall()})
            self.assertEqual(set(rows), {p for p, *_ in self.facts["players"]})
            self.assertEqual(sorted(r["rank"] for r in rows.values()), list(range(1, 89)))
            plays(1, 1, 9303, None, 30)
            power.refresh_players(self.db, 2025)
            self.assertEqual(set(self.award_rows()), {p for (p,) in x(men).fetchall()})
            self.assertTrue({p for p, *_ in self.facts["players"]} <= set(self.award_rows()))
        finally:
            x("DELETE FROM core.player_match_stats WHERE season_id = 2025 AND player_id IN (9301, 9302, 9303)")
            x("DELETE FROM core.lineup_players WHERE season_id = 2025 AND player_id IN (9301, 9302, 9303)")
            x("DELETE FROM core.match_coverage WHERE season_id = 2025 AND match_id = 9741")
            x("DELETE FROM core.matches WHERE season_id = 2025 AND id = 9741")
            x("DELETE FROM core.competition_seasons WHERE id = 74")
            x("DELETE FROM core.competitions WHERE id = 74")
            power.refresh_players(self.db, 2025)
            for table in ("agg.player_grade_exclusions", "agg.player_power_matches", "agg.player_match_grades"):
                x(f"DELETE FROM {table} WHERE player_id IN (9301, 9302, 9303)")
            x("DELETE FROM core.players WHERE id IN (9301, 9302, 9303)")
            x("DELETE FROM core.teams WHERE id IN (83, 84)")
        self.assertEqual(set(self.award_rows()), {p for p, *_ in self.facts["players"]})

    def test_59ad_the_league_rank_is_read_from_the_base_tables(self):
        # The league's official table (sportscore, whole league) beside Vega's: agreeing, clubs 6 and 8 swapped (a points
        # deduction); one club's matches counted otherwise; two clubs at one place with different points.
        from vega import award

        x = self.db.execute
        vega = self.standings()
        self.assertEqual(vega, {8: 1, 6: 2, 2: 3, 5: 4, 4: 5, 7: 6, 3: 7, 1: 8})
        official = {8: 2, 6: 1, 2: 3, 5: 4, 4: 5, 7: 6, 3: 7, 1: 8}

        def table(ranks, played=None, points=None):
            x("DELETE FROM core.standings_official WHERE competition_season_id = 1")
            for team, rank in ranks.items():
                x("""INSERT INTO core.standings_official(competition_season_id,stage,group_name,team_id,position,played,points,source,as_of)
                     VALUES(1,NULL,NULL,%s,%s,%s,%s,'sportscore',now())""",
                  (team, rank, (played or {}).get(team, 14), (points or {}).get(team, 40 - 3 * rank)))
            award.reread(self.db, 2025)
            return {h["team"]: h["league_rank"] for h in self.honours(1)}

        try:
            self.assertEqual(table(official), official)
            self.assertEqual(table(official, played={1: 13}), vega)
            self.assertEqual(table({**official, 6: 1, 8: 1}, points={6: 37, 8: 36}), vega)
            seen = []

            class Seen:
                def __init__(self, conn):
                    self.conn = conn

                def execute(self, sql, *args, **kwargs):
                    seen.append(str(sql))
                    return self.conn.execute(sql, *args, **kwargs)

                def __getattr__(self, name):
                    return getattr(self.conn, name)

            award.read_inputs(Seen(self.db), 2025)
            self.assertTrue(seen)
            self.assertEqual([s for s in seen if "api." in s], [])
            self.assertFalse(self.one("SELECT has_schema_privilege('vega_calc', 'api', 'USAGE')")[0])
        finally:
            x("DELETE FROM core.standings_official WHERE competition_season_id = 1")
            award.reread(self.db, 2025)
        self.assertEqual({h["team"]: h["league_rank"] for h in self.honours(1)}, vega)

    def test_59ae_one_honour_per_team_and_real_competition(self):
        # PitchAPI's World Cup (l_1XLtP0) and OpenFootball's (world-cup-history) of the same year, the same final; the
        # German cup of OpenLigaDB and open-matchday's copy of it, the same final.
        from vega import award

        x = self.db.execute
        x("INSERT INTO core.competitions(id,name,kind) VALUES(76,'World Cup 76','international')")
        x("INSERT INTO core.provider_ids(entity_type,provider,provider_key,entity_id) VALUES('competition','pitchapi','l_1XLtP0',76)")
        x("INSERT INTO core.competition_seasons(id,competition_id,season_id,native_label) VALUES(76,76,2025,'2026')")
        x("INSERT INTO core.teams(id,name,is_national) VALUES(85,'Nation 85',true),(86,'Nation 86',true)")
        final = x("INSERT INTO core.rounds(competition_season_id,name,stage) VALUES(76,'Final','final') RETURNING id").fetchone()[0]
        x("""INSERT INTO core.matches(id,competition_season_id,season_id,source,status,round_id,home_team_id,away_team_id,home_score,away_score,match_date)
             VALUES(9761,76,2025,'pitchapi','finished',%s,85,86,2,0,'2026-07-19')""", (final,))
        for team, player in ((85, 105), (86, 205)):
            x("""INSERT INTO core.player_match_stats(season_id,match_id,team_id,player_id,minutes_played) VALUES(2025,9761,%s,%s,90)""", (team, player))
        self.addCleanup(x, "DELETE FROM core.teams WHERE id IN (85, 86)")  # after the cups' own clean-up
        try:
            self.award_cup(77, "open-cups:world-cup-history:2026", [(9771, "Final", 85, 86, "finished", (2, 0), None, None, "2026-07-19")])
            self.award_cup(78, "openligadb:germany-cup:2025/2026", [(9781, "Final", 1, 2, "finished", (1, 0), None, None)])
            self.award_cup(79, "open-matchday:GER_CUP_dfb-pokal:2025/2026", [(9791, "Final", 1, 2, "finished", (1, 0), None, None)])
            award.reread(self.db, 2025)
            got = {(h["player"], h["edition"]): h["reached"] for h in self.honours() if h["edition"] in (76, 77)}
            self.assertEqual(got, {(105, 76): "winner", (205, 76): "final"})
            self.assertEqual(self.honours(79), [])
            self.assertEqual({(h["team"], h["reached"]) for h in self.honours(78)}, {(1, "winner"), (2, "final")})
            self.assertEqual(len(self.honours(78)), 22)
        finally:
            x("DELETE FROM core.player_match_stats WHERE season_id = 2025 AND match_id = 9761")
            x("DELETE FROM core.matches WHERE season_id = 2025 AND id = 9761")
            x("DELETE FROM core.rounds WHERE competition_season_id = 76")
            x("DELETE FROM core.competition_seasons WHERE id = 76")
            x("DELETE FROM core.provider_ids WHERE entity_type = 'competition' AND entity_id = 76")
            x("DELETE FROM core.competitions WHERE id = 76")

    def test_59af_a_final_of_two_legs_is_won_on_aggregate(self):
        # Club 1 wins 3–0 at home, loses 1–0 away: 3–1 on aggregate, the second leg lost.
        from vega import award

        self.award_cup(80, "open-cups:coupe-80:2025/2026", [(9801, "Final", 1, 2, "finished", (3, 0), None, None, "2025-10-01"),
                                                            (9802, "Final", 2, 1, "finished", (1, 0), None, None, "2025-10-02")])
        self.award_cup(81, "open-cups:coupe-81:2025/2026", [(9811, "Final", 3, 4, "finished", (2, 0), None, None, "2025-10-01"),
                                                            (9812, "Final", 4, 3, "not_started", None, None, None, "2025-10-02")])
        award.reread(self.db, 2025)
        reached = {(h["edition"], h["team"]): (h["reached"], h["reason"]) for h in self.honours() if h["edition"] in (80, 81)}
        self.assertEqual(reached, {(80, 1): ("winner", None), (80, 2): ("final", None), (81, 3): ("final", None), (81, 4): ("final", None)})

    @classmethod
    def tearDownClass(cls):
        cls.db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        cls.db.close()

    @classmethod
    def build(cls):
        x = cls.db.execute
        x("INSERT INTO core.competitions(id,name,country_code,kind) VALUES(1,'Ligue 1',NULL,'league')")
        x("INSERT INTO core.provider_ids(entity_type,provider,provider_key,entity_id) VALUES('competition','pitchapi','l_3FJFUl',1)")
        x("INSERT INTO core.competition_seasons(id,competition_id,season_id,native_label) VALUES(1,1,2025,'2025/2026')")
        x("INSERT INTO core.teams(id,name) SELECT t, 'Club ' || t FROM generate_series(1,8) t")
        # A UEFA coefficient for club 1 only; the others take the association floor.
        x("INSERT INTO core.ranking_editions(id,kind,provider,label,is_current) VALUES(1,'uefa_clubs','uefa','2025/2026',true)")
        x("INSERT INTO core.ranking_rows(edition_id,row_no,team_id,position,points) VALUES(1,1,1,10,100)")
        players = []
        for team in TEAMS:
            for slot, (group, position) in enumerate(SQUAD):
                pid = team * 100 + slot
                players.append((pid, team, group, position))
                birth = "2000-01-01" if team == 1 else None
                x("INSERT INTO core.players(id,name,birth_date) VALUES(%s,%s,%s)", (pid, f"P{pid}", birth))
        facts = {k: {t: 0 for t in TEAMS} for k in ("points", "matches", "goals_for", "goals_against")}
        facts["recoveries"] = {}
        mid = 0
        for home in TEAMS:
            for away in TEAMS:
                if home == away:
                    continue
                mid += 1
                hs, as_ = (home * 3 + away) % 4, (away * 2 + home) % 3
                x(
                    "INSERT INTO core.matches(id,competition_season_id,season_id,source,status,home_team_id,away_team_id,home_score,away_score,match_date) VALUES(%s,1,2025,'pitchapi','finished',%s,%s,%s,%s,'2025-10-01')",
                    (mid, home, away, hs, as_),
                )
                x("INSERT INTO core.match_coverage(season_id,match_id) VALUES(2025,%s)", (mid,))
                for team, gf, ga in ((home, hs, as_), (away, as_, hs)):
                    facts["points"][team] += 3 if gf > ga else 1 if gf == ga else 0
                    facts["matches"][team] += 1
                    facts["goals_against"][team] += ga
                    facts["goals_for"][team] += gf
                    x(
                        """INSERT INTO core.team_match_stats(season_id,match_id,team_id,period,xg,npxg,total_shots,shots_on_target,possession_pct,
                             passes,accurate_passes,touches_opp_box,big_chances,duels_won,aerials_won,tackles,interceptions,fouls,corners,
                             opposition_half_passes,own_half_passes,long_balls_accurate,accurate_crosses,xg_set_play)
                           VALUES(2025,%s,%s,'all',%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                        (mid, team, 0.4 + 0.15 * team + 0.05 * (mid % 3), 0.35 + 0.15 * team, 8 + team + mid % 4, 3 + team % 3,
                         40 + team * 2 + (mid % 5), 300 + team * 20, 240 + team * 18, 15 + team, 1 + team % 4, 40 + mid % 7,
                         12 + team % 5, 14 + mid % 6, 9 + team % 4, 11 + mid % 3, 4 + team % 3, 120 + team * 10, 150 - team * 5,
                         20 + team % 6, 3 + mid % 4, 0.1 + 0.02 * team),
                    )
                for pid, team, group, position in players:
                    if team not in (home, away):
                        continue
                    # Player 102 (a defender) has no xG in one match: no xG ranking for him.
                    xg = None if (pid == 102 and mid == 1) else round(0.01 * (pid % 17), 2)
                    recoveries = (pid * 7 + mid) % 9
                    facts["recoveries"][pid] = facts["recoveries"].get(pid, 0) + recoveries
                    # As in production: the line-up carries the position, the statistics row has none.
                    x(
                        "INSERT INTO core.lineup_players(season_id,match_id,team_id,player_id,is_starter,position_id) VALUES(2025,%s,%s,%s,true,%s)",
                        (mid, team, pid, position),
                    )
                    x(
                        """INSERT INTO core.player_match_stats(season_id,match_id,team_id,player_id,position_id,minutes_played,goals,xg,
                             total_shots,recoveries,interceptions,tackles,clearances,shot_blocks,duels_won,duels_lost,accurate_passes,
                             accurate_passes_total,touches,chances_created,passes_into_final_third,dribbles_succeeded,touches_opp_box,saves,goals_prevented)
                           VALUES(2025,%s,%s,%s,%s,90,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                        (mid, team, pid, None, int((pid + mid) % 5 == 0), xg, pid % 4, recoveries, (pid + mid) % 4, (pid * 3 + mid) % 5,
                         (pid + 2 * mid) % 6, pid % 3, (pid * 5 + mid) % 8, (pid + mid) % 7, 20 + pid % 30, 30 + pid % 30,
                         40 + (pid * 11 + mid) % 25, (pid + mid) % 4, (pid * 2 + mid) % 6, pid % 5, (pid + mid) % 3,
                         (pid + mid) % 6 if group == "G" else None, 0.1 * ((pid + mid) % 3) if group == "G" else None),
                    )
        facts["players"] = players
        return facts

    def one(self, sql, *args):
        return self.db.execute(sql, args).fetchone()

    def cohort(self, key):
        return self.one("SELECT id FROM agg.cohorts WHERE key=%s", key)[0]

    def test_cohorts_of_a_top7_league(self):
        keys = {k for (k,) in self.db.execute("SELECT key FROM agg.cohorts")}
        expected = {"team:2025:cs:1", "team:2025:europe"} | {
            f"player:2025:{scope}:{g}" for scope in ("cs:1", "europe") for g in "GDMO"
        }
        self.assertEqual(keys, expected)
        self.assertEqual(self.one("SELECT per_match, universe::text FROM agg.cohorts WHERE key='team:2025:europe'"), (True, "europe"))
        runs = dict(self.db.execute("SELECT kind::text, count(*) FROM agg.calc_runs WHERE status='published' GROUP BY 1"))
        self.assertEqual(runs["percentiles"], 10)
        self.assertEqual(self.one("SELECT count(*) FROM agg.calc_runs WHERE status='running'")[0], 0)

    def test_club_percentiles_ranks_and_distributions(self):
        cohort = self.cohort("team:2025:cs:1")
        ppm = {t: self.facts["points"][t] / self.facts["matches"][t] for t in TEAMS}
        gapm = {t: self.facts["goals_against"][t] / self.facts["matches"][t] for t in TEAMS}
        for team in TEAMS:
            value, pct, rank = self.one(
                "SELECT value, percentile, rank FROM agg.team_percentiles WHERE cohort_id=%s AND team_id=%s AND metric_key='ppm'", cohort, team
            )
            self.assertAlmostEqual(value, ppm[team], places=5)
            self.assertEqual(pct, centile(list(ppm.values()), ppm[team]))
            self.assertEqual(rank, 1 + sum(v > ppm[team] for v in ppm.values()))
            # Lower is better: the percentile is inverted and the rank counts lower values.
            pct, rank = self.one(
                "SELECT percentile, rank FROM agg.team_percentiles WHERE cohort_id=%s AND team_id=%s AND metric_key='goals_against_pm'", cohort, team
            )
            self.assertEqual(pct, centile(list(gapm.values()), gapm[team], -1))
            self.assertEqual(rank, 1 + sum(v < gapm[team] for v in gapm.values()))
        median = sorted(ppm.values())
        self.assertAlmostEqual(
            self.one("SELECT p50 FROM agg.cohort_distributions WHERE cohort_id=%s AND metric_key='ppm'", cohort)[0],
            (median[3] + median[4]) / 2, places=5,
        )
        self.assertEqual(self.one("SELECT size FROM agg.cohorts WHERE id=%s", cohort)[0], 8)

    def test_club_index_phases_and_positions(self):
        cohort = self.cohort("team:2025:cs:1")
        pct = {}
        for team, key, value in self.db.execute(
            "SELECT team_id, metric_key, percentile FROM agg.team_percentiles WHERE cohort_id=%s AND percentile IS NOT NULL", (cohort,)
        ):
            pct.setdefault(team, {})[key] = value
        indices = {}
        for team in TEAMS:
            phases = {}
            for phase, keys in models.TEAM_PHASES.items():
                known = [pct[team][k] for k in keys if k in pct[team]]
                phases[phase] = half_up(sum(known) / len(known)) if known else None
            used = {p: w for p, w in models.PHASE_WEIGHTS.items() if phases[p] is not None}
            indices[team] = half_up(sum(w * phases[p] for p, w in used.items()) / sum(used.values()))
            row = self.one("SELECT vega_index, attack, defence FROM agg.team_index WHERE cohort_id=%s AND team_id=%s", cohort, team)
            self.assertEqual(row, (indices[team], phases["attack"], phases["defence"]))
        for team in TEAMS:
            self.assertEqual(
                self.one("SELECT vega_rank FROM agg.team_index WHERE cohort_id=%s AND team_id=%s", cohort, team)[0],
                1 + sum(v > indices[team] for v in indices.values()),
            )
        # Position follows the standings: points, then goal difference, then goals scored.
        f = self.facts
        table = {t: (f["points"][t], f["goals_for"][t] - f["goals_against"][t], f["goals_for"][t]) for t in TEAMS}
        for team in TEAMS:
            self.assertEqual(
                self.one("SELECT position FROM agg.team_index WHERE cohort_id=%s AND team_id=%s", cohort, team)[0],
                1 + sum(v > table[team] for v in table.values()),
            )

    def test_player_percentiles_coverage_and_thresholds(self):
        defenders = self.cohort("player:2025:cs:1:D")
        keepers = self.cohort("player:2025:cs:1:G")
        d_players = [p for p, _, g, _ in self.facts["players"] if g == "D"]
        per90 = {p: 90 * self.facts["recoveries"][p] / (14 * 90) for p in d_players}
        for pid in (101, 204, 803):
            value, pct, rank = self.one(
                "SELECT value_p90, percentile, rank FROM agg.player_percentiles WHERE cohort_id=%s AND player_id=%s AND metric_key='recoveries'",
                defenders, pid,
            )
            self.assertAlmostEqual(value, per90[pid], places=4)
            self.assertEqual(pct, centile(list(per90.values()), per90[pid]))
            self.assertEqual(rank, 1 + sum(v > per90[pid] for v in per90.values()))
        # Player 102's xG is blank in one match that shows xG for others: a zero the source
        # did not write (068), so he is ranked on xG like the 31 others.
        self.assertEqual(self.one("SELECT xg_n, appearances FROM agg.player_season_stats WHERE player_id=102 AND competition_season_id=1"), (14, 14))
        self.assertIsNotNone(self.one("SELECT 1 FROM agg.player_percentiles WHERE cohort_id=%s AND player_id=102 AND metric_key='xg'", defenders))
        self.assertEqual(
            self.one("SELECT count(*) FROM agg.player_percentiles WHERE cohort_id=%s AND metric_key='xg'", defenders)[0], 32
        )
        # 8 keepers: values and ranks, but fewer than 30 peers so no percentile.
        self.assertEqual(
            self.one("SELECT count(*), count(percentile) FROM agg.player_percentiles WHERE cohort_id=%s AND metric_key='saves'", keepers),
            (8, 0),
        )

    def test_roles_player_index_and_similarity(self):
        defenders = self.cohort("player:2025:cs:1:D")
        europe = self.cohort("player:2025:europe:D")
        roles = {r for (r,) in self.db.execute("SELECT DISTINCT role_code FROM agg.player_role_scores WHERE cohort_id=%s", (defenders,))}
        self.assertEqual(roles, {"recovery", "box_defence", "build_up"})
        pct = dict(
            self.db.execute(
                "SELECT metric_key, percentile FROM agg.player_percentiles WHERE cohort_id=%s AND player_id=101", (defenders,)
            ).fetchall()
        )
        score = self.one("SELECT score FROM agg.player_role_scores WHERE cohort_id=%s AND player_id=101 AND role_code='recovery'", defenders)[0]
        self.assertEqual(score, half_up((pct["recoveries"] + pct["interceptions"] + pct["tackles"]) / 3))
        self.assertEqual(
            self.one("SELECT count(*) FROM agg.player_role_scores WHERE cohort_id=%s AND is_primary", defenders)[0], 32
        )
        # Index: the primary role score in the canonical (Europe) cohort.
        self.assertEqual(
            self.one("SELECT vega_index, potential FROM agg.player_index WHERE player_id=101 AND season_id=2025"),
            (self.one("SELECT score FROM agg.player_role_scores WHERE cohort_id=%s AND player_id=101 AND is_primary", europe)[0], None),
        )
        # Similarity: 100 − mean percentile gap over the axes both players have.
        sim, other = self.one(
            "SELECT similarity, similar_player_id FROM agg.player_similar WHERE cohort_id=%s AND player_id=101 AND rank=1", defenders
        )
        mine = {k: v for k, v in pct.items() if k in models.PLAYER_SIMILARITY_AXES and v is not None}
        theirs = dict(
            self.db.execute(
                "SELECT metric_key, percentile FROM agg.player_percentiles WHERE cohort_id=%s AND player_id=%s AND percentile IS NOT NULL",
                (defenders, other),
            ).fetchall()
        )
        common = [k for k in mine if k in theirs]
        self.assertAlmostEqual(sim, 100 - sum(abs(mine[k] - theirs[k]) for k in common) / len(common), places=3)
        self.assertEqual(self.one("SELECT max(rank) FROM agg.team_similar WHERE cohort_id=%s", self.cohort("team:2025:cs:1"))[0], 7)

    def test_two_calculators_write_a_season_s_index_one_after_the_other(self):
        # Another calculator holds the season's index: this one waits for it (here, gives
        # up at once) instead of emptying and writing the same rows.
        from vega.store import connect_local

        other = connect_local(DSN)
        try:
            with other.transaction():
                other.execute("SELECT pg_advisory_xact_lock(92011, 2025)")
                self.db.execute("SET lock_timeout = '300ms'")
                try:
                    with self.assertRaises(psycopg.errors.LockNotAvailable):
                        models.refresh_player_index(self.db, 2025)
                finally:
                    self.db.execute("RESET lock_timeout")
            before = self.db.execute("SELECT count(*) FROM agg.player_index WHERE season_id=2025").fetchone()[0]
            models.refresh_player_index(self.db, 2025)
            self.assertEqual(self.db.execute("SELECT count(*) FROM agg.player_index WHERE season_id=2025").fetchone()[0], before)
            self.assertGreater(before, 0)
        finally:
            other.close()

    def test_levels_strength_and_squad(self):
        # A club's level is its season-end Elo: the Elo it carried in plus what the season added.
        levels = self.db.execute(
            """SELECT l.team_id, l.level, l.season_part, l.long_run_part, p.elo, p.elo_change FROM agg.team_levels l
               JOIN agg.team_power p ON p.team_id=l.team_id AND p.season_id=l.season_id AND p.scope='clubs' ORDER BY 1"""
        ).fetchall()
        self.assertEqual(len(levels), 8)
        for team, level, season_part, long_run, elo, change in levels:
            self.assertAlmostEqual(level, elo, places=3)
            self.assertAlmostEqual(season_part, change, places=3)
            self.assertAlmostEqual(long_run + season_part, level, places=3)
        self.assertEqual(self.one("SELECT formula_version FROM agg.calc_runs WHERE kind='levels' AND status='published'")[0], "levels-elo-v1")
        goals = self.one("SELECT sum(home_score + away_score)::float / count(*) FROM core.matches")[0]
        self.assertEqual(self.one("SELECT strength FROM agg.competition_strength WHERE competition_season_id=1")[0], 50)
        self.assertAlmostEqual(self.one("SELECT goals_per90 FROM agg.competition_strength")[0], goals, places=5)
        # Only club 1's players have a birth date; no market value source yet.
        self.assertEqual(
            self.one("SELECT squad_value_eur, minutes_24_26 FROM agg.team_squad_profile WHERE team_id=1 AND season_id=2025"),
            (None, 11 * 14 * 90),
        )
        self.assertEqual(self.one("SELECT count(*) FROM agg.team_squad_profile")[0], 1)
        self.assertEqual(self.one("SELECT count(*) FROM agg.player_projections")[0], 0)
        # The award race is written by the power ranking (test_power_rankings_of_players).
        self.assertEqual(self.one("SELECT count(*) FROM agg.player_award_ranking")[0], 30)

    def test_historical_squad_value_uses_only_estimates_available_at_the_matches(self):
        with self.db.transaction(force_rollback=True):
            self.db.execute("""INSERT INTO core.player_market_values(player_id,valued_at,value_eur,source,as_of)
                SELECT p.player_id, v.day, v.euros, 'transfermarkt', current_date
                FROM (SELECT player_id FROM core.player_match_stats WHERE team_id=1 ORDER BY player_id LIMIT 1) p
                CROSS JOIN (VALUES (DATE '1900-01-01', 100), (DATE '2200-01-01', 999)) v(day, euros)""")
            models.refresh_squad_profiles(self.db, 2025)
            self.assertEqual(
                self.one("SELECT squad_value_eur FROM agg.team_squad_profile WHERE team_id=1 AND season_id=2025"),
                (100,),
            )

    def expected_distribution(self):
        """The rows build() inserted, counted per line, metric and value (all play 90 minutes)."""
        expected = Counter()
        mid = 0
        for home in TEAMS:
            for away in TEAMS:
                if home == away:
                    continue
                mid += 1
                for pid, team, group, _ in self.facts["players"]:
                    if team not in (home, away):
                        continue
                    shots = pid % 4
                    xg = None if (pid == 102 and mid == 1) else round(0.01 * (pid % 17), 2)
                    won, lost = (pid * 5 + mid) % 8, (pid + mid) % 7
                    values = {
                        "appearances": 1.0,
                        "recoveries": float((pid * 7 + mid) % 9),
                        # No shot: no xG and nothing on target, both worth 0; unknown otherwise.
                        "xg": xg if xg is not None else (0.0 if shots == 0 else None),
                        "shots_on_target": 0.0 if shots == 0 else None,
                        "pass_accuracy": (20 + pid % 30) / (30 + pid % 30) * 100,
                        "duel_rate": won / (won + lost) * 100 if won + lost >= 4 else None,
                        "saves": float((pid + mid) % 6) if group == "G" else None,
                    }
                    for metric, value in values.items():
                        if value is not None:
                            expected[(group, metric, value)] += 1
        return dict(expected)

    def distribution(self, metrics):
        rows = self.db.execute(
            "SELECT profile_group, metric, value, appearances FROM agg.performance_distribution WHERE competition_season_id=1 AND metric = ANY(%s)",
            (sorted(metrics),),
        ).fetchall()
        return {(g, m, v): n for g, m, v, n in rows}

    def test_performance_distribution_counts_every_appearance(self):
        # 055: the calculator filled the histogram (setUpClass); the read sums these rows.
        expected = self.expected_distribution()
        metrics = {m for _, m, _ in expected}
        self.assertEqual(self.distribution(metrics), expected)
        self.assertEqual(sum(n for (_, m, _), n in expected.items() if m == "appearances"), 88 * 14)
        self.assertEqual(self.one("SELECT agg.refresh_performance_distribution(1)")[0], 0)  # nothing to rewrite
        # One appearance changes: its old value loses a peer, the new one appears. Without a
        # line-up position a keeper is known by his saves, anyone else joins the outfield line.
        x = self.db.execute
        keeper, mid_fielder = 100, 105  # both of team 1, at home in match 1
        try:
            x("UPDATE core.player_match_stats SET recoveries=99 WHERE season_id=2025 AND match_id=1 AND player_id=%s", (mid_fielder,))
            x("UPDATE core.lineup_players SET position_id=NULL WHERE season_id=2025 AND match_id=1 AND player_id = ANY(%s)", ([keeper, mid_fielder],))
            self.assertGreater(self.one("SELECT agg.refresh_performance_distribution(1)")[0], 0)
            now = self.distribution(metrics)
            self.assertEqual(now[("F", "recoveries", 99.0)], 1)
            self.assertEqual(now[("F", "appearances", 1.0)], 1)
            self.assertEqual(now[("M", "appearances", 1.0)], expected[("M", "appearances", 1.0)] - 1)
            self.assertEqual(now[("G", "appearances", 1.0)], expected[("G", "appearances", 1.0)])
            # Under 30 minutes the appearance is no peer.
            x("UPDATE core.player_match_stats SET minutes_played=29 WHERE season_id=2025 AND match_id=1 AND player_id=%s", (mid_fielder,))
            x("SELECT agg.refresh_performance_distribution(1)")
            self.assertNotIn(("F", "appearances", 1.0), self.distribution(metrics))
        finally:
            x("UPDATE core.player_match_stats SET recoveries=%s, minutes_played=90 WHERE season_id=2025 AND match_id=1 AND player_id=%s",
              ((mid_fielder * 7 + 1) % 9, mid_fielder))
            x("UPDATE core.lineup_players SET position_id=11 WHERE season_id=2025 AND match_id=1 AND player_id=%s", (keeper,))
            x("UPDATE core.lineup_players SET position_id=62 WHERE season_id=2025 AND match_id=1 AND player_id=%s", (mid_fielder,))
            x("SELECT agg.refresh_performance_distribution(1)")
        self.assertEqual(self.distribution(metrics), expected)

    def test_player_list_rows_hold_each_player_s_season(self):
        # 060: the calculator wrote the rows of the player list (setUpClass); the list sums them.
        matches, mid = {t: [] for t in TEAMS}, 0
        for home in TEAMS:
            for away in TEAMS:
                if home != away:
                    mid += 1
                    matches[home].append(mid)
                    matches[away].append(mid)

        def editions():
            return {r[0]: r[1:] for r in self.db.execute(
                """SELECT player_id, matches, total_minutes, unknown_matches, starts, known_starts, goals_sum, goals_count, goals_minutes,
                          xg_count, recoveries_sum, pass_accuracy_numerator, pass_accuracy_denominator, pass_accuracy_count,
                          identity_match_id, identity_team_id, latest_match_id, latest_position
                   FROM agg.player_list_editions WHERE competition_season_id=1 AND season_id=2025"""
            )}

        def clubs():
            return self.db.execute("SELECT player_id, team_id, first_order FROM agg.player_list_teams WHERE competition_season_id=1 ORDER BY 1").fetchall()

        def positions():
            return self.db.execute(
                "SELECT player_id, position_number, minutes, first_order FROM agg.player_list_positions WHERE competition_season_id=1 ORDER BY 1"
            ).fetchall()

        players = sorted(self.facts["players"])
        expected = {}
        for pid, team, _, position in players:
            mids = matches[team]  # all on the same day: the first one is his identity and his latest
            expected[pid] = (
                14, 14 * 90, 0, 14, 14, sum((pid + m) % 5 == 0 for m in mids), 14, 14 * 90,
                14, self.facts["recoveries"][pid], 14 * (20 + pid % 30), 14 * (30 + pid % 30), 14,
                mids[0], team, mids[0], position,
            )
        self.assertEqual(editions(), expected)
        self.assertEqual(clubs(), [(pid, team, 1) for pid, team, _, _ in players])
        self.assertEqual(positions(), [(pid, position, 14 * 90, 1) for pid, _, _, position in players])
        self.assertEqual(self.one("SELECT agg.refresh_player_list(1)")[0], 0)  # nothing to rewrite
        x = self.db.execute
        pid, (first, second) = 105, matches[1][:2]
        change = "UPDATE core.player_match_stats SET minutes_played=%s WHERE season_id=2025 AND match_id=%s AND player_id=%s"
        try:
            # Not played: the match leaves his totals, and his club and position start at his second row.
            x(change, (0, first, pid))
            self.assertEqual(self.one("SELECT agg.refresh_player_list(1)")[0], 3)  # his row, his club, his position
            row = editions()[pid]
            self.assertEqual(row[:5], (13, 13 * 90, 0, 13, 13))  # starts are counted on played matches
            self.assertEqual(row[5], sum((pid + m) % 5 == 0 for m in matches[1][1:]))
            self.assertEqual(row[13:], (first, 1, second, 62))
            self.assertIn((pid, 1, 2), clubs())
            self.assertIn((pid, 62, 13 * 90, 2), positions())
            # Minutes unknown: the match is counted apart.
            x(change, (None, first, pid))
            x("SELECT agg.refresh_player_list(1)")
            self.assertEqual(editions()[pid][:3], (13, 13 * 90, 1))
        finally:
            x(change, (90, first, pid))
            x("SELECT agg.refresh_player_list(1)")
        self.assertEqual(editions(), expected)
        self.assertEqual(clubs(), [(pid, team, 1) for pid, team, _, _ in players])

    def test_blanks_are_zeros_where_the_match_shows_the_statistic(self):
        # 068: agg.match_zeros says, match by match, the statistics whose blank is a zero.
        from vega.metric_catalog import KEEPER_ZERO_STATS, ZERO_STATS

        x = self.db.execute
        columns = [r[0] for r in x(
            "SELECT column_name FROM information_schema.columns WHERE table_schema='agg' AND table_name='match_zeros' ORDER BY ordinal_position"
        )]
        self.assertEqual(tuple(columns[3:]), ZERO_STATS + KEEPER_ZERO_STATS)

        def zero(match, column):
            return self.one(f"SELECT {column} FROM agg.match_zeros WHERE season_id=2025 AND match_id=%s", match)[0]

        def counts(player):
            return self.one(
                """SELECT xg_count, big_chances_created_count, big_chances_created_sum FROM agg.player_list_editions
                   WHERE competition_season_id=1 AND player_id=%s""", player)

        def read(player, match):
            return self.one(
                "SELECT xg, big_chances_created FROM api.player_appearances WHERE season_id=2025 AND match_id=%s AND player_id=%s",
                match, player)

        def refresh():
            x("SELECT agg.refresh_match_zeros(1)")
            x("SELECT agg.refresh_player_list(1)")

        # Player 102 has no xG in match 1 (the seed): his row is measured and the match
        # shows xG, so it is a zero. No big chance in the edition: the statistic stays blank.
        self.assertTrue(zero(1, "xg"))
        self.assertFalse(zero(1, "big_chances_created"))
        self.assertEqual(read(102, 1), (0.0, None))
        self.assertEqual(counts(102), (14, 0, None))
        self.assertEqual(self.one("SELECT agg.refresh_match_zeros(1)")[0], 0)  # nothing to rewrite
        try:
            # His row of match 1 is no longer measured; match 2 shows no xG at all; one
            # big chance appears in match 3 (the three matches are his club's, and 105's).
            x("UPDATE core.player_match_stats SET touches=NULL WHERE season_id=2025 AND match_id=1 AND player_id=102")
            x("UPDATE core.player_match_stats SET xg=NULL WHERE season_id=2025 AND match_id=2")
            x("UPDATE core.player_match_stats SET big_chances_created=1 WHERE season_id=2025 AND match_id=3 AND player_id=105")
            refresh()
            # The edition now shows big chances: a zero in every complete match. Match 2
            # lacks the xG the edition shows elsewhere: it is not complete, its blanks stay.
            self.assertEqual([zero(m, "xg") for m in (1, 2, 3)], [True, False, True])
            self.assertEqual([zero(m, "big_chances_created") for m in (1, 2, 3)], [True, False, True])
            self.assertEqual(read(102, 1), (None, None))  # not measured: nothing is known of his match
            self.assertEqual(read(105, 2), (None, None))
            self.assertEqual(read(105, 1)[1], 0.0)
            self.assertEqual(read(105, 3)[1], 1.0)
            self.assertEqual(counts(102), (12, 12, 0))
            self.assertEqual(counts(105), (13, 13, 1))
        finally:
            x("UPDATE core.player_match_stats SET touches=40 + mod(player_id * 11 + match_id, 25) WHERE season_id=2025 AND match_id=1 AND player_id=102")
            x("""UPDATE core.player_match_stats SET xg=round((0.01 * mod(player_id, 17))::numeric, 2)::real
                 WHERE season_id=2025 AND match_id=2""")
            x("UPDATE core.player_match_stats SET big_chances_created=NULL WHERE season_id=2025 AND match_id=3 AND player_id=105")
            refresh()
        self.assertEqual(counts(102), (14, 0, None))
        self.assertEqual(counts(105), (14, 0, None))

    def test_a_keeper_who_faced_no_shot_prevented_no_goal(self):
        # 070: the starting goalkeeper's blanks. Club 1's keeper is player 100, club 3's 300;
        # they meet in match 2, where 100 made no save (the seed); in match 1 he made five.
        from vega.calculator import refresh_competition_season

        x = self.db.execute

        def listed(player):
            return self.one(
                "SELECT goals_prevented_count, saves_count FROM agg.player_list_editions WHERE competition_season_id=1 AND player_id=%s", player)

        def season(player):
            return self.one(
                "SELECT goals_prevented_n, penalties_saved_n, penalties_saved_sum FROM agg.player_season_stats WHERE competition_season_id=1 AND player_id=%s",
                player)

        def read(player, match):
            return self.one(
                "SELECT goals_prevented, xgot_faced FROM api.player_appearances WHERE season_id=2025 AND match_id=%s AND player_id=%s",
                match, player)

        self.assertEqual((listed(100), season(100)), ((14, 14), (14, 0, None)))
        self.assertEqual(self.one("SELECT saves FROM core.player_match_stats WHERE season_id=2025 AND match_id=2 AND player_id=100")[0], 0)
        blank = "UPDATE core.player_match_stats SET goals_prevented=%s WHERE season_id=2025 AND match_id=%s AND player_id=100"
        try:
            # No goals prevented written for him in either match; the other keeper of match 2 saved a penalty.
            x(blank, (None, 1))
            x(blank, (None, 2))
            x("UPDATE core.player_match_stats SET penalties_saved=1 WHERE season_id=2025 AND match_id=2 AND player_id=300")
            refresh_competition_season(self.db, 1)
            # Nothing to stop in match 2: zero. Five saves in match 1: the blank stays.
            self.assertEqual(read(100, 2)[0], 0.0)
            self.assertIsNone(read(100, 1)[0])
            self.assertEqual(read(100, 2)[1], None)  # the edition shows no expected goals on target faced
            self.assertEqual(listed(100), (13, 14))
            # The edition shows penalties saved: a zero for each starting keeper, for him alone.
            self.assertEqual(season(100), (13, 14, 0))
            self.assertEqual(season(300)[1:], (14, 1))
            self.assertEqual(season(105)[:2], (0, 0))
            self.assertEqual(read(105, 2), (None, None))
        finally:
            x(blank, (0.2, 1))
            x(blank, (0.0, 2))
            x("UPDATE core.player_match_stats SET penalties_saved=NULL WHERE season_id=2025 AND match_id=2 AND player_id=300")
            refresh_competition_season(self.db, 1)
        self.assertEqual((listed(100), season(100)), ((14, 14), (14, 0, None)))

    def test_partitioned_tables_get_their_own_statistics(self):
        # 056: autovacuum never analyses a partitioned table itself.
        parents = self.one("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='p' AND n.nspname IN ('core','agg','ops')")[0]
        self.assertGreater(parents, 5)
        self.assertEqual(self.one("SELECT ops.analyze_partitioned()")[0], parents)
        self.assertGreater(
            self.one("SELECT count(*) FROM pg_stats WHERE schemaname='core' AND tablename='player_match_stats' AND inherited")[0], 10
        )

    def _in_one_transaction(self):
        """A connection whose single transaction is rolled back: now() stays put and nothing is kept."""
        return psycopg.connect(DSN)

    def test_z_cohort_queue_has_a_maximum_wait(self):
        """FAILURE_MODES §18 (VI-26): due at the earlier of 10 minutes after the last mark and 60 minutes
        after the first mark not yet refreshed."""
        conn = self._in_one_transaction()
        real_refresh, real_index = models.refresh_cohort, models.refresh_player_index
        refreshed, remark = [], set()

        def refresh(c, cohort):
            refreshed.append(cohort)
            if cohort in remark:  # marked again while it is refreshed (§18e)
                models.mark_cohort(c, cohort)
            return {"season": 2025}

        models.refresh_cohort, models.refresh_player_index = refresh, lambda c, season: None
        try:
            x = conn.execute
            one = lambda sql, *a: x(sql, a).fetchone()
            team, europe = self.cohort("team:2025:cs:1"), self.cohort("team:2025:europe")
            self.assertEqual(
                one("""SELECT is_nullable, column_default FROM information_schema.columns
                       WHERE table_schema='ops' AND table_name='dirty_scopes' AND column_name='first_queued_at'"""),
                ("NO", "now()"),
            )
            x("DELETE FROM ops.dirty_scopes WHERE scope_kind='cohort'")

            def queue(cohort, first_minutes_ago, last_minutes_ago):
                x("DELETE FROM ops.dirty_scopes WHERE scope_kind='cohort' AND cohort_id=%s", (cohort,))
                x("""INSERT INTO ops.dirty_scopes(scope_kind, cohort_id, first_queued_at, queued_at)
                     VALUES ('cohort', %s, now() - make_interval(mins => %s), now() - make_interval(mins => %s))""",
                  (cohort, first_minutes_ago, last_minutes_ago))

            def run(**kw):
                refreshed.clear()
                models.process_cohorts(conn, **kw)
                return list(refreshed)

            queued = lambda cohort: one("SELECT count(*) FROM ops.dirty_scopes WHERE scope_kind='cohort' AND cohort_id=%s", cohort)[0]
            queue(team, 5, 5)
            self.assertEqual(run(), [])  # 18a: the debounce is kept
            queue(team, 11, 11)
            self.assertEqual(run(), [team])  # 18b
            self.assertEqual(queued(team), 0)  # 18f
            queue(team, 61, 1)
            self.assertEqual(run(), [team])  # 18c: starving, refreshed at the maximum wait
            queue(team, 30, 1)
            self.assertEqual(run(), [])  # 18d: within the maximum wait
            queue(team, 61, 1)
            remark.add(team)
            self.assertEqual(run(), [team])  # 18e: forced, and marked again during its refresh
            remark.clear()
            self.assertEqual(
                one("SELECT first_queued_at = now(), queued_at = now(), revision FROM ops.dirty_scopes WHERE scope_kind='cohort' AND cohort_id=%s", team),
                (True, True, 2),
            )  # stays queued, its wait starting again from the claim
            self.assertEqual(run(), [])  # not on every pass
            x("""UPDATE ops.dirty_scopes SET first_queued_at = first_queued_at - interval '61 minutes',
                   queued_at = queued_at - interval '1 minute' WHERE scope_kind='cohort' AND cohort_id=%s""", (team,))
            self.assertEqual(run(), [team])  # an hour after the claim, once more
            queue(team, 70, 1)  # due 10 minutes ago (maximum wait)
            queue(europe, 15, 15)  # due 5 minutes ago (debounce)
            self.assertEqual((run(limit=1), run(limit=1)), ([team], [europe]))  # 18g: oldest due first
            queue(team, 0, 0)
            self.assertEqual(run(min_age_seconds=0), [team])  # 18h
            # 18k and the mark itself: a new row has both times now(); a mark again keeps the first.
            models.mark_cohort(conn, team)
            self.assertEqual(one("SELECT first_queued_at = now(), queued_at = now(), revision FROM ops.dirty_scopes WHERE scope_kind='cohort' AND cohort_id=%s", team), (True, True, 1))
            x("UPDATE ops.dirty_scopes SET first_queued_at = now() - interval '30 minutes', queued_at = now() - interval '30 minutes' WHERE scope_kind='cohort'")
            cohorts = models.mark_cohorts(conn, 1)
            self.assertIn(team, cohorts)
            self.assertEqual(
                one("""SELECT count(*) FILTER (WHERE first_queued_at = now() - interval '30 minutes' AND queued_at = now() AND revision = 2),
                              count(*) FILTER (WHERE first_queued_at = now() AND queued_at = now() AND revision = 1), count(*)
                       FROM ops.dirty_scopes WHERE scope_kind='cohort'"""),
                (1, len(cohorts) - 1, len(cohorts)),
            )
        finally:
            models.refresh_cohort, models.refresh_player_index = real_refresh, real_index
            conn.rollback()
            conn.close()

    def test_z_cohort_re_marked_every_minute_is_still_refreshed(self):
        """FAILURE_MODES §18, end to end with the real refresh: over 70 simulated minutes one club
        cohort is marked every minute, the Europe cohort once; the first is refreshed at minute 60,
        once, and stays queued after its last mark; the second at minute 10."""
        conn = self._in_one_transaction()
        real_refresh = models.refresh_cohort
        timeline = []
        minute = [0]

        def refresh(c, cohort):
            timeline.append((minute[0], cohort))
            return real_refresh(c, cohort)

        models.refresh_cohort = refresh
        try:
            x = conn.execute
            team, europe = self.cohort("team:2025:cs:1"), self.cohort("team:2025:europe")
            before = dict(x("SELECT id, calc_run_id FROM agg.cohorts WHERE id = ANY(%s)", ([team, europe],)).fetchall())
            x("DELETE FROM ops.dirty_scopes WHERE scope_kind='cohort'")
            models.mark_cohort(conn, europe)
            for m in range(70):
                minute[0] = m
                if m:  # one simulated minute passes for every queued cohort
                    x("""UPDATE ops.dirty_scopes SET queued_at = queued_at - interval '1 minute',
                           first_queued_at = first_queued_at - interval '1 minute' WHERE scope_kind='cohort'""")
                models.mark_cohort(conn, team)
                models.process_cohorts(conn)
            self.assertEqual(timeline, [(10, europe), (60, team)], timeline)
            after = dict(x("SELECT id, calc_run_id FROM agg.cohorts WHERE id = ANY(%s)", ([team, europe],)).fetchall())
            self.assertNotEqual(after[team], before[team])
            self.assertNotEqual(after[europe], before[europe])
            self.assertEqual(
                x("SELECT revision, now() - first_queued_at FROM ops.dirty_scopes WHERE scope_kind='cohort' AND cohort_id=%s", (team,)).fetchone(),
                (9, timedelta(minutes=8)),
            )  # marked at minutes 61 to 69: queued since minute 61
            self.assertEqual(x("SELECT count(*) FROM ops.dirty_scopes WHERE scope_kind='cohort'").fetchone()[0], 1)
        finally:
            models.refresh_cohort = real_refresh
            conn.rollback()
            conn.close()

    def test_z_incremental_cohort_refresh(self):
        from vega.calculator import process_dirty

        self.db.execute("UPDATE core.matches SET home_score = home_score + 3 WHERE id = 1")
        self.db.execute("INSERT INTO ops.dirty_scopes(scope_kind, competition_season_id) VALUES ('competition_season', 1)")
        before = self.one("SELECT percentile FROM agg.team_percentiles WHERE cohort_id=%s AND team_id=1 AND metric_key='goals_for_pm'", self.cohort("team:2025:cs:1"))[0]
        process_dirty(self.db)
        self.assertEqual(models.process_cohorts(self.db, min_age_seconds=3600), 0)  # debounced
        self.assertEqual(models.process_cohorts(self.db, min_age_seconds=0), 10)
        after = self.one("SELECT percentile FROM agg.team_percentiles WHERE cohort_id=%s AND team_id=1 AND metric_key='goals_for_pm'", self.cohort("team:2025:cs:1"))[0]
        self.assertGreaterEqual(after, before)
        self.assertEqual(self.one("SELECT count(*) FROM ops.dirty_scopes")[0], 0)
        self.assertEqual(self.one("SELECT count(*) FROM ops.resource_versions WHERE resource_kind='cohort'")[0], 10)
        self.db.execute("UPDATE core.matches SET home_score = home_score - 3 WHERE id = 1")

    def test_zz_the_player_ranking_computes_with_no_transaction_open(self):
        """The base ends a session that stays idle inside a transaction (60 s in production).
        A large season's references take longer than that to fit: the ranking must not hold
        a transaction while it computes."""
        import time
        from vega import power

        before = self.db.execute(
            "SELECT player_id, score, rank FROM agg.player_power WHERE season_id=2025 ORDER BY player_id"
        ).fetchall()
        fit = power.references

        def slow(rows):
            time.sleep(1.2)
            return fit(rows)

        self.db.execute("SET idle_in_transaction_session_timeout = '400ms'")
        power.references = slow
        try:
            power.refresh_players(self.db, 2025)
        finally:
            power.references = fit
            self.db.execute("RESET idle_in_transaction_session_timeout")
        after = self.db.execute(
            "SELECT player_id, score, rank FROM agg.player_power WHERE season_id=2025 ORDER BY player_id"
        ).fetchall()
        self.assertEqual(after, before)
        self.assertTrue(after)
        self.assertEqual(
            self.one("SELECT count(*) FROM agg.power_runs WHERE kind='players' AND season_id=2025 AND status='published'")[0], 1
        )
        # The run's times are its real ones: from before the read to after the write (the
        # fit alone slept 1.2 s), and no published run of any model reads as instantaneous.
        self.assertGreater(
            self.one("SELECT extract(epoch FROM finished_at - started_at) FROM agg.power_runs WHERE kind='players' AND season_id=2025 AND status='published'")[0],
            1.2,
        )
        self.assertEqual(self.one("SELECT count(*) FROM agg.power_runs WHERE status='published' AND finished_at <= started_at")[0], 0)
        self.assertEqual(self.one("SELECT count(*) FROM agg.calc_runs WHERE status='published' AND finished_at <= started_at")[0], 0)

    def test_zzzzz_every_shot_is_given_vega_expected_goals(self):
        # 080: xg.refresh, on shots written here (the seed has too few to fit a model).
        from vega import xg

        x = self.db.execute
        matches = [m for (m,) in x("SELECT id FROM core.matches WHERE season_id=2025 AND status='finished' ORDER BY id LIMIT 40").fetchall()]

        def write(first, count):
            # Shots from 1 to 30 metres, one in five a header, one in ninety-seven a penalty;
            # the closer the shot, the more often it is a goal.
            x("""INSERT INTO core.shots(season_id, match_id, shot_no, x, y, outcome, situation, body_part, is_own_goal)
                 SELECT 2025, (%(matches)s::int[])[1 + mod(g, %(n)s)], 1000 + g / %(n)s, 105 - (1 + mod(g, 30)), 34 + (mod(g, 7) - 3) * 3,
                   (CASE WHEN mod(g, 97) = 0 THEN (CASE WHEN mod(g, 4) = 0 THEN 'miss' ELSE 'goal' END)
                         WHEN mod(g * 7919, 1000) / 1000.0 < exp(-(1 + mod(g, 30)) / 8.0) THEN 'goal' ELSE 'miss' END)::core.shot_outcome,
                   (CASE WHEN mod(g, 97) = 0 THEN 'penalty' ELSE (ARRAY['regular_play','from_corner','set_piece','fast_break','free_kick','throw_in_set_piece','individual_play'])[1 + mod(g, 7)] END)::core.shot_situation,
                   (CASE WHEN mod(g, 5) = 0 THEN 'header' WHEN mod(g, 211) = 0 THEN 'other' ELSE 'right_foot' END)::core.body_part, false
                 FROM generate_series(%(first)s, %(first)s + %(count)s - 1) g""", {"matches": matches, "n": len(matches), "first": first, "count": count})

        self.assertEqual(xg.refresh(self.db, 2025), 0)  # below the minimum: no model, no value
        self.assertEqual(self.one("SELECT count(*) FROM agg.xg_models")[0], 0)
        write(0, 6000)
        x("INSERT INTO core.shots(season_id, match_id, shot_no, x, y, outcome, is_own_goal) VALUES (2025, %s, 900, 100, 34, 'goal', true), (2025, %s, 901, 130, 34, 'miss', false)", (matches[0], matches[0]))
        minimum, xg.MIN_FIT = xg.MIN_FIT, 1000
        try:
            readable = "is_own_goal IS NOT TRUE AND outcome IS NOT NULL AND x BETWEEN 0 AND 105 AND y BETWEEN 0 AND 68"
            held = self.one(f"SELECT count(*) FROM core.shots WHERE season_id=2025 AND {readable}")[0]
            self.assertEqual(xg.refresh(self.db, 2025), held)
            model, shots, penalty = self.one("SELECT id, shots, penalty FROM agg.xg_models")
            self.assertEqual(shots, self.one(f"SELECT count(*) FROM core.shots WHERE {readable} AND situation IS DISTINCT FROM 'penalty'")[0])
            # An own goal and a shot placed outside the pitch have no value.
            self.assertEqual(self.one("SELECT count(*) FROM agg.shot_xg WHERE shot_no IN (900, 901)")[0], 0)
            low, high = self.one("SELECT min(xg), max(xg) FROM agg.shot_xg")
            self.assertTrue(0 < low < high < 1)
            near, far = self.one("""SELECT avg(v.xg) FILTER (WHERE s.x >= 100), avg(v.xg) FILTER (WHERE s.x <= 85) FROM agg.shot_xg v
                                    JOIN core.shots s USING (season_id, match_id, shot_no) WHERE s.situation <> 'penalty' AND s.shot_no >= 1000""")
            self.assertGreater(near, 3 * far)
            # The values add up to the goals scored (the fit is on bins: within two per cent).
            total, goals = self.one("""SELECT sum(v.xg), count(*) FILTER (WHERE s.outcome = 'goal') FROM agg.shot_xg v
                                       JOIN core.shots s USING (season_id, match_id, shot_no) WHERE s.situation IS DISTINCT FROM 'penalty'""")
            self.assertLess(abs(total - goals) / goals, 0.02)
            # A penalty is worth the share of the base's penalties that were scored.
            taken, scored, value = self.one("""SELECT count(*), count(*) FILTER (WHERE s.outcome = 'goal'), min(v.xg) FROM agg.shot_xg v
                                               JOIN core.shots s USING (season_id, match_id, shot_no) WHERE s.situation = 'penalty'""")
            self.assertAlmostEqual(value, scored / taken, places=5)
            self.assertAlmostEqual(penalty, scored / taken, places=9)
            # The same base again: the same model, the season scored anew.
            self.assertEqual(xg.refresh(self.db, 2025), held)
            self.assertEqual(self.one("SELECT count(*), min(id) FROM agg.xg_models"), (1, model))
            # A base grown by more than a quarter: a new fit, every shot read by it, the old model gone.
            write(6000, 2400)
            self.assertEqual(xg.refresh(self.db, 2025), held + 2400)
            self.assertEqual(self.one("SELECT count(*) FROM agg.xg_models WHERE id <> %s", model)[0], 1)
            self.assertEqual(self.one("SELECT count(*) FROM agg.xg_models")[0], 1)
            self.assertEqual(self.one("SELECT count(DISTINCT model_id) FROM agg.shot_xg")[0], 1)
            # The match page's shots carry the value.
            self.assertEqual(self.one("SELECT count(*), count(vega_xg) FROM api.match_shot_rows WHERE season_id=2025 AND shot_no >= 1000"), (8400, 8400))
        finally:
            xg.MIN_FIT = minimum
            x("DELETE FROM agg.shot_xg")
            x("DELETE FROM agg.xg_models")
            x("DELETE FROM core.shots WHERE season_id=2025 AND shot_no >= 900")

    def test_zzzzzz_players_are_placed_on_the_axes_learnt_from_their_season(self):
        # 081: embedding.refresh, on season rows written here (two kinds of players, 240 of them).
        from vega import embedding

        x = self.db.execute
        stats = ["goals", "assists", "total_shots", "shots_on_target", "accurate_passes", "touches", "tackles", "interceptions",
                 "clearances", "recoveries", "duels_won", "duels_lost", "dribbles_succeeded", "chances_created"]
        # Per match: a forward shoots and dribbles, a defender tackles and clears; g varies each a little.
        forward = [0.5, 0.2, 3, 1.2, 20, 40, 0.5, 0.3, 0.2, 2, 3, 4, 2.5, 1.5]
        defender = [0.05, 0.05, 0.4, 0.1, 55, 70, 2.5, 2, 4.5, 6, 5, 3, 0.3, 0.3]
        values = ", ".join(f"round((CASE WHEN mod(g, 2) = 0 THEN {f} ELSE {d} END) * 20 * (0.85 + mod(g * {7 + i}, 30) / 100.0))::int, 1800"
                           for i, (f, d) in enumerate(zip(forward, defender)))
        columns = ", ".join(f"{key}_sum, {key}_min" for key in stats)
        x("INSERT INTO core.competitions(id, name) VALUES (990, 'Women''s Test League')")
        x("INSERT INTO core.competition_seasons(id, competition_id, season_id) VALUES (990, 990, 2025)")
        x("INSERT INTO core.players(id, name) SELECT 7000 + g, 'Synthetic ' || g FROM generate_series(1, 240) g")
        x(f"""INSERT INTO agg.player_season_stats(player_id, team_id, competition_season_id, season_id, appearances, starts, minutes, {columns})
              SELECT 7000 + g, 1, CASE WHEN g > 234 THEN 990 ELSE 1 END, 2025, 20, 20, CASE WHEN g = 1 THEN 300 ELSE 1800 END, {values}
              FROM generate_series(1, 240) g""")
        minimum, embedding.MIN_PLAYERS = embedding.MIN_PLAYERS, 100
        try:
            # A vector needs 90 % of the statistics kept measured (VI-23 B8): the league's own 88
            # players (the build above) measure 12 of the 14 (no assists, no shots on target) and
            # are not placed; the 239 synthetic players of 450 minutes or more measure all 14.
            held = self.one("SELECT count(*) FROM (SELECT player_id FROM agg.player_season_stats WHERE season_id=2025 AND player_id > 7000 GROUP BY 1 HAVING sum(minutes) >= 450) q")[0]
            self.assertEqual(held, 239)
            self.assertEqual(embedding.refresh(self.db, 2025), held)
            self.assertEqual(self.one("SELECT count(*) FROM agg.player_embeddings WHERE season_id=2025 AND player_id < 7000")[0], 0)
            version, players, kept, share = self.one("SELECT version, players, statistics, variance_kept FROM agg.embedding_models WHERE season_id=2025")
            self.assertEqual((version, players), (embedding.MODEL_VERSION, held))
            self.assertTrue(kept >= embedding.DIMENSIONS and 0 < share <= 1)
            # The player short of minutes has no vector; those of the women's competition are marked.
            self.assertEqual(self.one("SELECT count(*) FROM agg.player_embeddings WHERE player_id = 7001")[0], 0)
            self.assertEqual([r[0] for r in x("SELECT player_id FROM agg.player_embeddings WHERE women ORDER BY 1").fetchall()], list(range(7235, 7241)))
            # A forward's nearest players are forwards (even numbers), a defender's are defenders.
            for player in (7010, 7011):
                near = x("""SELECT o.player_key FROM api.player_embedding_vectors o, api.player_embedding_vectors me
                            WHERE me.season_id = 2025 AND me.player_key = %s AND o.season_id = 2025 AND o.player_key <> me.player_key AND o.player_key > 7000
                            ORDER BY power(o.e1-me.e1,2)+power(o.e2-me.e2,2)+power(o.e3-me.e3,2)+power(o.e4-me.e4,2)+power(o.e5-me.e5,2)
                                   + power(o.e6-me.e6,2)+power(o.e7-me.e7,2)+power(o.e8-me.e8,2)+power(o.e9-me.e9,2)+power(o.e10-me.e10,2) LIMIT 10""", (player,)).fetchall()
                self.assertTrue(all(o % 2 == player % 2 for (o,) in near), near)
            self.assertEqual(self.one("SELECT name, minutes FROM api.player_embedding_people WHERE season_id=2025 AND player_key=7010"), ("Synthetic 10", 1800))
            self.assertEqual(self.one("SELECT players FROM api.embedding_models WHERE season_id=2025")[0], held)
            # A second pass gives the same vectors.
            before = x("SELECT player_id, e1, e5, e10 FROM agg.player_embeddings WHERE season_id=2025 ORDER BY 1").fetchall()
            self.assertEqual(embedding.refresh(self.db, 2025), held)
            self.assertEqual(x("SELECT player_id, e1, e5, e10 FROM agg.player_embeddings WHERE season_id=2025 ORDER BY 1").fetchall(), before)
            # Too few players for axes to be learnt: the season keeps no vector.
            embedding.MIN_PLAYERS = held + 1
            self.assertEqual(embedding.refresh(self.db, 2025), 0)
            self.assertEqual(self.one("SELECT (SELECT count(*) FROM agg.player_embeddings), (SELECT count(*) FROM agg.embedding_models)"), (0, 0))
        finally:
            embedding.MIN_PLAYERS = minimum
            x("DELETE FROM agg.player_embeddings")
            x("DELETE FROM agg.embedding_models")
            x("DELETE FROM agg.player_season_stats WHERE player_id > 7000")
            x("DELETE FROM core.players WHERE id > 7000")
            x("DELETE FROM core.competition_seasons WHERE id = 990")
            x("DELETE FROM core.competitions WHERE id = 990")

    def test_zzzzzzz_a_clubs_changes_and_its_substitutes_are_read_per_match(self):
        # 082: the two views behind /api/teams/{id}/substitutions, on events written here.
        x = self.db.execute
        match, home, away, hs, as_ = self.one("""SELECT id, home_team_id, away_team_id, home_score, away_score FROM core.matches
                                               WHERE season_id=2025 AND status='finished' AND home_score = 2 AND away_score = 1 ORDER BY id LIMIT 1""")
        x("INSERT INTO core.players(id, name) VALUES (7900, 'Joker Test')")
        try:
            # The running score on a goal event is not read (the source writes it before the goal in some
            # matches, after it in others): the goals are counted by the team they are credited to.
            # 1-0, the home side changes (leading); 1-1, the away side changes (level); 2-1 at the end.
            x("DELETE FROM core.match_events WHERE season_id=2025 AND match_id=%s AND event_type IN ('goal', 'substitution')", (match,))
            x("""INSERT INTO core.match_events(season_id, match_id, team_id, seq, event_type, minute, score_home, score_away) VALUES
                 (2025, %(m)s, %(h)s, 501, 'goal', 20, 0, 0), (2025, %(m)s, %(h)s, 502, 'substitution', 58, NULL, NULL),
                 (2025, %(m)s, %(a)s, 503, 'goal', 61, 1, 1), (2025, %(m)s, %(a)s, 504, 'substitution', 66, NULL, NULL),
                 (2025, %(m)s, %(h)s, 505, 'substitution', 70, NULL, NULL), (2025, %(m)s, %(h)s, 506, 'goal', 88, NULL, NULL)""", {"m": match, "h": home, "a": away})
            x("INSERT INTO core.lineup_players(season_id, match_id, team_id, player_id, is_starter) VALUES (2025, %s, %s, 7900, false)", (match, home))
            x("INSERT INTO core.player_match_stats(season_id, match_id, team_id, player_id, minutes_played, goals, assists) VALUES (2025, %s, %s, 7900, 32, 1, 0)", (match, home))
            rows = x("""SELECT team_key, change_minute, goals_for_then, goals_against_then, goals_for, goals_against, complete
                        FROM api.team_change_matches WHERE season_id=2025 AND match_key=%s ORDER BY change_minute""", (match,)).fetchall()
            self.assertEqual(rows, [(home, 58, 1, 0, 2, 1, True), (away, 66, 1, 1, 1, 2, True)])
            self.assertEqual(x("SELECT team_key, player_key, minutes, goals, assists FROM api.team_substitute_matches WHERE season_id=2025 AND player_key=7900").fetchall(),
                             [(home, 7900, 32, 1, 0)])
            # A timeline short of a goal is marked incomplete.
            x("DELETE FROM core.match_events WHERE season_id=2025 AND match_id=%s AND seq=506", (match,))
            self.assertEqual([r[0] for r in x("SELECT complete FROM api.team_change_matches WHERE season_id=2025 AND match_key=%s", (match,)).fetchall()], [False, False])
        finally:
            x("DELETE FROM core.match_events WHERE season_id=2025 AND match_id=%s AND seq >= 500", (match,))
            x("DELETE FROM core.player_match_stats WHERE player_id=7900")
            x("DELETE FROM core.lineup_players WHERE player_id=7900")
            x("DELETE FROM core.players WHERE id=7900")

    def test_zzzzzzzz_the_in_play_model_is_fitted_on_the_matches_whose_goals_give_the_score(self):
        # 086: inplay.refresh, on goal events written here for the seed's finished club matches.
        from vega import inplay

        x = self.db.execute
        x("DELETE FROM core.match_events WHERE season_id=2025 AND event_type IN ('goal', 'red_card')")
        matches = x("""SELECT m.id, m.home_team_id, m.away_team_id, m.home_score, m.away_score FROM core.matches m
                       JOIN agg.team_elo e ON e.match_id = m.id AND e.team_id = m.home_team_id
                       JOIN core.teams t ON t.id = m.home_team_id AND t.is_national IS NOT TRUE
                       WHERE m.season_id=2025 AND m.status='finished' ORDER BY m.id""").fetchall()
        goals = 0
        for index, (match, home, away, hs, as_) in enumerate(matches):
            if index == 0:
                continue  # a match without its goal events: left out of the fit when it has goals
            for k in range(hs):
                x("INSERT INTO core.match_events(season_id, match_id, team_id, seq, event_type, minute, minute_added) VALUES (2025,%s,%s,%s,'goal',%s,0)", (match, home, 600 + k, 5 + 17 * k))
            for k in range(as_):
                x("INSERT INTO core.match_events(season_id, match_id, team_id, seq, event_type, minute, minute_added) VALUES (2025,%s,%s,%s,'goal',%s,%s)", (match, away, 650 + k, 90 if k == 2 else 40 + 20 * k, 3 if k == 2 else 0))
            goals += hs + as_
        first = matches[0]
        model = x("""INSERT INTO agg.forecast_models(version,matches,home_base,home_slope,away_base,away_slope,rho,strength_spread,simulations)
                     VALUES ('forecast-v1',1000,0.3,0.9,0.1,0.9,-0.03,90,1000) RETURNING id""").fetchone()[0]
        minimum, inplay.MIN_FIT = inplay.MIN_FIT, 20
        try:
            fitted = len(matches) - (1 if first[3] + first[4] > 0 else 0)
            self.assertEqual(inplay.refresh(self.db), fitted)
            row = self.one("SELECT version, matches, goals, red_matches, q1 + q2 + q3 + q4 + q5 + q6 + after_90, down, up FROM agg.inplay_models")
            self.assertEqual(row[:4], (inplay.MODEL_VERSION, fitted, goals, 0))
            self.assertAlmostEqual(row[4], 1.0, places=9)
            self.assertEqual(row[5:], (1.0, 1.0))  # no dismissal in the base: none assumed to matter
            # Too few matches with a side ahead to say what the score changes: the two factors stay at 1 (version 2).
            self.assertEqual(self.one("SELECT ahead, behind, state_matches FROM agg.inplay_models"), (1.0, 1.0, fitted))
            # A second pass keeps one model, and the two factors as they were found: the base has not grown.
            searched = []
            search, inplay.fit_state = inplay.fit_state, lambda *args: searched.append(1) or (0.9, 1.2)
            try:
                self.assertEqual(inplay.refresh(self.db), fitted)
                self.assertEqual((searched, self.one("SELECT ahead, behind FROM api.inplay_models")), ([], (1.0, 1.0)))
                x("UPDATE agg.inplay_models SET state_matches = 1")
                self.assertEqual(inplay.refresh(self.db), fitted)
                self.assertEqual((searched, self.one("SELECT ahead, behind, state_matches FROM agg.inplay_models")), ([1], (0.9, 1.2, fitted)))
            finally:
                inplay.fit_state = search
            self.assertEqual(self.one("SELECT count(*) FROM api.inplay_models")[0], 1)
            self.assertEqual(self.one("SELECT count(*) FROM api.forecast_models WHERE id=%s", model)[0], 1)
            played = matches[1]
            status, home_elo, away_elo = self.one("SELECT status, home_elo, away_elo FROM api.match_strengths WHERE match_key=%s", played[0])
            self.assertEqual(status, "finished")
            self.assertTrue(home_elo > 0 and away_elo > 0)
            sides = x("SELECT kind, side FROM api.match_inplay_events WHERE season_id=2025 AND match_key=%s ORDER BY seq", (played[0],)).fetchall()
            self.assertEqual((sum(1 for k, s_ in sides if s_ == "home"), sum(1 for k, s_ in sides if s_ == "away")), (played[3], played[4]))
            # A match not rated yet takes each side's strength after its last rated match.
            x("""INSERT INTO core.matches(id,competition_season_id,season_id,source,status,home_team_id,away_team_id,match_date)
                 VALUES (9300,1,2025,'pitchapi','in_play',%s,%s,'2026-05-25')""", (played[1], played[2]))
            live = self.one("SELECT status, home_elo, away_elo FROM api.match_strengths WHERE match_key=9300")
            self.assertEqual(live[0], "in_play")
            self.assertTrue(live[1] > 0 and live[2] > 0)
            # Too few matches: nothing is fitted and the model in place stays.
            inplay.MIN_FIT = 10_000
            self.assertEqual(inplay.refresh(self.db), 0)
            self.assertEqual(self.one("SELECT count(*) FROM agg.inplay_models")[0], 1)
        finally:
            inplay.MIN_FIT = minimum
            x("DELETE FROM core.matches WHERE id=9300")
            x("DELETE FROM agg.inplay_models")
            x("DELETE FROM agg.forecast_models WHERE id=%s", (model,))
            x("DELETE FROM core.match_events WHERE season_id=2025 AND seq >= 600")

    def test_zzzzzzzzz_no_transaction_is_open_while_a_model_computes(self):
        # The base ends a session idle inside a transaction after 60 s, and these computations
        # take longer than that on a full season: each must run with no transaction open.
        from psycopg.pq import TransactionStatus
        from vega import embedding, inplay, xg

        x = self.db.execute
        seen = {}

        def spy(name, real):
            def wrapped(*args, **kwargs):
                seen[name] = self.db.info.transaction_status
                return real(*args, **kwargs)
            return wrapped

        model = x("""INSERT INTO agg.forecast_models(version,matches,home_base,home_slope,away_base,away_slope,rho,strength_spread,simulations)
                     VALUES ('forecast-v1',1000,0.3,0.9,0.1,0.9,-0.03,90,1000) RETURNING id""").fetchone()[0]
        originals = (embedding.embed, xg.fit, inplay.fit)
        embedding.embed, xg.fit, inplay.fit = spy("embedding", embedding.embed), spy("xg", xg.fit), spy("inplay", inplay.fit)
        try:
            embedding.refresh(self.db, 2025)
            xg.refresh(self.db, 2025)
            inplay.refresh(self.db)
        finally:
            embedding.embed, xg.fit, inplay.fit = originals
            x("DELETE FROM agg.forecast_models WHERE id=%s", (model,))
        self.assertEqual(sorted(seen), ["embedding", "inplay", "xg"])
        self.assertEqual(set(seen.values()), {TransactionStatus.IDLE})
        self.assertEqual(self.db.info.transaction_status, TransactionStatus.IDLE)

    def test_zzzzzzzzzz_a_return_from_absence_is_read_from_the_line_ups(self):
        # 087: returns.refresh, on a club playing every week and a player away for six of them.
        from datetime import date, timedelta
        from psycopg.pq import TransactionStatus
        from vega import returns

        x = self.db.execute
        start = date(2026, 1, 3)
        x("INSERT INTO core.teams(id, name) VALUES (9477, 'Club Hebdo'), (9478, 'Adversaire')")
        x("INSERT INTO core.players(id, name) VALUES (7960, 'Revenant Test'), (7961, 'Toujours Là')")
        for week in range(12):
            x("""INSERT INTO core.matches(id,competition_season_id,season_id,source,status,home_team_id,away_team_id,home_score,away_score,match_date)
                 VALUES (%s,1,2025,'pitchapi','finished',9477,9478,1,0,%s)""", (9400 + week, start + timedelta(days=7 * week)))
            x("INSERT INTO core.player_match_stats(season_id,match_id,team_id,player_id,minutes_played) VALUES (2025,%s,9477,7961,90)", (9400 + week,))
            if week < 5 or week >= 10:
                x("INSERT INTO core.player_match_stats(season_id,match_id,team_id,player_id,minutes_played) VALUES (2025,%s,9477,7960,%s)",
                  (9400 + week, 80 if week < 5 else 30 if week == 10 else 50))
        today = start + timedelta(days=7 * 11 + 2)
        seen = []
        original, minimum = returns.curve, returns.MIN_RETURNS

        def spy(*args, **kwargs):
            seen.append(self.db.info.transaction_status)
            return original(*args, **kwargs)

        returns.curve, returns.MIN_RETURNS = spy, 1
        try:
            self.assertEqual(returns.refresh(self.db, today), (2, 1))
            self.assertEqual(seen, [TransactionStatus.IDLE])  # the appearances are gone through with no transaction open
            self.assertEqual(x("SELECT bucket, match_no, returns, minutes, usual_minutes, version FROM agg.return_curves ORDER BY 2").fetchall(),
                             [("30_59", 1, 1, 30.0, 80.0, returns.MODEL_VERSION), ("30_59", 2, 1, 50.0, 80.0, returns.MODEL_VERSION)])
            self.assertEqual(self.one("""SELECT player_id, team_id, absent_from, returned_on, days, matches_missed, matches_back, bucket, usual_minutes, minutes_back
                                         FROM agg.player_returns"""),
                             (7960, 9477, start + timedelta(days=28), start + timedelta(days=70), 42, 5, 2, "30_59", 80.0, 40.0))
            self.assertEqual(self.one("SELECT team, days, matches_back, usual_minutes FROM api.player_returns WHERE player_key=7960"), ("Club Hebdo", 42, 2, 80.0))
            self.assertEqual(self.one("SELECT count(*) FROM api.return_curves")[0], 2)
            # Four months later nobody is coming back any more; the curve stays.
            self.assertEqual(returns.refresh(self.db, today + timedelta(days=120)), (2, 0))
            self.assertEqual(self.one("SELECT count(*) FROM agg.player_returns")[0], 0)
        finally:
            returns.curve, returns.MIN_RETURNS = original, minimum
            x("DELETE FROM agg.player_returns")
            x("DELETE FROM agg.return_curves")
            x("DELETE FROM core.player_match_stats WHERE player_id IN (7960, 7961)")
            x("DELETE FROM core.matches WHERE id BETWEEN 9400 AND 9411")
            x("DELETE FROM core.players WHERE id IN (7960, 7961)")
            x("DELETE FROM core.teams WHERE id IN (9477, 9478)")

    def test_zzzzzzzzzzz_players_below_the_rankings_minutes_who_play_like_its_regulars_are_flagged(self):
        # 088: breakout.refresh, on ranking rows written here under a role of their own.
        from vega import breakout
        from vega.store import Store

        x = self.db.execute
        with self.db.transaction():
            Store(self.db).season("2024/2025")
        run = x("INSERT INTO agg.power_runs(kind, season_id, method_version, status) VALUES ('players', 2025, 'test', 'published') RETURNING id").fetchone()[0]
        x("INSERT INTO core.players(id, name) SELECT 7700 + g, 'Régulier ' || g FROM generate_series(1, 40) g")
        x("""INSERT INTO core.players(id, name, birth_date) VALUES (7751, 'Révélation', '2004-03-03'), (7752, 'Moyen', '2005-01-01'), (7753, 'Trop peu', '2005-01-01'),
             (7754, 'Ancien titulaire', '2004-01-01'), (7755, 'Vétéran', '1990-05-05'), (7756, 'Jeune', '2006-09-09'), (7757, 'Hors échelle', '2005-01-01'),
             (7758, 'Âge inconnu', NULL), (7759, 'Vingt-trois ans', '2002-07-31')""")
        row = "INSERT INTO agg.player_power(season_id, player_id, role, team_id, matches, minutes, total, rate, eligible, linked, run_id) "
        # Forty regulars of the role, their rates from 0.00 to 0.39: the top fifth starts at 0.312.
        x(row + "SELECT 2025, 7700 + g, 'test_role', 1, 30, 2400, 1, (g - 1) / 100.0, true, true, %s FROM generate_series(1, 40) g", (run,))
        x(row + """VALUES (2025, 7751, 'test_role', 1, 8, 600, 1, 0.36, false, true, %(r)s), (2025, 7752, 'test_role', 1, 8, 600, 1, 0.20, false, true, %(r)s),
                          (2025, 7753, 'test_role', 1, 3, 200, 1, 0.38, false, true, %(r)s), (2025, 7754, 'test_role', 1, 8, 600, 1, 0.39, false, true, %(r)s),
                          (2025, 7755, 'test_role', 1, 8, 600, 1, 0.37, false, true, %(r)s), (2025, 7756, 'test_role', 1, 8, 500, 1, 0.35, false, true, %(r)s),
                          (2025, 7757, 'test_role', 1, 8, 600, 1, 0.39, false, false, %(r)s), (2024, 7754, 'test_role', 1, 30, 2500, 1, 0.30, true, true, %(r)s),
                          (2025, 7758, 'test_role', 1, 8, 600, 1, 0.39, false, true, %(r)s), (2025, 7759, 'test_role', 1, 8, 600, 1, 0.39, false, true, %(r)s)""", {"r": run})
        try:
            candidates, flagged = breakout.refresh(self.db, 2025)
            self.assertEqual(flagged, 2)
            self.assertGreaterEqual(candidates, 5)
            # Too low a rate, too few minutes, a regular of an earlier season, a league off the scale, an age unknown,
            # 23 on the first of August or older: not flagged.
            rows = x("SELECT player_id, rank, minutes, percentile, regulars FROM agg.player_breakouts WHERE season_id=2025 ORDER BY rank").fetchall()
            self.assertEqual(rows, [(7751, 1, 600, 90.0, 40), (7756, 2, 500, 87.5, 40)])
            self.assertEqual(self.one("SELECT version, candidates, flagged FROM agg.breakout_runs WHERE season_id=2025"), (breakout.MODEL_VERSION, candidates, 2))
            self.assertEqual(self.one("SELECT name, role, percentile FROM api.player_breakouts WHERE season_id=2025 AND player_key=7751"), ("Révélation", "test_role", 90.0))
            # A second pass replaces the first; a season without anyone to flag still records its run.
            self.assertEqual(breakout.refresh(self.db, 2025), (candidates, 2))
            self.assertEqual(self.one("SELECT count(*) FROM agg.player_breakouts WHERE season_id=2025")[0], 2)
            self.assertEqual(breakout.refresh(self.db, 2024), (0, 0))
            self.assertEqual(self.one("SELECT flagged FROM api.breakout_runs WHERE season_id=2024")[0], 0)
        finally:
            x("DELETE FROM agg.player_breakouts")
            x("DELETE FROM agg.breakout_runs")
            x("DELETE FROM agg.player_power WHERE run_id=%s", (run,))
            x("DELETE FROM agg.power_runs WHERE id=%s", (run,))
            x("DELETE FROM core.players WHERE id BETWEEN 7701 AND 7759")

    def test_zzzzzzzzzzzz_action_values_are_read_per_90_of_a_league_and_placed_among_the_role(self):
        # 089: actions.refresh, on season rows and ranking roles written here.
        from vega import actions
        from vega.store import Store

        x = self.db.execute
        with self.db.transaction():
            Store(self.db).season("2024/2025")
        run = x("INSERT INTO agg.power_runs(kind, season_id, method_version, status) VALUES ('players', 2025, 'test', 'published') RETURNING id").fetchone()[0]
        # Collected competitions carry no kind: a league is one the ranking gives a level to.
        x("INSERT INTO core.competitions(id, name) VALUES (9500, 'Ligue des valeurs'), (9501, 'Coupe des valeurs'), (9502, 'Autre ligue')")
        x("INSERT INTO agg.league_levels(competition_id, entry_level, level, teams, links, linked, run_id) VALUES (9500, 1500, 1500, 20, 0, false, %s), (9502, 1500, 1500, 20, 0, false, %s)", (run, run))
        x("INSERT INTO core.competition_seasons(id, competition_id, season_id) VALUES (9500, 9500, 2025), (9501, 9501, 2025), (9502, 9502, 2025)")
        x("INSERT INTO core.teams(id, name) VALUES (9500, 'Club A'), (9501, 'Club B')")
        x("INSERT INTO core.players(id, name) SELECT 7800 + g, 'Pair ' || g FROM generate_series(1, 37) g")
        names = [f"adv_{key}" for key in ("vaep_total", "vaep_offensive", "vaep_defensive", "pv_total", "pv_offensive", "pv_defensive", "xt_total")]
        columns = ", ".join(f"{name}_sum, {name}_min" for name in names)
        insert = f"INSERT INTO agg.player_season_stats(player_id, team_id, competition_season_id, season_id, appearances, starts, minutes, {columns}) "

        def row(player, team, edition, minutes, vaep, pv, xt=2):
            # Offensive part 1.5 times the total, defensive part its remainder.
            values = (vaep, vaep * 1.5, -vaep * 0.5, pv, pv, 0, xt)
            x(insert + f"VALUES (%s, %s, %s, 2025, 10, 10, %s, {', '.join(['%s, %s'] * 7)})",
              (player, team, edition, minutes, *(v for value in values for v in (value, minutes))))

        # Twenty players of a role in the league: VAEP rising with g, PV falling, xT the same for all.
        for g in range(2, 21):
            row(7800 + g, 9500, 9500, 900, g, 21 - g)
        # The first of them played for two clubs of the league: his two halves are read as one.
        row(7801, 9500, 9500, 450, 0.5, 10, 1)
        row(7801, 9501, 9500, 450, 0.5, 10, 1)
        row(7831, 9500, 9500, 900, 30, 30)  # a goalkeeper
        row(7832, 9500, 9500, 400, 30, 30)  # under the minutes
        row(7833, 9500, 9501, 900, 30, 30)  # a competition without a level is no league
        row(7834, 9500, 9502, 900, 3, 3)  # alone of his role in his league
        row(7835, 9500, 9500, 500, 30, 30)  # more minutes in the other league: read there, not here
        row(7835, 9501, 9502, 1000, 5, 5)
        row(7836, 9500, 9500, 900, 30, 30)  # no role in the ranking
        x(insert.replace(f", {columns}", "") + "VALUES (7837, 9500, 9500, 2025, 10, 10, 900)")  # nothing measured
        power = "INSERT INTO agg.player_power(season_id, player_id, role, team_id, matches, minutes, total, rate, eligible, linked, run_id) "
        x(power + "SELECT 2025, 7800 + g, 'test_role', 9500, 10, 900, 1, 0.1, true, true, %s FROM generate_series(1, 35) g WHERE g <= 20 OR g BETWEEN 32 AND 35", (run,))
        x(power + "VALUES (2025, 7831, 'goalkeeper', 9500, 10, 900, 1, 0.1, true, true, %s), (2025, 7837, 'test_role', 9500, 10, 900, 1, 0.1, true, true, %s)", (run, run))
        # The season's pass has read it already (models.refresh_daily): start from a season never read.
        x("DELETE FROM agg.player_action_values WHERE season_id=2025")
        x("DELETE FROM agg.action_value_runs WHERE season_id=2025")
        try:
            self.assertEqual(actions.pending(self.db), [2025])
            self.assertEqual(actions.refresh(self.db, 2025), (22, 20))
            read = lambda player: self.one(
                """SELECT competition_id, role, minutes, vaep, vaep_offensive, vaep_defensive, pv, xt, peers, vaep_rank, vaep_percentile,
                          pv_rank, pv_percentile, xt_rank, xt_percentile FROM agg.player_action_values WHERE season_id=2025 AND player_id=%s""", player)
            near = lambda found, expected: [self.assertAlmostEqual(a, b, places=4) if isinstance(b, float) else self.assertEqual(a, b) for a, b in zip(found, expected, strict=True)]
            # The best VAEP of the twenty: rank 1, and 19 below him plus half of himself; the worst PV.
            near(read(7820), (9500, "test_role", 900, 2.0, 3.0, -1.0, 0.1, 0.2, 20, 1, 97.5, 20, 2.5, 1, 50.0))
            # Two clubs, one league: 1 over 900 minutes; the lowest VAEP, the highest PV.
            near(read(7801), (9500, "test_role", 900, 0.1, 0.15, -0.05, 2.0, 0.2, 20, 20, 2.5, 1, 97.5, 1, 50.0))
            # Too few players of his role in his league: his values, no place among them.
            near(read(7834), (9502, "test_role", 900, 0.3, 0.45, -0.15, 0.3, 0.2, 2, None, None, None, None, None, None))
            near(read(7835)[:4], (9502, "test_role", 1000, 0.45))
            # No goalkeeper, nobody under the minutes, in a cup only, without a role or without a measure.
            self.assertEqual(x("SELECT player_id FROM agg.player_action_values WHERE player_id IN (7831, 7832, 7833, 7836, 7837)").fetchall(), [])
            self.assertEqual(self.one("SELECT version, players, placed FROM agg.action_value_runs WHERE season_id=2025"), (actions.MODEL_VERSION, 22, 20))
            self.assertEqual(self.one("SELECT competition, role, peers, vaep_rank, version FROM api.player_action_values WHERE season_id=2025 AND player_key=7820"),
                             ("Ligue des valeurs", "test_role", 20, 1, actions.MODEL_VERSION))
            # Read once, a season is no longer waited for; a second pass replaces the first.
            self.assertEqual(actions.pending(self.db), [])
            self.assertEqual(actions.refresh(self.db, 2025), (22, 20))
            self.assertEqual(self.one("SELECT count(*) FROM agg.player_action_values WHERE season_id=2025")[0], 22)
            # A reading of another version is waited for again; a season whose only ranking was superseded never is.
            x("UPDATE agg.action_value_runs SET version='actions-v0'")
            with self.db.transaction():
                older = Store(self.db).season("2019/2020")
            x("INSERT INTO agg.power_runs(kind, season_id, method_version, status) VALUES ('players', %s, 'test-actions', 'superseded')", (older,))
            self.assertEqual(actions.pending(self.db), [2025])
        finally:
            x("DELETE FROM agg.power_runs WHERE method_version='test-actions'")
            x("DELETE FROM agg.player_action_values")
            x("DELETE FROM agg.action_value_runs")
            x("DELETE FROM agg.league_levels WHERE competition_id IN (9500, 9502)")
            x("DELETE FROM agg.player_power WHERE run_id=%s", (run,))
            x("DELETE FROM agg.power_runs WHERE id=%s", (run,))
            x("DELETE FROM agg.player_season_stats WHERE competition_season_id IN (9500, 9501, 9502)")
            x("DELETE FROM core.players WHERE id BETWEEN 7801 AND 7837")
            x("DELETE FROM core.teams WHERE id IN (9500, 9501)")
            x("DELETE FROM core.competition_seasons WHERE id IN (9500, 9501, 9502)")
            x("DELETE FROM core.competitions WHERE id IN (9500, 9501, 9502)")


    def test_zzzzzzzzzzzzz_the_worth_of_a_line_up_is_fitted_on_rates_known_before_each_match(self):
        # 090: lineup.refresh, on an award year written here: four clubs whose eleventh starter is a strong
        # player one match and a weak one the next, and who score more with the strong one.
        from datetime import date, datetime, timedelta, timezone

        from psycopg.pq import TransactionStatus

        from vega import lineup
        from vega.store import Store

        x = self.db.execute
        with self.db.transaction():
            year = Store(self.db).season("2031/2032")
        x("INSERT INTO core.competitions(id, name) VALUES (9600, 'Ligue des compositions')")
        x("INSERT INTO core.competition_seasons(id, competition_id, season_id) VALUES (9600, 9600, %s)", (year,))
        x("INSERT INTO core.teams(id, name) SELECT 9600 + g, 'Club ' || g FROM generate_series(1, 4) g")
        x("INSERT INTO core.players(id, name) SELECT 9700 + g, 'Joueur ' || g FROM generate_series(1, 48) g")
        elo = x("INSERT INTO agg.power_runs(kind, method_version, status) VALUES ('elo', 'test-lineup', 'published') RETURNING id").fetchone()[0]
        run = x("""INSERT INTO agg.power_runs(kind, season_id, method_version, status, players, finished_at)
                   VALUES ('players', %s, 'test-lineup', 'published', 48, now() - interval '1 hour') RETURNING id""", (year,)).fetchone()[0]
        x("INSERT INTO agg.league_levels(competition_id, entry_level, level, teams, links, linked, run_id) VALUES (9600, 1500, 1500, 4, 0, false, %s)", (elo,))
        forecast_model = x("""INSERT INTO agg.forecast_models(version, matches, home_base, home_slope, away_base, away_slope, rho, strength_spread, simulations)
                              VALUES ('forecast-v1', 60000, 0.26, 0.93, 0.32, 0.91, -0.03, 90, 1000) RETURNING id""").fetchone()[0]
        first = date(2031, 8, 10)
        for g in range(1, 41):
            home, away = g % 4, (g + 1 + (g // 4) % 3) % 4
            strong = [(g + team) % 2 == 0 for team in (home, away)]
            score = (2 if strong[0] and not strong[1] else 0 if strong[1] and not strong[0] else 1, 1)
            day = first + timedelta(days=g)
            kickoff = datetime(day.year, day.month, day.day, 12, tzinfo=timezone.utc)
            x("""INSERT INTO core.matches(id, competition_season_id, season_id, source, status, home_team_id, away_team_id, home_score, away_score, match_date, kickoff_at)
                 VALUES (%s, 9600, %s, 'pitchapi', 'finished', %s, %s, %s, %s, %s, %s)""", (9600 + g, year, 9601 + home, 9601 + away, *score, day, kickoff))
            for team, with_strong, result in ((home, strong[0], score[0] > score[1]), (away, strong[1], score[1] > score[0])):
                x("INSERT INTO agg.team_elo(match_id, team_id, season_id, kickoff_at, elo_before, elo_after, expected, result, run_id) VALUES (%s, %s, %s, %s, 1500, 1500, 0.5, %s, %s)",
                  (9600 + g, 9601 + team, year, kickoff, 1.0 if result else 0.5, elo))
                # Players 1 to 10 of the club start every match (the first is its goalkeeper); the eleventh starter is its strong or its weak one.
                x("""INSERT INTO core.lineup_players(season_id, match_id, team_id, player_id, is_starter)
                     SELECT %(y)s, %(m)s, %(t)s, 9700 + %(i)s * 12 + j, true FROM generate_series(1, 12) j WHERE j <= 10 OR j = %(last)s""",
                  {"y": year, "m": 9600 + g, "t": 9601 + team, "i": team, "last": 11 if with_strong else 12})
                x("""INSERT INTO agg.player_power_matches(season_id, match_id, player_id, team_id, role, minutes, contribution, stakes, run_id)
                     SELECT %(y)s, %(m)s, 9700 + %(i)s * 12 + j, %(t)s, CASE WHEN j = 1 THEN 'goalkeeper' ELSE 'winger' END, 90,
                            CASE j WHEN 11 THEN 0.9 WHEN 12 THEN -0.9 WHEN 1 THEN 3.0 ELSE 0 END, 1, %(r)s
                     FROM generate_series(1, 12) j WHERE j <= 10 OR j = %(last)s""",
                  {"y": year, "m": 9600 + g, "t": 9601 + team, "i": team, "last": 11 if with_strong else 12, "r": run})
        minimum, original, seen = lineup.MIN_FIT, lineup.fit, []

        def spy(*args, **kwargs):
            seen.append(self.db.info.transaction_status)
            return original(*args, **kwargs)

        lineup.MIN_FIT, lineup.fit = 5, spy
        try:
            kept = lineup.refresh(self.db)
            self.assertEqual(seen, [TransactionStatus.IDLE])  # the years are gone through with no transaction open
            self.assertGreaterEqual(kept, 15)
            version, matches, rated, worth, error = self.one("SELECT version, matches, rated, elo_per_unit, elo_per_unit_error FROM agg.lineup_models")
            self.assertEqual((version, matches, rated), (lineup.MODEL_VERSION, kept, self.one("SELECT count(*) / 2 FROM agg.team_elo")[0]))
            # The clubs score more with their strong eleventh starter: a better line-up is worth Elo points.
            self.assertGreater(worth, 0)
            self.assertGreater(error, 0)
            self.assertEqual(self.one("SELECT version, matches FROM api.lineup_models"), (lineup.MODEL_VERSION, kept))
            # Fitted once, it is not fitted again until the base has grown enough; then one model is kept.
            self.assertIsNone(lineup.refresh(self.db))
            x("UPDATE agg.lineup_models SET rated = 1")
            self.assertEqual(lineup.refresh(self.db), kept)
            self.assertEqual(self.one("SELECT count(*) FROM agg.lineup_models")[0], 1)
            # Too few matches to fit on: nothing is written over the model held.
            lineup.MIN_FIT = 100000
            x("UPDATE agg.lineup_models SET rated = 1")
            self.assertEqual(lineup.refresh(self.db), 0)
            self.assertEqual(self.one("SELECT matches FROM agg.lineup_models")[0], kept)
            # The ranking's season of each player: the strong eleventh starter of a club, its weak one, its goalkeeper.
            x("""INSERT INTO agg.player_power(season_id, player_id, role, team_id, matches, minutes, total, rate, eligible, linked, run_id, own_total, level_total)
                 SELECT %s, 9700 + i * 12 + j, CASE WHEN j = 1 THEN 'goalkeeper' ELSE 'winger' END, 9601 + i, 20, 1800, 0, 0, true, true, %s,
                        CASE j WHEN 11 THEN 18.0 WHEN 12 THEN -18.0 WHEN 1 THEN 60.0 ELSE 0 END, 0
                 FROM generate_series(0, 3) i, generate_series(1, 12) j""", (year, run))
            # The reads behind a replacement: a player's own part of the year, and a club's league matches.
            self.assertEqual(self.one("SELECT name, role, team, minutes, own_total FROM api.player_own_totals WHERE season_id=%s AND player_key=9711", year),
                             ("Joueur 11", "winger", "Club 1", 1800, 18.0))
            self.assertEqual(self.one("SELECT competition_key, count(*) FROM api.team_league_matches WHERE season_id=%s AND team_key=9601 GROUP BY 1", year), (9600, 20))

            # 091. Each club's usual line-up of the year: written again after each ranking of the year.
            lineup.MIN_FIT = 5
            x("UPDATE agg.lineup_models SET rated = 1")
            lineup.refresh(self.db)
            worth = self.one("SELECT elo_per_unit FROM agg.lineup_models")[0]
            autumn = date(2031, 10, 1)
            self.assertEqual(lineup.usuals_due(self.db, autumn), [year])
            self.assertEqual(lineup.refresh_usuals(self.db, year), 4)
            self.assertEqual(lineup.usuals_due(self.db, autumn), [])
            usual = {team: total / count for team, count, total in x("SELECT team_id, lineups, total FROM agg.lineup_usuals WHERE season_id=%s", (year,)).fetchall()}
            # Forty matches, two line-ups each.
            self.assertEqual(self.one("SELECT sum(lineups), min(lineups) >= 15 FROM agg.lineup_usuals WHERE season_id=%s", year), (80, True))
            self.assertEqual(self.one("SELECT clubs FROM agg.lineup_usual_runs WHERE season_id=%s", year)[0], 4)
            x("UPDATE agg.power_runs SET finished_at = now() + interval '1 minute' WHERE id=%s", (run,))
            self.assertEqual(lineup.usuals_due(self.db, autumn), [year])
            self.assertEqual(lineup.usuals_due(self.db, date(2031, 7, 1)), [])  # another award year

            # A match about to start between two of the clubs, forecast from their strengths alone.
            now = datetime(2031, 10, 1, 12, tzinfo=timezone.utc)
            x("""INSERT INTO core.matches(id, competition_season_id, season_id, source, status, home_team_id, away_team_id, match_date, kickoff_at)
                 VALUES (9641, 9600, %s, 'pitchapi', 'not_started', 9601, 9602, %s, %s)""", (year, autumn, now + timedelta(minutes=40)))
            x("""INSERT INTO agg.match_forecasts(match_id, season_id, home_win, draw, away_win, home_goals, away_goals, likely_home, likely_away, home_elo, away_elo, model_id)
                 VALUES (9641, %s, 0.45, 0.27, 0.28, 1.4, 1.3, 1, 1, 1500, 1500, %s)""", (year, forecast_model))
            self.assertEqual(lineup.forecast_matches(self.db, now), 0)  # no line-up yet
            # Club 1 starts its strong eleventh player, club 2 its weak one; each club's goalkeeper is left out.
            x("""INSERT INTO core.lineups(season_id, match_id, team_id, side, confirmed) VALUES (%(y)s, 9641, 9601, 'home', true), (%(y)s, 9641, 9602, 'away', false)""", {"y": year})
            x("""INSERT INTO core.lineup_players(season_id, match_id, team_id, player_id, is_starter)
                 SELECT %s, 9641, 9601 + i, 9700 + i * 12 + j, true FROM generate_series(0, 1) i, generate_series(1, 12) j WHERE j <= 10 OR j = 11 + i""", (year,))
            self.assertEqual(lineup.forecast_matches(self.db, now), 0)  # one of the two is not confirmed
            x("UPDATE core.lineups SET confirmed = true WHERE match_id = 9641")
            self.assertEqual(lineup.forecast_matches(self.db, now - timedelta(hours=5)), 0)  # too long before kick-off
            self.assertEqual(lineup.forecast_matches(self.db, now), 1)
            row = self.one("""SELECT home_deviation, away_deviation, elo_per_unit, home_elo, away_elo, home_win, draw, away_win, first_computed_at, computed_at
                              FROM agg.match_lineup_forecasts WHERE match_id = 9641""")
            strong = lineup.rate(18.0, 1800)
            self.assertAlmostEqual(row[0], strong - usual[9601], places=5)
            self.assertAlmostEqual(row[1], -strong - usual[9602], places=5)
            self.assertEqual(row[2:5], (worth, 1500.0, 1500.0))
            from vega import forecast

            model = {"home": (0.26, 0.93), "away": (0.32, 0.91), "rho": -0.03}
            expected = forecast.forecast(model, 1500 + worth * row[0], 1500 + worth * row[1])
            before = forecast.forecast(model, 1500, 1500)
            self.assertAlmostEqual(row[5], expected["home"], places=5)
            self.assertAlmostEqual(row[5] + row[6] + row[7], 1.0, places=5)
            self.assertGreater(row[5], before["home"])  # the stronger eleven against the weaker one
            shifts = self.one("SELECT home_shift, away_shift, home_win FROM api.match_lineup_forecasts WHERE match_key = 9641")
            self.assertAlmostEqual(shifts[0], worth * row[0], places=3)
            self.assertAlmostEqual(shifts[1], worth * row[1], places=3)
            # Read once, a match is not read again until one of its line-ups is written again.
            self.assertEqual(lineup.forecast_matches(self.db, now), 0)
            x("UPDATE core.lineups SET updated_at = clock_timestamp() + interval '1 minute' WHERE match_id = 9641 AND team_id = 9602")
            self.assertEqual(lineup.forecast_matches(self.db, now), 1)
            again = self.one("SELECT first_computed_at, computed_at FROM agg.match_lineup_forecasts WHERE match_id = 9641")
            self.assertEqual(again[0], row[8])
            # A club without enough earlier line-ups: nothing is written, and the match is not looked at
            # again as long as its line-ups stay as they are.
            x("DELETE FROM agg.match_lineup_forecasts WHERE match_id = 9641")
            x("UPDATE agg.lineup_usuals SET lineups = 2 WHERE season_id=%s AND team_id = 9602", (year,))
            seen = {}
            self.assertEqual(lineup.forecast_matches(self.db, now, seen), 0)
            self.assertEqual(list(seen), [9641])
            x("UPDATE agg.lineup_usuals SET lineups = 20 WHERE season_id=%s AND team_id = 9602", (year,))
            self.assertEqual(lineup.forecast_matches(self.db, now, seen), 0)
            self.assertEqual(lineup.forecast_matches(self.db, now, {}), 1)
            # Once the match is no longer about to start, it is forgotten.
            self.assertEqual(lineup.forecast_matches(self.db, now + timedelta(days=1), seen), 0)
            self.assertEqual(seen, {})
        finally:
            lineup.MIN_FIT, lineup.fit = minimum, original
            x("DELETE FROM agg.match_lineup_forecasts WHERE match_id = 9641")
            x("DELETE FROM agg.match_forecasts WHERE match_id = 9641")
            x("DELETE FROM agg.lineup_usuals WHERE season_id=%s", (year,))
            x("DELETE FROM agg.lineup_usual_runs WHERE season_id=%s", (year,))
            x("DELETE FROM agg.lineup_models")
            x("DELETE FROM agg.player_power WHERE run_id=%s", (run,))
            x("DELETE FROM agg.player_power_matches WHERE run_id=%s", (run,))
            x("DELETE FROM agg.team_elo WHERE run_id=%s", (elo,))
            x("DELETE FROM agg.league_levels WHERE competition_id=9600")
            x("DELETE FROM agg.forecast_models WHERE id=%s", (forecast_model,))
            x("DELETE FROM agg.power_runs WHERE method_version='test-lineup'")
            x("DELETE FROM core.matches WHERE id BETWEEN 9601 AND 9641")
            x("DELETE FROM core.players WHERE id BETWEEN 9701 AND 9748")
            x("DELETE FROM core.teams WHERE id BETWEEN 9601 AND 9604")
            x("DELETE FROM core.competition_seasons WHERE id=9600")
            x("DELETE FROM core.competitions WHERE id=9600")


    def test_zzzzzzzzzzzzzz_a_keepers_shots_faced_and_a_teams_pressing_figures_are_read(self):
        # 092: two reads of facts held. The season's match 1 and two players written here.
        x = self.db.execute
        match, team = self.one("SELECT id, home_team_id FROM core.matches WHERE season_id = 2025 AND home_team_id IS NOT NULL ORDER BY id LIMIT 1")
        x("INSERT INTO core.players(id, name) VALUES (9801, 'Gardien'), (9802, 'Tireur')")
        try:
            # Three shots reach the keeper, one of them a goal; a blocked shot, an own goal and a shot without xGOT are not counted.
            for no, xgot, outcome, blocked, own in ((9801, 0.42, "saved", False, False), (9802, 0.71, "goal", False, False), (9803, 0.12, "saved", False, False),
                                                   (9804, 0.0, "saved", True, False), (9805, 0.9, "goal", False, True), (9806, None, "saved", False, False)):
                x("""INSERT INTO core.shots(season_id, match_id, team_id, shot_no, provider_shot_key, period, minute, player_id, keeper_id, xg, xgot, outcome, is_on_target, is_blocked, is_own_goal)
                     VALUES (2025, %s, %s, %s, %s, 'second_half', 70, 9802, 9801, 0.2, %s, %s, true, %s, %s)""", (match, team, no, f"faced-{no}", xgot, outcome, blocked, own))
            shots, goals, xgot = self.one("SELECT shots, goals, xgot FROM api.keeper_shot_totals WHERE season_id = 2025 AND keeper_key = 9801")
            self.assertEqual((shots, goals), (3, 1))
            self.assertAlmostEqual(xgot, 1.25, places=5)
            # A team's pressing figures of a period; a row without any of them is not listed.
            self.assertEqual(self.one("SELECT count(*) FROM api.match_team_pressing_rows WHERE season_id = 2025 AND match_id = %s", match)[0], 0)
            x("""INSERT INTO core.team_match_stats(season_id, match_id, team_id, period, poss_won_att_3rd, poss_won_mid_3rd, poss_won_def_3rd, recoveries, ppda,
                   final_third_entries, final_third_entries_pct, penalty_area_entries, penalty_area_entries_pct)
                 VALUES (2025, %s, %s, 'all', 4, 25, 25, 57, 14.4, 38, 58, 11, 28)
                 ON CONFLICT (season_id, match_id, team_id, period) DO UPDATE SET poss_won_att_3rd = 4, poss_won_mid_3rd = 25, poss_won_def_3rd = 25, recoveries = 57,
                   ppda = 14.4, final_third_entries = 38, final_third_entries_pct = 58, penalty_area_entries = 11, penalty_area_entries_pct = 28""", (match, team))
            row = self.one("""SELECT period_name, poss_won_att_3rd, recoveries, ppda, final_third_entries, final_third_entries_pct, penalty_area_entries_pct
                              FROM api.match_team_pressing_rows WHERE season_id = 2025 AND match_id = %s AND team_id = %s""", match, team)
            self.assertEqual(row[:3], ("all", 4, 57))
            self.assertAlmostEqual(row[3], 14.4, places=4)
            self.assertEqual(row[4:], (38, 58.0, 28.0))
        finally:
            x("DELETE FROM core.shots WHERE keeper_id = 9801")
            x("""UPDATE core.team_match_stats SET poss_won_att_3rd = NULL, poss_won_mid_3rd = NULL, poss_won_def_3rd = NULL, recoveries = NULL, ppda = NULL,
                   final_third_entries = NULL, final_third_entries_pct = NULL, penalty_area_entries = NULL, penalty_area_entries_pct = NULL
                 WHERE season_id = 2025 AND match_id = %s AND team_id = %s""", (match, team))
            x("DELETE FROM core.players WHERE id IN (9801, 9802)")


if __name__ == "__main__":
    unittest.main()
