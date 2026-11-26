"""Refreshing the worker image's dependencies (FAILURE_MODES_OPTIMISATIONS.md GH158-g, written before this test).

The review of 26 Nov 2026 found that the Dockerfile's « Refresh: » comment changed the image's identity but not what a
warm BuildKit builder runs: a comment is not in any step's cache key, so apt's and pip's layers came from the cache.
The rule: the layers that install what the build resolves by itself (Debian's nodejs, pip's unpinned dependencies)
read a build argument, VEGA_DEPS_REFRESH, whose default is in the Dockerfile: changing it is a new identity and runs
those layers again; a Deploy that changes nothing of it reuses them.

The static test always runs. The BuildKit test runs the real Docker (DOCKER_HOST or DOCKER_CONTEXT as the shell has
them) when VEGA_IMAGE_REFRESH_BUILDKIT=1: it builds the real backend/Dockerfile from the repository root (network for
apt and pip the first time), then the same three ways, each against the warm builder: unchanged, a comment changed,
VEGA_DEPS_REFRESH changed, and reads BuildKit's plain progress for the steps it took from the cache.
Rerun: PYTHONPATH=backend:backend/tests VEGA_IMAGE_REFRESH_BUILDKIT=1 python3 -m unittest -v test_image_refresh
"""
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
DOCKERFILE = ROOT / "backend/Dockerfile"
DOCKER = shutil.which("docker")


def final_stage(text):
    """The instructions of the Dockerfile's last stage (the image), one per logical line, comments left out."""
    lines, current = [], ""
    for raw in text.split("\n"):
        if raw.lstrip().startswith("#") and not current:
            continue
        current += raw.rstrip("\\").rstrip() + " " if raw.rstrip().endswith("\\") else raw
        if not raw.rstrip().endswith("\\"):
            if current.strip():
                lines.append(current.strip())
            current = ""
    last = max(i for i, line in enumerate(lines) if line.upper().startswith("FROM "))
    return lines[last:]


class RefreshRuleTest(unittest.TestCase):
    def test_GH158_g_the_resolving_layers_read_the_refresh_argument(self):
        text = DOCKERFILE.read_text()
        stage = final_stage(text)
        arg = [i for i, line in enumerate(stage) if re.fullmatch(r"ARG VEGA_DEPS_REFRESH=\d{4}-\d{2}-\d{2}", line)]
        self.assertEqual(len(arg), 1, "one ARG VEGA_DEPS_REFRESH=<date> in the image's stage")
        resolving = [i for i, line in enumerate(stage) if line.startswith("RUN ") and re.search(r"apt-get|pip install", line)]
        self.assertGreaterEqual(len(resolving), 2, "apt's and pip's layers")
        for i in resolving:
            self.assertGreater(i, arg[0], f"declared before: {stage[i][:60]}")
            self.assertIn("VEGA_DEPS_REFRESH", stage[i], f"read by: {stage[i][:60]}")
        self.assertNotRegex(text, r"(?m)^# Refresh:", "no comment that only seems to refresh")


def buildkit(dockerfile, context):
    """One build against the warm builder; its plain progress: {step instruction: cached?}."""
    done = subprocess.run([DOCKER, "build", "--progress=plain", "--platform", "linux/arm64", "-f", str(dockerfile), "--output",
                           "type=cacheonly", str(context)], capture_output=True, text=True, timeout=1800,
                          env={**os.environ, "DOCKER_BUILDKIT": "1"})
    assert done.returncode == 0, done.stderr[-3000:]
    steps, names = {}, {}
    for line in done.stderr.splitlines():
        head = re.match(r"#(\d+) \[(?:stage-\d+|\S+) +\d+/\d+\] (.*)$", line)
        # FROM resolves the pinned base (« resolve … done »): not a step a cache holds or a build runs.
        if head and not head[2].startswith("FROM "):
            names[head[1]] = head[2]
            steps.setdefault(head[2], False)
        cached = re.match(r"#(\d+) CACHED$", line)
        if cached and cached[1] in names:
            steps[names[cached[1]]] = True
    return steps, done.stderr


@unittest.skipUnless(os.environ.get("VEGA_IMAGE_REFRESH_BUILDKIT") == "1" and DOCKER, "VEGA_IMAGE_REFRESH_BUILDKIT=1 and docker")
class WarmBuilderTest(unittest.TestCase):
    def test_GH158_g_a_warm_builder_reruns_apt_and_pip_only_when_the_argument_changes(self):
        text = DOCKERFILE.read_text()
        ignore = DOCKERFILE.with_name("Dockerfile.dockerignore")
        work = Path(tempfile.mkdtemp(prefix="vega-refresh-"))
        evidence = Path(os.environ.get("VEGA_IMAGE_REFRESH_EVIDENCE") or work)
        evidence.mkdir(parents=True, exist_ok=True)

        def variant(name, body):
            path = work / f"{name}.Dockerfile"
            path.write_text(body)
            if ignore.exists():
                shutil.copy(ignore, work / f"{name}.Dockerfile.dockerignore")
            steps, log = buildkit(path, ROOT)
            (evidence / f"{name}.log").write_text(log)
            return steps

        resolving = lambda steps: {k: v for k, v in steps.items() if re.search(r"apt-get|pip install", k)}  # noqa: E731
        variant("warm-up", text)
        same = variant("unchanged", text)
        self.assertTrue(same and all(same.values()), f"unchanged: every step cached {same}")
        comment = variant("comment", text.replace("# Vega worker image.", "# Vega worker image (a comment changed).", 1))
        self.assertTrue(all(resolving(comment).values()), f"a comment: apt and pip still cached (the review's finding) {comment}")
        current = re.search(r"ARG VEGA_DEPS_REFRESH=(\S+)", text)[1]
        # A value this builder has never seen, one per run: a fixed one is in its cache once this test has run there.
        fresh = f"2099-01-01-{secrets.token_hex(4)}"
        refreshed = variant("refreshed", text.replace(f"ARG VEGA_DEPS_REFRESH={current}", f"ARG VEGA_DEPS_REFRESH={fresh}", 1))
        self.assertTrue(resolving(refreshed) and not any(resolving(refreshed).values()), f"refreshed: apt and pip ran again {refreshed}")
        before = [k for k in refreshed if k.startswith("WORKDIR")]
        self.assertTrue(before and all(refreshed[k] for k in before), "the steps before them still cached")


if __name__ == "__main__":
    unittest.main()
