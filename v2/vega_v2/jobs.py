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


def renew(conn, job_id, token, *, lease_seconds=300):
    """Extend only a still-owned, unexpired lease using the database clock."""
    if (
        not isinstance(lease_seconds, int)
        or isinstance(lease_seconds, bool)
        or not 1 <= lease_seconds <= 3600
    ):
        raise ValueError("invalid lease duration")
    row = conn.execute(
        """WITH instant AS (SELECT clock_timestamp() AS value)
        UPDATE ops.fetch_jobs j
        SET lease_until=instant.value+make_interval(secs=>%s),updated_at=instant.value
        FROM instant WHERE j.id=%s AND j.state='leased' AND j.lease_token=%s
        AND j.lease_until>instant.value RETURNING j.lease_until""",
        (lease_seconds, job_id, token),
    ).fetchone()
    if not row:
        raise LeaseLost("lease lost")
    return row[0]


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


def next_score_check(kickoff, now):
    kickoff, now = _aware(kickoff), _aware(now)
    first = kickoff + timedelta(minutes=105)
    if now < first:
        return first
    cutoff = kickoff + timedelta(minutes=150)
    if now < cutoff:
        steps = int((now - first).total_seconds() // 900) + 1
        return first + timedelta(minutes=15 * steps)
    return now + timedelta(hours=1)


def after_finished(conn, match_id, finished_at):
    """Enqueue match detail families immediately and a correction check at +24h.

    Call only after acknowledging the active summary job in the same transaction,
    so its active-target uniqueness does not suppress the correction job.
    """
    instant = _aware(finished_at)
    detail = [
        enqueue(
            conn,
            "details",
            family,
            entity_type="match",
            entity_id=match_id,
            run_after=instant,
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
    )
    return {"details": detail, "correction": correction}
