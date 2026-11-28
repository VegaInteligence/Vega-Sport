"""A Deploy and PannaData's switch (backend/panna/FAILURE_MODES.md GH278-ah; the wiring test_panna_infra.py pins).

The real infra/aws/deploy.sh and infra/aws/ci/secrets.sh, offline, with the stateful stand-ins of test_account_deploy.py
(deploy_fakes.py on PATH; one evidence JSON per run in its directory). SSM /vega/v2/panna-deploy absent or off: nothing
of PannaData. On: the login's password and URL created through files before the worker stack, Panna=true on both
worker passes and on the alerts stack, the migrate task after them. Any other value: refused before anything changes.

  PYTHONPATH=backend:backend/tests python3 -m unittest -v test_panna_deploy
  VEGA_PANNA_DEPLOY_SCRIPT=<another deploy.sh> …   # the red run against the base commit's script
"""

import os
from pathlib import Path
import unittest

import test_account_deploy as accounts

SWITCH = "/vega/v2/panna-deploy"
SCRIPT = Path(os.environ.get("VEGA_PANNA_DEPLOY_SCRIPT") or accounts.ROOT / "infra/aws/deploy.sh")


def overrides(run, stack):
    """The --parameter-overrides of each `cloudformation deploy` of `stack`, in order."""
    out = []
    for a in run.aws("cloudformation", "deploy"):
        if a[a.index("--stack-name") + 1] != stack or "--parameter-overrides" not in a:
            continue
        pairs = []
        for pair in a[a.index("--parameter-overrides") + 1:]:
            if pair.startswith("--"):
                break
            pairs.append(pair)
        out.append(pairs)
    return out


class PannaDeployTest(unittest.TestCase):
    def deploy(self, state):
        return accounts.AccountDeployTest.deploy(self, state, script=SCRIPT)

    def state(self, switch):
        state = accounts.base_state()
        if switch is not None:
            state["params"][SWITCH] = {"Type": "String", "Value": switch}
        return state

    def test_absent_touches_nothing_of_panna(self):
        run = self.deploy(self.state(None))
        self.assertEqual(run.code, 0, run.log)
        self.assertIn(f"panna: off (no SSM parameter {SWITCH})", run.out)
        self.assertEqual([n for n in run.state["params"] if "panna" in n], [])
        for stack in ("vega-v2-worker", "vega-v2-alerts"):
            self.assertEqual([p for pairs in overrides(run, stack) for p in pairs if p.startswith("Panna")], [], stack)

    def assert_panna_false(self, run):
        """Every change of the worker stack that sets Panna sets it false, one of them before the migrate task; so do
        the alerts stack's. The first Deploy of a template changes the worker by `deploy`; a later one by `update-stack`
        with the previous template (online), then `deploy`."""
        self.assertEqual(run.code, 0, run.log)
        self.assertIn(f"panna: off ({SWITCH} is off)", run.out)
        worker = overrides(run, "vega-v2-worker")
        self.assertTrue(worker and all("Panna=false" in pairs for pairs in worker), worker)
        updates = [a for a in run.aws("cloudformation", "update-stack") if a[a.index("--stack-name") + 1] == "vega-v2-worker"]
        # The stop before a template's migrations keeps every other parameter (UsePreviousValue): only values count.
        set_panna = [p for a in updates for p in a if p.startswith("ParameterKey=Panna,ParameterValue=")]
        self.assertTrue(all(p == "ParameterKey=Panna,ParameterValue=false" for p in set_panna), set_panna)
        writes = run.writes()
        first = next(i for i, w in enumerate(writes) if w[1] == "vega-v2-worker" and "Panna" in w[2:])
        migrate = next(i for i, w in enumerate(writes) if w[:2] == ("ecs run-task", "vega-v2-migrate"))
        self.assertLess(first, migrate)
        self.assertTrue(all("Panna=false" in pairs for pairs in overrides(run, "vega-v2-alerts")))

    # GH278-ay (m4): off turns it off, so a rollback (ROLLBACK.sql after this Deploy) is not undone by the next one.
    def test_off_passes_panna_false(self):
        run = self.deploy(self.state("off"))
        self.assert_panna_false(run)
        self.assertEqual([n for n in run.state["params"] if "panna" in n and n != SWITCH], [])

    def test_on_then_off_passes_panna_false_and_keeps_the_secrets(self):
        on = self.deploy(self.state("on"))
        self.assertEqual(on.code, 0, on.log)
        state = dict(on.state)
        state["params"] = dict(state["params"], **{SWITCH: {"Type": "String", "Value": "off"}})
        off = self.deploy(state)
        self.assert_panna_false(off)
        self.assertEqual(off.state["params"]["/vega/v2/password-panna"], on.state["params"]["/vega/v2/password-panna"])
        self.assertEqual([a for a in off.aws("ssm", "put-parameter") if any("panna" in x for x in a)], [])

    def test_on_creates_the_login_s_secrets_then_the_worker_then_its_migrate_task(self):
        run = self.deploy(self.state("on"))
        self.assertEqual(run.code, 0, run.log)
        self.assertTrue(run.out.rstrip().endswith("done"), run.out)
        params = run.state["params"]
        password = params["/vega/v2/password-panna"]["Value"]
        self.assertRegex(password, r"^[0-9a-f]{48}$")
        self.assertEqual(params["/vega/v2/password-panna"]["Type"], "SecureString")
        self.assertEqual(params["/vega/v2/panna-database-url"]["Value"],
                         f"postgresql://vega_v2_panna:{password}@{accounts.ENDPOINT}:5432/vega_v2?sslmode=verify-full")
        self.assertEqual(params["/vega/v2/panna-database-url"]["Type"], "SecureString")
        self.assertNotIn(password, run.log)
        for a in run.aws("ssm", "put-parameter"):
            self.assertTrue(a[a.index("--value") + 1].startswith("file://"), a)
        worker = overrides(run, "vega-v2-worker")
        self.assertEqual(len(worker), 2)  # before the migrations, then the services' pass
        self.assertTrue(all("Panna=true" in pairs for pairs in worker), worker)
        self.assertTrue(all("Panna=true" in pairs for pairs in overrides(run, "vega-v2-alerts")))
        order = [w[1] if w[0] == "deploy" else f"{w[0]} {w[1]}" for w in run.writes()]
        self.assertLess(order.index("ssm put-parameter /vega/v2/password-panna"), order.index("vega-v2-worker"))
        self.assertLess(order.index("ssm put-parameter /vega/v2/panna-database-url"), order.index("vega-v2-worker"))
        self.assertLess(order.index("vega-v2-worker"), order.index("ecs run-task vega-v2-migrate"))

    def test_another_value_is_refused_before_anything_changes(self):
        for switch in ("On", "watch", "true"):
            with self.subTest(switch=switch):
                run = self.deploy(self.state(switch))
                self.assertNotEqual(run.code, 0, run.log)
                self.assertEqual(run.writes(), [])
                self.assertIn(f"panna: {SWITCH} holds neither value allowed", run.log)


if __name__ == "__main__":
    unittest.main()
