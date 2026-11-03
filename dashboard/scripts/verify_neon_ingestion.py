#!/usr/bin/env python3
"""E2E: real Neon test branch and branch storage, controlled HTTP provider."""

import argparse, collections, http.server, json, os, subprocess, threading
from pathlib import Path
import psycopg

p = argparse.ArgumentParser()
p.add_argument("--report", required=True)
a = p.parse_args()
test_branch = os.environ.get("NEON_TEST_BRANCH_ID")
assert test_branch and os.environ["NEON_STORAGE_ENDPOINT"].startswith(
    "https://" + test_branch + ".storage."
), "Set the isolated test branch ID and storage endpoint"
report = {
    "command": "NEON_DATABASE_URL=<test writer direct URL> NEON_STORAGE_*=<test branch> python dashboard/scripts/verify_neon_ingestion.py --report docs/verification/neon-runtime-20261103/ingestion-e2e.json",
    "setup": "Real isolated Neon branch and inherited private bucket. Local HTTP fixture provider, no real Pitch key. Tests success/403/404/401/429, duplicate ingestion, lease recovery, locking and materialized pages.",
    "expected": "Refusals skipped; successful data in SQL and S3 once; authentication fatal; expired leases resumable; materialized data visible via normal store contract.",
    "checks": [],
    "status": "failed",
}
counts = collections.Counter()
fixture = {
    "id": "m_TEST01",
    "date": "2010-11-03",
    "time_utc": "2010-11-03T12:00:00Z",
    "status": "finished",
    "home_team": {"id": "t_TEST01", "name": "E2E Home"},
    "away_team": {"id": "t_TEST02", "name": "E2E Away"},
    "score_home": 1,
    "score_away": 0,
    "league": {"id": "l_TEST01", "name": "E2E League"},
    "season": "2010/2011",
}


class Provider(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        path = self.path.split("?")[0].removeprefix("/v1")
        counts[path] += 1
        status = 200
        data = {}
        if path == "/players/p_TEST03":
            status = 403
        elif path == "/players/p_TEST04":
            status = 401
        elif path == "/players/p_TEST05":
            status = 404
        elif path == "/players/p_TEST06" and counts[path] < 3:
            status = 429
        elif path == "/leagues/l_TEST01/matches":
            data = {
                "league": fixture["league"],
                "season": fixture["season"],
                "matches": [fixture],
            }
        elif path == "/matches/m_TEST01":
            data = fixture
        elif path.endswith("/players"):
            data = []
        elif path.endswith("/shots"):
            data = {"periods": []}
        elif path.endswith("/stats"):
            data = {"periods": []}
        elif path.startswith("/players/"):
            data = {"id": path.rsplit("/", 1)[1], "name": "E2E Player"}
        body = json.dumps(
            {"data": data}
            if status == 200
            else {
                "error": {
                    "code": "PLAN_REQUIRED" if status == 403 else "FIXTURE_ERROR",
                    "message": "Controlled verification response",
                }
            }
        ).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Retry-After", "0")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Provider)
threading.Thread(target=server.serve_forever, daemon=True).start()
env = {
    **os.environ,
    "NEON_TEST_INGEST": "1",
    "PITCHAPI_BASE_URL": f"http://127.0.0.1:{server.server_port}/v1",
    "PITCHAPI_API_KEY": "fixture-secret-not-a-provider-key",
    "PITCH_REQUEST_INTERVAL": "0",
}
db = psycopg.connect(os.environ["NEON_DATABASE_URL"], autocommit=True)
assert db.execute(
    "select value from statarena.state where name='validation_branch'"
).fetchone() == (True,), (
    "Refusing fixture mutations without the test-only database marker"
)


def run(endpoint=None, limit=1, materialize=False, expected=0):
    args = [
        os.sys.executable,
        "dashboard/scripts/neon_ingest.py",
        "--mode",
        "historical",
        "--minutes",
        "5",
        "--max-requests",
        str(limit),
    ]
    if endpoint:
        args += ["--seed-endpoint", endpoint]
    if not materialize:
        args += ["--skip-materialize"]
    r = subprocess.run(args, env=env, text=True, capture_output=True, timeout=300)
    report["checks"].append(
        {
            "args": args[1:],
            "exit": r.returncode,
            "stdout": r.stdout,
            "stderr": r.stderr[-2500:],
        }
    )
    assert r.returncode == expected, r.stderr
    return r


try:
    # Reuse a real archived match without calling the controlled provider.
    old_job_keys = set(db.execute("select endpoint,params from statarena.jobs"))
    old_match = db.execute(
        "select o.id from statarena.observations o where not exists(select 1 from statarena.resources r where r.endpoint='/matches/'||o.id and r.params='{}') limit 1"
    ).fetchone()
    if old_match:
        endpoint = "/matches/" + old_match[0]
        run(endpoint)
        ref = db.execute(
            "select ref from statarena.resources where endpoint=%s and params='{}'",
            (endpoint,),
        ).fetchone()[0]
        assert "documentId" in ref and counts[endpoint] == 0
        new_job_keys = (
            set(db.execute("select endpoint,params from statarena.jobs")) - old_job_keys
        )
        with db.cursor() as c:
            c.executemany(
                "delete from statarena.jobs where endpoint=%s and params=%s",
                list(new_job_keys),
            )
        report["checks"].append(
            {
                "reusedOriginalMatch": old_match[0],
                "providerRequests": 0,
                "reference": ref,
            }
        )
    # Force only these controlled jobs; the test branch starts without a collector.
    db.execute(
        "delete from statarena.resources where endpoint like '/players/p_TEST0%%' and ref->>'path' like 'raw/neon/%%'"
    )
    db.execute(
        "delete from statarena.jobs where endpoint like '/players/p_TEST0%%' or endpoint like '/matches/m_TEST01%%' or endpoint like '/teams/t_TEST0%%' or endpoint='/leagues/l_TEST01/matches'"
    )
    db.execute(
        "delete from statarena.resources where (endpoint like '/matches/m_TEST01%%' or endpoint like '/teams/t_TEST0%%' or endpoint='/leagues/l_TEST01/matches') and ref->>'path' like 'raw/neon/%%'"
    )
    db.execute(
        "insert into statarena.jobs(endpoint,priority) values('/players/p_TEST02',1) on conflict do nothing"
    )
    run("/players/p_TEST03", 2)
    assert (
        dict(
            db.execute(
                "select endpoint,status from statarena.resources where endpoint like '/players/p_TEST0%%'"
            )
        )["/players/p_TEST02"]
        == 200
    )
    assert (
        db.execute(
            "select status from statarena.ingest_failures where endpoint='/players/p_TEST03'"
        ).fetchone()[0]
        == 403
    )
    before = db.execute(
        "select ref from statarena.resources where endpoint='/players/p_TEST02'"
    ).fetchone()[0]
    calls = counts["/players/p_TEST02"]
    run("/players/p_TEST02")
    assert (
        db.execute(
            "select ref from statarena.resources where endpoint='/players/p_TEST02'"
        ).fetchone()[0]
        == before
    )
    assert counts["/players/p_TEST02"] == calls
    run("/players/p_TEST05")
    run("/players/p_TEST06")
    assert counts["/players/p_TEST06"] == 3
    run("/players/p_TEST04", expected=1)
    assert (
        db.execute(
            "select 1 from statarena.resources where endpoint='/players/p_TEST04'"
        ).fetchone()
        is None
    )
    db.execute(
        "update statarena.jobs set state='running',lease_until=now()-interval '1 minute',available_at=now() where endpoint='/players/p_TEST04'"
    )
    db.execute("delete from statarena.jobs where endpoint='/players/p_TEST04'")
    db.execute(
        "insert into statarena.jobs(endpoint,state,lease_until) values('/players/p_TEST07','running',now()-interval '1 minute') on conflict do nothing"
    )
    run("/players/p_TEST08", 2)
    assert (
        db.execute(
            "select status from statarena.resources where endpoint='/players/p_TEST07'"
        ).fetchone()[0]
        == 200
    )
    db.execute("select pg_advisory_lock(97813003)")
    r = run("/players/p_TEST09")
    assert "Another ingestion" in r.stdout
    db.execute("select pg_advisory_unlock(97813003)")
    run("/leagues/l_TEST01/matches", 30, materialize=True)
    from neon_store import Store

    store = Store()
    manifest = store.json("computed/dashboard/index.json")
    season = next(s for s in manifest["seasons"] if s["id"] == "2010/2011")
    chunk = next(c for c in season["chunks"] if c["leagueId"] == "l_TEST01")
    doc = store.json(chunk["path"])
    assert doc["meta"]["matchCount"] == 1
    assert doc["tables"]["matches"]["rows"]
    report["checks"].append(
        {
            "materializedChunk": chunk["path"],
            "fixtures": db.execute(
                "select count(*) from statarena.fixtures where id='m_TEST01'"
            ).fetchone()[0],
        }
    )
    report["status"] = "passed"
except Exception as e:
    report["error"] = str(e)
    raise
finally:
    report["providerRequests"] = dict(counts)
    server.shutdown()
    db.close()
    Path(a.report).write_text(json.dumps(report, indent=2) + "\n")
    print(
        json.dumps(
            {
                "status": report["status"],
                "report": a.report,
                "error": report.get("error"),
            }
        )
    )
