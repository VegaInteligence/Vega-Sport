"""The players' match grades through the daily path, the rows a run cannot grade and why
(docs/calculs/09-audit-2026-11/FAILURE_MODES.md §38, written before these tests).

A disposable base: a calendar-year league whose edition 2021 holds 31 matches before
1 August 2021 (award year 2020) and 25 after, an August–May league 2021/22, and the rows a
run must not grade: a third team's row, a row without any role, a 0-minute row, a row
without minutes, a line-up-only player of a match whose statistics were collected and of
one whose statistics were not, a cup edition's row. The calculations run under vega_calc,
in the order Worker.daily runs them (due_seasons, refresh_elo once, refresh_daily(elo=False));
the reasons are read under vega_read.
"""

from datetime import date, datetime, timedelta, timezone
import os
from pathlib import Path
import sys
import unittest
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

try:
    import psycopg
except ImportError:
    psycopg = None

DSN = os.environ.get("VEGA_V2_GRADES_TEST_DSN")
SQUAD = (("G", 11), ("D", 32), ("D", 33), ("D", 34), ("D", 35), ("M", 62), ("M", 63), ("M", 64), ("M", 65), ("O", 92), ("O", 93))
NOW = datetime(2026, 11, 19, 12, tzinfo=timezone.utc)
AWARD_2020 = 31 * 22  # the calendar league's matches before 1 August 2021 (1 April + 4 n days, n = 0..30), 22 players each
# The participations no run may grade, by player: (match index in the season league, team side, what it is).
THIRD, NO_ROLE, ZERO, NO_MINUTES, BENCH, UNCOLLECTED, CUP = 9999, 9998, 9997, 9996, 9995, 9994, 9993
NO_TEAM = 9992  # a statistics row without a team (§46, 46j): as on 2088d36e60, never read by the players' run


def league(x, cid, key, label, teams, first_day):
    x("INSERT INTO core.competitions(id,name,kind) VALUES(%s,%s,'league')", (cid, f"League {cid}"))
    x("INSERT INTO core.provider_ids(entity_type,provider,provider_key,entity_id) VALUES('competition','pitchapi',%s,%s)", (key, cid))
    x("INSERT INTO core.competition_seasons(id,competition_id,season_id,native_label) VALUES(%s,%s,2021,%s)", (cid, cid, label))
    for t in teams:
        x("INSERT INTO core.teams(id,name) VALUES(%s,%s)", (t, f"Club {t}"))
        for slot in range(len(SQUAD)):
            x("INSERT INTO core.players(id,name) VALUES(%s,%s)", (t * 100 + slot, f"P{t * 100 + slot}"))
    matches = []
    for n, (home, away) in enumerate((h, a) for h in teams for a in teams if h != a):
        mid, day = cid * 1000 + n, first_day + timedelta(days=4 * n)
        x("""INSERT INTO core.matches(id,competition_season_id,season_id,source,status,home_team_id,away_team_id,home_score,away_score,match_date,kickoff_at)
             VALUES(%s,%s,2021,'pitchapi','finished',%s,%s,%s,%s,%s,%s::date + time '18:00')""",
          (mid, cid, home, away, (home * 3 + away) % 4, (away * 2 + home) % 3, day, day))
        x("INSERT INTO core.match_coverage(season_id,match_id,player_stats) VALUES(2021,%s,'ok')", (mid,))
        for team in (home, away):
            for slot, (group, position) in enumerate(SQUAD):
                pid = team * 100 + slot
                x("INSERT INTO core.lineup_players(season_id,match_id,team_id,player_id,is_starter,position_id) VALUES(2021,%s,%s,%s,true,%s)",
                  (mid, team, pid, position))
                x("""INSERT INTO core.player_match_stats(season_id,match_id,team_id,player_id,minutes_played,goals,xg,total_shots,recoveries,interceptions,
                       tackles,clearances,shot_blocks,duels_won,duels_lost,accurate_passes,accurate_passes_total,touches,chances_created,
                       passes_into_final_third,dribbles_succeeded,touches_opp_box,saves,goals_prevented)
                     VALUES(2021,%s,%s,%s,90,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                  (mid, team, pid, int((pid + mid) % 5 == 0), round(0.01 * (pid % 17), 2), pid % 4, (pid * 7 + mid) % 9,
                   (pid + mid) % 4, (pid * 3 + mid) % 5, (pid + 2 * mid) % 6, pid % 3, (pid * 5 + mid) % 8, (pid + mid) % 7,
                   20 + pid % 30, 30 + pid % 30, 40 + (pid * 11 + mid) % 25, (pid + mid) % 4, (pid * 2 + mid) % 6, pid % 5,
                   (pid + mid) % 3, (pid + mid) % 6 if group == "G" else None, 0.1 * ((pid + mid) % 3) if group == "G" else None))
        matches.append((mid, home, away))
    return matches


@unittest.skipUnless(DSN and psycopg, "requires disposable local grades DB and psycopg")
class PlayerGradeReasonsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        target = urlparse(DSN)
        if target.hostname not in ("localhost", "127.0.0.1", "::1") or target.path != "/vega_v2_grades_test":
            raise RuntimeError("dedicated local grades DB required")
        from vega import models, power, worker
        from vega.store import Store, connect_local, migrate

        cls.power = power
        db = cls.db = connect_local(DSN)
        db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        migrate(db)
        with db.transaction():
            for label in ("2020/2021", "2021/2022"):
                Store(db).season(label)
        x = db.execute
        cls.calendar = league(x, 1, "l_CALEND", "2021", range(1, 9), date(2021, 4, 1))
        cls.season = league(x, 2, "l_SEASON", "2021/2022", range(11, 19), date(2021, 8, 14))
        x("INSERT INTO core.teams(id,name) VALUES(99,'Third club')")
        for pid in (THIRD, NO_ROLE, ZERO, NO_MINUTES, BENCH, UNCOLLECTED, CUP, NO_TEAM):
            x("INSERT INTO core.players(id,name) VALUES(%s,%s)", (pid, f"P{pid}"))
        stats = "INSERT INTO core.player_match_stats(season_id,match_id,team_id,player_id,position_id,minutes_played,touches,accurate_passes,accurate_passes_total) VALUES(2021,%s,%s,%s,%s,%s,40,20,25)"
        m = cls.season
        cls.keys = {THIRD: m[5][0], NO_ROLE: m[6][0], ZERO: m[7][0], NO_MINUTES: m[8][0], BENCH: m[9][0], UNCOLLECTED: m[10][0]}
        x(stats, (m[5][0], 99, THIRD, 62, 90))  # neither side of the match, with a position
        x(stats, (m[6][0], m[6][1], NO_ROLE, None, 30))  # no position, no slot, no other match, no keeper data
        x(stats, (m[7][0], m[7][1], ZERO, 62, 0))
        x(stats, (m[8][0], m[8][1], NO_MINUTES, 62, None))
        x(stats, (m[11][0], None, NO_TEAM, 62, 90))
        cls.keys[NO_TEAM] = m[11][0]
        x("INSERT INTO core.lineup_players(season_id,match_id,team_id,player_id,is_starter,position_id) VALUES(2021,%s,%s,%s,false,62)", (m[9][0], m[9][1], BENCH))
        x("INSERT INTO core.lineup_players(season_id,match_id,team_id,player_id,is_starter,position_id) VALUES(2021,%s,%s,%s,false,62)", (m[10][0], m[10][1], UNCOLLECTED))
        x("UPDATE core.match_coverage SET player_stats='pending' WHERE season_id=2021 AND match_id=%s", (m[10][0],))
        # A cup edition's match between two clubs of the season league, one statistics row.
        x("INSERT INTO core.competitions(id,name,kind) VALUES(3,'A cup','cup')")
        x("INSERT INTO core.competition_seasons(id,competition_id,season_id,native_label,cup_key,cup_name) VALUES(3,3,2021,'2021/2022','open-cups:test:2021/2022','A cup')")
        x("""INSERT INTO core.matches(id,competition_season_id,season_id,source,status,home_team_id,away_team_id,home_score,away_score,match_date)
             VALUES(3000,3,2021,'openfootball','finished',11,12,1,0,'2021-10-20')""")
        x(stats, (3000, 11, CUP, 62, 90))
        cls.keys[CUP] = 3000
        calc = cls.calc = connect_local(DSN)
        calc.execute("SET ROLE vega_calc")
        cls.read = connect_local(DSN)
        cls.read.execute("SET ROLE vega_read")
        # Worker.daily's order: the due seasons, the Elo once, then each season's daily models.
        cls.due = worker.due_seasons(db, NOW)
        cls.failure = None
        power.refresh_elo(calc)
        for season in cls.due:
            try:
                models.refresh_daily(calc, season, elo=False)
            except Exception as error:  # the worker logs the step as failed and goes on
                cls.failure = error
        cls.first = cls.one("SELECT count(*), max(changed_at) FROM agg.player_match_grades")

    @classmethod
    def one(cls, sql, *args):
        return cls.db.execute(sql, args).fetchone()

    def status(self, player):
        return self.read.execute(
            "SELECT award_season, grade_status FROM api.player_grade_status WHERE season_id=2021 AND match_id=%s AND player_id=%s",
            (self.keys[player], player)).fetchall()

    @unittest.expectedFailure
    def test_38a_the_daily_path_grades_award_year_2020(self):
        # Open (§38: a method decision): award year 2020 is never due, its rows never graded.
        graded = self.one("""SELECT count(*) FROM agg.player_match_grades g JOIN core.matches m ON m.id=g.match_id AND m.season_id=g.season_id
                             WHERE m.match_date < '2021-08-01'""")[0]
        self.assertEqual(graded, AWARD_2020)

    def test_38a_award_year_2020_is_named_as_not_computed(self):
        mid = self.calendar[0][0]
        rows = self.read.execute("SELECT DISTINCT award_season, grade_status FROM api.player_grade_status WHERE season_id=2021 AND match_id=%s", (mid,)).fetchall()
        self.assertEqual(rows, [(2020, "award_year_not_computed")])

    def test_38b_a_third_team_s_row_is_set_aside_and_the_year_published(self):
        self.assertIsNone(self.failure)
        self.assertEqual(self.due, [2021])
        published = self.one("SELECT count(*) FROM agg.power_runs WHERE kind='players' AND season_id=2021 AND status='published'")[0]
        self.assertEqual(published, 1)
        self.assertEqual(self.one("SELECT count(*) FROM agg.player_match_grades WHERE player_id=%s", THIRD)[0], 0)
        self.assertEqual(self.one("SELECT count(*) FROM agg.player_power_matches WHERE player_id=%s", THIRD)[0], 0)
        self.assertEqual(self.one("""SELECT award_season, reason FROM agg.player_grade_exclusions
                                     WHERE season_id=2021 AND match_id=%s AND player_id=%s""", self.keys[THIRD], THIRD), (2021, "team_not_in_match"))
        self.assertEqual(self.status(THIRD), [(2021, "team_not_in_match")])
        # Every ordinary player-match of award year 2021 has its grade (25 + 56 matches, 22 players).
        self.assertEqual(self.one("SELECT count(*) FROM agg.player_match_grades WHERE award_season=2021")[0], (25 + 56) * 22)

    def test_38b_a_second_run_changes_nothing(self):
        before = self.db.execute("SELECT season_id, match_id, player_id, award_season, reason FROM agg.player_grade_exclusions ORDER BY 1,2,3").fetchall()
        self.power.refresh_players(self.calc, 2021)
        self.assertEqual(self.one("SELECT count(*), max(changed_at) FROM agg.player_match_grades"), self.first)
        self.assertEqual(self.db.execute("SELECT season_id, match_id, player_id, award_season, reason FROM agg.player_grade_exclusions ORDER BY 1,2,3").fetchall(), before)
        self.assertEqual(len(before), 2)

    def test_38c_a_row_without_a_role_is_recorded(self):
        self.assertEqual(self.one("SELECT reason FROM agg.player_grade_exclusions WHERE player_id=%s", NO_ROLE), ("role_undetermined",))
        self.assertEqual(self.status(NO_ROLE), [(2021, "role_undetermined")])
        self.assertEqual(self.one("SELECT count(*) FROM agg.player_match_grades WHERE player_id=%s", NO_ROLE)[0], 0)

    def test_38d_each_participation_has_one_status(self):
        self.assertEqual(self.status(ZERO), [(2021, "not_played")])
        self.assertEqual(self.status(NO_MINUTES), [(2021, "no_minutes")])
        self.assertEqual(self.status(BENCH), [(2021, "not_played")])
        self.assertEqual(self.status(UNCOLLECTED), [(2021, "no_statistics")])
        self.assertEqual(self.status(CUP), [(2021, "competition_not_admitted")])
        # One status per key of the statistics and the line-ups.
        keys, distinct = self.read.execute("SELECT count(*), count(DISTINCT (season_id, match_id, player_id)) FROM api.player_grade_status").fetchone()
        self.assertEqual(keys, distinct)
        self.assertEqual(keys, self.one("""SELECT count(*) FROM (SELECT season_id, match_id, player_id FROM core.player_match_stats
                                            UNION SELECT season_id, match_id, player_id FROM core.lineup_players) k""")[0])
        # A graded key is shown or hidden by the readers' one rule.
        wrong = self.db.execute("""SELECT count(*) FROM api.player_grade_status s JOIN agg.player_match_grades g USING (season_id, match_id, player_id)
            WHERE s.grade_status <> CASE WHEN g.minutes >= 20 OR abs(g.z) >= 1 THEN 'graded' ELSE 'below_display_threshold' END""").fetchone()[0]
        self.assertEqual(wrong, 0)
        self.assertEqual(self.read.execute("SELECT count(*) FROM api.player_grade_status WHERE grade_status IN ('graded','below_display_threshold')").fetchone()[0],
                         self.one("SELECT count(*) FROM agg.player_match_grades")[0])

    def test_46j_a_row_without_a_team_is_treated_as_on_2088d36e60(self):
        # 2088d36e60's PLAYER_MATCHES inner-joins core.teams on the row's team: such a row was never read, so never
        # graded (evidence corrections-relecture/c5). The same now: no grade, no exclusion, the year published.
        self.assertIsNone(self.failure)
        self.assertEqual(self.one("SELECT count(*) FROM agg.player_match_grades WHERE player_id=%s", NO_TEAM)[0], 0)
        self.assertEqual(self.one("SELECT count(*) FROM agg.player_power_matches WHERE player_id=%s", NO_TEAM)[0], 0)
        self.assertEqual(self.one("SELECT count(*) FROM agg.player_grade_exclusions WHERE player_id=%s", NO_TEAM)[0], 0)
        self.assertEqual(self.status(NO_TEAM), [(2021, "team_not_in_match")])

    def test_38g_a_row_the_run_did_not_record_is_unrecorded_then_pending_once_it_changes(self):
        # A year ranked before 155 recorded no reason: its ungraded rows say so, until the year runs again.
        key = (self.keys[NO_ROLE], NO_ROLE)
        with self.db.transaction():
            saved = self.db.execute("DELETE FROM agg.player_grade_exclusions WHERE match_id=%s AND player_id=%s RETURNING *", key).fetchall()
            self.db.execute("UPDATE core.player_match_stats SET updated_at = '2000-01-01' WHERE season_id=2021 AND match_id=%s AND player_id=%s", key)
        try:
            self.assertEqual(self.status(NO_ROLE), [(2021, "unrecorded")])
            # Its statistics changed after the year's run: the next run reads it.
            self.db.execute("UPDATE core.player_match_stats SET updated_at = now() + interval '1 minute' WHERE season_id=2021 AND match_id=%s AND player_id=%s", key)
            self.assertEqual(self.status(NO_ROLE), [(2021, "pending")])
        finally:
            with self.db.cursor() as cur:
                cur.executemany("INSERT INTO agg.player_grade_exclusions VALUES (%s,%s,%s,%s,%s,%s)", saved)


if __name__ == "__main__":
    unittest.main()
