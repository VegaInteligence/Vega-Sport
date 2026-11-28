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
DOCUMENT = "VegaPannaDailyPostgres"
DB = "vega-football-db-postgres"
AWS = ["aws", "--no-cli-pager", "--region", "us-east-2", "--cli-connect-timeout", "8", "--cli-read-timeout", "12"]


class Stop(Exception):
    pass


def emit(event, **fields):
    print(json.dumps({"event": event, "scope": "fixture_index_only", **fields}), flush=True)


def aws(*args, timeout=25):
    result = subprocess.run([*AWS, *args, "--output", "json"], capture_output=True, text=True, timeout=timeout)
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
    if status:
        emit("loader_failed", operation=operation, exit=status)
        raise Stop("FIXTURE_LOADER_FAILED")
    return [json.loads(line) for line in receipt.read_text().splitlines()]


def guard():
    instance = aws("rds", "describe-db-instances", "--db-instance-identifier", DB,
                   "--query", "DBInstances[0].{size:AllocatedStorage,state:DBInstanceStatus,public:PubliclyAccessible}")
    if instance != {"size": 120, "state": "available", "public": False}:
        raise Stop("RDS_STATE_GUARD")
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
    if projected <= 30 * GIB:
        emit("storage_alert", projected_free_gib=round(projected / GIB, 2))
    if projected <= 24 * GIB or all(p["Average"] >= 75 for p in cpu[-2:]):
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
                 json.dumps({"action": action, "run_key": run_key()}), str(response), timeout=110)
    body = json.loads(response.read_text())
    if result.get("FunctionError") or not body.get("ok"):
        raise Stop("BRIDGE_" + action.upper() + "_FAILED")
    return body


def open_tunnel(target, transcript):
    if not re.fullmatch(r"ecs:vega-v2_[a-f0-9]{32}_[a-zA-Z0-9_-]+", target):
        raise Stop("INVALID_BRIDGE_TARGET")
    with transcript.open("wb") as log:
        return subprocess.Popen([*AWS, "ssm", "start-session", "--target", target, "--document-name", DOCUMENT],
                                stdout=log, stderr=subprocess.STDOUT, start_new_session=True)


def await_tunnel(process, transcript):
    for _ in range(45):
        if process.poll() is not None:
            break
        if "Waiting for connections" in transcript.read_text(errors="replace"):
            return
        time.sleep(1)
    raise Stop("BRIDGE_PORT_UNREADY")


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
    finally:
        result = bridge("cleanup", stage)
        emit("bridge_cleanup", state=result["state"])


def dsn_from_ssm():
    value = aws("ssm", "get-parameter", "--with-decryption", "--name", PARAMETER,
                "--query", "Parameter.Value")
    parsed = urlsplit(value)
    if (parsed.scheme != "postgresql" or parsed.username != "vega_panna_fixture_daily" or
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
        persisted = session.conn.execute(
            "SELECT status, rows_written FROM panna.runs WHERE run_id=%s", (run_id,)
        ).fetchone()
    finally:
        session.close()
    if persisted != ("complete", final["rows_written"]):
        raise Stop("NO_RDS_COMPLETION_RECEIPT")
    emit("fixture_index_verified", run_id=run_id, rows_written=persisted[1], full_backfill=False)
    return persisted[1]

def refresh(scratch, args):
    guard()
    transcript = scratch / "ssm.private"
    tunnel = None
    try:
        target = bridge("start", scratch)["target"]
        tunnel = open_tunnel(target, transcript)
        await_tunnel(tunnel, transcript)
        dsn = dsn_from_ssm()
        run_fixture(scratch, args, dsn, "127.0.0.1:" + PORT, guard)
    finally:
        close(tunnel, transcript, scratch)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["preflight", "refresh"], default="preflight")
    parser.add_argument("--manifest", type=Path, help="local preflight only")
    parser.add_argument("--as-of", type=lambda value: datetime.strptime(value, "%Y-%m-%d").date(),
                        help="local preflight only")
    parser.add_argument("--cleanup-only", action="store_true")
    args = parser.parse_args()
    if args.mode == "refresh" and (args.manifest or args.as_of or os.environ.get("GITHUB_ACTIONS") != "true"):
        raise Stop("REFRESH_REQUIRES_GITHUB_LIVE")
    with tempfile.TemporaryDirectory(prefix="panna-daily-", dir=os.environ.get("RUNNER_TEMP")) as directory:
        scratch = Path(directory)
        if args.cleanup_only:
            close(None, scratch / "ssm.private", scratch)
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
