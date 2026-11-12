"""Models against docs/calculs: a synthetic Ligue 1 of 8 clubs, 56 matches, 88 players.

Expected values are recomputed here, in plain Python, from the rows inserted, with the
formulas of the docs; the database must agree.
"""

from collections import Counter
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
        self.assertEqual(run[:7], ("power-ranking-v3", 20.0, 450.0, 630.0, 0.5, 0.5, 4.0))
        self.assertEqual([d.isoformat() for d in run[7:]], ["2025-08-01", "2026-07-31"])
        elo = self.db.execute("SELECT seed_rounds, link_matches, level_prior_matches FROM agg.power_runs WHERE kind='elo' AND status='published'").fetchone()
        self.assertEqual(elo, (1, 10, 30))  # nothing ties the league to another: its level does not move
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
        self.assertAlmostEqual(after - before, power.ELO_K * final_stakes * (1 - expected), places=3)
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
            held = self.one("SELECT count(*) FROM (SELECT player_id FROM agg.player_season_stats WHERE season_id=2025 GROUP BY 1 HAVING sum(minutes) >= 450) q")[0]
            self.assertEqual(embedding.refresh(self.db, 2025), held)
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
            # A second pass keeps one model; the reads.
            self.assertEqual(inplay.refresh(self.db), fitted)
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


if __name__ == "__main__":
    unittest.main()
