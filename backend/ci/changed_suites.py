"""Which CI jobs a change needs: the zones its files touch (ci.yml, job « Changed zones »).

Reads the changed paths (one per line) on stdin and prints GitHub outputs (KEY=value lines) for $GITHUB_OUTPUT:

  suites=["python","api"]   the matrix of the « Suites » job (python, deploy, api), [] when none
  site=true|false           the site's tests and build
  image=true|false          the worker image
  package=true|false        the read API package

  git diff --name-only origin/main... | python backend/ci/changed_suites.py
  python backend/ci/changed_suites.py --full     # everything (push to main, manual run, unknown change)

A pull request or a branch push runs only what its files can break; main and a manual run run everything, so a
zone a rule misses is still caught on main before a Deploy. A change to the CI itself (ci.yml, backend/ci/) runs
everything. Documentation (*.md) runs nothing.
"""

import json
import re
import sys

# The Deploy's end-to-end and template suites (test_deploy_flow.py plays the real deploy.sh with BuildKit and the
# real migrations: about ten minutes on its own). They run in their own matrix entry, beside the other suites.
DEPLOY_MODULES = ("test_deploy_flow", "test_account_deploy", "test_deploy_grants")

EVERYTHING = (r"\.github/workflows/ci\.yml", r"backend/ci/")

# Zone -> paths (regular expressions anchored at the start of the path) whose change needs it.
ZONES = {
    "site": (r"dashboard/", r"tests/"),
    # The Python suites read through the real read API (read_http.mjs) and apply the SQL: any backend file but the
    # Node suites' own tests.
    "python": (r"backend/(?!api/test/|account/test/)",),
    # What deploy.sh runs or ships (infra/aws/*.py, the migrations, the API bundles, the image) and its tests.
    "deploy": (
        r"infra/aws/", r"backend/sql/", r"backend/api/", r"backend/account/", r"backend/Dockerfile$",
        r"backend/requirements\.txt$", r"backend/vega/migrate\.py$", r"\.github/workflows/deploy\.yml$",
        r"backend/tests/(" + "|".join(DEPLOY_MODULES) + r"|deploy_fakes|deploy_repo|prerequisites)\.py$",
    ),
    # The read API's and the account API's Node suites, and the SQL they read.
    "api": (r"backend/api/", r"backend/account/", r"backend/sql/"),
    "image": (r"backend/", r"dashboard/"),
    "package": (r"backend/api/", r"backend/account/", r"infra/aws/package_api\.py$"),
}
SUITES = ("python", "deploy", "api")


def zones(paths, full=False):
    """The set of zones the changed paths need."""
    paths = [p.strip() for p in paths if p.strip()]
    if full or any(re.match(rule, p) for p in paths for rule in EVERYTHING):
        return set(ZONES)
    needed = set()
    for path in paths:
        if path.endswith(".md"):
            continue
        needed.update(zone for zone, rules in ZONES.items() if any(re.match(rule, path) for rule in rules))
    return needed


def outputs(needed):
    lines = ["suites=" + json.dumps([s for s in SUITES if s in needed], separators=(",", ":"))]
    lines += [f"{zone}={'true' if zone in needed else 'false'}" for zone in ("site", "image", "package")]
    return "\n".join(lines)


if __name__ == "__main__":
    full = "--full" in sys.argv[1:]
    print(outputs(zones([] if full else sys.stdin.read().splitlines(), full)))
