"""Planner: turns the calendar and the watch table into typed jobs.

Idempotent and cheap: the worker runs it every minute. Every rule below is the
validated v2 schedule (doc "Collecte et opérations"):

- /date/{d}?status=all once a UTC day for each date from J-1 to J+7 (score lane);
- /matches/{id} at kickoff +105 min, then the cadence of jobs.next_score_check,
  then once more at +24 h for provider corrections;
- lineups 48 h before kickoff (forecast) and at kickoff; h2h once before the match;
- the league catalogue, each active competition and its calendar once a week;
- team and player profiles at first sight, then monthly (profiles.enqueue_due).
"""

from collections import Counter
from datetime import datetime, timedelta, timezone

from . import profiles
from .jobs import _aware, enqueue, enqueue_or_revive, next_score_check, target_clause, FIRST_SCORE_CHECK

CALENDAR_DAYS = range(-1, 8)
LINEUP_FORECAST = timedelta(hours=48)
H2H_HORIZON = timedelta(days=7)
SCORE_HORIZON = timedelta(days=1)
CORRECTION_DELAY = timedelta(hours=24)
WEEK = timedelta(days=7)
ACTIVE_WINDOW = timedelta(days=30)
DONE_RETENTION = timedelta(days=14)
RETRY_FAILED_AFTER = timedelta(hours=24)
# Codes a retry cannot fix: the job stays failed and shows in ops.v_backlog.
PERMANENT_CODES = (
    "RESOURCE_NOT_FOUND",
    "INVALID_PARAMETER",
    "UNAUTHORIZED",
    "INVALID_ENDPOINT",
    "MATCH_ID_MISMATCH",
    "PROFILE_ID_MISMATCH",
    "MATCH_SEASON_CHANGED",
    "MATCH_COMPETITION_CHANGED",
    "CALENDAR_IDENTITY_MISMATCH",
)
TERMINAL = ("postponed", "canceled", "awarded")
LIVE_WATCH = ("scheduled", "waiting_final", "final")

PRIORITY = {
    "summary": 20,
    "calendar_near": 15,
    "calendar": 10,
    "lineups_kickoff": 9,
    "details": 8,
    "lineups_forecast": 5,
    "h2h": 1,
    "reference": 0,
}


def plan(conn, now=None, *, profile_limit=200):
    """Enqueue every job that is due; returns counts per rule. One planner at a time."""
    instant = _aware(now) if now is not None else datetime.now(timezone.utc)
    counts = Counter()
    with conn.transaction():
        if not conn.execute(
            "SELECT pg_try_advisory_xact_lock(hashtextextended('vega_v2_planner',0))"
        ).fetchone()[0]:
            return counts
        counts["revived"] = _revive_failed(conn, instant)
        counts["calendar"] = _calendar(conn, instant)
        counts["summary"] = _scores(conn, instant)
        counts["lineups"] = _lineups(conn, instant)
        counts["h2h"] = _h2h(conn, instant)
        counts["reference"] = _weekly(conn, instant)
        counts["profiles"] = len(
            profiles.enqueue_due(conn, now=instant, limit=profile_limit)
        )
        counts["pruned"] = _prune(conn, instant)
    return +counts


def _recent(conn, family, since, **target):
    """An active job for this target, or one finished since `since`.

    Two lookups, one per partial index (fetch_jobs_active_target for the jobs that are
    not done, fetch_jobs_done_recent for the ones that are): a single `state<>'done' OR
    updated_at>=…` fits neither index and read the whole queue."""
    clause, values = target_clause(target)
    return conn.execute(
        f"""SELECT EXISTS (SELECT 1 FROM ops.fetch_jobs WHERE family=%s AND {clause} AND state<>'done')
                OR EXISTS (SELECT 1 FROM ops.fetch_jobs WHERE family=%s AND {clause} AND state='done' AND updated_at>=%s)""",
        (family, *values, family, *values, since),
    ).fetchone()[0]


def _calendar(conn, now):
    today = now.date()
    day_start = datetime(today.year, today.month, today.day, tzinfo=timezone.utc)
    count = 0
    for delta in CALENDAR_DAYS:
        day = today + timedelta(days=delta)
        if _recent(conn, "calendar", day_start, target_date=day):
            continue
        priority = PRIORITY["calendar_near" if delta in (-1, 0) else "calendar"]
        if enqueue(conn, "score", "calendar", target_date=day, run_after=now, priority=priority):
            count += 1
    return count


def _scores(conn, now):
    """Every live watch due within a day has exactly one pending summary job."""
    rows = conn.execute(
        """SELECT w.match_id, w.next_check_at FROM ops.match_watch w
           WHERE w.state IN ('scheduled','waiting_final','final') AND w.next_check_at IS NOT NULL
             AND w.next_check_at <= %s
             AND NOT EXISTS (SELECT 1 FROM ops.fetch_jobs j WHERE j.family='summary'
               AND j.entity_type='match' AND j.entity_id=w.match_id AND j.state<>'done')
           ORDER BY w.next_check_at, w.match_id""",
        (now + SCORE_HORIZON,),
    ).fetchall()
    return sum(
        enqueue(
            conn,
            "score",
            "summary",
            entity_type="match",
            entity_id=mid,
            run_after=max(at, now) if at else now,
            priority=PRIORITY["summary"],
        )
        is not None
        for mid, at in rows
    )


def _lineups(conn, now):
    """Forecast lineups 48 h before kickoff, confirmed lineups at kickoff."""
    rows = conn.execute(
        """SELECT w.match_id, w.kickoff_at <= %s AS started FROM ops.match_watch w
           JOIN core.matches m ON m.id = w.match_id
           LEFT JOIN ops.family_state f ON f.match_id = w.match_id AND f.family = 'lineups'
           WHERE w.state IN ('scheduled','waiting_final') AND m.status IN ('not_started','in_play')
             AND w.kickoff_at > %s - %s AND w.kickoff_at <= %s + %s
             AND (f.last_attempt_at IS NULL OR f.last_attempt_at <
                  CASE WHEN w.kickoff_at <= %s THEN w.kickoff_at ELSE w.kickoff_at - %s END)
           ORDER BY w.kickoff_at, w.match_id""",
        (now, now, FIRST_SCORE_CHECK, now, LINEUP_FORECAST, now, LINEUP_FORECAST),
    ).fetchall()
    return sum(
        enqueue_or_revive(
            conn,
            "details",
            "lineups",
            entity_type="match",
            entity_id=mid,
            run_after=now,
            priority=PRIORITY["lineups_kickoff" if started else "lineups_forecast"],
        )
        is not None
        for mid, started in rows
    )


def _h2h(conn, now):
    rows = conn.execute(
        """SELECT w.match_id FROM ops.match_watch w
           WHERE w.state = 'scheduled' AND w.kickoff_at > %s AND w.kickoff_at <= %s
             AND NOT EXISTS (SELECT 1 FROM ops.family_state f WHERE f.match_id = w.match_id AND f.family = 'h2h')
           ORDER BY w.kickoff_at, w.match_id""",
        (now, now + H2H_HORIZON),
    ).fetchall()
    return sum(
        enqueue(
            conn,
            "details",
            "h2h",
            entity_type="match",
            entity_id=mid,
            run_after=now,
            priority=PRIORITY["h2h"],
        )
        is not None
        for (mid,) in rows
    )


def _weekly(conn, now):
    """League catalogue, then each active competition and its calendar, once a week."""
    since = now - WEEK
    count = 0
    if not _recent(conn, "league", since, global_key="catalogue"):
        count += enqueue(
            conn, "reference", "league", global_key="catalogue", run_after=now
        ) is not None
    active = conn.execute(
        """SELECT DISTINCT cs.id, cs.competition_id FROM ops.match_watch w
           JOIN core.matches m ON m.id = w.match_id
           JOIN core.competition_seasons cs ON cs.id = m.competition_season_id
           WHERE w.kickoff_at > %s - %s AND w.kickoff_at < %s + %s
           ORDER BY cs.id""",
        (now, ACTIVE_WINDOW, now, ACTIVE_WINDOW),
    ).fetchall()
    for edition, competition in active:
        if not _recent(conn, "league_matches", since, competition_season_id=edition):
            count += enqueue(
                conn,
                "reference",
                "league_matches",
                competition_season_id=edition,
                run_after=now,
            ) is not None
        if not _recent(
            conn, "league", since, entity_type="competition", entity_id=competition
        ):
            count += enqueue(
                conn,
                "reference",
                "league",
                entity_type="competition",
                entity_id=competition,
                run_after=now,
            ) is not None
    return count


def _revive_failed(conn, now):
    """A failed job blocks its target; transient failures get one new try a day."""
    return conn.execute(
        """UPDATE ops.fetch_jobs SET state='pending', attempts=0, run_after=%s, updated_at=%s
           WHERE state='failed' AND updated_at < %s
             AND (last_error_code IS NULL OR NOT (last_error_code = ANY(%s)))""",
        (now, now, now - RETRY_FAILED_AFTER, list(PERMANENT_CODES)),
    ).rowcount


def _prune(conn, now):
    """Finished jobs are kept two weeks; ops.fetch_log keeps every attempt."""
    return conn.execute(
        """DELETE FROM ops.fetch_jobs WHERE id IN (
             SELECT id FROM ops.fetch_jobs WHERE state='done' AND updated_at < %s LIMIT 5000)""",
        (now - DONE_RETENTION,),
    ).rowcount


def observe(conn, match_id, *, kickoff_at, status, now):
    """Calendar sighting of a match: create or move its watch. Caller owns the transaction."""
    instant = _aware(now)
    row = conn.execute(
        "SELECT state, kickoff_at FROM ops.match_watch WHERE match_id=%s FOR UPDATE",
        (match_id,),
    ).fetchone()
    state, previous = row if row else (None, None)
    if state in ("final", "corrected"):
        return state
    if status == "finished":
        # Seen finished in a calendar: the score lane confirms it now and starts details.
        new_state, next_at = "scheduled", instant
    elif status in TERMINAL:
        new_state, next_at = "stopped", None
        conn.execute(
            "UPDATE ops.fetch_jobs SET state='done', updated_at=%s WHERE family='summary' AND entity_type='match' AND entity_id=%s AND state='pending'",
            (instant, match_id),
        )
    elif state is not None and previous == kickoff_at:
        # Nothing moved: the watch stays as the score lane left it.
        return state
    elif kickoff_at is None:
        new_state, next_at = "scheduled", None
    else:
        # New watch, or a new kickoff (a postponed match rescheduled, a time change).
        next_at = next_score_check(kickoff_at, instant)
        new_state = "scheduled" if next_at is not None else "stopped"
    conn.execute(
        """INSERT INTO ops.match_watch(match_id, next_check_at, state, last_status, kickoff_at, updated_at)
           VALUES(%s,%s,%s,%s,%s,%s)
           ON CONFLICT(match_id) DO UPDATE SET next_check_at=EXCLUDED.next_check_at, state=EXCLUDED.state,
             last_status=EXCLUDED.last_status, kickoff_at=EXCLUDED.kickoff_at, updated_at=EXCLUDED.updated_at""",
        (match_id, next_at, new_state, status, kickoff_at, instant),
    )
    if next_at is not None:
        # A moved kickoff moves the pending check too, instead of one wasted call.
        conn.execute(
            "UPDATE ops.fetch_jobs SET run_after=%s, updated_at=%s WHERE family='summary' AND entity_type='match' AND entity_id=%s AND state='pending'",
            (next_at, instant, match_id),
        )
    return new_state


def after_summary(conn, match_id, *, kickoff_at, status, now, summary_changed=False):
    """Watch transition after a summary was written and its job acknowledged.

    Returns the new watch state. Caller owns the transaction (the same one as the ack,
    so the next summary job is not blocked by the active-target uniqueness).
    """
    from .jobs import DETAIL_FAMILIES, after_finished

    instant = _aware(now)
    row = conn.execute(
        "SELECT state FROM ops.match_watch WHERE match_id=%s FOR UPDATE", (match_id,)
    ).fetchone()
    state = row[0] if row else None
    next_at = None
    if status == "finished":
        if state == "final":
            new_state = "corrected"
            if summary_changed:
                # The provider corrected the match: details are fetched once more.
                for family in DETAIL_FAMILIES:
                    enqueue_or_revive(
                        conn,
                        "details",
                        family,
                        entity_type="match",
                        entity_id=match_id,
                        run_after=instant,
                        priority=PRIORITY["details"],
                    )
        elif state == "corrected":
            new_state = state
        else:
            new_state, next_at = "final", instant + CORRECTION_DELAY
            after_finished(
                conn,
                match_id,
                instant,
                detail_priority=PRIORITY["details"],
                correction_priority=PRIORITY["summary"],
            )
    elif status in TERMINAL:
        new_state = "stopped"
    else:
        next_at = next_score_check(kickoff_at, instant) if kickoff_at else None
        if next_at is None:
            new_state = "stopped"
            if kickoff_at is not None:
                conn.execute(
                    "INSERT INTO ops.data_warnings(match_id, kind, detail) VALUES(%s,'score_never_final',%s) ON CONFLICT(match_id, kind) DO UPDATE SET detail=EXCLUDED.detail, detected_at=now()",
                    (match_id, status),
                )
        else:
            new_state = (
                "waiting_final"
                if instant >= kickoff_at + FIRST_SCORE_CHECK
                else "scheduled"
            )
            enqueue(
                conn,
                "score",
                "summary",
                entity_type="match",
                entity_id=match_id,
                run_after=next_at,
                priority=PRIORITY["summary"],
            )
    conn.execute(
        """INSERT INTO ops.match_watch(match_id, next_check_at, checks, state, last_status, kickoff_at, updated_at)
           VALUES(%s,%s,1,%s,%s,%s,%s)
           ON CONFLICT(match_id) DO UPDATE SET next_check_at=EXCLUDED.next_check_at,
             checks=LEAST(ops.match_watch.checks + 1, 32767), state=EXCLUDED.state,
             last_status=EXCLUDED.last_status, kickoff_at=EXCLUDED.kickoff_at, updated_at=EXCLUDED.updated_at""",
        (match_id, next_at, new_state, status, kickoff_at, instant),
    )
    return new_state


def stop_watch(conn, match_id, *, now):
    """A summary that can never succeed (permanent failure) ends the watch."""
    conn.execute(
        "UPDATE ops.match_watch SET state='stopped', next_check_at=NULL, updated_at=%s WHERE match_id=%s AND state IN ('scheduled','waiting_final','final')",
        (_aware(now), match_id),
    )


# Backfill -----------------------------------------------------------------

BACKFILL_FAMILIES = ("summary", "shots", "events", "lineups", "momentum", "team_stats", "player_stats",
                     "player_halves", "advanced", "advanced_players", "network", "heatmaps", "h2h")


def current_season(now):
    """Start year of the sporting season running on `now` (July starts a season)."""
    return now.year if now.month >= 7 else now.year - 1


def plan_backfill(conn, now=None, *, first_season=2021, last_season=None, competitions=None, limit=2000):
    """History, for the separate backfill task: each edition's season calendar once,
    then the 13 families of every finished match that lacks them, recent first, at most
    `limit` jobs per call and none while the lane still holds `limit` pending jobs, so the
    queue stays bounded. Progress lands in ops.collection_progress. No watch and no
    +24 h correction: those belong to the live planner."""
    instant = _aware(now) if now is not None else datetime.now(timezone.utc)
    last = current_season(instant) if last_season is None else last_season
    counts = Counter()
    with conn.transaction():
        if not conn.execute(
            "SELECT pg_try_advisory_xact_lock(hashtextextended('vega_v2_backfill_planner',0))"
        ).fetchone()[0]:
            return counts
        scope = """FROM core.competition_seasons cs
                   JOIN core.provider_ids p ON p.entity_type='competition' AND p.provider='pitchapi' AND p.entity_id=cs.competition_id AND p.is_current
                   WHERE cs.season_id BETWEEN %(first)s AND %(last)s AND (%(competitions)s::text[] IS NULL OR p.provider_key = ANY(%(competitions)s))"""
        params = {"first": first_season, "last": last, "competitions": competitions, "limit": limit,
                  "families": list(BACKFILL_FAMILIES)}
        editions = [r[0] for r in conn.execute(f"SELECT cs.id {scope} ORDER BY cs.season_id DESC, cs.id", params)]
        for edition in editions:
            done = conn.execute(
                "SELECT 1 FROM ops.collection_progress WHERE source='pitchapi' AND competition_season_id=%s AND family='league_matches' AND last_success_at IS NOT NULL",
                (edition,),
            ).fetchone()
            if not done and enqueue(conn, "backfill", "league_matches", competition_season_id=edition, run_after=instant):
                counts["league_matches"] += 1
        # The lane already holds a full batch: nothing to add this round. Without this
        # test every round looked for 2,000 more jobs among all the matches, until the
        # whole history was queued at once (949,000 jobs on 10 November 2026), and then
        # kept reading it all for nothing: up to 35 s a minute of the task that fetches.
        queued = conn.execute(
            "SELECT count(*) FROM (SELECT 1 FROM ops.fetch_jobs WHERE lane='backfill' AND state='pending' LIMIT %s) q",
            (limit,),
        ).fetchone()[0]
        missing = [] if queued >= limit else conn.execute(
            """SELECT m.id, f.family FROM core.matches m
               CROSS JOIN unnest(%(families)s::text[]) AS f(family)
               WHERE m.status = 'finished' AND m.competition_season_id = ANY(%(editions)s)
                 AND NOT EXISTS (SELECT 1 FROM ops.family_state s WHERE s.match_id = m.id AND s.family::text = f.family
                                 AND s.status IN ('ok', 'unavailable'))
                 AND NOT EXISTS (SELECT 1 FROM ops.fetch_jobs j WHERE j.entity_type = 'match' AND j.entity_id = m.id
                                 AND j.family::text = f.family AND j.state <> 'done')
               ORDER BY m.kickoff_at DESC NULLS LAST, m.id, f.family LIMIT %(limit)s""",
            {**params, "editions": editions},
        ).fetchall()
        for mid, family in missing:
            if enqueue(conn, "backfill", family, entity_type="match", entity_id=mid, run_after=instant):
                counts[family] += 1
        _progress(conn, editions)
    return +counts


def _progress(conn, editions):
    """Expected, done, empty and failed match families per edition (13 per finished match)."""
    conn.execute(
        """INSERT INTO ops.collection_progress(source, competition_season_id, family, expected, done, empty, failed, last_success_at, updated_at)
           SELECT 'pitchapi', m.competition_season_id, f.family::ops.fetch_family, count(*),
             count(*) FILTER (WHERE s.status = 'ok'), count(*) FILTER (WHERE s.status = 'unavailable'),
             count(*) FILTER (WHERE s.status = 'error'), max(s.last_success_at), now()
           FROM core.matches m
           CROSS JOIN unnest(%s::text[]) AS f(family)
           LEFT JOIN ops.family_state s ON s.match_id = m.id AND s.family::text = f.family
           WHERE m.status = 'finished' AND m.competition_season_id = ANY(%s)
           GROUP BY m.competition_season_id, f.family
           ON CONFLICT (source, competition_season_id, family) DO UPDATE SET expected = EXCLUDED.expected,
             done = EXCLUDED.done, empty = EXCLUDED.empty, failed = EXCLUDED.failed,
             last_success_at = EXCLUDED.last_success_at, updated_at = now()""",
        (list(BACKFILL_FAMILIES), editions),
    )
