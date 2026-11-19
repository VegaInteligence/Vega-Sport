"""What an end-to-end test needs before it can run (FAILURE_MODES.md §36, 36b).

Outside CI, a test whose prerequisite is missing (a disposable database, psycopg, node, backend/api/node_modules) is
skipped with its reason, as before: a developer without them still gets a valid run of everything else. Under CI
(CI=true, which GitHub Actions sets), it fails with that reason instead: a job that never installed the read API's
dependencies, or never got its database, cannot pass by skipping the scenarios it exists to run.
"""

import functools
import os
import unittest


def in_ci():
    return os.environ.get("CI", "").strip().lower() in ("1", "true")


def missing(reason):
    return f"CI=true and a prerequisite is missing: {reason}"


def required(ready, reason):
    """Decorates a test case class or a test method: unchanged when `ready`; else skipped outside CI, failing in CI.
    On a class, every test of it and of its subclasses fails in setUpClass; a base class's own skip does not hide it."""
    def decorate(target):
        if ready:
            return target
        if not in_ci():
            return unittest.skip(reason)(target)
        if isinstance(target, type):
            def setUpClass(cls):
                raise AssertionError(missing(reason))
            target.setUpClass = classmethod(setUpClass)
            target.__unittest_skip__ = False
            return target

        @functools.wraps(target)
        def fails(*args, **kwargs):
            raise AssertionError(missing(reason))
        return fails
    return decorate


def require(test, ready, reason):
    """Inside a running test: returns when `ready`; else skips it outside CI and fails it in CI."""
    if ready:
        return
    if in_ci():
        test.fail(missing(reason))
    test.skipTest(reason)
