"""Which CI jobs a change needs: the zones its files touch (ci.yml, job « Changed zones »).

Reads the changed paths on stdin (one per line, or NUL-separated with -z: `git diff --name-only --no-renames -z`)
and prints GitHub outputs (KEY=value lines) for $GITHUB_OUTPUT:

  suites=["python","api"]   the suites the change needs (python, deploy, api), [] when none
  parts=["python-1",...]    the matrix of the « Suites » job: each suite's parts (PARTS), [] when none
  site=true|false           the site's tests and build
  infra=true|false          the stacks' templates and the Deploy state CLI
  image=true|false          the worker image
  package=true|false        the read API package

  git diff --name-only --no-renames -z origin/main HEAD | python backend/ci/changed_suites.py -z
  python backend/ci/changed_suites.py --full     # everything (push to main, manual run, unknown change)

A pull request or a branch push runs only what its files can break; main and a manual run run everything, so a
zone a rule misses is still caught on main. A path's zones are, together:
- the zones of its folder (ZONES), and every backend zone for a file of dashboard/ outside the site's own (SITE_ONLY);
- the zones whose tests name it (a path or a file name in a test's source: test_cost_caps.py reads infra/aws/README.md,
  ops.test.mjs reads vega/planner.py, media-initials.test.mjs reads dashboard/frontend/AGENTS.md...).
Notes (*.md, docs/) need only the zones whose tests name them. Any other path no rule knows, the CI itself (ci.yml,
backend/ci/) or an empty list runs everything (Astra's review of #247).
"""

import ast
from functools import lru_cache
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[2]

# The Deploy's end-to-end and template suites (test_deploy_flow.py plays the real deploy.sh with BuildKit and the
# real migrations: about ten minutes on its own). They run in their own matrix entry, beside the other suites.
DEPLOY_MODULES = ("test_deploy_flow", "test_account_deploy", "test_deploy_grants")

EVERYTHING = (r"\.github/workflows/ci\.yml$", r"backend/ci/")

# The site's own files: pages, components, views, texts, static files, stylesheets, its notes and the site's tests.
# Nothing under them is imported by the backend's code, copied into the worker image or packaged with the read API (a
# test that reads one by name, test_image_identity.py's MatchNav.jsx, is found through TESTS below). Every other file
# of dashboard/ (src/services/, src/hooks/, shared/, app/api/, package.json, bun.lock...) needs the backend's zones
# too: the read API imports src/services/ and shared/, its tests app/api/rapport/route.js.
SITE_ONLY = (
    r"dashboard/frontend/src/components/", r"dashboard/frontend/src/views/", r"dashboard/frontend/src/content/",
    r"dashboard/frontend/app/(?!api/)", r"dashboard/frontend/public/", r"tests/", r"dashboard/.*\.css$",
)
SHARED_WITH_BACKEND = ("python", "deploy", "api", "image", "package")

# Zone -> paths (regular expressions anchored at the start of the path) whose change needs it.
ZONES = {
    # The site's tests (tests/*.test.mjs) also import backend/sources/, backend/api/ and backend/tests/ fixtures: any
    # backend file runs them (about a minute).
    "site": (r"dashboard/", r"tests/", r"backend/"),
    # The Python suites read through the real read API (read_http.mjs), apply the SQL and read the stacks' templates
    # and scripts (test_alerts, test_edge_logs...): any backend file but the Node suites' own tests, and infra/aws/.
    "python": (r"backend/(?!api/test/|account/test/)", r"infra/aws/"),
    # What deploy.sh runs or ships (infra/aws/*.py, the migrations, the API bundles, the image) and its tests.
    "deploy": (
        r"infra/aws/", r"backend/sql/", r"backend/api/", r"backend/account/", r"backend/Dockerfile$",
        r"backend/requirements\.txt$", r"backend/vega/migrate\.py$", r"\.github/workflows/deploy\.yml$",
        r"backend/tests/(" + "|".join(DEPLOY_MODULES) + r"|deploy_fakes|deploy_repo|prerequisites)\.py$",
        r"backend/tests/fixtures/",
    ),
    # The read API's and the account API's Node suites, the SQL they read, the Lambda entry points and transport they
    # import (infra/aws/*.mjs), the templates they check and the fixtures they share with the Python suites (read by
    # built paths too: match-families.test.mjs reads match_m_08LEIz/${name}), and the modules of the Python suites their
    # seed imports (backend/api/test/seed.py: the template base every file is cloned from, the archive and cup samples).
    "api": (r"backend/api/", r"backend/account/", r"backend/sql/", r"infra/aws/[^/]+\.mjs$",
            r"infra/aws/(api|live|account|edge-logs)\.yaml$", r"backend/tests/fixtures/",
            r"backend/tests/(template_base|archive_fixtures|cup_samples)\.py$"),
    "infra": (r"infra/aws/", r"backend/tests/test_deploy_state\.py$"),
    "image": (r"backend/",),
    "package": (r"backend/api/", r"backend/account/", r"infra/aws/package_api\.py$", r"infra/aws/[^/]+\.mjs$"),
}
SUITES = ("python", "deploy", "api")
# Each suite's entries in the « Suites » matrix, side by side on their own runner and PostgreSQL: python_suites.py
# balances the Python and Deploy parts by measured time (durations.json, about 4 min 30 each on 26 Nov 2026 against
# 18 min for the Deploy's suites in one entry); the Node suites share one base (--test-concurrency=1), about 5 min.
PARTS = {"python": 2, "deploy": 4, "api": 1}
FLAGS = ("site", "infra", "image", "package")

# Zone -> the tests whose sources name the files they read (globs from the repository's root).
TESTS = {
    "site": ("tests/**/*.mjs",),
    "python": ("backend/tests/*.py",),
    "deploy": tuple(f"backend/tests/{m}.py" for m in DEPLOY_MODULES) + ("backend/tests/deploy_*.py",),
    "api": ("backend/api/test/**/*.mjs", "backend/account/test/**/*.mjs"),
    "infra": ("backend/tests/test_deploy_state.py",),
}
EXTENSIONS = r"(?:py|mjs|js|jsx|json|sql|csv|zip|md|ya?ml|sh|txt|toml|lock)"
NAMED = re.compile(r"(?:\.\.?/)*[\w\-\[\]][\w.\-/\[\]]*\." + EXTENSIONS)
# A JavaScript string literal that is a whole path or file name, once comments are removed.
JS_NAMED = re.compile(r"[\"'`]((?:\.\.?/)*[\w\-\[\]][\w.\-/\[\]]*\." + EXTENSIONS + r")[\"'`]")
JS_COMMENT = re.compile(r"/\*.*?\*/|(?<![:\\\"'])//[^\n]*", re.S)
SELF = "test_ci_zones"


def literals(test):
    """The string literals of a test's source that are a whole path or file name (not a sentence, not a comment)."""
    text = test.read_text(errors="ignore")
    if test.suffix == ".py":
        try:
            tree = ast.parse(text)
        except SyntaxError:
            return []
        docstrings = {id(node.body[0].value) for node in ast.walk(tree)
                      if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef))
                      and node.body and isinstance(node.body[0], ast.Expr)
                      and isinstance(node.body[0].value, ast.Constant)}
        found = [n.value for n in ast.walk(tree) if isinstance(n, ast.Constant) and isinstance(n.value, str)
                 and id(n) not in docstrings]
    else:
        return JS_NAMED.findall(JS_COMMENT.sub("", text))
    return [s for s in found if len(s) < 300 and NAMED.fullmatch(s)]


@lru_cache(maxsize=None)
def named(root=ROOT):
    """Zone -> the paths and file names its tests' sources name (leading ../ and ./ removed)."""
    out = {}
    for zone, globs in TESTS.items():
        names = set()
        for pattern in globs:
            for test in Path(root).glob(pattern):
                if test.stem == SELF or (zone == "python" and test.stem in DEPLOY_MODULES):
                    continue
                names.update(re.sub(r"^(\.\.?/)+", "", token) for token in literals(test))
        out[zone] = frozenset(names)
    return out


def named_by(path, root=ROOT):
    """The zones whose tests name this path, whole or by its end (`vega/planner.py`, `README.md`)."""
    return {zone for zone, names in named(root).items() if any(path == n or path.endswith("/" + n) for n in names)}


def note(path):
    return path.endswith(".md") or path.startswith("docs/")


def zones(paths, full=False, root=ROOT):
    """The set of zones the changed paths need."""
    paths = [p.strip() for p in paths if p.strip()]
    if full or not paths or any(re.match(rule, p) for p in paths for rule in EVERYTHING):
        return set(ZONES)
    needed = set()
    for path in paths:
        found = named_by(path, root)
        if not note(path):
            found |= {zone for zone, rules in ZONES.items() if any(re.match(rule, path) for rule in rules)}
            if path.startswith("dashboard/") and not any(re.match(rule, path) for rule in SITE_ONLY):
                found |= set(SHARED_WITH_BACKEND)
            if not found:
                return set(ZONES)
        needed |= found
    return needed


def outputs(needed):
    suites = [s for s in SUITES if s in needed]
    parts = [s if PARTS[s] == 1 else f"{s}-{i}" for s in suites for i in range(1, PARTS[s] + 1)]
    lines = ["suites=" + json.dumps(suites, separators=(",", ":")), "parts=" + json.dumps(parts, separators=(",", ":"))]
    lines += [f"{zone}={'true' if zone in needed else 'false'}" for zone in FLAGS]
    return "\n".join(lines)


if __name__ == "__main__":
    args = sys.argv[1:]
    if "--full" in args:
        print(outputs(zones([], full=True)))
    else:
        data = sys.stdin.read()
        print(outputs(zones(data.split("\0") if "-z" in args else data.splitlines())))
