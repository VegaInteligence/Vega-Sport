"""The competition purge under the production roles on this schema, written before the code: FAILURE_MODES.md §35
(35j–35k). The collection role (vega_collect) and the calculations' role (vega_calc) each on their own connection
(017_roles.sql), on a disposable local PostgreSQL (VEGA_V2_SCOPE_PURGE_TEST_DSN, database vega_v2_scope_purge_test).

Failure modes: a table the collection role may only read and insert into (the reviewed proofs of 142, 143 and 146)
blocks the deletion; main's purge sends its DELETE there anyway (42501), after its calculations' half has already
cleared agg and marked the rankings; or it gives up on every later competition. Expected: a competition such a proof
names is held whole (nothing removed, agg included) and reported with the table; the others are removed as on main;
no privilege is added.
"""

import contextlib
import io
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from vega import scope  # noqa: E402

try:
    import psycopg
except ImportError:
    psycopg = None
DSN = os.environ.get("VEGA_V2_SCOPE_PURGE_TEST_DSN")
KEPT, NAMED = "l_purgeA", "l_purgeB"  # two removed PitchAPI leagues (scope.REMOVED in the test)


@unittest.skipUnless(DSN and psycopg, "requires a disposable local scope purge DB (VEGA_V2_SCOPE_PURGE_TEST_DSN) and psycopg")
class PurgeUnderRolesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from vega.store import connect_local, migrate

        target = urlparse(DSN)
        if target.hostname not in ("localhost", "127.0.0.1", "::1") or target.path != "/vega_v2_scope_purge_test":
            raise RuntimeError("dedicated local scope purge DB required")
        cls.db = connect_local(DSN)
        cls.db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        migrate(cls.db)

    @classmethod
    def tearDownClass(cls):
        cls.db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        cls.db.close()

    def setUp(self):
        from vega.store import connect_local

        self.x = self.db.execute
        self.x("""TRUNCATE core.matches, core.rounds, core.competition_seasons, core.competitions, core.provider_ids, core.teams,
                  core.assets, agg.team_season_stats, agg.power_runs RESTART IDENTITY CASCADE""")
        self.collect, self.calc = connect_local(DSN), connect_local(DSN)
        self.addCleanup(self.collect.close)
        self.addCleanup(self.calc.close)
        self.collect.execute("SET ROLE vega_collect")
        self.calc.execute("SET ROLE vega_calc")

    def privileges(self):
        return self.x("""SELECT table_schema, table_name, privilege_type FROM information_schema.role_table_grants
                         WHERE grantee IN ('vega_collect', 'vega_calc') ORDER BY 1, 2, 3""").fetchall()

    def league(self, key, season):
        """A removed league's competition, one edition, two finished matches between two teams, the calculations'
        season row of each team and a published player ranking of the season."""
        from vega.store import Store

        x = self.x
        season_id = Store(self.db).season(season)
        comp = x("INSERT INTO core.competitions(name) VALUES (%s) RETURNING id", (key,)).fetchone()[0]
        x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('competition', 'pitchapi', %s, %s)", (key, comp))
        edition = x("INSERT INTO core.competition_seasons(competition_id, season_id) VALUES (%s, %s) RETURNING id", (comp, season_id)).fetchone()[0]
        teams = [x("INSERT INTO core.teams(name) VALUES (%s) RETURNING id", (f"{key} {n}",)).fetchone()[0] for n in (1, 2)]
        for day, (home, away) in (("01", teams), ("08", teams[::-1])):
            x("""INSERT INTO core.matches(competition_season_id, season_id, match_date, status, home_team_id, away_team_id, home_score, away_score, source)
                 VALUES (%s, %s, %s, 'finished', %s, %s, 1, 0, 'pitchapi')""", (edition, season_id, f"{season[:4]}-10-{day}", home, away))
        for team in teams:
            x("""INSERT INTO agg.team_season_stats(team_id, competition_season_id, season_id, matches, won, drawn, lost, goals_for, goals_against,
                                                   points, clean_sheets) VALUES (%s, %s, %s, 2, 1, 0, 1, 1, 1, 3, 1)""", (team, edition, season_id))
        x("INSERT INTO agg.power_runs(kind, season_id, method_version, status) VALUES ('players', %s, 'test', 'published')", (season_id,))
        return comp, edition, season_id

    def held_state(self, comp, edition, season_id):
        return (self.x("SELECT count(*) FROM core.competitions WHERE id = %s", (comp,)).fetchone()[0],
                self.x("SELECT count(*) FROM core.competition_seasons WHERE id = %s", (edition,)).fetchone()[0],
                self.x("SELECT count(*) FROM core.matches WHERE competition_season_id = %s", (edition,)).fetchone()[0],
                self.x("SELECT count(*) FROM agg.team_season_stats WHERE competition_season_id = %s", (edition,)).fetchone()[0],
                self.x("SELECT method_version FROM agg.power_runs WHERE season_id = %s", (season_id,)).fetchall(),
                self.x("SELECT count(*) FROM core.provider_ids WHERE entity_type = 'competition' AND entity_id = %s", (comp,)).fetchone()[0])

    def purge(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out), patch.object(scope, "REMOVED", {KEPT: "test", NAMED: "test"}):
            return scope.purge(self.collect, self.calc), out.getvalue()

    def test_35j_a_competition_without_proof_is_removed_under_the_roles(self):
        comp, edition, season_id = self.league(NAMED, "2025/2026")
        grants = self.privileges()  # after the seasons' partitions exist
        removed, _ = self.purge()
        self.assertEqual(removed, {"competitions": 1, "editions": 1, "matches": 2})
        self.assertEqual(self.held_state(comp, edition, season_id), (0, 0, 0, 0, [("purged",)], 0))
        self.assertEqual(self.purge()[0], {})
        self.assertEqual(self.privileges(), grants)

    def test_35k_a_competition_an_artwork_proof_names_is_held_whole(self):
        held = self.league(KEPT, "2024/2025")
        gone = self.league(NAMED, "2025/2026")
        asset = self.x("INSERT INTO core.assets(kind, source_url) VALUES ('logo', 'https://media.test/logo.png') RETURNING id").fetchone()[0]
        self.x("""INSERT INTO core.family_artwork_qualifications(competition_id, asset_id, certificate, manifest_sha256)
                  VALUES (%s, %s, '{"asset_role": "competition_logo", "competition_identity_only": "true"}'::jsonb, %s)""",
               (held[0], asset, "3" * 64))
        before, grants = self.held_state(*held), self.privileges()
        removed, printed = self.purge()
        self.assertEqual(removed, {"competitions": 1, "editions": 1, "matches": 2, "held": 1})
        self.assertIn(f"scope purge held competition={held[0]} tables=core.family_artwork_qualifications", printed)
        self.assertEqual(self.held_state(*held), before)  # nothing removed, agg and the ranking untouched
        self.assertEqual(self.held_state(*gone), (0, 0, 0, 0, [("purged",)], 0))
        self.assertEqual(self.x("SELECT count(*) FROM core.family_artwork_qualifications").fetchone()[0], 1)
        self.assertEqual(self.purge()[0], {"held": 1})
        self.assertEqual(self.privileges(), grants)


if __name__ == "__main__":
    unittest.main()
