"""A match graded as soon as its player statistics arrive (docs/calculs/09-audit-2026-11/FAILURE_MODES.md § 69,
written before these tests; hugo, 25 Nov 2026: « met cela en match »).

A disposable base: award year 2025 (a league of eight clubs, 56 matches from August 2025) and award year 2026 (the same
clubs, 56 matches from 1 August 2026, the last, M, kicked off the day before NOW). A substitute of club 11 without a
slot in M, who started two earlier matches as a winger; assists blank in M and published elsewhere in the edition; a
third club's row and a row without any role in M. Beside them the matches the step must leave alone: one not finished,
one whose player statistics are not `ok`, a cup's, one kicked off four days ago. The Elo and both years' runs as
Worker.daily runs them, under vega_calc; the grade status read under vega_read.

The race of 25 Nov is played by removing a match's grades and stamping its rows after the year's run started: the run
read them, so its references, its Elo and its grades are what the step must give back.
"""

from datetime import date, datetime, timedelta, timezone
import os
from pathlib import Path
import sys
import unittest
from unittest import mock
from urllib.parse import urlparse
from template_base import fresh

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

try:
    import psycopg
except ImportError:
    psycopg = None

DSN = os.environ.get("VEGA_V2_GRADES_TEST_DSN")
NOW = datetime(2026, 11, 25, 12, tzinfo=timezone.utc)
SQUAD = (("G", 11), ("D", 32), ("D", 33), ("D", 34), ("D", 35), ("M", 62), ("M", 63), ("M", 64), ("M", 65), ("O", 92), ("O", 93))
TEAMS = range(11, 19)
SUB = 1120  # club 11's substitute: no slot in M, a winger in two earlier matches
THIRD, NO_ROLE = 9999, 9998
STATS = """INSERT INTO core.player_match_stats(season_id,match_id,team_id,player_id,position_id,minutes_played,goals,assists,xg,npxg,total_shots,
             shots_on_target,recoveries,interceptions,tackles,clearances,shot_blocks,duels_won,duels_lost,accurate_passes,accurate_passes_total,
             touches,chances_created,passes_into_final_third,dribbles_succeeded,dribbles_total,touches_opp_box,saves,goals_prevented,high_claims)
           VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)"""


def player_row(season, mid, team, pid, position, minutes, keeper, *, assists=True):
    v = lambda k: (pid * k + mid) % 7
    return (season, mid, team, pid, position, minutes, int((pid + mid) % 5 == 0), (int((pid + 2 * mid) % 6 == 0) if assists else None),
            round(0.01 * (pid % 17 + mid % 5), 2), round(0.01 * (pid % 13 + mid % 3), 2), pid % 4, v(3) % 3, v(5), v(2) % 5, v(3) % 6,
            pid % 3, v(4) % 3, v(6), v(1), 20 + (pid + mid) % 30, 30 + pid % 30, 40 + (pid * 11 + mid) % 25, (pid + mid) % 4,
            (pid * 2 + mid) % 6, (pid + mid) % 3, 3 + (pid + mid) % 3, pid % 5,
            (pid + mid) % 6 if keeper else None, 0.1 * ((pid + mid) % 3) if keeper else None, (pid + mid) % 2 if keeper else None)


def match(x, cid, season, mid, home, away, kickoff, *, status="finished", stats="ok", assists=True):
    x("""INSERT INTO core.matches(id,competition_season_id,season_id,source,status,home_team_id,away_team_id,home_score,away_score,match_date,kickoff_at)
         VALUES(%s,%s,%s,'pitchapi',%s,%s,%s,%s,%s,%s,%s)""",
      (mid, cid, season, status, home, away, (home * 3 + away + mid) % 4, (away * 2 + home + mid) % 3, kickoff.date(), kickoff))
    x("INSERT INTO core.match_coverage(season_id,match_id,player_stats) VALUES(%s,%s,%s)", (season, mid, stats))
    for team in (home, away):
        for slot, (group, position) in enumerate(SQUAD):
            pid = team * 100 + slot
            x("INSERT INTO core.lineup_players(season_id,match_id,team_id,player_id,is_starter,position_id) VALUES(%s,%s,%s,%s,true,%s)",
              (season, mid, team, pid, position))
            x(STATS, player_row(season, mid, team, pid, position, 90 if slot < 9 else 75, group == "G", assists=assists))


def edition(x, cid, season, label, key, *, cup=False):
    x("INSERT INTO core.competitions(id,name,kind) VALUES(%s,%s,%s)", (cid, f"Competition {cid}", "cup" if cup else "league"))
    if cup:
        x("""INSERT INTO core.competition_seasons(id,competition_id,season_id,native_label,cup_key,cup_name)
             VALUES(%s,%s,%s,%s,%s,'A cup')""", (cid, cid, season, label, f"open-cups:test:{label}"))
    else:
        x("INSERT INTO core.provider_ids(entity_type,provider,provider_key,entity_id) VALUES('competition','pitchapi',%s,%s)", (key, cid))
        x("INSERT INTO core.competition_seasons(id,competition_id,season_id,native_label) VALUES(%s,%s,%s,%s)", (cid, cid, season, label))


def pairs():
    return [(h, a) for h in TEAMS for a in TEAMS if h != a]


@unittest.skipUnless(DSN and psycopg, "requires disposable local grades DB and psycopg")
class GradesOnArrivalTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        target = urlparse(DSN)
        if target.hostname not in ("localhost", "127.0.0.1", "::1") or target.path != "/vega_v2_grades_test":
            raise RuntimeError("dedicated local grades DB required")
        from vega import arrival_grades, power
        from vega.store import Store, connect_local

        cls.power, cls.step = power, arrival_grades
        db = cls.db = fresh(DSN)
        with db.transaction():
            for label in ("2025/2026", "2026/2027"):
                Store(db).season(label)
        x = db.execute
        for t in TEAMS:
            x("INSERT INTO core.teams(id,name) VALUES(%s,%s)", (t, f"Club {t}"))
            for slot in range(len(SQUAD)):
                x("INSERT INTO core.players(id,name) VALUES(%s,%s)", (t * 100 + slot, f"P{t * 100 + slot}"))
        x("INSERT INTO core.players(id,name) VALUES(%s,'Substitute')", (SUB,))
        x("INSERT INTO core.teams(id,name) VALUES(99,'Third club')")
        for pid in (THIRD, NO_ROLE):
            x("INSERT INTO core.players(id,name) VALUES(%s,%s)", (pid, f"P{pid}"))
        edition(x, 1, 2025, "2025/2026", "l_YEAR25")
        edition(x, 2, 2026, "2026/2027", "l_YEAR26")
        edition(x, 3, 2026, "2026/2027", None, cup=True)
        start25 = datetime(2025, 8, 9, 18, tzinfo=timezone.utc)
        for n, (h, a) in enumerate(pairs()):
            match(x, 1, 2025, 1000 + n, h, a, start25 + timedelta(days=4 * n))
        start26 = datetime(2026, 8, 1, 18, tzinfo=timezone.utc)
        games = [g for g in pairs() if g != (18, 11)] + [(18, 11)]  # M, the last, is club 18's against club 11
        for n, (h, a) in enumerate(games[:-1]):
            match(x, 2, 2026, 2000 + n, h, a, start26 + timedelta(days=2 * n))
        # M: the last pair, the day before NOW, assists blank (published in the edition's other matches).
        cls.M = 2055
        mh, ma = games[-1]
        match(x, 2, 2026, cls.M, mh, ma, NOW - timedelta(days=1), assists=False)
        cls.home = mh
        # Club 11's substitute: a winger (slot 62) in two earlier matches of club 11, then in M off the bench with the
        # midfield line's code only (LINE_DEFAULT would make him a central midfielder).
        earlier = [mid for mid, (h, a) in zip(range(2000, 2055), games[:-1]) if 11 in (h, a)][:2]
        for mid in earlier:
            x(STATS, player_row(2026, mid, 11, SUB, 62, 70, False))
            x("INSERT INTO core.lineup_players(season_id,match_id,team_id,player_id,is_starter,position_id) VALUES(2026,%s,11,%s,true,62)", (mid, SUB))
        cls.sub_team = 11 if 11 in (mh, ma) else None
        assert cls.sub_team, "club 11 plays M"
        x(STATS, player_row(2026, cls.M, 11, SUB, None, 20, False, assists=False))
        x("INSERT INTO core.lineup_players(season_id,match_id,team_id,player_id,is_starter,position_id) VALUES(2026,%s,11,%s,false,2)", (cls.M, SUB))
        # A third club's row and a row without any role, in M.
        x(STATS, player_row(2026, cls.M, 99, THIRD, 62, 90, False, assists=False))
        x(STATS, player_row(2026, cls.M, mh, NO_ROLE, None, 30, False, assists=False))
        # The matches the step leaves alone.
        cls.LIVE, cls.PENDING, cls.CUP, cls.OLD = 2100, 2101, 3000, 2102
        match(x, 2, 2026, cls.LIVE, 11, 12, NOW - timedelta(hours=1), status="in_play")
        match(x, 2, 2026, cls.PENDING, 13, 14, NOW - timedelta(hours=20), stats="pending")
        match(x, 3, 2026, cls.CUP, 15, 16, NOW - timedelta(hours=30))
        match(x, 2, 2026, cls.OLD, 17, 18, NOW - timedelta(days=4))
        calc = cls.calc = connect_local(DSN)
        calc.execute("SET ROLE vega_calc")
        cls.read = connect_local(DSN)
        cls.read.execute("SET ROLE vega_read")
        power.refresh_elo(calc)
        power.refresh_players(calc, 2025)
        # The year's run, its references captured as it computes them (69l).
        captured = {}
        original = power.references

        def capture(rows, *args, **kwargs):
            refs = original(rows, *args, **kwargs)
            captured["rows"], captured["refs"] = [dict(r) for r in rows], refs
            return refs

        with mock.patch.object(power, "references", capture):
            power.refresh_players(calc, 2026)
        cls.captured = captured
        cls.year_run = cls.one("SELECT id, started_at FROM agg.power_runs WHERE kind='players' AND season_id=2026 AND status='published'")
        cls.graded = cls.grades(cls.M)

    @classmethod
    def one(cls, sql, *args):
        return cls.db.execute(sql, args).fetchone()

    @classmethod
    def grades(cls, mid):
        return {r[0]: r[1:] for r in cls.db.execute(
            """SELECT player_id, z, role, minutes, team_id, ref_season, run_id, first_z FROM agg.player_match_grades
               WHERE season_id=2026 AND match_id=%s""", (mid,)).fetchall()}

    @classmethod
    def edition_sums(cls):
        return sorted(cls.db.execute("SELECT * FROM agg.player_grade_editions WHERE season_id=2026 AND competition_season_id=2").fetchall())

    def version(self, mid, kind="match"):
        row = self.one("SELECT version FROM ops.resource_versions WHERE resource_kind=%s AND resource_id=%s", kind, mid)
        return row[0] if row else 0

    def edition_version(self):
        """M's edition: a player's, a club's or a season's read is validated by its editions' versions alone."""
        return self.version(2, "competition_season")

    def arrival(self, mid):
        return self.one("SELECT stats_at, graded_at, run_id, players FROM agg.match_grade_arrivals WHERE season_id=2026 AND match_id=%s", mid)

    def race(self, mid, *, elo=True):
        """The match's rows written after the year's run started, its grades gone: what the run of 25 Nov missed."""
        with self.db.transaction():
            self.db.execute("DELETE FROM agg.player_match_grades WHERE season_id=2026 AND match_id=%s", (mid,))
            self.db.execute("DELETE FROM agg.match_grade_arrivals WHERE season_id=2026 AND match_id=%s", (mid,))
            self.db.execute("UPDATE core.player_match_stats SET updated_at = clock_timestamp() WHERE season_id=2026 AND match_id=%s", (mid,))
            if not elo:
                self.db.execute("DELETE FROM agg.team_elo WHERE match_id=%s", (mid,))

    def step_now(self, now=NOW):
        return self.step.refresh(self.calc, now)

    def assertRunGrades(self, got):
        self.assertEqual(set(got), set(self.graded))
        for player, (z, role, minutes, team, ref, run, _) in self.graded.items():
            gz, grole, gminutes, gteam, gref, grun, _ = got[player]
            self.assertAlmostEqual(gz, z, delta=1e-4, msg=player)
            self.assertEqual((grole, gminutes, gteam, gref, grun), (role, minutes, team, ref, run), player)

    def tearDown(self):
        # Every test leaves M as the year's run read and wrote it: its rows older than the run, its grades the run's.
        with self.db.transaction():
            self.db.execute("UPDATE core.player_match_stats SET updated_at = %s - interval '1 minute' WHERE season_id=2026 AND match_id=%s",
                            (self.year_run[1], self.M))
            self.db.execute("DELETE FROM agg.player_match_grades WHERE season_id=2026 AND match_id=%s", (self.M,))
            self.db.execute("DELETE FROM agg.match_grade_arrivals")
            for player, (z, role, minutes, team, ref, run, first) in self.graded.items():
                self.db.execute("""INSERT INTO agg.player_match_grades(season_id,match_id,player_id,award_season,team_id,role,minutes,z,first_z,ref_season,run_id)
                                   VALUES(2026,%s,%s,2026,%s,%s,%s,%s,%s,%s,%s)""", (self.M, player, team, role, minutes, z, first, ref, run))

    def test_69a_the_race_the_step_gives_the_run_s_grades_back(self):
        self.assertGreater(len(self.graded), 20)
        self.race(self.M)
        done = self.step_now()
        self.assertEqual(done["matches"], 1)
        self.assertEqual(done["players"], len(self.graded))
        self.assertRunGrades(self.grades(self.M))
        self.assertEqual(self.grades(self.M)[self.home * 100][5], self.year_run[0])

    def test_69b_without_the_match_s_elo_the_teams_last_ratings_give_the_same_grades(self):
        saved = self.db.execute("SELECT * FROM agg.team_elo WHERE match_id=%s", (self.M,)).fetchall()
        self.assertEqual(len(saved), 2)
        self.race(self.M, elo=False)
        try:
            self.step_now()
            self.assertRunGrades(self.grades(self.M))
        finally:
            with self.db.cursor() as cur:
                cur.executemany(f"INSERT INTO agg.team_elo VALUES ({', '.join(['%s'] * len(saved[0]))})", saved)

    def test_69c_the_substitute_s_role_and_the_edition_s_zeros_are_the_run_s(self):
        self.assertEqual(self.graded[SUB][1], "winger")  # his most played slot role, not LINE_DEFAULT's midfielder
        row = next(r for r in self.captured["rows"] if r["match_id"] == self.M and r["player_id"] == self.home * 100 + 5)
        self.assertEqual(row["assists"], 0.0)  # the run restored M's blank assists from the edition
        self.race(self.M)
        self.step_now()
        got = self.grades(self.M)
        self.assertEqual(got[SUB][1], "winger")
        self.assertRunGrades(got)

    def test_69d_the_matches_the_step_leaves_alone(self):
        for mid in (self.LIVE, self.PENDING, self.OLD):
            self.race(mid)
        with self.db.transaction():
            self.db.execute("UPDATE core.player_match_stats SET updated_at = clock_timestamp() WHERE season_id=2026 AND match_id=%s", (self.CUP,))
        before = self.db.execute("SELECT count(*), max(changed_at) FROM agg.player_match_grades").fetchone()
        self.assertEqual(self.step_now(), {"matches": 0, "players": 0})
        self.assertEqual(self.db.execute("SELECT count(*), max(changed_at) FROM agg.player_match_grades").fetchone(), before)
        self.assertEqual(self.one("SELECT count(*) FROM agg.match_grade_arrivals")[0], 0)
        # Rows older than the run's start: M as the run read it.
        self.assertEqual(self.step_now(), {"matches": 0, "players": 0})
        # A year whose run is not published, then a run without kept contribution references.
        self.race(self.M)
        with self.db.transaction():
            self.db.execute("UPDATE agg.power_runs SET status='superseded' WHERE id=%s", (self.year_run[0],))
        try:
            self.assertEqual(self.step_now(), {"matches": 0, "players": 0})
        finally:
            with self.db.transaction():
                self.db.execute("UPDATE agg.power_runs SET status='published' WHERE id=%s", (self.year_run[0],))
        kept = self.db.execute("SELECT * FROM agg.player_contribution_refs WHERE award_season=2026").fetchall()
        self.assertTrue(kept)
        with self.db.transaction():
            self.db.execute("DELETE FROM agg.player_contribution_refs WHERE award_season=2026")
        try:
            self.assertEqual(self.step_now(), {"matches": 0, "players": 0})
            self.assertEqual(self.grades(self.M), {})
        finally:
            with self.db.cursor() as cur:
                cur.executemany(f"INSERT INTO agg.player_contribution_refs VALUES ({', '.join(['%s'] * len(kept[0]))})", kept)
        # The window: M seen four days later is left alone too.
        self.assertEqual(self.step_now(NOW + timedelta(days=3)), {"matches": 0, "players": 0})

    def test_69e_a_second_pass_writes_nothing(self):
        self.race(self.M)
        self.step_now()
        grades, arrival, version = self.db.execute(
            "SELECT max(changed_at) FROM agg.player_match_grades WHERE match_id=%s", (self.M,)).fetchone(), self.arrival(self.M), self.version(self.M)
        edition = self.edition_version()
        self.assertEqual(self.step_now(), {"matches": 0, "players": 0})
        self.assertEqual(self.db.execute("SELECT max(changed_at) FROM agg.player_match_grades WHERE match_id=%s", (self.M,)).fetchone(), grades)
        self.assertEqual(self.arrival(self.M), arrival)
        self.assertEqual((self.version(self.M), self.edition_version()), (version, edition))

    def test_69f_rows_that_change_again_are_graded_again(self):
        self.race(self.M)
        self.step_now()
        player = self.home * 100 + 9
        first = self.grades(self.M)[player][0]
        with self.db.transaction():
            self.db.execute("""UPDATE core.player_match_stats SET touches = touches + 40, chances_created = chances_created + 4, updated_at = clock_timestamp()
                               WHERE season_id=2026 AND match_id=%s AND player_id=%s""", (self.M, player))
        self.assertEqual(self.step_now()["matches"], 1)
        z, *_, first_z = self.grades(self.M)[player]
        self.assertGreater(z, first + 0.01)
        self.assertAlmostEqual(first_z, first, delta=1e-6)
        with self.db.transaction():
            self.db.execute("""UPDATE core.player_match_stats SET touches = touches - 40, chances_created = chances_created - 4
                               WHERE season_id=2026 AND match_id=%s AND player_id=%s""", (self.M, player))

    def test_69g_a_run_that_read_before_the_rows_spares_the_step_s_grades(self):
        # The run of 25 Nov: it reads the year, the match's rows arrive, the step grades them, the run writes.
        saved = self.db.execute("SELECT * FROM core.player_match_stats WHERE season_id=2026 AND match_id=%s", (self.M,)).fetchall()
        columns = [d.name for d in self.db.execute("SELECT * FROM core.player_match_stats LIMIT 0").description]
        with self.db.transaction():
            self.db.execute("DELETE FROM agg.player_match_grades WHERE season_id=2026 AND match_id=%s", (self.M,))
            self.db.execute("DELETE FROM core.player_match_stats WHERE season_id=2026 AND match_id=%s", (self.M,))
        original, seen = self.power.season_scores, {}

        def arrive_then_score(*args, **kwargs):
            # After the run's read, before its write.
            with self.db.transaction():
                with self.db.cursor() as cur:
                    cur.executemany(f"INSERT INTO core.player_match_stats({', '.join(columns)}) VALUES ({', '.join(['%s'] * len(columns))})", saved)
                self.db.execute("UPDATE core.player_match_stats SET updated_at = clock_timestamp() WHERE season_id=2026 AND match_id=%s", (self.M,))
            seen["step"] = self.step_now()
            return original(*args, **kwargs)

        with mock.patch.object(self.power, "season_scores", arrive_then_score):
            self.power.refresh_players(self.calc, 2026)
        later = self.one("SELECT id FROM agg.power_runs WHERE kind='players' AND season_id=2026 AND status='published'")[0]
        try:
            self.assertEqual(seen["step"]["matches"], 1)
            kept = self.grades(self.M)
            self.assertEqual(set(kept), set(self.graded))  # the later run's delete spared them
            self.assertEqual({r[5] for r in kept.values()}, {self.year_run[0]})
            # The next pass reads the match again, with the later run's references.
            self.assertEqual(self.step_now()["matches"], 1)
            self.assertEqual(self.arrival(self.M)[2], later)
            self.assertLessEqual({r[5] for r in self.grades(self.M).values()}, {self.year_run[0], later})
            self.assertEqual(self.step_now()["matches"], 0)
        finally:
            # The year's run again, as setUpClass left it (M read).
            self.power.refresh_players(self.calc, 2026)
            type(self).year_run = self.one("SELECT id, started_at FROM agg.power_runs WHERE kind='players' AND season_id=2026 AND status='published'")
            type(self).graded = self.grades(self.M)

    def test_69h_a_run_that_started_after_the_step_deletes_a_grade_it_no_longer_computes(self):
        self.race(self.M)
        self.step_now()
        player = self.home * 100 + 9
        minutes = self.one("SELECT minutes_played FROM core.player_match_stats WHERE season_id=2026 AND match_id=%s AND player_id=%s", self.M, player)[0]
        with self.db.transaction():
            self.db.execute("UPDATE core.player_match_stats SET minutes_played = 0 WHERE season_id=2026 AND match_id=%s AND player_id=%s", (self.M, player))
        try:
            self.power.refresh_players(self.calc, 2026)
            self.assertNotIn(player, self.grades(self.M))
        finally:
            with self.db.transaction():
                self.db.execute("UPDATE core.player_match_stats SET minutes_played = %s WHERE season_id=2026 AND match_id=%s AND player_id=%s",
                                (minutes, self.M, player))
            self.power.refresh_players(self.calc, 2026)
            type(self).year_run = self.one("SELECT id, started_at FROM agg.power_runs WHERE kind='players' AND season_id=2026 AND status='published'")
            type(self).graded = self.grades(self.M)

    def test_69i_a_third_club_s_row_and_a_row_without_a_role_are_not_graded(self):
        self.race(self.M)
        self.step_now()
        got = self.grades(self.M)
        self.assertNotIn(THIRD, got)
        self.assertNotIn(NO_ROLE, got)
        self.assertIn(self.home * 100, got)

    def test_69j_what_the_step_writes(self):
        untouched = ("agg.player_power", "agg.player_power_matches", "agg.player_contribution_refs", "agg.player_grade_exclusions")
        before = {t: self.db.execute(f"SELECT md5(coalesce(string_agg(t::text, ',' ORDER BY t::text), '')) FROM {t} t").fetchone()[0] for t in untouched}
        editions = self.edition_sums()  # as the last run wrote them, from the grades M has again (tearDown)
        self.race(self.M)
        with self.db.transaction():
            self.db.execute("DELETE FROM agg.player_grade_editions WHERE season_id=2026 AND competition_season_id=2")
        version, edition = self.version(self.M), self.edition_version()
        latest = self.one("SELECT max(updated_at) FROM core.player_match_stats WHERE season_id=2026 AND match_id=%s", self.M)[0]
        self.step_now()
        self.assertEqual((self.version(self.M), self.edition_version()), (version + 1, edition + 1))
        stats_at, graded_at, run, players = self.arrival(self.M)
        self.assertEqual((stats_at, run, players), (latest, self.year_run[0], len(self.graded)))
        # The match's players' sums, by the run's formula (the other players' rows were deleted above and stay so).
        sums = {r[2]: r for r in self.edition_sums()}
        expected = {r[2]: r for r in editions if r[2] in self.graded and self.graded[r[2]][2] >= 20}
        self.assertEqual(set(sums), {p for p, g in self.graded.items() if g[2] >= 20})
        for player, row in sums.items():
            self.assertEqual(row[:5], expected[player][:5], player)
            self.assertAlmostEqual(row[5], expected[player][5], delta=1e-3)
        after = {t: self.db.execute(f"SELECT md5(coalesce(string_agg(t::text, ',' ORDER BY t::text), '')) FROM {t} t").fetchone()[0] for t in untouched}
        self.assertEqual(after, before)
        # The editions' sums as the run left them, for the other tests.
        with self.db.transaction():
            self.db.execute("DELETE FROM agg.player_grade_editions WHERE season_id=2026 AND competition_season_id=2")
            with self.db.cursor() as cur:
                cur.executemany("INSERT INTO agg.player_grade_editions VALUES (%s,%s,%s,%s,%s,%s)", editions)

    def test_69k_the_players_grade_status_moves_from_pending_to_graded(self):
        self.race(self.M)
        status = lambda: {s for (s,) in self.read.execute(
            "SELECT grade_status FROM api.player_grade_status WHERE season_id=2026 AND match_id=%s AND player_id < 9000", (self.M,)).fetchall()}
        self.assertEqual(status(), {"pending"})
        self.step_now()
        self.assertLessEqual(status(), {"graded", "below_display_threshold"})

    def test_69l_the_run_keeps_its_contribution_references(self):
        refs, rows = self.captured["refs"], self.captured["rows"]
        kept = self.power.read_contribution_refs(self.calc, 2026, self.year_run[0])
        self.assertEqual(set(kept), set(refs))
        self.assertEqual({r for (r,) in self.db.execute("SELECT DISTINCT run_id FROM agg.player_contribution_refs WHERE award_season=2026").fetchall()},
                         {self.year_run[0]})
        for key, (expect, s) in refs.items():
            k_expect, k_s = kept[key]
            self.assertAlmostEqual(k_s, s, delta=1e-9, msg=key)
            for r in rows:
                if r["role"] == key[0]:
                    try:
                        want = expect(r)
                    except TypeError:  # an attempts column blank in this row
                        continue
                    self.assertAlmostEqual(k_expect(r), want, delta=1e-9, msg=key)


if __name__ == "__main__":
    unittest.main()
