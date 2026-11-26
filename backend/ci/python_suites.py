"""One part of the Python suites (ci.yml, matrix entry python or deploy of the « Suites » job).

  python backend/ci/python_suites.py python    # every suite of backend/tests but the Deploy's
  python backend/ci/python_suites.py deploy    # the Deploy's suites (changed_suites.DEPLOY_MODULES)
  python backend/ci/python_suites.py all       # both, as `python -m unittest discover -s backend/tests -v`

Same discovery as `python -m unittest discover -s backend/tests -v` (start and top-level directory backend/tests,
verbosity 2), split by module: the two parts together run exactly the whole discovery.
"""

from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from changed_suites import DEPLOY_MODULES  # noqa: E402

TESTS = Path(__file__).resolve().parents[1] / "tests"


def tests(suite):
    if isinstance(suite, unittest.TestSuite):
        for child in suite:
            yield from tests(child)
    else:
        yield suite


def part(name, start=TESTS):
    """The discovered tests of one part. A module that fails to import is kept in both parts (it must fail)."""
    found = unittest.TestLoader().discover(str(start), top_level_dir=str(start))
    chosen = unittest.TestSuite()
    for test in tests(found):
        module = type(test).__module__
        failed_import = module == "unittest.loader"
        deploy = module in DEPLOY_MODULES
        if name == "all" or failed_import or (deploy if name == "deploy" else not deploy):
            chosen.addTest(test)
    return chosen


if __name__ == "__main__":
    if len(sys.argv) != 2 or sys.argv[1] not in ("python", "deploy", "all"):
        sys.exit("usage: python_suites.py python|deploy|all")
    result = unittest.TextTestRunner(verbosity=2).run(part(sys.argv[1]))
    sys.exit(0 if result.wasSuccessful() else 1)
