"""« Composition probable »: our probable eleven before the provider's line-ups (FAILURE_MODES.md §61, 61a–61m, written
before these tests).

The method (probable-v1) is the study's P5 (`etude_onze_probable.py`, `guess()` and the absence rule « B connue »): its
self-test's cases are ported in GuessTest. The worker's step (`probable.refresh`) runs on a disposable local PostgreSQL
(VEGA_V2_PROBABLE_TEST_DSN, database vega_v2_probable_test) under the calculation role (vega_calc), as the side process
runs it.
"""

from datetime import date, datetime, timedelta, timezone
import os
from pathlib import Path
import sys
import unittest
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))

from prerequisites import required  # noqa: E402

try:
    import psycopg
except ImportError:
    psycopg = None

DSN = os.environ.get("VEGA_V2_PROBABLE_TEST_DSN")


def probable():
    from vega import probable as module

    return module


# The study's self-test world (etude_onze_probable.py, selftest()): 1 and 20 keepers, 2–6 centre backs, 7–11 central
# midfielders, 12–14 centre forwards.
ROLE = {1: "goalkeeper", 20: "goalkeeper", **{p: "centre_back" for p in range(2, 7)}, **{p: "central_midfielder" for p in range(7, 12)},
        **{p: "centre_forward" for p in range(12, 15)}}
A442 = (1, 2, 3, 4, 5, 7, 8, 9, 10, 12, 13)
B352 = (1, 2, 3, 4, 7, 8, 9, 10, 11, 12, 13)


def mr(p):
    return ROLE.get(p)


def ent(k, starters, bench=()):
    return (date(2026, 9, 1) + timedelta(days=7 * k), tuple(starters), {p: ROLE.get(p) for p in (*starters, *bench)}, frozenset((*starters, *bench)))


def ids(xi):
    return sorted(p for p, _ in xi)


class GuessTest(unittest.TestCase):
    """61a: the study's cases, to the player."""

    def setUp(self):
        self.p = probable()
        # Four 4-4-2 then three 3-5-2 (the most recent last).
        self.hist = [ent(k, A442) for k in range(4)] + [ent(k, B352) for k in range(4, 7)]
        self.w = self.p.weights(len(self.hist))

    def test_61a_weights_and_method(self):
        self.assertEqual(self.p.METHOD, "probable-v1")
        self.assertEqual((self.p.WINDOW, self.p.MIN_RECENT, self.p.DECAY), (10, 5, 0.8))
        self.assertEqual(self.p.weights(3), [0.8 ** 2, 0.8, 1.0])
        # The one place a window's weights are computed (hugo, 25 Nov: a later method may weigh each eleven otherwise).
        self.assertEqual(self.p.window_weights(self.p.METHOD, self.hist, None), self.w)
        with self.assertRaises(ValueError):
            self.p.window_weights("probable-v0", self.hist, None)

    def test_61a_the_weighted_split_wins(self):
        # P4: weights 2.44 (3-5-2) against 1.51 (4-4-2): the 3-5-2 and its players.
        xi, rep = self.p.guess(self.hist, self.w, mr)
        self.assertEqual(ids(xi), sorted(B352))
        self.assertEqual(rep, [])
        # Unweighted (P3): the 4-4-2.
        self.assertEqual(ids(self.p.guess(self.hist, [1.0] * 7, mr)[0]), sorted(A442))

    def test_61a_an_absent_is_replaced_in_his_line(self):
        xi, rep = self.p.guess(self.hist, self.w, mr, {3})
        self.assertEqual(ids(xi), sorted(set(B352) - {3} | {5}))
        self.assertEqual(rep, [(3, "D", 5)])

    def test_61a_no_outfield_player_in_goal(self):
        xi, rep = self.p.guess(self.hist, self.w, mr, {1})
        self.assertEqual(len(xi), 10)
        self.assertEqual(rep, [(1, "G", None)])

    def test_61a_all_midfielders_out(self):
        xi, rep = self.p.guess(self.hist, self.w, mr, {11, 7, 8, 9, 10})
        self.assertEqual([q for _, _, q in rep], [5, None, None, None, None])
        self.assertIn((5, "M"), xi)

    def test_61a_ties(self):
        p = self.p
        # Same starts: the one who also came on (5) wins.
        tie = [ent(0, (1, 2, 3, 4, 5, 7, 8, 9, 10, 12, 13)), ent(1, (1, 2, 3, 4, 6, 7, 8, 9, 10, 12, 13), bench=(5,))]
        g = ids(p.guess(tie, [1.0, 1.0], mr)[0])
        self.assertTrue(5 in g and 6 not in g, g)
        # Same starts and appearances: the most recent (6).
        tie2 = [ent(0, (1, 2, 3, 4, 5, 7, 8, 9, 10, 12, 13)), ent(1, (1, 2, 3, 4, 6, 7, 8, 9, 10, 12, 13))]
        g = ids(p.guess(tie2, [1.0, 1.0], mr)[0])
        self.assertTrue(6 in g and 5 not in g, g)
        # Everything level: the smallest id (5).
        tie3 = tie2 + [ent(2, (1, 2, 3, 4, 7, 8, 9, 10, 11, 12, 13), bench=(5, 6))]
        g = ids(p.guess(tie3, [1.0] * 3, mr)[0])
        self.assertTrue(5 in g and 6 not in g, g)
        # Two splits of the same weight: the most recent.
        self.assertEqual(ids(p.guess([ent(0, A442), ent(1, B352)], [1.0, 1.0], mr)[0]), sorted(B352))


class MigrationTest(unittest.TestCase):
    def test_61d_the_migration_is_the_last_reviewed_and_names_its_match_tables(self):
        from vega import open_matchday_restore

        files = sorted(p.name for p in (ROOT / "sql").glob("[0-9][0-9][0-9]_*.sql"))
        self.assertEqual(files[-1], "176_match_probable_lineups.sql")
        self.assertIn(files[-1], open_matchday_restore.REVIEWED_SCHEMAS)
        self.assertLessEqual({"agg.match_probable_lineups", "agg.match_probable_lineup_players"}, open_matchday_restore.ADDED_DEPENDENCIES)
        text = "\n".join(line.split("--")[0] for line in (ROOT / "sql" / files[-1]).read_text(encoding="utf-8").splitlines())
        # Display only: no statement names a forecast, line-up model or provider line-up table.
        for name in ("agg.match_forecasts", "agg.match_lineup_forecasts", "agg.lineup_usuals", "core.lineups", "core.lineup_players"):
            self.assertNotIn(name, text)


class AbsenceRuleTest(unittest.TestCase):
    """61e: the study's « B connue » (started before the day, no match for his club since); its end is not read."""

    def test_61e_injury_rule(self):
        p = probable()
        s = date(2026, 9, 1)
        ep = lambda start, end=None: {"start": start, "end": end, "kind": "injury", "label": "Knee injury"}
        # The study's self-test: on the start day no, after yes, played since no, without an episode no.
        self.assertIsNone(p.injury_absence([ep(s)], s - timedelta(days=4), s))
        self.assertEqual(p.injury_absence([ep(s)], s - timedelta(days=4), s + timedelta(days=30))["start"], s)
        self.assertIsNone(p.injury_absence([ep(s, s + timedelta(days=5))], s + timedelta(days=3), s + timedelta(days=10)))
        self.assertIsNone(p.injury_absence([], s, s + timedelta(days=10)))
        # Played on the start day itself: still out (last appearance <= start).
        self.assertIsNotNone(p.injury_absence([ep(s)], s, s + timedelta(days=3)))
        # Ended before the day, no appearance since: out (the end is not read).
        self.assertIsNotNone(p.injury_absence([ep(s, s + timedelta(days=2))], s - timedelta(days=1), s + timedelta(days=10)))
        # Two episodes: the latest that applies is the one shown.
        got = p.injury_absence([ep(s), ep(s + timedelta(days=5))], s - timedelta(days=1), s + timedelta(days=10))
        self.assertEqual(got["start"], s + timedelta(days=5))

    def test_61f_suspension_rule(self):
        p = probable()
        day, today = date(2026, 11, 28), date(2026, 11, 25)
        base = {"start": date(2026, 11, 22), "end": None, "competition_id": 30, "remaining": 1, "read_on": today - timedelta(days=3),
                "label": "Yellow card suspension"}
        self.assertTrue(p.suspension_applies(base, 30, day, today))
        self.assertFalse(p.suspension_applies(base, 31, day, today))  # another competition
        self.assertFalse(p.suspension_applies(base, None, day, today))  # the match's competition unknown
        self.assertFalse(p.suspension_applies(dict(base, competition_id=None), 30, day, today))  # not linked
        self.assertFalse(p.suspension_applies(dict(base, remaining=0), 30, day, today))
        self.assertTrue(p.suspension_applies(dict(base, remaining=None), 30, day, today))
        self.assertFalse(p.suspension_applies(dict(base, read_on=today - timedelta(days=50)), 30, day, today))  # empty end, stale read
        self.assertFalse(p.suspension_applies(dict(base, read_on=None), 30, day, today))
        self.assertTrue(p.suspension_applies(dict(base, end=day, read_on=None), 30, day, today))  # dated end on the day
        self.assertFalse(p.suspension_applies(dict(base, end=day - timedelta(days=1)), 30, day, today))
        self.assertFalse(p.suspension_applies(dict(base, start=day + timedelta(days=1)), 30, day, today))


# ---------------------------------------------------------------------------------------------- the worker's step

NOW = datetime(2026, 11, 25, 12, 0, tzinfo=timezone.utc)
L1, CUP = 30, 31
PSG, LORIENT, OPP, OPP2, FRANCE, MONACO, ITALY = 1, 2, 3, 4, 7, 8, 9
TARGET, LATER, NATIONAL, STALE, CUP_TIE = 900, 901, 902, 903, 904
# PSG's eleven: keeper 100; full backs 102, 105; centre backs 103, 104; midfielders 106–108; forwards 109–111.
# Bench: 101 (keeper), 112 (centre back), 113 (midfielder), 114 (forward, comes on every match).
SLOTS = {100: (11, 0.10, 0.50), 102: (32, 0.36, 0.88), 103: (34, 0.36, 0.63), 104: (36, 0.36, 0.38), 105: (38, 0.36, 0.13),
         106: (73, 0.61, 0.79), 107: (75, 0.61, 0.50), 108: (77, 0.61, 0.21), 109: (102, 0.86, 0.84), 110: (105, 0.86, 0.50),
         111: (108, 0.86, 0.16)}
BASE = tuple(SLOTS)
BENCH = (101, 112, 113, 114)
LINKS = {p: str(9000 + p) for p in (*BASE, *BENCH)}  # Transfermarkt keys of PSG's players
# PSG's finished matches, weekly to 22 Nov (1012); 1003 and 1008 cup ties where 112 starts for 103 (and 113 for 108 in 1008).
HISTORY = [(1000 + k, datetime(2026, 9, 6, 19, 0, tzinfo=timezone.utc) + timedelta(days=7 * (k - 1))) for k in range(1, 13)]


def eleven(match):
    xi = dict(SLOTS)
    if match in (1003, 1008):
        xi[112] = xi.pop(103)
    if match == 1008:
        xi[113] = xi.pop(108)
    return xi


@required(DSN and psycopg, "requires a disposable local probable line-ups DB (VEGA_V2_PROBABLE_TEST_DSN) and psycopg")
class RefreshBase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from vega.store import connect_local, migrate

        target = urlparse(DSN)
        if target.hostname not in ("localhost", "127.0.0.1", "::1") or target.path != "/vega_v2_probable_test":
            raise RuntimeError("dedicated local probable line-ups DB required")
        cls.db = connect_local(DSN)
        cls.db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        migrate(cls.db)
        cls.seed()

    @classmethod
    def tearDownClass(cls):
        cls.db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        cls.db.close()

    @classmethod
    def seed(cls):
        x = cls.db.execute
        x("INSERT INTO core.countries(code) VALUES ('FRA') ON CONFLICT DO NOTHING")
        x("INSERT INTO core.seasons(id, label) VALUES (2025, '2025/2026'), (2026, '2026/2027') ON CONFLICT DO NOTHING")
        x("SELECT core.ensure_season_partitions(2025)")
        x("SELECT core.ensure_season_partitions(2026)")
        x(f"INSERT INTO core.competitions(id, name, country_code, kind) VALUES ({L1}, 'Ligue 1', 'FRA', 'league'), ({CUP}, 'Coupe de France', 'FRA', 'cup'), (32, 'Friendlies', NULL, 'international')")
        x(f"INSERT INTO core.competition_seasons(id, competition_id, season_id, native_label) VALUES ({L1}, {L1}, 2026, '2026/2027'), ({CUP}, {CUP}, 2026, '2026/2027'), (32, 32, 2026, '2026')")
        x(f"""INSERT INTO core.teams(id, name, country_code, is_national) VALUES ({PSG}, 'Paris Saint-Germain', 'FRA', false), ({LORIENT}, 'Lorient', 'FRA', NULL),
              ({OPP}, 'Stade Nord', 'FRA', false), ({OPP2}, 'Union Sud', 'FRA', false), ({FRANCE}, 'France', 'FRA', true), ({MONACO}, 'Monaco', 'FRA', false),
              ({ITALY}, 'Italy', NULL, true)""")
        players = [*BASE, *BENCH, *range(200, 215), 300]
        x("INSERT INTO core.players(id, name) SELECT p, 'Player ' || p FROM unnest(%s::int[]) p", (players,))
        roles = {p: r for p, r in [(100, "goalkeeper"), (101, "goalkeeper"), (112, "centre_back"), (113, "central_midfielder"), (114, "centre_forward")]}
        x("INSERT INTO agg.power_runs(id, kind, method_version, season_id) VALUES (1, 'players', 'test', 2026)")
        for p, role in roles.items():
            x("""INSERT INTO agg.player_power(season_id, player_id, role, team_id, matches, minutes, total, rate, eligible, run_id)
                 VALUES (2026, %s, %s, 1, 10, 500, 0, 0, true, 1)""", (p, role))
        match = lambda mid, comp, home, away, status, kickoff: x(
            """INSERT INTO core.matches(id, competition_season_id, season_id, source, status, home_team_id, away_team_id, kickoff_at, match_date)
               VALUES (%s, %s, 2026, 'pitchapi', %s, %s, %s, %s, (%s AT TIME ZONE 'UTC')::date)""", (mid, comp, status, home, away, kickoff, kickoff))
        lineup = lambda mid, team, xi, bench=(), confirmed=True, formation="4-3-3": cls.lineup(mid, team, xi, bench, confirmed, formation)
        for mid, kickoff in HISTORY:
            match(mid, CUP if mid in (1003, 1008) else L1, PSG, OPP, "finished", kickoff)
            xi = eleven(mid)
            lineup(mid, PSG, xi, [p for p in BENCH if p not in xi])
        # Not in a window: ten starters; confirmed false; confirmed unknown (after 1012, before now).
        for mid, day, confirmed, size in ((1013, 23, True, 10), (1014, 24, False, 11), (1015, 24, None, 11)):
            match(mid, L1, PSG, OPP2, "finished", datetime(2026, 11, day, 8 + mid - 1013, 0, tzinfo=timezone.utc))
            xi = {p: SLOTS[p] for p in list(SLOTS)[:size] if p not in (103, 106, 111)}
            xi.update({112: SLOTS[103], 113: SLOTS[106], 114: SLOTS[111]} if size == 11 else {112: SLOTS[103], 113: SLOTS[106]})
            lineup(mid, PSG, dict(list(xi.items())[:size]), confirmed=confirmed)
        # Lorient: four complete elevens only.
        for k in range(4):
            mid = 2001 + k
            match(mid, L1, LORIENT, OPP, "finished", datetime(2026, 10, 4 + 7 * k, 15, 0, tzinfo=timezone.utc))
            lineup(mid, LORIENT, {200 + i: (11 if i == 0 else 30 + i, 0.1 + i / 20, 0.5) for i in range(11)})
        match(TARGET, L1, PSG, LORIENT, "not_started", datetime(2026, 11, 28, 19, 45, tzinfo=timezone.utc))
        match(LATER, L1, OPP, PSG, "not_started", datetime(2026, 12, 3, 19, 45, tzinfo=timezone.utc))  # in 8 days
        match(CUP_TIE, CUP, OPP2, PSG, "not_started", datetime(2026, 11, 30, 19, 45, tzinfo=timezone.utc))
        match(NATIONAL, 32, FRANCE, ITALY, "not_started", datetime(2026, 11, 27, 19, 45, tzinfo=timezone.utc))
        match(STALE, L1, OPP, OPP2, "finished", datetime(2026, 11, 24, 19, 45, tzinfo=timezone.utc))
        # France's eleven (all of PSG's players, national team): ten matches, so a national side would have a window.
        for k in range(10):
            mid = 4001 + k
            match(mid, 32, FRANCE, ITALY, "finished", datetime(2026, 6, 1, 19, 0, tzinfo=timezone.utc) + timedelta(days=7 * k))
            lineup(mid, FRANCE, dict(SLOTS))
        for p, key in LINKS.items():
            x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('player', 'transfermarkt', %s, %s)", (key, p))
            for kind in ("injuries", "suspensions"):
                x("""INSERT INTO ops.transfermarkt_reads(kind, provider_key, priority, next_due_at, read_at)
                     VALUES (%s, %s, 1, %s, %s)""", (kind, key, NOW + timedelta(days=1), NOW - timedelta(days=2)))

    @classmethod
    def lineup(cls, mid, team, xi, bench=(), confirmed=True, formation="4-3-3"):
        x = cls.db.execute
        x("""INSERT INTO core.lineups(season_id, match_id, team_id, side, formation, confirmed)
             SELECT 2026, %s, %s, CASE WHEN m.home_team_id = %s THEN 'home' ELSE 'away' END::core.side, %s, %s FROM core.matches m WHERE m.id = %s""",
          (mid, team, team, formation, confirmed, mid))
        for n, (p, (pos, px, py)) in enumerate(xi.items()):
            x("""INSERT INTO core.lineup_players(season_id, match_id, team_id, player_id, is_starter, shirt_number, position_id, pitch_x, pitch_y)
                 VALUES (2026, %s, %s, %s, true, %s, %s, %s, %s)""", (mid, team, p, p % 100, pos, px, py))
            x("INSERT INTO core.player_match_stats(season_id, match_id, team_id, player_id, minutes_played) VALUES (2026, %s, %s, %s, 90)", (mid, team, p))
        for p in bench:
            x("""INSERT INTO core.lineup_players(season_id, match_id, team_id, player_id, is_starter, shirt_number, pitch_x, pitch_y)
                 VALUES (2026, %s, %s, %s, false, %s, 0, 0)""", (mid, team, p, p % 100))
            x("INSERT INTO core.player_match_stats(season_id, match_id, team_id, player_id, minutes_played) VALUES (2026, %s, %s, %s, %s)",
              (mid, team, p, 20 if p == 114 else 0))

    def run_step(self, now=NOW):
        """probable.refresh under the calculation role, as the side process runs it."""
        self.db.execute("SET ROLE vega_calc")
        try:
            return probable().refresh(self.db, now)
        finally:
            self.db.execute("RESET ROLE")

    def sides(self):
        return {(m, t): r for m, t, *r in self.db.execute(
            """SELECT match_id, team_id, season_id, method, basis_lineups, basis_from, basis_to, formation, computed_at
               FROM agg.match_probable_lineups ORDER BY 1, 2""").fetchall()}

    def starters(self, match=TARGET, team=PSG):
        return {p: (pos, x, y, share, rep) for p, pos, x, y, share, rep in self.db.execute(
            """SELECT player_id, position_id, pitch_x, pitch_y, share, replaces_player_id FROM agg.match_probable_lineup_players
               WHERE match_id = %s AND team_id = %s AND role = 'starter' ORDER BY ord""", (match, team)).fetchall()}

    def absent(self, match=TARGET, team=PSG):
        return self.db.execute(
            """SELECT player_id, absence_kind, absence_label, expected_return, matches_remaining FROM agg.match_probable_lineup_players
               WHERE match_id = %s AND team_id = %s AND role = 'absent' ORDER BY ord""", (match, team)).fetchall()

    def scenario(self, sql_rows=()):
        """Rows added for one test, removed after it."""
        for sql, args in sql_rows:
            self.db.execute(sql, args)
        self.addCleanup(self.cleanup)

    def cleanup(self):
        x = self.db.execute
        x("DELETE FROM agg.match_probable_lineup_players")
        x("DELETE FROM agg.match_probable_lineups")
        x("DELETE FROM core.player_injuries")
        x("DELETE FROM core.player_suspensions")
        x("DELETE FROM core.provider_squads")
        x("DELETE FROM core.provider_ids WHERE entity_type = 'team'")
        x("DELETE FROM ops.provider_links")
        x("DELETE FROM core.lineup_players WHERE match_id >= 3000 AND match_id < 4000")
        x("DELETE FROM core.player_match_stats WHERE match_id >= 3000 AND match_id < 4000")
        x("DELETE FROM core.lineups WHERE match_id >= 3000 AND match_id < 4000")
        x("DELETE FROM core.matches WHERE id >= 3000 AND id < 4000")
        x("UPDATE ops.transfermarkt_reads SET read_at = %s", (NOW - timedelta(days=2),))


class RefreshTest(RefreshBase):
    def test_61b_61c_61d_scope_window_and_basis(self):
        self.scenario()
        counts = self.run_step()
        sides = self.sides()
        # PSG in the Ligue 1 match and in the cup tie (30 Nov); Lorient (4 elevens), the match in 8 days and the national match: none.
        self.assertEqual(sorted(sides), [(TARGET, PSG), (CUP_TIE, PSG)])
        self.assertEqual(counts["sides"], 2)
        season, method, lineups, start, end, formation, computed = sides[(TARGET, PSG)]
        # The ten latest complete confirmed elevens: 1003 (20 Sep) to 1012 (22 Nov); 1013 (ten), 1014 (not confirmed), 1015 (unknown) left out.
        self.assertEqual((season, method, lineups, start, end, formation), (2026, "probable-v1", 10, date(2026, 9, 20), date(2026, 11, 22), "4-3-3"))
        self.assertEqual(computed, NOW)
        starters = self.starters()
        self.assertEqual(sorted(starters), sorted(BASE))
        # The template's slots (the latest eleven of the formation): each player in his own.
        for p, (pos, x, y, share, rep) in starters.items():
            self.assertEqual((pos, round(x, 2), round(y, 2)), SLOTS[p], p)
            self.assertIsNone(rep)
        self.assertAlmostEqual(starters[103][3], 0.8)  # 8 starts in 10
        self.assertAlmostEqual(starters[108][3], 0.9)
        self.assertAlmostEqual(starters[100][3], 1.0)
        self.assertEqual(self.absent(), [])

    def test_61d_stale_rows_go(self):
        self.scenario()
        x = self.db.execute
        for match, team in ((STALE, OPP), (LATER, PSG), (NATIONAL, FRANCE)):
            x("""INSERT INTO agg.match_probable_lineups(match_id, season_id, team_id, side, method, computed_at, basis_lineups, basis_from, basis_to, formation)
                 VALUES (%s, 2026, %s, 'home', 'probable-v1', %s, 10, '2026-09-01', '2026-11-01', '4-3-3')""", (match, team, NOW - timedelta(days=1)))
            x("""INSERT INTO agg.match_probable_lineup_players(match_id, team_id, player_id, role, ord, share)
                 VALUES (%s, %s, 100, 'starter', 0, 1)""", (match, team))
        counts = self.run_step()
        self.assertEqual(sorted(self.sides()), [(TARGET, PSG), (CUP_TIE, PSG)])
        self.assertEqual(counts["deleted"], 3)
        self.assertEqual(x("SELECT count(*) FROM agg.match_probable_lineup_players WHERE match_id IN (%s, %s, %s)", (STALE, LATER, NATIONAL)).fetchone()[0], 0)
        # The match kicked off since: its rows go at the next run.
        self.run_step(datetime(2026, 11, 28, 19, 50, tzinfo=timezone.utc))
        self.assertNotIn((TARGET, PSG), self.sides())

    def test_61e_61g_an_injured_starter_is_replaced_in_his_slot(self):
        # 103 hurt on 23 Nov, after his last appearance (22 Nov): out, 112 (the centre back most started) in his slot.
        injury = """INSERT INTO core.player_injuries(player_id, kind, label, start_date, end_date, source, as_of)
                    VALUES (%s, %s, %s, %s, %s, 'transfermarkt', '2026-11-24')"""
        self.scenario([(injury, (103, "injury", "Thigh injury", date(2026, 11, 23), date(2026, 12, 6))),
                       # 104 hurt on 20 Nov, played on 22 Nov: not out; 105 from the match day: not out.
                       (injury, (104, "injury", "Knock", date(2026, 11, 20), None)),
                       (injury, (105, "illness", "Flu", date(2026, 11, 28), None))])
        self.run_step()
        starters = self.starters()
        self.assertNotIn(103, starters)
        self.assertIn(104, starters)
        self.assertIn(105, starters)
        pos, x, y, share, rep = starters[112]
        self.assertEqual((pos, round(x, 2), round(y, 2), rep), (34, 0.36, 0.63, 103))
        self.assertAlmostEqual(share, 0.2)
        self.assertEqual(self.absent(), [(103, "injury", "Thigh injury", date(2026, 12, 6), None)])

    def test_61f_suspensions_of_the_match_s_competition(self):
        suspension = """INSERT INTO core.player_suspensions(player_id, label, start_date, end_date, matches_missed, matches_possible,
                          competition_code, competition_id, season_year, source, as_of)
                        VALUES (%s, %s, '2026-11-22', NULL, %s, %s, %s, %s, 2026, 'transfermarkt', '2026-11-23')"""
        self.scenario([(suspension, (106, "Yellow card suspension", 0, 1, "FR1", L1)),  # Ligue 1: out of the Ligue 1 match only
                       (suspension, (107, "Red card suspension", 1, 1, "FR1", L1)),  # served: not out
                       (suspension, (108, "Red card suspension", 0, 2, "CL", None)),  # not linked: not out
                       (suspension, (109, "Yellow card suspension", 0, 1, "FR1", L1)),  # his link in quarantine: not out
                       ("""INSERT INTO ops.provider_links(entity_type, provider, provider_key, entity_id, rule, quarantined_at)
                           VALUES ('player', 'transfermarkt', %s, 109, 'name_match', now())""", (LINKS[109],)),
                       (suspension, (110, "Yellow card suspension", 0, 1, "FR1", L1))])  # empty end, read 50 days ago: not out
        self.db.execute("UPDATE ops.transfermarkt_reads SET read_at = %s WHERE provider_key = %s AND kind = 'suspensions'",
                        (NOW - timedelta(days=50), LINKS[110]))
        self.run_step()
        starters = self.starters()
        self.assertNotIn(106, starters)
        self.assertEqual(starters[113][4], 106)  # the midfielder most used
        self.assertEqual(starters[113][0], 73)  # in 106's slot
        for p in (107, 108, 109, 110):
            self.assertIn(p, starters)
        self.assertEqual(self.absent(), [(106, "suspension", "Yellow card suspension", None, 1)])
        # The cup tie: the Ligue 1 suspension does not count.
        self.assertIn(106, self.starters(CUP_TIE))
        self.assertEqual(self.absent(CUP_TIE), [])

    def test_61h_a_player_gone_to_another_club(self):
        x = self.db.execute
        self.scenario()
        # 111 in Monaco's eleven on 24 Nov; 110 in France's on 24 Nov (a national team: kept).
        x("""INSERT INTO core.matches(id, competition_season_id, season_id, source, status, home_team_id, away_team_id, kickoff_at, match_date)
             VALUES (3001, 30, 2026, 'pitchapi', 'finished', %s, %s, '2026-11-24T15:00Z', '2026-11-24'),
                    (3002, 32, 2026, 'pitchapi', 'finished', %s, %s, '2026-11-24T19:00Z', '2026-11-24')""", (MONACO, OPP, FRANCE, ITALY))
        self.lineup(3001, MONACO, {111: SLOTS[111]})
        self.lineup(3002, FRANCE, {110: SLOTS[110]})
        self.run_step()
        starters = self.starters()
        self.assertNotIn(111, starters)
        self.assertIn(110, starters)
        pos, _, _, _, rep = starters[114]
        self.assertEqual((pos, rep), (108, None))  # in 111's slot, naming no one
        self.assertEqual(self.absent(), [])

    def test_61i_the_club_s_squad(self):
        x = self.db.execute
        self.scenario()
        x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('team', 'transfermarkt', '583', %s)", (PSG,))
        # The squad read on 24 Nov: every player but 109; 108's link removed (not linked: kept).
        x("""INSERT INTO core.provider_squads(provider, club_key, season_year, player_key, read_on)
             SELECT 'transfermarkt', '583', 2026, k, '2026-11-24' FROM unnest(%s::text[]) k""", ([k for p, k in LINKS.items() if p != 109],))
        x("DELETE FROM core.provider_ids WHERE entity_type = 'player' AND entity_id = 108")
        self.run_step()
        starters = self.starters()
        self.assertNotIn(109, starters)
        self.assertIn(108, starters)
        self.assertEqual(self.absent(), [])
        x("""INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('player', 'transfermarkt', %s, 108)""", (LINKS[108],))
        # A squad read before his last appearance for the club says nothing of him (read 1 Nov, he played on 22 Nov): kept.
        x("UPDATE core.provider_squads SET read_on = '2026-11-01'")
        self.run_step()
        self.assertIn(109, self.starters())
        # No squad read: kept.
        x("DELETE FROM core.provider_squads")
        self.run_step()
        self.assertIn(109, self.starters())

    def test_61k_61l_nothing_else_is_written_and_a_rerun_is_the_same(self):
        self.scenario()
        tables = ("core.lineups", "core.lineup_players", "agg.match_forecasts", "agg.match_lineup_forecasts", "agg.lineup_usuals",
                  "core.player_injuries", "core.player_suspensions", "core.matches")
        print_ = lambda: {t: self.db.execute(f"SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) FROM {t} t").fetchone()[0] for t in tables}
        before = print_()
        self.run_step()
        rows = lambda: self.db.execute(
            """SELECT p.* FROM agg.match_probable_lineup_players p ORDER BY match_id, team_id, role, ord""").fetchall()
        first, first_sides = rows(), {k: v[:-1] for k, v in self.sides().items()}
        self.run_step(NOW + timedelta(minutes=15))
        self.assertEqual(print_(), before)
        self.assertEqual(rows(), first)
        self.assertEqual({k: v[:-1] for k, v in self.sides().items()}, first_sides)
        self.assertEqual({v[-1] for v in self.sides().values()}, {NOW + timedelta(minutes=15)})

    def test_61d_the_read_views(self):
        self.scenario()
        self.run_step()
        x = self.db.execute
        x("SET ROLE vega_read")
        try:
            side = x("""SELECT match_key, match_id, team_key, team_id, side, method, basis_lineups, formation
                        FROM api.match_probable_lineups WHERE match_key = %s""", (TARGET,)).fetchall()
            players = x("""SELECT player_id, name, role, shirt_number FROM api.match_probable_lineup_players
                           WHERE match_key = %s AND team_key = %s ORDER BY role, ord""", (TARGET, PSG)).fetchall()
        finally:
            x("RESET ROLE")
        self.assertEqual(len(side), 1)
        self.assertRegex(side[0][1], r"^m_")
        self.assertRegex(side[0][3], r"^t_")
        self.assertEqual((side[0][4], side[0][5], side[0][6], side[0][7]), ("home", "probable-v1", 10, "4-3-3"))
        self.assertEqual(len(players), 11)
        self.assertTrue(all(p[0].startswith("p_") and p[1].startswith("Player ") and p[2] == "starter" for p in players))


if __name__ == "__main__":
    unittest.main()
