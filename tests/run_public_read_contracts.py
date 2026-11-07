"""Run public read and publication contracts on a disposable local PostgreSQL."""

import argparse
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pg-bin", type=Path, required=True)
    args = parser.parse_args()
    if hasattr(os, "geteuid") and os.geteuid() == 0:
        raise SystemExit("Run this isolated PostgreSQL test as a non-root user (for example the CI runner).")
    root = Path(__file__).resolve().parents[1]
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    with tempfile.TemporaryDirectory(prefix="vega-public-sql-") as directory:
        path = Path(directory)
        data = path / "data"
        command = lambda name: str(args.pg_bin.resolve() / name)
        subprocess.run([
            command("initdb"), "-D", str(data), "-U", "postgres", "--auth=trust",
            "--no-locale", "--encoding=UTF8",
        ], check=True, stdout=subprocess.DEVNULL)
        started = False
        try:
            subprocess.run([
                command("pg_ctl"), "-D", str(data), "-l", str(path / "postgres.log"),
                "-o", f"-h 127.0.0.1 -k {directory} -p {port}", "-w", "start",
            ], check=True)
            started = True
            import psycopg

            base = f"postgresql://postgres@127.0.0.1:{port}"
            with psycopg.connect(base + "/postgres", autocommit=True) as db:
                db.execute("CREATE DATABASE vega_refactor_test")
            url = base + "/vega_refactor_test"
            env = {**os.environ, "TEST_DATABASE_URL": url, "VEGA_TEST_DATABASE_URL": url,
                   "AWS_EC2_METADATA_DISABLED": "true"}
            for name in ("publication_metadata_postgres", "core_delta_postgres",
                         "publication_retries_postgres", "lineup_consolidation_postgres"):
                subprocess.run([sys.executable, f"tests/{name}.py"], cwd=root, env=env, check=True)
            for name in ("test_collection_plan.py", "test_publication_freshness.py", "test_core_delta.py",
                         "test_tournament_publisher_aliases.py", "test_empty_year_aliases.py", "test_daily_refresh.py", "test_storage_budget.py"):
                subprocess.run([sys.executable, "-m", "unittest", "discover", "-s", "tests",
                                "-p", name], cwd=root, env=env, check=True)
            # Tests use one isolated schema name; serialize files so their
            # rollback-only PostgreSQL fixtures cannot contend with one another.
            subprocess.run([
                "node", "--test", "--test-concurrency=1",
                "tests/backend-metrics.test.mjs",
                "tests/relational-read-cache.test.mjs",
                "tests/relational-player-rollups.test.mjs",
                "tests/relational-archives.test.mjs",
                "tests/remote-match.test.mjs",
                "tests/relational-discovery.test.mjs",
                "tests/relational-pagination-cache.test.mjs",
                "tests/relational-compact-reads.test.mjs",
                "tests/relational-home.test.mjs",
                "tests/relational-actors.test.mjs",
                "tests/relational-discipline.test.mjs",
                "tests/bounded-reads.test.mjs",
                "tests/resource-cache.test.mjs",
                "tests/resource-hook-identity.test.mjs",
                "tests/published-data-refresh.test.mjs",
                "tests/home-insights.test.mjs",
                "tests/overview-featured-render.test.mjs",
                "tests/compact-reads.test.mjs",
                "tests/compact-render.test.mjs",
                "tests/player-discipline.test.mjs",
                "tests/runtime-acceptance.test.mjs",
            ], cwd=root, env=env, check=True)
            # Consolidation intentionally commits bounded batches and exercises
            # real COPY writers after cutover. Give it a separate fresh database.
            with psycopg.connect(base + "/postgres", autocommit=True) as db:
                db.execute("CREATE DATABASE vega_ci_test")
            subprocess.run([sys.executable, "tests/consolidation_postgres.py"], cwd=root,
                           env={**env, "TEST_DATABASE_URL": base + "/vega_ci_test"}, check=True)
            # Archival exercises two independent owner roles and committed moves.
            # Keep its active/archived names separate from the consolidation fixture.
            with psycopg.connect(base + "/postgres", autocommit=True) as db:
                db.execute("CREATE DATABASE vega_legacy_transfer_test")
            subprocess.run([sys.executable, "tests/legacy_transfer_archive_postgres.py"], cwd=root,
                           env={**env, "TEST_DATABASE_URL": base + "/vega_legacy_transfer_test"}, check=True)
        except Exception:
            log = path / "postgres.log"
            if log.exists():
                print(log.read_text()[-6000:], file=sys.stderr)
            raise
        finally:
            if started:
                subprocess.run([command("pg_ctl"), "-D", str(data), "-m", "fast", "-w", "stop"],
                               check=True)


if __name__ == "__main__":
    main()
