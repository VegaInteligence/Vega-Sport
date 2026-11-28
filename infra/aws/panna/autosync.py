"""Single hosted PannaData queue runner. Source bytes stay in local scratch."""
from datetime import UTC, datetime, timedelta
from importlib.util import find_spec
import json
import os
from pathlib import Path
import re
import shutil
import time
from urllib.parse import quote

from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from panna import registry, sources
from panna.db import Session
from daily import (
    ASSET, GIB, PORT, Stop, aws, await_tunnel, bridge, cli, close, dsn_from_ssm, emit,
    guard, open_tunnel, session_transcript,
)

SOURCE = "github:opta-latest"
RELEASE_URL = f"https://github.com/{registry.REPO}/releases/download/{registry.RELEASE}/"
LEASE = timedelta(minutes=25)
MAX_LOCAL = 8 * GIB
DB_MAX = 90 * GIB
QUEUE_PARAM = "/vega/v2/panna-daily-queue-database-url"
QUEUE_USER = "vega_panna_daily_queue"
ACTION_PARAM = "/vega/v2/panna-action-refresh-database-url"
ACTION_USER = "vega_panna_action_daily"
IDENTITY_PARAM = "/vega/v2/panna-identity-refresh-database-url"
IDENTITY_USER = "vega_panna_identity_daily"


class Queue:
    def __init__(self, conn):
        self.conn = conn

    def discovery_due(self, now):
        return self.conn.execute(
            """SELECT next_inventory_at IS NULL OR next_inventory_at<=%s OR (
                   last_inventory_at IS NOT NULL AND (last_inventory_at AT TIME ZONE 'UTC')::date < %s)
               FROM panna_sync.sources WHERE source_key=%s""",
            (now, now.date(), SOURCE),
        ).fetchone()[0]

    def discover(self, assets, cutoff, now):
        fixture = next((entry for entry in assets.values() if entry["name"] == ASSET), None)
        pin = fixture["sha256"] if fixture and trusted(fixture) else ""
        with self.conn.transaction():
            for asset in assets.values():
                name = asset["name"]
                handler = "fixtures" if name == ASSET else (
                    "actions" if registry.EVENTS.matches(asset.get("container", ""), name) else "unsupported")
                valid = trusted(asset)
                state = "unavailable" if not valid else {
                    "fixtures": "pending", "actions": "dependency_pending", "unsupported": "handler_pending",
                }[handler]
                self.insert(asset, cutoff, now, handler, state, pin if handler == "actions" else "")
                if handler == "fixtures" and valid:
                    self.insert(asset, cutoff, now, "identity", "handler_pending")
            if not fixture:
                self.insert({"name": ASSET}, cutoff, now, "fixtures", "unavailable")
            self.conn.execute(
                """UPDATE panna_sync.sources SET last_inventory_at=%s,next_inventory_at=%s,state=%s,detail=%s
                   WHERE source_key=%s""",
                (now, now + (timedelta(hours=22) if pin else timedelta(minutes=30)),
                 "discovered" if pin else "partial", None if pin else "FIXTURE_PIN_MISSING", SOURCE),
            )
        return bool(pin)

    def insert(self, asset, cutoff, now, handler, state, pin=""):
        self.conn.execute("""
          INSERT INTO panna_sync.work(handler,asset_name,digest,cutoff,fixture_pin,asset,status,next_at)
          VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
          ON CONFLICT (handler,asset_name,digest,cutoff,fixture_pin) DO UPDATE
          SET asset=excluded.asset,status=excluded.status,next_at=excluded.next_at,reason=NULL
          WHERE panna_sync.work.status='unavailable' AND excluded.status<>'unavailable'
        """, (handler, asset["name"], asset.get("sha256") or "", cutoff, pin, Jsonb(asset), state, now))

    def activate_dependencies(self, identity_enabled, actions_enabled):
        if identity_enabled:
            self.conn.execute("""
              UPDATE panna_sync.work i SET status='pending' WHERE i.handler='identity' AND i.status='handler_pending'
                AND EXISTS (SELECT 1 FROM panna_sync.work f WHERE f.handler='fixtures' AND f.status='verified'
                              AND (f.digest,f.cutoff)=(i.digest,i.cutoff))
            """)
        if actions_enabled:
            self.conn.execute("""
              UPDATE panna_sync.work a SET status='pending' WHERE a.handler='actions' AND a.status='dependency_pending'
                AND a.fixture_pin<>'' AND EXISTS (
                  SELECT 1 FROM panna_sync.work i WHERE i.handler='identity' AND i.status='verified'
                  AND (i.digest,i.cutoff)=(a.fixture_pin,a.cutoff))
            """)

    def claim(self, now):
        with self.conn.cursor(row_factory=dict_row) as cursor:
            return cursor.execute("""
              WITH pick AS (
                SELECT id FROM panna_sync.work
                WHERE (status IN ('pending','retry','capacity_blocked') AND next_at<=%(now)s)
                   OR (status='leased' AND lease_until<=%(now)s)
                ORDER BY CASE handler WHEN 'fixtures' THEN 0 WHEN 'identity' THEN 1 ELSE 2 END, cutoff,id
                LIMIT 1 FOR UPDATE SKIP LOCKED
              )
              UPDATE panna_sync.work w SET status='leased',attempt=w.attempt+1,lease_until=%(until)s
              FROM pick WHERE w.id=pick.id RETURNING w.*,w.attempt AS fence
            """, {"now": now, "until": now + LEASE}).fetchone()

    def finish(self, job, state, reason, due, run_id=None, result=None):
        return self.conn.execute("""
          UPDATE panna_sync.work SET status=%s,reason=%s,next_at=%s,lease_until=NULL,run_id=coalesce(%s,run_id),
              result=coalesce(%s,result)
          WHERE id=%s AND attempt=%s AND status='leased'
        """, (state, reason, due, run_id, Jsonb(result) if result is not None else None,
              job["id"], job["fence"])).rowcount == 1

    def fixture_run(self, lease):
        row = self.conn.execute("""
          SELECT run_id FROM panna_sync.work WHERE handler='fixtures' AND status='verified'
            AND digest=%s AND cutoff=%s AND asset_name=%s
        """, (lease["digest"], lease["cutoff"], ASSET)).fetchone()
        return row and row[0]

    def heartbeat(self):
        state = self.conn.execute("SELECT state FROM panna_sync.sources WHERE source_key=%s", (SOURCE,)).fetchone()[0]
        counters = dict(self.conn.execute("SELECT status,count(*) FROM panna_sync.work GROUP BY status"))
        inventory_pending = self.conn.execute(
            "SELECT count(*) FROM panna_sync.sources WHERE state<>'discovered'"
        ).fetchone()[0]
        emit("sync_queue", inventory=state, counters=counters, source_channels_open=inventory_pending, full_backfill=False)

    def idle_until(self, now):
        due = self.conn.execute("""
          SELECT least(min(s.next_inventory_at), min(w.next_at))
          FROM panna_sync.sources s
          LEFT JOIN panna_sync.work w ON w.status IN ('pending','retry','capacity_blocked')
          WHERE s.source_key=%s
        """, (SOURCE,)).fetchone()[0]
        leased = self.conn.execute("SELECT EXISTS(SELECT 1 FROM panna_sync.work WHERE status='leased')").fetchone()[0]
        midnight = datetime.combine(now.date() + timedelta(days=1), datetime.min.time(), tzinfo=UTC)
        return None if leased or not due or due <= now else min(due, midnight, now + timedelta(hours=2))


def trusted(asset):
    name = asset.get("name", "")
    return (
        asset.get("origin") == "github" and asset.get("container") == registry.RELEASE
        and bool(re.fullmatch(r"[0-9a-f]{64}", asset.get("sha256") or ""))
        and isinstance(asset.get("bytes"), int) and asset["bytes"] > 0 and bool(asset.get("asset_id"))
        and bool(asset.get("updated_at")) and asset.get("url") == RELEASE_URL + quote(name, safe="._-")
    )


def clock():
    return datetime.now(UTC)


def discover_live():
    available = sources.list_release(registry.GITHUB_API, registry.REPO, registry.RELEASE,
                                     os.environ.get("GITHUB_TOKEN"))
    return {name: asset.to_plan() for name, asset in available.items()}


def materialize(job, scratch):
    manifest = scratch / "manifest.json"
    manifest.write_text(json.dumps({"assets": [job["asset"]]}))
    return sources.read_manifest(manifest)[job["asset_name"]]


def writer_for(handler):
    if handler == "fixtures":
        return dsn_from_ssm()
    if handler == "actions":
        if os.environ.get("PANNA_ACTIONS_READY") != "true":
            raise Stop("ACTIONS_ROLE_NOT_READY")
        return dsn_from_ssm(ACTION_PARAM, ACTION_USER)
    raise Stop("HANDLER_NOT_READY")


def observe(writer, endpoint, job):
    with product_connection(writer, endpoint) as db:
        return db.execute("""
          SELECT run_id,status FROM panna.runs
          WHERE plan->>'sync_job_id'=%s
          ORDER BY run_id DESC LIMIT 1
        """, (str(job["id"]),)).fetchone()


def product_connection(dsn, endpoint):
    import psycopg
    from panna.db import connect_kwargs

    return psycopg.connect(dsn, **connect_kwargs(dsn, endpoint))


def verify_generation(writer, endpoint, run_id, asset, job):
    with product_connection(writer, endpoint) as db:
        return db.execute("""
          SELECT EXISTS (
            SELECT 1 FROM panna.runs r
              JOIN panna.loads l ON l.run_id=r.run_id
              JOIN panna.streams s ON s.stream_id=l.stream_id
              JOIN panna.receipts p ON p.receipt_id=l.receipt_id
            WHERE r.run_id=%s AND r.status='complete' AND l.status='complete'
              AND s.name=%s AND s.origin=%s AND s.container=%s
              AND p.sha256=%s AND l.as_of=%s
          )
        """, (run_id, asset.name, asset.origin, asset.container, bytes.fromhex(asset.sha256), job["cutoff"])).fetchone()[0]


def run_product(job, scratch, endpoint, seconds, monitor):
    handler = job["handler"]
    asset = materialize(job, scratch)
    if asset.bytes > MAX_LOCAL or shutil.disk_usage(scratch).free < asset.bytes + 3 * GIB:
        raise Stop("ASSET_CAPACITY")
    writer = writer_for(handler)
    previous = observe(writer, endpoint, job)
    prefix = ["actions"] if handler == "actions" else []
    common = ["--via", endpoint]
    bounds = ["--scratch", str(scratch), "--max-seconds", str(seconds), "--chunk-rows", "10000",
              "--database-ceiling-bytes", str(DB_MAX), "--scratch-ceiling-bytes", str(MAX_LOCAL)]
    if not previous:
        asset.dataset = "opta_events" if prefix else "opta_fixtures"
        plan = scratch / "plan.json"
        plan.write_text(json.dumps({"as_of": job["cutoff"].isoformat(), "release": registry.RELEASE,
                                    "assets": [asset.to_plan()], "fixtures": "sha256:" + job["fixture_pin"] if prefix else "current",
                                    "sync_job_id": job["id"]}))
        cli(scratch, "run", [*common, *bounds, "--plan", str(plan)], writer, monitor,
            prefix=prefix, hard_timeout=seconds + 30)
    elif previous[1] != "complete":
        cli(scratch, "retry", [*common, *bounds, "--run", str(previous[0])], writer, monitor,
            prefix=prefix, hard_timeout=seconds + 30)
    last = observe(writer, endpoint, job)
    if not last or last[1] != "complete" or not verify_generation(writer, endpoint, last[0], asset, job):
        raise Stop("PIN_NOT_VERIFIED")
    cli(scratch, "verify", [*common, "--run", str(last[0])], writer, monitor, prefix=prefix, hard_timeout=180)
    return last[0]


def identity_ready():
    return os.environ.get("PANNA_IDENTITY_READY") == "true" and find_spec("panna.teams") is not None


def identity_load(writer, endpoint, fixture_run, lease):
    with product_connection(writer, endpoint) as db:
        rows = db.execute("""
          SELECT l.load_id FROM panna.loads l
          JOIN panna.runs r ON r.run_id=l.run_id
          JOIN panna.receipts p ON p.receipt_id=l.receipt_id
          JOIN panna.streams s ON s.stream_id=l.stream_id
          WHERE r.run_id=%s AND r.status='complete' AND l.status='complete'
            AND l.extension='opta_fixtures_ext' AND coalesce(jsonb_typeof(r.plan->'scope'),'null')='null'
            AND s.name=%s AND s.origin='github' AND s.container='opta-latest'
            AND s.dataset='opta_fixtures' AND p.sha256=%s AND l.as_of=%s
        """, (fixture_run, ASSET, bytes.fromhex(lease["digest"]), lease["cutoff"])).fetchall()
    if len(rows) != 1:
        raise Stop("IDENTITY_FIXTURE_LOAD_NOT_VERIFIED")
    return rows[0][0]


def identity_receipt(writer, endpoint, load_id, reviewer, lease):
    with product_connection(writer, endpoint) as db:
        return db.execute("""
          SELECT u.run_id,u.counts,u.writes FROM panna.identity_runs u
          JOIN panna.loads l ON l.load_id=u.load_id
          JOIN panna.runs r ON r.run_id=l.run_id
          JOIN panna.receipts p ON p.receipt_id=l.receipt_id
          JOIN panna.streams s ON s.stream_id=l.stream_id
          WHERE u.load_id=%s AND u.reviewer=%s AND u.finished_at IS NOT NULL AND u.run_id>0
            AND r.status='complete' AND l.status='complete'
            AND l.extension='opta_fixtures_ext' AND coalesce(jsonb_typeof(r.plan->'scope'),'null')='null'
            AND s.name=%s AND s.origin='github' AND s.container='opta-latest'
            AND s.dataset='opta_fixtures' AND p.sha256=%s AND l.as_of=%s
          ORDER BY u.run_id DESC LIMIT 1
        """, (load_id, reviewer, ASSET, bytes.fromhex(lease["digest"]), lease["cutoff"])).fetchone()


def run_identity(lease, queue, scratch, endpoint, seconds, monitor):
    if not identity_ready():
        raise Stop("IDENTITY_HANDLER_NOT_READY")
    fixture_run = queue.fixture_run(lease)
    if fixture_run is None:
        raise Stop("IDENTITY_FIXTURE_LOAD_NOT_VERIFIED")
    writer = dsn_from_ssm(IDENTITY_PARAM, IDENTITY_USER)
    load_id = identity_load(writer, endpoint, fixture_run, lease)
    reviewer = f"panna:hosted:{lease['id']}"
    receipt = identity_receipt(writer, endpoint, load_id, reviewer, lease)
    if receipt is None:
        cli(scratch, "run", ["--via", endpoint, "--load", str(load_id), "--reviewer", reviewer],
            writer, monitor, prefix=["teams"], hard_timeout=seconds, report_reason=True)
        receipt = identity_receipt(writer, endpoint, load_id, reviewer, lease)
    if receipt is None or not isinstance(receipt[1], dict) or not isinstance(receipt[2], dict):
        raise Stop("IDENTITY_RECEIPT_PENDING")
    run_id, counts, writes = receipt
    emit("identity_snapshot_receipt", run_id=run_id, load_id=load_id, counts=counts, writes=writes,
         as_of=lease["cutoff"].isoformat(), full_backfill=False)
    return run_id, {"load_id": load_id, "counts": counts, "writes": writes}


def work(lease, queue, scratch, endpoint, deadline):
    remaining = int(deadline - time.monotonic())
    try:
        def monitor():
            if time.monotonic() >= deadline:
                raise Stop("SYNC_DEADLINE")
            guard()

        monitor()
        result = None
        if lease["handler"] == "identity":
            # The resolver is one SQL transaction, unlike the resumable data-loader chunks.
            run_id, result = run_identity(lease, queue, scratch, endpoint, min(remaining - 45, 1200), monitor)
        else:
            run_id = run_product(lease, scratch, endpoint, min(remaining - 45, 420), monitor)
        if not queue.finish(lease, "verified", "RECEIPT_VERIFIED", clock(), run_id, result):
            raise Stop("SYNC_LEASE_LOST")
    except (Stop, sources.SourceError) as error:
        code = error.args[0]
        state = {
            "ASSET_CAPACITY": "capacity_blocked",
            "FIXTURE_LOADER_FAILED": "retry",
            "ACTIONS_ROLE_NOT_READY": "dependency_pending",
            "IDENTITY_HANDLER_NOT_READY": "handler_pending",
            "IDENTITY_FIXTURE_LOAD_NOT_VERIFIED": "dependency_pending",
            "OLDER_SNAPSHOT": "dependency_pending",
            "NOT_A_FULL_SNAPSHOT": "dependency_pending",
            "REVISION_MISSING": "dependency_pending",
            "DIGEST_MISMATCH": "unavailable",
        }.get(code, "retry")
        due = clock() + timedelta(minutes=min(720, 15 * 2 ** min(lease["attempt"], 6)))
        if not queue.finish(lease, state, code, due):
            raise Stop("SYNC_LEASE_LOST")
        emit("sync_item_open", id=lease["id"], handler=lease["handler"], reason=code, status=state)
        return
    if lease["handler"] == "fixtures":
        metric("FixtureIndexVerified", 1)


def metric(name, value):
    dimension = ",Dimensions=[{Name=Revision,Value=" + os.environ["GITHUB_SHA"] + "}]" if name == "QueueIdleUntil" else ""
    aws("cloudwatch", "put-metric-data", "--namespace", "Vega/Panna", "--metric-data",
        f"MetricName={name},Value={value}{dimension}")


def idle_hint(now):
    if os.environ.get("GITHUB_EVENT_NAME") != "schedule" or os.environ.get("PANNA_IDLE_HINT") != "true":
        return False
    try:
        data = aws("cloudwatch", "get-metric-statistics", "--namespace", "Vega/Panna",
                   "--metric-name", "QueueIdleUntil", "--period", "60", "--statistics", "Minimum",
                   "--dimensions", "Name=Revision,Value=" + os.environ["GITHUB_SHA"], "--start-time", (now - timedelta(hours=2)).isoformat(), "--end-time", now.isoformat())
        points = data["Datapoints"]
        return bool(points and max(points, key=lambda point: point["Timestamp"])["Minimum"] > now.timestamp())
    except (Stop, KeyError):
        return False


def tick(scratch):
    if idle_hint(clock()):
        emit("sync_idle_hint")
        return
    guard()
    transcript = session_transcript(scratch)
    tunnel = None
    started = time.monotonic()
    try:
        target = bridge("start", scratch)["target"]
        tunnel = open_tunnel(target, transcript)
        await_tunnel(tunnel, transcript)
        endpoint = "127.0.0.1:" + PORT
        session = Session(dsn_from_ssm(QUEUE_PARAM, QUEUE_USER), via=endpoint, lock=False)
        try:
            if not session.conn.execute("SELECT pg_try_advisory_lock(hashtext('vega-panna-sync'))").fetchone()[0]:
                emit("sync_busy")
                return
            queue = Queue(session.conn)
            now = clock()
            if queue.discovery_due(now) and queue.discover(discover_live(), now.date(), now):
                metric("OptaLatestInventoryVerified", 1)
            queue.heartbeat()
            action_ready = os.environ.get("PANNA_ACTIONS_READY") == "true"
            for sequence in range(4):
                deadline = started + 24 * 60
                if time.monotonic() + 240 >= deadline:
                    break
                queue.activate_dependencies(identity_ready(), action_ready)
                lease = queue.claim(clock())
                if not lease:
                    break
                unit = scratch / f"unit-{sequence}"
                unit.mkdir(mode=0o700)
                try:
                    work(lease, queue, unit, endpoint, deadline)
                finally:
                    shutil.rmtree(unit)
            queue.heartbeat()
            if os.environ.get("PANNA_IDLE_HINT") == "true":
                now = clock()
                until = queue.idle_until(now)
                metric("QueueIdleUntil", int((until or now).timestamp()))
        finally:
            session.close()
    finally:
        close(tunnel, transcript, scratch)
