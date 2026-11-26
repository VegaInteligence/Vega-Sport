"""Build the deterministic release ZIPs:
the read API (api-index.mjs), with `live` the live read (live-index.mjs), and the account
API's two functions (backend/account/lambda, after `npm ci --prefix backend/account`).

    python3 infra/aws/package_api.py <dir>                 # the read API
    python3 infra/aws/package_api.py <dir> live            # GET /live/matches/{id}
    python3 infra/aws/package_api.py <dir> account-front   # vega-v2-account-front
    python3 infra/aws/package_api.py <dir> account-store   # vega-v2-account-store
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]

# What a package's index.mjs must answer offline, with no configuration, before it is uploaded.
UNKNOWN_PATH_404 = """const event={version:'2.0',rawPath:'%s',rawQueryString:'',headers:{},requestContext:{http:{method:'GET'}}};
const out=await handler(event);
if(out.statusCode!==404)throw Error('offline unknown path must return 404: '+out.statusCode);"""
# The account front without its settings serves nothing: every request answers 503 NOT_CONFIGURED.
FRONT_NOT_CONFIGURED = """const event={version:'2.0',rawPath:'/account/session',rawQueryString:'',headers:{},requestContext:{http:{method:'POST'}}};
const out=await handler(event);
if(out.statusCode!==503||JSON.parse(out.body).error.code!=='NOT_CONFIGURED')throw Error('offline front must answer 503 NOT_CONFIGURED: '+out.statusCode);"""
# The account store without its database refuses every command.
STORE_NOT_CONFIGURED = """const out=await handler({command:'session',accountId:'a1'});
if(out.ok!==false||out.code!=='NOT_CONFIGURED')throw Error('offline store must refuse with NOT_CONFIGURED: '+JSON.stringify(out));"""

# entry, files beside index.mjs, bundler flags, the offline check.
KINDS = {
    "api": ("api-index.mjs", ("rds-ca.pem",), [], UNKNOWN_PATH_404 % "/api/read/nothing"),
    # The AWS SDK is the Node.js runtime's own: not bundled.
    "live": ("live-index.mjs", (), ["--external", "@aws-sdk/*"], UNKNOWN_PATH_404 % "/live/nothing"),
    # The front invokes the store with the runtime's SDK; the store verifies TLS with the bundled CA.
    "account-front": ("../../backend/account/lambda/front-index.mjs", (), ["--external", "@aws-sdk/*"], FRONT_NOT_CONFIGURED),
    "account-store": ("../../backend/account/lambda/store-index.mjs", ("rds-ca.pem",), [], STORE_NOT_CONFIGURED),
}


def build(output, kind="api"):
    entry, files, flags, offline = KINDS[kind]
    node = os.environ.get("BUILD_NODE", "node")
    if kind == "api":
        digest = subprocess.run(
            [node, "--input-type=module", "-e",
             "import { codeDigest } from './backend/api/src/data-versions.mjs'; console.log(codeDigest())"],
            cwd=ROOT, check=True, text=True, capture_output=True,
        ).stdout.strip()
        flags = [*flags, "--define", "VEGA_BUNDLED_CODE_DIGEST=" + json.dumps(digest)]
    with tempfile.TemporaryDirectory(prefix=f"vega-v2-{kind}-") as staging:
        stage = Path(staging)
        subprocess.run(
            ["bun", "build", str(HERE / entry), "--target=node", "--format=esm", *flags, "--outfile=" + str(stage / "index.mjs")],
            cwd=ROOT,
            check=True,
        )
        if "rds-ca.pem" in files:
            shutil.copyfile(ROOT / "backend/certs/rds-us-east-2.pem", stage / "rds-ca.pem")
        # Offline: the bundled file answers predictably without touching the database or AWS.
        check = "import {handler} from './index.mjs';\n" + offline
        subprocess.run(
            [node, "--input-type=module", "-e", check],
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
