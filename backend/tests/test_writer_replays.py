"""The writers still active, replayed end to end: repetition, partial answers, authority (FAILURE_MODES.md §40,
written before these tests; audit E02c, E02d, E03h). The rules of the corrections and their further cases are §44
(44a–44t), written before the cases added here.

Each replay calls the real writer through its real entry point on a disposable local PostgreSQL
(VEGA_V2_WRITER_REPLAYS_TEST_DSN, database vega_v2_writer_replays_test), on a connection under the collection role
(vega_collect): the Transfermarkt reader by `Reader.read` (fetch, data_of, write_*, queue row), the other sources by
`sources.run_due` (run, record_run). Only the provider is replaced, by synthetic answers; nothing is downloaded. The
state is compared by a fingerprint of the rows the writer writes (as JSON, sorted, without `updated_at`).

A replay that fails on the code it runs on is a defect of that writer: it is kept, marked by `defect(...)` (an
`unittest.expectedFailure` that names the defect and its owner), so that the suite stays green and the defect visible.
WRITER_REPLAY_STRICT=1 runs them as ordinary tests, to see each failure for its reason. WRITER_REPLAY_EVIDENCE=<dir>
writes each replay's observed states there as JSON.
"""

from datetime import date, datetime, timedelta, timezone
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import unittest
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))

from vega import sources, transfermarkt as tm  # noqa: E402
from vega.sources import SourceError, fifa, honours, uefa, wikidata  # noqa: E402
from prerequisites import required  # noqa: E402

try:
    import psycopg
except ImportError:
    psycopg = None

DSN = os.environ.get("VEGA_V2_WRITER_REPLAYS_TEST_DSN")
STRICT = os.environ.get("WRITER_REPLAY_STRICT", "").strip().lower() in ("1", "true")
EVIDENCE = os.environ.get("WRITER_REPLAY_EVIDENCE")
NODE = shutil.which("node")
HTTP_READY = bool(NODE) and (ROOT / "api" / "node_modules" / "pg").is_dir()
NOW = datetime(2026, 11, 19, 8, tzinfo=timezone.utc)


def defect(description):
    """A replay that fails on this code: the defect it shows, kept visible without turning the suite red."""
    def decorate(test):
        test.defect = description
        return test if STRICT else unittest.expectedFailure(test)
    return decorate


def body(data):
    return json.dumps({"success": True, "data": data}).encode()


def value(day, amount, club=583):
    return {"clubId": club, "marketValue": {"value": amount, "currency": "EUR", "determined": day}}


def injury(start, end, label="Hamstring injury", games=3):
    return {"seasonId": 2025, "name": label, "start": start, "end": end, "missedGamesCount": games}


def member(key, shirt):
    return {"playerId": int(key), "shirtNumber": shirt}


VALUES = {"history": [value("2025-06-01", 150000000), value("2026-09-15", 180000000)]}
INJURIES = {"injuries": [injury("2025-03-01", "2025-03-20"), injury("2026-02-01", "2026-02-10", "Knee injury", 2)]}
SQUAD = {"squad": [member("342229", 7), member("288230", 10)]}
CLUBS = [{"id": 583, "name": "Paris Saint-Germain", "baseDetails": {"countryId": 50},
          "squadDetails": {"currentMarketValue": {"value": 900000000}, "averageAge": 25.1, "squadSize": 26}}]


@required(DSN and psycopg, "requires a disposable local writer replays DB (VEGA_V2_WRITER_REPLAYS_TEST_DSN) and psycopg")
class WriterReplay(unittest.TestCase):
    """The base every replay starts from: one league edition in progress, two clubs, four players who played it."""

    @classmethod
    def setUpClass(cls):
        from vega.store import connect_local, migrate

        target = urlparse(DSN)
        if target.hostname not in ("localhost", "127.0.0.1", "::1") or target.path != "/vega_v2_writer_replays_test":
            raise RuntimeError("dedicated local writer replays DB required")
        cls.db = connect_local(DSN)
        cls.db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        migrate(cls.db)
        x = cls.db.execute
        x("INSERT INTO core.countries(code) VALUES ('FRA'), ('ESP') ON CONFLICT DO NOTHING")
        x("INSERT INTO core.seasons(id, label) VALUES (2025, '2025/2026'), (2026, '2026/2027') ON CONFLICT DO NOTHING")
        x("SELECT core.ensure_season_partitions(2025)")
        x("SELECT core.ensure_season_partitions(2026)")
        x("INSERT INTO core.competitions(id, name, country_code, kind) VALUES (30, 'Ligue 1', 'FRA', 'league')")
        x("INSERT INTO core.competition_seasons(id, competition_id, season_id, native_label, is_current) VALUES (30, 30, 2026, '2026/2027', true)")
        x("INSERT INTO core.teams(id, name, country_code) VALUES (1, 'Paris Saint-Germain', 'FRA'), (2, 'Olympique Lyonnais', 'FRA')")
        x("""INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id)
             VALUES ('team', 'pitchapi', 't_psg001', 1), ('team', 'pitchapi', 't_ol0002', 2)""")
        x("INSERT INTO core.team_seasons(team_id, competition_season_id) VALUES (1, 30), (2, 30)")
        x("""INSERT INTO core.players(id, name, short_name, birth_date) VALUES (10, 'Kylian Mbappé', 'K. Mbappé', NULL),
               (11, 'Ousmane Dembélé', 'O. Dembélé', NULL), (12, 'Achraf Hakimi', 'A. Hakimi', NULL), (13, 'Vitinha Ferreira', 'Vitinha', NULL)""")
        x("""INSERT INTO core.matches(id, competition_season_id, season_id, source, status, home_team_id, away_team_id, kickoff_at, match_date)
             VALUES (500, 30, 2026, 'pitchapi', 'finished', 1, 2, '2026-09-01T19:00:00Z', '2026-09-01'),
                    (501, 30, 2026, 'pitchapi', 'finished', 2, 1, '2026-10-01T19:00:00Z', '2026-10-01')""")
        for match in (500, 501):
            for p in (10, 11, 12, 13):
                x("INSERT INTO core.player_match_stats(season_id, match_id, team_id, player_id, minutes_played) VALUES (2026, %s, 1, %s, 90)", (match, p))
                x("INSERT INTO core.lineup_players(season_id, match_id, team_id, player_id, is_starter) VALUES (2026, %s, 1, %s, true)", (match, p))
        # The ids above are given: the writers' own rows take theirs after them.
        for table in ("teams", "players", "matches", "competitions", "competition_seasons"):
            x(f"SELECT setval(pg_get_serial_sequence('core.{table}', 'id'), 1000)")

    @classmethod
    def tearDownClass(cls):
        cls.db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        cls.db.close()

    def setUp(self):
        # Each replay in one transaction rolled back at its end; the writer's own transactions are savepoints in it.
        transaction = self.db.transaction(force_rollback=True)
        transaction.__enter__()
        self.addCleanup(transaction.__exit__, None, None, None)
        self.x = self.db.execute
        self.observed = {}

    def tearDown(self):
        if EVIDENCE:
            Path(EVIDENCE).mkdir(parents=True, exist_ok=True)
            name = self.id().rsplit(".", 1)[-1]
            Path(EVIDENCE, name + ".json").write_text(json.dumps(self.observed, indent=1, default=str, ensure_ascii=False) + "\n")

    def as_collector(self):
        self.x("SET LOCAL ROLE vega_collect")
        self.assertEqual(self.x("SELECT current_user").fetchone(), ("vega_collect",))

    def rows(self, table, where="true", params=None, drop=("updated_at",)):
        """The rows of `table` as sorted JSON texts, without the columns `drop` names."""
        return sorted(r[0] for r in self.x(f"SELECT (to_jsonb(t) - %s::text[])::text FROM {table} t WHERE {where}",
                                            (list(drop), *(params or ()))).fetchall())

    def note(self, step, **state):
        plain = lambda v: {":".join(map(str, k)) if isinstance(k, tuple) else str(k): plain(x) for k, x in v.items()} if isinstance(v, dict) else v
        self.observed[step] = plain(state)


class TransfermarktReplayTest(WriterReplay):
    """40a–40l: the Transfermarkt reader's values, injuries, squads and clubs, by Reader.read under vega_collect."""

    def setUp(self):
        super().setUp()
        x = self.x
        x("""INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id)
             VALUES ('player', 'transfermarkt', '342229', 10), ('player', 'transfermarkt', '288230', 11), ('team', 'transfermarkt', '583', 1)""")
        for kind, key in (("values", "342229"), ("injuries", "342229"), ("squad", "583:2026"), ("club", "583")):
            x("INSERT INTO ops.transfermarkt_reads(kind, provider_key, priority, next_due_at) VALUES (%s, %s, 1, now() - interval '1 minute')", (kind, key))
        self.answers = {}
        self.as_collector()
        self.reader = tm.Reader(self.db, self.fetch, interval=0, jitter=0, sleep=lambda s: None, log=lambda *a, **k: None)

    def fetch(self, path, params=()):
        answer = self.answers[urlparse(path).path]
        return answer if isinstance(answer, tuple) else (200, {}, body(answer))

    def read(self, kind, key, path, answer):
        self.answers[path] = answer
        return self.reader.read(kind, [(key, 1)])

    def unit(self, kind, key):
        row = self.x("""SELECT error_code, last_http_status, next_due_at - now() <= interval '1 day', rows_written
                        FROM ops.transfermarkt_reads WHERE kind = %s AND provider_key = %s""", (kind, key)).fetchone()
        return {"error_code": row[0], "status": row[1], "due_within_a_day": row[2], "rows_written": row[3]}

    # Values ---------------------------------------------------------------------------------------------------------

    VALUES_PATH = "/player/342229/market-value-history"

    def values(self):
        return self.rows("core.player_market_values", "player_id = 10")

    def accepted_values(self):
        self.assertEqual(self.read("values", "342229", self.VALUES_PATH, VALUES), "ok")
        accepted = self.values()
        self.assertEqual(len(accepted), 2)
        return accepted

    def test_40a_the_same_value_history_twice_changes_nothing(self):
        accepted = self.accepted_values()
        self.assertEqual(self.read("values", "342229", self.VALUES_PATH, VALUES), "ok")
        self.note("40a", first=accepted, second=self.values(), unit=self.unit("values", "342229"))
        self.assertEqual(self.values(), accepted)

    def test_40b_an_empty_value_history_keeps_the_points(self):
        accepted = self.accepted_values()
        outcome = self.read("values", "342229", self.VALUES_PATH, {"history": []})
        unit = self.unit("values", "342229")
        self.note("40b", outcome=outcome, before=accepted, after=self.values(), unit=unit)
        self.assertEqual(self.values(), accepted)
        # 44a: refused and traced, due again within a day; the last accepted read's count kept.
        self.assertEqual((outcome, unit), ("failed", {"error_code": "HISTORY_EMPTY", "status": 200, "due_within_a_day": True, "rows_written": 2}))

    def test_40c_a_truncated_value_history_keeps_the_omitted_point(self):
        self.accepted_values()
        outcome = self.read("values", "342229", self.VALUES_PATH, {"history": VALUES["history"][1:]})
        unit = self.unit("values", "342229")
        marks = self.marks("core.player_market_values", "valued_at")
        self.note("40c", outcome=outcome, after=self.values(), unit=unit, marks=marks)
        # 44b: both points kept, the omitted one marked from the day of the read; the read acquitted.
        today = self.x("SELECT current_date").fetchone()[0]
        self.assertEqual((outcome, unit["error_code"]), ("ok", None))
        self.assertEqual(marks, {date(2025, 6, 1): today, date(2026, 9, 15): None})
        # 44c: listed again, the mark goes; the same history once more writes no row.
        self.assertEqual(self.read("values", "342229", self.VALUES_PATH, VALUES), "ok")
        self.assertEqual(self.marks("core.player_market_values", "valued_at"), {date(2025, 6, 1): None, date(2026, 9, 15): None})
        again = self.values()
        self.assertEqual(self.read("values", "342229", self.VALUES_PATH, VALUES), "ok")
        self.assertEqual((self.values(), self.unit("values", "342229")["rows_written"]), (again, 0))
        # 44d: a value corrected at the source replaces the stored one.
        corrected = {"history": [value("2025-06-01", 150000000), value("2026-09-15", 175000000)]}
        self.assertEqual(self.read("values", "342229", self.VALUES_PATH, corrected), "ok")
        self.assertEqual(self.x("SELECT value_eur FROM core.player_market_values WHERE player_id = 10 AND valued_at = '2026-09-15'").fetchone(), (175000000,))

    def marks(self, table, key, where="player_id = 10"):
        return dict(self.x(f"SELECT {key}, absent_since FROM {table} WHERE {where}").fetchall())

    def test_40d_a_malformed_value_history_keeps_the_points_and_is_traced(self):
        accepted = self.accepted_values()
        outcome = self.read("values", "342229", self.VALUES_PATH, {"history": "x"})
        unit = self.unit("values", "342229")
        self.note("40d", outcome=outcome, before=accepted, after=self.values(), unit=unit)
        self.assertEqual((outcome, self.values()), ("schema", accepted))
        self.assertEqual((unit["error_code"], unit["due_within_a_day"]), ("SCHEMA_CHANGED", True))

    # Injuries -------------------------------------------------------------------------------------------------------

    INJURIES_PATH = "/player/342229/injury"

    def injuries(self):
        return self.rows("core.player_injuries", "player_id = 10", drop=("updated_at", "id"))

    def accepted_injuries(self):
        self.assertEqual(self.read("injuries", "342229", self.INJURIES_PATH, INJURIES), "ok")
        accepted = self.injuries()
        self.assertEqual(len(accepted), 2)
        return accepted

    def ids(self):
        return [i for (i,) in self.x("SELECT id FROM core.player_injuries WHERE player_id = 10 ORDER BY start_date").fetchall()]

    def test_40e_the_same_injuries_twice_change_nothing(self):
        accepted, first = self.accepted_injuries(), self.ids()
        self.assertEqual(self.read("injuries", "342229", self.INJURIES_PATH, INJURIES), "ok")
        # The ids are recorded, not asserted: no table references core.player_injuries.id.
        self.note("40e", first=accepted, second=self.injuries(), ids_first=first, ids_second=self.ids())
        self.assertEqual(self.injuries(), accepted)
        self.assertEqual(self.ids(), first)  # 44g: an episode keeps its id
        self.assertEqual(self.unit("injuries", "342229")["rows_written"], 0)

    def test_40f_an_empty_injury_list_keeps_the_episodes(self):
        accepted = self.accepted_injuries()
        outcome = self.read("injuries", "342229", self.INJURIES_PATH, {"injuries": []})
        unit = self.unit("injuries", "342229")
        self.note("40f", outcome=outcome, before=accepted, after=self.injuries(), unit=unit)
        refused = outcome != "ok" and unit["error_code"] is not None
        self.assertTrue(refused or self.injuries() == accepted, "the episodes were erased and the read accepted")
        # 44f: kept, refused and traced.
        self.assertEqual((self.injuries(), outcome, unit["error_code"], unit["due_within_a_day"]), (accepted, "failed", "HISTORY_EMPTY", True))

    def test_40g_a_truncated_injury_list_keeps_the_omitted_episode(self):
        accepted = self.accepted_injuries()
        outcome = self.read("injuries", "342229", self.INJURIES_PATH, {"injuries": INJURIES["injuries"][:1]})
        unit = self.unit("injuries", "342229")
        self.note("40g", outcome=outcome, before=accepted, after=self.injuries(), unit=unit)
        marks = self.marks("core.player_injuries", "start_date")
        self.note("40g_marks", marks=marks)
        # 44g: both kept, the omitted one marked; the read acquitted; listed again, the mark goes and the ids stay.
        today = self.x("SELECT current_date").fetchone()[0]
        self.assertEqual((outcome, unit["error_code"]), ("ok", None))
        self.assertEqual(marks, {date(2025, 3, 1): None, date(2026, 2, 1): today})
        ids = self.ids()
        self.assertEqual(self.read("injuries", "342229", self.INJURIES_PATH, INJURIES), "ok")
        self.assertEqual((self.injuries(), self.ids()), (accepted, ids))

    def test_44h_an_episode_completed_or_relabelled_is_updated_in_place(self):
        ongoing = {"injuries": [injury("2025-03-01", "2025-03-20"), injury("2026-02-01", None, "Knee injury", 0)]}
        self.assertEqual(self.read("injuries", "342229", self.INJURIES_PATH, ongoing), "ok")
        ids = self.ids()
        corrected = {"injuries": [injury("2025-03-01", "2025-03-20", "Hamstring strain"), injury("2026-02-01", "2026-02-10", "Knee injury", 2)]}
        self.assertEqual(self.read("injuries", "342229", self.INJURIES_PATH, corrected), "ok")
        rows = self.x("""SELECT id, label, end_date, matches_missed, absent_since FROM core.player_injuries
                         WHERE player_id = 10 ORDER BY start_date""").fetchall()
        self.note("44h", ids=ids, rows=rows)
        self.assertEqual(rows, [(ids[0], "Hamstring strain", date(2025, 3, 20), 3, None), (ids[1], "Knee injury", date(2026, 2, 10), 2, None)])

    def test_40h_a_malformed_injury_answer_keeps_the_history_readable(self):
        accepted = self.accepted_injuries()
        outcome = self.read("injuries", "342229", self.INJURIES_PATH, {"injuries": "x"})
        unit = self.unit("injuries", "342229")
        self.assertEqual((outcome, self.injuries(), unit["error_code"], unit["due_within_a_day"]), ("schema", accepted, "SCHEMA_CHANGED", True))
        self.x("SET LOCAL ROLE vega_read")
        readable = self.x("SELECT count(*) FROM api.player_injury_reads WHERE player_key = 10").fetchone()[0]
        served = self.x("SELECT count(*) FROM api.player_injuries WHERE player_key = 10").fetchone()[0]
        self.note("40h", outcome=outcome, unit=unit, injury_reads_rows=readable, injuries_rows=served)
        self.assertEqual((readable, served), (1, 2))

    # Squads ---------------------------------------------------------------------------------------------------------

    SQUAD_PATH = "/club/583/squad"

    def squad(self):
        return self.rows("core.provider_squads", "club_key = '583'")

    def accepted_squad(self):
        self.assertEqual(self.read("squad", "583:2026", self.SQUAD_PATH, SQUAD), "ok")
        accepted = self.squad()
        self.assertEqual(len(accepted), 2)
        return accepted

    def test_40i_the_same_squad_twice_changes_nothing(self):
        accepted = self.accepted_squad()
        self.assertEqual(self.read("squad", "583:2026", self.SQUAD_PATH, SQUAD), "ok")
        self.note("40i", first=accepted, second=self.squad())
        self.assertEqual(self.squad(), accepted)

    def test_40j_an_empty_squad_keeps_the_members(self):
        accepted = self.accepted_squad()
        outcome = self.read("squad", "583:2026", self.SQUAD_PATH, {"squad": []})
        unit = self.unit("squad", "583:2026")
        self.note("40j", outcome=outcome, before=accepted, after=self.squad(), unit=unit)
        refused = outcome != "ok" and unit["error_code"] is not None
        self.assertTrue(refused or self.squad() == accepted, "the members were erased and the read accepted")
        # 44j: kept, refused and traced.
        self.assertEqual((self.squad(), outcome, unit["error_code"], unit["due_within_a_day"]), (accepted, "failed", "SQUAD_EMPTY", True))

    def test_40k_a_truncated_squad_keeps_the_omitted_member(self):
        # A third member, Achraf Hakimi (player 12, no birth date, no link): the linker would pair him by his name.
        self.x("INSERT INTO core.provider_players(provider, provider_key, name, read_on) VALUES ('transfermarkt', '340324', 'Achraf Hakimi', current_date)")
        full = {"squad": SQUAD["squad"] + [member("340324", 2)]}
        self.assertEqual(self.read("squad", "583:2026", self.SQUAD_PATH, full), "ok")
        outcome = self.read("squad", "583:2026", self.SQUAD_PATH, {"squad": SQUAD["squad"][:1]})
        unit = self.unit("squad", "583:2026")
        marks = self.marks("core.provider_squads", "player_key", "club_key = '583'")
        self.note("40k", outcome=outcome, after=self.squad(), unit=unit, marks=marks)
        # 44k: every member kept, the omitted ones marked; the read acquitted.
        today = self.x("SELECT current_date").fetchone()[0]
        self.assertEqual((outcome, unit["error_code"]), ("ok", None))
        self.assertEqual(marks, {"342229": None, "288230": today, "340324": today})
        # An absent member is no link candidate (as when the row was deleted).
        self.assertEqual(self.reader.link_players(), 0)
        self.assertIsNone(self.x("SELECT entity_id FROM core.provider_ids WHERE provider = 'transfermarkt' AND provider_key = '340324'").fetchone())
        # Listed again: the marks go; the same squad once more writes nothing.
        self.assertEqual(self.read("squad", "583:2026", self.SQUAD_PATH, full), "ok")
        self.assertEqual(set(self.marks("core.provider_squads", "player_key", "club_key = '583'").values()), {None})
        again = self.squad()
        self.assertEqual(self.read("squad", "583:2026", self.SQUAD_PATH, full), "ok")
        self.assertEqual(self.squad(), again)
        self.assertEqual(self.reader.link_players(), 1)  # present again: the linker pairs him

    def test_44l_a_club_search_keeps_a_member_its_squad_omits(self):
        self.x("INSERT INTO ops.transfermarkt_reads(kind, provider_key, priority, next_due_at) VALUES ('search', '2', 1, now() - interval '1 minute')")
        record = lambda key, name: {"id": int(key), "name": name}
        self.answers.update({"/quick-search": {"result": {"clubIds": ["1041"]}},
                             "/players": [record("500001", "Corentin Tolisso"), record("500002", "Alexandre Lacazette")]})
        both = {"squad": [member("500001", 8), member("500002", 10)]}
        self.assertEqual(self.read("search", "2", "/club/1041/squad", both), "ok")
        self.assertEqual(self.read("search", "2", "/club/1041/squad", {"squad": both["squad"][:1]}), "ok")
        marks = self.marks("core.provider_squads", "player_key", "club_key = '1041'")
        self.note("44l", marks=marks)
        today = self.x("SELECT current_date").fetchone()[0]
        self.assertEqual(marks, {"500001": None, "500002": today})

    # Clubs ----------------------------------------------------------------------------------------------------------

    def test_40l_the_same_club_record_twice_changes_nothing(self):
        self.assertEqual(self.read("club", "583", "/clubs", CLUBS), "ok")
        first = self.rows("core.provider_clubs", "provider_key = '583'")
        self.assertEqual(len(first), 1)
        self.assertEqual(self.read("club", "583", "/clubs", CLUBS), "ok")
        self.note("40l", first=first, second=self.rows("core.provider_clubs", "provider_key = '583'"))
        self.assertEqual(self.rows("core.provider_clubs", "provider_key = '583'"), first)


def uefa_club(ident, name, position, points):
    return {"member": {"id": ident, "displayName": name, "countryCode": "FRA", "logoUrl": f"https://img.uefa.com/imgml/TP/teams/logos/70x70/{ident}.png"},
            "overallRanking": {"position": position, "totalValue": points, "totalPoints": points - 1, "numberOfTeamsStillInPlaying": 1},
            "seasonRankings": [{"seasonYear": 2027, "totalPoints": 9.5, "nationalAssociationPoints": 2.0, "numberOfTeamsStillInPlaying": 1}]}


@required(HTTP_READY, "requires node and backend/api/node_modules (npm ci --prefix backend/api)")
class ServedTransfermarktTest(TransfermarktReplayTest):
    """44e, 44i: the real routes under vega_read (tests/read_http.mjs) after the reader's writes. The reader's writes are
    committed here (the route reads on its own connection); tearDown removes them."""

    def setUp(self):
        # No enclosing rolled-back transaction: the reader's own transactions commit, the route reads them.
        self.x, self.observed = self.db.execute, {}
        self.addCleanup(self.clean)
        self.clean()
        self.prepare()

    def prepare(self):
        x = self.x
        x("""INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id)
             VALUES ('player', 'transfermarkt', '342229', 10), ('player', 'transfermarkt', '288230', 11), ('team', 'transfermarkt', '583', 1)""")
        for kind, key in (("values", "342229"), ("injuries", "342229")):
            x("INSERT INTO ops.transfermarkt_reads(kind, provider_key, priority, next_due_at) VALUES (%s, %s, 1, now() - interval '1 minute')", (kind, key))
        self.answers = {}
        x("SET ROLE vega_collect")
        self.reader = tm.Reader(self.db, self.fetch, interval=0, jitter=0, sleep=lambda s: None, log=lambda *a, **k: None)

    def clean(self):
        x = self.x
        x("RESET ROLE")
        for sql in ("DELETE FROM core.player_market_values", "DELETE FROM core.player_injuries", "DELETE FROM core.provider_players",
                    "DELETE FROM ops.transfermarkt_reads", "DELETE FROM core.provider_ids WHERE provider = 'transfermarkt'"):
            x(sql)

    def http(self, path):
        done = subprocess.run([NODE, str(ROOT / "tests" / "read_http.mjs"), DSN, json.dumps([{"path": path}])],
                              capture_output=True, text=True, timeout=120)
        self.assertEqual(done.returncode, 0, done.stderr)
        return json.loads(done.stdout.strip().splitlines()[-1])[0]

    def public(self):
        self.x("RESET ROLE")
        try:
            return self.x("SELECT api.public_id('player', 10)").fetchone()[0]
        finally:
            self.x("SET ROLE vega_collect")

    def test_44e_an_absent_value_point_is_served_with_its_mark(self):
        self.accepted_values()
        self.assertEqual(self.read("values", "342229", self.VALUES_PATH, {"history": VALUES["history"][1:]}), "ok")
        served = self.http(f"/api/player-market-values?id={self.public()}")
        self.note("44e", served=served)
        today = self.x("SELECT current_date::text").fetchone()[0]
        self.assertEqual(served["status"], 200)
        self.assertEqual([(p["date"], p.get("absentSince")) for p in served["body"]["data"]["history"]],
                         [("2025-06-01", today), ("2026-09-15", None)])

    def test_44i_a_refused_injury_read_keeps_the_list_served(self):
        self.accepted_injuries()
        route = f"/api/players/{self.public()}/injuries"
        first = self.http(route)
        self.assertEqual(self.read("injuries", "342229", self.INJURIES_PATH, {"injuries": "x"}), "schema")
        after = self.http(route)
        self.note("44i", first=first, after=after)
        self.assertEqual((first["status"], len(first["body"]["data"]["injuries"])), (200, 2))
        self.assertEqual((after["status"], after["body"]), (200, first["body"]))



# The inherited replays run in TransfermarktReplayTest only.
for _name in [n for n in dir(TransfermarktReplayTest) if n.startswith("test_")]:
    setattr(ServedTransfermarktTest, _name, None)


class RankingReplayTest(WriterReplay):
    """40m–40o: the UEFA coefficients and the FIFA ranking, by sources.run_due under vega_collect."""

    def uefa_get(self, members, total):
        def get(url):
            query = parse_qs(urlparse(url).query)
            if (query["coefficientType"][0], query["seasonYear"][0], query["page"][0]) != ("MEN_CLUB", "2027", "1"):
                raise SourceError("HTTP_404")
            return {"data": {"members": members, "lastUpdateDate": "2026-11-18T22:00:00Z"}, "meta": {"collection": {"totalElements": total}}}
        return get

    def edition(self):
        where = "edition_id IN (SELECT id FROM core.ranking_editions WHERE kind = 'uefa_clubs' AND label = '2026/2027')"
        return {"rows": self.rows("core.ranking_rows", where), "seasons": self.rows("core.ranking_season_points", where),
                "edition": self.rows("core.ranking_editions", "kind = 'uefa_clubs'"), "teams": self.rows("core.teams")}

    def scope_run(self, source, scope):
        return self.x("SELECT status, error_code, rows_written FROM ops.source_runs WHERE source = %s AND scope = %s", (source, scope)).fetchone()

    def accepted_uefa(self):
        self.as_collector()
        complete = [uefa_club(52747, "Paris Saint-Germain", 1, 120.0), uefa_club(52748, "Olympique Lyonnais", 2, 80.0)]
        results = sources.run_due(self.db, self.uefa_get(complete, 2), NOW, names={"uefa"})
        self.assertEqual(results[("uefa", "uefa_clubs:2027")], "ok")
        accepted = self.edition()
        self.assertEqual(len(accepted["rows"]), 2)
        return complete, accepted

    def test_40m_the_same_uefa_pages_twice_change_nothing(self):
        complete, accepted = self.accepted_uefa()
        version = self.x("SELECT version FROM ops.resource_versions WHERE resource_kind = 'ranking'").fetchall()
        results = sources.run_due(self.db, self.uefa_get(complete, 2), NOW + timedelta(days=2), names={"uefa"})
        self.assertEqual(results[("uefa", "uefa_clubs:2027")], "ok")
        self.note("40m", first=accepted, second=self.edition(), ranking_versions_before=version,
                  ranking_versions_after=self.x("SELECT version FROM ops.resource_versions WHERE resource_kind = 'ranking'").fetchall())
        self.assertEqual(self.edition(), accepted)

    def test_40x_the_same_uefa_pages_twice_publish_no_new_version(self):
        complete, _ = self.accepted_uefa()
        versions = lambda: self.x("SELECT resource_id, version FROM ops.resource_versions WHERE resource_kind = 'ranking' ORDER BY 1").fetchall()
        before = versions()
        sources.run_due(self.db, self.uefa_get(complete, 2), NOW + timedelta(days=2), names={"uefa"})
        self.note("40x", before=before, after=versions())
        self.assertEqual(versions(), before)

    def test_40n_an_empty_uefa_edition_keeps_the_stored_rows(self):
        _, accepted = self.accepted_uefa()
        results = sources.run_due(self.db, self.uefa_get([], 0), NOW + timedelta(days=2), names={"uefa"})
        self.note("40n", outcome=results[("uefa", "uefa_clubs:2027")], before=accepted["rows"], after=self.edition()["rows"],
                  run=self.scope_run("uefa", "uefa_clubs:2027"))
        self.assertEqual(self.edition()["rows"], accepted["rows"])
        self.assertNotEqual(results[("uefa", "uefa_clubs:2027")], "ok")
        self.assertEqual((results[("uefa", "uefa_clubs:2027")], self.scope_run("uefa", "uefa_clubs:2027")[:2]), ("EMPTY_EDITION", ("error", "EMPTY_EDITION")))

    def test_44o_a_changed_uefa_edition_is_replaced_once(self):
        complete, accepted = self.accepted_uefa()
        versions = lambda: dict(self.x("SELECT resource_id, version FROM ops.resource_versions WHERE resource_kind = 'ranking'").fetchall())
        before = versions()
        changed = [complete[0], uefa_club(52748, "Olympique Lyonnais", 2, 81.5)]
        sources.run_due(self.db, self.uefa_get(changed, 2), NOW + timedelta(days=2), names={"uefa"})
        points = self.x("""SELECT r.points FROM core.ranking_rows r JOIN core.ranking_editions e ON e.id = r.edition_id
                           WHERE e.kind = 'uefa_clubs' AND r.provider_key = '52748'""").fetchall()
        after = versions()
        self.note("44o", before=before, after=after, points=points)
        self.assertEqual(points, [(81.5,)])
        self.assertEqual({k: after[k] - before.get(k, 0) for k in after}, {k: 1 for k in after})

    def test_40o_a_short_fifa_edition_is_completed_or_refused(self):
        self.as_collector()
        page = '<html><script id="__NEXT_DATA__" type="application/json">' + json.dumps(
            {"props": {"pageProps": {"pageData": {"ranking": {"allAvailableDates": [{"id": "id15000", "date": "2026-10-23"}]}}}}}) + "</script></html>"
        full = [{"rankingItem": {"idTeam": str(43900 + i), "name": name, "countryCode": code, "rank": i, "previousRank": i, "totalPoints": 1900.0 - i}}
                for i, (name, code) in enumerate((("Spain", "ESP"), ("France", "FRA"), ("Argentina", "ARG")), 1)]
        listed = {"rankings": full[:1]}

        def get(url, as_text=False):
            if url == fifa.PAGE:
                return page
            if url.startswith(fifa.OVERVIEW):
                return listed
            raise SourceError("HTTP_404")

        self.x("INSERT INTO core.countries(code) VALUES ('ARG') ON CONFLICT DO NOTHING")
        where = "edition_id IN (SELECT id FROM core.ranking_editions WHERE kind = 'fifa_men')"
        version = lambda: self.x("""SELECT v.version FROM ops.resource_versions v JOIN core.ranking_editions e ON e.id = v.resource_id
                                    WHERE v.resource_kind = 'ranking' AND e.kind = 'fifa_men'""").fetchall()
        self.assertEqual(sources.run_due(self.db, get, NOW, names={"fifa"}), {("fifa", "fifa_men:editions"): "ok"})
        short, first_version = self.rows("core.ranking_rows", where), version()
        listed = {"rankings": full}  # the source now lists the whole edition
        # 44p: within a week the latest edition is not read again; after a week it is, and the whole edition replaces it.
        self.assertEqual(sources.run_due(self.db, get, NOW + timedelta(days=2), names={"fifa"}), {("fifa", "fifa_men:editions"): "ok"})
        self.assertEqual(self.rows("core.ranking_rows", where), short)
        second = sources.run_due(self.db, get, NOW + timedelta(days=8), names={"fifa"})
        after, second_version = self.rows("core.ranking_rows", where), version()
        self.note("40o", first=short, second_outcome=second, after=after, versions=(first_version, second_version))
        self.assertEqual(len(short), 1)
        self.assertEqual(len(after), 3)
        self.assertEqual([v - 1 for (v,) in second_version], [v for (v,) in first_version])
        # An identical re-read a week later writes no row and raises no version.
        sources.run_due(self.db, get, NOW + timedelta(days=16), names={"fifa"})
        self.assertEqual((self.rows("core.ranking_rows", where), version()), (after, second_version))
        # 44q: a re-read shorter than stored is refused once, the stored rows kept.
        listed = {"rankings": full[:2]}
        for week in (24, 32):
            self.assertEqual(sources.run_due(self.db, get, NOW + timedelta(days=week), names={"fifa"}), {("fifa", "fifa_men:editions"): "ok"})
        failures = self.x("SELECT error_code FROM ops.parse_failures WHERE error_code = 'EDITION_SHORTER'").fetchall()
        self.assertEqual((self.rows("core.ranking_rows", where), version(), failures), (after, second_version, [("EDITION_SHORTER",)]))


class HonoursReplayTest(WriterReplay):
    """40p–40q: Wikipedia honours (the « wikimedia » adapter), by sources.run_due under vega_collect."""

    BODY = {"available": True, "source": "Wikipédia", "identitySourceUrl": "https://www.wikidata.org/wiki/Q21621995",
            "sourceUrl": "https://en.wikipedia.org/w/index.php?title=Kylian_Mbapp%C3%A9&oldid=1#Honours", "revision": 1,
            "fetchedAt": "2026-11-19T08:00:00+00:00",
            "honours": [{"name": "FIFA World Cup", "team": "France", "category": "team", "seasons": ["2018"]},
                        {"name": "Golden Boot", "team": None, "category": "individual", "seasons": ["2022"]}]}

    def titles(self):
        return {"titles": self.rows("core.player_honour_titles", "player_id = 10"),
                "links": self.rows("core.provider_ids", "entity_type = 'player' AND provider = 'wikidata'")}

    def run_with(self, answer, at):
        original, honours.collect = honours.collect, lambda name, observations: answer if name == "Kylian Mbappé" else None
        try:
            return sources.run_due(self.db, None, at, names={"wikimedia"})
        finally:
            honours.collect = original

    def accepted(self):
        self.as_collector()
        self.assertEqual(self.run_with(self.BODY, NOW), {("wikimedia", "players"): "ok"})
        accepted = self.titles()
        self.assertEqual(len(accepted["titles"]), 2)
        return accepted

    def test_40p_the_same_honours_twice_change_nothing(self):
        accepted = self.accepted()
        self.assertEqual(self.run_with(self.BODY, NOW + honours.PERIOD + timedelta(hours=2)), {("wikimedia", "players"): "ok"})
        self.note("40p", first=accepted, second=self.titles())
        self.assertEqual(self.titles(), accepted)

    def test_40q_no_answer_from_the_collector_keeps_the_titles(self):
        accepted = self.accepted()
        later = NOW + honours.PERIOD + timedelta(hours=2)
        self.assertEqual(self.run_with(None, later), {("wikimedia", "players"): "ok"})
        checked = self.x("SELECT honours_checked_at FROM core.players WHERE id = 10").fetchone()[0]
        self.note("40q", before=accepted, after=self.titles(), checked_at=checked)
        self.assertEqual((self.titles(), checked), (accepted, later))


def person(qid, names, birth, height=None):
    row = {"p": {"value": "http://www.wikidata.org/entity/" + qid}, "names": {"value": "|".join(names)},
           "birth": {"value": birth + "T00:00:00Z"}, "prec": {"value": "11"}}
    if height is not None:
        row["height"], row["unit"] = {"value": str(height)}, {"value": "http://www.wikidata.org/entity/Q11573"}
    return row


class WikidataReplayTest(WriterReplay):
    """40r–40w: Wikidata clubs, stadiums and player facts, by sources.run_due under vega_collect."""

    CLUB = {"sourceUrl": "https://www.wikidata.org/entity/Q483020", "fetchedAt": "2026-11-19T08:00:00.000Z", "stadium": "Parc des Princes",
            "stadiumId": "Q172287", "stadiumAlias": "Parc", "coach": {"name": "Luis Enrique", "photo": None}, "founded": "1970"}
    STADIUM = {"id": "Q172287", "sourceUrl": "https://www.wikidata.org/wiki/Q172287", "fetchedAt": "2026-11-19T08:00:00.000Z",
               "capacity": 47929, "capacityAsOf": "2019", "opened": "1897-07-18", "created": None, "coordinates": {"lat": 48.84, "lon": 2.25}}

    def run_with(self, answers, at, players=None):
        def bridge(command, *args):
            return answers.get((command, *args))

        def get(url, headers=None):
            return {"results": {"bindings": players or []}}

        original, wikidata.bridge = wikidata.bridge, bridge
        try:
            return sources.run_due(self.db, get, at, names={"wikidata"})
        finally:
            wikidata.bridge = original

    def club_state(self):
        return {"team": self.rows("core.teams", "id = 1", drop=("updated_at", "wikidata_fetched_at", "wikidata_players_at")),
                "venues": self.rows("core.venues", drop=("updated_at", "wikidata_fetched_at")),
                "tenures": self.rows("core.team_coach_tenures"), "coaches": self.rows("core.coaches"),
                "venue_names": self.rows("core.entity_names", "entity_type = 'venue'")}

    def answers(self, club=None, stadium=None):
        return {("identity", "Paris Saint-Germain", "FRA"): "Q483020", ("club", "Q483020"): club or self.CLUB,
                ("stadium", "Q172287"): stadium or self.STADIUM}

    def accepted_club(self):
        self.x("UPDATE core.teams SET wikidata_fetched_at = %s WHERE id = 2", (NOW,))  # only PSG is due
        self.as_collector()
        results = self.run_with(self.answers(), NOW)
        self.assertEqual((results[("wikidata", "clubs")], results[("wikidata", "stadiums")]), ("ok", "ok"))
        accepted = self.club_state()
        self.assertEqual(self.x("SELECT founded_year FROM core.teams WHERE id = 1").fetchone(), (1970,))
        self.assertEqual(self.x("SELECT capacity FROM core.venues").fetchall(), [(47929,)])
        return accepted

    def test_40r_the_same_club_and_stadium_twice_change_nothing(self):
        accepted = self.accepted_club()
        results = self.run_with(self.answers(), NOW + wikidata.STADIUM_PERIOD + timedelta(days=1))
        self.note("40r", outcome=results, first=accepted, second=self.club_state())
        self.assertEqual(self.club_state(), accepted)

    def test_40s_a_club_answer_without_founded_or_coach_keeps_them(self):
        self.accepted_club()
        partial = dict(self.CLUB, founded=None, coach=None)
        later = NOW + wikidata.CLUB_PERIOD + timedelta(days=1)
        self.run_with(self.answers(club=partial), later)
        founded = self.x("SELECT founded_year FROM core.teams WHERE id = 1").fetchone()[0]
        open_tenures = self.x("SELECT count(*) FROM core.team_coach_tenures WHERE team_id = 1 AND end_date IS NULL").fetchone()[0]
        self.note("40s", founded_year=founded, open_tenures=open_tenures, tenures=self.rows("core.team_coach_tenures"))
        self.assertEqual((founded, open_tenures), (1970, 1))
        # 44s: a later answer naming another coach closes the open tenure that day and opens his.
        succeeded = later + wikidata.CLUB_PERIOD + timedelta(days=1)
        self.run_with(self.answers(club=dict(self.CLUB, founded="1970", coach={"name": "Arne Slot", "photo": None})), succeeded)
        tenures = self.x("""SELECT c.name, t.start_date, t.end_date FROM core.team_coach_tenures t JOIN core.coaches c ON c.id = t.coach_id
                            WHERE t.team_id = 1 ORDER BY t.start_date, c.name""").fetchall()
        self.assertEqual(tenures, [("Luis Enrique", NOW.date(), succeeded.date()), ("Arne Slot", succeeded.date(), None)])

    def test_40t_a_stadium_answer_without_capacity_keeps_it(self):
        self.accepted_club()
        partial = dict(self.STADIUM, capacity=None, capacityAsOf=None, coordinates=None)
        self.run_with(self.answers(stadium=partial), NOW + wikidata.STADIUM_PERIOD + timedelta(days=1))
        venue = self.x("SELECT capacity, latitude IS NOT NULL, longitude IS NOT NULL FROM core.venues").fetchone()
        self.note("40t", venue=venue)
        self.assertEqual(venue, (47929, True, True))
        # 44r: a correction applies, the coordinates kept when the answer omits them again.
        self.run_with(self.answers(stadium=dict(self.STADIUM, capacity=48583, capacityAsOf="2024", coordinates=None)),
                      NOW + 2 * wikidata.STADIUM_PERIOD + timedelta(days=2))
        self.assertEqual(self.x("SELECT capacity, capacity_observed, latitude IS NOT NULL FROM core.venues").fetchone(), (48583, "2024", True))

    # Player facts ---------------------------------------------------------------------------------------------------

    PEOPLE = [person("Q21621995", ["Kylian Mbappé"], "1998-12-20", 1.78), person("Q5794", ["Ousmane Dembélé"], "1997-05-15", 1.78),
              person("Q1500000", ["Achraf Hakimi"], "1998-11-04", 1.81)]

    def facts(self):
        return self.rows("core.players", "id IN (10, 11, 12, 13)", drop=("updated_at", "honours_checked_at"))

    def accepted_facts(self):
        self.x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('team', 'wikidata', 'Q483020', 1)")
        self.x("UPDATE core.teams SET wikidata_fetched_at = %s", (NOW,))  # the clubs scope is not due: player facts only
        self.as_collector()
        results = self.run_with({}, NOW, players=self.PEOPLE)
        self.assertEqual(results[("wikidata", "players")], "ok")
        self.assertEqual(self.x("SELECT id, birth_date, height_cm FROM core.players WHERE id IN (10, 11, 12) ORDER BY id").fetchall(),
                         [(10, date(1998, 12, 20), 178), (11, date(1997, 5, 15), 178), (12, date(1998, 11, 4), 181)])
        return self.facts()

    def test_40u_the_same_player_facts_twice_change_nothing(self):
        accepted = self.accepted_facts()
        results = self.run_with({}, NOW + timedelta(days=31), players=self.PEOPLE)
        run = self.x("SELECT status, rows_written FROM ops.source_runs WHERE source = 'wikidata' AND scope = 'players'").fetchone()
        self.note("40u", outcome=results[("wikidata", "players")], run=run, first=accepted, second=self.facts())
        self.assertEqual((self.facts(), run), (accepted, ("ok", 0)))

    def test_40v_an_empty_wikidata_answer_keeps_the_player_facts(self):
        accepted = self.accepted_facts()
        results = self.run_with({}, NOW + timedelta(days=31), players=[])
        self.note("40v", outcome=results[("wikidata", "players")], before=accepted, after=self.facts())
        self.assertEqual(self.facts(), accepted)

    def test_40w_a_snapshot_attested_birth_date_keeps_its_provenance(self):
        url = "https://www.transfermarkt.com/-/profil/spieler/340324"
        self.x("UPDATE core.players SET birth_date = '1998-11-04', birth_date_source_url = %s WHERE id = 12", (url,))
        self.x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('team', 'wikidata', 'Q483020', 1)")
        self.x("UPDATE core.teams SET wikidata_fetched_at = %s", (NOW,))
        self.as_collector()
        other = [person("Q1500000", ["Achraf Hakimi"], "1998-11-05", 1.81)]
        self.assertEqual(self.run_with({}, NOW, players=other)[("wikidata", "players")], "ok")
        birth, source = self.x("SELECT birth_date, birth_date_source_url FROM core.players WHERE id = 12").fetchone()
        self.note("40w", birth_date=birth, birth_date_source_url=source)
        self.assertFalse(birth == date(1998, 11, 5) and source == url, "Wikidata's date is served under the snapshot's URL")
        # 44t: the attested date and its URL kept, the height written, the conflict traced once over two reads; a date
        # without provenance is still corrected.
        self.x("RESET ROLE")
        self.x("UPDATE core.players SET birth_date = '1997-05-14' WHERE id = 11")
        self.as_collector()
        self.run_with({}, NOW + timedelta(days=31), players=other + [person("Q5794", ["Ousmane Dembélé"], "1997-05-15")])
        conflicts = self.x("SELECT error_code, message FROM ops.parse_failures WHERE error_code = 'BIRTH_DATE_CONFLICT'").fetchall()
        facts = self.x("SELECT id, birth_date, birth_date_source_url, height_cm FROM core.players WHERE id IN (11, 12) ORDER BY id").fetchall()
        self.note("44t", conflicts=conflicts, facts=facts)
        self.assertEqual(facts, [(11, date(1997, 5, 15), None, None), (12, date(1998, 11, 4), url, 181)])
        self.assertEqual([c for c, _ in conflicts], ["BIRTH_DATE_CONFLICT"])


class NativeReplayTest(WriterReplay):
    """40y–40z: the native PitchAPI writer (Store) under vega_collect: repetition and explicit correction."""

    def setUp(self):
        super().setUp()
        from vega.normalize import normalize_family
        from vega.store import Store

        self.normalize = normalize_family
        self.as_collector()
        self.store = Store(self.db)
        self.store.save_references(normalize_family("league", {"id": "l_rpl001", "name": "Replay League", "country_code": "FRA", "season": "2026/2027"}))
        self.edition = self.x("""SELECT cs.id FROM core.competition_seasons cs JOIN core.provider_ids p ON p.entity_type = 'competition'
                                 AND p.entity_id = cs.competition_id AND p.provider_key = 'l_rpl001'""").fetchone()[0]

    def summary(self, home_goals):
        return self.normalize("summary", {"id": "m_rpl001", "home_team": {"id": "t_rpl001", "name": "Replay Home"},
                                          "away_team": {"id": "t_rpl002", "name": "Replay Away"}, "status": "finished",
                                          "date": "2026-11-01", "score_home": home_goals, "score_away": 0}, match_id="m_rpl001")

    def stats(self, goals):
        return self.normalize("players", [{"player": {"id": "p_rpl001", "name": "Replay Scorer"}, "team_id": "t_rpl001",
                                           "stats": [{"stats": {"Goals": {"key": "goals", "stat": {"type": "integer", "value": goals}}}}]}],
                              match_id="m_rpl001")

    def state(self, mid):
        return {"match": self.rows("core.matches", "id = %s", (mid,)), "stats": self.rows("core.player_match_stats", "match_id = %s", (mid,)),
                "teams": self.rows("core.teams", "name LIKE 'Replay %%'"), "players": self.rows("core.players", "name LIKE 'Replay %%'"),
                "ids": self.rows("core.provider_ids", "provider_key LIKE '%%_rpl%%'")}

    def revision(self, mid):
        return self.x("SELECT revision FROM core.matches WHERE id = %s", (mid,)).fetchone()[0]

    def test_40y_the_same_native_match_and_statistics_twice_change_nothing(self):
        mid = self.store.save_matches(self.summary(1), self.edition)[0]
        self.assertTrue(self.store.save_family(mid, "player_stats", self.stats(1)))
        first, revision = self.state(mid), self.revision(mid)
        self.assertEqual(self.store.save_matches(self.summary(1), self.edition), [mid])
        self.assertFalse(self.store.save_family(mid, "player_stats", self.stats(1)))
        self.note("40y", first=first, second=self.state(mid), revision=(revision, self.revision(mid)))
        self.assertEqual((self.state(mid), self.revision(mid)), (first, revision))

    def test_40z_a_native_correction_is_written_once(self):
        mid = self.store.save_matches(self.summary(1), self.edition)[0]
        self.assertTrue(self.store.save_family(mid, "player_stats", self.stats(1)))
        revisions = [self.revision(mid)]
        self.store.save_matches(self.summary(2), self.edition)
        revisions.append(self.revision(mid))
        self.store.save_matches(self.summary(2), self.edition)
        revisions.append(self.revision(mid))
        self.assertTrue(self.store.save_family(mid, "player_stats", self.stats(2)))
        self.assertFalse(self.store.save_family(mid, "player_stats", self.stats(2)))
        revisions.append(self.revision(mid))
        score = self.x("SELECT home_score, away_score FROM core.matches WHERE id = %s", (mid,)).fetchone()
        goals = self.x("SELECT goals FROM core.player_match_stats WHERE match_id = %s", (mid,)).fetchall()
        self.note("40z", revisions=revisions, score=score, goals=goals)
        self.assertEqual((score, goals), ((2, 0), [(2,)]))
        self.assertEqual([b - a for a, b in zip(revisions, revisions[1:])], [1, 0, 1])


if __name__ == "__main__":
    unittest.main()
