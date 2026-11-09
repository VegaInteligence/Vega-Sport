"""Exercise v2 SQL only against a dedicated local, rollback-only PostgreSQL DB."""

import os, sys, unittest
from pathlib import Path
from urllib.parse import urlparse
import psycopg

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from vega_v2.schema_contract import (
    PLAYER_STATS_COLUMNS,
    TEAM_STATS_COLUMNS,
    PLAYER_ADVANCED_COLUMNS,
    TEAM_ADVANCED_COLUMNS,
)

DSN = os.environ.get("VEGA_V2_TEST_DSN")


@unittest.skipUnless(
    DSN, "set VEGA_V2_TEST_DSN to dedicated local database vega_v2_test"
)
class SchemaTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        target = urlparse(DSN)
        if (
            target.hostname not in ("localhost", "127.0.0.1", "::1")
            or target.path != "/vega_v2_test"
        ):
            raise RuntimeError("Only disposable local vega_v2_test allowed")
        cls.db = psycopg.connect(DSN)
        assert cls.db.execute(
            "SELECT to_regnamespace('core') IS NULL AND to_regnamespace('agg') IS NULL AND to_regnamespace('ops') IS NULL"
        ).fetchone()[0]
        for name in (
            "001_core.sql",
            "002_aggregates.sql",
            "003_ops.sql",
            "005_team_pass_percentage.sql",
            "006_reference_state.sql",
            "007_unknown_player_name.sql",
            "008_unknown_team_name.sql",
        ):
            cls.db.execute((ROOT / "sql" / name).read_text(encoding="utf-8"))
        cls.db.execute(
            "INSERT INTO core.seasons(id,label,start_year) VALUES(1,'2025/2026',2025),(2,'2026/2027',2026)"
        )
        cls.db.execute(
            "INSERT INTO core.competitions(id,name) VALUES(1,'Fixture League')"
        )
        cls.db.execute(
            "INSERT INTO core.competition_seasons(id,competition_id,season_id) VALUES(1,1,1),(2,1,2)"
        )
        cls.db.execute("INSERT INTO core.teams(id,name) VALUES(1,'Home'),(2,'Away')")
        cls.db.execute("INSERT INTO core.players(id,name) VALUES(1,'Player')")
        cls.db.execute(
            "INSERT INTO core.matches(id,competition_season_id,season_id,source,home_team_id,away_team_id) VALUES(1,1,1,'pitchapi',1,2)"
        )
        for name in ("player_match_stats", "team_heatmaps", "player_heatmaps", "shots"):
            cls.db.execute(
                f"CREATE TABLE core.{name}_s1 PARTITION OF core.{name} FOR VALUES IN (1)"
            )
        cls.db.execute(
            "CREATE TABLE core.shots_s2 PARTITION OF core.shots FOR VALUES IN (2)"
        )

    @classmethod
    def tearDownClass(cls):
        cls.db.rollback()
        cls.db.close()

    def setUp(self):
        self.db.execute("SAVEPOINT case_start")

    def tearDown(self):
        self.db.execute("ROLLBACK TO SAVEPOINT case_start")
        self.db.execute("RELEASE SAVEPOINT case_start")

    def rejects(self, sql, params=None):
        self.db.execute("SAVEPOINT reject_case")
        try:
            with self.assertRaises(psycopg.Error):
                self.db.execute(sql, params)
        finally:
            self.db.execute("ROLLBACK TO SAVEPOINT reject_case")
            self.db.execute("RELEASE SAVEPOINT reject_case")

    def test_observed_player_identity_can_have_unknown_name(self):
        self.db.execute("INSERT INTO core.players(id,name) VALUES(2,NULL)")
        self.db.execute(
            "INSERT INTO core.provider_ids(entity_type,provider,provider_key,entity_id) VALUES('player','pitchapi','p_abcdef',2)"
        )
        row = self.db.execute(
            "SELECT p.name,i.provider_key FROM core.players p JOIN core.provider_ids i ON i.entity_type='player' AND i.entity_id=p.id WHERE p.id=2"
        ).fetchone()
        self.assertEqual(row, (None, "p_abcdef"))
        self.assertEqual(
            self.db.execute("SELECT name FROM core.players WHERE id=1").fetchone()[0],
            "Player",
        )
        self.db.execute("INSERT INTO core.teams(id,name) VALUES(3,NULL)")
        self.assertIsNone(
            self.db.execute("SELECT name FROM core.teams WHERE id=3").fetchone()[0]
        )

    def test_types_and_absence(self):
        rows = dict(
            self.db.execute(
                "SELECT column_name,data_type FROM information_schema.columns WHERE table_schema='core' AND table_name='player_match_stats'"
            )
        )
        for key, typ in PLAYER_STATS_COLUMNS.items():
            self.assertEqual(rows[key], typ)
        self.db.execute(
            "INSERT INTO core.player_match_stats(season_id,match_id,team_id,player_id,minutes_played,xg) VALUES(1,1,1,1,90,0.123456789)"
        )
        xg, goals = self.db.execute(
            "SELECT xg,goals FROM core.player_match_stats"
        ).fetchone()
        self.assertAlmostEqual(xg, 0.123456789, places=7)
        self.assertIsNone(goals)
        for table in (
            "player_match_stats",
            "team_match_stats",
            "player_match_advanced",
            "team_match_advanced",
        ):
            contract = {
                "player_match_stats": PLAYER_STATS_COLUMNS,
                "team_match_stats": TEAM_STATS_COLUMNS,
                "player_match_advanced": PLAYER_ADVANCED_COLUMNS,
                "team_match_advanced": TEAM_ADVANCED_COLUMNS,
            }[table]
            found = dict(
                self.db.execute(
                    "SELECT column_name,data_type FROM information_schema.columns WHERE table_schema='core' AND table_name=%s",
                    (table,),
                )
            )
            self.assertEqual({k: found[k] for k in contract}, contract)
        self.assertFalse(
            self.db.execute(
                "SELECT 1 FROM information_schema.columns WHERE table_schema IN ('core','agg','ops') AND data_type IN ('json','jsonb') LIMIT 1"
            ).fetchone()
        )

    def test_passing_percentage_has_typed_fact_and_aggregate_columns(self):
        rows = self.db.execute(
            "SELECT table_schema,table_name,column_name,data_type FROM information_schema.columns WHERE (table_schema,table_name,column_name) IN (('core','team_match_stats','accurate_passes_pct'),('agg','team_season_stats','accurate_passes_pct'),('agg','team_season_stats','accurate_passes_pct_avg')) ORDER BY 1,2,3"
        ).fetchall()
        self.assertEqual(len(rows), 3)
        self.assertTrue(all(row[3] == "real" for row in rows))
        self.db.execute(
            "CREATE TABLE core.team_match_stats_s1 PARTITION OF core.team_match_stats FOR VALUES IN (1)"
        )
        self.db.execute(
            "INSERT INTO core.team_match_stats(season_id,match_id,team_id,period,accurate_passes,accurate_passes_pct) VALUES(1,1,1,'all',329,82)"
        )
        self.assertEqual(
            self.db.execute(
                "SELECT accurate_passes,accurate_passes_pct FROM core.team_match_stats"
            ).fetchone(),
            (329, 82.0),
        )

    def test_global_match_and_season_integrity(self):
        self.rejects(
            "INSERT INTO core.matches(id,competition_season_id,season_id,source) VALUES(1,1,1,'pitchapi')"
        )
        self.rejects(
            "INSERT INTO core.matches(id,competition_season_id,season_id,source) VALUES(2,1,2,'pitchapi')"
        )
        self.rejects("INSERT INTO core.shots(season_id,match_id,shot_no) VALUES(2,1,1)")
        self.db.execute(
            "INSERT INTO core.shots(season_id,match_id,shot_no) VALUES(1,1,1)"
        )

    def test_heatmap_shape_no_null_no_negative(self):
        self.db.execute(
            "INSERT INTO core.team_heatmaps(season_id,match_id,team_id,cells) VALUES(1,1,1,%s)",
            ([0] * 192,),
        )
        for cells in ([0] * 191, [0] * 193, [0] * 191 + [None], [0] * 191 + [-1]):
            self.rejects(
                "INSERT INTO core.player_heatmaps(season_id,match_id,player_id,cells) VALUES(1,1,1,%s)",
                (cells,),
            )
        self.rejects(
            "INSERT INTO core.player_heatmaps(season_id,match_id,player_id,cells) VALUES(1,1,1,array_fill(0::smallint,ARRAY[192],ARRAY[0]))"
        )

    def test_nullable_standings_and_distinct_scopes(self):
        self.db.execute(
            "INSERT INTO agg.standings(competition_season_id,team_id,stage,group_name) VALUES(1,1,NULL,NULL)"
        )
        self.rejects(
            "INSERT INTO agg.standings(competition_season_id,team_id,stage,group_name) VALUES(1,1,NULL,NULL)"
        )
        self.db.execute(
            "INSERT INTO ops.dirty_scopes(scope_kind,player_id,team_id,competition_season_id) VALUES('player_season',1,1,1),('player_season',1,2,1)"
        )
        self.rejects(
            "INSERT INTO ops.dirty_scopes(scope_kind,player_id,team_id,competition_season_id) VALUES('player_season',1,1,1)"
        )

    def test_official_standings_keep_provider_provenance_separate(self):
        self.db.execute(
            "INSERT INTO core.official_standings(competition_season_id,team_id,source,as_of,points) VALUES(1,1,'uefa','2026-01-01',7),(1,1,'sportscore','2026-01-02',8)"
        )
        rows = self.db.execute(
            "SELECT source,as_of,points FROM core.official_standings ORDER BY source"
        ).fetchall()
        self.assertEqual([r[0] for r in rows], ["uefa", "sportscore"])
        self.assertEqual([r[2] for r in rows], [7, 8])
        self.assertEqual(
            self.db.execute("SELECT count(*) FROM agg.standings").fetchone()[0], 0
        )
        self.rejects(
            "INSERT INTO core.official_standings(competition_season_id,team_id,source) VALUES(1,1,'uefa')"
        )

    def test_jobs_global_date_and_edition_do_not_collide(self):
        self.db.execute(
            "INSERT INTO ops.fetch_jobs(lane,family,global_key) VALUES('reference','league','catalogue')"
        )
        self.db.execute(
            "INSERT INTO ops.fetch_jobs(lane,family,target_date) VALUES('score','calendar','2026-01-01'),('score','calendar','2026-01-02')"
        )
        self.db.execute(
            "INSERT INTO ops.fetch_jobs(lane,family,competition_season_id) VALUES('backfill','league_matches',1),('backfill','league_matches',2)"
        )
        self.rejects(
            "INSERT INTO ops.fetch_jobs(lane,family,target_date) VALUES('score','calendar','2026-01-01')"
        )
        self.rejects(
            "INSERT INTO ops.fetch_jobs(lane,family,target_date,entity_type,entity_id) VALUES('score','calendar','2026-01-03','match',1)"
        )
        self.rejects(
            "INSERT INTO ops.fetch_jobs(lane,family,entity_type,entity_id) VALUES('reference','league','team',1)"
        )
        self.rejects(
            "INSERT INTO ops.fetch_jobs(lane,family,global_key) VALUES('details','shots','catalogue')"
        )
        self.rejects(
            "INSERT INTO ops.fetch_jobs(lane,family,target_date,state) VALUES('score','calendar','2026-01-04','leased')"
        )
        self.db.execute(
            "INSERT INTO ops.fetch_jobs(lane,family,target_date,state,lease_until,lease_token) VALUES('score','calendar','2026-01-04','leased',now()+interval '1 minute','00000000-0000-0000-0000-000000000001')"
        )

    def test_family_state_tracks_attempt_without_response_body(self):
        self.db.execute(
            "INSERT INTO ops.family_state(match_id,family,status,fingerprint,last_success_at) VALUES(1,'shots','ok',%s,now())",
            (bytes.fromhex("12" * 32),),
        )
        self.db.execute(
            "UPDATE ops.family_state SET status='error',last_attempt_at=now() WHERE match_id=1 AND family='shots'"
        )
        status, digest = self.db.execute(
            "SELECT status,fingerprint FROM ops.family_state WHERE match_id=1 AND family='shots'"
        ).fetchone()
        self.assertEqual(status, "error")
        self.assertEqual(bytes(digest), bytes.fromhex("12" * 32))
        self.rejects(
            "INSERT INTO ops.family_state(match_id,family) VALUES(1,'calendar')"
        )
        self.rejects(
            "INSERT INTO ops.family_state(match_id,family,fingerprint) VALUES(1,'events',decode('01','hex'))"
        )

    def test_reference_state_fingerprint_and_entity_scope(self):
        digest = bytes.fromhex("12" * 32)
        self.db.execute(
            "INSERT INTO ops.reference_state(provider,entity_type,entity_id,fingerprint,status) VALUES('pitchapi','team',1,%s,'ok')",
            (digest,),
        )
        self.db.execute(
            "INSERT INTO ops.reference_state(provider,entity_type,entity_id) VALUES('pitchapi','player',1)"
        )
        self.assertEqual(
            self.db.execute(
                "SELECT status FROM ops.reference_state WHERE entity_type='player'"
            ).fetchone()[0],
            "pending",
        )
        self.rejects(
            "INSERT INTO ops.reference_state(provider,entity_type,entity_id) VALUES('pitchapi','team',1)"
        )
        self.rejects(
            "INSERT INTO ops.reference_state(provider,entity_type,entity_id) VALUES('pitchapi','match',1)"
        )
        self.rejects(
            "INSERT INTO ops.reference_state(provider,entity_type,entity_id,fingerprint) VALUES('pitchapi','team',2,decode('01','hex'))"
        )

    def test_optional_pgvector_dimension_and_hnsw(self):
        if not self.db.execute(
            "SELECT 1 FROM pg_available_extensions WHERE name='vector'"
        ).fetchone():
            self.skipTest("pgvector extension unavailable in local server")
        self.db.execute(
            (ROOT / "sql" / "004_vector_optional.sql").read_text(encoding="utf-8")
        )
        self.assertEqual(
            self.db.execute(
                "SELECT count(*) FROM agg.player_profile_vectors"
            ).fetchone()[0],
            0,
        )
        self.assertTrue(
            self.db.execute(
                "SELECT 1 FROM pg_indexes WHERE schemaname='agg' AND indexname='player_profile_vectors_hnsw'"
            ).fetchone()
        )
        self.rejects(
            "INSERT INTO agg.player_profile_vectors(player_id,season_id,embedding) VALUES(1,1,%s)",
            ("[0,1]",),
        )

    def test_future_and_derived_model_tables_start_empty(self):
        for table in (
            "core.player_contracts",
            "core.player_transfers",
            "core.official_standings",
            "agg.role_weights",
            "agg.player_index",
            "agg.player_projections",
        ):
            self.assertEqual(
                self.db.execute(f"SELECT count(*) FROM {table}").fetchone()[0], 0
            )


if __name__ == "__main__":
    unittest.main()
