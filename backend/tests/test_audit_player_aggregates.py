"""Calculation audit of 16 Nov 2026 (VI-23), batches B1 and B3, on a real local PostgreSQL.

Written before the corrections (docs/calculs/09-audit-2026-11/FAILURE_MODES.md §2 and §4).
Each class migrates the dedicated local agg DB, builds its own matches, runs the real
calculator and reads the tables and views the site and the API read; both classes drop
the schemas at the end, so test_calculator.py still finds the DB empty.
"""

import json
import math
import os
import sys
import unittest
from pathlib import Path
from urllib.parse import urlparse
from template_base import fresh

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
try:
    import psycopg
except ImportError:
    psycopg = None
DSN = os.environ.get("VEGA_V2_AGG_TEST_DSN")
FIXTURE = Path(__file__).resolve().parent / "fixtures" / "match_m_08LEIz"


def _connect():
    target = urlparse(DSN)
    if target.hostname not in ("localhost", "127.0.0.1", "::1") or target.path != "/vega_v2_agg_test":
        raise RuntimeError("dedicated local agg DB required")

    db = fresh(DSN)
    return db


def _drop(db):
    db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
    db.close()


# (id, status, home score, away score, date): Alpha (1) at home against Bravo (2) every week.
MATCHES = [
    (1, "finished", 1, 0, "2025-09-01"),
    (2, "canceled", None, None, "2025-09-08"),
    (3, "not_started", None, None, "2025-09-15"),
    (4, "postponed", None, None, "2025-09-22"),
    (5, "in_play", 0, 0, "2025-09-29"),
    (6, "suspended", 0, 0, "2025-10-06"),
    (7, "awarded", 3, 0, "2025-10-13"),
    (8, "finished", 2, 0, "2025-10-20"),  # corrected to canceled during the test
]
# (match, player, minutes, goals, xg, shots, touches), all for Alpha.
STATS = [
    (1, 10, 90, 1, 0.5, 2, 40),
    (2, 10, 90, 2, 0.9, 3, 30),
    (4, 10, 30, 1, 0.3, 1, 15),
    (5, 10, 60, 1, 0.4, 1, 25),
    (6, 10, 45, 0, 0.1, 1, 20),
    (7, 10, 90, 1, 0.6, 2, 35),
    (2, 11, 90, 1, 0.5, 2, 30),  # Eleven played only the canceled match
    (8, 12, 90, 2, 1.1, 3, 45),  # Twelve played only match 8
]
# Confirmed starters (attacking line, position 91). Ten also starts the future match 3;
# Thirteen is only named for it.
STARTERS = [(m, 10) for m in (1, 2, 3, 4, 5, 6, 7)] + [(2, 11), (8, 12), (3, 13)]
# Advanced rows (passes) on the finished match 1 and the canceled match 2.
ADVANCED = [(1, 10, 90, 30), (2, 10, 90, 25), (2, 11, 90, 20)]


@unittest.skipUnless(DSN and psycopg, "requires disposable local agg DB and psycopg")
class FinishedOnlyAggregatesTest(unittest.TestCase):
    """FM-B1.1 to FM-B1.7: only finished matches make a player's season."""

    @classmethod
    def setUpClass(cls):
        from vega.store import Store

        cls.db = _connect()
        cls.addClassCleanup(_drop, cls.db)
        with cls.db.transaction():
            Store(cls.db).season("2025/2026")
        x = cls.db.execute
        x("INSERT INTO core.competitions(id,name,kind) VALUES(1,'League','league')")
        x("INSERT INTO core.competition_seasons(id,competition_id,season_id,native_label) VALUES(1,1,2025,'2025/2026')")
        x("INSERT INTO core.teams(id,name) VALUES(1,'Alpha'),(2,'Bravo')")
        x("INSERT INTO core.players(id,name) VALUES(10,'Ten'),(11,'Eleven'),(12,'Twelve'),(13,'Thirteen')")
        for mid, status, hs, as_, day in MATCHES:
            x("""INSERT INTO core.matches(id,competition_season_id,season_id,source,status,home_team_id,away_team_id,home_score,away_score,match_date,kickoff_at)
                 VALUES(%s,1,2025,'pitchapi',%s,1,2,%s,%s,%s,%s::date + time '19:00')""", (mid, status, hs, as_, day, day))
            x("INSERT INTO core.match_coverage(season_id,match_id,player_stats) VALUES(2025,%s,%s)", (mid, "pending" if mid == 3 else "ok"))
        for mid, pid, minutes, goals, xg, shots, touches in STATS:
            x("""INSERT INTO core.player_match_stats(season_id,match_id,team_id,player_id,minutes_played,goals,xg,total_shots,touches)
                 VALUES(2025,%s,1,%s,%s,%s,%s,%s,%s)""", (mid, pid, minutes, goals, xg, shots, touches))
        for mid, pid in STARTERS:
            x("INSERT INTO core.lineup_players(season_id,match_id,team_id,player_id,is_starter,position_id) VALUES(2025,%s,1,%s,true,91)", (mid, pid))
        for mid, pid, minutes, passes in ADVANCED:
            x("INSERT INTO core.player_match_advanced(season_id,match_id,team_id,player_id,minutes_played,passes) VALUES(2025,%s,1,%s,%s,%s)",
              (mid, pid, minutes, passes))
        from vega.calculator import refresh_competition_season

        refresh_competition_season(cls.db, 1)

    def one(self, sql, *args):
        return self.db.execute(sql, args).fetchone()

    def test_1_season_aggregates_read_finished_matches_only(self):
        # FM-B1.1, FM-B1.2, FM-B1.3: Ten's season is match 1 alone (the baseline adds the
        # canceled, postponed, live, suspended and awarded matches and the future start).
        row = self.one("""SELECT appearances, starts, minutes, goals_sum, goals_n, goals_min, xg_sum, xg_n, adv_passes_sum, adv_passes_n
                          FROM agg.player_season_stats WHERE player_id=10 AND competition_season_id=1""")
        self.assertIsNotNone(row)
        appearances, starts, minutes, goals, goals_n, goals_min, xg, xg_n, passes, passes_n = row
        self.assertEqual((appearances, starts, minutes, goals, goals_n, goals_min), (1, 1, 90, 1, 1, 90))
        self.assertAlmostEqual(xg, 0.5, places=5)
        self.assertEqual(xg_n, 1)
        self.assertEqual((passes, passes_n), (30, 1))

    def test_2_a_player_of_unfinished_matches_only_has_no_season_row(self):
        # FM-B1.5: Eleven played only the canceled match; Thirteen is only named for a future one.
        self.assertIsNone(self.one("SELECT 1 FROM agg.player_season_stats WHERE player_id=11"))
        self.assertIsNone(self.one("SELECT 1 FROM agg.player_season_stats WHERE player_id=13"))

    def test_3_the_player_list_reads_finished_matches_only(self):
        # FM-B1.6: the list's row of Ten (060/116 refresh): one played match, no unknown match
        # (the future line-up is not a match of the season), identity and latest on match 1.
        row = self.one("""SELECT matches, total_minutes, unknown_matches, starts, known_starts, goals_sum, goals_count, xg_sum, xg_count,
                                 identity_match_id, latest_match_id
                          FROM agg.player_list_editions WHERE player_id=10 AND competition_season_id=1""")
        self.assertIsNotNone(row)
        matches, total, unknown, starts, known, goals, goals_n, xg, xg_n, identity, latest = row
        self.assertEqual((matches, total, unknown, starts, known, goals, goals_n, xg_n, identity, latest), (1, 90, 0, 1, 1, 1, 1, 1, 1, 1))
        self.assertAlmostEqual(xg, 0.5, places=5)
        for player in (11, 13):
            self.assertIsNone(self.one("SELECT 1 FROM agg.player_list_editions WHERE player_id=%s", player), player)

    def test_4_the_performance_peers_are_finished_appearances(self):
        # FM-B1.7: the peers of a performance are the finished appearances of 30 minutes or
        # more: Ten in match 1 and Twelve in match 8 (the baseline counts eight).
        peers = self.one("""SELECT coalesce(sum(appearances), 0) FROM agg.performance_distribution
                            WHERE competition_season_id=1 AND metric='appearances' AND profile_group='O'""")[0]
        self.assertEqual(peers, 2)

    def test_5_the_team_side_already_reads_finished_matches(self):
        # BC: the team aggregates count matches 1 and 8 (the awarded match is not finished).
        self.assertEqual(self.one("SELECT matches, won, goals_for FROM agg.team_season_stats WHERE team_id=1 AND competition_season_id=1"), (2, 2, 3))

    def test_6_a_finished_match_corrected_to_canceled_leaves_no_stale_row(self):
        # FM-B1.4: match 8 is corrected to canceled; the dirty scope is processed as the
        # collector queues it. Twelve's season, list row and peer disappear; the team's
        # aggregates follow (BC).
        from vega.calculator import process_dirty

        self.assertEqual(self.one("SELECT appearances FROM agg.player_season_stats WHERE player_id=12")[0], 1)
        self.db.execute("UPDATE core.matches SET status='canceled', home_score=NULL, away_score=NULL WHERE id=8")
        self.db.execute("INSERT INTO ops.dirty_scopes(scope_kind,competition_season_id) VALUES('competition_season',1)")
        self.assertGreaterEqual(process_dirty(self.db), 1)
        self.assertIsNone(self.one("SELECT 1 FROM agg.player_season_stats WHERE player_id=12"))
        self.assertIsNone(self.one("SELECT 1 FROM agg.player_list_editions WHERE player_id=12"))
        peers = self.one("""SELECT coalesce(sum(appearances), 0) FROM agg.performance_distribution
                            WHERE competition_season_id=1 AND metric='appearances' AND profile_group='O'""")[0]
        self.assertEqual(peers, 1)
        self.assertEqual(self.one("SELECT matches FROM agg.team_season_stats WHERE team_id=1")[0], 1)


# The half statistics the route reads; a complete half knows each of them (xG: or no shot).
REQUIRED = ("goals", "total_shots", "accurate_passes", "touches", "duels_won", "recoveries", "touches_opp_box", "dribbles_succeeded", "tackles")
HALF_COLUMNS = [
    ("season_id", "smallint"), ("player_key", "integer"), ("period", "text"), ("matches", "integer"), ("minutes", "integer"),
    ("goals", "integer"), ("shots", "integer"), ("xg", "double precision"), ("chances_created", "integer"), ("passes", "integer"),
    ("touches", "integer"), ("duels_won", "integer"), ("recoveries", "integer"), ("touches_box", "integer"), ("dribbles", "integer"),
    ("tackles", "integer"),
]


@unittest.skipUnless(DSN and psycopg, "requires disposable local agg DB and psycopg")
class HalvesRealFixtureTest(unittest.TestCase):
    """FM-B3.1 to FM-B3.4 on the provider's own halves of match m_08LEIz, written through the
    collector's path (normalize_family, Store) as api/test/seed_match.py does."""

    @classmethod
    def setUpClass(cls):
        from vega.normalize import normalize_family
        from vega.store import Store

        cls.db = _connect()
        cls.addClassCleanup(_drop, cls.db)
        load = lambda name: json.loads((FIXTURE / f"{name}.json").read_text())
        store = Store(cls.db)
        match = load("date")["matches"][0]
        with cls.db.transaction():
            store.season("2026/2027")
            league = dict(match["league"], country_code="RUS", seasons=[match["season"]], season=match["season"])
            store.save_references(normalize_family("league", league), family="league")
            edition, _ = store.edition(store.resolve("competition", match["league"]["id"]), match["season"])
            store.save_matches(normalize_family("summary", load("match")["data"], match_id="m_08LEIz"), edition, family="summary")
        cls.match = store.resolve("match", "m_08LEIz")
        cls.halves = normalize_family("players_halves", load("players_halves")["data"], match_id="m_08LEIz")
        store.save_family(cls.match, "player_halves", cls.halves)
        cls.season = cls.db.execute("SELECT season_id FROM core.matches WHERE id=%s", (cls.match,)).fetchone()[0]
        cls.keepers = [store.resolve("player", key) for key in ("p_4McHHL", "p_3yNPPF")]

    def view(self):
        return self.db.execute(
            "SELECT player_key, period, matches, minutes, goals, shots, xg, touches, chances_created FROM api.player_half_totals WHERE season_id=%s",
            (self.season,),
        ).fetchall()

    def test_1_the_view_keeps_its_columns_and_types(self):
        # BC: the published columns, in their order and with their types (084), come first.
        columns = self.db.execute(
            """SELECT column_name, data_type FROM information_schema.columns
               WHERE table_schema='api' AND table_name='player_half_totals' ORDER BY ordinal_position"""
        ).fetchall()
        self.assertEqual(columns[: len(HALF_COLUMNS)], HALF_COLUMNS)

    def test_2_only_complete_measured_halves_are_summed(self):
        # The fixture's half rows: 50 played, 46 complete; the two keepers' four rows carry no
        # touches (unmeasured): no row for them, never a zero.
        played = [r for r in self.halves.rows["core.player_match_half_stats"] if (r.get("minutes_played") or 0) > 0]
        complete = [r for r in played if all(r.get(c) is not None for c in REQUIRED) and (r.get("xg") is not None or r.get("total_shots") == 0)]
        self.assertEqual((len(played), len(complete)), (50, 46))
        rows = self.view()
        self.assertEqual(len(rows), 46)
        self.assertFalse([r for r in rows if r[0] in self.keepers])
        by_period = {}
        for _, period, matches, minutes, goals, shots, xg, touches, chances in rows:
            total = by_period.setdefault(period, [0, 0, 0, 0, 0.0, 0])
            for i, value in enumerate((matches, minutes, goals, shots, xg, touches)):
                total[i] += value
            # The source publishes no chances created per half: unknown, not 0.
            self.assertIsNone(chances)
        self.assertEqual([by_period["first_half"][i] for i in (0, 1, 2, 3, 5)], [20, 900, 0, 14, 460])
        self.assertEqual([by_period["second_half"][i] for i in (0, 1, 2, 3, 5)], [26, 900, 0, 9, 452])
        self.assertAlmostEqual(by_period["first_half"][4], 1.11, places=5)
        self.assertAlmostEqual(by_period["second_half"][4], 0.49, places=5)

    def test_3_a_half_without_a_shot_has_a_zero_xg_and_a_shot_without_xg_is_excluded(self):
        # Structural zero: no shot and a blank xG is a zero xG (FAILURE_MODES §0). A published
        # xG is kept as it is: the fixture has a half with no shot counted and 0.03 xG
        # (p_4EpxW0, second half). A row whose shot has no xG is incomplete: blank one
        # shooter's half, it leaves the view.
        key = lambda provider_key: self.db.execute(
            "SELECT entity_id FROM core.provider_ids WHERE entity_type='player' AND provider_key=%s", (provider_key,)
        ).fetchone()[0]
        rows = {(r[0], r[1]): r for r in self.view()}
        striker = key("p_02x0dj")
        first = rows[(striker, "first_half")]
        self.assertEqual((first[2], first[3], first[4], first[5]), (1, 45, 0, 3))
        self.assertAlmostEqual(first[6], 0.28, places=5)
        self.assertAlmostEqual(rows[(key("p_4EpxW0"), "second_half")][6], 0.03, places=5)
        blank = [
            (key(r["player_id"]), r["period"]) for r in self.halves.rows["core.player_match_half_stats"]
            if (r.get("minutes_played") or 0) > 0 and r.get("xg") is None and r.get("total_shots") == 0 and r.get("touches") is not None
        ]
        self.assertEqual(len(blank), 28)
        self.assertEqual([rows[k][6] for k in blank], [0.0] * len(blank))
        self.db.execute("UPDATE core.player_match_half_stats SET xg = NULL WHERE player_id=%s AND period='first_half'", (striker,))
        try:
            self.assertNotIn((striker, "first_half"), {(r[0], r[1]) for r in self.view()})
        finally:
            self.db.execute("UPDATE core.player_match_half_stats SET xg = 0.28 WHERE player_id=%s AND period='first_half'", (striker,))

    def test_4_halves_of_an_unfinished_match_are_not_a_season(self):
        # FM-B3.3: the same match marked canceled: its halves leave the season's view.
        self.db.execute("UPDATE core.matches SET status='canceled' WHERE id=%s", (self.match,))
        try:
            self.assertEqual(self.view(), [])
        finally:
            self.db.execute("UPDATE core.matches SET status='finished' WHERE id=%s", (self.match,))


def _league(db):
    """A season 2025/2026 with one league edition (id 1) between Alpha (1) and Bravo (2)."""
    from vega.store import Store

    with db.transaction():
        Store(db).season("2025/2026")
    db.execute("INSERT INTO core.competitions(id,name,kind) VALUES(1,'League','league')")
    db.execute("INSERT INTO core.competition_seasons(id,competition_id,season_id,native_label) VALUES(1,1,2025,'2025/2026')")
    db.execute("INSERT INTO core.teams(id,name) VALUES(1,'Alpha'),(2,'Bravo')")


@unittest.skipUnless(DSN and psycopg, "requires disposable local agg DB and psycopg")
class CohortRoleFinishedTest(unittest.TestCase):
    """FAILURE_MODES §14.2 (stage 5, Astra F1): a player's position group in the cohorts reads
    his finished matches, as his statistics do (models._player_values_sql, grp). Ten finished
    attacking matches of 90 minutes (position 91, group O) and twelve defensive ones (31, D)."""

    PLAYER = 10

    def build(self, late_status):
        """Matches 1–10 finished, 11–22 with `late_status`; player 10 attacks in 1–10 and defends
        in 11–22; 30 attacking peers (100–129) and 30 defending ones (200–229) in 1–10."""
        self.db = _connect()
        self.addCleanup(_drop, self.db)
        _league(self.db)
        x = self.db.execute
        x("INSERT INTO core.players(id,name) SELECT g, 'P' || g FROM (SELECT 10 AS g UNION ALL SELECT generate_series(100, 129) UNION ALL SELECT generate_series(200, 229)) q")
        x("""INSERT INTO core.matches(id,competition_season_id,season_id,source,status,home_team_id,away_team_id,home_score,away_score,match_date)
             SELECT g, 1, 2025, 'pitchapi', CASE WHEN g <= 10 THEN 'finished' ELSE %s END::core.match_status, 1, 2, 1, 0, DATE '2025-08-01' + g
             FROM generate_series(1, 22) g""", (late_status,))
        stats = """INSERT INTO core.player_match_stats(season_id,match_id,team_id,player_id,position_id,minutes_played,goals,total_shots,touches)
                   SELECT 2025, m, 1, p, %s, 90, (p + m) %% 3, 1 + (p + m) %% 4, 30 + (p * m) %% 25 FROM generate_series(%s::int, %s::int) m, unnest(%s::int[]) p"""
        x(stats, (91, 1, 10, [self.PLAYER, *range(100, 130)]))
        x(stats, (31, 1, 10, list(range(200, 230))))
        x(stats, (31, 11, 22, [self.PLAYER]))
        self.publish()

    def publish(self):
        from vega import models
        from vega.calculator import refresh_competition_season

        refresh_competition_season(self.db, 1)
        with self.db.transaction():
            models.ensure_cohorts(self.db, 1)
        self.cohorts = {}
        for group in ("O", "D"):
            cohort = self.db.execute("SELECT id FROM agg.cohorts WHERE key=%s", (f"player:2025:cs:1:{group}",)).fetchone()[0]
            models.refresh_cohort(self.db, cohort)
            self.cohorts[group] = cohort

    def membership(self):
        """{group: (members, player 10's goals percentile or None)} in the two cohorts."""
        out = {}
        for group, cohort in self.cohorts.items():
            members = {p for (p,) in self.db.execute("SELECT DISTINCT player_id FROM agg.player_percentiles WHERE cohort_id=%s", (cohort,))}
            row = self.db.execute("SELECT percentile FROM agg.player_percentiles WHERE cohort_id=%s AND player_id=%s AND metric_key='goals'",
                                  (cohort, self.PLAYER)).fetchone()
            out[group] = (members, row[0] if row else None)
        return out

    def assert_attacker(self):
        groups = self.membership()
        self.assertIn(self.PLAYER, groups["O"][0], "player 10 is not in the attacking cohort")
        self.assertNotIn(self.PLAYER, groups["D"][0], "player 10 is in the defensive cohort")
        self.assertIsNotNone(groups["O"][1], "no percentile among the 31 attackers")
        self.assertEqual(len(groups["O"][0]), 31)
        self.assertEqual(len(groups["D"][0]), 30)

    def test_1_canceled_matches_do_not_choose_the_cohort(self):
        self.build("canceled")
        self.assert_attacker()

    def test_2_a_cancellation_after_publication_moves_the_player(self):
        self.build("finished")
        # Every match finished: 12 defensive matches outweigh 10 attacking ones.
        groups = self.membership()
        self.assertIn(self.PLAYER, groups["D"][0])
        self.assertNotIn(self.PLAYER, groups["O"][0])
        self.db.execute("UPDATE core.matches SET status='canceled', home_score=NULL, away_score=NULL WHERE id > 10")
        self.publish()
        self.assert_attacker()


@unittest.skipUnless(DSN and psycopg, "requires disposable local agg DB and psycopg")
class HalvesNonFiniteXgTest(unittest.TestCase):
    """FAILURE_MODES §14.5 (stage 5): a half whose xG is NaN or infinite is no complete half; the
    structural zero (no shot, no xG) and a finite xG without a shot stay as they are."""

    COLUMNS = "player_key, period, matches, minutes, goals, shots, xg, excluded_matches, excluded_minutes"

    @classmethod
    def setUpClass(cls):
        cls.db = _connect()
        cls.addClassCleanup(_drop, cls.db)
        _league(cls.db)
        x = cls.db.execute
        x("INSERT INTO core.players(id,name) SELECT g, 'H' || g FROM generate_series(20, 26) g")
        x("""INSERT INTO core.matches(id,competition_season_id,season_id,source,status,home_team_id,away_team_id,home_score,away_score,match_date)
             SELECT g, 1, 2025, 'pitchapi', 'finished', 1, 2, 1, 0, DATE '2025-08-01' + g FROM generate_series(1, 2) g""")
        half = """INSERT INTO core.player_match_half_stats(season_id,match_id,team_id,player_id,period,minutes_played,goals,total_shots,xg,
                    chances_created,accurate_passes,touches,duels_won,recoveries,touches_opp_box,dribbles_succeeded,tackles)
                  VALUES (2025,%s,1,%s,'first_half',45,%s,%s,%s,1,20,30,4,5,3,2,1)"""
        for player, bad in ((20, math.nan), (21, math.inf), (22, -math.inf)):
            x(half, (1, player, 1, 2, 0.4))  # the valid half
            x(half, (2, player, 1, 1, bad))  # the invalid one
        x(half, (1, 23, 0, 1, math.nan))  # nothing but an invalid half
        x(half, (2, 23, 0, 1, math.inf))
        x(half, (1, 24, 0, 0, None))  # no shot, no xG: the structural zero
        x(half, (1, 25, 0, 0, 0.03))  # no shot but a published finite xG: kept
        x(half, (1, 26, 1, 2, 0.4))  # a valid half
        x(half, (2, 26, 0, 0, math.nan))  # no shot and a NaN: invalid, not a structural zero
        cls.rows = {r[0]: r for r in x(f"SELECT {cls.COLUMNS} FROM api.player_half_totals WHERE season_id=2025").fetchall()}

    def test_1_a_non_finite_half_contributes_nothing_and_is_excluded(self):
        wrong = []
        for player in (20, 21, 22, 26):
            got = self.rows.get(player)
            want = (player, "first_half", 1, 45, 1, 2, 0.4, 1, 45)
            if got is None or got[:6] != want[:6] or not math.isclose(got[6], 0.4, rel_tol=1e-6) or got[7:] != want[7:]:
                wrong.append(f"{player}: {got}")
        self.assertEqual(wrong, [])

    def test_2_nothing_but_invalid_halves_gives_no_row(self):
        self.assertNotIn(23, self.rows)

    def test_3_the_structural_zero_and_a_finite_zero_shot_xg_stay(self):
        self.assertEqual(self.rows[24][2:8], (1, 45, 0, 0, 0.0, 0))
        self.assertAlmostEqual(self.rows[25][6], 0.03, places=6)
        self.assertEqual(self.rows[25][2:6], (1, 45, 0, 0))


if __name__ == "__main__":
    unittest.main()
