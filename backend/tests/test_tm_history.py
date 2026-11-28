"""The five big leagues' player seasons of 2012/13 to 2020/21 from transfermarkt-datasets (vega/sources/tm_history.py).

Written before the reader. Failure modes and expected outcomes:
- a file that is not the pinned one (its SHA-256 differs): SOURCE_CHANGED, the reading stops at that file and nothing
  is written; the rows read from the revision before stay;
- a game of a competition code other than GB1, ES1, L1, IT1, FR1 (a cup, a second division) is ignored, and so are its
  appearances, even a malformed one;
- a game of a season before 2012/13 or after 2020/21 is ignored, with its appearances;
- a player who played for two clubs in one league season is two rows (one per club), each with its own totals;
- a row's totals: matches = its appearances (one per game), minutes, goals, assists, yellow and red cards summed; the
  player's name is the one of his latest appearance in that row; the club's name is the clubs file's;
- a malformed value in a read game or appearance (a number that is not a whole non-negative number in range, a
  missing column, an appearance for a club that is not one of the game's sides, two appearances of one player in one
  game, a club the clubs file lacks, a game listed twice): INVALID_SOURCE, nothing is written;
- each file is asked for as bytes with a size cap of its own (the appearances file is 45 MB, above the client's 8 MB
  default; the client's default stays 8 MB);
- a league the base does not hold (no PitchAPI competition key): COMPETITION_UNKNOWN, nothing is written;
- a later run with the same revision reads no file, and links the rows whose player or club Transfermarkt process
  linked since (core.provider_ids, provider transfermarkt, current links only); a link no longer current is undone;
- a player or a team removed from the base leaves the row, unlinked (ON DELETE SET NULL);
- a new revision replaces the rows of the five leagues and nine seasons, and those only;
- the collection role does it all; the credit (CC0-1.0, the project, the files read) is a row of core.source_revisions.
"""

import gzip
import hashlib
import io
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys
import unittest
from unittest import mock
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))
from prerequisites import required  # noqa: E402
from vega import sources
from vega.sources import SourceError, http, tm_history
from template_base import fresh

try:
    import psycopg
except ImportError:
    psycopg = None
DSN = os.environ.get("VEGA_V2_TM_HISTORY_TEST_DSN")
NOW = datetime(2026, 11, 23, 8, tzinfo=timezone.utc)
RUN = ("transfermarkt", "league_player_seasons")

GAMES = ["game_id", "competition_id", "season", "round", "date", "home_club_id", "away_club_id", "home_club_goals",
         "away_club_goals", "home_club_name", "away_club_name", "competition_type"]
APPEARANCES = ["appearance_id", "game_id", "player_id", "player_club_id", "player_current_club_id", "date", "player_name",
               "competition_id", "yellow_cards", "red_cards", "goals", "assists", "minutes_played"]
CLUBS = ["club_id", "club_code", "name", "domestic_competition_id"]


def gz(header, rows):
    """A CSV file as transfermarkt-datasets serves it: every value quoted, gzip."""
    text = io.StringIO()
    text.write(",".join(f'"{h}"' for h in header) + "\n")
    for row in rows:
        text.write(",".join(f'"{v}"' for v in row) + "\n")
    return gzip.compress(text.getvalue().encode("utf-8"), mtime=0)


def game(ident, code, season, day, home, away):
    return [ident, code, season, "1. Matchday", day, home, away, "1", "0", f"club {home}", f"club {away}", "domestic_league"]


def appearance(ident, player, club, day, name, code, yellow="0", red="0", goals="0", assists="0", minutes="90"):
    return [f"{ident}_{player}", ident, player, club, club, day, name, code, yellow, red, goals, assists, minutes]


def fixture(games=None, appearances=None, clubs=None):
    """{file name: its rows}: Ligue 1 2015/16 (two games), the Premier League 2020/21 (one), and what is ignored: Ligue 1
    2011/12 and 2021/22, Ligue 2 (FR2) and the Champions League (CL) of 2015/16."""
    return {
        "games": games if games is not None else [
            game("1", "FR1", "2015", "2015-08-07", "1082", "583"),
            game("2", "FR1", "2015", "2016-01-10", "583", "244"),
            game("3", "FR1", "2011", "2012-01-01", "583", "1082"),
            game("4", "FR2", "2015", "2015-09-01", "583", "244"),
            game("5", "GB1", "2020", "2020-09-12", "11", "631"),
            game("6", "CL", "2015", "2015-10-01", "583", "11"),
            game("7", "FR1", "2021", "2021-08-08", "583", "244"),
        ],
        "appearances": appearances if appearances is not None else [
            appearance("1", "3455", "583", "2015-08-07", "Zlatan Ibrahimovic", "FR1", yellow="1", goals="1"),
            appearance("2", "3455", "583", "2016-01-10", "Zlatan Ibrahimović", "FR1", goals="2", assists="1", minutes="80"),
            appearance("3", "3455", "583", "2012-01-01", "Zlatan Ibrahimović", "FR1", goals="1"),
            appearance("4", "3455", "583", "2015-09-01", "Zlatan Ibrahimović", "FR2", goals="4"),
            appearance("6", "3455", "583", "2015-10-01", "Zlatan Ibrahimović", "CL", goals="2"),
            appearance("7", "3455", "583", "2021-08-08", "Zlatan Ibrahimović", "FR1", goals="1"),
            # A player of two clubs in one season: Lille, then Marseille.
            appearance("1", "5000", "1082", "2015-08-07", "Mover", "FR1", red="1", minutes="61"),
            appearance("2", "5000", "244", "2016-01-10", "Mover Jr.", "FR1", assists="2", minutes="90"),
            appearance("5", "7000", "11", "2020-09-12", "Gunner", "GB1", goals="1"),
            appearance("5", "7001", "631", "2020-09-12", "Blue", "GB1", minutes="1"),
            # A malformed number in an ignored game: never read.
            appearance("4", "9999", "244", "2015-09-01", "Ignored", "FR2", goals="x"),
        ],
        "clubs": clubs if clubs is not None else [
            ["583", "paris-saint-germain", "Paris Saint-Germain", "FR1"], ["1082", "losc-lille", "LOSC Lille", "FR1"],
            ["244", "olympique-marseille", "Olympique Marseille", "FR1"], ["11", "fc-arsenal", "Arsenal FC", "GB1"],
            ["631", "fc-chelsea", "Chelsea FC", "GB1"], ["12", "as-rom", "Associazione Sportiva Roma", "IT1"],
        ],
    }


def files(rows=None, headers=None):
    rows = rows or fixture()
    headers = {"games": GAMES, "appearances": APPEARANCES, "clubs": CLUBS, **(headers or {})}
    return {name: gz(headers[name], rows[name]) for name in ("games", "appearances", "clubs")}


def pins(bodies):
    return {name: hashlib.sha256(body).hexdigest() for name, body in bodies.items()}


# (code, season, player key, player name, club key, club name, matches, minutes, goals, assists, yellow, red)
EXPECTED = [
    ("FR1", 2015, "3455", "Zlatan Ibrahimović", "583", "Paris Saint-Germain", 2, 170, 3, 1, 1, 0),
    ("FR1", 2015, "5000", "Mover", "1082", "LOSC Lille", 1, 61, 0, 0, 0, 1),
    ("FR1", 2015, "5000", "Mover Jr.", "244", "Olympique Marseille", 1, 90, 0, 2, 0, 0),
    ("GB1", 2020, "7000", "Gunner", "11", "Arsenal FC", 1, 90, 1, 0, 0, 0),
    ("GB1", 2020, "7001", "Blue", "631", "Chelsea FC", 1, 1, 0, 0, 0, 0),
]
FIELDS = ("code", "season_id", "player_key", "player_name", "club_key", "club_name", "matches", "minutes", "goals", "assists",
          "yellow_cards", "red_cards")


def flat(rows):
    return sorted(tuple(row[f] for f in FIELDS) for row in rows)


class Files:
    """The three files as a run fetches them, and what it asked for: (file, as bytes, size cap)."""

    def __init__(self, bodies):
        self.bodies, self.calls = bodies, []

    def __call__(self, url, *, as_text=False, as_bytes=False, headers=None, max_bytes=None):
        name = url.rsplit("/", 1)[1].removesuffix(".csv.gz")
        self.calls.append((name, as_bytes, max_bytes))
        if name not in self.bodies:
            raise SourceError("HTTP_404")
        return self.bodies[name]


class PureTest(unittest.TestCase):
    def test_rows_are_the_five_leagues_and_nine_seasons_per_player_and_club(self):
        self.assertEqual(flat(tm_history.aggregate(files())), EXPECTED)

    def test_the_scope_and_the_source(self):
        self.assertEqual(tm_history.scopes(NOW), {"league_player_seasons": timedelta(days=7)})
        self.assertIs(sources.adapters()["transfermarkt"], tm_history)
        self.assertEqual(tm_history.LEAGUES, {"GB1": "l_4WFCIZ", "ES1": "l_0ErfuF", "L1": "l_1Isor4", "IT1": "l_0ALvwF", "FR1": "l_3FJFUl"})
        self.assertEqual((tm_history.FIRST_SEASON, tm_history.LAST_SEASON), (2012, 2020))
        self.assertEqual(sorted(tm_history.FILES), ["appearances", "clubs", "games"])
        self.assertTrue(all(len(pin) == 64 for pin in tm_history.FILES.values()))
        self.assertIn("CC0-1.0", tm_history.ATTRIBUTION["license"])
        self.assertEqual(tm_history.ATTRIBUTION["name"], "transfermarkt-datasets (dcaribou)")

    def test_malformed_values_refuse_the_read(self):
        base = fixture()

        def changed(index, column, value):
            rows = fixture()
            rows["appearances"][index] = list(rows["appearances"][index])
            rows["appearances"][index][APPEARANCES.index(column)] = value
            return rows

        cases = {
            "goals 1.5": changed(0, "goals", "1.5"), "goals empty": changed(0, "goals", ""), "goals -1": changed(0, "goals", "-1"),
            "assists x": changed(1, "assists", "x"), "minutes 999": changed(1, "minutes_played", "999"),
            "red cards 9": changed(6, "red_cards", "9"), "player id": changed(0, "player_id", "34a5"),
            "club not a side": changed(0, "player_club_id", "631"),
            "competition differs from the game's": changed(0, "competition_id", "FR2"),
            "two appearances in one game": {**base, "appearances": base["appearances"] + [base["appearances"][0]]},
            "club missing": {**base, "clubs": [c for c in base["clubs"] if c[0] != "244"]},
            "game listed twice": {**base, "games": base["games"] + [base["games"][0]]},
            "season not a year": {**base, "games": [game("1", "FR1", "20x5", "2015-08-07", "1082", "583")] + base["games"][1:]},
            "game club id": {**base, "games": [game("1", "FR1", "2015", "2015-08-07", "1082", "PSG")] + base["games"][1:]},
            "a game against itself": {**base, "games": [game("1", "FR1", "2015", "2015-08-07", "583", "583")] + base["games"][1:]},
            "empty player name": changed(0, "player_name", " "),
        }
        for name, rows in cases.items():
            with self.subTest(name), self.assertRaises(SourceError) as error:
                tm_history.aggregate(files(rows))
            self.assertEqual(error.exception.code, "INVALID_SOURCE", name)
        for name, header in (("no goals column", [c for c in APPEARANCES if c != "goals"]),):
            rows = fixture()
            rows["appearances"] = [[v for c, v in zip(APPEARANCES, r) if c != "goals"] for r in rows["appearances"]]
            with self.subTest(name), self.assertRaises(SourceError) as error:
                tm_history.aggregate(files(rows, {"appearances": header}))
            self.assertEqual(error.exception.code, "INVALID_SOURCE")
        with self.subTest("not gzip"), self.assertRaises(SourceError) as error:
            tm_history.aggregate({**files(), "games": b"game_id\n1\n"})
        self.assertEqual(error.exception.code, "INVALID_SOURCE")

    def test_files_are_the_pinned_ones_each_with_its_size_cap(self):
        bodies = files()
        get = Files(bodies)
        self.assertEqual(tm_history.fetch(get, pins(bodies)), bodies)
        self.assertTrue(all(as_bytes for _, as_bytes, _ in get.calls))
        caps = {name: cap for name, _, cap in get.calls}
        self.assertEqual(sorted(caps), ["appearances", "clubs", "games"])
        self.assertEqual(caps["appearances"], 64 * 1024 * 1024)
        self.assertTrue(all(cap and len(bodies[name]) <= cap for name, cap in caps.items()))
        # The small files first: a file that differs stops the reading there, before the 45 MB one.
        self.assertEqual([name for name, _, _ in get.calls], ["games", "clubs", "appearances"])
        other = dict(pins(bodies), games="0" * 64)
        get = Files(bodies)
        with self.assertRaises(SourceError) as error:
            tm_history.fetch(get, other)
        self.assertEqual(error.exception.code, "SOURCE_CHANGED")
        self.assertEqual([name for name, _, _ in get.calls], ["games"])

    def test_the_client_caps_a_body_at_8_mb_unless_told_otherwise(self):
        class Response(io.BytesIO):
            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

        class Opener:
            def __init__(self, size):
                self.size = size

            def open(self, request, timeout=None):
                return Response(b"x" * self.size)

        nine = 9 * 1024 * 1024
        with mock.patch.object(http, "build_opener", lambda *handlers: Opener(nine)):
            get = http.json_getter(sleep=lambda s: None)
            with self.assertRaises(SourceError) as error:
                get("https://example.org/a.csv.gz", as_bytes=True)
            self.assertEqual(error.exception.code, "TOO_LARGE")
            self.assertEqual(len(get("https://example.org/a.csv.gz", as_bytes=True, max_bytes=64 * 1024 * 1024)), nine)
            with self.assertRaises(SourceError) as error:
                get("https://example.org/a.csv.gz", as_bytes=True, max_bytes=nine - 1)
            self.assertEqual(error.exception.code, "TOO_LARGE")
        self.assertEqual(http.MAX_BYTES, 8 * 1024 * 1024)


@required(DSN and psycopg, "requires disposable local DB (VEGA_V2_TM_HISTORY_TEST_DSN, vega_v2_tm_history_test) and psycopg")
class LoadTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        target = urlparse(DSN)
        if target.hostname not in ("localhost", "127.0.0.1", "::1") or target.path != "/vega_v2_tm_history_test":
            raise RuntimeError("dedicated local DB vega_v2_tm_history_test required")
        cls.db = fresh(DSN)
        x = cls.db.execute
        x("""INSERT INTO core.competitions(id, name) VALUES (1, 'Premier League'), (2, 'LaLiga'), (3, 'Bundesliga'), (4, 'Serie A'),
             (5, 'Ligue 1'), (6, 'Eredivisie')""")
        x("""INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES
             ('competition', 'pitchapi', 'l_4WFCIZ', 1), ('competition', 'pitchapi', 'l_0ErfuF', 2), ('competition', 'pitchapi', 'l_1Isor4', 3),
             ('competition', 'pitchapi', 'l_0ALvwF', 4), ('competition', 'pitchapi', 'l_3FJFUl', 5), ('competition', 'pitchapi', 'l_eredivisie', 6)""")
        x("INSERT INTO core.players(id, name) VALUES (101, 'Zlatan Ibrahimović'), (102, 'Mover'), (103, 'Gunner')")
        x("INSERT INTO core.teams(id, name) VALUES (201, 'Paris Saint-Germain'), (202, 'Olympique de Marseille'), (203, 'Arsenal')")
        x("""INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id, is_current) VALUES
             ('player', 'transfermarkt', '3455', 101, true), ('player', 'transfermarkt', '5000', 102, false),
             ('team', 'transfermarkt', '583', 201, true), ('team', 'transfermarkt', '244', 202, true)""")

    @classmethod
    def tearDownClass(cls):
        cls.db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        cls.db.close()

    def table(self):
        return sorted(self.db.execute(
            """SELECT p.provider_key, l.season_id, l.player_key, l.player_name, l.club_key, l.club_name, l.matches, l.minutes, l.goals,
                      l.assists, l.yellow_cards, l.red_cards, l.player_id, l.team_id
               FROM core.league_player_seasons l
               LEFT JOIN core.provider_ids p ON p.entity_type = 'competition' AND p.provider = 'pitchapi' AND p.entity_id = l.competition_id""").fetchall())

    def expected(self, links):
        keys = {"FR1": "l_3FJFUl", "GB1": "l_4WFCIZ"}
        return sorted((keys[r[0]], *r[1:], *links[(r[2], r[4])]) for r in EXPECTED)

    def run_due(self, get, at):
        self.db.execute("SET LOCAL ROLE vega_collect")
        try:
            return sources.run_due(self.db, get, at, names={"transfermarkt"})
        finally:
            self.db.execute("RESET ROLE")

    def status(self):
        return self.db.execute("SELECT rows_written, unmatched, status, error_code FROM ops.source_runs WHERE source='transfermarkt' AND scope='league_player_seasons'").fetchone()

    def test_load_link_rerun_refusals_and_replacement(self):
        x = self.db.execute
        bodies = files()
        with self.db.transaction(force_rollback=True), mock.patch.object(tm_history, "FILES", pins(bodies)):
            # A first run reads the three files and writes the five rows; Zlatan (a current link) and PSG, Marseille are linked;
            # Mover's link is not current: not used.
            get = Files(bodies)
            self.assertEqual(self.run_due(get, NOW), {RUN: "ok"})
            self.assertEqual(sorted(name for name, _, _ in get.calls), ["appearances", "clubs", "games"])
            first = {("3455", "583"): (101, 201), ("5000", "1082"): (None, None), ("5000", "244"): (None, 202),
                     ("7000", "11"): (None, None), ("7001", "631"): (None, None)}
            self.assertEqual(self.table(), self.expected(first))
            self.assertEqual(self.status(), (5, 4, "ok", None))
            name, url, licence, revision, digest, coverage = x(
                "SELECT name, url, license, revision, archive_sha256, coverage FROM core.source_revisions WHERE source = 'transfermarkt-datasets'").fetchone()
            self.assertEqual((name, url), ("transfermarkt-datasets (dcaribou)", "https://github.com/dcaribou/transfermarkt-datasets"))
            self.assertIn("CC0-1.0", licence)
            self.assertEqual(revision, digest[:16])
            self.assertIn("2012/13", coverage)
            # Nothing of the base's players, teams or competitions changed.
            self.assertEqual(x("SELECT count(*) FROM core.players").fetchone()[0], 3)

            # The same revision: no file read. A link made since (Gunner) is picked up; Zlatan's link no longer current is undone.
            x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('player', 'transfermarkt', '7000', 103)")
            x("UPDATE core.provider_ids SET is_current = false WHERE entity_type = 'player' AND provider_key = '3455'")
            self.assertIsNone(tm_history.prepare(self.db, Files({}), "league_player_seasons", NOW))
            get = Files({})
            self.assertEqual(self.run_due(get, NOW + timedelta(days=8)), {RUN: "ok"})
            self.assertEqual(get.calls, [])
            second = {**first, ("3455", "583"): (None, 201), ("7000", "11"): (103, None)}
            self.assertEqual(self.table(), self.expected(second))
            self.assertEqual(self.status(), (0, 4, "ok", None))
            x("UPDATE core.provider_ids SET is_current = true WHERE entity_type = 'player' AND provider_key = '3455'")

            # A removed player or team leaves the row, unlinked.
            with self.db.transaction(force_rollback=True):
                x("DELETE FROM core.provider_ids WHERE entity_type = 'player' AND entity_id = 103")
                x("DELETE FROM core.players WHERE id = 103")
                x("DELETE FROM core.provider_ids WHERE entity_type = 'team' AND entity_id = 202")
                x("DELETE FROM core.teams WHERE id = 202")
                self.assertEqual(len(self.table()), 5)
                self.assertEqual(x("SELECT player_id, team_id FROM core.league_player_seasons WHERE player_key IN ('7000', '5000') ORDER BY club_key").fetchall(),
                                 [(None, None), (None, None), (None, None)])

            # A new revision whose games file is not the pinned one: SOURCE_CHANGED, the rows stay.
            before = self.table()
            changed = files({**fixture(), "games": fixture()["games"][:2]})
            with mock.patch.object(tm_history, "FILES", dict(pins(bodies), games="0" * 64)):
                self.assertEqual(self.run_due(Files(changed), NOW + timedelta(days=24)), {RUN: "SOURCE_CHANGED"})
            self.assertEqual(self.table(), before)
            self.assertEqual(self.status()[2:], ("error", "SOURCE_CHANGED"))

            # A malformed file (pinned as it is): INVALID_SOURCE, the rows stay.
            rows = fixture()
            rows["appearances"][0] = list(rows["appearances"][0])
            rows["appearances"][0][APPEARANCES.index("goals")] = "1.0"
            bad = files(rows)
            with mock.patch.object(tm_history, "FILES", pins(bad)):
                self.assertEqual(self.run_due(Files(bad), NOW + timedelta(days=32)), {RUN: "INVALID_SOURCE"})
            self.assertEqual(self.table(), before)

            # A league the base does not hold: COMPETITION_UNKNOWN, the rows stay.
            with self.db.transaction(force_rollback=True):
                x("DELETE FROM core.provider_ids WHERE entity_type = 'competition' AND provider_key = 'l_4WFCIZ'")
                newer = files({**fixture(), "appearances": fixture()["appearances"][:1]})
                with mock.patch.object(tm_history, "FILES", pins(newer)):
                    self.assertEqual(self.run_due(Files(newer), NOW + timedelta(days=40)), {RUN: "COMPETITION_UNKNOWN"})
                self.assertEqual(x("SELECT count(*) FROM core.league_player_seasons").fetchone()[0], 5)

            # A new revision replaces the five leagues' rows of 2012–2020, and those only: a row of another league stays.
            x("""INSERT INTO core.league_player_seasons(competition_id, season_id, player_key, player_name, club_key, club_name,
                   matches, minutes, goals, assists, yellow_cards, red_cards) VALUES (6, 2015, '1', 'Other', '1', 'Ajax', 1, 90, 0, 0, 0, 0)""")
            newer = files({**fixture(), "appearances": fixture()["appearances"][:2]})
            with mock.patch.object(tm_history, "FILES", pins(newer)):
                self.assertEqual(self.run_due(Files(newer), NOW + timedelta(days=48)), {RUN: "ok"})
            self.assertEqual(self.table(), sorted([
                ("l_3FJFUl", 2015, "3455", "Zlatan Ibrahimović", "583", "Paris Saint-Germain", 2, 170, 3, 1, 1, 0, 101, 201),
                ("l_eredivisie", 2015, "1", "Other", "1", "Ajax", 1, 90, 0, 0, 0, 0, None, None)]))
            self.assertEqual(self.status(), (1, 0, "ok", None))
            self.assertEqual(x("SELECT revision FROM core.source_revisions WHERE source = 'transfermarkt-datasets'").fetchone()[0],
                             tm_history.digest(pins(newer))[:16])

    def test_the_table_refuses_negative_totals_and_reads_as_the_api_owner(self):
        x = self.db.execute
        with self.db.transaction(force_rollback=True):
            with self.assertRaises(psycopg.errors.CheckViolation), self.db.transaction():
                x("""INSERT INTO core.league_player_seasons(competition_id, season_id, player_key, player_name, club_key, club_name,
                       matches, minutes, goals, assists, yellow_cards, red_cards) VALUES (5, 2015, '1', 'A', '1', 'B', 1, -1, 0, 0, 0, 0)""")
            with self.assertRaises(psycopg.errors.CheckViolation), self.db.transaction():
                x("""INSERT INTO core.league_player_seasons(competition_id, season_id, player_key, player_name, club_key, club_name,
                       matches, minutes, goals, assists, yellow_cards, red_cards) VALUES (5, 2011, '1', 'A', '1', 'B', 1, 1, 0, 0, 0, 0)""")
            owner = x("SELECT nspowner::regrole::text FROM pg_namespace WHERE nspname = 'api'").fetchone()[0]
            self.assertTrue(x("SELECT has_table_privilege(%s, 'core.league_player_seasons', 'SELECT')", (owner,)).fetchone()[0])
            for privilege in ("SELECT", "INSERT", "UPDATE", "DELETE"):
                self.assertTrue(x("SELECT has_table_privilege('vega_collect', 'core.league_player_seasons', %s)", (privilege,)).fetchone()[0])
            self.assertFalse(x("SELECT has_table_privilege('vega_read', 'core.league_player_seasons', 'SELECT')").fetchone()[0])


if __name__ == "__main__":
    unittest.main()
