"""Build the deterministic v2 release ZIPs (same recipe as infra/aws-backend/package.py):
the read API (api-index.mjs) and, with `live`, the live read (live-index.mjs).

    python3 infra/aws-v2/package_api.py <dir>        # the read API
    python3 infra/aws-v2/package_api.py <dir> live   # GET /live/matches/{id}
"""
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]

# entry, files beside index.mjs, bundler flags, a path no route claims (offline: 404).
KINDS = {
    "api": ("api-index.mjs", ("rds-ca.pem",), [], "/api/read/nothing"),
    # The AWS SDK is the Node.js runtime's own: not bundled.
    "live": ("live-index.mjs", (), ["--external", "@aws-sdk/*"], "/live/nothing"),
}


def build(output, kind="api"):
    entry, files, flags, nothing = KINDS[kind]
    with tempfile.TemporaryDirectory(prefix=f"vega-v2-{kind}-") as staging:
        stage = Path(staging)
        subprocess.run(
            ["bun", "build", str(HERE / entry), "--target=node", "--format=esm", *flags, "--outfile=" + str(stage / "index.mjs")],
            cwd=ROOT,
            check=True,
        )
        if "rds-ca.pem" in files:
            shutil.copyfile(ROOT / "dashboard/backend/certs/rds-us-east-2.pem", stage / "rds-ca.pem")
        # Offline: a path no route claims answers 404 without touching the database or AWS.
        check = f"""import {{handler}} from './index.mjs';
const event={{version:'2.0',rawPath:'{nothing}',rawQueryString:'',headers:{{}},requestContext:{{http:{{method:'GET'}}}}}};
const out=await handler(event);
if(out.statusCode!==404)throw Error('offline unknown path must return 404: '+out.statusCode);"""
        subprocess.run(
            [os.environ.get("BUILD_NODE", "node"), "--input-type=module", "-e", check],
            cwd=stage,
            env={"PATH": os.environ["PATH"], "LAMBDA_TASK_ROOT": str(stage)},
            check=True,
        )
        with ZipFile(stage / "release.zip", "w") as z:
            for name in ("index.mjs", *files):
                info = ZipInfo(name, date_time=(2020, 1, 1, 0, 0, 0))
                info.external_attr = 0o100644 << 16
                z.writestr(info, (stage / name).read_bytes(), compress_type=ZIP_DEFLATED)
        sha = hashlib.sha256((stage / "release.zip").read_bytes()).hexdigest()
        output.mkdir(parents=True, exist_ok=True)
        target = output / (sha + ".zip")
        shutil.copyfile(stage / "release.zip", target)
        return target


if __name__ == "__main__":
    print(build(Path(sys.argv[1]), sys.argv[2] if len(sys.argv) > 2 else "api"))
