"""The deployment's migrations from production's schema (docs/calculs/09-audit-2026-11/FAILURE_MODES.md §48, 48j–48l,
written before these tests).

Production since 20 Nov 2026, 01:49 UTC: main bfab25d4ef, `migrations applied=1 total=160` (154 applied). Its files are
those of this tree up to 154 (the merged tree only adds 155, 156, 157, 159 and 160). On a disposable local
PostgreSQL (VEGA_V2_DEPLOY_TEST_DSN, database vega_v2_deploy_test): the real `python -m vega.migrate` of a copy of this
backend holding the files up to 154 only, rows of what 159 and 160 read written then, then the real `python -m
vega.migrate` of this tree, twice. The reads after it under vega_read.
"""

import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
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

DSN = os.environ.get("VEGA_V2_DEPLOY_TEST_DSN")
ADDED = ["155_player_grade_status.sql", "156_team_side_corrections.sql", "157_parse_failures_lookup.sql",
         "159_standings_rank_conflicts.sql", "160_reads_keep_omitted_observations.sql",
         # VI-39 (20 Nov 2026): the reads of the players page's « Remplaçant » and « En forme ».
         "161_player_replacements_and_form.sql",
         # VI-40: what each player brings to his team, for « Remplaçant ».
         "162_player_team_fit.sql",
         # VI-48 (#69): the home's importance v2, its settings and its two windows (api functions, two settings tables).
         "163_home_importance_v2.sql"]
# SportScore editions: A, a rank shared at different points (a version already kept); B, rank 5 in a table of two (no
# version yet); C, a table that holds (its version kept).
A, B, C = 9601, 9602, 9603
# Transfermarkt units (kind, key, error after the last attempt, an episode stored, what 160 leaves of read_at).
UNITS = [
    ("injuries", "70001", "HTTP_404", False, None),  # a first read answered 404 (the earlier reader set read_at)
    ("injuries", "70002", "HTTP_500", False, None),  # an accepted empty list, then a refused refresh: the same rows
    ("injuries", "70003", None, False, "kept"),  # an accepted empty list
    ("injuries", "70004", "HTTP_500", True, "kept"),  # accepted with an episode, then refused
    ("values", "70005", "HTTP_404", False, "kept"),  # another kind
]
NATIONS = (9611, 9612)
FRIENDLY = 9621


def migrate(backend):
    """The production migration task's command, on `backend` (a copy of backend/ with its sql/ and vega/)."""
    env = {k: v for k, v in os.environ.items() if not k.startswith("V2_")}
    env.update(V2_MIGRATION_DATABASE_URL=DSN, PYTHONPATH=str(backend), PYTHONDONTWRITEBYTECODE="1")
    done = subprocess.run([sys.executable, "-m", "vega.migrate"], cwd=backend, env=env, capture_output=True, text=True, timeout=600)
    if done.returncode:
        raise AssertionError(done.stdout + done.stderr)
    return done.stdout.strip().splitlines()[-1]


@required(DSN and psycopg, "requires a disposable local deployment DB (VEGA_V2_DEPLOY_TEST_DSN) and psycopg")
class DeploymentMigrationsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from vega.store import connect_local

        target = urlparse(DSN)
        if target.hostname not in ("localhost", "127.0.0.1", "::1") or target.path != "/vega_v2_deploy_test":
            raise RuntimeError("dedicated local deployment DB required")
        db = cls.db = connect_local(DSN)
        db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        tmp = Path(tempfile.mkdtemp(prefix="vega-deploy-migrations-"))
        cls.addClassCleanup(shutil.rmtree, tmp, True)
        production = tmp / "backend"
        shutil.copytree(ROOT / "vega", production / "vega", ignore=shutil.ignore_patterns("__pycache__"))
        (production / "sql").mkdir()
        names = sorted(p.name for p in (ROOT / "sql").glob("*.sql"))
        cls.production_files = [n for n in names if n < "155"]
        cls.merged_added = [n for n in names if n >= "155"]
        for name in cls.production_files:
            shutil.copyfile(ROOT / "sql" / name, production / "sql" / name)
        cls.at_production = migrate(production)
        cls.seed()
        x = db.execute
        cls.migrations_before = x("SELECT version, checksum, applied_at FROM ops.schema_migrations ORDER BY 1").fetchall()
        cls.versions_before = cls.versions()
        cls.reads_before = cls.reads()
        cls.deployed = migrate(ROOT)
        cls.migrations_after = x("SELECT version, checksum, applied_at FROM ops.schema_migrations ORDER BY 1").fetchall()
        cls.versions_after = cls.versions()
        cls.reads_after = cls.reads()
        cls.again = migrate(ROOT)
        cls.migrations_again = x("SELECT version, checksum, applied_at FROM ops.schema_migrations ORDER BY 1").fetchall()
        cls.read = connect_local(DSN)
        cls.read.execute("SET ROLE vega_read")

    @classmethod
    def tearDownClass(cls):
        cls.read.close()
        cls.db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        cls.db.close()

    @classmethod
    def seed(cls):
        from vega.store import Store

        x = cls.db.execute
        with cls.db.transaction():
            assert Store(cls.db).season("2026/2027") == 2026
            for edition in (A, B, C):
                x("INSERT INTO core.competitions(id, name, kind) VALUES (%s, %s, 'league')", (edition, f"League {edition}"))
                x("INSERT INTO core.competition_seasons(id, competition_id, season_id, native_label) VALUES (%s, %s, 2026, '2026')", (edition, edition))
            for team in range(9601, 9607):
                x("INSERT INTO core.teams(id, name) VALUES (%s, %s)", (team, f"Club {team}"))
            rows = [(A, 9601, 1, 10), (A, 9602, 1, 8), (A, 9603, 3, 5),  # rank 1 shared at 10 and 8 points
                    (B, 9604, 1, 9), (B, 9605, 5, 3),  # rank 5 in a table of two
                    (C, 9601, 1, 9), (C, 9606, 2, 6)]
            for edition, team, position, points in rows:
                x("""INSERT INTO core.standings_official(competition_season_id, stage, group_name, team_id, position, played, won, drawn, lost,
                       goals_for, goals_against, points, source, as_of)
                     VALUES (%s, NULL, NULL, %s, %s, 4, 0, 0, 0, 0, 0, %s, 'sportscore', now())""", (edition, team, position, points))
            x("INSERT INTO ops.resource_versions(resource_kind, resource_id, version) VALUES ('competition_season', %s, 4), ('competition_season', %s, 2)", (A, C))
            for n, (kind, key, error, episode, _) in enumerate(UNITS):
                player = 9701 + n
                x("INSERT INTO core.players(id, name) VALUES (%s, %s)", (player, f"P{player}"))
                x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('player', 'transfermarkt', %s, %s)", (key, player))
                x("""INSERT INTO ops.transfermarkt_reads(kind, provider_key, priority, next_due_at, read_at, error_code)
                     VALUES (%s, %s, 5, now(), '2026-11-18T10:00:00Z', %s)""", (kind, key, error))
                if episode:
                    x("""INSERT INTO core.player_injuries(player_id, kind, label, start_date, source, as_of)
                         VALUES (%s, 'injury', 'Knee', '2026-10-01', 'transfermarkt', '2026-11-18')""", (player,))
            # 48l: Brazil–Japan, a friendly of the internationals edition (main's, 154), as cups.save writes it.
            x("INSERT INTO core.competitions(id, name, kind) VALUES (9610, 'Matchs internationaux 2026/2027', 'international')")
            x("""INSERT INTO core.competition_seasons(id, competition_id, season_id, native_label, cup_key, cup_name)
                 VALUES (9610, 9610, 2026, '2026/2027', 'nations-results:internationals:2026/2027', 'Matchs internationaux 2026/2027')""")
            x("INSERT INTO core.teams(id, name, is_national) VALUES (%s, 'Brazil', true), (%s, 'Japan', true)", NATIONS)
            round_id = x("INSERT INTO core.rounds(competition_season_id, name) VALUES (9610, 'Friendly') RETURNING id").fetchone()[0]
            x("""INSERT INTO core.matches(id, competition_season_id, season_id, source, status, round_id, home_team_id, away_team_id, home_score, away_score, match_date)
                 VALUES (%s, 9610, 2026, 'international_results', 'finished', %s, %s, %s, 2, 1, '2026-10-10')""", (FRIENDLY, round_id, *NATIONS))

    @classmethod
    def versions(cls):
        return dict(cls.db.execute("SELECT resource_id, version FROM ops.resource_versions WHERE resource_kind = 'competition_season'").fetchall())

    @classmethod
    def reads(cls):
        return {(k, key): read_at for k, key, read_at in cls.db.execute("SELECT kind, provider_key, read_at FROM ops.transfermarkt_reads").fetchall()}

    def test_48j_production_s_schema_then_the_five_migrations_once(self):
        # Production's files: 160 of them (154 the last), as its migration task counted.
        self.assertEqual(self.production_files[-1], "154_home_internationals.sql")
        applied = [n for n in self.production_files if "vector_optional" not in n]  # V2_VECTOR is not set in production
        self.assertEqual(len(applied), 160)
        self.assertEqual(self.at_production, "migrations applied=160 total=160 logins=unchanged")
        self.assertEqual(self.merged_added, ADDED)
        self.assertEqual(self.deployed, "migrations applied=8 total=168 logins=unchanged")
        self.assertEqual(self.again, "migrations applied=0 total=168 logins=unchanged")
        self.assertEqual([v for v, *_ in self.migrations_after if v not in {w for w, *_ in self.migrations_before}], ADDED)
        self.assertEqual([r for r in self.migrations_after if r[0] < "155"], self.migrations_before)
        self.assertEqual(self.migrations_again, self.migrations_after)
        # The reads of 154 and of the candidate, under the read role.
        for sql in ("SELECT count(*) FROM api.home_internationals('2026-10-05', '2026-10-11')", "SELECT count(*) FROM api.standings",
                    f"SELECT count(*) FROM api.nation_matches({NATIONS[0]})", "SELECT count(*) FROM api.player_grade_status",
                    "SELECT count(*) FROM api.player_replacement_facts", "SELECT count(*) FROM api.player_profile_axes",
                    "SELECT count(*) FROM api.player_form_grades", "SELECT count(*) FROM api.team_finished_matches",
                    "SELECT count(*) FROM api.player_team_fit", "SELECT count(*) FROM api.home_rules_v2",
                    "SELECT count(*) FROM api.home_importance_v2(2026::smallint, ARRAY[]::integer[])"):
            self.assertIsNotNone(self.read.execute(sql).fetchone()[0], sql)
        friendly = self.read.execute("SELECT match_id, tournament, home_name, away_name FROM api.home_internationals('2026-10-05', '2026-10-11')").fetchall()
        self.assertEqual([r[1:] for r in friendly], [("Friendly", "Brazil", "Japan")])

    def test_48k_159_moves_each_conflicting_edition_once_160_clears_the_failed_units_without_an_episode(self):
        self.assertEqual(self.versions_after, {A: 5, B: 1, C: 2})
        self.assertEqual(self.versions(), self.versions_after)  # the second pass moves nothing
        served = {e for (e,) in self.read.execute("SELECT DISTINCT competition_season_id FROM api.standings WHERE source = 'sportscore'").fetchall()}
        self.assertEqual(served & {A, B, C}, {C})
        for kind, key, _, _, left in UNITS:
            kept = self.reads_after[(kind, key)]
            self.assertEqual(kept, self.reads_before[(kind, key)] if left == "kept" else None, (kind, key))
        self.assertEqual(self.reads(), self.reads_after)

    def test_48l_a_friendly_of_the_internationals_edition_is_listed_once_by_its_edition(self):
        rows = self.read.execute(f"SELECT match_id, competition, edition, round FROM api.nation_matches({NATIONS[0]})").fetchall()
        friendly = self.read.execute("SELECT api.public_id('match', %s)", (FRIENDLY,)).fetchone()[0]
        self.assertEqual([r for r in rows if r[0] == friendly], [(friendly, "Matchs internationaux 2026/2027", rows[0][2], "Friendly")])
        self.assertEqual(len(rows), 1)


if __name__ == "__main__":
    unittest.main()
