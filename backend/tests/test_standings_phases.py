"""Veikkausliiga 2026: three phase tables served as one (FAILURE_MODES.md §43.1, 43a–43i), end to end on a disposable
PostgreSQL: the captured SportScore answer through `sources.run_due` under `vega_collect`, the rows production stores
through `GET /api/standings` under `vega_read` (tests/read_http.mjs), migration 159 applied over them, and the 47
SportScore answers production served on 19 November 2026 replayed through the writer's and the reader's rules.

Written before the correction. Failure modes: rows of three phases (ranks 1,1,1,2,2,…, at 22, 27 and 32 matches) served
as the edition's official table; a withheld current edition falling through to the previous season's table; an
admissible table (equal points sharing a rank, groups each ranked from 1) withheld by a rule stricter than the writer's.
"""

from datetime import datetime, timezone
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import unittest
from unittest.mock import patch
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from prerequisites import required  # noqa: E402
from vega import sources  # noqa: E402
from vega.sources import SourceError, sportscore  # noqa: E402
from template_base import fresh  # noqa: E402

try:
    import psycopg
except ImportError:
    psycopg = None
DSN = os.environ.get("VEGA_V2_CLASSEMENTS_TEST_DSN")
FIXTURES = ROOT / "tests" / "fixtures" / "sportscore"
PRODUCTION = json.loads((FIXTURES / "production-standings-2026-11-19.json").read_text(encoding="utf-8"))["answers"]
WIDGET = json.loads((FIXTURES / "veikkausliiga-widget-2026-11-19.json").read_text(encoding="utf-8"))["answer"]
SERVED = next(a for a in PRODUCTION if a["league"] == "l_3Ci5Cg")
KEY = "l_3Ci5Cg"
SCOPE = "standings:" + KEY
NOW = datetime(2026, 11, 19, 17, 26, 9, tzinfo=timezone.utc)
EDITION, PREVIOUS = 3026, 3025
NODE_READY = bool(shutil.which("node")) and (ROOT / "api" / "node_modules" / "pg").is_dir()
# The clubs of the served table: Vega's id, its name and public id as production serves them.
CLUBS = {301 + n: (r["name"], r["id"]) for n, r in enumerate(SERVED["tables"][0]["rows"])}
BY_KEY = {key: team for team, (_, key) in CLUBS.items()}


def widget_tables(answer):
    """A served answer as the widget's body (sportscore.parse's input)."""
    return {"sport": "football", "competition_slug": "x", "tables": [
        {"group": t["name"], "rows": [{"team": r["name"], "pos": r["position"], "p": r["played"], "w": r["wins"], "d": r["draws"],
                                        "l": r["losses"], "gf": r["goalsFor"], "ga": r["goalsAgainst"], "pts": r["points"]}
                                       for r in t["rows"]]} for t in answer["tables"]]}


def statements(upto=None, start=None):
    """The migrations' texts in order, from `start` (included) to `upto` (excluded)."""
    files = sorted(p for p in (ROOT / "sql").glob("*.sql") if "vector_optional" not in p.name)
    return [p.read_text(encoding="utf-8") for p in files if (start is None or p.name >= start) and (upto is None or p.name < upto)]


def build(db):
    from vega.store import Store

    x = db.execute
    with db.transaction():
        for label in ("2025/2026", "2026/2027"):
            Store(db).season(label)
        x("INSERT INTO core.countries(code) VALUES ('FIN') ON CONFLICT DO NOTHING")
        x("INSERT INTO core.competitions(id, name, kind, country_code) VALUES (30, 'Veikkausliiga', 'league', 'FIN')")
        x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('competition', 'pitchapi', %s, 30)", (KEY,))
        x("""INSERT INTO core.competition_seasons(id, competition_id, season_id, native_label, is_current)
             VALUES (%s, 30, 2025, '2025', false), (%s, 30, 2026, '2026', true)""", (PREVIOUS, EDITION))
        for team, (name, key) in CLUBS.items():
            x("INSERT INTO core.teams(id, name, country_code) VALUES (%s, %s, 'FIN')", (team, name))
            x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('team', 'pitchapi', %s, %s)", (key, team))
            x("INSERT INTO core.team_seasons(team_id, competition_season_id) VALUES (%s, %s), (%s, %s)", (team, PREVIOUS, team, EDITION))
        # 2025: Vega's own table, ranks 1-12 (the previous season, which a withheld 2026 must not fall through to).
        for n, team in enumerate(CLUBS, 1):
            x("""INSERT INTO agg.standings(competition_season_id, stage, group_name, team_id, position, played, won, drawn, lost,
                   goals_for, goals_against, points, updated_at)
                 VALUES (%s, NULL, NULL, %s, %s, 22, 0, 22, 0, 10, 10, 22, '2025-11-01T00:00Z')""", (PREVIOUS, team, n))
        # 2026: the rows production stores, as the writer before 10:05 UTC wrote them (no basis).
        for r in SERVED["tables"][0]["rows"]:
            x("""INSERT INTO core.standings_official(competition_season_id, stage, group_name, team_id, position, played, won, drawn, lost,
                   goals_for, goals_against, points, source, as_of)
                 VALUES (%s, NULL, NULL, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'sportscore', %s)""",
              (EDITION, BY_KEY[r["id"]], r["position"], r["played"], r["wins"], r["draws"], r["losses"], r["goalsFor"],
               r["goalsAgainst"], r["points"], SERVED["fetchedAt"]))
        x("INSERT INTO ops.resource_versions(resource_kind, resource_id) VALUES ('competition_season', %s), ('competition_season', %s)",
          (PREVIOUS, EDITION))


def http(paths):
    done = subprocess.run([shutil.which("node"), str(ROOT / "tests" / "read_http.mjs"), DSN,
                           json.dumps([{"path": p} for p in paths])], capture_output=True, text=True, timeout=120)
    if done.returncode:
        raise AssertionError(done.stderr)
    return json.loads(done.stdout.strip().splitlines()[-1])


def official(db):
    return db.execute("""SELECT team_id, position, played, points, as_of, basis FROM core.standings_official
                         WHERE competition_season_id = %s ORDER BY team_id""", (EDITION,)).fetchall()


def version(db, edition=EDITION):
    return db.execute("SELECT version FROM ops.resource_versions WHERE resource_kind = 'competition_season' AND resource_id = %s",
                      (edition,)).fetchone()[0]


class ReplayedRules(unittest.TestCase):
    """43i, the writer's half: the 47 answers through sportscore.parse and check, no database."""

    def test_43i_the_writer_admits_46_answers_and_refuses_the_mixed_table_and_the_widget(self):
        refused = {}
        for answer in PRODUCTION:
            try:
                sportscore.check(sportscore.parse(widget_tables(answer), "x"))
            except SourceError as error:
                refused[answer["league"]] = error.code
        self.assertEqual(len(PRODUCTION), 47)
        self.assertEqual(refused, {KEY: "DUPLICATE_POSITION"})
        with self.assertRaises(SourceError) as caught:
            sportscore.check(sportscore.parse(WIDGET, "finnish-veikkausliiga"))
        self.assertEqual(caught.exception.code, "DUPLICATE_GROUP")
        self.assertIn("3 tables without a name", caught.exception.detail)


@required(DSN and psycopg and NODE_READY, "requires VEGA_V2_CLASSEMENTS_TEST_DSN, psycopg, node and backend/api/node_modules")
class VeikkausliigaPhases(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        target = urlparse(DSN)
        if target.hostname not in ("localhost", "127.0.0.1", "::1") or target.path != "/vega_v2_classements_test":
            raise RuntimeError("dedicated local test DB required")
        cls.db = fresh(DSN)
        build(cls.db)

    @classmethod
    def tearDownClass(cls):
        cls.db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        cls.db.close()

    def test_43a_the_captured_answer_is_refused_and_the_stored_rows_stay(self):
        from vega.store import connect_local

        before, stamp = official(self.db), version(self.db)
        calls = []

        def get(url):
            calls.append(url)
            return json.loads(json.dumps(WIDGET))

        with connect_local(DSN) as collect:
            collect.execute("SET ROLE vega_collect")
            with patch.object(sportscore, "scopes", lambda _: {SCOPE: sportscore.PERIOD}):
                outcome = sources.run_due(collect, get, NOW, names={"sportscore"})[("sportscore", SCOPE)]
        self.assertEqual(calls, [sportscore.URL + "?sport=football&slug=finnish-veikkausliiga"])
        self.assertEqual(outcome, "DUPLICATE_GROUP")
        self.assertEqual(official(self.db), before)
        self.assertEqual(version(self.db), stamp)
        code, message = self.db.execute("SELECT error_code, message FROM ops.parse_failures ORDER BY id DESC LIMIT 1").fetchone()
        self.assertEqual(code, "DUPLICATE_GROUP")
        self.assertIn("3 tables without a name", message)

    def test_43b_the_mixed_rows_are_not_served_nor_the_previous_season(self):
        current, by_season, previous = http([f"/api/standings?competition={KEY}", f"/api/standings?competition={KEY}&season=2026",
                                             f"/api/standings?competition={KEY}&season=2025"])
        self.assertEqual((current["status"], by_season["status"]), (404, 404), current["body"])
        self.assertNotIn("tables", json.dumps(current["body"]))
        self.assertEqual((previous["status"], previous["body"]["source"], previous["body"]["season"]), (200, "Vega", "2025"))
        self.assertEqual([r[0] for r in self.db.execute("SELECT competition_season_id FROM api.standings_rank_conflicts()")], [EDITION])

    def test_43c_vega_table_of_the_edition_is_served_instead(self):
        try:
            with self.db.transaction():
                for n, team in enumerate(CLUBS, 1):
                    self.db.execute("""INSERT INTO agg.standings(competition_season_id, stage, group_name, team_id, position, played, won, drawn,
                                         lost, goals_for, goals_against, points, updated_at)
                                       VALUES (%s, NULL, NULL, %s, %s, 1, 1, 0, 0, 1, 0, 3, %s)""", (EDITION, team, n, NOW))
            [served] = http([f"/api/standings?competition={KEY}"])
            self.assertEqual((served["status"], served["body"]["source"], served["body"]["season"]), (200, "Vega", "2026"))
            self.assertEqual([r["position"] for r in served["body"]["tables"][0]["rows"]], list(range(1, 13)))
        finally:
            with self.db.transaction():
                self.db.execute("DELETE FROM agg.standings WHERE competition_season_id = %s", (EDITION,))

    def _with(self, sql, args=()):
        """Run `sql` over the stored rows, read the route, then put the production rows back."""
        try:
            with self.db.transaction():
                self.db.execute(sql, args)
            return http([f"/api/standings?competition={KEY}"])[0], [r[0] for r in self.db.execute(
                "SELECT competition_season_id FROM api.standings_rank_conflicts()")]
        finally:
            with self.db.transaction():
                for r in SERVED["tables"][0]["rows"]:
                    self.db.execute("""UPDATE core.standings_official SET position = %s, points = %s, group_name = NULL
                                       WHERE competition_season_id = %s AND team_id = %s""", (r["position"], r["points"], EDITION, BY_KEY[r["id"]]))

    def test_43d_the_same_rows_ranked_1_to_12_are_served(self):
        served, withheld = self._with("""UPDATE core.standings_official o SET position = r.n FROM (
                                           SELECT team_id, row_number() OVER (ORDER BY points DESC, team_id) AS n FROM core.standings_official
                                           WHERE competition_season_id = %s) r WHERE o.competition_season_id = %s AND o.team_id = r.team_id""",
                                      (EDITION, EDITION))
        self.assertEqual(withheld, [])
        self.assertEqual((served["status"], served["body"]["source"], served["body"]["fetchedAt"]), (200, "SportScore", SERVED["fetchedAt"]))

    def test_43e_equal_points_sharing_a_rank_and_groups_ranked_from_one_are_served(self):
        # Every club 30 points; ranks 1, 1, 3, 3, ... (equal points share a rank).
        served, withheld = self._with("""UPDATE core.standings_official o SET points = 30, position = 2 * ((r.n - 1) / 2) + 1 FROM (
                                           SELECT team_id, row_number() OVER (ORDER BY team_id) AS n FROM core.standings_official
                                           WHERE competition_season_id = %s) r WHERE o.competition_season_id = %s AND o.team_id = r.team_id""",
                                      (EDITION, EDITION))
        self.assertEqual((withheld, served["status"], served["body"]["source"]), ([], 200, "SportScore"))
        # Two groups of six, each ranked 1-6.
        served, withheld = self._with("""UPDATE core.standings_official o SET group_name = CASE WHEN r.n <= 6 THEN 'A' ELSE 'B' END,
                                           position = (r.n - 1) %% 6 + 1, points = 40 - r.n FROM (
                                           SELECT team_id, row_number() OVER (ORDER BY team_id) AS n FROM core.standings_official
                                           WHERE competition_season_id = %s) r WHERE o.competition_season_id = %s AND o.team_id = r.team_id""",
                                      (EDITION, EDITION))
        self.assertEqual((withheld, served["status"], [t["name"] for t in served["body"]["tables"]]), ([], 200, ["A", "B"]))

    def test_43f_a_rank_shared_at_different_points_inside_one_group_is_withheld(self):
        served, withheld = self._with("""UPDATE core.standings_official o SET group_name = CASE WHEN r.n <= 6 THEN 'A' ELSE 'B' END,
                                           position = least((r.n - 1) %% 6 + 1, 5), points = 40 - r.n FROM (
                                           SELECT team_id, row_number() OVER (ORDER BY team_id) AS n FROM core.standings_official
                                           WHERE competition_season_id = %s) r WHERE o.competition_season_id = %s AND o.team_id = r.team_id""",
                                      (EDITION, EDITION))
        self.assertEqual((withheld, served["status"]), ([EDITION], 404))

    def test_43g_a_single_table_missing_a_rank_is_withheld(self):
        served, withheld = self._with("""UPDATE core.standings_official o SET position = CASE WHEN r.n = 12 THEN 13 ELSE r.n END FROM (
                                           SELECT team_id, row_number() OVER (ORDER BY points DESC, team_id) AS n FROM core.standings_official
                                           WHERE competition_season_id = %s) r WHERE o.competition_season_id = %s AND o.team_id = r.team_id""",
                                      (EDITION, EDITION))
        self.assertEqual((withheld, served["status"]), ([EDITION], 404))

    def test_43i_the_reader_withholds_only_the_mixed_table_of_the_47(self):
        try:
            with self.db.transaction():
                for n, answer in enumerate(PRODUCTION, 1):
                    edition, competition = 40000 + n, 4000 + n
                    self.db.execute("INSERT INTO core.competitions(id, name, kind) VALUES (%s, %s, 'league')", (competition, answer["competition"]))
                    self.db.execute("""INSERT INTO core.competition_seasons(id, competition_id, season_id, native_label, is_current)
                                       VALUES (%s, %s, 2026, %s, true)""", (edition, competition, answer["season"]))
                    keep = len(answer["tables"]) > 1
                    for t, table in enumerate(answer["tables"]):
                        for r, row in enumerate(table["rows"]):
                            team = 1000000 + 10000 * n + 100 * t + r
                            self.db.execute("INSERT INTO core.teams(id, name) VALUES (%s, %s)", (team, row["name"]))
                            self.db.execute("""INSERT INTO core.standings_official(competition_season_id, stage, group_name, team_id, position, played,
                                                 won, drawn, lost, goals_for, goals_against, points, source, as_of)
                                               VALUES (%s, NULL, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'sportscore', %s)""",
                                            (edition, table["name"] if keep else None, team, row["position"], row["played"], row["wins"],
                                             row["draws"], row["losses"], row["goalsFor"], row["goalsAgainst"], row["points"], answer["fetchedAt"]))
            withheld = [r[0] for r in self.db.execute(
                "SELECT competition_season_id FROM api.standings_rank_conflicts() WHERE competition_season_id > 40000")]
            self.assertEqual(withheld, [40000 + 1 + next(i for i, a in enumerate(PRODUCTION) if a["league"] == KEY)])
        finally:
            with self.db.transaction():
                self.db.execute("DELETE FROM core.standings_official WHERE competition_season_id > 40000")
                self.db.execute("DELETE FROM core.competition_seasons WHERE id > 40000")
                self.db.execute("DELETE FROM core.teams WHERE id >= 1000000")
                self.db.execute("DELETE FROM core.competitions WHERE id > 4000")


@required(DSN and psycopg, "requires VEGA_V2_CLASSEMENTS_TEST_DSN and psycopg")
class MigrationOverStoredRows(unittest.TestCase):
    """43h: 159 applied over a base that holds production's rows raises the edition's version once."""

    def test_43h_159_raises_the_withheld_edition_version(self):
        from vega.store import connect_local

        target = urlparse(DSN)
        if target.hostname not in ("localhost", "127.0.0.1", "::1") or target.path != "/vega_v2_classements_test":
            raise RuntimeError("dedicated local test DB required")
        with connect_local(DSN) as db:
            db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
            try:
                for text in statements(upto="159"):
                    with db.transaction():
                        db.execute(text)
                build(db)
                before = (version(db), version(db, PREVIOUS))
                for text in statements(start="159"):
                    with db.transaction():
                        db.execute(text)
                self.assertEqual((version(db), version(db, PREVIOUS)), (before[0] + 1, before[1]))
            finally:
                db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")


if __name__ == "__main__":
    unittest.main()
