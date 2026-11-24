"""The account store's connections fit its login, by construction (backend/account/FAILURE_MODES.md M10).

Failure modes, and what is expected:
- more copies of the store than the login has connections -> the store's reserved concurrency
  (infra/aws/account.yaml) and its pool size (backend/account/lambda/store-index.mjs) are read
  from where they are set, and the login holds twice the copies' connections (a deploy leaves
  the old copies beside the new ones) plus a margin of 2 for a diagnostic session;
- a copy that sleeps and never gives its connection back -> the base closes its idle session
  within two minutes;
- the four logins together asking for more than the instance has -> 96, under 200
  (db.t4g.medium gives about 400).
"""
import re
import unittest
from pathlib import Path

from vega import migrate

ROOT = Path(__file__).resolve().parents[2]
TEMPLATE = (ROOT / "infra/aws/account.yaml").read_text()
STORE = (ROOT / "backend/account/lambda/store-index.mjs").read_text()


def one(pattern, text, what):
    found = re.findall(pattern, text, re.S)
    assert len(found) == 1, f"{what}: expected once, found {len(found)}"
    return found[0]


class AccountCapacityTest(unittest.TestCase):
    def setUp(self):
        store = one(r"\n  Store:\n    Type: AWS::Lambda::Function\n((?:    [^\n]*\n)+)", TEMPLATE, "the store function")
        self.copies = int(one(r"\n      ReservedConcurrentExecutions: (\d+)\n", store, "the store's reserved concurrency"))
        self.per_copy = int(one(r"\bmax: (\d+),", STORE, "pool size of a copy"))
        self.idle_ms = int(one(r"\bidleSessionMs: ([\d_]+)", STORE, "idle session limit").replace("_", ""))

    def test_the_login_holds_two_generations_of_copies(self):
        self.assertEqual((self.copies, self.per_copy), (8, 1))
        self.assertEqual(migrate.ACCOUNT_MARGIN, 2)
        self.assertEqual(migrate.CONNECTION_LIMITS["account"], 2 * self.copies * self.per_copy + migrate.ACCOUNT_MARGIN)
        self.assertIn("account", migrate.LOGINS)

    def test_a_sleeping_copy_gives_its_connection_back(self):
        self.assertGreaterEqual(self.idle_ms, 30_000)
        self.assertLessEqual(self.idle_ms, 120_000)

    def test_the_four_logins_fit_the_instance(self):
        self.assertEqual(set(migrate.LOGINS), {"collect", "calc", "read", "account"})
        self.assertEqual(sum(migrate.CONNECTION_LIMITS.values()), 96)
        self.assertLessEqual(sum(migrate.CONNECTION_LIMITS.values()), 200)


if __name__ == "__main__":
    unittest.main()
