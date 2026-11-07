"""Package a finite SQL manifest and IAM-only worker as a deterministic release."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]


def build(manifest, output):
    document = json.loads(manifest.read_text())
    if not isinstance(document.get("operations"), dict) or not document["operations"]:
        raise ValueError("A reviewed operation manifest is required")
    for name, operation in document["operations"].items():
        if operation.get("mode") not in ("read", "write") or not operation.get("sql"):
            raise ValueError(f"Invalid operation: {name}")
        if not set(operation.get("targets", [])) <= {"stage", "prod"}:
            raise ValueError(f"Invalid target: {name}")
    with tempfile.TemporaryDirectory(prefix="vega-maintenance-") as staging:
        stage = Path(staging)
        subprocess.run(["bun", "build", str(HERE / "index.mjs"), "--target=node", "--format=esm",
                        "--outfile=" + str(stage / "index.mjs")], cwd=ROOT, check=True)
        shutil.copyfile(ROOT / "dashboard/backend/certs/rds-us-east-2.pem", stage / "rds-ca.pem")
        (stage / "operations.json").write_text(json.dumps(document, ensure_ascii=False, separators=(",", ":")))
        # Import in isolation and prove invocation-supplied SQL is rejected before
        # connecting to any database. No credentials are needed for packaging.
        check = """import {handler} from './index.mjs';
let rejected=false;try{await handler({operation:'injected',sql:'SELECT 1'})}catch{rejected=true}
if(!rejected)throw Error('Unpackaged SQL was accepted');"""
        subprocess.run([os.environ.get("BUILD_NODE", "node"), "--input-type=module", "-e", check],
                       cwd=stage, env={"PATH": os.environ["PATH"], "LAMBDA_TASK_ROOT": str(stage)}, check=True)
        with ZipFile(stage / "release.zip", "w") as archive:
            for name in ("index.mjs", "operations.json", "rds-ca.pem"):
                entry = ZipInfo(name, date_time=(2020, 1, 1, 0, 0, 0))
                entry.external_attr = 0o100644 << 16
                archive.writestr(entry, (stage / name).read_bytes(), compress_type=ZIP_DEFLATED)
        data = (stage / "release.zip").read_bytes()
        sha = hashlib.sha256(data).hexdigest()
        output.mkdir(parents=True, exist_ok=True)
        destination = output / (sha + ".zip")
        destination.write_bytes(data)
        print(json.dumps({"path": str(destination), "sha256": sha, "bytes": len(data),
                          "operationHashes": {key: hashlib.sha256(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()
                                              for key, value in document["operations"].items()}}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    build(args.manifest, args.output)
