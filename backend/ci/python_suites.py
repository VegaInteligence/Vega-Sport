"""One part of the Python suites (ci.yml, an entry python-N or deploy-N of the « Suites » job).

  python backend/ci/python_suites.py python-1    # part 1 of the suites of backend/tests but the Deploy's (of PARTS)
  python backend/ci/python_suites.py deploy-3    # part 3 of the Deploy's suites (changed_suites.DEPLOY_MODULES)
  python backend/ci/python_suites.py python      # a whole group; `all` is both, as `unittest discover -s backend/tests`
  python backend/ci/python_suites.py deploy-3 --list    # the ids the part runs, one per line, without running them

Same discovery as `python -m unittest discover -s backend/tests -v` (start and top-level directory backend/tests,
verbosity 2), split by group (python, deploy) then into balanced parts: the parts of the two groups together run
exactly the whole discovery, each test once (test_ci_zones.py). A part holds whole units (durations.unit: a method of
test_deploy_flow, a module elsewhere), assigned longest first to the least loaded part by their measured time
(durations.json; a unit it does not know weighs its group's median), then runs them in discovery order. A module that
fails to import fails every part before any test runs.
"""

from pathlib import Path
import json
import statistics
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from changed_suites import DEPLOY_MODULES, PARTS  # noqa: E402
from durations import unit  # noqa: E402

HERE = Path(__file__).resolve().parent
TESTS = HERE.parents[0] / "tests"
DURATIONS = HERE / "durations.json"


def tests(suite):
    if isinstance(suite, unittest.TestSuite):
        for child in suite:
            yield from tests(child)
    else:
        yield suite


def group(test):
    return "deploy" if test.id().split(".", 1)[0] in DEPLOY_MODULES else "python"


def discover(start=TESTS):
    """Every test of the discovery, in its order. A module that fails to import raises (it would fail one part only,
    or every part, and the count of the parts would no longer be the whole's)."""
    loader = unittest.TestLoader()
    found = list(tests(loader.discover(str(start), top_level_dir=str(start))))
    if loader.errors:
        raise ImportError("discovery failed:\n" + "\n".join(loader.errors))
    return found


def assign(units, parts, weights):
    """Unit -> part number (1..parts): longest first to the least loaded part, ties broken by unit id then part."""
    known = [weights[u] for u in units if u in weights]
    default = statistics.median(known) if known else 1.0
    loads = [0.0] * parts
    out = {}
    for u in sorted(units, key=lambda u: (-weights.get(u, default), u)):
        i = loads.index(min(loads))
        loads[i] += weights.get(u, default)
        out[u] = i + 1
    return out


def part(name, start=TESTS, weights=None):
    """The tests of one part (python-N, deploy-N), of a whole group (python, deploy) or of everything (all)."""
    found = discover(start)
    if name == "all":
        return unittest.TestSuite(found)
    wanted, _, number = name.partition("-")
    chosen = [t for t in found if group(t) == wanted]
    if number:
        if weights is None:
            weights = json.loads(DURATIONS.read_text())
        units = sorted({unit(t.id()) for t in chosen})
        where = assign(units, PARTS[wanted], weights)
        chosen = [t for t in chosen if where[unit(t.id())] == int(number)]
    return unittest.TestSuite(chosen)


def names():
    out = ["all", "python", "deploy"]
    for g in ("python", "deploy"):
        out += [f"{g}-{i}" for i in range(1, PARTS[g] + 1)]
    return out


if __name__ == "__main__":
    args = sys.argv[1:]
    if not args or args[0] not in names() or args[1:] not in ([], ["--list"]):
        sys.exit("usage: python_suites.py " + "|".join(names()) + " [--list]")
    try:
        chosen = part(args[0])
    except ImportError as e:
        sys.exit(str(e))
    if args[1:] == ["--list"]:
        print("\n".join(t.id() for t in tests(chosen)))
        sys.exit(0)
    # ESSAI (branche claude/ci-ordre-inverse, à ne pas fusionner) : chaque part dans l'ordre inverse de la découverte.
    chosen = unittest.TestSuite(list(tests(chosen))[::-1])
    print(f"{args[0]}: {chosen.countTestCases()} tests", flush=True)
    result = unittest.TextTestRunner(verbosity=2).run(chosen)
    sys.exit(0 if result.wasSuccessful() else 1)
