"""Measured durations of the Python suites' units, for python_suites.py's balanced parts (backend/ci/durations.json).

A unit is what a part runs whole: a test method of the modules that play deploy.sh (UNIT_BY_METHOD: each test builds
its own world, a state file, stand-ins, a repository or a base cloned from its class's template, and needs nothing
another test left), any other module whole. Its weight is
its time in a CI log (`unittest -v`: each result line's timestamp minus the previous one's, so a class's setUpClass
counts in its first test).

  gh api repos/VegaInteligence/Vega-Sport/actions/jobs/<job id>/logs > deploy.log   # one log per Suites (...) job
  python backend/ci/durations.py deploy-*.log python-*.log > backend/ci/durations.json

Refresh it when the parts drift apart (a part's step lasting far more than another's); a unit the file does not know
weighs the median of its group's, so a new test never fails a run.
"""

from datetime import datetime
import json
import re
import sys

UNIT_BY_METHOD = ("test_deploy_flow", "test_account_deploy", "test_panna_deploy")
STAMP = re.compile(r"^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d+)Z ?")
TEST_ID = re.compile(r"\((test_\w+\.\w+\.\w+)\)")
RESULT = re.compile(r"(?:^| \.\.\. )(?:ok|FAIL|ERROR|skipped\b.*|expected failure|unexpected success)$")


def unit(test_id):
    """The unit a test belongs to: its own id in a module that plays deploy.sh, its module elsewhere."""
    module = test_id.split(".", 1)[0]
    return test_id if module in UNIT_BY_METHOD else module


def from_log(lines):
    """Unit -> seconds, from one job's log."""
    out, current, previous, last = {}, None, None, None
    for line in lines:
        stamp = STAMP.match(line)
        if not stamp:
            continue
        when = datetime.fromisoformat(stamp.group(1)[:26])
        text = line[stamp.end():].rstrip()
        found = TEST_ID.search(text)
        if found:
            current = found.group(1)
            previous = previous or last or when
        last = when
        if current and RESULT.search(text):
            key = unit(current)
            out[key] = out.get(key, 0.0) + (when - previous).total_seconds()
            previous, current = when, None
    return out


if __name__ == "__main__":
    merged = {}
    for path in sys.argv[1:]:
        with open(path, errors="ignore") as f:
            for key, seconds in from_log(f).items():
                merged[key] = merged.get(key, 0.0) + seconds
    print(json.dumps({k: round(v, 1) for k, v in sorted(merged.items())}, indent=0, ensure_ascii=False))
