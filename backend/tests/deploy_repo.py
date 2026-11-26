"""This tree as a Deploy reads it, for the deploy tests (test_deploy_flow.py, test_image_identity.py; GH157/GH158).

`copy_tree` copies the files git would export from this checkout (tracked and untracked-not-ignored, under backend,
infra and dashboard: the uncommitted change under test included, node_modules and caches left out); `Repo` makes a
temporary git repository of them, so that the real deploy.sh exports a real commit with `git archive`.
VEGA_DEPLOY_TREE names another git tree to deploy instead (its files as git would export them; the tests and their
stand-ins stay this checkout's): the product files before a change, to show the tests red against them.
"""
import hashlib
import os
from pathlib import Path
import re
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[2]
SOURCE = Path(os.environ.get("VEGA_DEPLOY_TREE") or ROOT)
PARTS = ("backend", "infra", "dashboard")


def machine_host():
    """This machine as a workstation's Deploy names it (FAILURE_MODES_OPTIMISATIONS.md GH157-u, GH157-af): (its short
    host name, that name and the first 10 hex digits of the SHA-256 of its machine identity — Linux's /etc/machine-id,
    32 hex digits not all zero; macOS's IOPlatformUUID, a UUID not null — when it has one, else the short name)."""
    short = subprocess.run(["hostname", "-s"], capture_output=True, text=True).stdout.strip() or "unknown"
    ident = ""
    if Path("/etc/machine-id").is_file():
        value = Path("/etc/machine-id").read_text().strip().lower()
        ident = value if re.fullmatch(r"[0-9a-f]{32}", value) and value.strip("0") else ""
    elif Path("/usr/sbin/ioreg").exists():
        out = subprocess.run(["/usr/sbin/ioreg", "-rd1", "-c", "IOPlatformExpertDevice"], capture_output=True, text=True).stdout
        found = re.search(r'"IOPlatformUUID" = "([^"]*)"', out)
        value = (found.group(1) if found else "").upper()
        ident = value if re.fullmatch(r"[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}", value) and value.replace("-", "").strip("0") else ""
    return short, f"{short}-{hashlib.sha256(ident.encode()).hexdigest()[:10]}" if ident else short


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
