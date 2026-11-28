"""The PannaData login's way into production (backend/panna/FAILURE_MODES.md GH278-ah, pass H1; written before the
templates and scripts changed).

One switch, SSM /vega/v2/panna-deploy (on or off), read by deploy.sh before anything changes. Off or absent, nothing of
panna is touched: no secret, no parameter of a stack. On: secrets.sh creates the login's password and its URL; the
worker stack's migrate task gets the password (and so applies backend/panna/sql and sets vega_v2_panna); the
connections alarm counts the login's 4 connections. The worker image holds backend/panna/sql, nothing else of the
loader (pyarrow stays out of it). secrets.sh runs here for real against a stand-in `aws` that records its calls.
"""

import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
AWS = ROOT / "infra/aws"
WORKER = (AWS / "worker.yaml").read_text()
ALERTS = (AWS / "alerts.yaml").read_text()
DEPLOY = (AWS / "deploy.sh").read_text()
DOCKERFILE = (ROOT / "backend/Dockerfile").read_text()
IGNORE = (ROOT / "backend/Dockerfile.dockerignore").read_text()

FAKE_AWS = r"""#!/usr/bin/env python3
import json, os, sys
state_path = os.environ["FAKE_AWS_STATE"]
state = json.load(open(state_path)) if os.path.exists(state_path) else {"params": {}, "calls": []}
args = sys.argv[1:]
state["calls"].append(args[:2] + [a for a in args if a.startswith("/vega/")])
def opt(name):
    return args[args.index(name) + 1] if name in args else None
if args[:2] == ["ssm", "get-parameter"]:
    name = opt("--name")
    json.dump(state, open(state_path, "w"))
    if name not in state["params"]:
        sys.stderr.write("An error occurred (ParameterNotFound) when calling the GetParameter operation\n")
        sys.exit(254)
    print(state["params"][name])
    sys.exit(0)
if args[:2] == ["ssm", "put-parameter"]:
    value = opt("--value")
    if value.startswith("file://"):
        value = open(value[7:]).read()
    state["params"][opt("--name")] = value
    json.dump(state, open(state_path, "w"))
    sys.exit(0)
if args[:2] == ["cloudformation", "describe-stacks"]:
    json.dump(state, open(state_path, "w"))
    print("vega-football-db-postgres.example.us-east-2.rds.amazonaws.com")
    sys.exit(0)
json.dump(state, open(state_path, "w"))
sys.exit(1)
"""


def block(text, name):
    found = re.search(rf"\n  {name}:\n((?:    [^\n]*\n|\n)+)", text)
    assert found, name
    return found.group(1)


class PannaDeployWiringTest(unittest.TestCase):
    def run_secrets(self, panna):
        with tempfile.TemporaryDirectory() as tmp:
            fake = Path(tmp) / "aws"
            fake.write_text(FAKE_AWS)
            fake.chmod(fake.stat().st_mode | stat.S_IEXEC)
            state = Path(tmp) / "state.json"
            env = dict(os.environ, PATH=f"{tmp}:{os.environ['PATH']}", FAKE_AWS_STATE=str(state))
            env.pop("VEGA_PANNA", None)
            env.pop("VEGA_ACCOUNT", None)
            env.pop("PITCHAPI_API_KEY", None)
            if panna:
                env["VEGA_PANNA"] = "on"
            done = subprocess.run(["bash", str(AWS / "ci/secrets.sh")], cwd=ROOT, env=env, capture_output=True, text=True, timeout=60)
            self.assertEqual(done.returncode, 0, done.stderr)
            params = json.loads(state.read_text())["params"]
            return params, done.stdout + done.stderr

    def test_off_creates_nothing_of_panna(self):
        params, out = self.run_secrets(False)
        self.assertFalse([name for name in params if "panna" in name])
        self.assertIn("/vega/v2/password-collect", params)

    def test_on_creates_the_password_and_the_url_and_prints_neither(self):
        params, out = self.run_secrets(True)
        password = params["/vega/v2/password-panna"]
        self.assertRegex(password, r"^[0-9a-f]{48}$")
        url = params["/vega/v2/panna-database-url"]
        self.assertEqual(url, f"postgresql://vega_v2_panna:{password}@vega-football-db-postgres.example.us-east-2.rds.amazonaws.com:5432/vega_v2?sslmode=verify-full")
        self.assertNotIn(password, out)

    def test_the_migrate_task_gets_the_password_only_when_panna_is_on(self):
        self.assertIn("Panna:\n    Type: String\n    Default: 'false'\n    AllowedValues: ['true', 'false']", WORKER)
        self.assertIn("HasPanna: !Equals [!Ref Panna, 'true']", WORKER)
        migrate = block(WORKER, "MigrationTask")
        self.assertIn("- !If\n              - HasPanna\n              - {Name: V2_PANNA_PASSWORD, ValueFrom: !Sub 'arn:${AWS::Partition}:ssm:${AWS::Region}:${AWS::AccountId}:parameter${PasswordParameterPrefix}-panna'}\n              - !Ref AWS::NoValue", migrate)
        for service in ("WorkerTask", "BackfillTask"):
            self.assertNotIn("PANNA", block(WORKER, service))
            self.assertNotIn("EnableExecuteCommand", block(WORKER, service))

    def test_deploy_reads_one_switch_and_passes_it_on(self):
        self.assertIn("switch=$(ssm_value /vega/v2/panna-deploy)", DEPLOY)
        self.assertRegex(DEPLOY, r"VEGA_ACCOUNT=\$ACCOUNT VEGA_PANNA=\$PANNA bash infra/aws/ci/secrets\.sh")
        self.assertIn('panna_on=(Panna=true)', DEPLOY)
        # GH278-ay: off passes Panna=false (the migrate task loses the password, the alarm the login).
        self.assertIn('panna_on=(Panna=false)', DEPLOY)
        self.assertRegex(DEPLOY, r'worker=\([^\n]*\$\{panna_on\[@\]\+"\$\{panna_on\[@\]\}"\}\)')
        self.assertRegex(DEPLOY, r'previous_template TaskImageTag="\$IMAGE" \$\{account_on\[@\]\+"\$\{account_on\[@\]\}"\} \$\{panna_on\[@\]\+"\$\{panna_on\[@\]\}"\}')
        # The alerts stack's command, its continuation lines included (up to the next stack).
        alerts_line = DEPLOY.split("stack vega-v2-alerts alerts.yaml", 1)[1].split("\nstack ", 1)[0]
        self.assertIn('${panna_on[@]+"${panna_on[@]}"}', alerts_line)

    def test_the_alarm_counts_the_login_once_panna_is_on(self):
        self.assertIn("Panna:\n    Type: String\n    Default: 'false'", ALERTS)
        self.assertIn("Panna: !Equals [!Ref Panna, 'true']", ALERTS)

    def test_the_image_holds_the_panna_sql_and_nothing_else_of_the_loader(self):
        self.assertIn("COPY backend/panna/sql panna/sql", DOCKERFILE)
        self.assertIn("!backend/panna/sql\n!backend/panna/sql/**\n", IGNORE)
        self.assertNotRegex(IGNORE, r"!backend/panna(/\*\*)?\n")
        self.assertNotIn("pyarrow", (ROOT / "backend/requirements.txt").read_text())
        self.assertIn("pyarrow", (ROOT / "backend/panna/requirements.txt").read_text())


if __name__ == "__main__":
    unittest.main()
