"""Refresh derived player reads inside the caller's publication transaction.

Canonical appearances remain the source of truth. The SQL function locks the
selected partition, preserves observation coverage and atomically marks the
derived rows with that partition's source digest. No commit is performed here.
"""


def refresh_player_rollups(db, season, league_id, *, force=False):
    row = db.execute(
        "SELECT statarena_app.refresh_player_season_rollups(%s,%s,%s)",
        (season, league_id, force),
    ).fetchone()
    return int(row[0])


def backfill_player_rollups(db):
    """Resume only missing/stale partitions; caller owns transaction boundaries."""
    scopes = db.execute(
        """SELECT season,league_id FROM statarena_app.partitions
        WHERE player_rollup_digest IS DISTINCT FROM source_digest
        ORDER BY season,league_id"""
    ).fetchall()
    return sum(refresh_player_rollups(db, season, league) for season, league in scopes)
