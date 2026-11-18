"""The Transfermarkt reader (vega/transfermarkt.py), against a fake of its JSON API: reading
the responses, the refusals, the links (snapshot, club votes, squads) and the writes."""
from datetime import date, datetime, timedelta, timezone
import json
import os
from pathlib import Path
import sys
import unittest
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from vega import transfermarkt as tm

try:
    import psycopg
except ImportError:
    psycopg = None

DSN = os.environ.get("VEGA_V2_SOURCES_TEST_DSN")


def body(data):
    return json.dumps({"success": True, "data": data}).encode()


def player(key, name, birth, *, club=None, joined=None, contract=None, value=None, foot="right", height=1.80):
    return {"id": int(key), "name": name, "lifeDates": {"dateOfBirth": birth, "isDateOfBirthUnknown": birth is None},
            "attributes": {"position": {"name": "Centre-Forward"}, "preferredFoot": {"name": foot}, "height": height, "contractUntil": contract},
            "clubAssignments": [{"type": "current", "clubId": club, "start": joined}] if club else [],
            "marketValueDetails": {"current": {"value": value, "currency": "EUR", "determined": "2026-10-01"} if value else None}}


class PureTest(unittest.TestCase):
    def test_a_response_says_what_happened(self):
        self.assertEqual(tm.data_of(200, {}, body([1])), [1])
        with self.assertRaises(tm.Blocked) as waf:
            tm.data_of(200, {"x-amzn-waf-action": "challenge"}, b"")
        self.assertEqual(waf.exception.reason, "WAF_CHALLENGE")
        with self.assertRaises(tm.Blocked) as limited:
            tm.data_of(429, {"Retry-After": "7200"}, b"")
        self.assertEqual((limited.exception.status, limited.exception.retry_after), (429, 7200))
        with self.assertRaises(tm.Missing):
            tm.data_of(404, {}, b"")
        for status, payload, code in ((500, b"", "HTTP_500"), (200, b"<html>", "SCHEMA_CHANGED"), (200, json.dumps({"success": False}).encode(), "SCHEMA_CHANGED")):
            with self.assertRaises(tm.Failed) as failed:
                tm.data_of(status, {}, payload)
            self.assertEqual(failed.exception.code, code)

    def test_records_are_read_field_by_field(self):
        p = tm.parse_player(player("342229", "Kylian Mbappé", "1998-12-20", club=583, joined="2026-07-01T00:00:00", contract="2029-06-30", value=180000000, height=1.78))
        self.assertEqual((p["key"], p["birth_date"], p["height_cm"], p["foot"], p["club"], p["joined_on"], p["contract_until"], p["value"], p["value_on"]),
                         ("342229", date(1998, 12, 20), 178, "right", "583", date(2026, 7, 1), date(2029, 6, 30), 180000000, date(2026, 10, 1)))
        self.assertIsNone(tm.parse_player({"name": "no id"}))
        self.assertIsNone(tm.parse_player(player("1", "Unknown", None, height=3.0))["height_cm"])
        values = tm.parse_values({"history": [
            {"clubId": 583, "marketValue": {"value": 1000000, "determined": "2025-01-01"}},
            {"clubId": 583, "marketValue": {"value": 0, "determined": "2025-06-01"}},  # no valuation
            {"clubId": 418, "marketValue": {"value": 2000000, "determined": "2025-01-01"}},  # the day's last
        ]})
        self.assertEqual(values, [(date(2025, 1, 1), 2000000, "418")])
        with self.assertRaises(tm.Failed):
            tm.parse_values({"history": "nothing"})
        transfers = tm.parse_transfers({"history": {"pending": [], "terminated": [
            {"id": 1, "transferSource": {"clubId": 3524}, "transferDestination": {"clubId": 583}, "typeDetails": {"type": "STANDARD"},
             "details": {"date": "2017-08-31T00:00:00", "fee": {"value": 180000000}, "season": {"display": "17/18"}}},
            {"id": 2, "transferSource": {"clubId": 583}, "transferDestination": {"clubId": 418}, "typeDetails": {"type": "STANDARD"},
             "details": {"date": "2024-07-01", "fee": {"value": 0, "compact": {"content": "free transfer"}}}},
            {"id": 3, "transferSource": {"clubId": 1}, "transferDestination": {"clubId": 2}, "typeDetails": {"type": "ACTIVE_LOAN_TRANSFER"},
             "details": {"date": "2015-01-01", "isPending": True}},
        ]}})
        # A free transfer states a fee of 0, an observed zero; it read None before VI-31, which kept a
        # correction to a free transfer from applying (FAILURE_MODES.md §20, case 20l).
        self.assertEqual([(t["key"], t["kind"], t["fee"], t["from"], t["to"], t["pending"]) for t in transfers],
                         [("1", "transfer", 180000000, "3524", "583", False), ("2", "free", 0, "583", "418", False), ("3", "loan", None, "1", "2", True)])
        self.assertEqual(tm.parse_transfers(None), [])
        injuries = tm.parse_injuries({"injuries": [
            {"seasonId": 2025, "name": "Hamstring injury", "start": "2026-03-01", "end": "2026-03-20", "missedGamesCount": 4},
            {"seasonId": 2024, "name": "Ill", "start": "2025-01-10", "durationDetails": {"days": 6}},
            {"seasonId": 2024, "name": "Fitness", "start": "2024-12-01", "end": "2024-12-03"},
            {"name": "no start"},
        ]})
        self.assertEqual([(i["kind"], i["days"], i["games"], i["season"]) for i in injuries],
                         [("injury", 20, 4, 2025), ("illness", 7, None, 2024), (None, 3, None, 2024)])
        self.assertEqual(tm.parse_squad({"squad": [{"playerId": 2}, {"playerId": "1", "shirtNumber": 10}, {"playerId": None}]}), [("1", 10), ("2", None)])
        # A club record: its squad's value, its top 18's, their average age and their number.
        club = tm.parse_club({"id": 131, "name": "FC Barcelona", "baseDetails": {"countryId": 157}, "squadDetails": {
            "currentMarketValue": {"value": 1300000000, "currency": "EUR"}, "top18PlayersMarketValue": {"value": 1210000000},
            "averageAgeDisplay": "25.4", "squadSize": 27}})
        self.assertEqual((club["key"], club["squad_value"], club["top18_value"], club["average_age"], club["squad_size"]),
                         ("131", 1300000000, 1210000000, 25.4, 27))
        bare = tm.parse_club({"id": 1, "name": "No squad", "squadDetails": {"currentMarketValue": {"value": 0}, "averageAge": 99, "squadSize": True}})
        self.assertEqual((bare["squad_value"], bare["top18_value"], bare["average_age"], bare["squad_size"]), (None, None, None, None))

    def test_a_club_is_linked_by_mutual_majorities(self):
        names = {"583": "Paris Saint-Germain", "1041": "Olympique Lyon", "515": "Without Club", "9": "Paris Saint-Germain B"}
        teams = {1: "Paris Saint-Germain", 2: "Lyon", 3: "Lens", 4: "Lorient"}
        votes = [("583", 1, 5), ("1041", 1, 1), ("1041", 2, 2), ("515", 4, 9), ("9", 3, 4)]
        links, conflicts = tm.pick_clubs(votes, names, teams, {}, {})
        # PSG: 5 of its 6 votes; Lyon: only 2 players; « Without Club » is no club; a reserve side never a first team.
        self.assertEqual(links, {"583": (1, 5)})
        self.assertEqual(conflicts, [("9", 3, "reserve_side")])
        # A club already linked to another team makes a conflict, never a link.
        links, conflicts = tm.pick_clubs([("583", 1, 5)], names, teams, {"583": 4}, {4: "583"})
        self.assertEqual((links, conflicts), ({}, [("583", 1, "already_linked")]))

    def test_a_player_is_linked_by_birth_date_and_name_inside_his_club(self):
        span = ({2026}, date(2026, 8, 20), date(2026, 11, 1))
        ours = [(13, "Achraf Hakimi", "A. Hakimi", date(1998, 11, 4), *span), (16, "Lamine Yamal Nasraoui Ebana", "Lamine Yamal", date(2007, 7, 13), *span),
                (17, "Twin One", None, date(2000, 1, 1), *span), (18, "Twin Two", None, date(2000, 1, 1), *span)]
        theirs = [("340324", "Achraf Hakimi", date(1998, 11, 4), {2026}), ("937958", "Lamine Yamal", date(2007, 7, 13), {2026}),
                  ("1", "Twin Three", date(2000, 1, 1), {2026})]
        self.assertEqual(tm.pick_players(ours, theirs), {"340324": (13, "club_name_birth"), "937958": (16, "club_name_birth")})
        # The same birth date and a shared name token, the only pair of that day.
        self.assertEqual(tm.pick_players([(16, "Lamine Yamal Nasraoui Ebana", None, date(2007, 7, 13), *span)], [("937958", "Lamine Yamal", date(2007, 7, 13), {2026})]),
                         {"937958": (16, "club_birth_name_token")})
        # No name in common: the birth date alone never links.
        self.assertEqual(tm.pick_players([(19, "Vítor Machado Ferreira", None, date(2000, 2, 13), *span)], [("487969", "Vitinha", date(2000, 2, 13), {2026})]), {})
        self.assertEqual(tm.pick_players([(19, "Vítor Machado Ferreira", "Vitinha", date(2000, 2, 13), *span)], [("487969", "Vitinha", date(2000, 2, 13), {2026})]),
                         {"487969": (19, "club_name_birth")})

    def test_without_a_birth_date_the_exact_name_in_a_season_of_his_links(self):
        span = ({2025, 2026}, date(2025, 8, 20), date(2026, 11, 1))
        beraldo = (14, "Lucas Beraldo", "L. Beraldo", None, *span)
        self.assertEqual(tm.pick_players([beraldo], [("999001", "Lucas Beraldo", date(2003, 11, 24), {2026})]), {"999001": (14, "club_season_name")})
        # Listed by the provider in no season he played for us there (nor the year before).
        self.assertEqual(tm.pick_players([beraldo], [("999001", "Lucas Beraldo", date(2003, 11, 24), {2020})]), {})
        # A birth date that makes him 12 at his matches for us is another man.
        self.assertEqual(tm.pick_players([beraldo], [("999001", "Lucas Beraldo", date(2014, 1, 1), {2026})]), {})
        # Two of that name in the club, on either side: nobody.
        self.assertEqual(tm.pick_players([beraldo, (15, "Lucas Beraldo", None, None, *span)], [("999001", "Lucas Beraldo", None, {2026})]), {})
        self.assertEqual(tm.pick_players([beraldo], [("999001", "Lucas Beraldo", None, {2026}), ("999002", "Lucas Beraldo", None, {2026})]), {})

    def test_a_search_is_confirmed_by_the_squad(self):
        ours = {"kylianmbappe", "ousmanedembele", "achrafhakimi", "lucasberaldo", "vitinha", "marquinhos"}
        psg = ("583", {"kylianmbappe", "ousmanedembele", "achrafhakimi", "lucasberaldo", "vitinha", "someoneelse"})
        self.assertEqual(tm.pick_search(ours, [psg, ("9", {"kylianmbappe"})]), ("583", 5))
        self.assertIsNone(tm.pick_search(ours, [("583", {"kylianmbappe", "vitinha"})]))  # too few
        self.assertIsNone(tm.pick_search(ours, [psg, ("9", psg[1])]))  # two candidates as good: nobody


class FakeApi:
    """The provider: players, clubs, histories and squads by key; a status to answer instead."""

    def __init__(self):
        self.calls, self.refuse = [], None
        self.players = {
            "342229": player("342229", "Kylian Mbappé", "1998-12-20", club=583, joined="2026-07-01", contract="2029-06-30", value=180000000),
            "288230": player("288230", "Ousmane Dembélé", "1997-05-15", club=583, value=100000000),
            "487969": player("487969", "Vitinha", "2000-02-13", club=583, value=90000000),
            "580195": player("580195", "Bradley Barcola", "2002-09-03", club=583, value=70000000),  # ours: the 2nd
            "93720": player("93720", "Alexandre Lacazette", "1991-05-28", club=1041, value=5000000),
            "340324": player("340324", "Achraf Hakimi", "1998-11-04", club=583, value=80000000),
            "999001": player("999001", "Lucas Beraldo", "2003-11-24", club=583, value=30000000),
        }
        self.clubs = {"583": "Paris Saint-Germain", "1041": "Olympique Lyon", "3524": "AS Monaco"}
        self.search = {"Paris Saint-Germain": [583, 9], "Lyon": [1041]}

    def __call__(self, path, params=()):
        self.calls.append((path, list(params)))
        if self.refuse:
            return self.refuse
        query = [v for _, v in params]
        if path == "/players":
            return 200, {}, body([self.players[k] for k in query if k in self.players])
        if path == "/quick-search":
            return 200, {}, body({"result": {"clubIds": self.search.get(query[0], [])}, "totalCount": {"clubs": 1}})
        if path == "/clubs":
            return 200, {}, body([{"id": int(k), "name": self.clubs[k], "baseDetails": {"countryId": 50},
                                   "squadDetails": {"currentMarketValue": {"value": 900000000 + int(k)}, "averageAge": 25.1, "squadSize": 26}}
                                  for k in query if k in self.clubs])
        parts = urlparse(path).path.strip("/").split("/")
        if parts[0] == "player" and parts[2] == "market-value-history":
            club = self.players[parts[1]]["clubAssignments"][0]["clubId"] if self.players[parts[1]]["clubAssignments"] else None
            return 200, {}, body({"history": [{"clubId": club, "marketValue": {"value": 1000000, "determined": "2026-09-15"}},
                                              {"clubId": 3524, "marketValue": {"value": 500000, "determined": "2019-01-01"}}]})
        if parts[0] == "transfer":
            if parts[3] != "342229":
                return 404, {}, b""
            return 200, {}, body({"history": {"pending": [], "terminated": [
                {"id": 7, "transferSource": {"clubId": 3524}, "transferDestination": {"clubId": 583}, "typeDetails": {"type": "STANDARD"},
                 "details": {"date": "2018-07-01", "fee": {"value": 180000000}}}]}})
        if parts[0] == "player" and parts[2] == "injury":
            injuries = [{"seasonId": 2025, "name": "Hamstring injury", "start": "2026-03-01", "end": "2026-03-20", "missedGamesCount": 4}] if parts[1] == "342229" else []
            return 200, {}, body({"injuries": injuries})
        if parts[0] == "club" and parts[2] == "squad":
            members = ["342229", "288230", "340324", "999001"] if parts[1] == "583" and query == ["2026"] else []
            return 200, {}, body({"squad": [{"playerId": int(k), "shirtNumber": 7} for k in members]})
        return 404, {}, b""


@unittest.skipUnless(DSN and psycopg, "requires disposable local sources DB and psycopg")
class ReaderTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from vega.store import connect_local, migrate

        target = urlparse(DSN)
        if target.hostname not in ("localhost", "127.0.0.1", "::1") or target.path != "/vega_v2_sources_test":
            raise RuntimeError("dedicated local sources DB required")
        cls.db = connect_local(DSN)
        cls.db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        migrate(cls.db)
        x = cls.db.execute
        x("INSERT INTO core.countries(code) VALUES ('FRA')")
        x("INSERT INTO core.seasons(id, label) VALUES (2026, '2026/2027') ON CONFLICT DO NOTHING")
        x("INSERT INTO core.competitions(id, name, country_code, kind) VALUES (30, 'Ligue 1', 'FRA', 'league')")
        x("INSERT INTO core.competition_seasons(id, competition_id, season_id, native_label) VALUES (30, 30, 2026, '2026/2027')")
        x("INSERT INTO core.teams(id, name, country_code) VALUES (1, 'Paris Saint-Germain', 'FRA'), (2, 'Lyon', 'FRA')")
        x("""INSERT INTO core.players(id, name, short_name, birth_date) VALUES (10, 'Kylian Mbappé', 'K. Mbappé', '1998-12-20'),
               (11, 'Ousmane Dembélé', 'O. Dembélé', '1997-05-15'), (12, 'Vítor Machado Ferreira', 'Vitinha', '2000-02-13'),
               (13, 'Achraf Hakimi', 'A. Hakimi', '1998-11-04'), (14, 'Lucas Beraldo', 'L. Beraldo', NULL),
               (15, 'Bradley Barcola', 'B. Barcola', '2002-09-02'), (20, 'Alexandre Lacazette', 'A. Lacazette', '1991-05-28')""")
        x("SELECT core.ensure_season_partitions(2026)")
        x("""INSERT INTO core.matches(id, competition_season_id, season_id, source, status, home_team_id, away_team_id, kickoff_at, match_date)
             VALUES (500, 30, 2026, 'pitchapi', 'finished', 1, 2, '2026-09-01T19:00:00Z', '2026-09-01'),
                    (501, 30, 2026, 'pitchapi', 'finished', 2, 1, '2026-10-01T19:00:00Z', '2026-10-01')""")
        for match in (500, 501):
            for p in (10, 11, 12, 13, 14, 15):
                x("INSERT INTO core.player_match_stats(season_id, match_id, team_id, player_id, minutes_played) VALUES (2026, %s, 1, %s, 90)", (match, p))
            x("INSERT INTO core.player_match_stats(season_id, match_id, team_id, player_id, minutes_played) VALUES (2026, %s, 2, 20, 90)", (match,))
        for key, p in (("342229", 10), ("288230", 11), ("487969", 12), ("580195", 15), ("93720", 20)):
            x("""INSERT INTO core.player_fact_observations(source, source_player_id, player_id, source_url, observed_on)
                 VALUES ('transfermarkt_snapshot', %s, %s, %s, '2026-07-06')""", (key, p, f"https://www.transfermarkt.com/-/profil/spieler/{key}"))

    @classmethod
    def tearDownClass(cls):
        cls.db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        cls.db.close()

    def drain(self, reader, limit=200):
        outcomes = []
        for _ in range(limit):
            outcome = reader.step()
            outcomes.append(outcome)
            if outcome in ("idle", "paused", "gave_up"):
                return outcomes
        self.fail("the queue never emptied")

    def test_a_profiles_current_club_votes_like_a_valuation(self):
        # Three linked players whose profiles name club 244 while they play for our team 7: linked
        # before any value history is read.
        reader = tm.Reader(self.db, FakeApi(), interval=0, jitter=0, sleep=lambda s: None, log=lambda *a, **k: None)
        x = self.db.execute
        try:
            x("INSERT INTO core.teams(id, name, country_code) VALUES (7, 'Marseille', 'FRA')")
            x("""INSERT INTO core.matches(id, competition_season_id, season_id, source, status, home_team_id, away_team_id, kickoff_at, match_date)
                 VALUES (700, 30, 2026, 'pitchapi', 'finished', 7, 2, now() - interval '3 days', current_date - 3)""")
            x("INSERT INTO core.provider_clubs(provider, provider_key, name, read_on) VALUES ('transfermarkt', '244', 'Olympique Marseille', current_date)")
            for p in (70, 71, 72):
                x("INSERT INTO core.players(id, name) VALUES (%s, %s)", (p, f"Joueur {p}"))
                x("INSERT INTO core.player_match_stats(season_id, match_id, team_id, player_id, minutes_played) VALUES (2026, 700, 7, %s, 90)", (p,))
                x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('player', 'transfermarkt', %s, %s)", (f"700{p}", p))
                x("""INSERT INTO core.provider_players(provider, provider_key, name, provider_club, read_on)
                     VALUES ('transfermarkt', %s, %s, '244', current_date)""", (f"700{p}", f"Joueur {p}"))
            self.assertEqual(reader.link_clubs(), 1)
            self.assertEqual(x("SELECT entity_id, provider_key FROM core.provider_ids WHERE entity_type = 'team'").fetchall(), [(7, "244")])
            self.assertEqual(x("SELECT evidence FROM ops.provider_links WHERE entity_type = 'team'").fetchall(), [(3,)])
        finally:
            x("DELETE FROM ops.provider_links WHERE provider_key IN ('244', '70070', '70071', '70072')")
            x("DELETE FROM core.provider_ids WHERE provider = 'transfermarkt' AND provider_key IN ('244', '70070', '70071', '70072')")
            x("DELETE FROM core.provider_players WHERE provider_key IN ('70070', '70071', '70072')")
            x("DELETE FROM core.provider_clubs WHERE provider_key = '244'")
            x("DELETE FROM core.player_match_stats WHERE season_id = 2026 AND match_id = 700")
            x("DELETE FROM core.matches WHERE id = 700")
            x("DELETE FROM core.players WHERE id IN (70, 71, 72)")
            x("DELETE FROM core.teams WHERE id = 7")

    def test_injuries_come_first_after_profiles_and_clubs(self):
        # Every player page shows them: within a priority they come before searches, values,
        # squads and transfers; a better priority still comes first.
        reader = tm.Reader(self.db, FakeApi(), interval=0, jitter=0, sleep=lambda s: None, log=lambda *a, **k: None)
        rows = [("search", "77001:2026", 1), ("values", "77002", 1), ("transfers", "77003", 1), ("squad", "77004:2026", 1),
                ("injuries", "77005", 1), ("injuries", "77006", 2)]
        try:
            for kind, key, priority in rows:
                self.db.execute("""INSERT INTO ops.transfermarkt_reads(kind, provider_key, priority, next_due_at)
                                   VALUES (%s, %s, %s, now() - interval '1 hour')""", (kind, key, priority))
            self.assertEqual(reader.next_units(), ("injuries", [("77005", 1)]))
            self.db.execute("UPDATE ops.transfermarkt_reads SET priority = 3 WHERE provider_key = '77005'")
            self.assertEqual(reader.next_units(), ("search", [("77001:2026", 1)]))
        finally:
            self.db.execute("DELETE FROM ops.transfermarkt_reads WHERE provider_key LIKE '7700%'")

    def test_due_squad_profiles_gain_priority_without_resetting_the_queue(self):
        x = self.db.execute
        with self.db.transaction(force_rollback=True):
            now = x("SELECT now()").fetchone()[0]
            due, later = now - timedelta(hours=1), now + timedelta(hours=6)
            calls = []

            def fetch(path, params):
                keys = [value for name, value in params if name == "ids[]"]
                calls.append((path, keys))
                return 200, {}, body([player(key, f"Profile {key}", None) for key in keys])

            reader = tm.Reader(self.db, fetch, interval=0, jitter=0, clock=lambda: now, log=lambda *a, **k: None)
            reader.plan()
            x("UPDATE ops.transfermarkt_reads SET next_due_at=%s", (later,))
            x("""INSERT INTO core.provider_clubs(provider,provider_key,name,read_on)
                 VALUES ('transfermarkt','35123','Squad contrôle',current_date)""")
            for key, years in {
                "35101": (2026, 2025), "35102": (2026,), "35103": (2025,), "35104": (2026,),
                "35105": (2026,), "35106": (2026,), "35107": (2026,), "35108": (2024,),
            }.items():
                for year in years:
                    x("""INSERT INTO core.provider_squads(provider,club_key,season_year,player_key,read_on)
                         VALUES ('transfermarkt','35123',%s,%s,current_date)""", (year, key))
            x("""INSERT INTO core.provider_players(provider,provider_key,name,read_on)
                 VALUES ('transfermarkt','35107','Fiche existante',current_date)""")
            for row in (
                ("profile", "35101", 3, due, None, 0, None, None, 0),
                ("profile", "35103", 1, due, None, 0, None, None, 0),
                ("profile", "35104", 6, later, None, 3, 500, "HTTP_500", 0),
                ("profile", "35105", 9, later, due, 0, 200, None, 1),
                ("profile", "35106", 9, later, due, 1, 404, "NOT_FOUND", 0),
                ("profile", "35107", 9, later, None, 0, None, None, 0),
                ("profile", "35108", 9, later, None, 0, None, None, 0),
                ("transfers", "35101", 1, due, None, 0, None, None, 0),
                ("values", "35101", 4, later, None, 1, 503, "HTTP_503", 0),
                ("injuries", "35101", 8, later, None, 0, None, None, 0),
            ):
                x("INSERT INTO ops.transfermarkt_reads VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)", row)

            def rows():
                return {(kind, key): (data, version) for kind, key, data, version in x(
                    "SELECT kind,provider_key,to_jsonb(r),xmin::text FROM ops.transfermarkt_reads r"
                    " WHERE provider_key LIKE '3510%' ORDER BY kind,provider_key")}

            def links():
                return x("SELECT to_jsonb(i) FROM core.provider_ids i ORDER BY entity_type,provider,provider_key").fetchall()

            before = rows()
            identities = links()
            x("SET LOCAL ROLE vega_collect")
            self.assertEqual(reader.plan(), 4)
            after = rows()
            expected = {("profile", "35101"): 1, ("profile", "35104"): 1, ("profile", "35108"): 3}
            for unit, (data, version) in before.items():
                if unit in expected:
                    self.assertEqual(after[unit][0], dict(data, priority=expected[unit]))
                else:
                    self.assertEqual(after[unit], (data, version))
            new = after[("profile", "35102")][0]
            self.assertEqual(new["priority"], 1)
            self.assertEqual(datetime.fromisoformat(new["next_due_at"]), now)
            self.assertEqual(reader.plan(), 0)
            self.assertEqual(rows(), after)
            self.assertEqual(reader.step(), "ok")
            self.assertEqual(calls[0][0], "/players")
            self.assertEqual(set(calls[0][1]), {"35101", "35102", "35103"})
            self.assertEqual(rows()[("profile", "35104")], after[("profile", "35104")])
            self.assertEqual(rows()[("transfers", "35101")], after[("transfers", "35101")])
            self.assertEqual(links(), identities)

    def test_the_reader_links_reads_and_pauses(self):
        api = FakeApi()
        now = datetime.now(timezone.utc)
        reader = tm.Reader(self.db, api, interval=0, jitter=0, sleep=lambda s: None, clock=lambda: now, log=lambda *a, **k: None)
        q = lambda sql, *a: self.db.execute(sql, a or None).fetchall()
        # The first step plans: the snapshot's five links, each with its four units.
        self.assertEqual(reader.step(), "planned")
        self.assertEqual(q("SELECT count(*) FROM core.provider_ids WHERE provider = 'transfermarkt' AND entity_type = 'player'"), [(5,)])
        self.assertEqual(q("SELECT kind, count(*) FROM ops.transfermarkt_reads GROUP BY 1 ORDER BY 1"),
                         [("injuries", 5), ("profile", 5), ("search", 2), ("transfers", 5), ("values", 5)])
        self.drain(reader)
        # The five profiles in one request, both clubs searched (PSG's squad has 4 of our names,
        # 5 are needed: not linked so), then each player's three histories.
        paths = [c[0] for c in api.calls]
        self.assertEqual((paths.count("/players"), paths.count("/quick-search"), len(paths) - paths.count("/players") - paths.count("/quick-search")), (2, 2, 20))
        self.assertEqual(q("SELECT count(*) FROM core.provider_ids WHERE entity_type = 'team'"), [(0,)])
        # Barcola's birth date differs from ours: quarantined, his values shown nowhere.
        reader.plan(link=True)
        self.assertEqual(q("SELECT provider_key, quarantine_reason FROM ops.provider_links WHERE quarantined_at IS NOT NULL"), [("580195", "birth_date_differs")])
        self.assertEqual(q("SELECT count(*) FROM api.player_market_values WHERE player_id = 15"), [(0,)])
        self.drain(reader)  # the clubs' names
        self.assertEqual(q("SELECT provider_key, name FROM core.provider_clubs ORDER BY 1"), [("1041", "Olympique Lyon"), ("3524", "AS Monaco"), ("583", "Paris Saint-Germain")])
        self.assertEqual(q("SELECT squad_value_eur, average_age::float8, squad_size FROM core.provider_clubs WHERE provider_key = '583'"), [(900000583, 25.1, 26)])
        # PSG: four of our players valued at club 583 while they played for us; Lyon one only.
        reader.plan(link=True)
        self.assertEqual(q("SELECT entity_id, provider_key FROM core.provider_ids WHERE entity_type = 'team'"), [(1, "583")])
        # Barcola is doubted: his valuations do not vote.
        self.assertEqual(q("SELECT rule, evidence FROM ops.provider_links WHERE entity_type = 'team'"), [("club_votes", 3)])
        # The values and the transfer read before the club was linked now name our team.
        self.assertEqual(q("SELECT count(*) FROM core.player_market_values WHERE provider_club = '583' AND team_id IS DISTINCT FROM 1"), [(0,)])
        self.assertEqual(q("SELECT to_team_id FROM core.player_transfers WHERE player_id = 10"), [(1,)])
        # Its squads (this season and the one before), then the profiles of the members never read.
        self.drain(reader)
        self.assertEqual(q("SELECT season_year, count(*) FROM core.provider_squads GROUP BY 1"), [(2026, 4)])
        reader.plan(link=True)
        self.drain(reader)
        reader.plan(link=True)
        # Hakimi: the same birth date and name in the club; Beraldo, no birth date of ours: his exact name in a season he played for us.
        self.assertEqual(q("SELECT entity_id, provider_key FROM core.provider_ids WHERE provider_key IN ('340324', '999001') ORDER BY 1"), [(13, "340324"), (14, "999001")])
        self.assertEqual(q("SELECT provider_key, rule FROM ops.provider_links WHERE provider_key IN ('340324', '999001') ORDER BY 1"),
                         [("340324", "club_name_birth"), ("999001", "club_season_name")])
        # The writes of a linked player: values with their club, his transfer, his injury.
        self.assertEqual(q("SELECT valued_at, value_eur, provider_club FROM core.player_market_values WHERE player_id = 10 ORDER BY 1"),
                         [(date(2019, 1, 1), 500000, "3524"), (date(2026, 9, 15), 1000000, "583")])
        self.assertEqual(q("SELECT kind::text, fee_eur, from_provider_club, to_provider_club FROM core.player_transfers WHERE player_id = 10"),
                         [("transfer", 180000000, "3524", "583")])
        self.assertEqual(q("SELECT kind::text, days, matches_missed FROM core.player_injuries WHERE player_id = 10"), [("injury", 20, 4)])
        # Once PSG is linked, his next profile read gives his contract with it.
        self.db.execute("UPDATE ops.transfermarkt_reads SET next_due_at = now() - interval '1 minute' WHERE kind = 'profile' AND provider_key = '342229'")
        self.drain(reader)
        self.assertEqual(q("SELECT team_id, start_date, end_date FROM core.player_contracts WHERE player_id = 10"), [(1, date(2026, 7, 1), date(2029, 6, 30))])
        self.assertEqual(q("SELECT contract_until, observed_contract_until, observed_contract_team FROM api.player_profiles WHERE player_id = 10"),
                         [("2029-06-30", "2029-06-30", "Paris Saint-Germain")])
        # A refusal: no write, a pause of two hours (as asked), kept in the base.
        api.refuse = (429, {"Retry-After": "7200"}, b"")
        self.db.execute("UPDATE ops.transfermarkt_reads SET next_due_at = now() - interval '1 minute' WHERE kind = 'injuries' AND provider_key = '342229'")
        self.assertEqual(reader.step(), "blocked")
        paused_until, blocks = q("SELECT paused_until, blocks_in_row FROM ops.transfermarkt_state")[0]
        self.assertEqual((round((paused_until - now).total_seconds() / 3600), blocks), (2, 1))
        self.assertEqual(reader.step(), "paused")
        self.assertEqual(q("SELECT count(*) FROM core.player_injuries WHERE player_id = 10"), [(1,)])
        # Refused again and again: the reader gives up until a person clears it.
        self.db.execute(f"UPDATE ops.transfermarkt_state SET paused_until = NULL, blocks_in_row = {tm.GIVE_UP_BLOCKS - 1}")
        self.assertEqual(reader.step(), "blocked")
        self.assertEqual(reader.step(), "gave_up")
        self.assertEqual(q("SELECT kind, never_read FROM api.provider_reader_progress WHERE kind = 'squad'"), [("squad", 0)])


if __name__ == "__main__":
    unittest.main()
