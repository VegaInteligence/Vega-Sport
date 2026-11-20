"""The read API's connections fit its login, by construction (VI-33).

Incident of 20 November 2026: the login vega_v2_read allowed 12 connections, sized for an
account that ran at most 10 functions at once. The account's limit became 1000, the
function had no limit of its own, 19 copies ran, and the base refused the thirteenth
(53300, shown as a 503 on every route).

Failure modes, and what is expected:
- more copies than the login has connections -> the function's reserved concurrency and
  the login's limit are read from where they are set, and the login must hold twice the
  copies' connections plus a margin (a deploy leaves the old copies, each with its
  connection, beside the new ones until the base closes their idle sessions);
- a deploy that keeps the stack's previous value (CloudFormation does, for a parameter
  that is not passed) -> deploy.sh passes the template's own number;
- a copy that sleeps and never gives its connection back -> the function asks the base to
  close an idle session, sooner than the pool itself would;
- the three logins together asking for more than the instance has -> they stay under what
  the smallest instance class in use gives (db.t4g.medium: about 400), with room for the
  owner's and the service's own sessions.
"""
import re
import unittest
from pathlib import Path

from vega import migrate

ROOT = Path(__file__).resolve().parents[2]
TEMPLATE = (ROOT / "infra/aws/api.yaml").read_text()
DEPLOY = (ROOT / "infra/aws/deploy.sh").read_text()
ENTRY = (ROOT / "infra/aws/api-index.mjs").read_text()
READER = (ROOT / "backend/api/src/db.mjs").read_text()


def one(pattern, text, what):
    found = re.findall(pattern, text, re.S)
    assert len(found) == 1, f"{what}: expected once, found {len(found)}"
    return found[0]


class ApiCapacityTest(unittest.TestCase):
    def setUp(self):
        self.copies = int(one(r"\n  ReservedConcurrency:\n    Type: Number\n    Default: (\d+)\n", TEMPLATE, "ReservedConcurrency default"))
        self.per_copy = int(one(r"\bmax: (\d+),", ENTRY, "pool size of a copy"))
        self.idle_ms = int(one(r"\bidleSessionMs: ([\d_]+),", ENTRY, "idle session limit").replace("_", ""))

    def test_the_function_always_has_a_limit_of_its_own(self):
        self.assertGreaterEqual(self.copies, 1)
        # No way left to deploy it without one.
        self.assertIn("ReservedConcurrentExecutions: !Ref ReservedConcurrency", TEMPLATE)
        self.assertNotIn("AWS::NoValue']\n      Role: !GetAtt RuntimeRole.Arn", TEMPLATE)
        self.assertEqual(int(one(r"\n  ReservedConcurrency:\n    Type: Number\n    Default: \d+\n    MinValue: (\d+)\n", TEMPLATE, "ReservedConcurrency minimum")), 1)

    def test_the_deploy_passes_the_template_s_number(self):
        self.assertEqual(int(one(r"\nAPI_COPIES=(\d+)\n", DEPLOY, "API_COPIES")), self.copies)
        self.assertEqual(len(re.findall(r'ReservedConcurrency="\$API_COPIES"', DEPLOY)), 1)

    def test_the_login_holds_two_generations_of_copies(self):
        needed = 2 * self.copies * self.per_copy + migrate.READ_MARGIN
        self.assertGreaterEqual(migrate.READ_MARGIN, 4)
        self.assertEqual(migrate.CONNECTION_LIMITS["read"], needed)

    def test_the_logins_fit_the_instance(self):
        self.assertEqual(set(migrate.CONNECTION_LIMITS), set(migrate.LOGINS))
        self.assertLessEqual(sum(migrate.CONNECTION_LIMITS.values()), 200)

    def test_a_sleeping_copy_gives_its_connection_back(self):
        pool_idle_ms = int(one(r"idleTimeoutMillis: ([\d_]+),", READER, "pool idle limit").replace("_", ""))
        # Sooner than the pool (which cannot close anything while the copy is frozen), and
        # not so soon that a copy asked every few seconds reconnects each time.
        self.assertLess(self.idle_ms, pool_idle_ms)
        self.assertGreaterEqual(self.idle_ms, 30_000)
        self.assertLessEqual(self.idle_ms, 120_000)


if __name__ == "__main__":
    unittest.main()
