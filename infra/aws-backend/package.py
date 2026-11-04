"""Build a deterministic release ZIP from the checked-out app and installed locked dependencies."""
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]


def build(output):
    with tempfile.TemporaryDirectory(prefix="statarena-release-") as staging:
        stage = Path(staging)
        subprocess.run(["bun", "build", str(HERE / "index.mjs"), "--target=node",
                        "--format=esm", "--outfile=" + str(stage / "index.mjs")], cwd=ROOT, check=True)
        shutil.copyfile(ROOT / "dashboard/backend/certs/rds-us-east-2.pem", stage / "rds-ca.pem")
        # Import from an isolated directory with no node_modules or DB environment.
        # Exercise the real app route (not an adapter fixture).
        check = """import {handler} from './index.mjs';
const event={version:'2.0',rawPath:'/api/assets',rawQueryString:'',headers:{},requestContext:{http:{method:'GET'}}};
const out=await handler(event);
if(out.statusCode!==400)throw Error('offline invalid-asset path must return 400: '+out.statusCode);"""
        subprocess.run([os.environ.get("BUILD_NODE", "node"), "--input-type=module", "-e", check],
                       cwd=stage, env={"PATH": os.environ["PATH"], "LAMBDA_TASK_ROOT": str(stage)}, check=True)
        with ZipFile(stage / "release.zip", "w") as z:
            for name in ("index.mjs", "rds-ca.pem"):
                entry = ZipInfo(name, date_time=(2020, 1, 1, 0, 0, 0))
                entry.external_attr = 0o100644 << 16
                z.writestr(entry, (stage / name).read_bytes(), compress_type=ZIP_DEFLATED)
        sha = hashlib.sha256((stage / "release.zip").read_bytes()).hexdigest()
        output.mkdir(parents=True, exist_ok=True)
        target = output / (sha + ".zip")
        shutil.copyfile(stage / "release.zip", target)
        return target


if __name__ == "__main__":
    print(build(Path(sys.argv[1])))
