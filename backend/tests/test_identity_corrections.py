"""FC Barcelona's sides, administrative results and ranking spellings (FAILURE_MODES.md §39), end to end on a
disposable PostgreSQL, through the real writers and under the real roles.

The fixture reproduces the two clubs named « Barcelona » of production (707, Barcelona SC, Ecuador, t_2fucJi; 740,
FC Barcelona, Spain, t_32jSEF), their opponents, the fifteen matches of FC Barcelona stored on 707 (docs/audits/
2026-11-17/controles/verification-integree/barcelone-15.csv) and Ecuadorian matches of 707 that must stay its own.
"""

import csv
from datetime import datetime, timezone
import os
from pathlib import Path
import sys
import unittest
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from prerequisites import required  # noqa: E402
from vega import power  # noqa: E402
from vega.sources import cups, curated, identity  # noqa: E402

try:
    import psycopg
except ImportError:
    psycopg = None
DSN = os.environ.get("VEGA_V2_IDENTITY_TEST_DSN")
NOW = datetime(2026, 11, 19, 12, tzinfo=timezone.utc)
REGISTER = ROOT.parent / "docs/audits/2026-11-17/controles/verification-integree/identites-838-registre.csv"
FIFTEEN = ROOT.parent / "docs/audits/2026-11-17/controles/verification-integree/barcelone-15.csv"

# PitchAPI teams of the fixture: id -> (name, country, PitchAPI key or None).
TEAMS = {
    707: ("Barcelona", "ECU", "t_2fucJi"), 740: ("Barcelona", "ESP", "t_32jSEF"),
    854: ("Brøndby IF", "DEN", "t_4Mrl3A"), 4554: ("Ferencvárosi TC", "HUN", None), 875: ("Juventus", "ITA", "t_4ZwKDn"),
    4546: ("Dinamo Kiev", "UKR", None), 4691: ("Paris Saint-Germain", "FRA", "t_41iFW3"), 1759: ("UD Barbastro", None, None),
    475: ("Real Betis", "ESP", "t_0HSzvM"), 4706: ("Valencia", "ESP", "t_3TftmE"), 774: ("Atlético Madrid", "ESP", "t_3NIiXl"),
    4710: ("Real Madrid", "ESP", "t_4NZcri"),
    # Barcelona SC's Ecuadorian opponents.
    800: ("Emelec", "ECU", "t_emelec"), 801: ("LDU Quito", "ECU", "t_ldu000"),
}
COPA = "open-cups:copa-del-rey-archive:2024/2025"


def fifteen():
    with FIFTEEN.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def schema(db):
    from vega.store import Store, migrate

    db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
    migrate(db)
    with db.transaction():
        for label in ("1998/1999", "2020/2021", "2024/2025", "2025/2026", "2026/2027"):
            Store(db).season(label)
    x = db.execute
    x("INSERT INTO core.countries(code) VALUES ('ECU'), ('ESP'), ('DEN'), ('HUN'), ('ITA'), ('UKR'), ('FRA'), ('BEL') ON CONFLICT DO NOTHING")
    for team, (name, country, key) in TEAMS.items():
        x("INSERT INTO core.teams(id, name, country_code, is_national) VALUES (%s, %s, %s, false)", (team, name, country))
        if key:
            x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('team', 'pitchapi', %s, %s)", (key, team))
    # FC Barcelona's UEFA spelling, as uefa.link_team writes it (normalize(name)): the reason the alias never reached it.
    x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('team', 'uefa', '50080', 740)")
    x("""INSERT INTO core.entity_names(entity_type, entity_id, name, normalized, kind, source)
         VALUES ('team', 740, 'FC Barcelona', 'fcbarcelona', 'source_spelling', 'uefa')""")
    # 707's own competitions: a PitchAPI league (LigaPro) and the Copa Libertadores of OpenFootball.
    x("INSERT INTO core.competitions(id, name, country_code) VALUES (10, 'LigaPro', 'ECU'), (11, 'copa-libertadores', NULL)")
    x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('competition', 'pitchapi', 'l_ligapr', 10)")
    x("""INSERT INTO core.competition_seasons(id, competition_id, season_id, native_label, cup_key) VALUES
         (10, 10, 2024, '2025', NULL), (11, 11, 2024, '2025', 'open-cups:copa-libertadores:2025')""")
    x("""INSERT INTO core.matches(id, competition_season_id, season_id, source, status, home_team_id, away_team_id, home_score, away_score,
           match_date, home_team_name, away_team_name) VALUES
         (90001, 10, 2024, 'pitchapi', 'finished', 707, 800, 2, 0, '2025-03-01', NULL, NULL),
         (90002, 10, 2024, 'pitchapi', 'finished', 801, 707, 1, 1, '2025-03-09', NULL, NULL),
         (90003, 11, 2024, 'openfootball', 'finished', 707, 801, 1, 0, '2025-04-10', 'Barcelona SC (ECU)', 'LDU de Quito (ECU)')""")
    x("INSERT INTO core.team_seasons(team_id, competition_season_id) VALUES (707, 10), (800, 10), (801, 10), (707, 11), (801, 11)")
    for table in ("matches", "competitions", "competition_seasons", "teams", "rounds"):
        x(f"SELECT setval(pg_get_serial_sequence('core.{table}', 'id'), 100000)")
    with db.transaction():
        curated.country_names(db)


def copa_body():
    """The Copa del Rey 2024/25 rows of FC Barcelona, as OpenFootball's archive writes them."""
    rows = [(r["date"], r["home_source"], r["away_source"], int(r["home_goals"]), int(r["away_goals"])) for r in fifteen()
            if r["source"] == "openfootball"]
    return {"name": "copa-del-rey-archive", "matches": [
        {"round": "Round", "date": day, "team1": home, "team2": away,
         "score": {"ft": [2, 2], "et": [hs, as_]} if day == "2025-04-26" else {"ft": [hs, as_]}}
        for day, home, away, hs, as_ in rows]}


@required(DSN and psycopg, "requires a disposable local identity DB (VEGA_V2_IDENTITY_TEST_DSN) and psycopg")
class Base(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from vega.store import connect_local

        target = urlparse(DSN)
        if target.hostname not in ("localhost", "127.0.0.1", "::1") or target.path != "/vega_v2_identity_test":
            raise RuntimeError("dedicated local identity DB required")
        cls.db = connect_local(DSN)

    @classmethod
    def tearDownClass(cls):
        cls.db.execute("RESET ROLE")
        cls.db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        cls.db.close()

    def setUp(self):
        self.db.execute("RESET ROLE")
        schema(self.db)

    def x(self, query, args=None):
        return self.db.execute(query, args)

    def as_role(self, role):
        self.x(f"SET ROLE {role}")
        self.addCleanup(self.x, "RESET ROLE")

    def owner_of_key(self, provider, key):
        row = self.x("SELECT entity_id FROM core.provider_ids WHERE entity_type = 'team' AND provider = %s AND provider_key = %s",
                     (provider, key)).fetchone()
        return row and row[0]

    def elo_rows(self):
        self.x("RESET ROLE")
        self.x("SET ROLE vega_calc")
        try:
            merge = {team: keep for team, keep, *_ in identity.pairs(self.db)[0]}
            rows = power.elo_matches(power.merged_rows(self.x(power.ELO_MATCHES).fetchall(), merge))
        finally:
            self.x("RESET ROLE")
        return {r[0]: (r[3], r[4]) for r in rows}


class FreshImportTest(Base):
    """39a, 39b: on a base that never held the wrong sides, the real writers give FC Barcelona's matches to 740."""

    def test_39a_the_reviewed_spelling_goes_to_the_spanish_club_only(self):
        self.as_role("vega_collect")
        with self.db.transaction():
            curated.club_aliases(self.db)
        names = lambda team: self.x("SELECT kind::text, source::text FROM core.entity_names WHERE entity_type = 'team' AND entity_id = %s"
                                    " AND normalized = 'fcbarcelona'", (team,)).fetchall()
        self.assertEqual(names(740), [("alias", "vega")])
        self.assertEqual(names(707), [])
        # Again: nothing changes.
        with self.db.transaction():
            curated.club_aliases(self.db)
        self.assertEqual((names(740), names(707)), ([("alias", "vega")], []))

    def test_39b_a_fresh_import_merges_fc_barcelona_into_740(self):
        self.as_role("vega_collect")
        with self.db.transaction():
            curated.club_aliases(self.db)
        with self.db.transaction():
            cups.save(self.db, "open-cups", "copa-del-rey-archive", "2024/2025", copa_body(), NOW)
        # A European archive's team « FC Barcelona », keyed as archives.Loader keys it, with one match against Juventus.
        self.x("RESET ROLE")
        self.x("INSERT INTO core.competitions(id, name) VALUES (231, 'Ligue des champions')")
        self.x("""INSERT INTO core.competition_seasons(id, competition_id, season_id, native_label, archive_key, archive_name, archive_country)
                  VALUES (5248, 231, 2020, '2020/2021', 'g:champions-league', 'Ligue des champions', 'Europe')""")
        self.x("INSERT INTO core.teams(id, name) VALUES (9002, 'FC Barcelona')")
        self.x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('team', 'vega', 'archive:europe:fc barcelona', 9002)")
        self.x("""INSERT INTO core.matches(id, competition_season_id, season_id, source, status, home_team_id, away_team_id, home_score, away_score,
                    match_date, archive_key, home_team_name, away_team_name)
                  VALUES (729828, 5248, 2020, 'worldclub', 'finished', 875, 9002, 0, 2, '2020-10-28', 'g:champions-league:2020-10-28:1', 'Juventus', 'FC Barcelona')""")
        self.x("SET ROLE vega_collect")
        with self.db.transaction():
            identity.run(self.db, None, "teams", NOW)
        self.x("RESET ROLE")
        self.assertEqual(self.owner_of_key("openfootball", "name:FC Barcelona"), 740)
        self.assertEqual(self.owner_of_key("vega", "archive:europe:fc barcelona"), 740)
        sides = self.x("""SELECT m.match_date::text, CASE WHEN m.home_team_name = 'FC Barcelona' THEN m.home_team_id ELSE m.away_team_id END
                          FROM core.matches m WHERE 'FC Barcelona' IN (m.home_team_name, m.away_team_name) ORDER BY 1""").fetchall()
        self.assertEqual(len(sides), 7)
        self.assertEqual({team for _, team in sides}, {740})
        # Barcelona SC keeps its own matches.
        self.assertEqual(self.x("SELECT count(*) FROM core.matches WHERE 707 IN (home_team_id, away_team_id)").fetchone()[0], 3)
        # The Elo reads the six cup matches with 740.
        cup = self.x("SELECT m.id FROM core.matches m JOIN core.competition_seasons cs ON cs.id = m.competition_season_id WHERE cs.cup_key = %s",
                     (COPA,)).fetchall()
        elo = self.elo_rows()
        self.assertEqual(len(cup), 6)
        self.assertTrue(all(740 in elo[match] and 707 not in elo[match] for (match,) in cup))


def production_state(db):
    """The fifteen sides on 707 as production holds them (18-19 Nov 2026), with what the merges left behind."""
    x = db.execute
    x("INSERT INTO core.competitions(id, name) VALUES (209, 'Coupe d’Europe des clubs champions'), (231, 'Ligue des champions'), (71, 'copa-del-rey-archive')")
    x("""INSERT INTO core.competition_seasons(id, competition_id, season_id, native_label, archive_key, archive_name, archive_country, cup_key) VALUES
         (3004, 209, 1998, '1998/1999', 'europe/1998-99/champs', 'Coupe d’Europe des clubs champions', 'Europe', NULL),
         (5248, 231, 2020, '2020/2021', 'g:champions-league', 'Ligue des champions', 'Europe', NULL),
         (300, 71, 2024, '2024/2025', NULL, NULL, NULL, %s)""", (COPA,))
    # The source-only teams the merges made pointers to 707, and Barcelona SC's own (Copa Libertadores).
    x("INSERT INTO core.teams(id, name, merged_into) VALUES (9001, 'FC Barcelona', 707), (9002, 'FC Barcelona', 707), (9003, 'Barcelona SC (ECU)', 707)")
    x("""INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id, is_current) VALUES
         ('team', 'transfermarkt', '3523', 707, true), ('team', 'openfootball', 'name:FC Barcelona', 707, true),
         ('team', 'openfootball', 'name:Barcelona SC (ECU)', 707, false), ('team', 'vega', 'archive:europe:fc barcelona', 707, true),
         ('team', 'transfermarkt', '131', 740, true), ('team', 'vega', 'archive:espagne:fc barcelona', 740, true),
         ('team', 'openfootball', 'name:UD Barbastro', 1759, true), ('team', 'openfootball', 'name:Real Betis', 475, true),
         ('team', 'openfootball', 'name:Valencia CF', 4706, true), ('team', 'openfootball', 'name:Atlético Madrid', 774, true),
         ('team', 'openfootball', 'name:Real Madrid', 4710, true)""")
    x("""INSERT INTO core.entity_names(entity_type, entity_id, name, normalized, kind, source) VALUES
         ('team', 707, 'FC Barcelona', 'fcbarcelona', 'alias', 'vega'),
         ('team', 707, 'FC Barcelona', 'fc barcelona', 'source_spelling', 'openfootball'),
         ('team', 707, 'Barcelona SC (ECU)', 'barcelona sc (ecu)', 'source_spelling', 'openfootball')""")
    for r in fifteen():
        edition = int(r["edition_id"])
        season = int(r["season"])
        x("""INSERT INTO core.matches(id, competition_season_id, season_id, source, status, home_team_id, away_team_id, home_score, away_score,
               match_date, archive_key, home_team_name, away_team_name)
             VALUES (%s, %s, %s, %s, 'finished', %s, %s, %s, %s, %s, %s, %s, %s)""",
          (int(r["match_id"]), edition, season, r["source"], int(r["home_id"]), int(r["away_id"]), int(r["home_goals"]), int(r["away_goals"]),
           r["date"], f"x:{r["match_id"]}" if r["archive_key"] else None, r["home_source"], r["away_source"]))
        if r["match_provider_key"]:
            provider, key = r["match_provider_key"].split(":", 1)
            x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('match', %s, %s, %s)",
              (provider, key, int(r["match_id"])))
    x("""INSERT INTO core.team_seasons(team_id, competition_season_id) SELECT DISTINCT t, m.competition_season_id
         FROM core.matches m CROSS JOIN LATERAL (VALUES (m.home_team_id), (m.away_team_id)) v(t)
         WHERE m.competition_season_id IN (3004, 5248, 300) ON CONFLICT DO NOTHING""")
    # Facts hanging from two of the matches: the final's goal by 707's side, and the Juventus match's statistics.
    x("INSERT INTO core.match_events(season_id, match_id, team_id, seq, event_type, minute, player_name) VALUES (2024, 2276, 707, 0, 'goal', 116, 'Jules Koundé')")
    x("INSERT INTO core.team_match_stats(season_id, match_id, team_id, period) VALUES (2020, 729828, 707, 'all'), (2020, 729828, 875, 'all')")


class ProductionRepairTest(Base):
    """39c–39g: the reviewed correction of the fifteen stored sides."""

    def setUp(self):
        super().setUp()
        production_state(self.db)
        self.ids = [int(r["match_id"]) for r in fifteen()]

    def sides(self):
        out = {}
        for r in fifteen():
            side = r["affected_side"]
            out[int(r["match_id"])] = self.x(f"SELECT {side}_team_id FROM core.matches WHERE id = %s", (int(r["match_id"]),)).fetchone()[0]
        return out

    def snapshot(self):
        return (self.x("SELECT id, home_team_id, away_team_id, home_score, away_score, match_date, status::text FROM core.matches ORDER BY id").fetchall(),
                self.x("SELECT entity_type::text, provider::text, provider_key, entity_id, is_current FROM core.provider_ids ORDER BY 1, 2, 3").fetchall(),
                self.x("SELECT entity_id, normalized, kind::text, source::text FROM core.entity_names WHERE entity_type = 'team' ORDER BY 1, 2").fetchall(),
                self.x("SELECT id, merged_into FROM core.teams ORDER BY id").fetchall(),
                self.x("SELECT team_id, competition_season_id FROM core.team_seasons ORDER BY 1, 2").fetchall(),
                self.x("SELECT match_id, team_id FROM core.match_events ORDER BY 1, 2").fetchall(),
                self.x("SELECT match_id, team_id FROM core.team_match_stats ORDER BY 1, 2").fetchall())

    def run_pass(self):
        self.as_role("vega_collect")
        with self.db.transaction():
            curated.club_aliases(self.db)
        with self.db.transaction():
            identity.run(self.db, None, "teams", NOW)
        self.x("RESET ROLE")

    def test_39c_39d_the_fifteen_sides_go_to_fc_barcelona_once(self):
        self.assertEqual(set(self.sides().values()), {707})
        ecuador = self.x("SELECT id, home_team_id, away_team_id, home_score, away_score FROM core.matches WHERE id IN (90001, 90002, 90003) ORDER BY id").fetchall()
        keys = self.x("SELECT provider_key FROM core.provider_ids WHERE entity_type = 'match' ORDER BY 1").fetchall()
        self.run_pass()
        self.assertEqual(self.sides(), dict.fromkeys(self.ids, 740))
        # The opponents, scores, days, match ids and match keys are those stored.
        for r in fifteen():
            row = self.x("SELECT home_team_id, away_team_id, home_score, away_score, match_date::text FROM core.matches WHERE id = %s", (int(r["match_id"]),)).fetchone()
            other = "away" if r["affected_side"] == "home" else "home"
            self.assertEqual(row[0 if other == "home" else 1], int(r[f"{other}_id"]))
            self.assertEqual((row[2], row[3], row[4]), (int(r["home_goals"]), int(r["away_goals"]), r["date"]))
        self.assertEqual(self.x("SELECT provider_key FROM core.provider_ids WHERE entity_type = 'match' ORDER BY 1").fetchall(), keys)
        # The facts of the matches follow the side; the opponent's stay.
        self.assertEqual(self.x("SELECT match_id, team_id FROM core.match_events").fetchall(), [(2276, 740)])
        self.assertEqual(self.x("SELECT match_id, team_id FROM core.team_match_stats ORDER BY team_id").fetchall(), [(729828, 740), (729828, 875)])
        # The keys and pointers of the merges, the alias, the memberships.
        self.assertEqual(self.owner_of_key("openfootball", "name:FC Barcelona"), 740)
        self.assertEqual(self.owner_of_key("vega", "archive:europe:fc barcelona"), 740)
        self.assertEqual(self.owner_of_key("openfootball", "name:Barcelona SC (ECU)"), 707)
        self.assertEqual(self.owner_of_key("transfermarkt", "3523"), 707)
        self.assertEqual(dict(self.x("SELECT id, merged_into FROM core.teams WHERE id IN (9001, 9002, 9003)").fetchall()), {9001: 740, 9002: 740, 9003: 707})
        self.assertEqual(self.x("SELECT api.internal_id('team', api.public_id('team', 9001))").fetchone()[0], 740)
        self.assertEqual(self.x("SELECT normalized, kind::text FROM core.entity_names WHERE entity_type = 'team' AND entity_id = 707 ORDER BY 1").fetchall(),
                         [("barcelona sc (ecu)", "source_spelling")])
        self.assertIn(("fcbarcelona", "alias"), self.x("SELECT normalized, kind::text FROM core.entity_names WHERE entity_type = 'team' AND entity_id = 740").fetchall())
        self.assertEqual(self.x("SELECT competition_season_id FROM core.team_seasons WHERE team_id = 707 ORDER BY 1").fetchall(), [(10,), (11,)])
        self.assertEqual(self.x("SELECT competition_season_id FROM core.team_seasons WHERE team_id = 740 ORDER BY 1").fetchall(), [(300,), (3004,), (5248,)])
        # Barcelona SC's own matches are untouched.
        self.assertEqual(self.x("SELECT id, home_team_id, away_team_id, home_score, away_score FROM core.matches WHERE id IN (90001, 90002, 90003) ORDER BY id").fetchall(), ecuador)
        # One record per moved side.
        records = self.x("SELECT match_id, side, from_team, to_team, correction FROM core.team_side_corrections ORDER BY match_id").fetchall()
        self.assertEqual([r[0] for r in records], sorted(self.ids))
        self.assertTrue(all(r[2:] == (707, 740, "barcelona-740") for r in records))
        # 39d: a second pass changes nothing.
        before = self.snapshot()
        self.run_pass()
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(self.x("SELECT count(*) FROM core.team_side_corrections").fetchone()[0], 15)

    def test_39e_a_later_import_keeps_fc_barcelona(self):
        self.run_pass()
        teams = self.x("SELECT count(*) FROM core.teams").fetchone()[0]
        self.as_role("vega_collect")
        with self.db.transaction():
            cups.save(self.db, "open-cups", "copa-del-rey-archive", "2024/2025", copa_body(), NOW)
        with self.db.transaction():
            identity.run(self.db, None, "teams", NOW)
        from vega.archives import Loader

        self.assertEqual(Loader(self.db).team("FC Barcelona", "Europe", write=False), 740)
        self.x("RESET ROLE")
        self.assertEqual(self.sides(), dict.fromkeys(self.ids, 740))
        self.assertEqual(self.x("SELECT count(*) FROM core.teams").fetchone()[0], teams)
        self.assertEqual(self.x("SELECT count(*) FROM core.matches WHERE competition_season_id = 300").fetchone()[0], 6)

    def test_39f_a_match_that_differs_from_its_preimage_is_held(self):
        self.x("UPDATE core.matches SET away_score = 3 WHERE id = 2276")
        self.run_pass()
        sides = self.sides()
        self.assertEqual(sides.pop(2276), 707)
        self.assertEqual(set(sides.values()), {740})
        self.assertEqual(self.x("SELECT count(*) FROM core.team_side_corrections").fetchone()[0], 14)
        self.assertEqual(self.x("SELECT team_id FROM core.match_events WHERE match_id = 2276").fetchone()[0], 707)
        # A held match keeps what names its side: the keys a later import resolves it by stay on 707.
        self.assertEqual(self.owner_of_key("openfootball", "name:FC Barcelona"), 707)
        # Edition 300 still holds 707 through the held match.
        self.assertIn((300,), self.x("SELECT competition_season_id FROM core.team_seasons WHERE team_id = 707").fetchall())

    def test_39g_the_elo_reads_fc_barcelona(self):
        cup = [int(r["match_id"]) for r in fifteen() if r["source"] == "openfootball"]
        before = self.elo_rows()
        self.assertTrue(all(707 in before[m] for m in cup))
        self.run_pass()
        after = self.elo_rows()
        self.assertTrue(all(740 in after[m] and 707 not in after[m] for m in cup))
        self.assertFalse(set(self.ids) - set(cup) & set(after))  # the archive editions stay out of the Elo
        self.assertEqual((after[90001], after[90002]), ((707, 800), (801, 707)))


class AdministrativeResultTest(Base):
    """39h, 39i: a result decided without play keeps its status and score, and is no Elo match."""

    def setUp(self):
        super().setUp()
        x = self.x
        x("INSERT INTO core.teams(id, name, country_code) VALUES (1318, 'Tours FC', 'FRA'), (1319, 'Lorient', 'FRA'), (3664, 'Seraing U21', 'BEL'),"
          " (3657, 'Beerschot VA U21', 'BEL'), (3665, 'Sp. Hasselt U21', 'BEL')")
        x("INSERT INTO core.competitions(id, name) VALUES (66, 'Coupe de France'), (128, 'BEL_U21_pro-league')")
        x("""INSERT INTO core.competition_seasons(id, competition_id, season_id, native_label, cup_key) VALUES
             (66, 66, 2024, '2024/2025', 'open-cups:france-cup:2024/2025'), (358, 128, 2026, '2026/2027', 'open-matchday:BEL_U21_pro-league:2026/2027')""")
        x("""INSERT INTO core.matches(id, competition_season_id, season_id, source, status, home_team_id, away_team_id, home_score, away_score,
               match_date, home_team_name, away_team_name) VALUES
             (1400, 66, 2024, 'openfootball', 'finished', 1318, 1319, 0, 3, '2024-12-21', 'Tours FC', 'FC Lorient'),
             (13507, 358, 2026, 'open_matchday', 'finished', 3664, 3657, 0, 5, '2026-09-18', 'Seraing U21', 'Beerschot VA U21'),
             (13501, 358, 2026, 'open_matchday', 'finished', 3665, 3664, 1, 3, '2026-09-11', 'Sp. Hasselt U21', 'Seraing U21')""")
        x("""INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES
             ('match', 'openfootball', %s, 1400),
             ('match', 'open_matchday', 'BEL_U21_pro-league:2026/2027:2026-09-18|Seraing U21|Beerschot VA U21', 13507),
             ('match', 'open_matchday', 'BEL_U21_pro-league:2026/2027:2026-09-11|Sp. Hasselt U21|Seraing U21', 13501)""", (cups.TOURS_AWARD,))

    def test_39h_39i_forfeits_are_no_elo_match(self):
        elo = self.elo_rows()
        self.assertNotIn(1400, elo)  # Tours–Lorient, stored finished as production holds it
        self.assertNotIn(13507, elo)  # Seraing–Beerschot, the federation's forfeit
        self.assertIn(13501, elo)  # a match played
        self.x("UPDATE core.matches SET status = 'awarded' WHERE id = 1400")
        self.assertNotIn(1400, self.elo_rows())
        # Their status and score stay for the table and the cup's page.
        self.assertEqual(self.x("SELECT status::text, home_score, away_score FROM core.matches WHERE id = 13507").fetchone(), ("finished", 0, 5))
        table = dict(self.x("SELECT team_id, results FROM core.table_results(358)").fetchall())
        self.assertEqual(table[3657], [1, 1, 0, 0, 5, 0])
        self.assertEqual(table[3664], [2, 1, 0, 1, 3, 6])


class RankingSpellingTest(Base):
    """39j, 39k: a SportScore spelling names a club for SportScore's table, not for UEFA's linking."""

    def setUp(self):
        super().setUp()
        x = self.x
        x("INSERT INTO core.teams(id, name, country_code) VALUES (845, 'FC Andorra', 'ESP'), (12300, 'Andorra CF', NULL)")
        x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('team', 'pitchapi', 't_4HU7yw', 845),"
          " ('team', 'vega', 'archive:espagne:andorra cf', 12300)")
        x("""INSERT INTO core.entity_names(entity_type, entity_id, name, normalized, kind, source)
             VALUES ('team', 845, 'Andorra CF', 'andorracf', 'source_spelling', 'sportscore')""")

    def test_39j_uefa_does_not_read_a_ranking_spelling(self):
        from vega.sources import uefa

        self.as_role("vega_collect")
        with self.db.transaction():
            team, linked = uefa.link_team(self.db, {"id": "99999", "name": "Andorra CF", "country": "ESP"})
        self.assertFalse(linked)
        self.assertNotIn(team, (845, 12300))
        # FC Andorra under its own name is still FC Andorra.
        with self.db.transaction():
            self.assertEqual(uefa.link_team(self.db, {"id": "99998", "name": "FC Andorra", "country": "ESP"}), (845, True))

    def test_39k_the_838_spellings_still_name_their_clubs_in_their_editions(self):
        from vega.sources import sportscore

        x = self.x
        with REGISTER.open(newline="", encoding="utf-8") as f:
            register = list(csv.DictReader(f))
        self.assertEqual(len(register), 838)
        x("DELETE FROM core.entity_names WHERE entity_type = 'team' AND entity_id IN (845, 12300)")
        x("DELETE FROM core.provider_ids WHERE entity_type = 'team' AND entity_id IN (845, 12300)")
        x("DELETE FROM core.teams WHERE id IN (845, 12300)")
        # Each spelling's club, a member of each edition the register names (or of an edition of its own).
        memberships = []
        for n, row in enumerate(register):
            team = 200000 + int(row["team_id"])
            x("INSERT INTO core.teams(id, name, country_code) VALUES (%s, %s, NULL)", (team, row["canonique"]))
            # The four reserve and college spellings reviewed for a PitchAPI key (sportscore.REVIEWED_SPELLINGS).
            for key, canonical in sportscore.REVIEWED_SPELLINGS:
                if canonical == identity.normalize(row["canonique"]):
                    x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('team', 'pitchapi', %s, %s)", (key, team))
            x("""INSERT INTO core.entity_names(entity_type, entity_id, name, normalized, kind, source)
                 VALUES ('team', %s, %s, %s, 'source_spelling', 'sportscore') ON CONFLICT DO NOTHING""",
              (team, row["graphie_SportScore"], identity.normalize(row["graphie_SportScore"]) or row["graphie_SportScore"].lower()))
            for edition in ([int(e) for e in row["editions_classees"].split("|")] if row["editions_classees"] else [100000 + n]):
                if not x("SELECT 1 FROM core.competition_seasons WHERE id = %s", (edition,)).fetchone():
                    x("INSERT INTO core.competitions(id, name) VALUES (%s, %s)", (500000 + edition, f"register {edition}"))
                    x("INSERT INTO core.competition_seasons(id, competition_id, season_id, native_label) VALUES (%s, %s, 2026, '2026/2027')",
                      (edition, 500000 + edition))
                x("INSERT INTO core.team_seasons(team_id, competition_season_id) VALUES (%s, %s)", (team, edition))
                memberships.append((edition, row["graphie_SportScore"], team))
        failures = []
        for edition, name, team in memberships:
            try:
                found = sportscore.link(self.db, edition, [(None, [{"name": name}])], sportscore._gender(name) or "men")
            except Exception as error:  # noqa: BLE001 - listed with the spelling
                failures.append((name, edition, str(error)))
                continue
            if found != {name: team}:
                failures.append((name, edition, found))
        self.assertEqual(failures, [])
        linked = len({name for _, name, _ in memberships})
        self.assertEqual(linked, 838)


if __name__ == "__main__":
    unittest.main()
