"""The worker image's identity: what it is made of (FAILURE_MODES_OPTIMISATIONS.md GH158).

    python3 infra/aws/image_identity.py [--platform linux/arm64] [--manifest <file>]

Run from the root of a clean export (deploy.sh). BuildKit exports the build context exactly as it sends it to a build
of backend/Dockerfile (`--target context`: that Dockerfile's own .dockerignore applied by Docker, no parser of ours);
the identity is the SHA-256 of a manifest: the identity's version, the platform, the SHA-256 of the Dockerfile and of
its .dockerignore, then one line per entry of the context, sorted by path: its type (f file, l link, d directory), its
mode, the SHA-256 of its contents (a link: its target) and its path. Printed: 64 hexadecimal characters, the tag of
vega-v2-worker. `--manifest` writes the manifest (paths and digests only). Modification times are not in it: two exports
of one commit give one identity.

What a build resolves by itself (pip's unpinned dependencies) is not in the context: the Dockerfile's
`ARG VEGA_DEPS_REFRESH` is how a newer one is asked for (backend/Dockerfile: apt's and pip's layers read it, GH158-g).
"""
import argparse
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

VERSION = "vega-v2-worker image identity 1"
DOCKERFILE = Path("backend/Dockerfile")
IGNORE = Path("backend/Dockerfile.dockerignore")


def digest(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def context(root, platform, dest):
    """The build context, as BuildKit sends it, exported to `dest`."""
    command = ["docker", "build", "--platform", platform, "-f", str(DOCKERFILE), "--target", "context", "--output", f"type=local,dest={dest}", "."]
    done = subprocess.run(command, cwd=root, capture_output=True, text=True, env={**os.environ, "DOCKER_BUILDKIT": "1"})
    if done.returncode:
        raise RuntimeError("the build context could not be exported (docker build --target context): " + (done.stderr or done.stdout).strip()[-800:])


def manifest(root, platform, tree):
    lines = [VERSION, f"platform {platform}", f"dockerfile {digest(root / DOCKERFILE)}",
             f"ignore {digest(root / IGNORE) if (root / IGNORE).exists() else '-'}"]
    entries = []
    for current, dirs, files in os.walk(tree, followlinks=False):
        for name in dirs + files:
            path = Path(current) / name
            rel = path.relative_to(tree).as_posix()
            info = path.lstat()
            mode = f"{info.st_mode & 0o7777:o}"
            if path.is_symlink():
                entries.append(f"l {mode} {os.readlink(path)} {rel}")
            elif path.is_dir():
                entries.append(f"d {mode} - {rel}")
            else:
                entries.append(f"f {mode} {digest(path)} {rel}")
    entries.sort(key=lambda line: line.split(" ", 3)[3])
    return lines + entries


def main(argv):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--platform", default="linux/arm64")
    parser.add_argument("--manifest")
    args = parser.parse_args(argv)
    root = Path.cwd()
    if not (root / DOCKERFILE).is_file():
        print(f"image_identity: no {DOCKERFILE} here (run from the root of the export)", file=sys.stderr)
        return 2
    work = Path(tempfile.mkdtemp(prefix="vega-image-context-"))
    try:
        context(root, args.platform, work / "context")
        lines = manifest(root, args.platform, work / "context")
    except RuntimeError as error:
        print(f"image_identity: {error}", file=sys.stderr)
        return 1
    finally:
        shutil.rmtree(work, ignore_errors=True)
    text = "\n".join(lines) + "\n"
    if args.manifest:
        Path(args.manifest).write_text(text)
    print(hashlib.sha256(text.encode()).hexdigest())
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
