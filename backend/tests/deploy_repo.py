"""This tree as a Deploy reads it, for the deploy tests (test_deploy_flow.py, test_image_identity.py; GH157/GH158).

`copy_tree` copies the files git would export from this checkout (tracked and untracked-not-ignored, under backend,
infra and dashboard: the uncommitted change under test included, node_modules and caches left out); `Repo` makes a
temporary git repository of them, so that the real deploy.sh exports a real commit with `git archive`.
VEGA_DEPLOY_TREE names another git tree to deploy instead (its files as git would export them; the tests and their
stand-ins stay this checkout's): the product files before a change, to show the tests red against them.
"""
import os
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[2]
SOURCE = Path(os.environ.get("VEGA_DEPLOY_TREE") or ROOT)
PARTS = ("backend", "infra", "dashboard")


def tracked(root=ROOT):
    out = subprocess.run(["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", *PARTS], cwd=root,
                         capture_output=True, check=True).stdout.decode()
    return sorted({p for p in out.split("\0") if p and (root / p).is_file() and "__pycache__" not in p})


def copy_tree(dest, root=ROOT):
    dest = Path(dest)
    for rel in tracked(root):
        target = dest / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(root / rel, target)
    return dest


def git(cwd, *args, env=None):
    base = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "HOME": str(cwd), "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_AUTHOR_NAME": "deploy test", "GIT_AUTHOR_EMAIL": "deploy-test@example.invalid",
            "GIT_COMMITTER_NAME": "deploy test", "GIT_COMMITTER_EMAIL": "deploy-test@example.invalid"}
    done = subprocess.run(["git", *args], cwd=cwd, env={**base, **(env or {})}, capture_output=True, text=True)
    assert done.returncode == 0, done.stderr
    return done.stdout.strip()


class Repo:
    """A temporary repository holding this tree; `commit` records the files as they are and gives the commit."""

    def __init__(self, path):
        self.path = Path(path)
        self.path.mkdir(parents=True, exist_ok=True)
        copy_tree(self.path, SOURCE)
        git(self.path, "init", "-q", "-b", "main")
        self.head = self.commit("this tree")

    def write(self, rel, text, mode=None):
        target = self.path / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text)
        if mode is not None:
            target.chmod(mode)

    def remove(self, rel):
        (self.path / rel).unlink()

    def commit(self, message):
        git(self.path, "add", "-A")
        git(self.path, "commit", "-q", "--allow-empty", "-m", message)
        self.head = git(self.path, "rev-parse", "HEAD")
        return self.head

    def checkout(self, commit):
        git(self.path, "checkout", "-q", commit)
        self.head = commit
