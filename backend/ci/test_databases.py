"""Disposable test databases of the backend suites: one per suite, created on a local server.

Prints the suites' environment (KEY=value lines) for $GITHUB_ENV or a shell:

  python backend/ci/test_databases.py postgresql://postgres:<password>@127.0.0.1:5432 >> "$GITHUB_ENV"

Every suite refuses any database but its own local one, so this never touches a real base.
"""

import sys
from urllib.parse import urlparse

# Environment variable -> database name; the single list of the test databases.
SUITES = {
    "VEGA_V2_TEST_DSN": "vega_v2_test",
    "VEGA_V2_JOBS_TEST_DSN": "vega_v2_jobs_test",
    "VEGA_V2_STORE_TEST_DSN": "vega_v2_store_test",
    "VEGA_V2_PILOT_TEST_DSN": "vega_v2_pilot_test",
    "VEGA_V2_PROFILES_TEST_DSN": "vega_v2_profiles_test",
    "VEGA_V2_CONCURRENCY_TEST_DSN": "vega_v2_concurrency_test",
    "VEGA_V2_UNKNOWN_TEST_DSN": "vega_v2_unknown_test",
    "VEGA_V2_VALIDATED_TEST_DSN": "vega_v2_validated_test",
    "VEGA_V2_AGG_TEST_DSN": "vega_v2_agg_test",
    "VEGA_V2_API_TEST_DSN": "vega_v2_api_test",
    "VEGA_V2_WORKER_TEST_DSN": "vega_v2_worker_test",
    "VEGA_V2_MODELS_TEST_DSN": "vega_v2_models_test",
    "VEGA_V2_GRADES_TEST_DSN": "vega_v2_grades_test",
    "VEGA_V2_ROLES_TEST_DSN": "vega_v2_roles_test",
    "VEGA_V2_SOURCES_TEST_DSN": "vega_v2_sources_test",
    "VEGA_V2_SNAPSHOTS_TEST_DSN": "vega_v2_snapshots_test",
    "VEGA_V2_SNAPSHOT_ROLES_TEST_DSN": "vega_v2_snapshot_roles_test",
    "VEGA_V2_DFB_PERIODS_TEST_DSN": "vega_v2_dfb_periods_test",
    "VEGA_V2_ARCHIVE_REPAIR_TEST_DSN": "vega_v2_archive_repair_test",
    "VEGA_V2_ARTWORK_TEST_DSN": "vega_v2_artwork_test",
    "VEGA_V2_ARCHIVE_CORRECTIONS_TEST_DSN": "vega_v2_archive_corrections_test",
    "VEGA_V2_ARCHIVE_DELETIONS_TEST_DSN": "vega_v2_archive_deletions_test",
    "VEGA_V2_ARCHIVE_GUARDS_TEST_DSN": "vega_v2_archive_guards_test",
    "VEGA_V2_ARCHIVE_TWINS_TEST_DSN": "vega_v2_archive_twins_test",
    "VEGA_V2_SCOPE_PURGE_TEST_DSN": "vega_v2_scope_purge_test",
    "VEGA_V2_MEDIA_TEST_DSN": "vega_v2_media_test",
    "VEGA_V2_ARCHIVES_TEST_DSN": "vega_v2_archives_test",
    "VEGA_V2_LIVE_TEST_DSN": "vega_v2_live_test",
    "VEGA_V2_WRITER_REPLAYS_TEST_DSN": "vega_v2_writer_replays_test",
    "VEGA_V2_API_NODE_TEST_DSN": "vega_v2_api_node_test",
    "VEGA_V2_COLLECTION_TEST_DSN": "vega_v2_collection_test",
    "VEGA_V2_IDENTITY_TEST_DSN": "vega_v2_identity_test",
    "VEGA_V2_WINDOW_TEST_DSN": "vega_v2_window_test",
    "VEGA_V2_CLASSEMENTS_TEST_DSN": "vega_v2_classements_test",
    "VEGA_V2_DEPLOY_TEST_DSN": "vega_v2_deploy_test",
    "VEGA_V2_TM_HISTORY_TEST_DSN": "vega_v2_tm_history_test",
}


def main(base):
    import psycopg

    target = urlparse(base)
    if target.hostname not in ("127.0.0.1", "localhost", "::1"):
        raise SystemExit("test databases are created on a local server only")
    root = base.rstrip("/")
    with psycopg.connect(root + "/postgres", autocommit=True) as db:
        for name in SUITES.values():
            db.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
            db.execute(f'CREATE DATABASE "{name}"')
    for key, name in SUITES.items():
        print(f"{key}={root}/{name}")


if __name__ == "__main__":
    main(sys.argv[1])
