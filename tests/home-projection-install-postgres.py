"""035 sealed publisher registration on a disposable PostgreSQL database."""
import hashlib
import os
from pathlib import Path
import sys
from urllib.parse import urlparse
import psycopg

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'dashboard/scripts'))
from relational_materialize import install, SCHEMA

def main():
    url = os.environ['TEST_DATABASE_URL']
    parsed = urlparse(url)
    if parsed.hostname not in {'localhost','127.0.0.1','::1'} or not (parsed.path == '/vega_refactor_test' or parsed.path.endswith('_e2e')):
        raise RuntimeError('Requires disposable loopback test database')
    with psycopg.connect(url) as db:
        try:
            assert db.execute("SELECT to_regnamespace('statarena_app')").fetchone()[0] is None
            db.execute((SCHEMA / '003_relational_core.sql').read_text())
            db.execute('CREATE TABLE statarena_app.worker_schema(version text PRIMARY KEY,digest text NOT NULL)')
            for prefix in ('003_', '004_', '005_', '006_', '007_', '008_', '009_', '010_', '011_', '020_', '021_', '022_', '023_', '024_', '025_', '026_', '027_', '028_', '029_', '030_', '031_', '032_', '033_', '034_'):
                (file,) = SCHEMA.glob(prefix + '*.sql')
                db.execute('INSERT INTO statarena_app.worker_schema VALUES(%s,%s)', (file.name, hashlib.sha256(file.read_bytes()).hexdigest()))
            install(db)
            file = SCHEMA / '035_home_projection.sql'
            digest = hashlib.sha256(file.read_bytes()).hexdigest()
            assert db.execute('SELECT digest FROM statarena_app.worker_schema WHERE version=%s',(file.name,)).fetchone() == (digest,)
            assert db.execute("SELECT to_regclass('statarena_app.home_projection') IS NOT NULL").fetchone()[0]
            install(db)
            db.execute('UPDATE statarena_app.worker_schema SET digest=%s WHERE version=%s',('0'*64,file.name))
            try:
                install(db)
                raise AssertionError('Expected sealed digest mismatch rejection')
            except RuntimeError as error:
                assert 'Applied migration changed' in str(error)
            print('PASS sealed 035 install, idempotence and mismatch rejection')
        finally:
            db.rollback()

if __name__ == '__main__': main()
