"""Bounded database-backed worker. No provider response is written to a file."""

from datetime import datetime, timedelta, timezone
import os, time
import uuid
import psycopg
from .backfill import (
    enqueue_catalogue,
    enqueue_finished,
    persist_catalogue,
    activate_finished,
    catalogue_report,
)
from .jobs import (
    ack,
    claim,
    fail,
    renew,
    LeaseLost,
    enqueue,
    after_finished,
    next_score_check,
)
from .normalize import NormalizedFamily, NormalizationError, normalize_family
from .pitchapi import PitchClient, PitchError
from .profiles import save_profile, record_failure as profile_failure
from .store import StoreError

DETAIL = {
    "summary": ("", "summary"),
    "shots": ("/shots", "shots"),
    "events": ("/events", "events"),
    "lineups": ("/lineups", "lineups"),
    "momentum": ("/momentum", "momentum"),
    "team_stats": ("/stats", "stats"),
    "player_stats": ("/players", "players"),
    "player_halves": ("/players/halves", "players_halves"),
    "advanced": ("/advanced", "advanced"),
    "advanced_players": ("/advanced/players", "advanced_players"),
    "network": ("/advanced/network", "advanced_network"),
    "heatmaps": ("/heatmaps", "heatmaps"),
    "h2h": ("/h2h", "h2h"),
}


class BudgetExhausted(Exception):
    def __init__(self, retry_after=0):
        self.retry_after = retry_after


class Worker:
    def __init__(
        self,
        store,
        client,
        *,
        max_requests,
        max_seconds,
        lanes=("reference", "backfill"),
        first_year=2021,
        clock=time.monotonic,
        phase="backfill",
        capacity_check=None
    ):
        if (
            not isinstance(max_requests, int)
            or isinstance(max_requests, bool)
            or not 1 <= max_requests <= 100000
            or not isinstance(max_seconds, (int, float))
            or not 0 < max_seconds <= 86400
        ):
            raise ValueError("invalid worker budget")
        if phase not in ("catalogue", "backfill"):
            raise ValueError("invalid phase")
        if not lanes or any(
            x not in ("score", "details", "backfill", "reference") for x in lanes
        ):
            raise ValueError("invalid worker lanes")
        (
            self.store,
            self.client,
            self.max_requests,
            self.max_seconds,
            self.lanes,
            self.first_year,
            self.clock,
        ) = (store, client, max_requests, max_seconds, tuple(lanes), first_year, clock)
        self.phase = phase
        self.capacity_check = capacity_check
        self.client.interval = max(self.client.interval, 0.5)
        self.started = clock()
        self.http_requests = 0
        self.current = None
        self.outcomes = {"done": 0, "failed": 0}
        self._transport = client._transport
        self._sleep = client._sleep
        self._observer = client._on_attempt
        self._timeout = client.timeout

    def _capacity(self):
        if self.capacity_check is not None:
            self.capacity_check(self.store.conn)

    def _claim_catalogue(self):
        # Global catalogue only, never another league/profile reference job.
        token = uuid.uuid4()
        cur = self.store.conn.execute(
            """WITH candidate AS (
          SELECT id FROM ops.fetch_jobs WHERE lane='reference' AND family='league' AND global_key='catalogue'
          AND ((state='pending' AND run_after<=clock_timestamp()) OR (state='leased' AND lease_until<=clock_timestamp()))
          ORDER BY priority DESC,run_after,id FOR UPDATE SKIP LOCKED LIMIT 1)
          UPDATE ops.fetch_jobs j SET state='leased',lease_token=%s,lease_until=clock_timestamp()+interval '300 seconds',attempts=j.attempts+1,updated_at=clock_timestamp()
          FROM candidate c WHERE j.id=c.id RETURNING j.id,j.lane,j.family,j.entity_type,j.entity_id,j.target_date,j.competition_season_id,j.global_key,j.attempts,j.lease_until,j.lease_token""",
            (token,),
        )
        row = cur.fetchone()
        return dict(zip([c.name for c in cur.description], row)) if row else None

    def _heartbeat(self):
        if not self.current:
            return
        j = self.current
        with self.store.conn.transaction():
            renew(self.store.conn, j["id"], j["lease_token"], lease_seconds=300)

    def _remaining(self):
        return self.max_seconds - (self.clock() - self.started)

    def _transport_checked(self, request, timeout):
        if self.http_requests >= self.max_requests or self._remaining() <= 0:
            raise BudgetExhausted()
        self._capacity()
        self._heartbeat()
        self.http_requests += 1
        return self._transport(request, min(timeout, max(0.001, self._remaining())))

    def _sleep_checked(self, seconds):
        if seconds > self._remaining():
            raise BudgetExhausted(seconds)
        while seconds > 0:
            self._heartbeat()
            step = min(seconds, 60)
            self._sleep(step)
            seconds -= step

    def _fetch(
        self,
        family,
        path,
        params=None,
        *,
        entity_type=None,
        entity_id=None,
        edition=None,
        global_key=None
    ):
        def observe(event):
            self.store.log_attempt(
                family,
                event,
                entity_type=entity_type,
                entity_id=entity_id,
                competition_season_id=edition,
                global_key=global_key,
            )
            if self._observer:
                self._observer(event)

        self.client._on_attempt = observe
        return self.client.fetch(path, params)

    def _key(self, kind, ident):
        row = self.store.conn.execute(
            "SELECT provider_key FROM core.provider_ids WHERE entity_type=%s AND provider='pitchapi' AND entity_id=%s",
            (kind, ident),
        ).fetchone()
        if not row:
            raise StoreError("UNRESOLVED_REFERENCE")
        return row[0]

    def _lock(self, job):
        if not self.store.conn.execute(
            "SELECT id FROM ops.fetch_jobs WHERE id=%s AND lease_token=%s AND state='leased' AND lease_until>clock_timestamp() AND family=%s AND entity_type IS NOT DISTINCT FROM %s AND entity_id IS NOT DISTINCT FROM %s AND competition_season_id IS NOT DISTINCT FROM %s AND global_key IS NOT DISTINCT FROM %s FOR UPDATE",
            (
                job["id"],
                job["lease_token"],
                job["family"],
                job["entity_type"],
                job["entity_id"],
                job["competition_season_id"],
                job["global_key"],
            ),
        ).fetchone():
            raise StoreError("LEASE_LOST")

    def _finish_reference(self, job):
        kind = job["family"]
        key = self._key(kind, job["entity_id"])
        result = self._fetch(
            kind, "/" + kind + "s/" + key, entity_type=kind, entity_id=job["entity_id"]
        )
        batch = normalize_family(kind, result.data)
        self._capacity()
        save_profile(
            self.store, kind, key, batch, lease=(job["id"], job["lease_token"])
        )

    def _run_job(self, job):
        self._capacity()
        family = job["family"]
        lease = (job["id"], job["lease_token"])
        if family == "league" and job["global_key"] == "catalogue":
            result = self._fetch("league", "/leagues", global_key="catalogue")
            with self.store.conn.transaction():
                self._lock(job)
                self._capacity()
                persist_catalogue(self.store, result.data, first_year=self.first_year)
                ack(self.store.conn, *lease)
            return
        if family == "league_matches":
            edition = job["competition_season_id"]
            row = self.store.conn.execute(
                "SELECT p.provider_key,cs.native_label FROM core.competition_seasons cs JOIN core.provider_ids p ON p.entity_type='competition' AND p.provider='pitchapi' AND p.entity_id=cs.competition_id WHERE cs.id=%s",
                (edition,),
            ).fetchone()
            if not row:
                raise StoreError("EDITION_NOT_FOUND")
            key, label = row
            result = self._fetch(
                family,
                "/leagues/" + key + "/matches",
                {"season": label, "status": "all"},
                edition=edition,
            )
            data = result.data
            if (
                not isinstance(data, dict)
                or not isinstance(data.get("league"), dict)
                or data["league"].get("id") != key
                or data["league"].get("season", label) != label
            ):
                raise StoreError("CALENDAR_IDENTITY_MISMATCH")
            batch = normalize_family("league_matches", data)
            self._capacity()
            with self.store.conn.transaction():
                self._lock(job)
                self._capacity()
                enqueue_finished(
                    self.store,
                    batch,
                    edition,
                    schedule_details=self.phase != "catalogue",
                )
                ack(self.store.conn, *lease)
            return
        if family in ("team", "player"):
            self._finish_reference(job)
            return
        if family in DETAIL:
            mid = job["entity_id"]
            key = self._key("match", mid)
            row = self.store.conn.execute(
                "SELECT competition_season_id,status::text,kickoff_at,first_finished_at FROM core.matches WHERE id=%s",
                (mid,),
            ).fetchone()
            if not row:
                raise StoreError("MATCH_NOT_FOUND")
            edition, status, kickoff, first_finished_at = row
            if family != "summary" and status != "finished":
                raise StoreError("MATCH_NOT_FINISHED")
            suffix, parser = DETAIL[family]
            result = self._fetch(
                family, "/matches/" + key + suffix, entity_type="match", entity_id=mid
            )
            batch = (
                normalize_family(parser, result.data, match_id=key)
                if result.coverage == "ok"
                else NormalizedFamily(coverage="unavailable")
            )
            self._capacity()
            with self.store.conn.transaction():
                self._lock(job)
                if family == "summary":
                    self.store.save_matches(batch, edition)
                    ack(self.store.conn, *lease)
                    if job["lane"] == "score":
                        updated = batch.rows.get("core.matches", [{}])[0]
                        new_status = updated.get("status", status)
                        now = datetime.now(timezone.utc)
                        if new_status == "finished" and status != "finished":
                            after_finished(self.store.conn, mid, now)
                        elif (
                            new_status == "finished"
                            and status == "finished"
                            and first_finished_at
                        ):
                            scheduled = self.store.conn.execute(
                                "SELECT run_after FROM ops.fetch_jobs WHERE id=%s",
                                (job["id"],),
                            ).fetchone()[0]
                            if scheduled >= first_finished_at + timedelta(hours=23):
                                for detail in DETAIL:
                                    if detail != "summary":
                                        enqueue(
                                            self.store.conn,
                                            "details",
                                            detail,
                                            entity_type="match",
                                            entity_id=mid,
                                            run_after=now,
                                        )
                        elif new_status in ("not_started", "in_play") and (
                            updated.get("kickoff_at") or kickoff
                        ):
                            enqueue(
                                self.store.conn,
                                "score",
                                "summary",
                                entity_type="match",
                                entity_id=mid,
                                run_after=next_score_check(
                                    updated.get("kickoff_at") or kickoff, now
                                ),
                            )
                else:
                    self.store.save_family(mid, family, batch, lease=lease)
            return
        raise StoreError("UNSUPPORTED_JOB")

    def run(self):
        self.client._transport = self._transport_checked
        self.client._sleep = self._sleep_checked
        try:
            while self.http_requests < self.max_requests and self._remaining() > 0:
                job = None
                self._capacity()
                if self.phase == "catalogue":
                    with self.store.conn.transaction():
                        job = self._claim_catalogue()
                    if not job:
                        with self.store.conn.transaction():
                            job = claim(
                                self.store.conn,
                                "backfill",
                                family="league_matches",
                                lease_seconds=300,
                            )
                else:
                    for lane in self.lanes:
                        with self.store.conn.transaction():
                            job = claim(self.store.conn, lane, lease_seconds=300)
                        if job:
                            break
                if not job:
                    break
                self.current = job
                try:
                    self._run_job(job)
                    self.outcomes["done"] += 1
                except (
                    PitchError,
                    NormalizationError,
                    StoreError,
                    BudgetExhausted,
                    psycopg.Error,
                ) as error:
                    if isinstance(error, StoreError) and str(error) == "LEASE_LOST":
                        raise
                    code = (
                        "WORKER_BUDGET"
                        if isinstance(error, BudgetExhausted)
                        else (
                            error.code
                            if isinstance(error, PitchError)
                            else (
                                str(error)
                                if str(error).isupper() and len(str(error)) <= 64
                                else (
                                    "DATABASE_ERROR"
                                    if isinstance(error, psycopg.Error)
                                    else "INGESTION_ERROR"
                                )
                            )
                        )
                    )
                    retry = (
                        not isinstance(error, PitchError)
                        or error.status not in (400, 401, 403, 404)
                        or (
                            job["entity_type"] in ("team", "player")
                            and error.status == 404
                        )
                    )
                    with self.store.conn.transaction():
                        self._lock(job)
                        if job["entity_type"] == "match":
                            self.store.record_failure(
                                job["entity_id"], job["family"], code
                            )
                        if job["entity_type"] in ("team", "player"):
                            profile_failure(
                                self.store,
                                job["entity_type"],
                                self._key(job["entity_type"], job["entity_id"]),
                                code,
                            )
                        fail(
                            self.store.conn,
                            job["id"],
                            job["lease_token"],
                            code,
                            retry=retry,
                        )
                        if (
                            isinstance(error, PitchError)
                            and error.status == 404
                            and job["entity_type"] in ("team", "player")
                        ):
                            self.store.conn.execute(
                                "UPDATE ops.fetch_jobs SET run_after=GREATEST(run_after,clock_timestamp()+interval '1 hour') WHERE id=%s AND state='pending'",
                                (job["id"],),
                            )
                        if isinstance(error, BudgetExhausted) and error.retry_after:
                            self.store.conn.execute(
                                "UPDATE ops.fetch_jobs SET run_after=GREATEST(run_after,clock_timestamp()+%s*interval '1 second') WHERE id=%s AND state='pending'",
                                (error.retry_after, job["id"]),
                            )
                    self.outcomes["failed"] += 1
                    if isinstance(error, PitchError) and error.status in (401, 403):
                        raise
                    if isinstance(error, BudgetExhausted) or (
                        isinstance(error, StoreError)
                        and str(error) == "V2_CAPACITY_LOW"
                    ):
                        break
                finally:
                    self.current = None
            return {
                "requests": self.http_requests,
                **self.outcomes,
                "elapsed_seconds": self.clock() - self.started,
            }
        finally:
            self.client._transport = self._transport
            self.client._sleep = self._sleep
            self.client._on_attempt = self._observer
            self.client.timeout = self._timeout


def main(argv=None, *, connect=None):
    """Run with explicit budgets; dry-run never opens a DB or contacts PitchAPI."""
    import argparse, json, sys

    parser = argparse.ArgumentParser(prog="python -m vega_v2.worker")
    commands = parser.add_subparsers(dest="command", required=True)
    plan = commands.add_parser("plan")
    plan.add_argument("--dry-run", action="store_true")
    run = commands.add_parser("run")
    run.add_argument("--lanes", default="backfill,reference")
    run.add_argument("--duration-seconds", type=int, required=True)
    run.add_argument("--max-requests", type=int, required=True)
    run.add_argument("--first-year", type=int, default=2021)
    run.add_argument("--seed-catalogue", action="store_true")
    run.add_argument("--phase", choices=("catalogue", "backfill"), default="catalogue")
    activate = commands.add_parser("activate")
    activate.add_argument("--after-id", type=int, default=0)
    activate.add_argument("--limit", type=int, default=100)
    activate.add_argument("--edition-id", type=int)
    args = parser.parse_args(argv)
    if args.command == "plan" and args.dry_run:
        print(
            json.dumps(
                {
                    "mode": "dry-run",
                    "first_year": 2021,
                    "catalogue_endpoint": "/leagues",
                    "network_requests": 0,
                }
            )
        )
        return 0
    dsn = os.environ.get("V2_DATABASE_URL")
    conn = None
    try:
        if connect is None:
            from .database import connect_database

            connect = connect_database
        conn = connect(dsn)
        from .store import Store

        store = Store(conn)
        if args.command == "plan":
            rows = conn.execute(
                "SELECT lane::text,state::text,count(*) FROM ops.fetch_jobs GROUP BY lane,state ORDER BY lane,state"
            ).fetchall()
            print(
                json.dumps(
                    {
                        "catalogue": catalogue_report(conn),
                        "jobs": [
                            {"lane": lane, "state": state, "count": count}
                            for lane, state, count in rows
                        ],
                    }
                )
            )
            return 0
        from .capacity import CapacityGuard

        guard = CapacityGuard(conn)
        guard(conn)
        if args.command == "activate":
            print(
                json.dumps(
                    activate_finished(
                        store,
                        after_id=args.after_id,
                        limit=args.limit,
                        edition_id=args.edition_id,
                    )
                )
            )
            return 0
        if not 1900 <= args.first_year <= 2200:
            raise ValueError("invalid first year")
        key = os.environ.get("PITCHAPI_API_KEY", "")
        client = PitchClient(key)
        if args.seed_catalogue or args.phase == "catalogue":
            with conn.transaction():
                known = conn.execute(
                    "SELECT 1 FROM ops.fetch_jobs WHERE family='league' AND global_key='catalogue' LIMIT 1"
                ).fetchone()
                if args.seed_catalogue or not known:
                    enqueue_catalogue(conn)
        result = Worker(
            store,
            client,
            max_requests=args.max_requests,
            max_seconds=args.duration_seconds,
            lanes=tuple(args.lanes.split(",")),
            first_year=args.first_year,
            phase=args.phase,
            capacity_check=guard,
        ).run()
        print(json.dumps(result))
        return 0
    except (PitchError, StoreError, LeaseLost, psycopg.Error, ValueError) as error:
        code = (
            error.code
            if isinstance(error, PitchError)
            else (
                "LEASE_LOST"
                if isinstance(error, LeaseLost)
                else (
                    "DATABASE_ERROR"
                    if isinstance(error, psycopg.Error)
                    else (
                        str(error)
                        if isinstance(error, StoreError) and str(error).isupper()
                        else "WORKER_ERROR"
                    )
                )
            )
        )
        print(code, file=sys.stderr)
        return 1
    finally:
        if conn is not None:
            conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
