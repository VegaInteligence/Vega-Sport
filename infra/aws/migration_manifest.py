"""The migration files of the worker's images (VI-135): what a worker-only Deploy compares before it gives the worker and
the backfill the candidate's image (deploy.sh, DEPLOY_COMPONENTS=worker; infra/aws/README.md, Worker only).

    python3 infra/aws/migration_manifest.py --registry <registry> [--platform linux/arm64] --candidate <tag> \
        ImageTag=<tag> TaskImageTag=<tag>

Each tag names an image of vega-v2-worker in the registry (immutable: a tag is one image). Each distinct image is read
once, without running anything of it: pulled (docker pull), created as a container that never starts (docker create),
its /app copied out as a tar stream (docker cp), the container removed. Its manifest: every *.sql entry of the three
directories the migrate task reads (sql, account/sql, panna/sql) and the vega/migrate.py entry point.
The candidate's manifest is compared with each deployed image's (a tag given under two names is read once, and the
candidate's own tag is the candidate): the same files, else each file the candidate adds, removes or changes. Equal
manifests say that the images hold the same migration files; nothing is read of the base, its journal included.

Exit 0: the same files; 3: they differ; 1: an image could not be read (an image without any core migration included:
never taken for an empty one); 2: the arguments.
"""
import argparse
import hashlib
import io
import re
import subprocess
import sys
import tarfile

DIRECTORIES = (("core", "sql"), ("account", "account/sql"), ("panna", "panna/sql"))
MIGRATOR = "vega/migrate.py"
TAG = re.compile(r"[a-f0-9]{12,64}")


class Unreadable(Exception):
    pass


def docker(*args):
    """One docker command: its output (bytes), or Unreadable with the last line of its error."""
    done = subprocess.run(["docker", *args], capture_output=True)
    if done.returncode:
        lines = [line for line in done.stderr.decode(errors="replace").splitlines() if line.strip()]
        raise Unreadable(f"docker {args[0]}: {(lines[-1] if lines else f'exit {done.returncode}')[:400]}")
    return done.stdout


def manifest(archive):
    """{(component, file name): sha256} of the *.sql entries of /app's three migration directories in a `docker cp`
    tar (its entries under app/, or without that prefix)."""
    found = {}
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:*") as tar:
        for member in tar:
            path = member.name.removeprefix("./").rstrip("/")
            path = path.removeprefix("app/")
            folder, _, name = path.rpartition("/")
            component = next((c for c, d in DIRECTORIES if d == folder), None)
            if member.issym() or member.islnk():
                if MIGRATOR.startswith(path + "/") or any(d == path or d.startswith(path + "/") for _, d in DIRECTORIES):
                    raise Unreadable(f"migration directory {path} is a link")
            if path == MIGRATOR:
                component, name = "runtime", path
            elif component is None or not name.endswith(".sql") or member.isdir():
                continue
            if not member.isfile():
                raise Unreadable(f"migration {path} is not an ordinary file")
            found[(component, name)] = hashlib.sha256(tar.extractfile(member).read()).hexdigest()
    return found


def read(registry, platform, tag):
    ref = f"{registry}/vega-v2-worker:{tag}"
    docker("pull", "--quiet", "--platform", platform, ref)
    container = docker("create", "--platform", platform, ref).decode().strip().splitlines()[-1]
    try:
        files = manifest(docker("cp", f"{container}:/app", "-"))
    finally:
        subprocess.run(["docker", "rm", "--force", container], capture_output=True)
    if not any(component == "core" for component, _ in files):
        raise Unreadable("no core migration under /app/sql: not an image of vega-v2-worker as backend/Dockerfile builds it")
    if ("runtime", MIGRATOR) not in files:
        raise Unreadable(f"migration entry point /app/{MIGRATOR} is missing")
    return files


def counts(files):
    return ", ".join(f"{c} {sum(1 for k in files if k[0] == c)}" for c, _ in DIRECTORIES)


def differences(candidate, deployed):
    """What the candidate adds, removes and changes, compared with a deployed image's files."""
    def named(keys):
        keys = sorted(keys)
        shown = [f"{c}/{n}" for c, n in keys[:20]]
        return ", ".join(shown) + (f" and {len(keys) - 20} more" if len(keys) > 20 else "")
    out = []
    for verb, keys in (("adds", set(candidate) - set(deployed)), ("removes", set(deployed) - set(candidate)),
                       ("changes", {k for k in set(candidate) & set(deployed) if candidate[k] != deployed[k]})):
        if keys:
            out.append(f"{verb} {named(keys)}")
    return out


def main(argv):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--registry", required=True)
    parser.add_argument("--platform", default="linux/arm64")
    parser.add_argument("--candidate", required=True)
    parser.add_argument("deployed", nargs="+", help="NAME=TAG: the stack parameter naming a deployed image, and its tag")
    try:
        args = parser.parse_args(argv)
    except SystemExit:
        return 2
    groups = {}
    for item in args.deployed:
        name, _, tag = item.partition("=")
        if not re.fullmatch(r"[A-Za-z]+", name) or not TAG.fullmatch(tag):
            print(f"migration_manifest: {item!r} is not NAME=<an image identity>", file=sys.stderr)
            return 2
        groups.setdefault(tag, []).append(name)
    if not TAG.fullmatch(args.candidate):
        print(f"migration_manifest: the candidate {args.candidate!r} is not an image identity", file=sys.stderr)
        return 2
    short = args.candidate[:12]
    compared = {tag: names for tag, names in groups.items() if tag != args.candidate}
    for tag, names in groups.items():
        if tag == args.candidate:
            print(f"migrations: {' and '.join(names)} {tag[:12]}: the candidate itself")
    if not compared:
        return 0
    try:
        candidate = read(args.registry, args.platform, args.candidate)
    except Unreadable as error:
        print(f"migrations: the candidate {short} could not be read: {error}")
        return 1
    code = 0
    for tag, names in compared.items():
        label = f"{' and '.join(names)} {tag[:12]}"
        try:
            deployed = read(args.registry, args.platform, tag)
        except Unreadable as error:
            print(f"migrations: {label} could not be read: {error}")
            code = 1
            continue
        found = differences(candidate, deployed)
        if found:
            print(f"migrations: {label}: not the candidate's {short}: the candidate {'; '.join(found)}")
            code = code or 3
        else:
            print(f"migrations: {label}: the same files as the candidate {short} ({counts(candidate)})")
    return code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
