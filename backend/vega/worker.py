"""Worker loop: planner + collector + calculator in one long-running task.

Each loop: plan (every minute), claim one job (lanes in priority order: score, then
details, then reference; backfill runs in its own task), call PitchAPI, write core in
one transaction with the job acknowledgement, and drain ops.dirty_scopes with the
calculator when the queues are idle or every 30 s. Components only meet in PostgreSQL.

The side work (the daily pass: statistics, sources, Elo and season models; the image
copies) runs in the loop by default, and in a process of its own in the deployed worker
(--side-work process, SideProcess): the collection then never waits for it.
"""

import argparse
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
import os
import signal
import subprocess
import sys
import time
import traceback

import psycopg

from . import calculator, media, models, planner, profiles
from .jobs import LeaseLost, ack, claim, fail
from .normalize import NormalizedFamily, NormalizationError, normalize_family
from .pilot import DETAILS, safe_code
from .pitchapi import PitchClient, PitchError
from .store import CONNECTION, Store, StoreError, connect_local, migrate

DEFAULT_LANES = ("score", "details", "reference")
LANE_ORDER = ("score", "details", "reference", "backfill")
DETAIL_ENDPOINTS = {family: (suffix, parser) for family, suffix, parser in DETAILS}
TRANSIENT = frozenset(
    (
        "HTTP_SERVER_ERROR",
        "TRANSPORT_ERROR",
        "RATE_LIMIT_EXCEEDED",
        "PROVIDER_ERROR",
        "INTERNAL_SERVER_ERROR",
        "INVALID_JSON",
        "INVALID_ENVELOPE",
    )
)
MAX_ATTEMPTS = 5
SUMMARY_FIELDS = ("status", "home_score", "away_score", "home_penalty_score", "away_penalty_score")
LEASE_SECONDS = 300
# A lost database (worker.keep_running): first and longest wait between two
# reconnections, how long a session must hold to count as healthy, and how long the task
# keeps trying. A resize takes about 4 minutes, a memory recovery about 3.
RECONNECT_WAIT = (5, 60)
HEALTHY_AFTER = 300
RECONNECT_FOR = 1800


def _now():
    return datetime.now(timezone.utc)


# A season whose matches changed after its last daily models waits this long before the
# models run again (a backfill writes a season's matches for hours).
RECOMPUTE_AFTER = timedelta(hours=1)
# A step of the daily pass that failed waits this long before it is tried again. Without
# the wait a season whose models fail stays due, and every planning round runs the Elo of
# every match again before failing at the same place.
RETRY_DAILY_AFTER = timedelta(hours=1)


# The side work on its own rhythm (side_loop): a daily pass every minute (it does
# nothing when nothing is due), the image copies every five.
SIDE_DAILY_EVERY = 60
SIDE_MEDIA_EVERY = 300


def error_code(error):
    """The log code of any error. A database or provider error keeps its own code; any
    other one (a bug of ours) gives its class and where it was raised, never its text."""
    if isinstance(error, (psycopg.Error, PitchError, NormalizationError, StoreError)):
        return safe_code(error)
    frames = traceback.extract_tb(error.__traceback__)
    where = f"@{os.path.basename(frames[-1].filename)}:{frames[-1].lineno}" if frames else ""
    return "WORKER_" + type(error).__name__.upper()[:50] + where


def due_seasons(conn, now):
    """The seasons whose daily models are due:
    - a season played in the last 30 days, once a UTC day;
    - a season with finished matches never computed (a backfilled one);
    - a season whose matches changed after its last computation (a backfill that went on,
      a correction), once RECOMPUTE_AFTER has passed since that computation;
    - a season played in the last 400 days (the season in progress and the award year
      before it) whose player ranking was computed by another version of the method
      (power.METHOD_VERSION), or read another common scale of the leagues than the
      present one (a league joined it since), after the same wait: neither waits for the
      next day, nor for a match of the season to change.
    - a season with matches still to play and no forecast of them (forecast.py: the
      forecasts are new to it, or its last pass stopped before them), after the same wait.
    - a season played in the last 400 days whose shots have no Vega expected goals (xg.py:
      the values are new to it), after the same wait, when a model exists or the base
      holds enough shots to fit one.
    - a season played in the last 400 days without the players' profile vectors
      (embedding.py), after the same wait, when it has enough players to learn the axes.
    - a season played in the last 30 days while no in-play model exists (inplay.py), after
      the same wait, when there is a forecast model and enough goal events to fit one.
    - a season played in the last 400 days with a published player ranking and no breakout
      run of the present rule (breakout.MODEL_VERSION), after the same wait. For a season
      that is over this is a whole pass, once per rule: its player ranking filled the 2 GB
      the task had until 13 November 2026 (infra/aws/worker.yaml), which is why the season
      in progress runs first.
    - a season played in the last 30 days while no return curve exists (returns.py), after
      the same wait, in a base with enough appearances to learn one.
    Only PitchAPI editions count: the models read nothing of the archives and cups (whose
    seasons would otherwise all fall due when they are imported)."""
    from .power import METHOD_VERSION
    from .embedding import MIN_MINUTES as PROFILE_MIN_MINUTES, MIN_PLAYERS as PROFILE_MIN_PLAYERS
    from .breakout import MODEL_VERSION as BREAKOUT_VERSION
    from .inplay import MIN_FIT as INPLAY_MIN_FIT
    from .xg import MIN_FIT as XG_MIN_FIT

    return [
        s
        for (s,) in conn.execute(
            """WITH last AS (
                 SELECT DISTINCT ON (cohort_definition) cohort_definition, started_at FROM agg.calc_runs
                 WHERE kind = 'levels' AND status = 'published' ORDER BY cohort_definition, started_at DESC)
               SELECT m.season_id FROM core.matches m
               JOIN core.competition_seasons cs ON cs.id = m.competition_season_id AND cs.archive_key IS NULL AND cs.cup_key IS NULL
               LEFT JOIN last l ON l.cohort_definition = 'season:' || m.season_id
               GROUP BY m.season_id, l.started_at
               HAVING (l.started_at IS NULL AND bool_or(m.status = 'finished'))
                   OR (bool_or(m.kickoff_at > %(now)s - interval '30 days' AND m.kickoff_at <= %(now)s)
                       AND (l.started_at IS NULL OR l.started_at < date_trunc('day', %(now)s)))
                   OR (l.started_at < %(now)s - %(after)s
                       AND max(m.updated_at) FILTER (WHERE m.status = 'finished') > l.started_at)
                   OR (l.started_at < %(now)s - %(after)s
                       AND bool_or(m.kickoff_at > %(now)s - interval '400 days' AND m.kickoff_at <= %(now)s)
                       AND EXISTS (SELECT 1 FROM agg.power_runs r
                                   WHERE r.kind = 'players' AND r.season_id = m.season_id AND r.status = 'published'
                                     AND (r.method_version <> %(method)s
                                          OR r.linked_leagues IS DISTINCT FROM (SELECT count(*) FROM agg.league_levels WHERE linked))))
                   OR (l.started_at < %(now)s - %(after)s
                       AND bool_or(m.status = 'not_started' AND m.kickoff_at > %(now)s)
                       AND NOT EXISTS (SELECT 1 FROM agg.match_forecasts f WHERE f.season_id = m.season_id))
                   OR (l.started_at < %(now)s - %(after)s
                       AND bool_or(m.kickoff_at > %(now)s - interval '400 days' AND m.kickoff_at <= %(now)s)
                       AND EXISTS (SELECT 1 FROM core.shots sh WHERE sh.season_id = m.season_id)
                       AND NOT EXISTS (SELECT 1 FROM agg.shot_xg v WHERE v.season_id = m.season_id)
                       AND (EXISTS (SELECT 1 FROM agg.xg_models)
                            OR EXISTS (SELECT 1 FROM core.shots OFFSET %(shots)s LIMIT 1)))
                   OR (l.started_at < %(now)s - %(after)s
                       AND bool_or(m.kickoff_at > %(now)s - interval '400 days' AND m.kickoff_at <= %(now)s)
                       AND NOT EXISTS (SELECT 1 FROM agg.embedding_models e WHERE e.season_id = m.season_id)
                       AND (SELECT count(*) FROM (SELECT 1 FROM agg.player_season_stats s WHERE s.season_id = m.season_id
                                                  GROUP BY s.player_id HAVING sum(s.minutes) >= %(profile_minutes)s
                                                  LIMIT %(profiles)s) q) >= %(profiles)s)
                   OR (l.started_at < %(now)s - %(after)s
                       AND bool_or(m.kickoff_at > %(now)s - interval '30 days' AND m.kickoff_at <= %(now)s)
                       AND NOT EXISTS (SELECT 1 FROM agg.inplay_models)
                       AND EXISTS (SELECT 1 FROM agg.forecast_models)
                       AND EXISTS (SELECT 1 FROM core.match_events g WHERE g.event_type = 'goal' OFFSET %(goals)s LIMIT 1))
                   OR (l.started_at < %(now)s - %(after)s
                       AND bool_or(m.kickoff_at > %(now)s - interval '400 days' AND m.kickoff_at <= %(now)s)
                       AND NOT EXISTS (SELECT 1 FROM agg.breakout_runs b WHERE b.season_id = m.season_id AND b.version = %(breakout)s)
                       AND EXISTS (SELECT 1 FROM agg.power_runs r
                                   WHERE r.kind = 'players' AND r.season_id = m.season_id AND r.status = 'published'))
                   OR (l.started_at < %(now)s - %(after)s
                       AND bool_or(m.kickoff_at > %(now)s - interval '30 days' AND m.kickoff_at <= %(now)s)
                       AND NOT EXISTS (SELECT 1 FROM agg.return_curves)
                       AND EXISTS (SELECT 1 FROM core.player_match_stats a WHERE a.minutes_played > 0 OFFSET %(appearances)s LIMIT 1))
               ORDER BY 1""",
            {"now": now, "after": RECOMPUTE_AFTER, "method": METHOD_VERSION, "shots": XG_MIN_FIT, "goals": INPLAY_MIN_FIT, "appearances": RETURNS_MIN_APPEARANCES, "breakout": BREAKOUT_VERSION,
             "profiles": PROFILE_MIN_PLAYERS, "profile_minutes": PROFILE_MIN_MINUTES},
        ).fetchall()
    ]


# Appearances a base must hold before a return curve is looked for (returns.py): below, no
# length of absence would gather the returns a point of the curve needs.
RETURNS_MIN_APPEARANCES = 100000

# The publication generation (the site's fence and cache key) advances at most this often.
PUBLISH_EVERY = timedelta(minutes=5)


def publish(conn, now, *, force=False):
    """Advance the publication when a resource changed since the last one, at most every
    PUBLISH_EVERY (or now, with force): the generation is the sum of the resource versions
    at that moment, so it only grows. Returns the new generation, or None."""
    args = {"now": now, "force": force, "every": PUBLISH_EVERY}
    totals = "(SELECT coalesce(sum(version), 0)::bigint AS total FROM ops.resource_versions) v"
    due = "p.source_version <> v.total AND (%(force)s OR p.published_at <= %(now)s - %(every)s)"
    with conn.transaction():
        if conn.execute(f"SELECT 1 FROM ops.publication p, {totals} WHERE {due}", args).fetchone() is None:
            return None
        # The editions the reads and the manifest list (agg.editions, 045), as of this generation.
        conn.execute("SELECT ops.refresh_editions()")
        row = conn.execute(
            f"UPDATE ops.publication p SET generation = v.total, source_version = v.total, published_at = %(now)s FROM {totals} WHERE {due} RETURNING p.generation",
            args,
        ).fetchone()
    return row[0] if row else None


class Worker:
    def __init__(self, store, client, *, lanes=DEFAULT_LANES, clock=_now, cohort_delay=600, calc_conn=None, backfill=None, source_get=None, media_io=None):
        unknown = set(lanes) - set(LANE_ORDER)
        if unknown or not lanes:
            raise ValueError("invalid lanes")
        self.store = store
        self.conn = store.conn
        # Collect role for the queue and core; calc role for agg (doc "Rôles en base").
        self.calc_conn = calc_conn or store.conn
        self.client = client
        self.lanes = tuple(lane for lane in LANE_ORDER if lane in lanes)
        self.clock = clock
        self.cohort_delay = cohort_delay
        self.source_get = source_get  # sources other than PitchAPI; None disables them
        self.media_io = media_io  # (download, put) of the image copies; None disables them
        # The backfill task plans history only (planner.plan_backfill keyword arguments).
        self.backfill = backfill if backfill is not None else ({} if self.lanes == ("backfill",) else None)
        self.results = Counter()
        self.done = 0  # jobs run since this worker started, across run() calls
        self._analyzed = None  # UTC day of the last ops.analyze_partitioned()
        self._archives = None  # UTC day of the last agg.refresh_archive_seasons()
        self._retry_at = {}  # step of the daily pass that failed -> when it is tried again
        # SideProcess when the daily pass and the image copies run in a process of their own.
        self.side_process = None
        self._events = []
        client._on_attempt = self._events.append

    # Transport -----------------------------------------------------------

    def fetch(self, family, endpoint, params=None, *, job=None):
        """One provider call; every attempt lands in ops.fetch_log with the job target."""
        self._events.clear()
        try:
            return self.client.fetch(endpoint, params)
        finally:
            target = job or {}
            for event in self._events:
                self.store.log_attempt(
                    family,
                    event,
                    entity_type=target.get("entity_type"),
                    entity_id=target.get("entity_id"),
                    competition_season_id=target.get("competition_season_id"),
                    target_date=target.get("target_date"),
                    global_key=target.get("global_key"),
                )

    def hydrate(self, batch):
        """Fetch competitions and teams a response names without describing them."""
        grouped = defaultdict(dict)
        for ref in batch.references:
            if ref.provider_key and ref.entity_type in ("competition", "team"):
                grouped[(ref.entity_type, ref.provider_key)].update(
                    {k: v for k, v in ref.fields.items() if v is not None}
                )
        for (kind, key), fields in sorted(grouped.items()):
            if fields.get("name") or self.store.has(kind, key):
                continue
            if kind == "team":
                profile = normalize_family("team", self.fetch("team", "/teams/" + key).data)
                profiles.save_profile(self.store, "team", key, profile)
            else:
                profile = normalize_family("league", self.fetch("league", "/leagues/" + key).data)
                self.store.save_references(profile, family="league")

    def _provider_key(self, kind, ident):
        row = self.conn.execute(
            "SELECT provider_key FROM core.provider_ids WHERE entity_type=%s AND provider='pitchapi' AND entity_id=%s AND is_current",
            (kind, ident),
        ).fetchone()
        if not row:
            raise StoreError("UNRESOLVED_REFERENCE")
        return row[0]

    def _own(self, job):
        """Inside a transaction: the lease must still be ours before any write."""
        if not self.conn.execute(
            "SELECT 1 FROM ops.fetch_jobs WHERE id=%s AND lease_token=%s AND state='leased' AND lease_until>clock_timestamp() FOR UPDATE",
            (job["id"], job["lease_token"]),
        ).fetchone():
            raise StoreError("LEASE_LOST")

    # Loop ----------------------------------------------------------------

    def claim_next(self):
        for lane in self.lanes:
            job = claim(self.conn, lane, now=self.clock(), lease_seconds=LEASE_SECONDS)
            if job:
                return job
        return None

    def step(self):
        """Claim and run one job; False when every lane is empty."""
        job = self.claim_next()
        if not job:
            return False
        family = job["family"]
        handler = {
            "calendar": self.calendar,
            "league_matches": self.league_matches,
            "league": self.league,
            "team": self.profile,
            "player": self.profile,
            "summary": self.summary,
        }.get(family, self.details)
        reason = None
        try:
            handler(job)
            code = "ok"
        except LeaseLost:
            code = "LEASE_LOST"
        except (PitchError, NormalizationError, StoreError, psycopg.Error) as error:
            code = safe_code(error)
            # Why the provider refused (pitchapi._access_reason: a category, never its text).
            reason = getattr(error, "access_reason", None)
        except Exception as error:  # a bug must not crash-loop on the same job
            code = "WORKER_" + type(error).__name__.upper()[:50]
        self.results[(family, code)] += 1
        if code not in ("ok", "LEASE_LOST"):
            self.failed(job, code)
            print(f"family={family} job={job['id']} error={code}" + (f" reason={reason}" if reason else ""), flush=True)
        return True

    def failed(self, job, code):
        retry = code in TRANSIENT and job["attempts"] < MAX_ATTEMPTS
        lease = (job["id"], job["lease_token"])
        family = job["family"]
        try:
            if family in ("team", "player"):
                key = self._provider_key(family, job["entity_id"])
                profiles.record_failure(self.store, family, key, code, lease, retry=retry)
                return
            with self.conn.transaction():
                if job["entity_type"] == "match":
                    self.store.record_failure(job["entity_id"], family, code, lease=lease)
                    if family == "summary" and not retry:
                        planner.stop_watch(self.conn, job["entity_id"], now=self.clock())
                else:
                    self.conn.execute(
                        "INSERT INTO ops.parse_failures(family,entity_type,entity_id,target_date,competition_season_id,global_key,error_code,message) VALUES(%s,%s,%s,%s,%s,%s,%s,%s)",
                        (
                            family,
                            job["entity_type"],
                            job["entity_id"],
                            job["target_date"],
                            job["competition_season_id"],
                            job["global_key"],
                            code,
                            code,
                        ),
                    )
                fail(self.conn, *lease, code, retry=retry, now=self.clock())
        except (LeaseLost, StoreError):
            self.results[(family, "LEASE_LOST")] += 1

    # The calculations, the daily pass, the image copies and the planner run in the
    # collection's own process: whatever fails in them is logged and the loop goes on. An
    # error that left one of them (anything but a database error, until 10 November 2026)
    # ended the process; the task started again, ran the daily pass before its first job,
    # failed at the same place, and collected nothing for as long as the season stayed due.

    def calculate(self, limit=500):
        """Season aggregates first, then the cohorts they changed (debounced)."""
        try:
            done = calculator.process_dirty(self.calc_conn, limit=limit)
            return done + models.process_cohorts(self.calc_conn, min_age_seconds=self.cohort_delay)
        except Exception as error:
            print(f"calculator error={error_code(error)}", flush=True)
            return 0

    def _daily_step(self, step, now, call):
        """Run one step of the daily pass unless it failed less than RETRY_DAILY_AFTER ago;
        (True, its result), or (False, None) when it waited or failed."""
        name = " ".join(str(part) for part in step)
        if now < self._retry_at.get(step, now):
            return False, None
        try:
            result = call()
        except Exception as error:
            self._retry_at[step] = now + RETRY_DAILY_AFTER
            print(f"daily step={name} error={error_code(error)} retry_at={self._retry_at[step].isoformat(timespec='seconds')}", flush=True)
            return False, None
        self._retry_at.pop(step, None)
        return True, result

    def daily(self):
        """Levels, competition strength, squad profiles, similarities and power rankings
        (models.refresh_daily) for the seasons due_seasons() names, then the action values
        of the seasons that lack them. Each step stands alone: one that fails is logged and
        waits RETRY_DAILY_AFTER, the others run."""
        now = self.clock()
        scalar = lambda sql: lambda: self.calc_conn.execute(sql).fetchone()[0]
        if self._analyzed != now.date():
            # Autovacuum analyses each partition, never the partitioned table itself (056).
            ok, tables = self._daily_step(("analyze",), now, scalar("SELECT ops.analyze_partitioned()"))
            if ok:
                self._analyzed = now.date()
                print(f"analyze partitioned tables={tables}", flush=True)
        if self._archives != now.date():
            # The archive index's counts per season (058): an import, or goals a collected
            # match brought to an archive match, show in the index at this pass.
            ok, changed = self._daily_step(("archives",), now, scalar("SELECT agg.refresh_archive_seasons()"))
            if ok:
                self._archives = now.date()
                print(f"archive seasons changed={changed}", flush=True)
        _, due = self._daily_step(("due",), now, lambda: due_seasons(self.calc_conn, now))
        # A season whose models failed stays due: it waits like any failed step. The most
        # recent season first: a past season's ranking is the pass that takes the most memory,
        # and when the task is killed on it the season in progress must already be done.
        seasons = sorted((season for season in due or [] if now >= self._retry_at.get(("season", season), now)), reverse=True)
        if self.source_get is not None:
            # Rankings and other sources first: the levels read the UEFA coefficients.
            from . import sources
            from .sources import uefa

            def run_sources():
                for (name, scope), outcome in sources.run_due(self.conn, self.source_get, now).items():
                    print(f"source={name} scope={scope} outcome={outcome}", flush=True)
                with self.conn.transaction():
                    uefa.reconcile_teams(self.conn)

            self._daily_step(("sources",), now, run_sources)
        if seasons:
            # The Elo covers every match in order: once for the pass, never once per season
            # (with ~140 archive seasons due at once it rewrote agg.team_elo 95 times).
            from . import power

            self._daily_step(("elo",), now, lambda: power.refresh_elo(self.calc_conn))
        for season in seasons:
            ok, _ = self._daily_step(("season", season), now, lambda: models.refresh_daily(self.calc_conn, season, elo=False))
            if ok:
                print(f"daily models season={season} outcome=ok", flush=True)
        # The action values of a season whose ranking exists and that has none of the present
        # version (actions.py): one statement, so such a season never becomes due for a whole
        # pass because of them (a past season's pass is its whole ranking again).
        from . import actions

        _, waiting = self._daily_step(("actions",), now, lambda: actions.pending(self.calc_conn))
        for season in waiting or []:
            ok, counts = self._daily_step(("actions", season), now, lambda: actions.refresh(self.calc_conn, season))
            if ok:
                print(f"action values season={season} players={counts[0]} placed={counts[1]}", flush=True)
        return seasons

    def mirror(self, limit=200):
        """Copies of the images seen since the last pass (media.py)."""
        if self.media_io is None:
            return {}
        try:
            outcomes = media.mirror(self.conn, *self.media_io, self.clock(), limit=limit)
        except Exception as error:
            print(f"media error={error_code(error)}", flush=True)
            return {}
        for code, count in sorted(outcomes.items()):
            print(f"media outcome={code} count={count}", flush=True)
        return outcomes

    def backfill_references(self):
        """The leagues a backfill names, read first from the league catalogue (the one
        endpoint that lists every season of a league; a league's own profile names only
        the current one), so a past edition can be planned on a base whose weekly
        catalogue has not run yet."""
        wanted = set((self.backfill or {}).get("competitions") or [])
        if not wanted:
            return
        try:
            data = self.fetch("league", "/leagues").data
        except PitchError as error:
            self.results[("league", safe_code(error))] += 1
            return
        for entry in (data.get("leagues") or []) if isinstance(data, dict) else []:
            if not isinstance(entry, dict) or entry.get("id") not in wanted:
                continue
            try:
                with self.conn.transaction():
                    self.store.save_references(normalize_family("league", entry), family="league")
            except (NormalizationError, StoreError, psycopg.Error) as error:
                self.results[("league", safe_code(error))] += 1

    def run(self, *, max_jobs=None, until_idle=False, plan_every=60, calc_every=30, media_every=300, idle_sleep=5, stop=None):
        stop = stop or (lambda: False)
        done = 0
        if self.backfill is not None:
            self.backfill_references()
        last_plan = last_calc = last_media = float("-inf")
        since_plan = 0  # jobs done since the last planning round
        while not stop():
            # The steps below report a database error and go on; without a database the
            # run ends here and keep_running opens a new one.
            if self.conn.closed or self.calc_conn.closed:
                raise psycopg.OperationalError("connection lost")
            tick = time.monotonic()
            if tick - last_plan >= plan_every:
                since_plan = 0
                try:
                    if self.backfill is None:
                        planner.plan(self.conn, self.clock())
                    else:
                        planner.plan_backfill(self.conn, self.clock(), **self.backfill)
                except Exception as error:
                    print(f"planner error={error_code(error)}", flush=True)
                if self.side_process is not None:
                    self.side_process.tick()
                elif self.backfill is None:
                    self.daily()
                self.publish()
                # Counted from the end of the round: `plan_every` seconds of fetching between
                # two rounds, however long a round lasts (rounds of 35 s counted from their
                # start left the backfill 25 s a minute to fetch, 10 November 2026).
                last_plan = time.monotonic()
            if self.backfill is None and self.side_process is None and tick - last_media >= media_every:
                self.mirror()
                last_media = tick
            worked = self.step()
            done += worked
            self.done += worked
            since_plan += worked
            if not worked or tick - last_calc >= calc_every:
                self.calculate()
                last_calc = tick
            if max_jobs is not None and done >= max_jobs:
                break
            if not worked:
                if until_idle:
                    # Jobs just done can give the planner work (a calendar, then its matches'
                    # families): plan once more, and stop only after a round that adds none.
                    if since_plan:
                        last_plan = float("-inf")
                        continue
                    break
                time.sleep(idle_sleep)
        self.calculate()
        self.publish(force=True)
        return done

    def publish(self, *, force=False):
        try:
            generation = publish(self.conn, self.clock(), force=force)
            if generation is not None:
                print(f"publication generation={generation}", flush=True)
        except Exception as error:
            print(f"publication error={error_code(error)}", flush=True)

    # Handlers ------------------------------------------------------------

    def _save_calendar(self, batch, job, *, family):
        """Matches of a calendar response, grouped by edition, then their watches."""
        now = self.clock()
        groups = defaultdict(list)
        for row in batch.rows.get("core.matches", []):
            groups[(row.get("provider_competition_id"), row.get("provider_season"))].append(row)
        with self.conn.transaction():
            self._own(job)
            self.store.save_references(
                NormalizedFamily(references=batch.references, unknown_paths=batch.unknown_paths),
                family=family,
            )
            for (competition, season), rows in sorted(groups.items(), key=lambda g: (str(g[0][0]), str(g[0][1]))):
                try:
                    with self.conn.transaction():
                        self._save_group(competition, season, rows, family, now)
                except StoreError:
                    # One moved or unreadable match must not cost the other matches of
                    # the day: the group is replayed match by match, failures logged.
                    for row in rows:
                        try:
                            with self.conn.transaction():
                                self._save_group(competition, season, [row], family, now)
                        except StoreError as error:
                            self.conn.execute(
                                "INSERT INTO ops.parse_failures(family,target_date,competition_season_id,error_code,message) VALUES(%s,%s,%s,%s,%s)",
                                (family, job["target_date"], job["competition_season_id"], str(error), str(error)),
                            )
                            self.results[(family, str(error))] += 1
            ack(self.conn, job["id"], job["lease_token"], now=now)

    def _defer_to_summary(self, rows):
        """Once /matches/{id} has given a final result, calendars no longer rewrite it.

        A calendar can be staler than the match endpoint: without this, a day's
        calendar would put back the score that the +24 h correction just fixed.
        """
        final = {
            key
            for (key,) in self.conn.execute(
                """SELECT p.provider_key FROM core.provider_ids p
                   JOIN core.matches m ON m.id = p.entity_id
                   JOIN ops.family_state f ON f.match_id = m.id AND f.family = 'summary' AND f.status = 'ok'
                   WHERE p.entity_type = 'match' AND p.provider = 'pitchapi'
                     AND p.provider_key = ANY(%s) AND m.status = 'finished'""",
                ([row["id"] for row in rows],),
            )
        }
        return [
            {k: v for k, v in row.items() if k not in SUMMARY_FIELDS} if row["id"] in final else row
            for row in rows
        ]

    def _save_group(self, competition, season, rows, family, now):
        edition = self._edition_for(competition, season, rows)
        ids = self.store.save_matches(
            NormalizedFamily(rows={"core.matches": self._defer_to_summary(rows)}), edition, family=family
        )
        today = now.date()
        for mid, row in zip(ids, rows):
            kickoff = row.get("kickoff_at")
            # Watches come from the J-1..J+7 date calendar. A season calendar only moves
            # an existing watch or opens one in that window; history is the backfill's job.
            if not (
                family == "calendar"
                or (kickoff is not None and -1 <= (kickoff.date() - today).days <= 7)
                or self.conn.execute("SELECT 1 FROM ops.match_watch WHERE match_id=%s", (mid,)).fetchone()
            ):
                continue
            planner.observe(
                self.conn,
                mid,
                kickoff_at=row.get("kickoff_at"),
                status=row.get("status"),
                now=now,
            )

    def _edition_for(self, competition, season, rows):
        if competition is not None and season is not None:
            edition, _ = self.store.edition(self.store.resolve("competition", competition), season)
            return edition
        # No edition in the payload: a known match keeps the edition it was stored under.
        known = {
            self.conn.execute(
                "SELECT m.competition_season_id FROM core.matches m JOIN core.provider_ids p ON p.entity_type='match' AND p.provider='pitchapi' AND p.entity_id=m.id WHERE p.provider_key=%s",
                (row["id"],),
            ).fetchone()
            for row in rows
        }
        if len(known) == 1 and None not in known:
            return known.pop()[0]
        # /date gives the competition but not the edition: a new match belongs to the
        # competition's current edition; the weekly season calendar, which names the
        # edition, then confirms it (MATCH_SEASON_CHANGED otherwise, kept visible).
        if competition is not None and None in known and len(known) == 1:
            row = self.conn.execute(
                "SELECT id FROM core.competition_seasons WHERE competition_id=%s ORDER BY is_current DESC NULLS LAST, season_id DESC LIMIT 1",
                (self.store.resolve("competition", competition),),
            ).fetchone()
            if row:
                return row[0]
        raise StoreError("MATCH_SEASON_UNKNOWN")

    def ensure_editions(self, batch):
        """Competitions named without an edition, and with none known yet: fetch them."""
        keys = {
            row["provider_competition_id"]
            for row in batch.rows.get("core.matches", [])
            if row.get("provider_competition_id") and not row.get("provider_season")
        }
        for key in sorted(keys):
            known = self.conn.execute(
                """SELECT 1 FROM core.competition_seasons cs JOIN core.provider_ids p
                     ON p.entity_type='competition' AND p.provider='pitchapi' AND p.entity_id=cs.competition_id
                   WHERE p.provider_key=%s LIMIT 1""",
                (key,),
            ).fetchone()
            if not known:
                profile = normalize_family("league", self.fetch("league", "/leagues/" + key).data)
                self.store.save_references(profile, family="league")

    def calendar(self, job):
        day = job["target_date"]
        result = self.fetch("calendar", "/date/" + day.isoformat(), {"status": "all"}, job=job)
        batch = normalize_family("date", result.data)
        self.hydrate(batch)
        self.ensure_editions(batch)
        self._save_calendar(batch, job, family="calendar")

    def league_matches(self, job):
        edition = job["competition_season_id"]
        competition, label = self.conn.execute(
            "SELECT competition_id, native_label FROM core.competition_seasons WHERE id=%s",
            (edition,),
        ).fetchone()
        key = self._provider_key("competition", competition)
        result = self.fetch(
            "league_matches",
            "/leagues/" + key + "/matches",
            {"season": label, "status": "all"},
            job=job,
        )
        identity = result.data.get("league", {}) if isinstance(result.data, dict) else {}
        if identity.get("id") != key or identity.get("season", label) != label:
            raise StoreError("CALENDAR_IDENTITY_MISMATCH")
        batch = normalize_family("league_matches", result.data)
        self.hydrate(batch)
        for row in batch.rows.get("core.matches", []):
            row.setdefault("provider_competition_id", key)
            row.setdefault("provider_season", label)
        self._save_calendar(batch, job, family="league_matches")
        self.conn.execute(
            """INSERT INTO ops.collection_progress(source, competition_season_id, family, expected, done, last_success_at)
               VALUES ('pitchapi', %s, 'league_matches', 1, 1, %s)
               ON CONFLICT (source, competition_season_id, family) DO UPDATE SET done = 1, last_success_at = EXCLUDED.last_success_at, updated_at = now()""",
            (edition, self.clock()),
        )

    def league(self, job):
        if job["global_key"] == "catalogue":
            data = self.fetch("league", "/leagues", job=job).data
            entries = data.get("leagues", []) if isinstance(data, dict) else []
        else:
            key = self._provider_key("competition", job["entity_id"])
            entries = [self.fetch("league", "/leagues/" + key, job=job).data]
        with self.conn.transaction():
            self._own(job)
            for entry in entries:
                try:
                    with self.conn.transaction():
                        self.store.save_references(normalize_family("league", entry), family="league")
                except (NormalizationError, StoreError) as error:
                    # One unreadable league must not block the catalogue.
                    self.results[("league", safe_code(error))] += 1
            ack(self.conn, job["id"], job["lease_token"], now=self.clock())

    def profile(self, job):
        kind = job["family"]
        key = self._provider_key(kind, job["entity_id"])
        result = self.fetch(kind, "/" + kind + "s/" + key, job=job)
        if result.coverage == "unavailable":
            # No profile under the plan in use (pitchapi.py): an answer, not a failure.
            profiles.record_unavailable(self.store, kind, key, (job["id"], job["lease_token"]))
            return
        batch = normalize_family(kind, result.data)
        profiles.save_profile(self.store, kind, key, batch, (job["id"], job["lease_token"]))

    def summary(self, job):
        mid = job["entity_id"]
        key = self._provider_key("match", mid)
        result = self.fetch("summary", "/matches/" + key, job=job)
        batch = normalize_family("summary", result.data, match_id=key)
        self.hydrate(batch)
        now = self.clock()
        with self.conn.transaction():
            self._own(job)
            edition, competition, before = self.conn.execute(
                "SELECT m.competition_season_id, cs.competition_id, f.fingerprint FROM core.matches m JOIN core.competition_seasons cs ON cs.id=m.competition_season_id LEFT JOIN ops.family_state f ON f.match_id=m.id AND f.family='summary' WHERE m.id=%s",
                (mid,),
            ).fetchone()
            source = batch.rows.get("core.matches", [{}])[0]
            if source.get("provider_season"):
                # The match endpoint names its edition: it wins over the one /date implied
                # (store.save_matches moves the match while it has no after-match facts).
                if source.get("provider_competition_id"):
                    competition = self.store.resolve("competition", source["provider_competition_id"])
                edition, _ = self.store.edition(competition, source["provider_season"])
            self.store.save_matches(batch, edition, family="summary")
            status, kickoff, after = self.conn.execute(
                "SELECT m.status::text, m.kickoff_at, f.fingerprint FROM core.matches m LEFT JOIN ops.family_state f ON f.match_id=m.id AND f.family='summary' WHERE m.id=%s",
                (mid,),
            ).fetchone()
            ack(self.conn, job["id"], job["lease_token"], now=now)
            if job["lane"] == "backfill":
                return  # history: no watch, no correction (the live planner owns those)
            planner.after_summary(
                self.conn,
                mid,
                kickoff_at=kickoff,
                status=status,
                now=now,
                summary_changed=before is not None and bytes(before) != bytes(after),
            )

    def details(self, job):
        family = job["family"]
        suffix, parser = DETAIL_ENDPOINTS[family]
        mid = job["entity_id"]
        key = self._provider_key("match", mid)
        result = self.fetch(family, "/matches/" + key + suffix, job=job)
        batch = (
            normalize_family(parser, result.data, match_id=key)
            if result.coverage == "ok"
            else NormalizedFamily(coverage="unavailable")
        )
        self.hydrate(batch)
        self.store.save_family(mid, family, batch, lease=(job["id"], job["lease_token"]))


def connect(dsn):
    """Local DSN for development; a remote one only for a vega_v2 database over TLS."""
    from urllib.parse import parse_qs, urlparse

    parsed = urlparse(dsn)
    if parsed.hostname in ("127.0.0.1", "localhost", "::1"):
        return connect_local(dsn)
    mode = parse_qs(parsed.query).get("sslmode", [""])[0]
    if (
        parsed.scheme not in ("postgres", "postgresql")
        or not parsed.path.startswith("/vega_v2")
        or mode not in ("require", "verify-ca", "verify-full")
    ):
        raise StoreError("TLS_VEGA_V2_DATABASE_REQUIRED")
    return psycopg.connect(dsn, autocommit=True, **CONNECTION)


class SideProcess:
    """The side work in a process of its own, started and watched by the collection.

    In the collection's loop a daily pass keeps every job waiting while it runs (the Elo
    of every match, then each due season's models), and whatever ends the process ends
    the collection with it: the player ranking holds a season's appearances in memory,
    and a task that passes its memory limit is killed. The child runs side_loop(); it is
    the process the kernel kills first when the task runs out of memory (prefer_as_oom_victim).
    When it ends, however it ends, it is started again `retry_after` seconds later."""

    def __init__(self, command, *, retry_after=RETRY_DAILY_AFTER.total_seconds(), clock=time.monotonic, popen=subprocess.Popen):
        self.command, self.retry_after, self.clock, self.popen = list(command), retry_after, clock, popen
        self.process = None
        self.next_start = float("-inf")

    def tick(self):
        """Start the process when it is due; note its end. Never waits."""
        now = self.clock()
        if self.process is not None:
            code = self.process.poll()
            if code is None:
                return
            # A negative code is the signal that killed it (-9: the kernel, out of memory).
            print(f"side process exit={code} restart_in={int(self.retry_after)}", flush=True)
            self.process = None
            self.next_start = now + self.retry_after
        if now >= self.next_start:
            try:
                self.process = self.popen(self.command)
            except OSError as error:
                self.next_start = now + self.retry_after
                print(f"side process error={error_code(error)} restart_in={int(self.retry_after)}", flush=True)
                return
            print(f"side process started pid={self.process.pid}", flush=True)

    def stop(self, wait=10):
        if self.process is None or self.process.poll() is not None:
            return
        self.process.terminate()
        try:
            self.process.wait(timeout=wait)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait()


def prefer_as_oom_victim(path="/proc/self/oom_score_adj"):
    """Make this process the first the kernel kills when the task runs out of memory
    (Linux; a process may always raise its own score). False where it cannot be set."""
    try:
        with open(path, "w", encoding="ascii") as handle:
            handle.write("1000")
        return True
    except OSError:
        return False


def side_loop(worker, *, stop, daily_every=SIDE_DAILY_EVERY, media_every=SIDE_MEDIA_EVERY, sleep=time.sleep, clock=time.monotonic):
    """The side work of a worker, until `stop`: the daily pass and the image copies, each
    on its rhythm. Ends with psycopg.OperationalError when the database is lost."""
    last_daily = last_media = float("-inf")
    while not stop():
        if worker.conn.closed or worker.calc_conn.closed:
            raise psycopg.OperationalError("connection lost")
        tick = clock()
        if tick - last_daily >= daily_every:
            worker.daily()
            last_daily = clock()  # counted from the end, as the planning round
        if tick - last_media >= media_every:
            worker.mirror()
            last_media = tick
        sleep(1)


def keep_running(session, *, stop, sleep=time.sleep, clock=time.monotonic):
    """Call session() until it ends by itself; True when it did.

    session() opens its own connections and runs a worker on them. A database that
    restarts (recovery, resize, maintenance) ends it with psycopg.OperationalError: it is
    started again on new connections, after 5 s then up to 60 s. A session that held
    HEALTHY_AFTER seconds starts the count again; the task gives up (False) when the
    database stayed away RECONNECT_FOR seconds, or when it is asked to stop.
    """
    lost_at, wait = None, RECONNECT_WAIT[0]
    while True:
        began = clock()
        try:
            session()
            return True
        except psycopg.OperationalError as error:
            now = clock()
            if now - began >= HEALTHY_AFTER:
                lost_at, wait = None, RECONNECT_WAIT[0]
            lost_at = now if lost_at is None else lost_at
            if stop():
                return False
            if now - lost_at >= RECONNECT_FOR:
                print(f"database lost error={safe_code(error)} outcome=gave_up", flush=True)
                return False
            print(f"database lost error={safe_code(error)} retry_in={wait}", flush=True)
            until = now + wait
            while clock() < until and not stop():
                sleep(1)
            wait = min(wait * 2, RECONNECT_WAIT[1])


REPORT_QUERIES = (
    (
        "Watches",
        ("State", "Matches"),
        "SELECT state::text, count(*) FROM ops.match_watch GROUP BY 1 ORDER BY 1",
    ),
    (
        "Jobs",
        ("Lane", "Family", "State", "Jobs"),
        "SELECT lane::text, family::text, state::text, count(*) FROM ops.fetch_jobs GROUP BY 1,2,3 ORDER BY 1,2,3",
    ),
    (
        "PitchAPI attempts",
        ("Family", "HTTP", "Error", "Attempts", "Mean ms", "P95 ms"),
        "SELECT family::text, http_status, coalesce(error_code,''), count(*), round(avg(duration_ms)), round(percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms)::numeric) FROM ops.fetch_log GROUP BY 1,2,3 ORDER BY 1,2,3",
    ),
    (
        "Controlled failures",
        ("Family", "Code", "Count"),
        "SELECT family::text, error_code, count(*) FROM ops.parse_failures GROUP BY 1,2 ORDER BY 1,2",
    ),
    (
        "Unknown provider fields (paths only)",
        ("Family", "Path", "Count"),
        "SELECT family::text, field_path, occurrences FROM ops.unknown_fields ORDER BY 1,2",
    ),
    (
        "Rows",
        ("Table", "Rows"),
        """SELECT t, n FROM (VALUES
             ('core.competitions', (SELECT count(*) FROM core.competitions)),
             ('core.competition_seasons', (SELECT count(*) FROM core.competition_seasons)),
             ('core.matches', (SELECT count(*) FROM core.matches)),
             ('core.teams', (SELECT count(*) FROM core.teams)),
             ('core.players', (SELECT count(*) FROM core.players)),
             ('agg.player_season_stats', (SELECT count(*) FROM agg.player_season_stats)),
             ('agg.team_season_stats', (SELECT count(*) FROM agg.team_season_stats)),
             ('agg.standings', (SELECT count(*) FROM agg.standings)),
             ('agg.cohorts', (SELECT count(*) FROM agg.cohorts)),
             ('agg.team_percentiles', (SELECT count(*) FROM agg.team_percentiles)),
             ('agg.player_percentiles', (SELECT count(*) FROM agg.player_percentiles)),
             ('agg.team_index', (SELECT count(*) FROM agg.team_index)),
             ('agg.player_role_scores', (SELECT count(*) FROM agg.player_role_scores)),
             ('agg.team_levels', (SELECT count(*) FROM agg.team_levels)),
             ('ops.dirty_scopes', (SELECT count(*) FROM ops.dirty_scopes)),
             ('ops.data_warnings', (SELECT count(*) FROM ops.data_warnings)),
             ('api.match_list', (SELECT count(*) FROM api.match_list)),
             ('api.standings', (SELECT count(*) FROM api.standings))
           ) AS r(t, n)""",
    ),
)


def report(worker, path, *, jobs, seconds):
    """Measurements only: counts, codes, field paths and timings, never provider values."""
    lines = [
        "# Vega worker loop",
        "",
        f"UTC: {datetime.now(timezone.utc).isoformat()}",
        f"Lanes: {', '.join(worker.lanes)}",
        f"Jobs run: {jobs}",
        f"HTTP attempts: {worker.client.requests}",
        f"Wall seconds: {seconds:.1f}",
        "",
        "| Family | Outcome | Jobs |",
        "|---|---|---:|",
        *(f"| {f} | {o} | {n} |" for (f, o), n in sorted(worker.results.items())),
    ]
    for title, header, query in REPORT_QUERIES:
        lines += ["", "## " + title, "", "| " + " | ".join(header) + " |", "|" + "---|" * len(header)]
        lines += ["| " + " | ".join("" if v is None else str(v) for v in row) + " |" for row in worker.conn.execute(query)]
    with open(path, "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines) + "\n")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lanes", default=",".join(DEFAULT_LANES))
    parser.add_argument("--until-idle", action="store_true", help="exit once every lane is empty")
    parser.add_argument("--max-jobs", type=int)
    parser.add_argument("--interval", type=float, default=0.5, help="minimum seconds between PitchAPI calls")
    parser.add_argument("--migrate", action="store_true")
    parser.add_argument("--report", help="write a measurements-only Markdown report")
    parser.add_argument("--cohort-delay", type=int, default=600, help="seconds a changed cohort waits before recalculation")
    parser.add_argument("--backfill-from", type=int, default=2021, help="first season (start year) of the backfill")
    parser.add_argument("--backfill-to", type=int, help="last season (start year) of the backfill; default the current one")
    parser.add_argument("--backfill-competitions", help="comma-separated PitchAPI league ids; default every league")
    parser.add_argument(
        "--side-work",
        choices=("inline", "process", "only"),
        default="inline",
        help="the daily pass and the image copies: in the loop (inline), in a child process this one starts and watches (process), "
        "or nothing else (only: what the child runs)",
    )
    args = parser.parse_args(argv)
    if args.side_work != "inline" and (args.lanes == "backfill" or args.until_idle or args.max_jobs is not None or args.report):
        parser.error("--side-work process/only is for the long-running worker")
    dsn, key = os.environ.get("V2_DATABASE_URL"), os.environ.get("PITCHAPI_API_KEY")
    if not dsn or not key:
        print("V2_DATABASE_URL and PITCHAPI_API_KEY are required", file=sys.stderr)
        return 2
    calc_dsn = os.environ.get("V2_CALC_DATABASE_URL")
    bucket = os.environ.get("V2_MEDIA_BUCKET")
    client = PitchClient(key, interval=args.interval)
    stopping = []
    signal.signal(signal.SIGTERM, lambda *_: stopping.append(True))
    results, state = Counter(), {"done": 0, "migrate": args.migrate}
    started = time.monotonic()
    side = None
    if args.side_work == "process":
        # The child is this module again, with this process's environment (its connections are its own).
        side = SideProcess([sys.executable, "-m", "vega.worker", "--side-work", "only", "--cohort-delay", str(args.cohort_delay)])
    elif args.side_work == "only":
        print(f"side work oom_victim={prefer_as_oom_victim()}", flush=True)

    def session():
        conns = [connect(dsn)]
        worker = None
        try:
            if state["migrate"]:
                migrate(conns[0])
                state["migrate"] = False
            if calc_dsn:
                conns.append(connect(calc_dsn))
            worker = Worker(
                Store(conns[0]),
                client,
                lanes=tuple(x for x in args.lanes.split(",") if x),
                cohort_delay=args.cohort_delay,
                calc_conn=conns[1] if calc_dsn else None,
                source_get=None if args.lanes == "backfill" else __import__("vega.sources.http", fromlist=["json_getter"]).json_getter(),
                backfill=(
                    {"first_season": args.backfill_from, "last_season": args.backfill_to,
                     "competitions": args.backfill_competitions.split(",") if args.backfill_competitions else None}
                    if args.lanes == "backfill"
                    else None
                ),
            )
            if bucket and args.lanes != "backfill" and side is None:
                worker.media_io = (media.downloader(), media.s3_writer(bucket))
            if args.side_work == "only":
                side_loop(worker, stop=lambda: bool(stopping))
                return
            worker.side_process = side
            left = None if args.max_jobs is None else args.max_jobs - state["done"]
            worker.run(max_jobs=left, until_idle=args.until_idle, stop=lambda: bool(stopping))
            if args.report:
                report(worker, args.report, jobs=state["done"] + worker.done, seconds=time.monotonic() - started)
        finally:
            if worker is not None:
                results.update(worker.results)
                state["done"] += worker.done
            for conn in conns:
                try:
                    conn.close()
                except psycopg.Error:
                    pass

    try:
        ended = keep_running(session, stop=lambda: bool(stopping))
    finally:
        if side is not None:
            side.stop()
    for (family, outcome), count in sorted(results.items()):
        print(f"family={family} outcome={outcome} count={count}", flush=True)
    print(f"jobs={state['done']}", flush=True)
    return 0 if ended or stopping else 1


if __name__ == "__main__":
    sys.exit(main())
