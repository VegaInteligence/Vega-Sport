"""Worker loop: planner + collector + calculator in one long-running process.

Each loop: plan (every minute), claim one job (lanes in priority order: score, then
details, then reference; backfill runs in its own task), call PitchAPI, write core in
one transaction with the job acknowledgement, and drain ops.dirty_scopes with the
calculator when the queues are idle or every 30 s. Components only meet in PostgreSQL.
"""

import argparse
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
import os
import signal
import sys
import time

import psycopg

from . import calculator, media, models, planner, profiles
from .jobs import LeaseLost, ack, claim, fail
from .normalize import NormalizedFamily, NormalizationError, normalize_family
from .pilot import DETAILS, safe_code
from .pitchapi import PitchClient, PitchError
from .store import Store, StoreError, connect_local, migrate

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


def _now():
    return datetime.now(timezone.utc)


# A season whose matches changed after its last daily models waits this long before the
# models run again (a backfill writes a season's matches for hours).
RECOMPUTE_AFTER = timedelta(hours=1)


def due_seasons(conn, now):
    """The seasons whose daily models are due:
    - a season played in the last 30 days, once a UTC day;
    - a season with finished matches never computed (a backfilled one);
    - a season whose matches changed after its last computation (a backfill that went on,
      a correction), once RECOMPUTE_AFTER has passed since that computation."""
    return [
        s
        for (s,) in conn.execute(
            """WITH last AS (
                 SELECT DISTINCT ON (cohort_definition) cohort_definition, started_at FROM agg.calc_runs
                 WHERE kind = 'levels' AND status = 'published' ORDER BY cohort_definition, started_at DESC)
               SELECT m.season_id FROM core.matches m LEFT JOIN last l ON l.cohort_definition = 'season:' || m.season_id
               GROUP BY m.season_id, l.started_at
               HAVING (l.started_at IS NULL AND bool_or(m.status = 'finished'))
                   OR (bool_or(m.kickoff_at > %(now)s - interval '30 days' AND m.kickoff_at <= %(now)s)
                       AND (l.started_at IS NULL OR l.started_at < date_trunc('day', %(now)s)))
                   OR (l.started_at < %(now)s - %(after)s
                       AND max(m.updated_at) FILTER (WHERE m.status = 'finished') > l.started_at)
               ORDER BY 1""",
            {"now": now, "after": RECOMPUTE_AFTER},
        ).fetchall()
    ]


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
        try:
            handler(job)
            code = "ok"
        except LeaseLost:
            code = "LEASE_LOST"
        except (PitchError, NormalizationError, StoreError, psycopg.Error) as error:
            code = safe_code(error)
        except Exception as error:  # a bug must not crash-loop on the same job
            code = "WORKER_" + type(error).__name__.upper()[:50]
        self.results[(family, code)] += 1
        if code not in ("ok", "LEASE_LOST"):
            self.failed(job, code)
            print(f"family={family} job={job['id']} error={code}", flush=True)
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

    def calculate(self, limit=500):
        """Season aggregates first, then the cohorts they changed (debounced)."""
        try:
            done = calculator.process_dirty(self.calc_conn, limit=limit)
            return done + models.process_cohorts(self.calc_conn, min_age_seconds=self.cohort_delay)
        except psycopg.Error as error:
            print(f"calculator error={safe_code(error)}", flush=True)
            return 0

    def daily(self):
        """Levels, competition strength, squad profiles, similarities and power rankings
        (models.refresh_daily) for the seasons due_seasons() names."""
        now = self.clock()
        seasons = due_seasons(self.calc_conn, now)
        if self.source_get is not None:
            # Rankings and other sources first: the levels read the UEFA coefficients.
            from . import sources
            from .sources import uefa

            try:
                for (name, scope), outcome in sources.run_due(self.conn, self.source_get, now).items():
                    print(f"source={name} scope={scope} outcome={outcome}", flush=True)
                with self.conn.transaction():
                    uefa.reconcile_teams(self.conn)
            except psycopg.Error as error:
                print(f"sources error={safe_code(error)}", flush=True)
        for season in seasons:
            try:
                models.refresh_daily(self.calc_conn, season)
                print(f"daily models season={season} outcome=ok", flush=True)
            except psycopg.Error as error:
                print(f"daily models season={season} error={safe_code(error)}", flush=True)
        return seasons

    def mirror(self, limit=200):
        """Copies of the images seen since the last pass (media.py)."""
        if self.media_io is None:
            return {}
        try:
            outcomes = media.mirror(self.conn, *self.media_io, self.clock(), limit=limit)
        except psycopg.Error as error:
            print(f"media error={safe_code(error)}", flush=True)
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
            tick = time.monotonic()
            if tick - last_plan >= plan_every:
                since_plan = 0
                try:
                    if self.backfill is None:
                        planner.plan(self.conn, self.clock())
                    else:
                        planner.plan_backfill(self.conn, self.clock(), **self.backfill)
                except psycopg.Error as error:
                    print(f"planner error={safe_code(error)}", flush=True)
                last_plan = tick
                if self.backfill is None:
                    self.daily()
            if self.backfill is None and tick - last_media >= media_every:
                self.mirror()
                last_media = tick
            worked = self.step()
            done += worked
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
        return done

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
    return psycopg.connect(dsn, autocommit=True)


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
        "# Vega v2 worker loop",
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
    args = parser.parse_args(argv)
    dsn, key = os.environ.get("V2_DATABASE_URL"), os.environ.get("PITCHAPI_API_KEY")
    if not dsn or not key:
        print("V2_DATABASE_URL and PITCHAPI_API_KEY are required", file=sys.stderr)
        return 2
    conn = connect(dsn)
    if args.migrate:
        migrate(conn)
    calc_dsn = os.environ.get("V2_CALC_DATABASE_URL")
    calc_conn = connect(calc_dsn) if calc_dsn else None
    stopping = []
    signal.signal(signal.SIGTERM, lambda *_: stopping.append(True))
    worker = Worker(
        Store(conn),
        PitchClient(key, interval=args.interval),
        lanes=tuple(x for x in args.lanes.split(",") if x),
        cohort_delay=args.cohort_delay,
        calc_conn=calc_conn,
        source_get=None if args.lanes == "backfill" else __import__("vega_v2.sources.http", fromlist=["json_getter"]).json_getter(),
        backfill=(
            {"first_season": args.backfill_from, "last_season": args.backfill_to,
             "competitions": args.backfill_competitions.split(",") if args.backfill_competitions else None}
            if args.lanes == "backfill"
            else None
        ),
    )
    bucket = os.environ.get("V2_MEDIA_BUCKET")
    if bucket and args.lanes != "backfill":
        worker.media_io = (media.downloader(), media.s3_writer(bucket))
    started = time.monotonic()
    done = worker.run(max_jobs=args.max_jobs, until_idle=args.until_idle, stop=lambda: bool(stopping))
    if args.report:
        report(worker, args.report, jobs=done, seconds=time.monotonic() - started)
    for (family, outcome), count in sorted(worker.results.items()):
        print(f"family={family} outcome={outcome} count={count}", flush=True)
    print(f"jobs={done}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
