"""The Deploy state's maintenance entries (FAILURE_MODES_OPTIMISATIONS.md GH157-ac, written before this test).

infra/aws/deploy_state.py run for real against the stand-in `aws` (deploy_fakes.py, S3 with conditional requests) on
the roles stack's bucket: `abandon` lets the owner attest dead a run nothing here can check (a workstation of another
host), never a GitHub run (the Deploy asks GitHub) nor a run of this host (the Deploy checks its run lock); `acquire`
says when the holder is the one attested; `resolve-migrate` settles a migrate intent the Deploy suspended, for its own
token only.
Rerun: PYTHONPATH=backend:backend/tests python3 -m unittest -v test_deploy_state
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest

import deploy_fakes

ROOT = Path(__file__).resolve().parents[2]
ACCOUNT = "361769570630"
BUCKET = f"vega-v2-deploy-state-{ACCOUNT}-us-east-2"
HOST = subprocess.run(["hostname", "-s"], capture_output=True, text=True).stdout.strip() or "unknown"


class MaintenanceEntriesTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="vega-deploy-state-"))
        self.bin = deploy_fakes.install(self.tmp / "bin")
        self.world = self.tmp / "state.json"

    def held(self, owner, **fields):
        doc = {"version": 1, "owner": owner, "beat": int(time.time()) - 7200, "phase": "running", "before": None, "changed": False,
               "unsafe": False, "migrate": None, **fields}
        self.world.write_text(json.dumps({"account": ACCOUNT, "region": "us-east-2", "params": {}, "stacks": {}, "faults": {},
                                          "s3": {"buckets": {BUCKET: {"state.json": {"body": json.dumps(doc), "etag": '"held"'}}}}}))

    def doc(self):
        return json.loads(json.loads(self.world.read_text())["s3"]["buckets"][BUCKET]["state.json"]["body"])

    def run_state(self, *args):
        env = {"PATH": f"{self.bin}:/usr/bin:/bin", "FAKE_STATE": str(self.world), "FAKE_LOG": str(self.tmp / "calls.log"),
               "FAKE_PYTHON_REAL": sys.executable, "HOME": str(self.tmp)}
        return subprocess.run([sys.executable, str(ROOT / "infra/aws/deploy_state.py"), *args, "--bucket", BUCKET], capture_output=True,
                              text=True, env=env, timeout=60)

    def test_GH157_ac_abandon_refuses_what_the_deploy_can_check(self):
        self.held("gh-5551-1")
        done = self.run_state("abandon", "--holder", "gh-5551-1", "--reason", "test")
        self.assertNotEqual(done.returncode, 0)
        self.assertIn("a GitHub run", done.stderr)
        self.assertNotIn("abandoned", self.doc())
        # A run of this host, alive (a process holds its lock, as deploy.sh and its commands do), then gone: refused both.
        live = subprocess.Popen([sys.executable, "-c", "import fcntl, os, time\n"
                                 "f = open(f'/tmp/vega-deploy-{os.getpid()}-1764100000.lock', 'a')\n"
                                 "fcntl.flock(f, fcntl.LOCK_EX)\nprint('held', flush=True)\ntime.sleep(60)\n"], stdout=subprocess.PIPE, text=True)
        try:
            self.assertEqual(live.stdout.readline().strip(), "held")
            here = f"host:{HOST}:{live.pid}:1764100000"
            self.held(here)
            done = self.run_state("abandon", "--holder", here, "--reason", "test")
            self.assertNotEqual(done.returncode, 0)
            self.assertIn("this host", done.stderr)
            self.assertIn("is held: a process of that run lives", done.stderr)
            self.assertNotIn("abandoned", self.doc())
        finally:
            live.kill()
            live.wait()
            live.stdout.close()
        done = self.run_state("abandon", "--holder", here, "--reason", "test")
        self.assertNotEqual(done.returncode, 0)
        self.assertIn("is free: no process of that run lives", done.stderr, "the Deploy takes it over itself")
        self.assertNotIn("abandoned", self.doc())
        self.held("host:elsewhere:4242:1764100000")
        done = self.run_state("abandon", "--holder", "gh-5551-1", "--reason", "test")
        self.assertNotEqual(done.returncode, 0, "the holder named is not the state's")
        self.assertIn("does not hold", done.stderr)

    def test_GH157_ac_abandon_attests_another_host_s_run_then_acquire_says_so(self):
        holder = "host:elsewhere:4242:1764100000"
        self.held(holder)
        done = self.run_state("abandon", "--holder", holder, "--reason", "its laptop was reinstalled")
        self.assertEqual(done.returncode, 0, done.stderr)
        doc = self.doc()
        self.assertEqual(doc["owner"], holder, "still the holder until a Deploy takes it over")
        self.assertEqual((doc["abandoned"]["holder"], doc["abandoned"]["reason"]), (holder, "its laptop was reinstalled"))
        self.assertIsInstance(doc["abandoned"]["at"], int)
        refused = self.run_state("acquire", "--owner", "gh-6000-1")
        self.assertEqual(refused.returncode, 4)
        self.assertIn(f"STATE_HOLDER={holder}", refused.stdout.replace("'", ""))
        self.assertIn(f"STATE_ABANDONED={holder}", refused.stdout.replace("'", ""))
        taken = self.run_state("acquire", "--owner", "gh-6000-1", "--takeover", holder)
        self.assertEqual(taken.returncode, 0, taken.stderr)
        doc = self.doc()
        self.assertEqual(doc["owner"], "gh-6000-1")
        self.assertNotIn("abandoned", doc, "the attestation spent with the takeover")

    def test_GH157_ac_resolve_migrate_for_its_own_token_only(self):
        intent = {"token": "vm-1764000000-2", "phase": "asked", "taskdef": "arn:aws:ecs:us-east-2:1:task-definition/vega-v2-migrate:3",
                  "command": "--online", "asked": int(time.time()) - 7200}
        self.held(None, migrate=intent)
        done = self.run_state("resolve-migrate", "--token", "vm-other", "--none", "--reason", "test")
        self.assertNotEqual(done.returncode, 0)
        self.assertIn("vm-1764000000-2", done.stderr)
        self.assertEqual(self.doc()["migrate"], intent)
        done = self.run_state("resolve-migrate", "--token", "vm-1764000000-2", "--arn", f"arn:aws:ecs:us-east-2:{ACCOUNT}:task/vega-v2/0042",
                              "--reason", "found under its token")
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual((self.doc()["migrate"]["arn"], self.doc()["migrate"]["phase"]), (f"arn:aws:ecs:us-east-2:{ACCOUNT}:task/vega-v2/0042", "running"))
        done = self.run_state("resolve-migrate", "--token", "vm-1764000000-2", "--none", "--reason", "none ran under it")
        self.assertEqual(done.returncode, 0, done.stderr)
        doc = self.doc()
        self.assertIsNone(doc["migrate"])
        self.assertEqual((doc["resolved"]["token"], doc["resolved"]["reason"]), ("vm-1764000000-2", "none ran under it"))
        self.held("gh-7000-1", migrate=intent)
        done = self.run_state("resolve-migrate", "--token", "vm-1764000000-2", "--none", "--reason", "test")
        self.assertNotEqual(done.returncode, 0, "not while a run holds the state")
        self.assertIn("gh-7000-1", done.stderr)


if __name__ == "__main__":
    unittest.main()
