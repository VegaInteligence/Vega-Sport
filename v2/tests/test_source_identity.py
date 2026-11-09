"""SportsAPI rankings (real captures), the site data of dashboard/shared as rows (zones,
cup logos, SportScore ids) and one team per real team across cup sources."""

from datetime import datetime, timezone
import gzip
import json
import os
from pathlib import Path
import sys
import unittest
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from vega_v2.sources import curated, identity, sportsapi

try:
    import psycopg
except ImportError:
    psycopg = None
DSN = os.environ.get("VEGA_V2_SOURCES_TEST_DSN")
CAPTURES = ROOT.parent / "docs/verification/aws-catalog-20261104/captures"
NOW = datetime(2026, 11, 9, 6, tzinfo=timezone.utc)


def capture(kind):
    """The SportsAPI response main read on 2026-11-01, rebuilt from its kept rows."""
    edition = json.loads(gzip.open(CAPTURES / f"raw__rankings__{kind}__2026-11-01.sportsapi.json.gz").read())
    return {"data": [r["sourceRow"] for r in edition["rows"]], "meta": {"updatedAt": edition["sourceUpdatedAt"]}}


class ParseTest(unittest.TestCase):
    def test_real_responses(self):
        rows = sportsapi.parse(capture("fifa-men"))
        self.assertEqual(rows[0], ("293151", "Spain", "ESP", 1, 1, 2011.571862, "https://cdn.sportsapi.app/v2/teams/293151/logo"))
        self.assertEqual(len(sportsapi.parse(capture("uefa-associations"))), 55)
        self.assertEqual(sportsapi.parse(capture("uefa-associations"))[0][:2], ("EN", "England"))
        self.assertEqual(len(sportsapi.parse(capture("uefa-clubs"))), 415)

    def test_country_names_follow_the_site(self):
        import re

        js = (ROOT.parent / "dashboard/frontend/src/services/competition-selector.js").read_text()
        block = js[js.index("export const COUNTRY_NAMES = {"):]
        block = block[:block.index("}")]
        self.assertEqual(dict(re.findall(r'^\s*"?([A-Z0-9-]+)"?:\s*"([^"]+)"', block, re.M)), curated.COUNTRY_NAMES_FR)

    def test_club_core_names(self):
        self.assertEqual(identity.club_core("West Ham United FC"), identity.club_core("West Ham United"))
        self.assertEqual(identity.club_core("1. FC Köln"), "koln")
        self.assertNotEqual(identity.club_core("Racing Club de Lens"), identity.club_core("Racing Club de Strasbourg"))

    def test_no_key_no_scope(self):
        os.environ.pop("V2_SPORTSAPI_API_KEY", None)
        self.assertEqual(sportsapi.scopes(NOW), {})


@unittest.skipUnless(DSN and psycopg, "requires disposable local sources DB and psycopg")
class SourceIdentityTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from vega_v2.store import Store, connect_local, migrate

        target = urlparse(DSN)
        if target.hostname not in ("localhost", "127.0.0.1", "::1") or target.path != "/vega_v2_sources_test":
            raise RuntimeError("dedicated local sources DB required")
        cls.db = connect_local(DSN)
        cls.db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        migrate(cls.db)
        with cls.db.transaction():
            Store(cls.db).season("2026/2027")
        x = cls.db.execute
        x("INSERT INTO core.countries(code) VALUES ('ESP'), ('GER'), ('SCO'), ('ITA'), ('ENG')")
        x("""INSERT INTO core.teams(id, name, country_code, is_national) VALUES (1, 'Spain', 'ESP', true), (2, 'Germany', 'GER', true),
             (3, 'Scotland', 'SCO', true), (4, 'Bayern München', 'GER', false)""")
        x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) SELECT 'team', 'pitchapi', 't_aaaaa' || id, id FROM core.teams")
        x("INSERT INTO core.teams(id, name) SELECT 100 + t, 'Club ' || t FROM generate_series(1, 20) t")
        x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) SELECT 'team', 'pitchapi', 't_c' || lpad(id::text, 5, '0'), id FROM core.teams WHERE id > 100")
        # Serie A (l_0ALvwF: 20 teams, 3 relegated) and the World Cup (l_1XLtP0), PitchAPI competitions.
        x("INSERT INTO core.competitions(id, name, kind) VALUES (1, 'Serie A', 'league'), (2, 'World Cup', 'international')")
        x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('competition','pitchapi','l_0ALvwF',1), ('competition','pitchapi','l_1XLtP0',2)")
        x("INSERT INTO core.competition_seasons(id, competition_id, season_id, native_label, is_current) VALUES (1, 1, 2026, '2026/2027', true), (2, 2, 2026, '2026', true)")
        x("INSERT INTO core.team_seasons(team_id, competition_season_id) SELECT id, 1 FROM core.teams WHERE id > 100")
        # A PitchAPI match Germany - Scotland.
        x("""INSERT INTO core.matches(id, competition_season_id, season_id, source, status, home_team_id, away_team_id, home_score, away_score, match_date)
             VALUES (1, 2, 2026, 'pitchapi', 'finished', 2, 3, 5, 1, '2026-06-14')""")
        x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('match','pitchapi','m_aaaaa1',1)")
        # UEFA rows the SportsAPI rows are linked through.
        x("INSERT INTO core.ranking_editions(id, kind, provider, label) VALUES (1, 'uefa_clubs', 'uefa', '2025/2026'), (2, 'uefa_associations', 'uefa', '2025/2026')")
        x("INSERT INTO core.ranking_rows(edition_id, row_no, team_id, position, entity_name, provider_key) VALUES (1, 1, 4, 1, 'FC Bayern München', '50037')")
        x("INSERT INTO core.ranking_rows(edition_id, row_no, country_code, position, entity_name, provider_key) VALUES (2, 1, 'ENG', 1, 'England', '1')")
        x("SELECT setval(pg_get_serial_sequence('core.teams', 'id'), 1000)")
        for table in ("matches", "competitions", "competition_seasons", "ranking_editions"):
            x(f"SELECT setval(pg_get_serial_sequence('core.{table}', 'id'), 1000)")

    @classmethod
    def tearDownClass(cls):
        cls.db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        cls.db.close()

    def test_sportsapi_snapshots_link_like_the_official_sources(self):
        for name, kind in sportsapi.KINDS.items():
            body = capture({"uefa-countries": "uefa-associations"}.get(name, name))  # main's file names
            with self.db.transaction():
                written, unmatched = sportsapi.save(self.db, kind, "2026-11-01", sportsapi.parse(body), sportsapi.BASE + name, body["meta"]["updatedAt"])
            # The known ones only: Spain, Germany, Scotland; England; Bayern.
            self.assertEqual(written, {"fifa_men": 3, "uefa_associations": 1, "uefa_clubs": 1}[kind], kind)
            self.assertEqual(written + unmatched, {"fifa_men": 211, "uefa_associations": 55, "uefa_clubs": 415}[kind])
        rows = self.db.execute(
            """SELECT e.kind::text, r.team_id, r.country_code, r.position FROM core.ranking_rows r JOIN core.ranking_editions e ON e.id = r.edition_id
               WHERE e.provider = 'sportsapi' AND r.position = 1 ORDER BY 1"""
        ).fetchall()
        self.assertEqual(rows, [("fifa_men", 1, None, 1), ("uefa_associations", None, "ENG", 1), ("uefa_clubs", 4, None, 1)])
        self.assertEqual(self.db.execute("SELECT provider_key FROM core.provider_ids WHERE provider='sportsapi' AND entity_id=4").fetchone()[0], "4441")
        # Served under its date; an official edition of the same date is served first.
        self.db.execute("INSERT INTO core.ranking_editions(kind, provider, label) VALUES ('fifa_men', 'fifa', '2026-11-01')")
        served = self.db.execute("SELECT provider, official_edition FROM api.ranking_editions WHERE kind='fifa-men' AND edition='2026-11-01'").fetchall()
        self.assertEqual(served, [("FIFA", True)])
        self.assertEqual(self.db.execute("SELECT provider FROM api.ranking_editions WHERE kind='uefa-clubs' AND edition='2026-11-01'").fetchone()[0], "SportsAPI")

    def test_shared_site_data_as_rows(self):
        with self.db.transaction():
            curated.league_zones(self.db)
            curated.cup_logos(self.db)
            curated.sportscore_ids(self.db)
        zones = self.db.execute("SELECT zone::text, position_from, position_to FROM core.competition_zones WHERE competition_season_id=1 ORDER BY 2").fetchall()
        self.assertEqual(zones, [("relegation", 18, 20)])  # Serie A: 20 teams, 3 relegated
        logo = self.db.execute("SELECT a.source_url FROM core.competitions c JOIN core.assets a ON a.id = c.logo_asset_id WHERE c.id = 2").fetchone()[0]
        self.assertTrue(logo.startswith("https://img.thesports.com/"))
        slugs = dict(self.db.execute("SELECT entity_id, provider_key FROM core.provider_ids WHERE provider='sportscore'").fetchall())
        self.assertEqual(slugs, {1: "italian-serie-a", 2: "fifa-world-cup"})

    def test_archive_teams_merge_into_the_club_of_their_country(self):
        x = self.db.execute
        x("INSERT INTO core.teams(id, name, country_code) VALUES (20, 'West Ham United', 'ENG'), (21, 'Racing', 'ESP'), (22, 'Racing', 'ESP')")
        x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('team','pitchapi','t_aaaa20',20), ('team','pitchapi','t_aaaa21',21), ('team','pitchapi','t_aaaa22',22)")
        x("INSERT INTO core.teams(id, name) VALUES (30, 'West Ham United FC'), (31, 'Racing'), (32, 'Leicester City FC')")
        x("""INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES
             ('team','vega','archive:angleterre:westhamunitedfc',30), ('team','vega','archive:espagne:racing',31), ('team','vega','archive:angleterre:leicestercityfc',32)""")
        with self.db.transaction():
            from vega_v2.store import Store

            Store(self.db).season("2015/2016")
        x("INSERT INTO core.competitions(id, name) VALUES (50, 'English Premier League')")
        x("""INSERT INTO core.competition_seasons(id, competition_id, season_id, native_label, archive_key, archive_name, archive_country)
             VALUES (50, 50, 2015, '2015/2016', '2015-16/en.1', 'English Premier League 2015/16', 'Angleterre')""")
        x("""INSERT INTO core.matches(id, competition_season_id, season_id, source, status, home_team_id, away_team_id, home_score, away_score,
               match_date, archive_key, home_team_name, away_team_name)
             VALUES (50, 50, 2015, 'openfootball', 'finished', 30, 32, 2, 1, '2015-08-09', 'r:2015-16/en.1:0', 'West Ham United FC', 'Leicester City FC')""")
        x("""INSERT INTO core.match_events(season_id, match_id, team_id, seq, event_type, minute, player_name)
             VALUES (2015, 50, 30, 0, 'goal', 12, 'Cheikhou Kouyaté')""")
        with self.db.transaction():
            curated.country_names(self.db)
            merged, unmatched = identity.run(self.db, None, "teams", NOW)
        self.assertGreaterEqual(merged, 1)
        # West Ham is the English club; Racing names two Spanish clubs, Leicester none: both stay.
        self.assertEqual(self.db.execute("SELECT home_team_id, away_team_id FROM core.matches WHERE id = 50").fetchone(), (20, 32))
        self.assertEqual(self.db.execute("SELECT entity_id FROM core.provider_ids WHERE provider_key = 'archive:angleterre:westhamunitedfc'").fetchone()[0], 20)
        self.assertEqual(self.db.execute("SELECT count(*) FROM core.teams WHERE id IN (30, 31, 32)").fetchone()[0], 2)
        # The archive reads keep the source's names.
        self.assertEqual(self.db.execute("SELECT team1, team2 FROM api.archive_matches WHERE match_id = 50").fetchone(), ("West Ham United FC", "Leicester City FC"))
        self.assertEqual(self.db.execute("SELECT team FROM api.archive_goals WHERE match_id = 50").fetchone()[0], "West Ham United FC")
        self.assertEqual(self.db.execute("SELECT team_id FROM core.match_events WHERE match_id = 50").fetchone()[0], 20)

    def test_cup_teams_merge_into_the_same_pitchapi_teams(self):
        from vega_v2.sources import cups

        body = {"name": "World Cup 2026", "season": "2026", "source": {"name": "OpenFootball", "url": "https://github.com/openfootball/worldcup.json"},
                "matches": [{"round": "Matchday 1", "date": "2026-06-14", "team1": "Germany", "team2": "Scotland", "score": {"ft": [5, 2]}},
                            {"round": "Matchday 1", "date": "2026-06-15", "team1": "Narnia", "team2": "Germany"}]}
        with self.db.transaction():
            cups.save(self.db, "open-cups", "world-cup-history", "2026", body, NOW)
        with self.db.transaction():
            merged, unmatched = identity.run(self.db, None, "teams", NOW)
        self.assertEqual(merged, 2)  # Germany and Scotland; Narnia names nobody and stays
        narnia = self.db.execute("SELECT entity_id FROM core.provider_ids WHERE provider='openfootball' AND provider_key='name:Narnia'").fetchone()[0]
        self.assertEqual(self.db.execute("SELECT name FROM core.teams WHERE id=%s", (narnia,)).fetchone()[0], "Narnia")
        owners = dict(self.db.execute("SELECT provider_key, entity_id FROM core.provider_ids WHERE entity_type='team' AND provider='openfootball'").fetchall())
        self.assertEqual((owners["name:Germany"], owners["name:Scotland"]), (2, 3))
        self.assertEqual(self.db.execute("SELECT count(*) FROM core.teams WHERE name IN ('Germany', 'Scotland')").fetchone()[0], 2)
        # The cup read keeps the source's spelling; the duplicate and the score gap are noted.
        cup = self.db.execute("SELECT home, away FROM api.cup_matches ORDER BY date").fetchall()
        self.assertEqual(cup, [("Germany", "Scotland"), ("Narnia", "Germany")])
        warnings = dict(self.db.execute("SELECT kind::text, detail FROM ops.data_warnings").fetchall())
        self.assertEqual(warnings, {"duplicate_match": "m_aaaaa1", "score_disagreement": "m_aaaaa1 5-1 / 5-2"})
        # A later read of the same source does not rename the PitchAPI team.
        with self.db.transaction():
            cups.save(self.db, "open-cups", "world-cup-history", "2026", dict(body, name="World Cup 2026 (refreshed)"), NOW)
        self.assertEqual(self.db.execute("SELECT name FROM core.teams WHERE id = 2").fetchone()[0], "Germany")


if __name__ == "__main__":
    unittest.main()
