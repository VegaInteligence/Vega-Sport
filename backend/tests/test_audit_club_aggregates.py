"""Calculation audit of 16 Nov 2026 (VI-23), batches B6 (SQL law) and B10, on a real local
PostgreSQL. Written before the corrections (docs/calculs/09-audit-2026-11/FAILURE_MODES.md
§7.4 and §11). B7's proposed tests are an owner handoff, kept out of the runnable suites
(FAILURE_MODES.md §8).

Each class migrates the dedicated local agg DB, writes its own league, runs the real calculator
(and the club cohort's percentiles for B10) and reads what the API and the cohorts read. The
schemas are dropped at the end, so test_calculator.py still finds the DB empty.
"""

import json
import math
import os
import sys
import unittest
from datetime import date, timedelta
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
FIXTURES = Path(__file__).resolve().parent / "fixtures"


def _connect():
    target = urlparse(DSN)
    if target.hostname not in ("localhost", "127.0.0.1", "::1") or target.path != "/vega_v2_agg_test":
        raise RuntimeError("dedicated local agg DB required")
    from vega.store import Store

    db = fresh(DSN)
    with db.transaction():
        Store(db).season("2025/2026")
    db.execute("INSERT INTO core.countries(code) VALUES ('FRA') ON CONFLICT DO NOTHING")
    db.execute("INSERT INTO core.competitions(id,name,kind,country_code) VALUES(1,'League','league','FRA')")
    db.execute("INSERT INTO core.competition_seasons(id,competition_id,season_id,native_label) VALUES(1,1,2025,'2025/2026')")
    return db


def _drop(db):
    db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
    db.close()


def law(a, b, n=200):
    """Independent reference of the expected-points law (FAILURE_MODES §7.4): floor 0.01,
    log-space Poisson probabilities, 200 goals a side, every outcome summed."""
    a, b = max(a, 0.01), max(b, 0.01)
    pmf = lambda l: [math.exp(-l + k * math.log(l) - math.lgamma(k + 1)) for k in range(n)]
    pa, pb = pmf(a), pmf(b)
    win = math.fsum(pa[i] * pb[j] for i in range(n) for j in range(i))
    draw = math.fsum(pa[i] * pb[i] for i in range(n))
    loss = math.fsum(pa[i] * pb[j] for i in range(n) for j in range(i + 1, n))
    return win, draw, loss, 3 * win + draw


@unittest.skipUnless(DSN and psycopg, "requires disposable local agg DB and psycopg")
class ExpectedPointsLawTest(unittest.TestCase):
    """FM-B6 xPts (audit 10): the SQL law behind api.match_xpts and the calculator's xPts."""

    # (home xG, away xG): one match each, between two clubs of their own.
    PAIRS = [(6.0, 6.0), (0.0, 0.0), (1.0, 1.0), (6.0, 1.0), (8.0, 1.0), (1.8, 0.9), (-0.5, 1.0), (float("nan"), 1.0)]

    @classmethod
    def setUpClass(cls):
        cls.db = _connect()
        cls.addClassCleanup(_drop, cls.db)
        x = cls.db.execute
        for i, (home, away) in enumerate(cls.PAIRS, 1):
            x("INSERT INTO core.teams(id,name) VALUES(%s,%s),(%s,%s)", (100 + 2 * i, f"H{i}", 101 + 2 * i, f"A{i}"))
            x("""INSERT INTO core.matches(id,competition_season_id,season_id,source,status,home_team_id,away_team_id,home_score,away_score,match_date)
                 VALUES(%s,1,2025,'pitchapi','finished',%s,%s,1,1,%s)""", (i, 100 + 2 * i, 101 + 2 * i, date(2025, 9, 1) + timedelta(days=i)))
            for team, xg in ((100 + 2 * i, home), (101 + 2 * i, away)):
                x("INSERT INTO core.team_match_stats(season_id,match_id,team_id,period,xg) VALUES(2025,%s,%s,'all',%s)", (i, team, xg))
        from vega.calculator import refresh_competition_season

        refresh_competition_season(cls.db, 1)

    def law_of(self, match, team):
        return self.db.execute("SELECT p_win, p_draw, p_loss, xpts FROM api.match_xpts WHERE match_id=%s AND team_id=%s", (match, team)).fetchone()

    def test_1_the_law_is_symmetric_and_complete(self):
        # 6 v 6: the baseline's ten-goal truncation gives 40.04 % against 48.38 % (audit 10).
        win, draw, loss, xpts = self.law_of(1, 102)
        self.assertAlmostEqual(win, loss, delta=1e-6)
        self.assertAlmostEqual(win + draw + loss, 1, delta=1e-6)
        self.assertAlmostEqual(xpts, 1.441786889393, delta=2e-6)
        self.assertAlmostEqual(self.law_of(1, 103)[3], xpts, delta=1e-6)

    def test_2_the_law_matches_the_reference_and_its_floor(self):
        for i, (home, away) in enumerate(self.PAIRS[:6], 1):
            reference = law(home, away)
            got = self.law_of(i, 100 + 2 * i)
            for name, value, want in zip(("win", "draw", "loss", "xpts"), got, reference):
                self.assertAlmostEqual(value, want, delta=2e-6, msg=f"{home} v {away} {name}")
        # Monotonic in the club's own xG at 1 xG against (audit: 2.793 then 2.428).
        self.assertGreater(self.law_of(5, 110)[3], self.law_of(4, 108)[3])

    def test_3_an_impossible_xg_has_no_law(self):
        # A negative or not-a-number xG is rejected before the floor (FAILURE_MODES §7.4).
        for i in (7, 8):
            self.assertEqual(self.law_of(i, 100 + 2 * i), (None, None, None, None), self.PAIRS[i - 1])

    def test_4_the_calculator_reads_the_same_law(self):
        xpts, matches = self.db.execute("SELECT xpts, xpts_matches FROM agg.team_season_stats WHERE team_id=102").fetchone()
        self.assertEqual(matches, 1)
        self.assertAlmostEqual(xpts, 1.441786889393, delta=2e-6)
        self.assertAlmostEqual(self.db.execute("SELECT xpts FROM agg.team_season_stats WHERE team_id=104").fetchone()[0], 1.009851652188, delta=2e-6)

    def test_6_the_view_calls_the_law_once_per_row(self):
        # FAILURE_MODES §14.6 (stage 5): `(SELECT (agg.xpts_v2(...)).*)` called the law once per
        # output column. Counted in this transaction (track_functions), with the view's columns.
        with self.db.transaction():
            self.db.execute("SET LOCAL track_functions = 'pl'")
            rows = self.db.execute("SELECT * FROM api.match_xpts").fetchall()
            calls = self.db.execute(
                "SELECT pg_stat_get_xact_function_calls('agg.xpts_v2(double precision, double precision)'::regprocedure)").fetchone()[0]
        self.assertEqual(len(rows), 2 * len(self.PAIRS))
        self.assertEqual(calls, len(rows), "calls of agg.xpts_v2 for the view's rows")
        columns = self.db.execute("""SELECT column_name, data_type FROM information_schema.columns
                                     WHERE table_schema='api' AND table_name='match_xpts' ORDER BY ordinal_position""").fetchall()
        self.assertEqual(columns, [("season_id", "smallint"), ("match_id", "integer"), ("team_id", "integer"), ("opponent_id", "integer"),
                                   ("xg", "real"), ("xg_against", "real"), ("p_win", "real"), ("p_draw", "real"), ("p_loss", "real"),
                                   ("xpts", "real")])

    def test_5_the_domain_ends_at_100_xg_a_side(self):
        # Astra/xhigh interim review (P2): 100 is computed; beyond it there is no law, without an
        # error (exp(-750) underflows, SQLSTATE 22003) and without a silent clamp.
        got = self.db.execute("SELECT (agg.xpts_v2(100, 1)).*").fetchone()
        for name, value, want in zip(("win", "draw", "loss", "xpts"), got, law(100.0, 1.0)):
            self.assertAlmostEqual(value, want, delta=2e-6, msg=f"100 v 1 {name}")
        wrong = []
        for a, b in ((100.5, 1.0), (750.0, 1.0), (1.0, 750.0), (1e300, 1.0), (1.0, 1.7976931348623157e308)):
            try:
                row = self.db.execute("SELECT (agg.xpts_v2(%s, %s)).*", (a, b)).fetchone()
            except psycopg.Error as error:
                wrong.append(f"{a} v {b}: {type(error).__name__}")
                continue
            if row != (None, None, None, None):
                wrong.append(f"{a} v {b}: {row}")
        self.assertEqual(wrong, [])


@unittest.skipUnless(DSN and psycopg, "requires disposable local agg DB and psycopg")
class ServerIndicatorSupportTest(unittest.TestCase):
    """FM-B10.1 to FM-B10.4: the server's club indicators (models._team_values_sql, the
    cohort percentiles VI-22's similarity reads, and api.team_season) on their own supports."""

    TEAMS = (1, 2, 3, 4, 5)

    @classmethod
    def setUpClass(cls):
        cls.db = _connect()
        cls.addClassCleanup(_drop, cls.db)
        x = cls.db.execute
        x("INSERT INTO core.teams(id,name) SELECT t, 'Club ' || t FROM generate_series(1, 5) t")
        cls.rows = {}  # (match, team) -> the statistics written, for the expected values
        cls.games = []  # (match, home, away, gf, ga)
        matches = [(h, a) for h in cls.TEAMS for a in cls.TEAMS if h != a]
        team_index = {t: 0 for t in cls.TEAMS}
        for idx, (home, away) in enumerate(matches, 1):
            hs, as_ = (home + away + idx) % 3, (home * away + idx) % 2
            if (home, away) == (4, 5):
                hs, as_ = 2, 0  # team 4 scores twice, once by an opponent's own goal
            cls.games.append((idx, home, away, hs, as_))
            day = date(2025, 8, 1) + timedelta(days=idx)
            x("""INSERT INTO core.matches(id,competition_season_id,season_id,source,status,home_team_id,away_team_id,home_score,away_score,match_date)
                 VALUES(%s,1,2025,'pitchapi','finished',%s,%s,%s,%s,%s)""", (idx, home, away, hs, as_, day))
            events = "unavailable" if (home, away) == (4, 2) else "ok"  # one match of team 4 without events
            # Two of team 3's matches have their complete shot sets (one of them with a penalty);
            # the others have none, whatever their xG and non-penalty xG.
            shots = "ok" if (home, away) in ((3, 1), (3, 4)) else "pending"
            x("INSERT INTO core.match_coverage(season_id,match_id,events,shots) VALUES(2025,%s,%s,%s)", (idx, events, shots))
            possession = 50 + 2 * (home - away)
            for team, own_possession in ((home, possession), (away, 100 - possession)):
                n = team_index[team]
                team_index[team] += 1
                xg = round(0.5 + 0.1 * ((team + idx) % 7), 2)
                stat = {"xg": xg, "npxg": xg, "total_shots": 8 + (team + idx) % 6, "possession_pct": own_possession,
                        "opposition_half_passes": 150 + 10 * ((team * 3 + idx) % 5)}
                if team == 1 and n < 5:
                    stat["possession_pct"] = None  # team 1: possession on three matches of eight
                if team == 3 and (home, away) == (3, 1):
                    stat.update(xg=1.79, npxg=1.0, total_shots=11)  # one penalty among eleven shots
                if team == 3 and (home, away) == (3, 2):
                    stat.update(xg=1.5, npxg=0.8)  # a penalty, but no shot set to count it
                if team == 4 and (home, away) == (4, 5):
                    stat.update(xg=1.0)
                cls.rows[(idx, team)] = stat
            # Team 2's opponents' passes in the opposition half are unknown in two of its matches.
            if 2 in (home, away) and sum(1 for g in cls.games if 2 in g[1:3]) <= 2:
                cls.rows[(idx, away if home == 2 else home)]["opposition_half_passes"] = None
            for team in (home, away):
                stat = cls.rows[(idx, team)]
                x("""INSERT INTO core.team_match_stats(season_id,match_id,team_id,period,xg,npxg,total_shots,possession_pct,opposition_half_passes)
                     VALUES(2025,%s,%s,'all',%s,%s,%s,%s,%s)""",
                  (idx, team, stat["xg"], stat["npxg"], stat["total_shots"], stat["possession_pct"], stat["opposition_half_passes"]))
            if events == "ok":
                cls.goal_events(idx, home, away, hs, as_)
            if shots == "ok":
                # The complete set, reconciled with the team statistics (its shot count) and the
                # score (its goals); team 3's penalty in 3–1 is a miss.
                for team, goals in ((home, hs), (away, as_)):
                    for no in range(cls.rows[(idx, team)]["total_shots"]):
                        penalty = team == 3 and (home, away) == (3, 1) and no == goals
                        x("""INSERT INTO core.shots(season_id,match_id,team_id,shot_no,period,minute,outcome,situation,is_own_goal)
                             VALUES(2025,%s,%s,%s,'first_half',%s,%s,%s,false)""",
                          (idx, team, (0 if team == home else 100) + no, 5 + no, "goal" if no < goals else "miss",
                           "penalty" if penalty else "regular_play"))
        from vega import models
        from vega.calculator import refresh_competition_season

        refresh_competition_season(cls.db, 1)
        with cls.db.transaction():
            cohorts = models.ensure_cohorts(cls.db, 1)
        cls.cohort = cls.db.execute("SELECT id FROM agg.cohorts WHERE key='team:2025:cs:1'").fetchone()[0]
        assert cls.cohort in cohorts
        models.refresh_cohort(cls.db, cls.cohort)

    @classmethod
    def goal_events(cls, match, home, away, hs, as_):
        """Goal events reproducing the score; 4–5's second goal is team 5's own goal. The event's
        team is the side credited, own goals included, as production stores it (FAILURE_MODES §17.1)."""
        goals = [(10 * (i + 1), "home") for i in range(hs)] + [(10 * (i + 1) + 5, "away") for i in range(as_)]
        score = [0, 0]
        for seq, (minute, side) in enumerate(sorted(goals), 1):
            score[0 if side == "home" else 1] += 1
            own = (home, away) == (4, 5) and seq == 2
            cls.db.execute(
                """INSERT INTO core.match_events(season_id,match_id,team_id,seq,event_type,period,minute,score_home,score_away,is_own_goal)
                   VALUES(2025,%s,%s,%s,'goal','first_half',%s,%s,%s,%s)""",
                (match, home if side == "home" else away, seq, minute, score[0], score[1], own))

    def percentile_row(self, team, key):
        return self.db.execute(
            "SELECT value, covered_matches FROM agg.team_percentiles WHERE cohort_id=%s AND team_id=%s AND metric_key=%s",
            (self.cohort, team, key),
        ).fetchone()

    def matches_of(self, team):
        return [(m, h, a, gf, ga) for m, h, a, gf, ga in self.games if team in (h, a)]

    def test_1_an_indicator_counts_the_matches_it_stands_on(self):
        # FM-B10.1: possession on 3 of team 1's 8 matches (under VI-22's 5-match gate), xG on 8.
        self.assertEqual(self.percentile_row(1, "possession_pct")[1], 3)
        self.assertEqual(self.percentile_row(1, "xg_pm")[1], 8)

    def test_2_a_ratio_of_two_sides_reads_the_matches_both_know(self):
        # FM-B10.2: field tilt of team 2 over the six matches where both sides' passes are known.
        own = opp = 0
        for m, h, a, _, _ in self.matches_of(2):
            mine, theirs = self.rows[(m, 2)]["opposition_half_passes"], self.rows[(m, a if h == 2 else h)]["opposition_half_passes"]
            if mine is not None and theirs is not None:
                own += mine
                opp += theirs
        value, covered = self.percentile_row(2, "field_tilt_pct")
        # agg.team_percentiles.value is a real (009): the paired ratio to a real's precision, as
        # in test_5 (the baseline's mixed sums give 56.61 for 49.76).
        want = 100 * own / (own + opp)
        self.assertTrue(math.isclose(value, want, rel_tol=1e-6), f"{value} != {want}")
        self.assertEqual(covered, 6)

    def test_3_shot_quality_leaves_penalties_out_of_both_terms(self):
        # FM-B10.3: penalty attempts are counted on complete shot sets only (Astra amendment §1):
        # team 3's 3–1 counts 1.0 npxG on 10 shots, its 3–4 all its shots; its six other matches,
        # without a shot set, are left out even where xG equals npxG.
        npxg = shots = 0
        for m, h, a, _, _ in self.matches_of(3):
            if (h, a) not in ((3, 1), (3, 4)):
                continue
            stat = self.rows[(m, 3)]
            npxg += stat["npxg"]
            shots += stat["total_shots"] - (1 if (h, a) == (3, 1) else 0)
        value, covered = self.percentile_row(3, "xg_per_shot")
        self.assertAlmostEqual(value, npxg / shots, places=6)
        self.assertEqual(covered, 2)

    def test_4_finishing_does_not_credit_an_opponents_own_goal(self):
        # FM-B10.4: team 4's 2–0 over team 5 counts one goal of its own for 1.0 xG; the match
        # whose events are unavailable cannot be classified and is left out.
        residuals = []
        for m, h, a, gf, ga in self.matches_of(4):
            if (h, a) == (4, 2):
                continue
            goals = (gf if h == 4 else ga) - (1 if (h, a) == (4, 5) else 0)
            residuals.append(goals - self.rows[(m, 4)]["xg"])
        value, covered = self.percentile_row(4, "finishing_pm")
        self.assertAlmostEqual(value, sum(residuals) / len(residuals), places=6)
        self.assertEqual(covered, 7)

    def test_5_the_published_season_row_agrees_with_the_cohort(self):
        # BC: api.team_season and the cohort's values are one definition (every indicator, every
        # club). The view divides real sums where the cohort sums in double precision: they agree
        # to the precision of a real.
        from vega.models import TEAM_INDICATORS

        keys = list(TEAM_INDICATORS)
        published = {r[0]: r[1:] for r in self.db.execute(
            f"SELECT team_id, {', '.join(keys)} FROM api.team_season WHERE competition_season_id=1").fetchall()}
        wrong = []
        for team in self.TEAMS:
            for key, value in zip(keys, published[team]):
                row = self.percentile_row(team, key)
                cohort = row[0] if row else None
                if (value is None) != (cohort is None) or (value is not None and not math.isclose(value, cohort, rel_tol=1e-6, abs_tol=1e-9)):
                    wrong.append(f"{team} {key}: {value} != {cohort}")
        self.assertEqual(wrong, [])

    def test_6_the_published_season_row_keeps_its_columns(self):
        # BC: a replacement of api.team_season keeps the baseline's columns, order and types first.
        expected = [tuple(c) for c in json.loads((FIXTURES / "api_team_season_columns.json").read_text())["columns"]]
        columns = self.db.execute(
            """SELECT column_name, data_type FROM information_schema.columns
               WHERE table_schema='api' AND table_name='team_season' ORDER BY ordinal_position"""
        ).fetchall()
        self.assertEqual(columns[: len(expected)], expected)


@unittest.skipUnless(DSN and psycopg, "requires disposable local agg DB and psycopg")
class OwnGoalFlagSupportTest(unittest.TestCase):
    """FAILURE_MODES §7.2 and §11 (Astra/xhigh interim own-goal review, 17 Nov 2026), as §17
    (stage 8) amends them: a goal event must carry its own-goal flag; a goal shot need not, the
    events classify the scoring (production never stores FALSE on a shot). A non-goal row may have
    no flag."""

    @classmethod
    def setUpClass(cls):
        cls.db = _connect()
        cls.addClassCleanup(_drop, cls.db)
        x = cls.db.execute
        x("INSERT INTO core.teams(id,name) VALUES (11,'Club'),(12,'Adversaire')")
        # (match, score, events, shots): the club at home against the same opponent.
        games = [(1, (1, 0), "ok", "pending"), (2, (1, 0), "ok", "pending"), (3, (1, 0), "ok", "pending"), (4, (0, 0), "ok", "pending"),
                 (5, (1, 0), "ok", "ok"), (6, (1, 0), "ok", "ok")]
        for mid, (hs, as_), events, shots in games:
            x("""INSERT INTO core.matches(id,competition_season_id,season_id,source,status,home_team_id,away_team_id,home_score,away_score,match_date)
                 VALUES(%s,1,2025,'pitchapi','finished',11,12,%s,%s,%s)""", (mid, hs, as_, date(2025, 8, 1) + timedelta(days=mid)))
            x("INSERT INTO core.match_coverage(season_id,match_id,events,shots) VALUES(2025,%s,%s,%s)", (mid, events, shots))
            club_shots, their_shots = (3, 2) if shots == "ok" else (5, 4)
            for team, xg, total, xgot in ((11, 1.2, club_shots, 1.0), (12, 0.6, their_shots, 0.5)):
                x("""INSERT INTO core.team_match_stats(season_id,match_id,team_id,period,xg,npxg,total_shots,xgot)
                     VALUES(2025,%s,%s,'all',%s,%s,%s,%s)""", (mid, team, xg, xg, total, xgot))
        goal = """INSERT INTO core.match_events(season_id,match_id,team_id,seq,event_type,period,minute,score_home,score_away,is_own_goal)
                  VALUES(2025,%s,%s,1,'goal','first_half',20,1,0,%s)"""
        x(goal, (1, 11, None))  # 1: the goal's flag unknown
        x(goal, (2, 11, False))  # 2: an ordinary goal
        x(goal, (3, 11, True))  # 3: the opponent's own goal, credited to the club (§17.1)
        x(goal, (5, 11, False))  # 5 and 6: ordinary goals, their shot sets below
        x(goal, (6, 11, False))
        # 4: no goal; a card whose flag is unknown changes nothing.
        x("""INSERT INTO core.match_events(season_id,match_id,team_id,seq,event_type,period,minute,is_own_goal)
             VALUES(2025,4,12,1,'yellow_card','first_half',30,NULL)""")
        # 5 and 6: complete shot sets, every attempt classified; the misses carry no own-goal flag
        # (as the real fixture's); the goal shot's flag is unknown in 5 (as production stores an
        # ordinary goal), false in 6.
        for mid, flag in ((5, None), (6, False)):
            rows = [(11, 0, "goal", flag), (11, 1, "miss", None), (11, 2, "miss", None), (12, 100, "miss", None), (12, 101, "miss", None)]
            for team, no, outcome, own in rows:
                x("""INSERT INTO core.shots(season_id,match_id,team_id,shot_no,period,minute,outcome,situation,is_own_goal)
                     VALUES(2025,%s,%s,%s,'first_half',%s,%s,'regular_play',%s)""", (mid, team, no, 10 + no, outcome, own))
        from vega.calculator import refresh_competition_season

        refresh_competition_season(cls.db, 1)

    def club(self, *columns):
        return self.db.execute(f"SELECT {', '.join(columns)} FROM agg.team_season_stats WHERE team_id=11").fetchone()

    def test_1_a_goal_event_without_its_flag_is_not_classified(self):
        # Classified: 2, 5, 6 (false), 3 (true), 4 (no goal; the card's flag is not read). 1 is not.
        # A classified 0–0 beside 1–0s: the measured matches are not the goalless ones alone (§16.6's probe).
        self.assertEqual(self.club("pair_finishing_n", "pair_conversion_n", "pair_keeper_n"), (5, 5, 5))
        finishing = (1 - 1.2) + (1 - 1 - 1.2) + (0 - 1.2) + 2 * (1 - 1.2)
        self.assertAlmostEqual(self.club("pair_finishing_sum")[0], finishing, places=5)

    def test_2_the_other_statistics_keep_every_match(self):
        self.assertEqual(self.club("matches", "for_xg_n", "for_total_shots_n"), (6, 6, 6))

    def test_3_a_goal_shot_without_its_flag_still_reconciles_its_shot_set(self):
        # 5 and 6: the events say both goals are ordinary; 5's shot without a flag no longer
        # leaves its set out (§17.2). Before stage 8: 6 only.
        self.assertEqual(self.club("pair_xg_per_shot_n")[0], 2)
        num, den = self.club("pair_xg_per_shot_num", "pair_xg_per_shot_den")
        self.assertAlmostEqual(num / den, 2.4 / 6, places=6)

    def test_4_the_calculator_reads_the_match_scoring(self):
        # One definition (§17.2): the calculator's statement joins agg.match_scoring and keeps no
        # scoring or shot-set rule of its own.
        import inspect
        from vega import calculator

        source = inspect.getsource(calculator)
        self.assertIn("agg.match_scoring", source)
        for gone in ("shot_sets AS", "scoring AS (", "lag(e.score_home"):
            self.assertNotIn(gone, source)


@unittest.skipUnless(DSN and psycopg, "requires disposable local agg DB and psycopg")
class PlacementSupportTest(unittest.TestCase):
    """FAILURE_MODES §14.3 (stage 5, Astra F2): placement (own xGOT − own xG) stands on the club's
    own two inputs, not on the opponent's xG: in the aggregate, api.team_season and the cohort."""

    # (match, own xG, own xGOT, opponent xG): placement 0.5 and 0.2; the last two lack an own input.
    CASES = [(1, 1.0, 1.5, None), (2, 0.8, 1.0, 0.6), (3, None, 0.9, 0.5), (4, 0.7, None, 0.4)]

    @classmethod
    def setUpClass(cls):
        from vega import models
        from vega.calculator import refresh_competition_season

        cls.db = _connect()
        cls.addClassCleanup(_drop, cls.db)
        x = cls.db.execute
        x("INSERT INTO core.teams(id,name) VALUES (1,'Club'),(2,'Rival')")
        for mid, xg, xgot, opponent in cls.CASES:
            x("""INSERT INTO core.matches(id,competition_season_id,season_id,source,status,home_team_id,away_team_id,home_score,away_score,match_date)
                 VALUES(%s,1,2025,'pitchapi','finished',1,2,1,0,%s)""", (mid, date(2025, 9, 1) + timedelta(days=mid)))
            x("INSERT INTO core.team_match_stats(season_id,match_id,team_id,period,xg,xgot) VALUES(2025,%s,1,'all',%s,%s)", (mid, xg, xgot))
            x("INSERT INTO core.team_match_stats(season_id,match_id,team_id,period,xg,xgot) VALUES(2025,%s,2,'all',%s,NULL)", (mid, opponent))
        refresh_competition_season(cls.db, 1)
        with cls.db.transaction():
            models.ensure_cohorts(cls.db, 1)
        cls.cohort = cls.db.execute("SELECT id FROM agg.cohorts WHERE key='team:2025:cs:1'").fetchone()[0]
        models.refresh_cohort(cls.db, cls.cohort)

    def test_1_the_aggregate_reads_the_two_own_inputs(self):
        total, matches = self.db.execute("SELECT placement_sum, placement_matches FROM agg.team_season_stats WHERE team_id=1").fetchone()
        self.assertEqual(matches, 2)
        self.assertTrue(math.isclose(total, 0.7, rel_tol=1e-6), total)

    def test_2_the_published_row_and_the_cohort_follow(self):
        published = self.db.execute("SELECT placement_pm FROM api.team_season WHERE team_id=1").fetchone()[0]
        self.assertTrue(math.isclose(published, 0.35, rel_tol=1e-6), published)
        value, covered = self.db.execute(
            "SELECT value, covered_matches FROM agg.team_percentiles WHERE cohort_id=%s AND team_id=1 AND metric_key='placement_pm'",
            (self.cohort,)).fetchone()
        self.assertEqual(covered, 2)
        self.assertTrue(math.isclose(value, 0.35, rel_tol=1e-6), value)


if __name__ == "__main__":
    unittest.main()


@unittest.skipUnless(DSN and psycopg, "requires disposable local agg DB and psycopg")
class MatchScoringTest(unittest.TestCase):
    """FAILURE_MODES §17 (stage 8, written before agg.match_scoring): one scoring per match, the
    own goals from the goal events' teams (the side credited), the penalty attempts from a shot
    set reconciled with them. Cases a–n of §17.3; home 21, away 22, a third team 23."""

    H, A, X = 21, 22, 23

    @classmethod
    def setUpClass(cls):
        cls.db = _connect()
        cls.addClassCleanup(_drop, cls.db)
        cls.db.execute("INSERT INTO core.teams(id,name) VALUES (21,'Domicile'),(22,'Extérieur'),(23,'Tiers')")
        cls.case = {}
        cls.cases()

    @classmethod
    def match(cls, name, score, *, events="ok", shots="ok", status="finished", totals=None):
        """A match of the case `name`: its coverage and both sides' total shots (default: the shot
        list's own counts, filled in by `shot`)."""
        mid = len(cls.case) + 1
        cls.case[name] = mid
        hs, as_ = score
        cls.db.execute(
            """INSERT INTO core.matches(id,competition_season_id,season_id,source,status,home_team_id,away_team_id,home_score,away_score,match_date)
               VALUES(%s,1,2025,'pitchapi',%s,%s,%s,%s,%s,%s)""",
            (mid, status, cls.H, cls.A, hs, as_, date(2025, 8, 1) + timedelta(days=mid)))
        cls.db.execute("INSERT INTO core.match_coverage(season_id,match_id,events,shots) VALUES(2025,%s,%s,%s)", (mid, events, shots))
        cls.totals = dict(totals or {})
        cls.shots, cls.seq = [], 0
        return mid

    @classmethod
    def goal(cls, mid, team, own=False, score=None, period="first_half"):
        """A goal event credited to `team` (own: the opponent's own goal); `score` its running
        score as the source stored it (either convention), unread by the rule."""
        cls.seq += 1
        sh, sa = score or (None, None)
        cls.db.execute(
            """INSERT INTO core.match_events(season_id,match_id,team_id,seq,event_type,period,minute,score_home,score_away,is_own_goal)
               VALUES(2025,%s,%s,%s,'goal',%s,%s,%s,%s,%s)""",
            (mid, team, cls.seq, period, 10 * cls.seq, sh, sa, own))

    @classmethod
    def shot(cls, mid, team, outcome="miss", situation="regular_play", own=None, period="first_half"):
        """A shot of `team` (an own goal carries the scorer's team, as the source gives it)."""
        no = len(cls.shots)
        cls.shots.append((team, own, period))
        cls.db.execute(
            """INSERT INTO core.shots(season_id,match_id,team_id,shot_no,period,minute,outcome,situation,is_own_goal)
               VALUES(2025,%s,%s,%s,%s,%s,%s,%s,%s)""",
            (mid, team, no, period, 5 + no, outcome, situation, own))

    @classmethod
    def stats(cls, mid):
        """Both sides' total shots: the list's non-own-goal shots of the shoot-out-free periods
        unless the case says otherwise."""
        for team in (cls.H, cls.A):
            total = cls.totals.get(team, sum(1 for t, own, period in cls.shots if t == team and own is not True and period != "penalties"))
            cls.db.execute("INSERT INTO core.team_match_stats(season_id,match_id,team_id,period,xg,npxg,total_shots) VALUES(2025,%s,%s,'all',1,1,%s)",
                           (mid, team, total))

    @classmethod
    def cases(cls):
        H, A, X = cls.H, cls.A, cls.X
        # a: 1–0, the goal event says ordinary; its shot's flag NULL, as production stores it.
        m = cls.match("a", (1, 0)); cls.goal(m, H, score=(1, 0)); cls.shot(m, H, "goal"); cls.shot(m, H); cls.shot(m, A); cls.stats(m)
        # b: 1–0 by A's own goal: the event credited to H and TRUE; A's shot TRUE (scorer's team).
        m = cls.match("b", (1, 0)); cls.goal(m, H, own=True, score=(1, 0)); cls.shot(m, A, "goal", own=True); cls.shot(m, H); cls.shot(m, A); cls.stats(m)
        # c: as b, the shot list holding an ordinary goal of H instead of A's own goal.
        m = cls.match("c", (1, 0)); cls.goal(m, H, own=True, score=(1, 0)); cls.shot(m, H, "goal"); cls.shot(m, A); cls.stats(m)
        # d: 2–0, the shots hold one goal only.
        m = cls.match("d", (2, 0)); cls.goal(m, H, score=(1, 0)); cls.goal(m, H, score=(2, 0)); cls.shot(m, H, "goal"); cls.shot(m, H); cls.stats(m)
        # e: an event whose flag is unknown, a perfect shot set.
        m = cls.match("e", (1, 0)); cls.goal(m, H, own=None, score=(1, 0)); cls.shot(m, H, "goal"); cls.shot(m, A); cls.stats(m)
        # f: a 1–0 whose events count two goals for H (a disallowed goal kept).
        m = cls.match("f", (1, 0)); cls.goal(m, H, score=(1, 0)); cls.goal(m, H, score=(2, 0)); cls.shot(m, H, "goal"); cls.stats(m)
        # g: 0–0 with its events read (and a complete shot set), and 0–0 without events.
        m = cls.match("g_read", (0, 0)); cls.shot(m, H); cls.shot(m, A); cls.stats(m)
        m = cls.match("g_unread", (0, 0), events="unavailable"); cls.shot(m, H); cls.stats(m)
        # h: 1–1 after extra time, won on penalties: the shoot-out's events and kicks are ignored;
        # H's goal was an in-match penalty.
        m = cls.match("h", (1, 1)); cls.goal(m, H, score=(1, 0)); cls.goal(m, A, score=(1, 1), period="second_half")
        cls.goal(m, H, score=(2, 1), period="penalties"); cls.goal(m, A, score=(2, 2), period="penalties")
        cls.shot(m, H, "goal", "penalty"); cls.shot(m, A, "goal", period="second_half"); cls.shot(m, A)
        cls.shot(m, H, "goal", "penalty", period="penalties"); cls.shot(m, A, "goal", "penalty", period="penalties"); cls.stats(m)
        # i: H's statistics count one shot more than the list.
        m = cls.match("i", (1, 0), totals={H: 3}); cls.goal(m, H, score=(1, 0)); cls.shot(m, H, "goal"); cls.shot(m, A); cls.stats(m)
        # j: one of H's attempts without its situation; A's all classified (one penalty missed).
        m = cls.match("j", (1, 0)); cls.goal(m, H, score=(1, 0)); cls.shot(m, H, "goal"); cls.shot(m, H, situation=None)
        cls.shot(m, A, situation="penalty"); cls.stats(m)
        # k: a shot of a third team in the list.
        m = cls.match("k", (1, 0)); cls.goal(m, H, score=(1, 0)); cls.shot(m, H, "goal"); cls.shot(m, X); cls.stats(m)
        # l: b and c mirrored, the own goal credited to A (H's own goal, H's shot TRUE).
        m = cls.match("l_b", (0, 1)); cls.goal(m, A, own=True, score=(0, 1)); cls.shot(m, H, "goal", own=True); cls.shot(m, A); cls.stats(m)
        m = cls.match("l_c", (0, 1)); cls.goal(m, A, own=True, score=(0, 1)); cls.shot(m, A, "goal"); cls.stats(m)
        # m: the same 2–1 (A's own goal for H, then H, then A), its events in the « before »
        # convention (first goal 0–0) and in the « after » one.
        for name, scores in (("m_before", [(0, 0), (1, 0), (2, 0)]), ("m_after", [(1, 0), (2, 0), (2, 1)])):
            m = cls.match(name, (2, 1)); cls.goal(m, H, own=True, score=scores[0]); cls.goal(m, H, score=scores[1]); cls.goal(m, A, score=scores[2])
            cls.shot(m, A, "goal", own=True); cls.shot(m, H, "goal"); cls.shot(m, A, "goal"); cls.shot(m, H, situation="penalty"); cls.stats(m)
        # n: a match still in play.
        m = cls.match("n", (1, 0), status="in_play"); cls.goal(m, H, score=(1, 0)); cls.shot(m, H, "goal"); cls.stats(m)

    @classmethod
    def row(cls, name):
        return cls.db.execute(
            """SELECT own_goals_for_home, own_goals_for_away, penalties_home, penalties_away
               FROM agg.match_scoring WHERE season_id=2025 AND match_id=%s""", (cls.case[name],)).fetchone()

    def test_a_an_ordinary_goal_is_the_events_not_the_shots_flag(self):
        self.assertEqual(self.row("a"), (0, 0, 0, 0))

    def test_b_an_own_goal_counts_for_the_side_credited(self):
        self.assertEqual(self.row("b"), (1, 0, 0, 0))

    def test_c_shots_disagreeing_with_the_events_leave_the_penalties_unknown(self):
        self.assertEqual(self.row("c"), (1, 0, None, None))

    def test_d_a_goal_missing_from_the_shots(self):
        self.assertEqual(self.row("d"), (0, 0, None, None))

    def test_e_an_event_without_its_flag_classifies_nothing(self):
        self.assertEqual(self.row("e"), (None, None, None, None))

    def test_f_events_that_do_not_count_the_score(self):
        self.assertEqual(self.row("f"), (None, None, None, None))

    def test_g_a_goalless_match_needs_its_events(self):
        self.assertEqual(self.row("g_read"), (0, 0, 0, 0))
        self.assertEqual(self.row("g_unread"), (None, None, None, None))

    def test_h_the_shoot_out_is_ignored(self):
        self.assertEqual(self.row("h"), (0, 0, 1, 0))

    def test_i_a_shot_count_that_does_not_match(self):
        self.assertEqual(self.row("i"), (0, 0, None, None))

    def test_j_an_unknown_situation_leaves_its_side_unknown(self):
        self.assertEqual(self.row("j"), (0, 0, None, 1))

    def test_k_a_third_teams_shot(self):
        self.assertEqual(self.row("k"), (0, 0, None, None))

    def test_l_mirrored(self):
        self.assertEqual(self.row("l_b"), (0, 1, 0, 0))
        self.assertEqual(self.row("l_c"), (0, 1, None, None))

    def test_m_both_running_score_conventions(self):
        self.assertEqual(self.row("m_before"), (1, 0, 1, 0))
        self.assertEqual(self.row("m_after"), (1, 0, 1, 0))

    def test_n_an_unfinished_match_has_no_row(self):
        self.assertIsNone(self.row("n"))

    def test_o_the_read_api_sees_the_same_rows(self):
        api = self.db.execute(
            "SELECT match_id, own_goals_for_home, own_goals_for_away, penalties_home, penalties_away FROM api.match_scoring WHERE season_id=2025 ORDER BY match_id").fetchall()
        agg = self.db.execute(
            "SELECT match_id, own_goals_for_home, own_goals_for_away, penalties_home, penalties_away FROM agg.match_scoring WHERE season_id=2025 ORDER BY match_id").fetchall()
        self.assertEqual(api, agg)
        self.assertEqual(len(agg), len(self.case) - 1)
