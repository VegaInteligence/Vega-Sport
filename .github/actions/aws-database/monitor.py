"""Observe published Villarreal–PSG coverage in one bounded RDS read."""
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

MATCH = "m_0k4IES"
SQL = """
WITH f AS MATERIALIZED (
    SELECT resource_id, family, status, has_data, error_code
    FROM statarena_app.match_families
    WHERE match_id=%s AND params='{}' AND subject_id=''
), good AS (SELECT * FROM f WHERE status=200 AND has_data)
SELECT
    m.score_home, m.score_away, m.status,
    (SELECT count(*) FROM statarena_app.match_events JOIN good USING(resource_id) WHERE family='events') AS events,
    (SELECT count(*) FROM statarena_app.match_shots JOIN good USING(resource_id) WHERE family='shots') AS shots,
    (SELECT count(expected_goals) FROM statarena_app.match_shots JOIN good USING(resource_id) WHERE family='shots') AS shots_with_xg,
    (SELECT count(*) FROM statarena_app.team_stat_items JOIN good USING(resource_id) WHERE family='stats') AS team_stat_items,
    (SELECT count(DISTINCT parent_no) FROM statarena_app.player_stat_groups JOIN good USING(resource_id) WHERE family='players') AS players_with_stats,
    (SELECT has_data AND status=200 FROM f WHERE family='advanced_teams') AS advanced_available,
    (SELECT error_code FROM f WHERE family='advanced_teams') AS advanced_error
FROM (SELECT 1) AS anchor
LEFT JOIN (SELECT s.* FROM statarena_app.match_summaries s JOIN good USING(resource_id) WHERE family='match') m ON true
"""


def main():
    with psycopg.connect(os.environ["DATABASE_URL"], connect_timeout=10, row_factory=dict_row) as db:
        db.execute("SET TRANSACTION READ ONLY")
        db.execute("SET LOCAL statement_timeout = '10s'")
        row = db.execute(SQL, (MATCH,)).fetchone()
    complete = row["score_home"] is not None and row["score_away"] is not None and all(
        row[key] > 0 for key in ("events", "shots", "team_stat_items", "players_with_stats")
    )
    result = {"source": "AWS RDS publication", "match_id": MATCH,
              "observed_at": datetime.now(timezone.utc).isoformat(), **row, "complete": complete}
    print("RDS_MONITOR_OBSERVATION " + json.dumps(result, separators=(",", ":")))
    with Path(os.environ["GITHUB_OUTPUT"]).open("a") as fp:
        fp.write(f"complete={str(complete).lower()}\n")
    if summary := os.environ.get("GITHUB_STEP_SUMMARY"):
        with Path(summary).open("a") as fp:
            fp.write("## Published Villarreal–PSG data\n\n```json\n" + json.dumps(result, indent=2) + "\n```\n")


if __name__ == "__main__":
    try:
        main()
    except psycopg.Error as exc:
        sys.exit(f"RDS publication probe failed ({type(exc).__name__}); monitor stays active.")
