"""The worker image named by what it is made of (FAILURE_MODES_OPTIMISATIONS.md GH158-b, GH158-c, written before
these tests): infra/aws/image_identity.py run on clean exports of this tree, with the real Docker (BuildKit's context,
the Dockerfile's own .dockerignore). Rerun: PYTHONPATH=backend:backend/tests python3 -m unittest -v test_image_identity
(DOCKER_CONTEXT=colima on the owner's Mac).
"""
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
import unittest

from deploy_repo import ROOT, copy_tree
from prerequisites import required

DOCKER = shutil.which("docker")


def docker_ready():
    if not DOCKER:
        return False
    return subprocess.run([DOCKER, "info"], capture_output=True, timeout=60).returncode == 0


READY = docker_ready()


@required(READY, "docker with a running daemon (BuildKit), for the build context")
class ImageIdentityTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp(prefix="vega-identity-"))
        cls.base = copy_tree(cls.tmp / "base")
        cls.reference = cls.identity(cls.base)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    @staticmethod
    def identity(tree, *extra):
        done = subprocess.run([sys.executable, str(ROOT / "infra/aws/image_identity.py"), *extra], cwd=tree, capture_output=True,
                              text=True, timeout=300, env={**os.environ, "DOCKER_BUILDKIT": "1"})
        assert done.returncode == 0, done.stderr
        return done.stdout.strip()

    def variant(self, name, change):
        tree = self.tmp / name
        shutil.copytree(self.base, tree, symlinks=True)
        change(tree)
        return self.identity(tree)

    def test_GH158_c_one_tree_one_identity(self):
        self.assertRegex(self.reference, r"^[a-f0-9]{64}$")
        # Another export of the same files: other paths, other modification times.
        time.sleep(1.1)
        again = copy_tree(self.tmp / "again")
        for path in again.rglob("*"):
            if path.is_file():
                os.utime(path, (1_000_000_000, 1_000_000_000))
        self.assertEqual(self.identity(again), self.reference)
        manifest = self.tmp / "manifest.txt"
        self.assertEqual(self.identity(self.base, "--manifest", str(manifest)), self.reference)
        lines = manifest.read_text().splitlines()
        self.assertEqual(lines[:2], ["vega-v2-worker image identity 1", "platform linux/arm64"])
        paths = [line.split(" ", 3)[3] for line in lines if re.match(r"^[fld] ", line)]
        self.assertIn("backend/vega/migrate.py", paths)
        self.assertIn("dashboard/frontend/src/services/format.js", paths)
        self.assertIn("backend/account/sql/001_accounts.sql", paths)
        self.assertNotIn("dashboard/frontend/src/components/MatchNav.jsx", paths)
        self.assertFalse([p for p in paths if p.startswith(("backend/api/", "backend/tests/", "infra/"))], "only what the image copies")

    def test_GH158_a_a_file_the_image_does_not_copy_changes_nothing(self):
        for rel in ("dashboard/frontend/src/components/MatchNav.jsx", "backend/api/src/handler.mjs", "infra/aws/api.yaml",
                    "backend/tests/test_roles.py"):
            with self.subTest(rel=rel):
                self.assertEqual(self.variant("unchanged-" + rel.replace("/", "-"), lambda t, r=rel: (t / r).write_text((t / r).read_text() + "\n// edit\n")),
                                 self.reference)

    def test_GH158_b_each_input_of_the_image_changes_it(self):
        def append(rel, text="\n// edit\n"):
            return lambda t: (t / rel).write_text((t / rel).read_text() + text)
        cases = {
            "a site file the image copies": append("dashboard/frontend/src/services/format.js"),
            "a shared file": append("dashboard/shared/archive.js"),
            "an account SQL file": append("backend/account/sql/001_accounts.sql", "\n-- edit\n"),
            "the requirements": append("backend/requirements.txt", "\n"),
            "the Dockerfile's refresh argument": lambda t: (t / "backend/Dockerfile").write_text(
                re.sub(r"(?m)^ARG VEGA_DEPS_REFRESH=.*$", "ARG VEGA_DEPS_REFRESH=2099-01-01", (t / "backend/Dockerfile").read_text())),
            "a file's mode": lambda t: (t / "backend/vega/store.py").chmod(0o755),
            "a copied file deleted": lambda t: (t / "backend/vega/media.py").unlink(),
            "a file added": lambda t: (t / "backend/vega/added_by_test.py").write_text("X = 1\n"),
            "the ignore file": append("backend/Dockerfile.dockerignore", "\n# edit\n"),
        }
        seen = {self.reference}
        for name, change in cases.items():
            with self.subTest(name):
                found = self.variant("changed-" + re.sub(r"\W+", "-", name), change)
                self.assertRegex(found, r"^[a-f0-9]{64}$")
                self.assertNotIn(found, seen, f"{name}: the identity did not change (or matched another case)")
                seen.add(found)
        self.assertRegex((ROOT / "backend/Dockerfile").read_text(), r"(?m)^ARG VEGA_DEPS_REFRESH=\d{4}-\d{2}-\d{2}$")
        self.assertRegex((ROOT / "backend/Dockerfile").read_text(), r"(?m)^FROM python:3\.14-slim@sha256:[a-f0-9]{64}$")

    def test_GH158_c_docker_failing_stops_it(self):
        tree = self.tmp / "no-docker"
        shutil.copytree(self.base, tree)
        bin_dir = self.tmp / "bin-failing"
        bin_dir.mkdir(exist_ok=True)
        (bin_dir / "docker").write_text("#!/bin/sh\necho 'Cannot connect to the Docker daemon' >&2\nexit 1\n")
        (bin_dir / "docker").chmod(0o755)
        done = subprocess.run([sys.executable, str(ROOT / "infra/aws/image_identity.py")], cwd=tree, capture_output=True, text=True,
                              env={**os.environ, "PATH": f"{bin_dir}:/usr/bin:/bin"})
        self.assertNotEqual(done.returncode, 0)
        self.assertEqual(done.stdout, "")
        self.assertIn("build context", done.stderr)


if __name__ == "__main__":
    unittest.main()
