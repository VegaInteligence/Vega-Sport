"""Scheduled PannaData technical fixture-index refresh. No canonical publication."""
import argparse
from datetime import UTC, datetime, timedelta
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from urllib.parse import parse_qs, urlsplit

from panna import registry, sources

ASSET = "opta_fixtures.parquet"
ACCOUNT = "361769570630"
PORT = "15432"
GIB = 1024 ** 3
SOURCE_LIMIT = 128 * 1024 ** 2
PARAMETER = "/vega/v2/panna-fixture-refresh-database-url"
CONNECT_PARAMETER = "/vega/v2/panna-fixture-connect-database-url"
REFRESH_USER = "vega_panna_fixture_daily"
CONNECT_USER = "vega_panna_fixture_connect"
DOCUMENT = "VegaPannaDailyPostgres"
DB = "vega-football-db-postgres"
AWS = ["aws", "--no-cli-pager", "--region", "us-east-2", "--cli-connect-timeout", "8"]


class Stop(Exception):
    pass


def emit(event, **fields):
    print(json.dumps({"event": event, "scope": "fixture_index_only", **fields}), flush=True)


def aws(*args, timeout=25, read_timeout=12, attempts=None):
    env = os.environ.copy()
    if attempts is not None:
        env["AWS_MAX_ATTEMPTS"] = str(attempts)
    result = subprocess.run([*AWS, *args, "--output", "json", "--cli-read-timeout", str(read_timeout)],
                            capture_output=True, text=True, timeout=timeout, env=env)
    if result.returncode:
        raise Stop("AWS_" + "_".join(arg.upper().replace("-", "_") for arg in args[:2]))
    return json.loads(result.stdout) if result.stdout.strip() else {}


def pin(scratch, manifest):
    if manifest is None:
        inventory = sources.list_release(registry.GITHUB_API, registry.REPO, registry.RELEASE,
                                         os.environ.get("GITHUB_TOKEN"))
    else:
        inventory = sources.read_manifest(manifest)
    asset, = sources.select(inventory, names=[ASSET])
    if not re.fullmatch(r"[0-9a-f]{64}", asset.sha256 or ""):
        raise Stop("DECLARED_SHA256_REQUIRED")
    if not (0 < asset.bytes <= SOURCE_LIMIT and shutil.disk_usage(scratch).free >= asset.bytes + GIB):
        raise Stop("FIXTURE_SCRATCH_LIMIT")
    if manifest is None and not (
        asset.asset_id and asset.updated_at and asset.url ==
        f"https://github.com/{registry.REPO}/releases/download/{registry.RELEASE}/{ASSET}"
    ):
        raise Stop("INVALID_LIVE_ASSET_IDENTITY")
    local, _ = sources.fetch(asset, scratch, SOURCE_LIMIT)
    asset.path = str(local)
    pinned = scratch / "fixture-plan-input.json"
    pinned.write_text(json.dumps({"assets": [asset.to_plan()]}))
    emit("source_pinned", asset=asset.name, sha256=asset.sha256, upstream_id=asset.asset_id,
         bytes=asset.bytes, updated_at=asset.updated_at, listed_assets=len(inventory),
         excluded_assets=len(inventory) - 1)
    return pinned


def load_env(dsn):
    env = {k: v for k, v in os.environ.items() if not k.startswith(("AWS_", "ACTIONS_ID_TOKEN_"))}
    env.pop("GITHUB_TOKEN", None)
    env.pop("V2_PANNA_DATABASE_URL", None)
    if dsn:
        env["V2_PANNA_DATABASE_URL"] = dsn
    return env


def cli(scratch, operation, args, dsn=None, monitor=None):
    # Capture private output. Publish only the vetted fields below, never raw tracebacks or row values.
    receipt = scratch / (operation + ".jsonl")
    with receipt.open("wb") as out:
        process = subprocess.Popen([sys.executable, "-m", "panna", operation, *args],
                                   env=load_env(dsn), stdout=out, stderr=subprocess.STDOUT,
                                   start_new_session=True)
        try:
            while True:
                try:
                    status = process.wait(timeout=45)
                    break
                except subprocess.TimeoutExpired:
                    if monitor:
                        monitor()
        finally:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=8)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait()
    rows = []
    for line in receipt.read_text(errors="replace").splitlines():
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(row, dict):
            rows.append(row)
    if status:
        codes = sorted({value for row in rows for value in (row.get("reason"), row.get("code"))
                        if isinstance(value, str) and re.fullmatch(r"[A-Z][A-Z0-9_]{2,60}", value)})
        emit("loader_failed", operation=operation, exit=status, codes=codes)
        raise Stop("FIXTURE_LOADER_FAILED")
    return rows


def guard():
    instance = aws("rds", "describe-db-instances", "--db-instance-identifier", DB,
                   "--query", "DBInstances[0].{size:AllocatedStorage,state:DBInstanceStatus,public:PubliclyAccessible,host:Endpoint.Address}")
    if (instance["state"] not in {"available", "backing-up"} or instance["public"] is not False or
        instance["host"] != os.environ["PANNA_RDS_HOST"] or not 120 <= instance["size"] <= 300):
        raise Stop("RDS_STATE_GUARD")
    allocation = instance["size"] * GIB
    now = datetime.now(UTC)
    window = [("--start-time", (now - timedelta(minutes=18)).isoformat()), ("--end-time", now.isoformat())]
    scope = ["--namespace", "AWS/RDS", "--dimensions", "Name=DBInstanceIdentifier,Value=" + DB,
             *[x for pair in window for x in pair], "--period", "300"]
    free = aws("cloudwatch", "get-metric-statistics", *scope, "--metric-name", "FreeStorageSpace",
               "--statistics", "Minimum")["Datapoints"]
    cpu = aws("cloudwatch", "get-metric-statistics", *scope, "--metric-name", "CPUUtilization",
              "--statistics", "Average")["Datapoints"]
    free.sort(key=lambda p: p["Timestamp"])
    cpu.sort(key=lambda p: p["Timestamp"])
    if len(free) < 2 or len(cpu) < 2 or any(
        now - datetime.fromisoformat(series[-1]["Timestamp"]) > timedelta(minutes=10) for series in (free, cpu)
    ):
        raise Stop("RDS_METRICS_STALE")
    # One fixture object <=128 MiB, pending validation of the 1 GiB SQL peak allowance.
    projected = min(p["Minimum"] for p in free) - GIB
    if projected <= allocation * 0.25:
        emit("storage_alert", projected_free_gib=round(projected / GIB, 2))
    if projected <= allocation * 0.20 or all(p["Average"] >= 75 for p in cpu[-2:]):
        raise Stop("RDS_LOAD_GUARD")


def run_key():
    key = f"panna-{os.environ['GITHUB_RUN_ID']}-{os.environ['GITHUB_RUN_ATTEMPT']}"
    if not re.fullmatch(r"panna-[0-9]{1,20}-[0-9]{1,6}", key):
        raise Stop("INVALID_RUN_KEY")
    return key


def bridge(action, stage):
    response = stage / "bridge-response.json"
    response.unlink(missing_ok=True)
    result = aws("lambda", "invoke", "--function-name", os.environ["PANNA_BRIDGE_LAUNCHER"],
                 "--cli-binary-format", "raw-in-base64-out", "--payload",
                 json.dumps({"action": action, "run_key": run_key()}), str(response), timeout=125, read_timeout=115, attempts=1)
    body = json.loads(response.read_text())
    if result.get("FunctionError") or not body.get("ok"):
        raise Stop("BRIDGE_" + action.upper() + "_FAILED")
    return body


def open_tunnel(target, transcript):
    if not re.fullmatch(r"ecs:vega-v2_[a-f0-9]{32}_[a-zA-Z0-9_-]+", target):
        raise Stop("INVALID_BRIDGE_TARGET")
    flags = os.O_CREAT | os.O_TRUNC | os.O_WRONLY | os.O_NOFOLLOW
    with os.fdopen(os.open(transcript, flags, 0o600), "wb") as log:
        return subprocess.Popen([*AWS, "ssm", "start-session", "--target", target, "--document-name", DOCUMENT, "--cli-read-timeout", "12"],
                                stdout=log, stderr=subprocess.STDOUT, start_new_session=True)


def await_tunnel(process, transcript):
    for _ in range(45):
        if process.poll() is not None:
            break
        if "Waiting for connections" in transcript.read_text(errors="replace"):
            return
        time.sleep(1)
    raise Stop("BRIDGE_PORT_UNREADY")


def session_transcript(scratch):
    """Keep only the private port-forward transcript across GitHub cancellation steps."""
    if os.environ.get("GITHUB_ACTIONS") != "true":
        return scratch / "ssm.private"
    run_state = Path(os.environ["RUNNER_TEMP"]) / ("vega-panna-connect-" + run_key())
    run_state.mkdir(mode=0o700, exist_ok=True)
    if run_state.is_symlink() or run_state.stat().st_uid != os.getuid():
        raise Stop("UNSAFE_SESSION_STATE")
    run_state.chmod(0o700)
    return run_state / "ssm.private"


def close(tunnel, transcript, stage):
    try:
        if tunnel is not None and tunnel.poll() is None:
            os.killpg(tunnel.pid, signal.SIGTERM)
            try:
                tunnel.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(tunnel.pid, signal.SIGKILL)
                tunnel.wait()
        if transcript.exists():
            ids = re.findall(r"Starting session with SessionId: ([A-Za-z0-9_-]+)", transcript.read_text(errors="replace"))
            for session_id in set(ids):
                aws("ssm", "terminate-session", "--session-id", session_id)
            if ids:
                transcript.unlink(missing_ok=True)
                emit("bridge_sessions_terminated", count=len(set(ids)))
    finally:
        result = bridge("cleanup", stage)
        emit("bridge_cleanup", state=result["state"])


def dsn_from_ssm(parameter=PARAMETER, user=REFRESH_USER):
    value = aws("ssm", "get-parameter", "--with-decryption", "--name", parameter,
                "--query", "Parameter.Value")
    parsed = urlsplit(value)
    if (parsed.scheme != "postgresql" or parsed.username != user or
        parsed.hostname != os.environ["PANNA_RDS_HOST"] or parsed.port not in (None, 5432) or
        not parsed.password or parsed.path != "/vega_v2" or parse_qs(parsed.query) != {"sslmode": ["verify-full"]}):
        raise Stop("UNEXPECTED_FIXTURE_LOGIN")
    return value


def run_fixture(scratch, args, dsn, endpoint=None, monitor=None):
    via = ["--via", endpoint] if endpoint else []
    rows = cli(scratch, "run", [*args, *via, "--max-seconds", "420", "--chunk-rows", "10000",
                                "--database-ceiling-bytes", str(90 * GIB),
                                "--scratch-ceiling-bytes", str(SOURCE_LIMIT)], dsn, monitor)
    final, = [row for row in rows if row["event"] == "run_end"]
    if final["status"] != "complete":
        raise Stop("FIXTURE_RUN_INCOMPLETE")
    run_id = int(final["run_id"])
    cli(scratch, "verify", [*via, "--run", str(run_id)], dsn)
    # Check the DB independently rather than treating the client summary as a durable receipt.
    from panna.db import Session
    session = Session(dsn, via=endpoint, lock=False)
    try:
        expected = sources.read_manifest(Path(args[args.index("--manifest") + 1]))[ASSET]
        cutoff = args[args.index("--as-of") + 1]
        persisted = session.conn.execute(
            """SELECT r.status, r.rows_written, EXISTS (
                 SELECT 1 FROM panna.current_generations g
                 JOIN panna.loads l ON l.load_id = g.load_id
                 WHERE g.origin = %s AND g.container = %s AND g.name = %s
                   AND g.sha256 = %s AND g.as_of = %s::date AND l.run_id = r.run_id
               )
               FROM panna.runs r WHERE r.run_id=%s""",
            (expected.origin, expected.container, expected.name, bytes.fromhex(expected.sha256), cutoff, run_id)
        ).fetchone()
    finally:
        session.close()
    if persisted != ("complete", final["rows_written"], True):
        raise Stop("NO_RDS_COMPLETION_RECEIPT")
    emit("fixture_index_verified", run_id=run_id, rows_written=persisted[1], full_backfill=False)
    return persisted[1]

def verify_connection(dsn, endpoint):
    import psycopg
    from panna.db import connect_kwargs

    with psycopg.connect(dsn, **connect_kwargs(dsn, endpoint)) as connection:
        connection.execute("SET TRANSACTION READ ONLY")
        identity = connection.execute("""
            SELECT current_user, current_database(), current_setting('transaction_read_only'),
                   (SELECT version FROM pg_stat_ssl WHERE pid = pg_backend_pid()),
                   has_schema_privilege(current_user, 'core', 'USAGE'),
                   (SELECT has_table_privilege(current_user, c.oid, 'INSERT')
                    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                    WHERE n.nspname = 'panna_data' AND c.relname = 'opta_fixtures'),
                   (SELECT has_table_privilege(current_user, c.oid, 'INSERT')
                    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                    WHERE n.nspname = 'panna' AND c.relname = 'runs')
        """).fetchone()
        if not identity or identity[:3] != (CONNECT_USER, "vega_v2", "on") or identity[3] not in {
            "TLSv1.2", "TLSv1.3"
        } or identity[4:] != (False, False, False):
            raise Stop("CONNECT_IDENTITY_MISMATCH")
        emit("rds_read_only_verified", tls=identity[3], database_login=True, source_transfer=False)


def connect(scratch):
    guard()
    transcript = session_transcript(scratch)
    tunnel = None
    try:
        target = bridge("start", scratch)["target"]
        tunnel = open_tunnel(target, transcript)
        await_tunnel(tunnel, transcript)
        verify_connection(dsn_from_ssm(CONNECT_PARAMETER, CONNECT_USER), "127.0.0.1:" + PORT)
        if os.environ.get("PANNA_CONNECT_HOLD") == "true":
            emit("cancellation_probe_ready", hold_seconds=90)
            time.sleep(90)
    finally:
        close(tunnel, transcript, scratch)


def refresh(scratch, args):
    guard()
    transcript = session_transcript(scratch)
    tunnel = None
    try:
        target = bridge("start", scratch)["target"]
        tunnel = open_tunnel(target, transcript)
        await_tunnel(tunnel, transcript)
        dsn = dsn_from_ssm()
        run_fixture(scratch, args, dsn, "127.0.0.1:" + PORT, guard)
    finally:
        close(tunnel, transcript, scratch)
    aws("cloudwatch", "put-metric-data", "--namespace", "Vega/Panna", "--metric-data",
        "MetricName=FixtureIndexVerified,Value=1,Unit=Count")
    emit("fixture_heartbeat_published")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["preflight", "connect", "refresh"], default="preflight")
    parser.add_argument("--manifest", type=Path, help="local preflight only")
    parser.add_argument("--as-of", type=lambda value: datetime.strptime(value, "%Y-%m-%d").date(),
                        help="local preflight only")
    parser.add_argument("--cleanup-only", action="store_true")
    args = parser.parse_args()
    if args.mode != "preflight" and (args.manifest or args.as_of or os.environ.get("GITHUB_ACTIONS") != "true"):
        raise Stop("REFRESH_REQUIRES_GITHUB_LIVE")
    with tempfile.TemporaryDirectory(prefix="panna-daily-", dir=os.environ.get("RUNNER_TEMP")) as directory:
        scratch = Path(directory)
        if args.cleanup_only:
            close(None, session_transcript(scratch), scratch)
            return
        if args.mode == "connect":
            connect(scratch)
            return
        manifest = pin(scratch, args.manifest)
        cutoff = (args.as_of or datetime.now(UTC).date()).isoformat()
        base = ["--manifest", str(manifest), "--asset", ASSET, "--as-of", cutoff, "--scratch", directory]
        if args.mode == "refresh":
            refresh(scratch, base)
        else:
            output = cli(scratch, "probe", base)
            for row in output:
                if row.get("event") in {"object", "probe_end"}:
                    emit("fixture_probe", **{k: v for k, v in row.items() if k in {"name", "source_rows", "rows", "outcomes", "status", "totals", "extension"}})
            emit("preflight_complete", as_of=cutoff, full_backfill=False)


def interrupt(_sig, _frame):
    raise KeyboardInterrupt


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, interrupt)
    try:
        main()
    except (Stop, sources.SourceError) as error:
        emit("stopped", code=error.args[0])
        sys.exit(1)
    except KeyboardInterrupt:
        emit("stopped", code="INTERRUPTED")
        sys.exit(130)
    except Exception as error:
        emit("stopped", code=type(error).__name__)
        sys.exit(1)
