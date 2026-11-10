"""Local typed collection queue. Caller owns transactions and commits."""

from datetime import datetime, timedelta, timezone
import re
import uuid

DETAIL_FAMILIES = (
    "shots",
    "events",
    "lineups",
    "momentum",
    "team_stats",
    "player_stats",
    "player_halves",
    "advanced",
    "advanced_players",
    "network",
    "heatmaps",
    "h2h",
)
MATCH_FAMILIES = frozenset(("summary", *DETAIL_FAMILIES))
LANES = frozenset(("score", "details", "backfill", "reference"))
TARGET_COLUMNS = ("entity_type", "entity_id", "target_date", "competition_season_id", "global_key")


class LeaseLost(RuntimeError):
    pass


def _aware(value):
    if (
        not isinstance(value, datetime)
        or value.tzinfo is None
        or value.utcoffset() is None
    ):
        raise ValueError("UTC-aware timestamp required")
    return value.astimezone(timezone.utc)


def target_clause(target):
    """SQL and values that select the jobs of one target (the columns of the unique
    index fetch_jobs_active_target, after the family).

    Written with `=` and IS NULL, never IS NOT DISTINCT FROM: PostgreSQL reads no index
    for the latter, so each lookup read the whole queue (0.7 s with the backfill's
    million jobs, several hundred lookups per planning round, 10 November 2026)."""
    parts, values = [], []
    for column in TARGET_COLUMNS:
        value = target.get(column)
        if value is None:
            parts.append(f"{column} IS NULL")
        else:
            parts.append(f"{column}=%s")
            values.append(value)
    return " AND ".join(parts), values


def enqueue(
    conn,
    lane,
    family,
    *,
    entity_type=None,
    entity_id=None,
    target_date=None,
    competition_season_id=None,
    global_key=None,
    run_after=None,
    priority=0
):
    if lane not in LANES:
        raise ValueError("invalid lane")
    if (
        not isinstance(priority, int)
        or isinstance(priority, bool)
        or not -32768 <= priority <= 32767
    ):
        raise ValueError("invalid priority")
    target_count = sum(
        x is not None
        for x in (entity_id, target_date, competition_season_id, global_key)
    )
    valid = (
        family == "calendar"
        and target_date is not None
        and entity_type is None
        or family == "league_matches"
        and competition_season_id is not None
        and entity_type is None
        or family == "league"
        and (
            global_key == "catalogue"
            and entity_type is None
            or entity_type == "competition"
            and entity_id is not None
        )
        or family in ("player", "team")
        and entity_type == family
        and entity_id is not None
        or family in MATCH_FAMILIES
        and entity_type == "match"
        and entity_id is not None
    )
    if target_count != 1 or not valid:
        raise ValueError("invalid typed target")
    if entity_id is not None and (
        not isinstance(entity_id, int) or isinstance(entity_id, bool) or entity_id <= 0
    ):
        raise ValueError("invalid entity id")
    if competition_season_id is not None and (
        not isinstance(competition_season_id, int)
        or isinstance(competition_season_id, bool)
        or competition_season_id <= 0
    ):
        raise ValueError("invalid competition season")
    instant = _aware(run_after) if run_after is not None else datetime.now(timezone.utc)
    row = conn.execute(
        """INSERT INTO ops.fetch_jobs(lane,family,entity_type,entity_id,target_date,competition_season_id,global_key,run_after,priority)
      VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING RETURNING id""",
        (
            lane,
            family,
            entity_type,
            entity_id,
            target_date,
            competition_season_id,
            global_key,
            instant,
            priority,
        ),
    ).fetchone()
    return row[0] if row else None


def claim(conn, lane, *, now=None, lease_seconds=120, family=None):
    if (
        lane not in LANES
        or not isinstance(lease_seconds, int)
        or isinstance(lease_seconds, bool)
        or not 1 <= lease_seconds <= 3600
    ):
        raise ValueError("invalid claim")
    if family is not None and family not in MATCH_FAMILIES | {
        "calendar",
        "league_matches",
        "league",
        "team",
        "player",
    }:
        raise ValueError("invalid family")
    instant = _aware(now) if now is not None else datetime.now(timezone.utc)
    token = uuid.uuid4()
    cur = conn.execute(
        """WITH candidate AS (
      SELECT id FROM ops.fetch_jobs WHERE lane=%s AND (%s::text IS NULL OR family::text=%s) AND ((state='pending' AND run_after<=%s) OR (state='leased' AND lease_until<=%s))
      ORDER BY priority DESC,run_after,id FOR UPDATE SKIP LOCKED LIMIT 1)
      UPDATE ops.fetch_jobs j SET state='leased',lease_token=%s,lease_until=%s,attempts=j.attempts+1,updated_at=%s
      FROM candidate c WHERE j.id=c.id RETURNING j.id,j.lane,j.family,j.entity_type,j.entity_id,j.target_date,j.competition_season_id,j.global_key,j.attempts,j.lease_until,j.lease_token""",
        (
            lane,
            family,
            family,
            instant,
            instant,
            token,
            instant + timedelta(seconds=lease_seconds),
            instant,
        ),
    )
    row = cur.fetchone()
    return dict(zip([c.name for c in cur.description], row)) if row else None


def ack(conn, job_id, token, *, now=None):
    instant = _aware(now) if now is not None else datetime.now(timezone.utc)
    row = conn.execute(
        "UPDATE ops.fetch_jobs SET state='done',lease_token=NULL,lease_until=NULL,updated_at=%s WHERE id=%s AND state='leased' AND lease_token=%s AND lease_until>%s RETURNING id",
        (instant, job_id, token, instant),
    ).fetchone()
    if not row:
        raise LeaseLost("lease lost")


def fail(
    conn,
    job_id,
    token,
    code,
    *,
    now=None,
    retry=True,
    base_seconds=30,
    max_seconds=3600
):
    if not isinstance(code, str) or not re.fullmatch(r"[A-Z][A-Z0-9_]{0,63}", code):
        raise ValueError("invalid error code")
    if (
        not isinstance(base_seconds, int)
        or not isinstance(max_seconds, int)
        or not 1 <= base_seconds <= max_seconds <= 86400
    ):
        raise ValueError("invalid retry")
    instant = _aware(now) if now is not None else datetime.now(timezone.utc)
    row = conn.execute(
        """UPDATE ops.fetch_jobs SET state=CASE WHEN %s THEN 'pending'::ops.job_state ELSE 'failed'::ops.job_state END,
      run_after=CASE WHEN %s THEN %s+make_interval(secs=>LEAST(%s::double precision,%s::double precision * power(2,LEAST(GREATEST(attempts-1,0),20)))) ELSE run_after END,
      last_error_code=%s,lease_until=NULL,lease_token=NULL,updated_at=%s WHERE id=%s AND state='leased' AND lease_token=%s AND lease_until>%s RETURNING id""",
        (
            retry,
            retry,
            instant,
            max_seconds,
            base_seconds,
            code,
            instant,
            job_id,
            token,
            instant,
        ),
    ).fetchone()
    if not row:
        raise LeaseLost("lease lost")


FIRST_SCORE_CHECK = timedelta(minutes=105)
# (end of the window after kickoff, step inside it). Validated cadence: every 2 min to
# +150 min, every 15 min to +4 h, hourly for 2 days, then daily to +7 days.
SCORE_WINDOWS = (
    (timedelta(minutes=150), timedelta(minutes=2)),
    (timedelta(hours=4), timedelta(minutes=15)),
    (timedelta(hours=52), timedelta(hours=1)),
    (timedelta(days=7), timedelta(days=1)),
)


def next_score_check(kickoff, now):
    """Next summary check of a match that is not final yet; None once the watch ends."""
    kickoff, now = _aware(kickoff), _aware(now)
    start = kickoff + FIRST_SCORE_CHECK
    if now < start:
        return start
    for until, step in SCORE_WINDOWS:
        end = kickoff + until
        if now < end:
            steps = (now - start) // step + 1
            return min(start + step * steps, end)
        start = end
    return None


def enqueue_or_revive(conn, lane, family, **target):
    """enqueue(), except that a failed job on the same target is given a new try.

    A failed row still holds the active-target slot: without this, a lineups forecast
    that failed before kickoff would block the lineups fetched after the final whistle.
    """
    job = enqueue(conn, lane, family, **target)
    if job is not None:
        return job
    instant = (
        _aware(target["run_after"])
        if target.get("run_after") is not None
        else datetime.now(timezone.utc)
    )
    clause, values = target_clause(target)
    row = conn.execute(
        f"""UPDATE ops.fetch_jobs SET state='pending', lane=%s, attempts=0, run_after=%s,
              priority=GREATEST(priority, %s), last_error_code=NULL, updated_at=%s
            WHERE family=%s AND {clause} AND state='failed' RETURNING id""",
        (lane, instant, target.get("priority", 0), instant, family, *values),
    ).fetchone()
    return row[0] if row else None


def after_finished(conn, match_id, finished_at, *, detail_priority=0, correction_priority=0):
    """Enqueue match detail families immediately and a correction check at +24h.

    Call only after acknowledging the active summary job in the same transaction,
    so its active-target uniqueness does not suppress the correction job.
    """
    instant = _aware(finished_at)
    detail = [
        enqueue_or_revive(
            conn,
            "details",
            family,
            entity_type="match",
            entity_id=match_id,
            run_after=instant,
            priority=detail_priority,
        )
        for family in DETAIL_FAMILIES
    ]
    correction = enqueue(
        conn,
        "score",
        "summary",
        entity_type="match",
        entity_id=match_id,
        run_after=instant + timedelta(hours=24),
        priority=correction_priority,
    )
    return {"details": detail, "correction": correction}
