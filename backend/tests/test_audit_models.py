"""Calculation audit of 16 Nov 2026 (VI-23), batches B4, B8 and B9, through the daily models'
real refreshes on a local PostgreSQL. Written before the corrections
(docs/calculs/09-audit-2026-11/FAILURE_MODES.md §5, §9 and §10).

Each class migrates the dedicated local models DB, writes its own rows, runs the module's
refresh (returns.refresh, embedding.refresh, xg.refresh) and reads what the API reads. The
schemas are dropped at the end of each class.
"""

import contextlib
import io
import math
import os
import re
import sys
import types
import unittest
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse
from template_base import fresh

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
try:
    import psycopg
except ImportError:
    psycopg = None
DSN = os.environ.get("VEGA_V2_MODELS_TEST_DSN")


def _connect():
    target = urlparse(DSN)
    if target.hostname not in ("localhost", "127.0.0.1", "::1") or target.path != "/vega_v2_models_test":
        raise RuntimeError("dedicated local models DB required")
    from vega.store import Store

    db = fresh(DSN)
    with db.transaction():
        Store(db).season("2025/2026")
    db.execute("INSERT INTO core.competitions(id,name,kind) VALUES(1,'League','league')")
    db.execute("INSERT INTO core.competition_seasons(id,competition_id,season_id,native_label) VALUES(1,1,2025,'2025/2026')")
    return db


def _drop(db):
    db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
    db.close()


START = date(2026, 1, 3)
WEEK = [START + timedelta(days=7 * k) for k in range(20)]


@unittest.skipUnless(DSN and psycopg, "requires disposable local models DB and psycopg")
class ReturnsClubStreamTest(unittest.TestCase):
    """FM-B4.1 to FM-B4.3: a return is read on the club's stream of finished matches."""

    @classmethod
    def setUpClass(cls):
        cls.db = _connect()
        cls.addClassCleanup(_drop, cls.db)
        x = cls.db.execute
        x("""INSERT INTO core.teams(id,name,is_national) VALUES (501,'Club Hebdo',false),(502,'Adversaire',NULL),(503,'Autre Club',false),
             (599,'Sélection',true),(598,'Sélection Adverse',true)""")
        x("""INSERT INTO core.players(id,name) VALUES (7001,'Retour Sélection'),(7002,'Transfert'),(7003,'Match Annulé'),(7004,'Même Jour')""")

        def match(mid, home, away, day, status="finished"):
            x("""INSERT INTO core.matches(id,competition_season_id,season_id,source,status,home_team_id,away_team_id,home_score,away_score,match_date)
                 VALUES(%s,1,2025,'pitchapi',%s,%s,%s,%s,%s,%s)""",
              (mid, status, home, away, *((1, 0) if status == "finished" else (None, None)), day))

        for w, day in enumerate(WEEK):
            match(5000 + w, 501, 502, day)  # the club plays every Saturday
            match(5100 + w, 503, 502, day + timedelta(days=1))
        match(5200, 599, 598, WEEK[10] + timedelta(days=4))  # national-team games, on Wednesdays
        match(5201, 599, 598, WEEK[16] + timedelta(days=4))
        match(5300, 501, 502, WEEK[10] + timedelta(days=2), status="canceled")
        match(5400, 501, 503, WEEK[14])  # a second club match on the day of week 14

        def played(player, mid, team, minutes):
            x("INSERT INTO core.player_match_stats(season_id,match_id,team_id,player_id,minutes_played) VALUES(2025,%s,%s,%s,%s)",
              (mid, team, player, minutes))

        for player in (7001, 7002, 7003, 7004):
            for w in range(8):
                played(player, 5000 + w, 501, 90)
        # 7001: back at weeks 14, 15 and 17; for his country at weeks 10 and 16.
        played(7001, 5200, 599, 90)
        played(7001, 5201, 599, 90)
        for w, minutes in ((14, 30), (15, 60), (17, 90)):
            played(7001, 5000 + w, 501, minutes)
        # 7002: back at another club (a transfer, not a return).
        for w in (14, 15):
            played(7002, 5100 + w, 503, 90)
        # 7003: a canceled club match during his absence.
        played(7003, 5300, 501, 90)
        for w in (14, 15):
            played(7003, 5000 + w, 501, 45)
        # 7004: two club matches on the day he comes back, then week 15.
        played(7004, 5014, 501, 60)
        played(7004, 5400, 501, 30)
        played(7004, 5015, 501, 90)
        from vega import returns

        cls.returns = returns
        minimum, returns.MIN_RETURNS = returns.MIN_RETURNS, 1
        try:
            cls.result = returns.refresh(cls.db, WEEK[18])
        finally:
            returns.MIN_RETURNS = minimum

    def test_1_the_players_coming_back(self):
        rows = self.db.execute(
            """SELECT player_id, team_id, absent_from, returned_on, days, matches_missed, matches_back, bucket, usual_minutes, minutes_back
               FROM agg.player_returns ORDER BY player_id"""
        ).fetchall()
        self.assertEqual(rows, [
            (7001, 501, WEEK[7], WEEK[14], 49, 6, 3, "30_59", 90.0, 60.0),
            (7003, 501, WEEK[7], WEEK[14], 49, 6, 2, "30_59", 90.0, 45.0),
            (7004, 501, WEEK[7], WEEK[14], 49, 6, 3, "30_59", 90.0, 60.0),
        ])

    def test_2_the_curve_of_the_matches_back(self):
        rows = self.db.execute(
            "SELECT bucket, match_no, returns, minutes, usual_minutes FROM agg.return_curves ORDER BY bucket, match_no"
        ).fetchall()
        self.assertEqual(rows, [("30_59", 1, 3, 45.0, 90.0), ("30_59", 2, 3, 45.0, 90.0), ("30_59", 3, 2, 90.0, 90.0)])

    def test_3_the_club_stream_is_a_new_definition(self):
        versions = {v for (v,) in self.db.execute("SELECT DISTINCT version FROM agg.return_curves")}
        self.assertEqual(versions, {self.returns.MODEL_VERSION})
        self.assertNotEqual(self.returns.MODEL_VERSION, "returns-v1")


# The fourteen statistics of the synthetic players (test_models.py's own list).
STATS = ["goals", "assists", "total_shots", "shots_on_target", "accurate_passes", "touches", "tackles", "interceptions",
         "clearances", "recoveries", "duels_won", "duels_lost", "dribbles_succeeded", "chances_created"]


@unittest.skipUnless(DSN and psycopg, "requires disposable local models DB and psycopg")
class EmbeddingRefreshTest(unittest.TestCase):
    """FM-B8.1, FM-B8.3, FM-B8.4: the season's vectors are those of eligible players only."""

    @classmethod
    def setUpClass(cls):
        cls.db = _connect()
        cls.addClassCleanup(_drop, cls.db)
        x = cls.db.execute
        forward = [0.5, 0.2, 3, 1.2, 20, 40, 0.5, 0.3, 0.2, 2, 3, 4, 2.5, 1.5]
        defender = [0.05, 0.05, 0.4, 0.1, 55, 70, 2.5, 2, 4.5, 6, 5, 3, 0.3, 0.3]
        values = ", ".join(f"round((CASE WHEN mod(g, 2) = 0 THEN {f} ELSE {d} END) * 20 * (0.85 + mod(g * {7 + i}, 30) / 100.0))::int, 1800"
                           for i, (f, d) in enumerate(zip(forward, defender)))
        columns = ", ".join(f"{key}_sum, {key}_min" for key in STATS)
        x("INSERT INTO core.teams(id,name) VALUES (1,'Club')")
        x("INSERT INTO core.players(id,name) SELECT 8000 + g, 'Synthetic ' || g FROM generate_series(1, 210) g")
        # 205 measured players; 8301 and 8302 played 1,800 minutes the source measured nothing of;
        # 8303 lacks one statistic of fourteen (93 %), 8304 two (86 %).
        x(f"""INSERT INTO agg.player_season_stats(player_id, team_id, competition_season_id, season_id, appearances, starts, minutes, {columns})
              SELECT 8000 + g, 1, 1, 2025, 20, 20, 1800, {values} FROM generate_series(1, 205) g""")
        x("INSERT INTO core.players(id,name) VALUES (8301,'Vide Un'),(8302,'Vide Deux'),(8303,'Presque'),(8304,'Partiel')")
        x("INSERT INTO agg.player_season_stats(player_id, team_id, competition_season_id, season_id, appearances, starts, minutes) VALUES (8301,1,1,2025,20,20,1800),(8302,1,1,2025,20,20,1800)")
        for player, missing in ((8303, {"assists"}), (8304, {"assists", "shots_on_target"})):
            known = [k for k in STATS if k not in missing]
            x(f"""INSERT INTO agg.player_season_stats(player_id, team_id, competition_season_id, season_id, appearances, starts, minutes,
                    {", ".join(f"{k}_sum, {k}_min" for k in known)})
                  VALUES ({player}, 1, 1, 2025, 20, 20, 1800, {", ".join("40, 1800" for _ in known)})""")

    def placed(self):
        return {p for (p,) in self.db.execute("SELECT player_id FROM agg.player_embeddings WHERE season_id=2025")}

    def test_eligible_players_only_then_a_second_refresh(self):
        from vega import embedding

        self.assertEqual(embedding.refresh(self.db, 2025), 206)
        found = self.placed()
        self.assertEqual(found & {8301, 8302, 8304}, set())
        self.assertIn(8303, found)
        self.assertEqual(len(found), 206)
        version, players, statistics = self.db.execute("SELECT version, players, statistics FROM agg.embedding_models WHERE season_id=2025").fetchone()
        self.assertEqual((version, players, statistics), (embedding.MODEL_VERSION, 206, 14))
        self.assertNotEqual(version, "profile-embedding-v1")
        # 8303's statistics are withdrawn (a correction of the source): his vector goes.
        self.db.execute(f"UPDATE agg.player_season_stats SET {', '.join(f'{k}_sum = NULL, {k}_min = NULL' for k in STATS)} WHERE player_id = 8303")
        self.assertEqual(embedding.refresh(self.db, 2025), 205)
        self.assertNotIn(8303, self.placed())


@unittest.skipUnless(DSN and psycopg, "requires disposable local models DB and psycopg")
class EmbeddingNonFiniteRefreshTest(unittest.TestCase):
    """FM-B8.6 on the refresh path: a NaN in a statistic the axes read is a missing value."""

    @classmethod
    def setUpClass(cls):
        cls.db = _connect()
        cls.addClassCleanup(_drop, cls.db)
        x = cls.db.execute
        forward = [0.5, 0.2, 3, 1.2, 20, 40, 0.5, 0.3, 0.2, 2, 3, 4, 2.5, 1.5]
        defender = [0.05, 0.05, 0.4, 0.1, 55, 70, 2.5, 2, 4.5, 6, 5, 3, 0.3, 0.3]
        values = ", ".join(f"round((CASE WHEN mod(g, 2) = 0 THEN {f} ELSE {d} END) * 20 * (0.85 + mod(g * {7 + i}, 30) / 100.0))::int, 1800"
                           for i, (f, d) in enumerate(zip(forward, defender)))
        columns = ", ".join(f"{key}_sum, {key}_min" for key in STATS)
        x("INSERT INTO core.teams(id,name) VALUES (1,'Club')")
        x("INSERT INTO core.players(id,name) SELECT 8000 + g, 'Synthetic ' || g FROM generate_series(1, 206) g")
        # 206 players measured on the fourteen and on their xG (a real); 8206's xG is NaN.
        x(f"""INSERT INTO agg.player_season_stats(player_id, team_id, competition_season_id, season_id, appearances, starts, minutes, {columns}, xg_sum, xg_min)
              SELECT 8000 + g, 1, 1, 2025, 20, 20, 1800, {values},
                     CASE WHEN g = 206 THEN 'NaN'::real ELSE (CASE WHEN mod(g, 2) = 0 THEN 9.0 ELSE 1.0 END * (0.8 + mod(g * 13, 40) / 100.0))::real END, 1800
              FROM generate_series(1, 206) g""")

    def test_a_nan_statistic_is_missing_and_the_vectors_stay_finite(self):
        from vega import embedding

        self.assertEqual(embedding.refresh(self.db, 2025), 206)  # 8206: 14 of 15 known, placed
        statistics = self.db.execute("SELECT statistics FROM agg.embedding_models WHERE season_id=2025").fetchone()[0]
        self.assertEqual(statistics, 15)
        rows = self.db.execute("SELECT player_id, e1, e2, e3, e4, e5, e6, e7, e8, e9, e10 FROM agg.player_embeddings WHERE season_id=2025").fetchall()
        self.assertEqual(len(rows), 206)
        self.assertTrue(all(math.isfinite(v) for r in rows for v in r[1:]), "a vector is not finite")
        self.assertGreater(len({r[1:] for r in rows}), 100, "the vectors collapsed")


# Shots of the synthetic base: one in five a header, one in ninety-seven a penalty, the closer
# the more often a goal (test_models.py's), from 1 to 30 metres.
SHOTS = """INSERT INTO core.shots(season_id, match_id, shot_no, x, y, outcome, situation, body_part, is_own_goal)
SELECT 2025, (%(matches)s::int[])[1 + mod(g, %(n)s)], 1000 + g / %(n)s, 105 - (1 + mod(g, 30)), 34 + (mod(g, 7) - 3) * 3,
  (CASE WHEN mod(g, 97) = 0 THEN (CASE WHEN mod(g, 4) = 0 THEN 'miss' ELSE 'goal' END)
        WHEN mod(g * 7919, 1000) / 1000.0 < exp(-(1 + mod(g, 30)) / 8.0) THEN 'goal' ELSE 'miss' END)::core.shot_outcome,
  (CASE WHEN mod(g, 97) = 0 THEN 'penalty' ELSE (ARRAY['regular_play','from_corner','set_piece','fast_break','free_kick','throw_in_set_piece','individual_play'])[1 + mod(g, 7)] END)::core.shot_situation,
  (CASE WHEN mod(g, 5) = 0 THEN 'header' WHEN mod(g, 211) = 0 THEN 'other' ELSE 'right_foot' END)::core.body_part, false
FROM generate_series(0, 5999) g"""
DOCUMENTED = [-1.375, 1.027, -0.167, 0.155, 1.467, 0.114, -0.177, -0.706, -0.414, 0.510, 0.608, -0.478, -0.377, -1.374]


@unittest.skipUnless(DSN and psycopg, "requires disposable local models DB and psycopg")
class XgVersionTest(unittest.TestCase):
    """FM-B9.2, FM-B9.3: the SQL scores with Python's bounded law; a stored unconstrained model
    does not survive the new definition."""

    @classmethod
    def setUpClass(cls):
        from vega import xg

        cls.db = _connect()
        cls.addClassCleanup(_drop, cls.db)
        x = cls.db.execute
        x("INSERT INTO core.teams(id,name) VALUES (1,'Home'),(2,'Away')")
        x("""INSERT INTO core.matches(id,competition_season_id,season_id,source,status,home_team_id,away_team_id,home_score,away_score,match_date)
             SELECT g, 1, 2025, 'pitchapi', 'finished', 1, 2, 1, 0, DATE '2025-09-01' + g FROM generate_series(1, 40) g""")
        matches = list(range(1, 41))
        x(SHOTS, {"matches": matches, "n": len(matches)})
        # Two shots on the goal's centre line: 900 is 10 metres out (x = 95), 901 is 95 metres out.
        x("""INSERT INTO core.shots(season_id, match_id, shot_no, x, y, outcome, situation, body_part, is_own_goal)
             VALUES (2025, 1, 900, 95, 34, 'miss', 'regular_play', 'right_foot', false), (2025, 1, 901, 10, 34, 'miss', 'regular_play', 'right_foot', false)""")
        cls.held = x(f"SELECT count(*) {xg._SHOTS} AND s.situation IS DISTINCT FROM 'penalty'").fetchone()[0]
        minimum, xg.MIN_FIT = xg.MIN_FIT, 1000
        cls.addClassCleanup(setattr, xg, "MIN_FIT", minimum)

    def store_model(self, version, coefficients, penalty=0.75):
        from vega import xg

        self.db.execute("DELETE FROM agg.shot_xg")
        self.db.execute("DELETE FROM agg.xg_models")
        return self.db.execute(
            f"""INSERT INTO agg.xg_models(version, shots, goals, penalty, {', '.join(xg.TERMS)})
                VALUES (%s, %s, 600, %s, {', '.join(['%s'] * len(xg.TERMS))}) RETURNING id""",
            (version, self.held, penalty, *coefficients),
        ).fetchone()[0]

    def test_1_a_stored_unconstrained_model_is_replaced_and_every_shot_rescored(self):
        from vega import xg

        stale = self.store_model("xg-v1", DOCUMENTED)
        xg.refresh(self.db, 2025)
        models = self.db.execute(f"SELECT id, version, {', '.join(xg.TERMS)} FROM agg.xg_models").fetchall()
        self.assertEqual(len(models), 1)
        ident, version, *beta = models[0]
        self.assertNotEqual(ident, stale)
        self.assertEqual(version, xg.MODEL_VERSION)
        self.assertNotEqual(version, "xg-v1")
        t = {name: i for i, name in enumerate(xg.TERMS)}
        self.assertLessEqual(max(beta[t["distance"]], beta[t["distance_sq"]], beta[t["header_distance"]]), 1e-12)
        self.assertGreaterEqual(beta[t["angle"]], -1e-12)
        self.assertLessEqual(abs(beta[t["angle_distance"]]), 1e-12)
        self.assertEqual(self.db.execute("SELECT count(DISTINCT model_id), min(model_id) FROM agg.shot_xg").fetchone(), (1, ident))
        near, far = (self.db.execute("SELECT xg FROM agg.shot_xg WHERE match_id=1 AND shot_no=%s", (n,)).fetchone()[0] for n in (900, 901))
        self.assertLessEqual(far, near)

    def test_2_the_sql_score_is_python_s_bounded_law(self):
        from vega import xg

        # Each shot's situation, body part, distance and angle as the SQL reads them.
        where = f"{xg._SHOTS} AND s.season_id = 2025 AND s.situation IS DISTINCT FROM 'penalty' AND s.match_id <= 3"
        shots = {(m, n): (situation, body, d, th) for m, n, situation, body, d, th in self.db.execute(
            f"""SELECT s.match_id, s.shot_no, coalesce(s.situation::text, 'regular_play'), coalesce(s.body_part::text, 'right_foot'),
                       {xg._GEOMETRY} {where}""").fetchall()}
        self.assertGreater(len(shots), 100)
        t = {name: i for i, name in enumerate(xg.TERMS)}
        # Logits beyond ±30 for every shot (-45), across it with the distance, a header and a
        # corner (-20 - 0.9 d ...), and far beyond (-800: the baseline's SQL overflows).
        varied = [0.0] * len(xg.TERMS)
        varied[t["intercept"]], varied[t["distance"]], varied[t["header"]], varied[t["from_corner"]] = -20.0, -0.9, -1.0, 0.5
        for coefficients in ([-45.0] + [0.0] * (len(xg.TERMS) - 1), varied, [-800.0] + [0.0] * (len(xg.TERMS) - 1)):
            self.store_model(xg.MODEL_VERSION, coefficients)
            xg.refresh(self.db, 2025)
            scored = self.db.execute(f"""SELECT v.match_id, v.shot_no, v.xg FROM agg.shot_xg v
                                         WHERE (v.match_id, v.shot_no) IN (SELECT s.match_id, s.shot_no {where})""").fetchall()
            self.assertEqual(len(scored), len(shots), coefficients[:3])
            # agg.shot_xg.xg is a real (080): equal to one float4 step (2^-23). The baseline's
            # unbounded SQL gives 2.9e-20 for Python's 9.4e-14 at -45, and overflows at -800.
            wrong = [(m, n, value) for m, n, value in scored
                     if not math.isclose(value, xg.probability(coefficients, xg.features(*shots[(m, n)])), rel_tol=2 ** -23, abs_tol=0)]
            self.assertEqual(wrong[:3], [], f"{coefficients[:3]}: {len(wrong)} shots where SQL != Python")


def _shots_in(db, season, matches, first, count):
    """SHOTS in another season and another range of shot numbers."""
    statement = SHOTS.replace("SELECT 2025, ", "SELECT %(season)s::smallint, ").replace("generate_series(0, 5999)", "generate_series(%(first)s::int, %(last)s::int)")
    assert statement != SHOTS and "%(season)s" in statement and "%(first)s" in statement
    db.execute(statement, {"season": season, "matches": matches, "n": len(matches), "first": first, "last": first + count - 1})


@unittest.skipUnless(DSN and psycopg, "requires disposable local models DB and psycopg")
class XgFailedFitTest(unittest.TestCase):
    """FM-B9.4, FM-B9.5 (FAILURE_MODES §10.2, stage 3): a fit that did not converge, or whose
    coefficients are not finite or not feasible, is never published, and nothing that was
    published changes. The failure is forced through a wrapper of the real fitter."""

    @classmethod
    def setUpClass(cls):
        from vega import xg
        from vega.store import Store

        cls.db = _connect()
        cls.addClassCleanup(_drop, cls.db)
        x = cls.db.execute
        with cls.db.transaction():
            Store(cls.db).season("2026/2027")
        x("INSERT INTO core.competition_seasons(id,competition_id,season_id,native_label) VALUES(2,1,2026,'2026/2027')")
        x("INSERT INTO core.teams(id,name) VALUES (1,'Home'),(2,'Away')")
        cls.matches = {}
        for season, edition, first in ((2025, 1, 1), (2026, 2, 101)):
            ids = list(range(first, first + 40))
            x("""INSERT INTO core.matches(id,competition_season_id,season_id,source,status,home_team_id,away_team_id,home_score,away_score,match_date)
                 SELECT g, %s, %s, 'pitchapi', 'finished', 1, 2, 1, 0, DATE '2025-09-01' + g FROM generate_series(%s::int, %s::int) g""",
              (edition, season, ids[0], ids[-1]))
            cls.matches[season] = ids
            _shots_in(cls.db, season, ids, 0, 6000)
        minimum, xg.MIN_FIT = xg.MIN_FIT, 1000
        cls.addClassCleanup(setattr, xg, "MIN_FIT", minimum)

    def snapshot(self):
        from vega import xg

        models = self.db.execute(f"SELECT id, version, fitted_at, shots, goals, penalty, {', '.join(xg.TERMS)} FROM agg.xg_models ORDER BY id").fetchall()
        scores = self.db.execute("SELECT season_id, match_id, shot_no, xg, model_id FROM agg.shot_xg ORDER BY 1, 2, 3").fetchall()
        return models, scores

    def assert_snapshot(self, expected, message):
        """Exact equality of the published models and scores, with a bounded failure message:
        unittest's diff of thousands of score rows would take minutes to render."""
        got = self.snapshot()
        if got == expected:
            return
        (models, scores), (want_models, want_scores) = got, expected
        differ = sum(1 for a, b in zip(scores, want_scores) if a != b) + abs(len(scores) - len(want_scores))
        self.fail(f"{message}: models {[m[:2] for m in want_models]} -> {[m[:2] for m in models]}; "
                  f"score rows {len(want_scores)} -> {len(scores)}, {differ} differ; first now {scores[:2]}")

    def refresh_with(self, fitter):
        """xg.refresh with `fitter(real, bins, **kwargs)` in place of xg.fit; the error it raised, or None."""
        from vega import xg

        real = xg.fit
        xg.fit = lambda bins, **kwargs: fitter(real, bins, **kwargs)
        try:
            xg.refresh(self.db, 2025)
        except Exception as error:  # the explicit failure the contract asks for
            return error
        finally:
            xg.fit = real
        return None

    def assert_failed(self, error, words):
        self.assertIsNotNone(error, "the failed fit raised nothing")
        self.assertEqual(type(error).__name__, "FitFailed", repr(error))
        self.assertIn(words, str(error))

    @staticmethod
    def no_iterations(real, bins, **kwargs):
        return real(bins, **{**kwargs, "iterations": 0})

    def test_1_a_refit_that_does_not_converge_changes_nothing(self):
        from vega import xg

        self.assertGreater(xg.refresh(self.db, 2025), 0)  # the real fit: published, every season scored
        before = self.snapshot()
        models, scores = before
        self.assertEqual(len(models), 1)
        self.assertEqual({row[0] for row in scores}, {2025, 2026})
        # A third more shots: the next refresh fits again (REFIT_GROWTH), and that fit fails.
        _shots_in(self.db, 2026, self.matches[2026], 6000, 4000)
        error = self.refresh_with(self.no_iterations)
        self.assert_snapshot(before, "a fit that did not converge changed the published model or its scores")
        self.assert_failed(error, "converge")

    def test_2_a_first_fit_that_does_not_converge_writes_nothing(self):
        self.db.execute("DELETE FROM agg.shot_xg")
        self.db.execute("DELETE FROM agg.xg_models")
        error = self.refresh_with(self.no_iterations)
        self.assert_snapshot(([], []), "a fit that did not converge was published")
        self.assert_failed(error, "converge")

    def test_3_coefficients_not_finite_or_not_feasible_are_not_published(self):
        from vega import xg

        self.db.execute("DELETE FROM agg.shot_xg")
        self.db.execute("DELETE FROM agg.xg_models")
        t = {name: i for i, name in enumerate(xg.TERMS)}

        def altered(change):
            def fitter(real, bins, **kwargs):
                coefficients, info = real(bins, **{**kwargs, "diagnostics": True})
                coefficients = list(coefficients)
                change(coefficients)
                return (coefficients, info) if kwargs.get("diagnostics") else coefficients
            return fitter

        for name, change, words in (
            ("not finite", lambda c: c.__setitem__(t["angle"], float("nan")), "finite"),
            ("not feasible", lambda c: c.__setitem__(t["distance_sq"], 0.1), "constraint"),
        ):
            error = self.refresh_with(altered(change))
            self.assert_snapshot(([], []), f"a model {name} was published")
            self.assert_failed(error, words)


def _xg_snapshot(db):
    """The published xG: its models (every column) and every score, in a stable order."""
    from vega import xg

    models = db.execute(f"SELECT id, version, fitted_at, shots, goals, penalty, {', '.join(xg.TERMS)} FROM agg.xg_models ORDER BY id").fetchall()
    scores = db.execute("SELECT season_id, match_id, shot_no, xg, model_id FROM agg.shot_xg ORDER BY 1, 2, 3").fetchall()
    return models, scores


# The calls a season's daily pass makes, in models.refresh_daily's order, among those the test records.
PASS = ["refresh_players", "forecast", "inplay", "xg", "embedding", "breakout", "actions", "returns"]


@unittest.skipUnless(DSN and psycopg, "requires disposable local models DB and psycopg")
class DailyPassXgRejectionTest(unittest.TestCase):
    """FAILURE_MODES §10.3 (stage 4): a rejected xG fit (FitFailed: nothing written) does not stop
    the season's other daily models; the season's step still fails, with the worker's backoff and
    no « outcome=ok ». The real Worker.daily() runs the real models.refresh_daily on two due
    seasons. Recording no-ops stand in only for the owners' expensive algorithms (VI-21 power and
    Elo, VI-19 forecast, in-play and line-ups); spies record the pass's own models, whose real
    functions run; the fit fails through the iterations=0 wrapper of the real fitter."""

    def setUp(self):
        from vega import actions, breakout, embedding, forecast, inplay, lineup, power, returns, xg
        from vega.store import Store
        from vega.worker import Worker

        self.db = _connect()
        self.addCleanup(_drop, self.db)
        x = self.db.execute
        with self.db.transaction():
            Store(self.db).season("2026/2027")
        x("INSERT INTO core.competition_seasons(id,competition_id,season_id,native_label) VALUES(2,1,2026,'2026/2027')")
        x("INSERT INTO core.teams(id,name) VALUES (1,'Home'),(2,'Away')")
        x("INSERT INTO core.players(id,name) VALUES (11,'Joueur Suivi')")
        self.matches = {}
        for season, edition, first in ((2025, 1, 1), (2026, 2, 101)):
            x("""INSERT INTO core.matches(id,competition_season_id,season_id,source,status,home_team_id,away_team_id,home_score,away_score,match_date)
                 SELECT g, %s, %s, 'pitchapi', 'finished', 1, 2, 1, 0, DATE '2025-09-01' + g FROM generate_series(%s::int, %s::int) g""",
              (edition, season, first, first + 39))
            x("""INSERT INTO core.player_match_stats(season_id,match_id,team_id,player_id,minutes_played,goals)
                 SELECT %s, g, 1, 11, 90, 0 FROM generate_series(%s::int, %s::int) g""", (season, first, first + 39))
            self.matches[season] = list(range(first, first + 40))
            _shots_in(self.db, season, self.matches[season], 0, 6000)
        self.calls = []

        def patch(module, name, value):
            self.addCleanup(setattr, module, name, getattr(module, name))
            setattr(module, name, value)

        def record(label, real=None, seasonal=True):
            def call(conn, *args, **kwargs):
                self.calls.append((label, args[0] if seasonal and args else None))
                return real(conn, *args, **kwargs) if real is not None else None
            return call

        self.patch = patch
        self.real_fit, self.real_refresh = xg.fit, xg.refresh
        # The owners' expensive algorithms: recording no-ops.
        for module, name, seasonal in ((power, "refresh_players", True), (power, "refresh_power", True), (power, "refresh_elo", False),
                                       (forecast, "refresh", True), (inplay, "refresh", False), (lineup, "refresh", False)):
            patch(module, name, record(name if module is power else module.__name__.rsplit(".", 1)[-1], seasonal=seasonal))
        patch(power, "previous_year_changed", lambda conn, season: False)
        patch(power, "stale_rankings", lambda conn: [])
        # The pass's own models: spies around the real functions.
        for label, module in (("xg", xg), ("embedding", embedding), ("breakout", breakout), ("actions", actions)):
            patch(module, "refresh", record(label, module.refresh))
        patch(returns, "refresh", record("returns", returns.refresh, seasonal=False))
        patch(xg, "MIN_FIT", 1000)
        self.now = datetime(2026, 11, 17, 12, tzinfo=timezone.utc)
        self.worker = Worker(Store(self.db), types.SimpleNamespace(), clock=lambda: self.now, cohort_delay=0)

    def fail_fits(self):
        from vega import xg

        self.patch(xg, "fit", lambda bins, **kwargs: self.real_fit(bins, **{**kwargs, "iterations": 0}))

    def daily(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            seasons = self.worker.daily()
        self.assertEqual(seasons, [2026, 2025])  # both due; the most recent first
        return out.getvalue()

    def passes(self):
        """Each season's recorded calls, from its ranking on."""
        out, current = {}, None
        for label, season in self.calls:
            if label == "refresh_players":
                current = season
                out[current] = []
            if current is not None:
                out[current].append(label)
        return out

    def listed(self):
        """The editions whose player list the pass recounted (no other step writes it here)."""
        return [e for (e,) in self.db.execute("SELECT DISTINCT competition_season_id FROM agg.player_list_editions ORDER BY 1")]

    def assert_rejected(self, log, season):
        self.assertIn(f"daily models season={season} xg=rejected error=FitFailed", log)
        self.assertNotIn(f"daily models season={season} outcome=ok", log)

    def test_1_a_rejected_fit_lets_the_season_s_other_models_run_and_fails_the_step(self):
        self.real_refresh(self.db, 2025)  # a model fitted and published, every season scored
        _shots_in(self.db, 2026, self.matches[2026], 6000, 4000)  # enough new shots to fit again
        before = _xg_snapshot(self.db)
        self.assertEqual((len(before[0]), len(before[1])), (1, 12000))
        self.fail_fits()
        log = self.daily()
        self.assertEqual(self.passes(), {2026: PASS, 2025: PASS}, "the models after the xG did not run")
        self.assertEqual(self.listed(), [1, 2], "the editions' recount did not run")
        self.assertTrue(_xg_snapshot(self.db) == before, "a rejected fit changed the published model or its scores")
        for season in (2026, 2025):
            self.assert_rejected(log, season)
            self.assertRegex(log, rf"daily step=season {season} error=WORKER_FITFAILED@xg\.py:\d+ retry_at=")
            self.assertIn(("season", season), self.worker._retry_at)
        self.assertNotIn("converge", log)  # the exception's text is never logged

    def test_2_a_later_failure_is_the_one_the_worker_logs(self):
        from vega import actions

        self.fail_fits()

        def broken(conn, season):
            self.calls.append(("actions", season))
            return 1 / 0

        self.patch(actions, "refresh", broken)
        log = self.daily()
        self.assertEqual(self.passes(), {2026: PASS[:7], 2025: PASS[:7]})
        self.assertEqual(self.listed(), [], "the steps after the failing one ran")
        for season in (2026, 2025):
            self.assert_rejected(log, season)
            step = re.search(rf"daily step=season {season} error=(\S+) retry_at=", log)
            self.assertIsNotNone(step, log)
            self.assertRegex(step.group(1), r"^WORKER_ZERODIVISIONERROR@test_audit_models\.py:\d+$")
            self.assertLess(log.index(f"daily models season={season} xg=rejected"), step.start())

    def test_3_a_fit_that_succeeds_keeps_the_normal_outcome(self):
        log = self.daily()
        self.assertEqual(self.passes(), {2026: PASS, 2025: PASS})
        self.assertEqual(self.listed(), [1, 2])
        models, scores = _xg_snapshot(self.db)
        self.assertEqual((len(models), {row[0] for row in scores}), (1, {2025, 2026}))
        for season in (2026, 2025):
            self.assertIn(f"daily models season={season} outcome=ok", log)
        self.assertNotIn("xg=rejected", log)
        self.assertEqual(self.worker._retry_at, {})

    def test_4_too_few_shots_keep_the_normal_outcome(self):
        from vega import xg

        self.patch(xg, "MIN_FIT", 10 ** 9)
        log = self.daily()
        self.assertEqual(self.passes(), {2026: PASS, 2025: PASS})
        self.assertEqual(self.listed(), [1, 2])
        self.assertEqual(_xg_snapshot(self.db), ([], []))
        for season in (2026, 2025):
            self.assertIn(f"daily models season={season} outcome=ok", log)
        self.assertNotIn("xg=rejected", log)

    def test_5_an_unexpected_error_in_the_fit_stops_the_pass_at_once(self):
        from vega import xg

        def bug(bins, **kwargs):
            raise ValueError("an unexpected fault")

        self.patch(xg, "fit", bug)
        log = self.daily()
        self.assertEqual(self.passes(), {2026: PASS[:4], 2025: PASS[:4]})
        self.assertEqual(self.listed(), [])
        for season in (2026, 2025):
            self.assertRegex(log, rf"daily step=season {season} error=WORKER_VALUEERROR@test_audit_models\.py:\d+ retry_at=")
            self.assertNotIn(f"daily models season={season} outcome=ok", log)
        self.assertNotIn("xg=rejected", log)
        self.assertNotIn("unexpected fault", log)

    def test_6_a_database_error_in_the_xg_stops_the_pass_at_once(self):
        from vega import xg

        self.patch(xg, "BINS", "SELECT FROM WHERE")  # a syntax error from the database (42601)
        log = self.daily()
        self.assertEqual(self.passes(), {2026: PASS[:4], 2025: PASS[:4]})
        self.assertEqual(self.listed(), [])
        for season in (2026, 2025):
            self.assertRegex(log, rf"daily step=season {season} error=DATABASE_42601 retry_at=")
        self.assertNotIn("xg=rejected", log)
