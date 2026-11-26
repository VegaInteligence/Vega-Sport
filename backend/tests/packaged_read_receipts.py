"""Exercise a worker image's real publication round followed by the packaged Lambda (GH137R-n)."""
import json
import os
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
from urllib.parse import urlsplit, urlunsplit
from uuid import uuid4
from zipfile import ZipFile

from psycopg import sql

from test_read_receipts import DSN, PATHS, SELECTIONS, ReadReceiptsTest

ROOT = Path(__file__).resolve().parents[2]
ASK = """
import {handler} from './index.mjs';
let asked = JSON.parse(process.argv[1]);
let out = [];
for (const [query, tag] of asked) {
  const url = new URL(query, "https://api.test");
  const result = await handler({
    version: '2.0', rawPath: url.pathname, rawQueryString: url.search.slice(1),
    headers: tag ? {'if-none-match': tag} : {}, requestContext: {http: {method: 'GET'}},
  });
  out.push({query, status: result.statusCode, etag: result.headers.etag,
    timing: result.headers['server-timing'], bytes: Buffer.byteLength(result.body ?? '')});
}
process.stdout.write(JSON.stringify(out) + '\\n', () => process.exit(0));
"""
PUBLISH = """
import os
from types import SimpleNamespace
from vega.store import Store
from vega.worker import Worker, connect

with connect(os.environ["V2_DATABASE_URL"]) as db:
    worker = Worker(Store(db), SimpleNamespace(), receipts_dsn=os.environ["V2_CALC_DATABASE_URL"])
    for _ in range(12):
        worker.publish()
"""


def ask(stage, requests, evidence):
    query = urlsplit(DSN)
    dsn = urlunsplit(query._replace(query="sslmode=disable"))
    run = subprocess.run(
        ["node", "--input-type=module", "-e", ASK, json.dumps(requests)], cwd=stage,
        env={**os.environ, "LAMBDA_TASK_ROOT": str(stage), "V2_READ_DATABASE_URL": dsn, "VEGA_RELEASE": "packaged-receipts-e2e"},
        text=True, capture_output=True, timeout=120,
    )
    evidence.write_text(run.stdout + run.stderr)
    run.check_returncode()
    return json.loads(run.stdout.strip().splitlines()[-1])


def main(image, pg_container, out):
    out = Path(out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    (out / "rerun.txt").write_text(
        "With a local disposable PostgreSQL 18 database vega_v2_receipts_test, set VEGA_V2_RECEIPTS_TEST_DSN "
        "and use Node 24, Bun and the backend requirements. The test seeds the six URLs in input.json.\n"
        f"docker build --platform linux/arm64 -f backend/Dockerfile -t {image} .\n"
        f"PYTHONPATH=backend python backend/tests/packaged_read_receipts.py {image} {pg_container} '{out}'\n"
        "Expected: cold 200 for each URL, then exact-tag 304 with an empty body and one database instruction.\n"
    )
    (out / "input.json").write_text(json.dumps(PATHS, indent=2) + "\n")
    ReadReceiptsTest.setUpClass()
    db = ReadReceiptsTest.db
    login = f"vega_receipts_ci_{uuid4().hex[:12]}"
    password = uuid4().hex
    db.execute(sql.SQL("CREATE ROLE {} LOGIN PASSWORD {}").format(sql.Identifier(login), sql.Literal(password)))
    try:
        db.execute(sql.SQL("GRANT vega_calc TO {}").format(sql.Identifier(login)))
        query = urlsplit(DSN)
        calc = urlunsplit(query._replace(netloc=f"{login}:{password}@127.0.0.1:5432"))
        owner = urlunsplit(query._replace(netloc=query.netloc.rsplit("@", 1)[0] + "@127.0.0.1:5432"))
        with TemporaryDirectory(prefix="vega-packaged-receipts-") as temp:
            stage = Path(temp)
            package = subprocess.run(
                [sys.executable, str(ROOT / "infra/aws/package_api.py"), str(stage)],
                cwd=ROOT, text=True, capture_output=True, check=True,
            )
            (out / "package.log").write_text(package.stdout + package.stderr)
            with ZipFile(package.stdout.strip().splitlines()[-1]) as release:
                release.extractall(stage)
            cold = ask(stage, [(path, None) for path in PATHS], out / "cold.log")
            assert len(cold) == len(PATHS)
            assert all(r["status"] == 200 and r["bytes"] > 0 and r["etag"] for r in cold), cold
            cmd = ["docker", "run", "--rm", "--network", f"container:{pg_container}", "--entrypoint", "python",
                   "-e", "V2_DATABASE_URL", "-e", "V2_CALC_DATABASE_URL", image, "-c", PUBLISH]
            run = subprocess.run(cmd, env={**os.environ, "V2_DATABASE_URL": owner, "V2_CALC_DATABASE_URL": calc},
                                 text=True, capture_output=True, timeout=120)
            (out / "worker.log").write_text(run.stdout + run.stderr)
            run.check_returncode()
            # Use a second invocation of the actual Function URL adapter and require the original complete tag.
            conditional = ask(stage, [(r["query"], r["etag"]) for r in cold], out / "conditional.log")
            for a, b in zip(cold, conditional, strict=True):
                assert (b["status"], b["etag"], b["bytes"]) == (304, a["etag"], 0), (a, b)
                assert 'desc="1 query"' in b["timing"], b
                route, selector = SELECTIONS[b["query"]]
                proof = db.execute("SELECT digest FROM ops.read_receipts WHERE route=%s AND selector=%s "
                                   "AND version=ops.receipt_version(relations, scopes)", (route, selector)).fetchone()
                assert proof == (a["etag"].rsplit("-", 1)[1].rstrip('"'),), (b, proof)
            (out / "results.json").write_text(json.dumps(conditional, indent=2) + "\n")
            print(f"worker image to packaged Lambda: {len(conditional)}/{len(PATHS)} exact 304s, one lookup each")
    finally:
        db.execute(sql.SQL("DROP ROLE {}").format(sql.Identifier(login)))
        ReadReceiptsTest.tearDownClass()


if __name__ == "__main__":
    main(*sys.argv[1:])
