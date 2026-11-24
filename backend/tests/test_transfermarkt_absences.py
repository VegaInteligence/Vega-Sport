"""The injured and suspended players, lot 1 « Données » (FAILURE_MODES.md §59, 59a–59ag, written before these tests).

On a disposable local PostgreSQL (VEGA_V2_ABSENCES_TEST_DSN, database vega_v2_absences_test), under the collection role
(vega_collect) where the reader writes: the Transfermarkt reader's suspensions unit by its real entry point
(`Reader.read`: fetch, data_of, write_*, queue row), its planning (`Reader.enqueue`, `Reader.focus`, `Reader.plan`) and
the read API's routes through the real handler under vega_read (tests/read_http.mjs). Only the provider is replaced,
by synthetic answers in the shape of the probe of 24 Nov 2026 (/mnt/project-files/blesses-suspendus/sonde-transfermarkt/).
"""

from datetime import date, datetime, timedelta, timezone
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import unittest
from unittest import mock
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))

from vega import transfermarkt as tm  # noqa: E402
from prerequisites import required  # noqa: E402

try:
    import psycopg
except ImportError:
    psycopg = None

DSN = os.environ.get("VEGA_V2_ABSENCES_TEST_DSN")
NODE = shutil.which("node")
HTTP_READY = bool(NODE) and (ROOT / "api" / "node_modules" / "pg").is_dir()


def body(data):
    return json.dumps({"success": True, "data": data}).encode()


def absence(start, end, name="Yellow card suspension", competition="FR1", missed=1, possible=1, days=None, returning=None, season=2026):
    """An element of /player/{id}/absence as the probe of 24 Nov 2026 saw it (07-tmapi-player-357565-absence)."""
    return {"playerId": "342229", "absenceId": 1, "missedGamesCount": missed, "possibleMissingGamesCount": possible,
            "competitionId": competition, "seasonId": season, "start": start, "end": end,
            "durationDetails": {"days": days, "daysDisplay": "", "returningDays": returning, "returningDaysDisplay": ""},
            "name": name, "season": {"id": season, "display": "26/27"}}


def injury(start, end, label="Hamstring injury", games=3, season=2026):
    return {"seasonId": season, "name": label, "start": start, "end": end, "missedGamesCount": games}


ABSENCES = {"playerId": "342229", "competitionIds": ["FR1", "CL"], "absences": [
    absence("2026-03-01", "2026-03-08", "Red card suspension", "FR1", 2, 2, days=7),
    absence("2026-01-20", "2026-01-29", "Indirect card suspension", "CL", 1, 1, days=9),
    absence("2025-11-01", "2025-11-20", "National team call-up", None, 0, None),  # 59a: not a suspension
]}


class PureTest(unittest.TestCase):
    def test_59a_only_suspensions_are_kept(self):
        self.assertTrue(tm.is_suspension("Yellow card suspension"))
        self.assertTrue(tm.is_suspension("RED CARD SUSPENSION"))
        self.assertTrue(tm.is_suspension("Indirect card suspension"))
        for name in ("National team call-up", "Leave of absence", "", None, 7, "Ankle injury"):
            self.assertFalse(tm.is_suspension(name), name)
        read = tm.parse_suspensions({"absences": [
            absence("2026-03-01", "2026-03-08", "Red card suspension"),
            absence("2026-02-01", "2026-02-03", "National team call-up"),
            absence("2026-02-05", "2026-02-07", None),
            absence(None, "2026-02-07"),  # no start: skipped
            "not an object",
        ]})
        self.assertEqual([s["label"] for s in read], ["Red card suspension"])
        self.assertEqual(tm.parse_suspensions({"absences": None}), [])
        self.assertEqual(tm.parse_suspensions({}), [])
        with self.assertRaises(tm.Failed) as failed:
            tm.parse_suspensions({"absences": "x"})
        self.assertEqual(failed.exception.code, "SCHEMA_CHANGED")

    def test_59b_59n_facts_keep_unknown_apart_from_zero(self):
        closed, ongoing, unknown, odd = tm.parse_suspensions({"absences": [
            absence("2026-03-01", "2026-03-08", "Red card suspension", "FR1", 0, 2, days=7),
            # 59n (hypothesis H1): an ongoing one, as an ongoing injury: end to come or null, returningDays set.
            absence("2026-11-22", None, "Yellow card suspension", "CL", 0, 1, days=None, returning=4),
            absence("2026-11-20", "2026-12-01", "Yellow card suspension", "EURO", None, None),
            absence("2026-10-01", "2026-10-04", "Yellow card suspension", "no code!", True, "2", season=1800),
        ]})
        self.assertEqual(closed, {"label": "Red card suspension", "start": date(2026, 3, 1), "end": date(2026, 3, 8), "days": 8,
                                  "games": 0, "possible": 2, "competition": "FR1", "season": 2026})
        self.assertEqual((ongoing["end"], ongoing["days"], ongoing["games"], ongoing["possible"], ongoing["competition"]),
                         (None, None, 0, 1, "CL"))
        self.assertEqual((unknown["days"], unknown["games"], unknown["possible"], unknown["competition"]), (12, None, None, "EURO"))
        self.assertEqual((odd["games"], odd["possible"], odd["competition"], odd["season"]), (None, None, None, None))

    def test_59v_the_named_thresholds(self):
        self.assertEqual((tm.FOCUS_PLAYERS, tm.FOCUS_HORIZON, tm.FOCUS_PERIOD), (18, timedelta(days=7), timedelta(days=1)))
        self.assertEqual(tm.FOCUS_KINDS, ("injuries", "suspensions"))
        self.assertEqual(tm.PERIODS["suspensions"], tm.PERIODS["injuries"])
        self.assertIn("suspensions", tm.NOT_FOUND_REFUSED)
        # 59an: 200 clubs, so that a midweek of European nights (some 80 clubs kicking off within two days) leaves room for
        # the clubs playing the day after. The focus's whole load stays under a quarter of what the reader can ask in a day.
        self.assertEqual(tm.FOCUS_CLUBS_MAX, 200)
        daily = 86400 / (tm.INTERVAL + tm.JITTER / 2)
        self.assertLessEqual(tm.FOCUS_CLUBS_MAX * tm.FOCUS_PLAYERS * len(tm.FOCUS_KINDS), 0.25 * daily)


@required(DSN and psycopg, "requires a disposable local absences DB (VEGA_V2_ABSENCES_TEST_DSN) and psycopg")
class AbsencesBase(unittest.TestCase):
    """One league edition in progress (2026/2027), Ligue 1 known as FR1 (tm_history.LEAGUES), two clubs, four players."""

    @classmethod
    def setUpClass(cls):
        from vega.store import connect_local, migrate

        target = urlparse(DSN)
        if target.hostname not in ("localhost", "127.0.0.1", "::1") or target.path != "/vega_v2_absences_test":
            raise RuntimeError("dedicated local absences DB required")
        cls.db = connect_local(DSN)
        cls.db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        migrate(cls.db)
        x = cls.db.execute
        x("INSERT INTO core.countries(code) VALUES ('FRA') ON CONFLICT DO NOTHING")
        x("INSERT INTO core.seasons(id, label) VALUES (2025, '2025/2026'), (2026, '2026/2027') ON CONFLICT DO NOTHING")
        x("SELECT core.ensure_season_partitions(2025)")
        x("SELECT core.ensure_season_partitions(2026)")
        x("INSERT INTO core.competitions(id, name, country_code, kind) VALUES (30, 'Ligue 1', 'FRA', 'league')")
        x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('competition', 'pitchapi', 'l_3FJFUl', 30)")
        x("INSERT INTO core.competition_seasons(id, competition_id, season_id, native_label, is_current) VALUES (30, 30, 2026, '2026/2027', true)")
        x("INSERT INTO core.teams(id, name, country_code) VALUES (1, 'Paris Saint-Germain', 'FRA'), (2, 'Olympique Lyonnais', 'FRA')")
        x("""INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id)
             VALUES ('team', 'pitchapi', 't_psg001', 1), ('team', 'pitchapi', 't_ol0002', 2)""")
        x("""INSERT INTO core.players(id, name, short_name) VALUES (10, 'Kylian Mbappé', 'K. Mbappé'), (11, 'Ousmane Dembélé', 'O. Dembélé'),
               (12, 'Achraf Hakimi', 'A. Hakimi'), (13, 'Vitinha Ferreira', 'Vitinha')""")
        x("""INSERT INTO core.matches(id, competition_season_id, season_id, source, status, home_team_id, away_team_id, kickoff_at, match_date)
             VALUES (500, 30, 2026, 'pitchapi', 'finished', 1, 2, '2026-09-01T19:00:00Z', '2026-09-01'),
                    (501, 30, 2026, 'pitchapi', 'finished', 2, 1, '2026-10-01T19:00:00Z', '2026-10-01')""")
        for match in (500, 501):
            for p in (10, 11, 12, 13):
                x("INSERT INTO core.player_match_stats(season_id, match_id, team_id, player_id, minutes_played) VALUES (2026, %s, 1, %s, 90)", (match, p))
        for table in ("teams", "players", "matches", "competitions", "competition_seasons"):
            x(f"SELECT setval(pg_get_serial_sequence('core.{table}', 'id'), 1000)")

    @classmethod
    def tearDownClass(cls):
        cls.db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        cls.db.close()


class SuspensionsReplayTest(AbsencesBase):
    """59a–59n: the suspensions unit by Reader.read under vega_collect, each replay rolled back."""

    PATH = "/player/342229/absence"
    INJURIES_PATH = "/player/342229/injury"

    def setUp(self):
        transaction = self.db.transaction(force_rollback=True)
        transaction.__enter__()
        self.addCleanup(transaction.__exit__, None, None, None)
        x = self.x = self.db.execute
        x("""INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id)
             VALUES ('player', 'transfermarkt', '342229', 10), ('player', 'transfermarkt', '288230', 11), ('team', 'transfermarkt', '583', 1)""")
        for kind in ("injuries", "suspensions"):
            x("INSERT INTO ops.transfermarkt_reads(kind, provider_key, priority, next_due_at) VALUES (%s, '342229', 1, now() - interval '1 minute')", (kind,))
        self.answers = {}
        x("SET LOCAL ROLE vega_collect")
        self.reader = tm.Reader(self.db, self.fetch, interval=0, jitter=0, sleep=lambda s: None, log=lambda *a, **k: None)

    def fetch(self, path, params=()):
        answer = self.answers[urlparse(path).path]
        return answer if isinstance(answer, tuple) else (200, {}, body(answer))

    def read(self, answer, kind="suspensions", path=None):
        self.answers[path or self.PATH] = answer
        return self.reader.read(kind, [("342229", 1)])

    def rows(self, table="core.player_suspensions"):
        return sorted(r[0] for r in self.x(
            f"SELECT (to_jsonb(t) - 'updated_at'::text)::text FROM {table} t WHERE player_id = 10").fetchall())

    def ids(self):
        return [i for (i,) in self.x("SELECT id FROM core.player_suspensions WHERE player_id = 10 ORDER BY start_date").fetchall()]

    def unit(self, kind="suspensions"):
        return self.x("""SELECT read_at IS NOT NULL, error_code, last_http_status, rows_written, next_due_at - now() <= interval '1 day'
                         FROM ops.transfermarkt_reads WHERE kind = %s AND provider_key = '342229'""", (kind,)).fetchone()

    def facts(self):
        return self.x("""SELECT label, start_date, end_date, days, matches_missed, matches_possible, competition_code, competition_id,
                                season_year, source::text, absent_since
                         FROM core.player_suspensions WHERE player_id = 10 ORDER BY start_date""").fetchall()

    def test_59a_59b_59c_59d_suspensions_read_with_their_competition_and_replayed(self):
        self.assertEqual(self.read(ABSENCES), "ok")
        today = self.x("SELECT current_date").fetchone()[0]
        self.assertEqual(self.facts(), [
            ("Indirect card suspension", date(2026, 1, 20), date(2026, 1, 29), 10, 1, 1, "CL", None, 2026, "transfermarkt", None),
            ("Red card suspension", date(2026, 3, 1), date(2026, 3, 8), 8, 2, 2, "FR1", 30, 2026, "transfermarkt", None),
        ])
        self.assertEqual(self.x("SELECT DISTINCT as_of FROM core.player_suspensions").fetchall(), [(today,)])
        self.assertEqual(self.unit(), (True, None, 200, 2, False))
        # The call-up is written nowhere.
        self.assertEqual(self.rows("core.player_injuries"), [])
        accepted, ids = self.rows(), self.ids()
        self.assertEqual(self.read(ABSENCES), "ok")
        self.assertEqual((self.rows(), self.ids(), self.unit()[3]), (accepted, ids, 0))

    def test_59b_null_and_zero_stay_apart(self):
        self.assertEqual(self.read({"absences": [absence("2026-11-22", None, missed=0, possible=None, competition="CL"),
                                                 absence("2026-10-01", "2026-10-04", missed=None, possible=0, competition="GB1")]}), "ok")
        self.assertEqual([f[4:8] for f in self.facts()], [(None, 0, "GB1", None), (0, None, "CL", None)])

    def test_59e_an_omitted_suspension_is_kept_and_marked_then_listed_again(self):
        self.assertEqual(self.read(ABSENCES), "ok")
        ids = self.ids()
        self.assertEqual(self.read({"absences": ABSENCES["absences"][:1]}), "ok")
        today = self.x("SELECT current_date").fetchone()[0]
        self.assertEqual([f[-1] for f in self.facts()], [today, None])
        self.assertEqual(self.read(ABSENCES), "ok")
        self.assertEqual(([f[-1] for f in self.facts()], self.ids()), ([None, None], ids))

    def test_59f_an_empty_answer_when_he_holds_some_is_refused(self):
        self.assertEqual(self.read(ABSENCES), "ok")
        accepted = self.rows()
        for answer, code in (({"absences": []}, "HISTORY_EMPTY"),
                             ({"absences": [ABSENCES["absences"][2]]}, "HISTORY_EMPTY"),  # only a call-up
                             ({"absences": [absence(None, "2026-03-08", "Red card suspension")]}, "HISTORY_INVALID")):
            self.assertEqual(self.read(answer), "failed", answer)
            self.assertEqual(self.rows(), accepted)
            self.assertEqual(self.unit(), (True, code, 200, 2, True))

    def test_59f_a_first_empty_answer_is_accepted(self):
        self.assertEqual(self.read({"absences": [ABSENCES["absences"][2]]}), "ok")
        self.assertEqual((self.rows(), self.unit()), ([], (True, None, 200, 0, False)))

    def test_59g_one_key_with_two_facts_writes_nothing(self):
        twice = {"absences": [absence("2026-03-01", "2026-03-08", "Red card suspension", "FR1", 2, 2),
                              absence("2026-03-01", "2026-03-09", "Red card suspension", "FR1", 2, 2)]}
        self.assertEqual(self.read(twice), "failed")
        self.assertEqual((self.rows(), self.unit()[:3]), ([], (False, "HISTORY_CONFLICT", 200)))
        # The same suspension in two competitions on one day is two suspensions.
        self.assertEqual(self.read({"absences": [absence("2026-03-01", "2026-03-08", competition="FR1"),
                                                 absence("2026-03-01", "2026-03-08", competition="CL")]}), "ok")
        self.assertEqual(len(self.rows()), 2)

    def test_59h_a_relabelled_suspension_is_updated_in_place(self):
        self.assertEqual(self.read(ABSENCES), "ok")
        ids = self.ids()
        relabelled = {"absences": [absence("2026-03-01", "2026-03-10", "Red card suspension (3 matches)", "FR1", 3, 3),
                                   *ABSENCES["absences"][1:]]}
        self.assertEqual(self.read(relabelled), "ok")
        self.assertEqual(self.ids(), ids)
        self.assertEqual(self.facts()[1][:6], ("Red card suspension (3 matches)", date(2026, 3, 1), date(2026, 3, 10), 10, 3, 3))

    def test_59i_a_404_is_a_refusal_never_an_empty_list(self):
        self.assertEqual(self.read((404, {}, b"")), "missing")
        unit = self.x("""SELECT read_at, error_code, last_http_status, next_due_at - now() > interval '80 days'
                         FROM ops.transfermarkt_reads WHERE kind = 'suspensions' AND provider_key = '342229'""").fetchone()
        self.assertEqual(unit, (None, "NOT_FOUND", 404, True))
        self.assertEqual(self.read(ABSENCES), "ok")
        read_at = self.x("SELECT read_at FROM ops.transfermarkt_reads WHERE kind = 'suspensions' AND provider_key = '342229'").fetchone()
        accepted = self.rows()
        self.assertEqual(self.read((404, {}, b"")), "missing")
        self.assertEqual(self.x("SELECT read_at, rows_written FROM ops.transfermarkt_reads WHERE kind = 'suspensions' AND provider_key = '342229'").fetchone(),
                         (read_at[0], 2))
        self.assertEqual(self.rows(), accepted)

    def test_59j_a_doubted_link_writes_nothing(self):
        self.x("RESET ROLE")
        self.x("""INSERT INTO ops.provider_links(entity_type, provider, provider_key, entity_id, rule, quarantined_at, quarantine_reason)
                  VALUES ('player', 'transfermarkt', '342229', 10, 'snapshot', now(), 'birth_date_differs')""")
        self.x("SET LOCAL ROLE vega_collect")
        self.assertEqual(self.read(ABSENCES), "ok")
        self.assertEqual((self.rows(), self.unit()[3]), ([], 0))

    def test_59k_each_unit_leaves_the_other_ones_episodes_alone(self):
        injuries = {"injuries": [injury("2025-03-01", "2025-03-20"), injury("2026-02-01", "2026-02-10", "Knee injury", 2)]}
        self.assertEqual(self.read(injuries, "injuries", self.INJURIES_PATH), "ok")
        self.assertEqual(self.read(ABSENCES), "ok")
        held_injuries, held_suspensions = self.rows("core.player_injuries"), self.rows()
        self.assertEqual((len(held_injuries), len(held_suspensions)), (2, 2))
        # Injuries: a truncated list (marks its omitted episode), an empty one (HISTORY_EMPTY), a 404: no suspension moves.
        self.assertEqual(self.read({"injuries": injuries["injuries"][:1]}, "injuries", self.INJURIES_PATH), "ok")
        self.assertEqual(self.read({"injuries": []}, "injuries", self.INJURIES_PATH), "failed")
        self.assertEqual(self.read((404, {}, b""), "injuries", self.INJURIES_PATH), "missing")
        self.assertEqual(self.rows(), held_suspensions)
        marked_injuries = self.rows("core.player_injuries")
        self.assertNotEqual(marked_injuries, held_injuries)  # the omitted injury is marked: the injuries' own rule
        # Suspensions: truncated, empty, 404: no injury moves.
        self.assertEqual(self.read({"absences": ABSENCES["absences"][:1]}), "ok")
        self.assertEqual(self.read({"absences": []}), "failed")
        self.assertEqual(self.read((404, {}, b"")), "missing")
        self.assertEqual(self.rows("core.player_injuries"), marked_injuries)
        # An injuries list with episodes, read while suspensions are held: their absent_since never set by it.
        self.assertEqual(self.read(injuries, "injuries", self.INJURIES_PATH), "ok")
        self.assertEqual(self.x("SELECT count(*) FROM core.player_suspensions WHERE absent_since IS NULL").fetchone()[0], 1)

    def test_59m_a_challenge_pauses_and_writes_nothing(self):
        self.assertEqual(self.read((202, {"x-amzn-waf-action": "challenge"}, b"")), "blocked")
        self.assertEqual(self.rows(), [])
        self.assertIsNotNone(self.x("SELECT paused_until FROM ops.transfermarkt_state WHERE id = 1").fetchone()[0])

    def test_59l_every_linked_player_gets_a_suspensions_unit_at_his_injuries_priority(self):
        x = self.x
        x("RESET ROLE")
        x("DELETE FROM ops.transfermarkt_reads")
        x("INSERT INTO ops.transfermarkt_reads(kind, provider_key, priority, next_due_at) VALUES ('injuries', '342229', 3, now() + interval '1 day')")
        x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('player', 'transfermarkt', '340324', 12)")
        x("""INSERT INTO ops.provider_links(entity_type, provider, provider_key, entity_id, rule, quarantined_at, quarantine_reason)
             VALUES ('player', 'transfermarkt', '340324', 12, 'snapshot', now(), 'birth_date_differs')""")
        x("SET LOCAL ROLE vega_collect")
        now = x("SELECT now()").fetchone()[0]
        self.reader.enqueue(now)
        units = dict(((k, key), p) for k, key, p in x(
            "SELECT kind, provider_key, priority FROM ops.transfermarkt_reads WHERE kind IN ('injuries', 'suspensions')").fetchall())
        self.assertEqual(units, {("injuries", "342229"): 3, ("suspensions", "342229"): 3,
                                 ("injuries", "288230"): 1, ("suspensions", "288230"): 1})
        count = x("SELECT count(*) FROM ops.transfermarkt_reads").fetchone()[0]
        self.reader.enqueue(now)
        self.assertEqual(x("SELECT count(*) FROM ops.transfermarkt_reads").fetchone()[0], count)


    def test_59ah_a_new_suspensions_unit_is_first_due_within_its_period_by_its_key(self):
        x = self.x
        x("RESET ROLE")
        x("DELETE FROM ops.transfermarkt_reads")
        x("DELETE FROM core.provider_ids WHERE entity_type = 'player' AND provider = 'transfermarkt'")
        # 140 linked players of the season in progress (priority 1) and one who never played (priority 9).
        for n in range(140):
            x("INSERT INTO core.players(id, name) VALUES (%s, %s)", (1100 + n, f"Joueur {n}"))
            x("INSERT INTO core.player_match_stats(season_id, match_id, team_id, player_id, minutes_played) VALUES (2026, 500, 1, %s, 90)",
              (1100 + n,))
            x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('player', 'transfermarkt', %s, %s)",
              (str(7100000 + n), 1100 + n))
        x("INSERT INTO core.players(id, name) VALUES (1300, 'Jamais joué')")
        x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('player', 'transfermarkt', '7200000', 1300)")
        x("SET LOCAL ROLE vega_collect")
        now = x("SELECT now()").fetchone()[0]

        def dues(kind):
            return {key: (priority, due - now) for key, priority, due in x(
                "SELECT provider_key, priority, next_due_at FROM ops.transfermarkt_reads WHERE kind = %s", (kind,)).fetchall()}

        self.reader.enqueue(now)
        first = dues("suspensions")
        self.assertEqual(len(first), 141)
        season = [offset for key, (priority, offset) in first.items() if key != "7200000"]
        self.assertTrue(all(timedelta(0) <= offset < timedelta(days=7) for offset in season), sorted(season)[-3:])
        self.assertLessEqual(sum(offset < timedelta(days=1) for offset in season), 40)
        self.assertGreater(len(set(season)), 100)
        self.assertEqual(first["7200000"][0], 9)
        self.assertTrue(timedelta(0) <= first["7200000"][1] < timedelta(days=365))
        # The other units stay due at once.
        self.assertEqual({offset for _, offset in dues("injuries").values()}, {timedelta(0)})
        # The same key, the same first due time.
        x("DELETE FROM ops.transfermarkt_reads WHERE kind = 'suspensions'")
        self.reader.enqueue(now)
        self.assertEqual(dues("suspensions"), first)


class FocusTest(AbsencesBase):
    """59o–59v: the daily read of the players who count for a match close at hand."""

    def setUp(self):
        transaction = self.db.transaction(force_rollback=True)
        transaction.__enter__()
        self.addCleanup(transaction.__exit__, None, None, None)
        x = self.x = self.db.execute
        self.now = x("SELECT now()").fetchone()[0]
        x("""INSERT INTO core.teams(id, name, country_code) VALUES (3, 'Lens', 'FRA'), (4, 'Lorient', 'FRA'), (5, 'Nantes', 'FRA'),
               (6, 'Brest', 'FRA'), (7, 'Rennes', 'FRA')""")
        # Linked clubs: 1 (match in 3 days), 2 (tomorrow), 3 (in 8 days), 5 (kick-off passed, still not started), 6 (postponed in
        # the window); 4 plays in 2 days and is not linked; 7 has a match in 2 days but no player of the season.
        for team, key in ((1, "583"), (2, "1041"), (3, "826"), (5, "995"), (6, "3911"), (7, "273")):
            x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('team', 'transfermarkt', %s, %s)", (key, team))
        for match, home, away, status, offset in ((600, 1, 4, "not_started", "3 days"), (601, 2, 4, "not_started", "1 day"),
                                                  (602, 3, 2, "not_started", "8 days"), (603, 5, 4, "not_started", "-2 hours"),
                                                  (604, 6, 4, "postponed", "2 days"), (605, 7, 4, "not_started", "2 days"),
                                                  (606, 1, 2, "finished", "2 days")):
            x("""INSERT INTO core.matches(id, competition_season_id, season_id, source, status, home_team_id, away_team_id, kickoff_at, match_date)
                 VALUES (%s, 30, 2026, 'pitchapi', %s, %s, %s, now() + %s::interval, (now() + %s::interval)::date)""",
              (match, status, home, away, offset, offset))
        # Club 1's twenty players of the season, rank r with 2000 - 10 r minutes; rank 3 not linked, rank 5 doubted.
        # Player 219 (rank 20) also has a season before with more minutes: they do not count.
        for r in range(1, 21):
            player = 199 + r
            x("INSERT INTO core.players(id, name) VALUES (%s, %s)", (player, f"Joueur {r}"))
            x("INSERT INTO core.player_match_stats(season_id, match_id, team_id, player_id, minutes_played) VALUES (2026, 500, 1, %s, %s)",
              (player, 2000 - 10 * r))
            if r != 3:
                x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('player', 'transfermarkt', %s, %s)",
                  (str(80000 + r), player))
        x("INSERT INTO core.competition_seasons(id, competition_id, season_id, native_label) VALUES (29, 30, 2025, '2025/2026')")
        x("""INSERT INTO core.matches(id, competition_season_id, season_id, source, status, home_team_id, away_team_id, kickoff_at, match_date)
             VALUES (490, 29, 2025, 'pitchapi', 'finished', 1, 2, '2025-09-01T19:00:00Z', '2025-09-01')""")
        x("INSERT INTO core.player_match_stats(season_id, match_id, team_id, player_id, minutes_played) VALUES (2025, 490, 1, 219, 5000)")
        x("""INSERT INTO ops.provider_links(entity_type, provider, provider_key, entity_id, rule, quarantined_at, quarantine_reason)
             VALUES ('player', 'transfermarkt', '80005', 204, 'snapshot', now(), 'birth_date_differs')""")
        # Clubs 2, 3, 5, 6: one linked player each who played for them this season.
        for team, player, key in ((2, 300, "90002"), (3, 301, "90003"), (5, 302, "90005"), (6, 303, "90006")):
            x("INSERT INTO core.players(id, name) VALUES (%s, %s)", (player, f"Joueur {player}"))
            x("INSERT INTO core.player_match_stats(season_id, match_id, team_id, player_id, minutes_played) VALUES (2026, 501, %s, %s, 900)",
              (team, player))
            x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('player', 'transfermarkt', %s, %s)", (key, player))
        # Every linked player's units, healthy, read two days ago, due in five days; one failing suspensions unit.
        keys = [str(80000 + r) for r in range(1, 21) if r != 3] + ["90002", "90003", "90005", "90006"]
        for key in keys:
            for kind in ("injuries", "suspensions", "values", "profile"):
                x("""INSERT INTO ops.transfermarkt_reads(kind, provider_key, priority, next_due_at, read_at)
                     VALUES (%s, %s, 1, now() + interval '5 days', now() - interval '2 days')""", (kind, key))
        x("""UPDATE ops.transfermarkt_reads SET attempts = 2, error_code = 'HTTP_500', last_http_status = 500,
               next_due_at = now() + interval '3 hours' WHERE kind = 'suspensions' AND provider_key = '80001'""")
        self.expected_players = [str(80000 + r) for r in range(1, 19) if r not in (3, 5)] + ["90002"]
        x("SET LOCAL ROLE vega_collect")
        self.reader = tm.Reader(self.db, lambda *a: (404, {}, b""), interval=0, jitter=0, sleep=lambda s: None,
                                clock=lambda: self.now, log=lambda *a, **k: None)

    def queue(self):
        return {(k, key): (p, due, focus) for k, key, p, due, focus in self.x(
            "SELECT kind, provider_key, priority, next_due_at, focus_until FROM ops.transfermarkt_reads").fetchall()}

    def focused(self):
        return sorted(self.x("SELECT kind, provider_key FROM ops.transfermarkt_reads WHERE focus_until IS NOT NULL").fetchall())

    def test_59o_59p_59q_the_perimeter_and_nothing_else(self):
        before = self.queue()
        self.reader.focus(self.now)
        after = self.queue()
        self.assertEqual(set(after), set(before))  # 59q: no row added
        self.assertEqual(self.focused(), sorted((k, key) for k in ("injuries", "suspensions") for key in self.expected_players))
        kickoff = {key: self.x("SELECT kickoff_at FROM core.matches WHERE id = %s", (600 if key.startswith("8") else 601,)).fetchone()[0]
                   for key in self.expected_players}
        for (kind, key), (priority, due, focus) in after.items():
            if (kind, key) in set(self.focused()):
                self.assertEqual((priority, focus), (1, kickoff[key]))
            else:
                self.assertEqual(after[(kind, key)], before[(kind, key)], (kind, key))

    def test_59s_entering_makes_a_healthy_unit_due_and_keeps_a_failing_ones_wait(self):
        before = self.queue()
        self.reader.focus(self.now)
        after = self.queue()
        read_at = self.x("SELECT read_at FROM ops.transfermarkt_reads WHERE kind = 'injuries' AND provider_key = '80001'").fetchone()[0]
        self.assertEqual(after[("injuries", "80001")][1], read_at + tm.FOCUS_PERIOD)
        self.assertEqual(after[("suspensions", "80001")][1], before[("suspensions", "80001")][1])

    def test_59ai_a_focused_unit_never_read_is_due_at_once(self):
        self.x("""UPDATE ops.transfermarkt_reads SET read_at = NULL, next_due_at = now() + interval '6 days'
                  WHERE kind = 'suspensions' AND provider_key = '80002'""")
        before = self.queue()
        self.reader.focus(self.now)
        after = self.queue()
        self.assertLessEqual(after[("suspensions", "80002")][1], self.now)
        self.assertEqual(after[("suspensions", "80001")][1], before[("suspensions", "80001")][1])  # failing: its wait

    def test_59u_due_focused_units_come_first(self):
        self.x("UPDATE ops.transfermarkt_reads SET next_due_at = now() - interval '1 hour' WHERE kind = 'profile'")
        self.assertEqual(self.reader.next_units()[0], "profile")
        self.reader.focus(self.now)
        kind, units = self.reader.next_units()
        self.assertIn(kind, tm.FOCUS_KINDS)
        self.assertIn(units[0][0], self.expected_players)

    def test_59r_a_focused_read_comes_back_within_a_day_another_within_its_period(self):
        self.reader.focus(self.now)
        self.reader.done("injuries", "80001", 1, 0)
        self.reader.done("injuries", "80019", 1, 0)
        self.reader.done("suspensions", "80002", 1, 0, status=404, error="NOT_FOUND", again=tm.NOT_FOUND_AGAIN, accepted=False)
        q = self.queue()
        self.assertEqual(q[("injuries", "80001")][1], self.now + tm.FOCUS_PERIOD)
        self.assertEqual(q[("injuries", "80019")][1], self.now + timedelta(days=7))
        self.assertEqual(q[("suspensions", "80002")][1], self.now + tm.NOT_FOUND_AGAIN)
        # A failure keeps its exponential wait (attempts 2 -> 4 hours).
        self.reader.failed("suspensions", [("80001", 1)], tm.Failed("HTTP_500", 500))
        due = self.x("SELECT next_due_at - now() FROM ops.transfermarkt_reads WHERE kind = 'suspensions' AND provider_key = '80001'").fetchone()[0]
        self.assertEqual(due, timedelta(hours=4))

    def test_59t_leaving_the_perimeter_clears_the_focus(self):
        self.reader.focus(self.now)
        self.x("RESET ROLE")
        self.x("UPDATE core.matches SET status = 'finished' WHERE id = 600")
        self.x("SET LOCAL ROLE vega_collect")
        self.reader.focus(self.now)
        self.assertEqual(self.focused(), [("injuries", "90002"), ("suspensions", "90002")])
        self.reader.done("injuries", "80001", 1, 0)
        self.assertEqual(self.queue()[("injuries", "80001")][1], self.now + timedelta(days=7))

    def test_59v_the_cap_keeps_the_soonest_clubs(self):
        with mock.patch.object(tm, "FOCUS_CLUBS_MAX", 1):
            self.reader.focus(self.now)
        self.assertEqual(self.focused(), [("injuries", "90002"), ("suspensions", "90002")])

    def test_59o_the_plan_applies_the_focus(self):
        self.reader.plan()
        self.assertEqual(len(self.focused()), 2 * len(self.expected_players))


class SquadSeasonTest(AbsencesBase):
    """59am: a squad season out of core.provider_squads' range (1900-2100) is never queued, and one queued before is a failed
    unit, never a crash of the reader (production, 24 Nov 2026: « 350:1894 » refused by provider_squads_season_year_check
    killed the reader eleven times)."""

    def setUp(self):
        transaction = self.db.transaction(force_rollback=True)
        transaction.__enter__()
        self.addCleanup(transaction.__exit__, None, None, None)
        x = self.x = self.db.execute
        self.now = x("SELECT now()").fetchone()[0]
        x("INSERT INTO core.seasons(id, label) VALUES (1900, '1900/1901') ON CONFLICT DO NOTHING")
        x("SELECT core.ensure_season_partitions(1900)")
        x("INSERT INTO core.competition_seasons(id, competition_id, season_id, native_label) VALUES (28, 30, 1900, '1900/1901')")
        x("""INSERT INTO core.matches(id, competition_season_id, season_id, source, status, home_team_id, away_team_id, kickoff_at, match_date)
             VALUES (480, 28, 1900, 'pitchapi', 'finished', 1, 2, '1900-05-01T15:00:00Z', '1900-05-01')""")
        x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('team', 'transfermarkt', '583', 1)")
        self.requests = []
        x("SET LOCAL ROLE vega_collect")
        self.reader = tm.Reader(self.db, self.fetch, interval=0, jitter=0, sleep=lambda s: None, log=lambda *a, **k: None)

    def fetch(self, path, params=()):
        self.requests.append(path)
        return 200, {}, body({"squad": []})

    def squads(self):
        return sorted(k for (k,) in self.x("SELECT provider_key FROM ops.transfermarkt_reads WHERE kind = 'squad'").fetchall())

    def test_59am_a_season_before_1900_is_not_queued(self):
        self.reader.enqueue(self.now)
        self.assertIn("583:1900", self.squads())
        self.assertIn("583:2026", self.squads())
        self.assertNotIn("583:1899", self.squads())

    def test_59am_a_queued_season_out_of_range_fails_without_a_request(self):
        for key in ("583:1894", "583:2101"):
            self.x("INSERT INTO ops.transfermarkt_reads(kind, provider_key, priority, next_due_at) VALUES ('squad', %s, 9, now() - interval '1 minute')",
                   (key,))
            self.assertEqual(self.reader.read("squad", [(key, 9)]), "failed")
            self.assertEqual(self.x("""SELECT read_at IS NULL, attempts, error_code, next_due_at > now()
                                       FROM ops.transfermarkt_reads WHERE kind = 'squad' AND provider_key = %s""", (key,)).fetchone(),
                             (True, 1, "SEASON_OUT_OF_RANGE", True))
        self.assertEqual(self.requests, [])
        self.assertEqual(self.x("SELECT count(*) FROM core.provider_squads").fetchone()[0], 0)


@required(DSN and psycopg and HTTP_READY, "requires the absences DB, psycopg, node and backend/api/node_modules")
class ServedAbsencesTest(AbsencesBase):
    """59w–59ag end to end: the reader writes, then the read API serves under vega_read (committed rows, cleaned after)."""

    def setUp(self):
        self.x = self.db.execute
        self.addCleanup(self.clean)
        self.clean()
        x = self.x
        self.today = x("SELECT current_date").fetchone()[0]
        d = lambda days: (self.today + timedelta(days=days)).isoformat()
        self.d = d
        x("INSERT INTO core.teams(id, name, country_code) VALUES (8, 'Sans Lien', 'FRA') ON CONFLICT DO NOTHING")
        x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('team', 'pitchapi', 't_sans08', 8) ON CONFLICT DO NOTHING")
        x("""INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id)
             VALUES ('team', 'transfermarkt', '583', 1), ('player', 'transfermarkt', '342229', 10), ('player', 'transfermarkt', '288230', 11),
                    ('player', 'transfermarkt', '340324', 12), ('player', 'transfermarkt', '487969', 13)""")
        # Club 583's squads: 2025 (older), 2026 (current): 10, 11, 13 (doubted) and one member not linked; 12 left (absent).
        for year, key, absent in ((2025, "342229", None), (2025, "340324", None), (2026, "342229", None), (2026, "288230", None),
                                  (2026, "487969", None), (2026, "1111111", None), (2026, "340324", d(-30))):
            x("""INSERT INTO core.provider_squads(provider, club_key, season_year, player_key, read_on, absent_since)
                 VALUES ('transfermarkt', '583', %s, %s, current_date, %s)""", (year, key, absent))
        x("""INSERT INTO ops.provider_links(entity_type, provider, provider_key, entity_id, rule, quarantined_at, quarantine_reason)
             VALUES ('player', 'transfermarkt', '487969', 13, 'snapshot', now(), 'birth_date_differs')""")
        for kind in ("injuries", "suspensions"):
            for key in ("342229", "288230", "340324", "487969"):
                x("INSERT INTO ops.transfermarkt_reads(kind, provider_key, priority, next_due_at) VALUES (%s, %s, 1, now() - interval '1 minute')", (kind, key))
        self.answers = {
            # 10: injured to come back next month, an open-ended knock, an episode ended yesterday, one starting tomorrow.
            "/player/342229/injury": {"injuries": [injury(d(-30), d(30), "Cruciate ligament tear", 5), injury(d(-2), None, "Knock", 0),
                                                   injury(d(-20), d(-1), "Calf strain", 2), injury(d(1), d(9), "Surgery", None)]},
            # 10: suspended for the CL (ongoing, unknown end, hypothesis H1), and a past league suspension.
            "/player/342229/absence": {"absences": [absence(d(-3), None, "Yellow card suspension", "CL", 0, 1, returning=5),
                                                    absence(d(-60), d(-50), "Red card suspension", "FR1", 2, 2),
                                                    absence(d(-5), d(5), "National team call-up", None, 0, None)]},
            # 11: an open-ended injury that started before a match he played (a stale one), and a league suspension to come back from.
            "/player/288230/injury": {"injuries": [injury("2026-09-20", None, "Ankle problem", 0)]},
            "/player/288230/absence": {"absences": [absence(d(-1), d(6), "Red card suspension", "FR1", 1, None)]},
            # 12 left the club: his injury is not the club's.
            "/player/340324/injury": {"injuries": [injury(d(-5), d(20), "Hamstring injury", 1)]},
            "/player/340324/absence": {"absences": []},
            # 13 is doubted: nothing written, nothing served.
            "/player/487969/injury": {"injuries": [injury(d(-5), d(20), "Hamstring injury", 1)]},
            "/player/487969/absence": {"absences": []},
        }
        x("SET ROLE vega_collect")
        try:
            reader = tm.Reader(self.db, self.fetch, interval=0, jitter=0, sleep=lambda s: None, log=lambda *a, **k: None)
            for kind in ("injuries", "suspensions"):
                for key in ("342229", "288230", "340324", "487969"):
                    self.assertEqual(reader.read(kind, [(key, 1)]), "ok", (kind, key))
        finally:
            x("RESET ROLE")
        # 11's suspensions read 50 days ago: no longer fresh, so 11 is not « read » (his dated episode still shows).
        x("UPDATE ops.transfermarkt_reads SET read_at = now() - interval '50 days' WHERE kind = 'suspensions' AND provider_key = '288230'")
        self.read_day = x("SELECT min(read_at)::date::text FROM ops.transfermarkt_reads WHERE provider_key = '342229'").fetchone()[0]

    def clean(self):
        x = self.x
        x("RESET ROLE")
        for sql in ("DELETE FROM core.player_match_stats WHERE match_id IN (700, 701)", "DELETE FROM core.matches WHERE id IN (700, 701)",
                    "DELETE FROM core.player_injuries", "DELETE FROM core.player_suspensions", "DELETE FROM ops.transfermarkt_reads",
                    "DELETE FROM core.provider_squads", "DELETE FROM ops.provider_links",
                    "DELETE FROM core.provider_ids WHERE provider = 'transfermarkt'", "UPDATE ops.transfermarkt_state SET paused_until = NULL"):
            x(sql)

    def fetch(self, path, params=()):
        return 200, {}, body(self.answers[urlparse(path).path])

    def http(self, *paths):
        done = subprocess.run([NODE, str(ROOT / "tests" / "read_http.mjs"), DSN, json.dumps([{"path": p} for p in paths])],
                              capture_output=True, text=True, timeout=120)
        self.assertEqual(done.returncode, 0, done.stderr)
        return json.loads(done.stdout.strip().splitlines()[-1])

    def public(self, kind, key):
        return self.x("SELECT api.public_id(%s, %s)", (kind, key)).fetchone()[0]

    def test_59w_to_59af_a_clubs_current_absences(self):
        team, p10, p11 = self.public("team", 1), self.public("player", 10), self.public("player", 11)
        served, = self.http(f"/api/teams/{team}/absences")
        self.assertEqual((served["status"], served["conditional"]), (200, 304))
        self.assertTrue(served["etag"].startswith('W/"profile-v1-'))
        d = self.d
        player10 = {"id": p10, "name": "Kylian Mbappé", "imageUrl": None, "role": None}
        player11 = {"id": p11, "name": "Ousmane Dembélé", "imageUrl": None, "role": None}
        self.assertEqual(served["body"]["data"], {
            "id": team, "asOf": self.read_day,
            # 10, 11, 13 (doubted), the member not linked; 12 left. Read (59ao: his injuries read 45 days ago at most): 10 and 11
            # (11's suspensions are 50 days old, they do not count), not 13 (doubted).
            "squad": {"players": 4, "read": 2},
            "absences": [
                {"player": player11, "kind": "suspension", "label": "Red card suspension", "start": d(-1), "expectedReturn": d(6),
                 "matchesMissed": 1, "matchesRemaining": None, "competition": {"code": "FR1", "id": "l_3FJFUl", "name": "Ligue 1"},
                 "readAt": (self.today - timedelta(days=50)).isoformat()},
                {"player": player10, "kind": "injury", "label": "Knock", "start": d(-2), "expectedReturn": None,
                 "matchesMissed": 0, "matchesRemaining": None, "competition": None, "readAt": self.read_day},
                {"player": player10, "kind": "suspension", "label": "Yellow card suspension", "start": d(-3), "expectedReturn": None,
                 "matchesMissed": 0, "matchesRemaining": 1, "competition": {"code": "CL", "id": None, "name": None}, "readAt": self.read_day},
                {"player": player10, "kind": "injury", "label": "Cruciate ligament tear", "start": d(-30), "expectedReturn": d(30),
                 "matchesMissed": 5, "matchesRemaining": None, "competition": None, "readAt": self.read_day},
            ]})

    def test_59aa_an_open_ended_episode_read_too_long_ago_is_not_shown(self):
        self.x("UPDATE ops.transfermarkt_reads SET read_at = now() - interval '46 days' WHERE provider_key = '342229'")
        served, = self.http(f"/api/teams/{self.public('team', 1)}/absences")
        data = served["body"]["data"]
        self.assertEqual([(a["label"], a["expectedReturn"]) for a in data["absences"] if a["player"]["id"] == self.public("player", 10)],
                         [("Cruciate ligament tear", self.d(30))])
        # 59ao: 11's injuries are still fresh, he alone is read.
        self.assertEqual((data["squad"], data["asOf"]), ({"players": 4, "read": 1}, self.read_day))

    def test_59w_59x_unknown_and_unlinked_teams(self):
        unknown, malformed, bare, param = self.http("/api/teams/t_zzzzz9/absences", "/api/teams/xyz/absences",
                                                    f"/api/teams/{self.public('team', 8)}/absences",
                                                    f"/api/teams/{self.public('team', 1)}/absences?season=2026/2027")
        self.assertEqual((unknown["status"], malformed["status"], param["status"]), (404, 404, 400))
        self.assertEqual((bare["status"], bare["body"]["data"]),
                         (200, {"id": self.public("team", 8), "asOf": None, "squad": {"players": 0, "read": 0}, "absences": []}))

    def test_59aj_59ak_a_national_teams_squad_is_its_page_s_players_and_only_injuries_count(self):
        x = self.x
        x("""INSERT INTO core.teams(id, name, country_code, is_national) VALUES (9, 'France', 'FRA', true), (19, 'Allemagne', NULL, true),
               (18, 'Sans Joueurs', NULL, true) ON CONFLICT DO NOTHING""")
        x("""INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id)
             VALUES ('team', 'pitchapi', 't_fra009', 9), ('team', 'pitchapi', 't_ger019', 19), ('team', 'pitchapi', 't_none18', 18)
             ON CONFLICT DO NOTHING""")
        x("INSERT INTO core.competitions(id, name, kind) VALUES (40, 'Coupe du monde', 'cup'), (41, 'Ligue des nations', 'cup') ON CONFLICT DO NOTHING")
        x("""INSERT INTO core.competition_seasons(id, competition_id, season_id, native_label) VALUES (40, 40, 2026, '2026'), (41, 41, 2026, '2026')
             ON CONFLICT DO NOTHING""")
        # The older tournament (41): 12 played; the last one (40): 10, 11 and 13 (doubted).
        x("""INSERT INTO core.matches(id, competition_season_id, season_id, source, status, home_team_id, away_team_id, kickoff_at, match_date)
             VALUES (700, 41, 2026, 'pitchapi', 'finished', 9, 19, '2026-06-01T19:00:00Z', '2026-06-01'),
                    (701, 40, 2026, 'pitchapi', 'finished', 19, 9, '2026-07-10T19:00:00Z', '2026-07-10')""")
        for match, player in ((700, 12), (701, 10), (701, 11), (701, 13)):
            x("INSERT INTO core.player_match_stats(season_id, match_id, team_id, player_id, minutes_played) VALUES (2026, %s, 9, %s, 90)", (match, player))
        nation, p10 = self.public("team", 9), self.public("player", 10)
        served, empty = self.http(f"/api/teams/{nation}/absences", f"/api/teams/{self.public('team', 18)}/absences")
        self.assertEqual(served["status"], 200)
        d = self.d
        # 10, 11, 13 counted; 10 and 11 read (59ao: their injuries); 11's open-ended ankle is stale (he played since), his suspension and 10's do not
        # count for a national team; 12 (older tournament only) is not in the squad.
        self.assertEqual(served["body"]["data"], {
            "id": nation, "asOf": self.read_day, "squad": {"players": 3, "read": 2},
            "absences": [
                {"player": {"id": p10, "name": "Kylian Mbappé", "imageUrl": None, "role": None}, "kind": "injury", "label": "Knock",
                 "start": d(-2), "expectedReturn": None, "matchesMissed": 0, "matchesRemaining": None, "competition": None,
                 "readAt": self.read_day},
                {"player": {"id": p10, "name": "Kylian Mbappé", "imageUrl": None, "role": None}, "kind": "injury",
                 "label": "Cruciate ligament tear", "start": d(-30), "expectedReturn": d(30), "matchesMissed": 5,
                 "matchesRemaining": None, "competition": None, "readAt": self.read_day},
            ]})
        self.assertEqual((empty["status"], empty["body"]["data"]["squad"], empty["body"]["data"]["absences"]),
                         (200, {"players": 0, "read": 0}, []))
        # The club's answer is unchanged by the nation's rows.
        club, = self.http(f"/api/teams/{self.public('team', 1)}/absences")
        self.assertEqual((club["body"]["data"]["squad"], len(club["body"]["data"]["absences"])), ({"players": 4, "read": 2}, 4))

    def test_59ag_the_players_injuries_list_carries_his_suspensions(self):
        served, doubted = self.http(f"/api/players/{self.public('player', 10)}/injuries", f"/api/players/{self.public('player', 13)}/injuries")
        d = self.d
        self.assertEqual(served["status"], 200)
        self.assertEqual([(i["kind"], i["label"], i["start"]) for i in served["body"]["data"]["injuries"]], [
            ("injury", "Surgery", d(1)), ("injury", "Knock", d(-2)), ("suspension", "Yellow card suspension", d(-3)),
            ("injury", "Calf strain", d(-20)), ("injury", "Cruciate ligament tear", d(-30)), ("suspension", "Red card suspension", d(-60))])
        self.assertEqual(served["body"]["data"]["injuries"][2], {"kind": "suspension", "label": "Yellow card suspension", "start": d(-3),
                                                                 "end": None, "days": None, "matchesMissed": 0, "season": 2026})
        self.assertEqual(doubted["status"], 404)


if __name__ == "__main__":
    unittest.main()
