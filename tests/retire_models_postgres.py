"""Exercise model retirement against an owned disposable PostgreSQL instance."""
import argparse
from pathlib import Path
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'docs/verification/orion-pro-pilot-20261104'))
from harness import LocalPostgres
import psycopg

parser = argparse.ArgumentParser()
parser.add_argument('--pg-bin', required=True, type=Path)
args = parser.parse_args()
sql = (ROOT / 'dashboard/backend/migrations/019_retire_reserved_models.sql').read_text()
names = ['feature_versions', 'scouting_features', 'model_versions', 'scoring_runs', 'player_match_scores',
         'team_match_scores', 'player_window_scores', 'scoring_run_ranking_inputs', 'published_score_runs']
with tempfile.TemporaryDirectory(prefix='statarena-model-test-') as folder:
    pg = LocalPostgres(args.pg_bin, Path(folder))
    try:
        pg.start()
        with psycopg.connect(pg.dsn, autocommit=True) as db:
            db.execute('CREATE SCHEMA analytics; CREATE SCHEMA football; CREATE TABLE football.matches(id bigint PRIMARY KEY); INSERT INTO football.matches VALUES(1)')
            for name in names:
                db.execute('CREATE TABLE analytics.' + name + '(id bigint PRIMARY KEY)')
            db.execute('ALTER TABLE analytics.model_versions ADD COLUMN feature_id bigint REFERENCES analytics.feature_versions(id)')
            db.execute('INSERT INTO analytics.feature_versions VALUES(1)')
            try:
                with db.transaction(): db.execute(sql, prepare=False)
                raise AssertionError('A populated model table was removed')
            except psycopg.errors.RaiseException as error:
                assert 'populated model table' in str(error)
            assert db.execute('SELECT count(*) FROM analytics.feature_versions').fetchone()[0] == 1
            db.execute('DELETE FROM analytics.feature_versions')
            db.execute('CREATE TABLE football.model_link(feature_id bigint REFERENCES analytics.feature_versions(id))')
            try:
                with db.transaction(): db.execute(sql, prepare=False)
                raise AssertionError('An external dependency was silently removed')
            except psycopg.errors.DependentObjectsStillExist:
                pass
            assert db.execute("SELECT to_regclass('analytics.feature_versions')").fetchone()[0]
            db.execute('DROP TABLE football.model_link')
            with db.transaction(): db.execute(sql, prepare=False)
            assert all(db.execute('SELECT to_regclass(%s)', ('analytics.' + name,)).fetchone()[0] is None for name in names)
            assert db.execute('SELECT count(*) FROM football.matches').fetchone()[0] == 1
            with db.transaction(): db.execute(sql, prepare=False)
        print('PASS: populated models preserved, external dependencies preserved, empty models retired, idempotent reapply, football facts preserved')
    finally:
        pg.cleanup()
