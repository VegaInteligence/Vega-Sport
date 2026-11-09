"""Season aggregates on a hand-built league whose every expected value is known."""

import math, os, sys, unittest
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
try:
    import psycopg
except ImportError:
    psycopg = None
DSN = os.environ.get("VEGA_V2_AGG_TEST_DSN")

from vega_v2 import agg_schema
from vega_v2.metric_catalog import NOT_METRICS, PLAYER_METRICS, TEAM_METRICS


def xpts(a, b):
    """Independent Poisson model, same as club-scout.js outcomeChances."""
    pa = [math.exp(-max(a, 0.01)) * max(a, 0.01) ** i / math.factorial(i) for i in range(11)]
    pb = [math.exp(-max(b, 0.01)) * max(b, 0.01) ** j / math.factorial(j) for j in range(11)]
    win = sum(pa[i] * pb[j] for i in range(11) for j in range(11) if i > j)
    draw = sum(pa[i] * pb[i] for i in range(11))
    return 3 * win + draw


class GeneratedMigrationTest(unittest.TestCase):
    def test_committed_agg_migration_matches_the_catalog(self):
        committed = (ROOT / "sql" / "009_agg_validated.sql").read_text(encoding="utf-8")
        self.assertEqual(committed, agg_schema.migration_sql())


@unittest.skipUnless(DSN and psycopg, "requires disposable local agg DB and psycopg")
class CalculatorTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        target = urlparse(DSN)
        if target.hostname not in ("localhost", "127.0.0.1", "::1") or target.path != "/vega_v2_agg_test":
            raise RuntimeError("dedicated local agg DB required")
        from vega_v2.store import connect_local, migrate, Store

        cls.db = connect_local(DSN)
        if cls.db.execute(
            "SELECT to_regnamespace('core') IS NULL AND to_regnamespace('agg') IS NULL AND to_regnamespace('ops') IS NULL"
        ).fetchone()[0] is not True:
            raise RuntimeError("test DB must be empty")
        migrate(cls.db)
        with cls.db.transaction():
            Store(cls.db).season("2025/2026")
        cls.build()

    @classmethod
    def tearDownClass(cls):
        cls.db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        cls.db.close()

    @classmethod
    def build(cls):
        x = cls.db.execute
        x("INSERT INTO core.competitions(id,name) VALUES(1,'League')")
        x("INSERT INTO core.competition_seasons(id,competition_id,season_id,native_label) VALUES(1,1,2025,'2025/2026')")
        x("INSERT INTO core.teams(id,name) VALUES(1,'Alpha'),(2,'Bravo'),(3,'Charlie')")
        x("INSERT INTO core.players(id,name) VALUES(10,'Ten'),(11,'Eleven')")
        x("INSERT INTO core.rounds(id,competition_season_id,name,stage) VALUES(1,1,'Matchday 1','regular'),(2,1,'Final','final')")
        x("""INSERT INTO core.matches(id,competition_season_id,season_id,source,round_id,status,home_team_id,away_team_id,home_score,away_score) VALUES
            (1,1,2025,'pitchapi',1,'finished',1,2,2,1),
            (2,1,2025,'pitchapi',1,'finished',2,3,0,0),
            (3,1,2025,'pitchapi',1,'finished',3,1,1,3),
            (4,1,2025,'pitchapi',1,'not_started',1,3,NULL,NULL),
            (5,1,2025,'pitchapi',2,'finished',1,3,0,4)""")
        x("""INSERT INTO core.match_coverage(season_id,match_id,events) VALUES
            (2025,1,'ok'),(2025,2,'ok'),(2025,3,'unavailable'),(2025,4,'pending'),(2025,5,'unavailable')""")
        x("""INSERT INTO core.team_match_stats(season_id,match_id,team_id,period,xg,passes,accurate_passes,possession_pct) VALUES
            (2025,1,1,'all',1.8,400,340,55),(2025,1,2,'all',0.9,300,240,45),
            (2025,2,2,'all',NULL,350,280,50),(2025,2,3,'all',0.5,350,290,50),
            (2025,3,3,'all',1.0,250,200,40),(2025,3,1,'all',2.2,450,400,60)""")
        x("""INSERT INTO core.player_match_stats(season_id,match_id,team_id,player_id,minutes_played,goals,xg,rating,accurate_passes,accurate_passes_total,top_speed_kmh) VALUES
            (2025,1,1,10,90,1,0.8,7.5,40,50,31.5),
            (2025,3,1,10,45,2,NULL,8.0,20,NULL,33.0),
            (2025,1,2,11,90,1,0.4,6.5,30,40,NULL)""")
        x("""INSERT INTO core.lineup_players(season_id,match_id,team_id,player_id,is_starter) VALUES
            (2025,1,1,10,true),(2025,3,1,10,false),(2025,1,2,11,true)""")
        x("""INSERT INTO core.match_events(season_id,match_id,team_id,seq,event_type,minute,period,score_home,score_away) VALUES
            (2025,1,1,1,'goal',10,'first_half',1,0),(2025,1,2,2,'goal',35,'first_half',1,1),(2025,1,1,3,'goal',80,'second_half',2,1)""")

    def player(self, pid, *cols):
        return self.db.execute(
            f"SELECT {','.join(cols)} FROM agg.player_season_stats WHERE player_id=%s AND competition_season_id=1", (pid,)
        ).fetchone()

    def team(self, tid, *cols):
        return self.db.execute(
            f"SELECT {','.join(cols)} FROM agg.team_season_stats WHERE team_id=%s AND competition_season_id=1", (tid,)
        ).fetchone()

    def test_1_catalog_covers_every_numeric_source_column(self):
        known = {}
        for m in (*PLAYER_METRICS, *TEAM_METRICS):
            known.setdefault(m.table, set()).add(m.column)
        for table in ("player_match_stats", "player_match_advanced", "team_match_stats", "team_match_advanced"):
            numeric = {
                c for (c,) in self.db.execute(
                    "SELECT column_name FROM information_schema.columns WHERE table_schema='core' AND table_name=%s AND data_type IN ('smallint','integer','real','double precision','numeric')",
                    (table,),
                )
            } - {"season_id", "match_id", "team_id", "player_id"}
            full = "core." + table
            missing = numeric - known.get(full, set()) - NOT_METRICS[full]
            self.assertEqual(missing, set(), table)

    def test_1b_every_metric_has_a_definition(self):
        from vega_v2.metric_catalog import PLAYER_RATIOS, TEAM_RATIOS

        expected = len(PLAYER_METRICS) + len(TEAM_METRICS) + len(PLAYER_RATIOS) + len(TEAM_RATIOS)
        self.assertEqual(
            self.db.execute("SELECT count(*) FROM agg.metric_definitions WHERE source_family <> 'derived'").fetchone()[0], expected
        )
        # The club indicators of api.team_season, minus the two keys that are also raw metrics.
        from vega_v2.models import TEAM_INDICATORS

        self.assertEqual(
            self.db.execute("SELECT count(*) FROM agg.metric_definitions WHERE source_family = 'derived'").fetchone()[0],
            len(TEAM_INDICATORS) - 2,
        )
        self.assertEqual(
            self.db.execute("SELECT count(*) FROM agg.metric_definitions WHERE label_fr IS NOT NULL").fetchone()[0],
            len(TEAM_INDICATORS) + 27,
        )
        self.assertEqual(
            self.db.execute("SELECT aggregation,numerator_key,denominator_key FROM agg.metric_definitions WHERE entity_type='team' AND key='ppda'").fetchone(),
            ("ratio", "opponent_passes", "defensive_actions"),
        )

    def test_2_full_refresh(self):
        from vega_v2.calculator import refresh_competition_season

        refresh_competition_season(self.db, 1)
        # Player 10: xG exists on 90 of 135 minutes, so xG/90 = 0.8, never 0.8/135*90.
        apps, starts, minutes, goals, goals_n, goals_min, xg, xg_n, xg_min = self.player(
            10, "appearances", "starts", "minutes", "goals_sum", "goals_n", "goals_min", "xg_sum", "xg_n", "xg_min"
        )
        self.assertEqual((apps, starts, minutes, goals, goals_n, goals_min), (2, 1, 135, 3, 2, 135))
        self.assertAlmostEqual(xg, 0.8, places=5)
        self.assertEqual((xg_n, xg_min), (1, 90))
        num, den, n = self.player(10, "pass_completion_num", "pass_completion_den", "pass_completion_n")
        self.assertEqual((num, den, n), (40, 50, 1))
        wsum, w = self.player(10, "rating_wsum", "rating_w")
        self.assertAlmostEqual(wsum / w, (7.5 * 90 + 8.0 * 45) / 135, places=4)
        self.assertAlmostEqual(self.player(10, "top_speed_kmh_max")[0], 33.0, places=4)
        # Team Alpha: the final is excluded from the standings, not from the season totals.
        matches, won, gf, ga, pts, cs, xp, xpm = self.team(
            1, "matches", "won", "goals_for", "goals_against", "points", "clean_sheets", "xpts", "xpts_matches"
        )
        self.assertEqual((matches, won, gf, ga, pts, cs), (3, 2, 5, 6, 6, 0))
        self.assertAlmostEqual(xp, xpts(1.8, 0.9) + xpts(2.2, 1.0), places=3)
        self.assertEqual(xpm, 2)
        self.assertAlmostEqual(self.team(1, "for_xg_sum")[0], 4.0, places=4)
        self.assertEqual(self.team(1, "for_xg_n")[0], 2)
        self.assertAlmostEqual(self.team(1, "against_xg_sum")[0], 1.9, places=4)
        # Bravo has no xG in match 2: one xPts match only.
        self.assertEqual(self.team(2, "xpts_matches")[0], 1)
        num, den = self.team(1, "for_pass_completion_num", "for_pass_completion_den")
        self.assertEqual((num, den), (740, 850))
        self.assertEqual(self.team(1, "for_possession_pct_n")[0], 2)
        standings = self.db.execute(
            "SELECT team_id,position,played,points FROM agg.standings WHERE competition_season_id=1 ORDER BY position"
        ).fetchall()
        self.assertEqual(standings, [(1, 1, 2, 6), (2, 2, 2, 1), (3, 3, 2, 1)])
        # Game states: only matches whose events reach the final score count.
        alpha = self.db.execute(
            "SELECT matches,scored_first,scored_first_won,scored_first_points,points_dropped_from_lead,minutes_leading,minutes_level FROM agg.team_game_states WHERE team_id=1"
        ).fetchone()
        self.assertEqual(alpha, (1, 1, 1, 3, 0, 38, 55))
        bravo = self.db.execute(
            "SELECT matches,conceded_first,conceded_first_lost,goalless,points_from_behind FROM agg.team_game_states WHERE team_id=2"
        ).fetchone()
        self.assertEqual(bravo, (2, 1, 1, 1, 0))

    def test_3_dirty_scopes_are_processed_and_published(self):
        from vega_v2.calculator import process_dirty

        self.db.execute("UPDATE core.matches SET home_score=2,away_score=2 WHERE id=1")
        self.db.execute("DELETE FROM core.player_match_stats WHERE player_id=11")
        self.db.execute(
            "INSERT INTO ops.dirty_scopes(scope_kind,player_id,team_id,competition_season_id) VALUES('player_season',11,2,1),('team_season',NULL,1,1),('competition_season',NULL,NULL,1)"
        )
        self.assertEqual(process_dirty(self.db), 3)
        # Only the edition's cohorts (1 club + 4 position groups) remain, queued for the models.
        self.assertEqual(
            self.db.execute("SELECT scope_kind::text, count(*) FROM ops.dirty_scopes GROUP BY 1").fetchall(), [("cohort", 5)]
        )
        self.assertIsNone(self.player(11, "minutes"))
        self.assertEqual(self.team(1, "drawn", "points"), (1, 4))
        self.assertEqual(
            self.db.execute("SELECT count(*) FROM ops.resource_versions WHERE published_at IS NOT NULL").fetchone()[0], 3
        )

    def test_4_xpts_function_matches_the_site_model(self):
        p_win, p_draw, p_loss, value = self.db.execute("SELECT (agg.xpts_v1(1.8,0.9)).*").fetchone()
        self.assertAlmostEqual(value, xpts(1.8, 0.9), places=4)
        self.assertAlmostEqual(p_win + p_draw + p_loss, 1, places=4)
        self.assertIsNone(self.db.execute("SELECT agg.xpts_v1(NULL,1.0)").fetchone()[0])
        self.assertEqual(
            self.db.execute("SELECT core.pct(3,0), core.per90(1,0), core.age_on('2000-06-15','2026-06-14')").fetchone(),
            (None, None, 25),
        )


@unittest.skipUnless(DSN and psycopg, "requires disposable local agg DB and psycopg")
class ApiViewTest(CalculatorTest):
    """The api views read the same hand-built league after a full refresh."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        from vega_v2.calculator import refresh_competition_season

        refresh_competition_season(cls.db, 1)

    # The inherited calculator tests already ran in CalculatorTest.
    test_1_catalog_covers_every_numeric_source_column = None
    test_1b_every_metric_has_a_definition = None
    test_2_full_refresh = None
    test_3_dirty_scopes_are_processed_and_published = None
    test_4_xpts_function_matches_the_site_model = None

    def one(self, query, params=()):
        return self.db.execute(query, params).fetchone()

    def test_committed_api_migration_matches_the_generator(self):
        from vega_v2 import api_schema

        committed = (ROOT / "sql" / "012_api_views.sql").read_text(encoding="utf-8")
        self.assertEqual(committed, api_schema.migration_sql())

    def test_every_view_answers(self):
        views = [r[0] for r in self.db.execute(
            "SELECT table_schema||'.'||table_name FROM information_schema.views WHERE table_schema IN ('api','ops') ORDER BY 1"
        )]
        self.assertEqual(len([v for v in views if v.startswith("api.")]), 94)  # 21 + 5 read API (016) + 3 players (019) + media (020) + 4 matches (021) + 2 (022) + cards (023) + 3 search (024) + 4 archives (025) + 4 rankings (026) + 4 Wikidata (027) + 2 cups (028) + honours (029) + 19 match details and profiles (031) + 2 power rankings (032) + cup tables (035) + power roles (037) + season keys (039) + 12 status page (043) + 2 home settings (044) + home leaders (046)
        self.assertEqual(len([v for v in views if v.startswith("ops.")]), 4)  # + live reliability (042)
        for view in views:
            self.db.execute(f"SELECT * FROM {view} LIMIT 5").fetchall()

    def test_season_values_are_computed_on_covered_minutes(self):
        xg_p90, pass_pct, rating = self.one(
            "SELECT xg_p90, pass_completion_pct, rating_avg FROM api.player_season WHERE player_id=10"
        )
        self.assertAlmostEqual(xg_p90, 0.8, places=4)
        self.assertAlmostEqual(pass_pct, 80.0, places=4)
        self.assertAlmostEqual(rating, (7.5 * 90 + 8.0 * 45) / 135, places=4)
        ppm, xg_pm, tilt = self.one("SELECT ppm, xg_pm, pass_accuracy_pct FROM api.team_season WHERE team_id=1")
        self.assertAlmostEqual(ppm, 2.0, places=4)
        self.assertAlmostEqual(xg_pm, 2.0, places=4)
        self.assertAlmostEqual(tilt, 100 * 740 / 850, places=3)

    def test_public_ids_and_match_reads(self):
        self.assertEqual(self.one("SELECT api.public_id('match', 1)")[0], "m_v0000001")
        self.assertEqual(self.one("SELECT count(*) FROM api.match_goals WHERE match_id=1")[0], 3)
        self.assertAlmostEqual(
            self.one("SELECT xpts FROM api.match_xpts WHERE match_id=1 AND team_id=1")[0], xpts(1.8, 0.9), places=3
        )
        self.assertEqual(
            self.one("SELECT stage, home_name, away_name FROM api.match_list WHERE match_id=5"),
            ("final", "Alpha", "Charlie"),
        )

    def test_cup_tie_and_standings(self):
        self.assertEqual(
            self.one("SELECT winner_team_id, decided_by, legs FROM api.cup_ties WHERE round_id=2"), (3, "score", 1)
        )
        rows = self.db.execute(
            "SELECT team_id, position, source FROM api.standings WHERE competition_season_id=1 ORDER BY position"
        ).fetchall()
        self.assertEqual([r[0] for r in rows], [1, 2, 3])
        self.assertEqual({r[2] for r in rows}, {"vega"})
        # An official table, once observed, replaces the computed one.
        self.db.execute(
            "INSERT INTO core.standings_official(competition_season_id,team_id,position,points,source,as_of) VALUES(1,3,1,9,'sportscore',now())"
        )
        self.assertEqual(
            self.db.execute("SELECT team_id, source FROM api.standings WHERE competition_season_id=1").fetchall(),
            [(3, "sportscore")],
        )
        self.db.execute("DELETE FROM core.standings_official")
