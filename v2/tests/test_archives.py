"""Historical archives (vega_v2/archives.py): main's builders and shared/archive.js on
synthetic sources, then typed rows."""

import importlib.util
import os
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))
from archive_fixtures import RECENT_GOALS, make_sources
from vega_v2 import archives

try:
    import psycopg
except ImportError:
    psycopg = None
DSN = os.environ.get("VEGA_V2_ARCHIVES_TEST_DSN")


class PureTest(unittest.TestCase):
    def test_family_minute_and_notes(self):
        self.assertEqual(archives.family("2015-16/en.1"), "en.1")
        self.assertEqual(archives.family("england/1990-91/eng.1"), "england/eng.1")
        self.assertEqual(archives.family("engsoccerdata/spain/all/1990"), "engsoccerdata/spain/all")
        self.assertEqual(archives.family("worldclub/scotland/1900"), "worldclub/scotland")
        self.assertEqual(archives.family("g:eng-premier-league"), "g:eng-premier-league")
        self.assertEqual(archives._minute("45+2"), (45, 2))
        self.assertEqual(archives._minute("?"), (None, None))
        row = archives.match_row({"key": "r:x:0", "score": [2, 2], "notes": ["après prolongation", "tirs au but 4 – 3"],
                                  "source": {"status": None, "et": [2, 2], "p": [4, 3], "neutral": False}})
        self.assertEqual((row["home_score_et"], row["home_penalty_score"], row["status"]), (2, 4, "finished"))
        with self.assertRaises(archives.ArchiveError):  # a note no typed column carries
            archives.match_row({"key": "r:x:1", "score": [1, 0], "notes": ["Source : x"], "source": {"status": None}})

    def test_every_goal_competition_names_its_pitchapi_one(self):
        # The goal archive is the only one that goes past 2020/2021: each of its competitions
        # says which PitchAPI competition it is (or that PitchAPI never has it).
        spec = importlib.util.spec_from_file_location("build_historical_goals", archives.SCRIPTS / "build_historical_goals.py")
        builder = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(builder)
        self.assertEqual(set(archives.PITCHAPI_COMPETITIONS), {"g:" + name for name in builder.COMPETITIONS})
        mapped = [key for key in archives.PITCHAPI_COMPETITIONS.values() if key]
        self.assertEqual(len(mapped), len(set(mapped)))


@unittest.skipUnless(DSN and psycopg and shutil.which("node"), "requires a disposable local archives DB, psycopg and node")
class ImportTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from vega_v2.store import connect_local, migrate

        target = urlparse(DSN)
        if target.hostname not in ("localhost", "127.0.0.1", "::1") or target.path != "/vega_v2_archives_test":
            raise RuntimeError("dedicated local archives DB required")
        cls.db = connect_local(DSN)
        cls.db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        migrate(cls.db)
        cls.sources = tempfile.TemporaryDirectory()
        make_sources(cls.sources.name)

    @classmethod
    def tearDownClass(cls):
        cls.db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        cls.db.close()
        cls.sources.cleanup()

    def test_import_and_reimport(self):
        x = self.db.execute
        self.assertEqual(archives.run(self.db, self.sources.name), {"2015/2016": 4})
        rows = x("""SELECT key, competition_id, date::text, team1, team2, home_score, away_score, home_score_et,
                    home_penalty_score, decided_on_penalties, goal_count, round FROM api.archive_matches ORDER BY position""").fetchall()
        # Newest first (shared/archive.js order); the goal-only Everton match joins the league it matched.
        self.assertEqual(rows, [
            ("r:2015-16/en.1:2", "2015-16/en.1", "2015-08-15", "Chelsea FC", "Leicester City FC", 2, 2, 2, 4, None, 0, "Matchday 2"),
            ("g:eng-premier-league:2015-08-09:2", "2015-16/en.1", "2015-08-09", "Everton", "Watford", 2, 2, None, None, None, 1, None),
            ("r:2015-16/en.1:0", "2015-16/en.1", "2015-08-08", "Arsenal FC", "West Ham United FC", 0, 2, None, None, None, 2, "Matchday 1"),
            ("r:2015-16/en.1:1", "2015-16/en.1", "2015-08-08", "Leicester City FC", "Sunderland AFC", 4, 2, None, None, None, 1, "Matchday 1"),
        ])
        goals = x("""SELECT g.minute, g.player, g.team, g.score_home, g.score_away, g.score_disagreement FROM api.archive_goals g
                     JOIN api.archive_matches m ON m.season_id=g.season_id AND m.match_id=g.match_id ORDER BY m.position, g.seq""").fetchall()
        self.assertEqual(goals, [
            ("45+2", "Ross Barkley", "Everton", 1, 1, True),
            ("43", "Cheikhou Kouyaté", "West Ham United FC", 0, 1, None),
            ("57", "Mauro Zárate", "West Ham United FC", 0, 2, None),
            ("11", "Jamie Vardy", "Leicester City FC", 1, 0, True),
        ])
        self.assertEqual(x("SELECT id, name, country, position FROM api.archive_editions").fetchall(),
                         [("2015-16/en.1", "English Premier League 2015/16", "Angleterre", 0)])
        self.assertEqual(x("SELECT source, name, revision FROM core.source_revisions ORDER BY 1").fetchall(), [
            ("goals", "schochastics/football-data (World Club Ratings)", "test"),
            ("results", "OpenFootball", "e6744429ee395bc86f247348c6184bb08d4eb361"),
        ])
        ids = dict(x("SELECT archive_key, id FROM core.matches").fetchall())
        # Re-import of unchanged sources: same rows, same ids, nothing written, no new version.
        revisions = dict(x("SELECT id, revision FROM core.matches").fetchall())
        self.assertEqual(archives.run(self.db, self.sources.name), {"2015/2016": 4})
        self.assertEqual(dict(x("SELECT archive_key, id FROM core.matches").fetchall()), ids)
        self.assertEqual(dict(x("SELECT id, revision FROM core.matches").fetchall()), revisions)
        self.assertEqual(x("SELECT count(*) FROM core.match_events").fetchone()[0], 4)
        self.assertEqual(x("SELECT version FROM ops.resource_versions WHERE resource_kind='archive_season' AND resource_id=2015").fetchone()[0], 1)
        # A row that differs from the sources (and a goal lost) is rewritten, and the season gets a new version.
        x("UPDATE core.matches SET home_score=9 WHERE archive_key='r:2015-16/en.1:0'")
        x("DELETE FROM core.match_events WHERE seq=1 AND minute=57")
        self.assertEqual(archives.run(self.db, self.sources.name), {"2015/2016": 4})
        self.assertEqual(x("SELECT home_score FROM core.matches WHERE archive_key='r:2015-16/en.1:0'").fetchone(), (0,))
        self.assertEqual(x("SELECT count(*) FROM core.match_events").fetchone()[0], 4)
        self.assertEqual(x("SELECT version FROM ops.resource_versions WHERE resource_kind='archive_season' AND resource_id=2015").fetchone()[0], 2)
        self.assertEqual(x("SELECT count(*) FROM core.teams").fetchone()[0], 7)  # Leicester plays twice
        # A calendar-year edition spans two sporting seasons under one key: each season has
        # its own edition row, and its matches point at it.
        loader = archives.Loader(self.db)
        spanning = {"competitions": [{"id": "2015-16/en.1", "name": "English Premier League 2015/16", "country": "Angleterre"}],
                    "matches": [{"key": "r:2015-16/en.1:9", "competitionId": "2015-16/en.1", "date": "2016-08-01",
                                 "team1": "Arsenal FC", "team2": "Everton", "score": [1, 0]}]}
        with self.db.transaction():
            self.assertEqual(loader.season("2016/2017", spanning, lambda match: "openfootball"), 1)
        editions = x("""SELECT s.label, count(*) FROM core.competition_seasons cs JOIN core.seasons s ON s.id = cs.season_id
                        WHERE cs.archive_key = '2015-16/en.1' GROUP BY 1 ORDER BY 1""").fetchall()
        self.assertEqual(editions, [("2015/2016", 1), ("2016/2017", 1)])

    def test_recent_seasons_fill_what_pitchapi_lacks(self):
        from vega_v2.store import Store

        x = self.db.execute
        editions = lambda season: x(
            """SELECT cs.archive_key, count(m.id) FROM core.competition_seasons cs
               LEFT JOIN core.matches m ON m.competition_season_id = cs.id
               WHERE cs.season_id = %s AND cs.archive_key IS NOT NULL GROUP BY 1 ORDER BY 1""", (season,)).fetchall()
        version = lambda season: x(
            "SELECT version FROM ops.resource_versions WHERE resource_kind='archive_season' AND resource_id=%s", (season,)).fetchone()
        with tempfile.TemporaryDirectory() as root:
            make_sources(root, RECENT_GOALS)
            run = lambda: archives.run(self.db, root, {"2021/2022"})
            # PitchAPI has no edition of either competition that season: both are imported.
            self.assertEqual(run(), {"2021/2022": 2})
            self.assertEqual(editions(2021), [("g:eng-fa-cup", 1), ("g:eng-premier-league", 1)])
            self.assertEqual(x("SELECT DISTINCT source::text FROM core.matches WHERE season_id=2021").fetchall(), [("worldclub",)])
            self.assertEqual(x("SELECT count(*) FROM core.match_events WHERE season_id=2021").fetchone()[0], 3)
            # A PitchAPI edition of the league in another season changes nothing here.
            league = x("INSERT INTO core.competitions(name) VALUES ('Premier League') RETURNING id").fetchone()[0]
            x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('competition','pitchapi','l_4WFCIZ',%s)", (league,))
            Store(self.db).season("2022/2023")
            x("INSERT INTO core.competition_seasons(competition_id, season_id, native_label) VALUES (%s, 2022, '2022/2023')", (league,))
            self.assertEqual(run(), {"2021/2022": 2})
            self.assertEqual(version(2021), (1,))
            # Once PitchAPI has that season of the league, its archive edition goes: the cup
            # stays, and PitchAPI's own match and goal are left alone.
            edition = x("INSERT INTO core.competition_seasons(competition_id, season_id, native_label) VALUES (%s, 2021, '2021/2022') RETURNING id",
                        (league,)).fetchone()[0]
            match = x("INSERT INTO core.matches(competition_season_id, season_id, status, source) VALUES (%s, 2021, 'finished', 'pitchapi') RETURNING id",
                      (edition,)).fetchone()[0]
            x("INSERT INTO core.match_events(season_id, match_id, seq, event_type, minute) VALUES (2021, %s, 0, 'goal', 10)", (match,))
            self.assertEqual(run(), {"2021/2022": 1})
            self.assertEqual(editions(2021), [("g:eng-fa-cup", 1)])
            self.assertEqual(x("SELECT count(*) FROM core.matches WHERE season_id=2021 AND archive_key IS NULL").fetchone()[0], 1)
            self.assertEqual(x("SELECT match_id = %s, count(*) FROM core.match_events WHERE season_id=2021 GROUP BY 1 ORDER BY 1", (match,)).fetchall(),
                             [(False, 1), (True, 1)])
            self.assertEqual(version(2021), (2,))
            self.assertEqual(run(), {"2021/2022": 1})
            self.assertEqual(version(2021), (2,))
            self.assertEqual(x("SELECT count(*) FROM core.match_events WHERE season_id=2021").fetchone()[0], 2)
        loader = archives.Loader(self.db)
        league_only = {"competitions": [{"id": "g:eng-premier-league", "name": "Première division", "country": "Angleterre"}],
                       "matches": [{"key": "g:eng-premier-league:2022-08-06:0", "competitionId": "g:eng-premier-league", "date": "2022-08-06",
                                    "team1": "Arsenal", "team2": "Everton", "score": [1, 0]}]}
        # A season PitchAPI has entirely: nothing is written, not even a version.
        with self.db.transaction():
            self.assertEqual(loader.season("2022/2023", league_only, lambda match: "worldclub"), 0)
        self.assertEqual(editions(2022), [])
        self.assertIsNone(version(2022))
        # A competition the table does not know stops the import instead of slipping in.
        unknown = {"competitions": [{"id": "g:xx-new-league", "name": "X", "country": "Angleterre"}], "matches": []}
        with self.assertRaises(archives.ArchiveError), self.db.transaction():
            loader.season("2021/2022", unknown, lambda match: "worldclub")


if __name__ == "__main__":
    unittest.main()
