"""Validate a complete staged document before replacing the published review folder."""
import datetime
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

OUT = Path(__file__).resolve().parents[1]

def source_fingerprint():
    files = sorted([*OUT.glob("tools/*"), *OUT.glob("inputs/*"), OUT / "PRO_VERSIONING_DESIGN.md", OUT / "PRO_REVIEW_RESPONSE.md"])
    return {str(p.relative_to(OUT)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in files if p.is_file()}

def main():
    before = source_fingerprint()
    stage = Path(tempfile.mkdtemp(prefix=".orion-plan-staging-", dir=OUT.parent))
    backup = OUT.parent / (".orion-plan-previous-" + stage.name.rsplit("-", 1)[-1])
    promoted = False
    receipt = {"atUtc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
               "command": "python3 -B docs/architecture/orion-plan-20261104/tools/rebuild_plan.py",
               "sourceSha256": before, "steps": [], "passed": False,
               "scope": "Staged complete document generation and independent static inspection only. No SQL or service operation."}
    try:
        shutil.copytree(OUT, stage, dirs_exist_ok=True, ignore=shutil.ignore_patterns("__pycache__"))
        commands = [[sys.executable, "build_proposal.py"], [sys.executable, "render_plan.py"],
                    ["node", "render_diagrams.mjs"], [sys.executable, "render_plan_text.py"],
                    [sys.executable, "build_viewer.py"], [sys.executable, "inspect_proposal.py"]]
        for command in commands:
            result = subprocess.run([command[0], str(stage / "tools" / command[1])], capture_output=True, text=True)
            receipt["steps"].append(dict(command=command, exitCode=result.returncode, stdout=result.stdout, stderr=result.stderr))
            print(result.stdout, end="", flush=True)
            if result.returncode:
                print(result.stderr, end="", file=sys.stderr, flush=True)
                raise RuntimeError("Staged generation failed: " + command[1])
        if before != source_fingerprint():
            raise RuntimeError("A source changed during staging; retry after its owner finishes")
        receipt["passed"] = True
        receipt["modelSha256"] = hashlib.sha256((stage / "target-schema.proposed.json").read_bytes()).hexdigest()
        (stage / "evidence/rebuild.json").write_text(json.dumps(receipt, indent=2) + "\n")
        # The embedded model and narrative are promoted together, after checks pass.
        OUT.rename(backup)
        try:
            stage.rename(OUT)
            promoted = True
        except BaseException:
            backup.rename(OUT)
            raise
        shutil.rmtree(backup)
        print("Complete coherent plan promoted; application/database unchanged.")
    except BaseException as error:
        receipt["error"] = str(error)
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        (OUT / "evidence" / ("rebuild-failure-" + stamp + ".json")).write_text(json.dumps(receipt, indent=2) + "\n")
        raise
    finally:
        if stage.exists() and not promoted:
            shutil.rmtree(stage)

if __name__ == "__main__":
    main()
