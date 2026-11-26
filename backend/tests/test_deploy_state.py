"""The Deploy state's maintenance entries (FAILURE_MODES_OPTIMISATIONS.md GH157-ac, written before this test).

infra/aws/deploy_state.py run for real against the stand-in `aws` (deploy_fakes.py, S3 with conditional requests) on
the roles stack's bucket: `abandon` lets the owner attest dead a run nothing here can check (a workstation of another
host, a run whose lock is not in this machine's lock directory: a restart, a cleaned /tmp, an earlier Deploy's
name), never a GitHub run (the Deploy asks GitHub) nor a run whose lock is here (held: it lives; free: the Deploy takes
it over itself); `acquire`
says when the holder is the one attested; `resolve-migrate` settles a migrate intent the Deploy suspended, for its own
token only.
Rerun: PYTHONPATH=backend:backend/tests python3 -m unittest -v test_deploy_state
"""
import hashlib
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import tempfile
import time
import unittest

import deploy_fakes
from deploy_repo import machine_host

ROOT = Path(__file__).resolve().parents[2]
ACCOUNT = "361769570630"
BUCKET = f"vega-v2-deploy-state-{ACCOUNT}-us-east-2"
SHORT, HOST = machine_host()


class MaintenanceEntriesTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="vega-deploy-state-"))
        self.bin = deploy_fakes.install(self.tmp / "bin")
        self.world = self.tmp / "state.json"
        self.locks = self.tmp / "locks"  # this machine's lock directory (deploy.sh's DEPLOY_LOCK_DIR)
        self.locks.mkdir()

    def held(self, owner, **fields):
        doc = {"version": 1, "owner": owner, "beat": int(time.time()) - 7200, "phase": "running", "before": None, "changed": False,
               "unsafe": False, "migrate": None, **fields}
        self.world.write_text(json.dumps({"account": ACCOUNT, "region": "us-east-2", "params": {}, "stacks": {}, "faults": {},
                                          "s3": {"buckets": {BUCKET: {"state.json": {"body": json.dumps(doc), "etag": '"held"'}}}}}))

    def doc(self):
        return json.loads(json.loads(self.world.read_text())["s3"]["buckets"][BUCKET]["state.json"]["body"])

    def run_state(self, command, *args):
        env = {"PATH": f"{self.bin}:/usr/bin:/bin", "FAKE_STATE": str(self.world), "FAKE_LOG": str(self.tmp / "calls.log"),
               "FAKE_PYTHON_REAL": sys.executable, "HOME": str(self.tmp), "DEPLOY_LOCK_DIR": str(self.locks)}
        return subprocess.run([sys.executable, str(ROOT / "infra/aws/deploy_state.py"), command, "--bucket", BUCKET, *args], capture_output=True,
                              text=True, env=env, timeout=60)

    def test_set_persists_the_pre_stop_snapshot_with_trailing_changes(self):
        owner = "gh-5551-1"
        self.held(owner)
        args = ("set", "--owner", owner, "--etag", '"held"', "phase=stopped", "before.worker=1", "before.backfill=1",
                "before.image=previous", "before.digest=", "changed=false", "unsafe=false")
        done = self.run_state(*args)
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertIn("STATE_PHASE=stopped", done.stdout)
        saved = self.doc()
        self.assertEqual(saved["before"], {"worker": 1, "backfill": 1, "image": "previous", "digest": ""})
        self.assertEqual((saved["phase"], saved["changed"], saved["unsafe"]), ("stopped", False, False))
        self.assertEqual(self.run_state(*args).returncode, 5, "a stale ETag must still be refused")
        self.assertEqual(self.doc(), saved)

    def test_GH157_ac_abandon_refuses_what_the_deploy_can_check(self):
        self.held("gh-5551-1")
        done = self.run_state("abandon", "--holder", "gh-5551-1", "--reason", "test")
        self.assertNotEqual(done.returncode, 0)
        self.assertIn("a GitHub run", done.stderr)
        self.assertNotIn("abandoned", self.doc())
        # A run whose lock is in this machine's lock directory: held (a process of it lives, as deploy.sh and its commands
        # hold it), then free (the Deploy takes it over itself): refused both, whatever its host's name.
        token = secrets.token_hex(16)
        lock = self.locks / f"vega-deploy-{token}.lock"
        live = subprocess.Popen([sys.executable, "-c", "import fcntl, sys, time\n"
                                 "f = open(sys.argv[1], 'a')\nfcntl.flock(f, fcntl.LOCK_EX)\nprint('held', flush=True)\ntime.sleep(60)\n", str(lock)],
                                stdout=subprocess.PIPE, text=True)
        try:
            self.assertEqual(live.stdout.readline().strip(), "held")
            for here in (f"host:{HOST}:{live.pid}:{token}", f"host:elsewhere:{live.pid}:{token}"):
                self.held(here)
                done = self.run_state("abandon", "--holder", here, "--reason", "test")
                self.assertNotEqual(done.returncode, 0)
                self.assertIn(f"its lock {lock} is held: a process of that run lives", done.stderr)
                self.assertNotIn("abandoned", self.doc())
        finally:
            live.kill()
            live.wait()
            live.stdout.close()
        done = self.run_state("abandon", "--holder", here, "--reason", "test")
        self.assertNotEqual(done.returncode, 0)
        self.assertIn(f"its lock {lock} is here and free: the Deploy takes it over itself", done.stderr)
        self.assertNotIn("abandoned", self.doc())
        self.held("host:elsewhere:4242:1764100000")
        done = self.run_state("abandon", "--holder", "gh-5551-1", "--reason", "test")
        self.assertNotEqual(done.returncode, 0, "the holder named is not the state's")
        self.assertIn("does not hold", done.stderr)

    def test_GH157_ac_a_run_whose_lock_is_not_here_is_the_owner_s_to_attest(self):
        # This machine's name, its lock absent (a restart, a cleaned /tmp, a clone's run); an earlier Deploy's name (no
        # run token): nothing here proves them dead, the owner's attestation is the way.
        for holder in (f"host:{HOST}:4242:{secrets.token_hex(16)}", f"host:{HOST}:4243:1764100000"):
            with self.subTest(holder=holder):
                self.held(holder)
                done = self.run_state("abandon", "--holder", holder, "--reason", "this machine restarted since")
                self.assertEqual(done.returncode, 0, done.stderr)
                self.assertEqual(self.doc()["abandoned"]["holder"], holder)

    def test_GH157_ac_abandon_attests_another_host_s_run_then_acquire_says_so(self):
        holder = f"host:elsewhere:4242:{secrets.token_hex(16)}"
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


class MachineIdentityTest(unittest.TestCase):
    """A host is a machine (GH157-u, GH157-af): run_lock.py names it by its short name and its machine identity, and
    names no host on a machine without one — no source, or a placeholder: Linux's `uninitialized` (a first boot) or 32
    zeros, a null or malformed IOPlatformUUID — for which a workstation's Deploy stops (deploy.sh)."""

    def run_lock(self, machine_id=None, platform_uuid=None):
        """`run_lock.py host` with its sources replaced: `machine_id`, the file's content (None: no file); `platform_uuid`,
        what ioreg says (None: no ioreg)."""
        tmp = Path(tempfile.mkdtemp(prefix="vega-machine-"))
        sources = [str(tmp / "machine-id"), str(tmp / "ioreg")]
        if machine_id is not None:
            (tmp / "machine-id").write_text(machine_id)
        if platform_uuid is not None:
            (tmp / "ioreg").write_text(f'#!/bin/sh\necho \'    | "IOPlatformUUID" = "{platform_uuid}"\'\n')
            (tmp / "ioreg").chmod(0o755)
        code = ("import sys; sys.path.insert(0, sys.argv[1]); from pathlib import Path; import run_lock\n"
                "run_lock.MACHINE_ID, run_lock.IOREG = Path(sys.argv[2]), Path(sys.argv[3])\n"
                "sys.exit(run_lock.main(['host']))")
        return subprocess.run([sys.executable, "-c", code, str(ROOT / "infra/aws"), *sources], capture_output=True, text=True, timeout=60)

    def test_GH157_af_a_machine_is_its_name_and_its_identity(self):
        done = subprocess.run([sys.executable, str(ROOT / "infra/aws/run_lock.py"), "host"], capture_output=True, text=True, timeout=60)
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(done.stdout.strip(), HOST)
        if HOST == SHORT:
            self.skipTest("this machine has no identity of its own")
        self.assertRegex(HOST, rf"^{SHORT}-[0-9a-f]{{10}}$")
        for given, ident in ((dict(machine_id="0123456789abcdef0123456789abcdef\n"), "0123456789abcdef0123456789abcdef"),
                             (dict(platform_uuid="12345678-9ABC-DEF0-1234-56789ABCDEF0"), "12345678-9ABC-DEF0-1234-56789ABCDEF0")):
            with self.subTest(**given):
                done = self.run_lock(**given)
                self.assertEqual(done.returncode, 0, done.stderr)
                self.assertEqual(done.stdout.strip(), f"{SHORT}-{hashlib.sha256(ident.encode()).hexdigest()[:10]}")

    def test_GH157_af_a_machine_without_identity_names_no_host(self):
        for given in (dict(), dict(machine_id="uninitialized\n"), dict(machine_id="0" * 32 + "\n"), dict(machine_id="not-a-machine-id\n"),
                      dict(machine_id=""), dict(platform_uuid="00000000-0000-0000-0000-000000000000"), dict(platform_uuid="not-a-uuid"),
                      dict(platform_uuid=""), dict(machine_id="uninitialized\n", platform_uuid="12345678-9ABC-DEF0-1234-56789ABCDEF0")):
            with self.subTest(**given):
                done = self.run_lock(**given)
                self.assertEqual(done.returncode, 3, (done.stdout, done.stderr))
                self.assertEqual(done.stdout, "", "no name: the short name alone would be any machine of that name")
                self.assertIn("no identity of its own", done.stderr)


if __name__ == "__main__":
    unittest.main()
