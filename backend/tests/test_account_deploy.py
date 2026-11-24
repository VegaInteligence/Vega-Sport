"""What a Deploy does about the account, in each state of the owner's preparation (backend/account/FAILURE_MODES.md
W1 to W12, written before these tests).

The real infra/aws/deploy.sh and infra/aws/ci/secrets.sh run from the repository root, offline: `aws`, `npm`,
`python3` and `docker` are stand-ins on PATH. The stand-in `aws` answers from a JSON state (SSM parameters, stacks
with their outputs, parameters and status), records every call, and keeps what a call writes (put-parameter,
deploy). `python3` stands in for infra/aws/package_api.py only (the packages are built for real in CI, job « Read
API package »). A run is judged on the calls it made: the stacks deployed with their overrides, the parameters
written, the uploads, the tasks, and on its log.

Evidence: one JSON file per Deploy run (the state given, the environment, the exit code, the log, every call, the
state after; the secrets in it are the run's own random ones) in VEGA_ACCOUNT_DEPLOY_EVIDENCE, or by default
<tmp>/vega-account-deploy/<run>/. Rerun: PYTHONPATH=backend:backend/tests python3 -m unittest -v test_account_deploy
"""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[2]
ACCOUNT = "361769570630"
RELEASES = f"vega-v2-releases-{ACCOUNT}-us-east-2"
TAG = "0123456789abcdef0123456789abcdef01234567"
ENDPOINT = "vega-football-db-postgres.cabcdefghijk.us-east-2.rds.amazonaws.com"
FRONT_URL = "https://abcdefghijklmnopqrstuvwxyz012345.lambda-url.us-east-2.on.aws/"
NEON = {
    "/vega/v2/neon-auth-url": "https://ep-steep-boat-bekuqo4w.neonauth.c-9.us-east-2.aws.neon.tech/neondb/auth",
    "/vega/v2/neon-project-id": "sweet-queen-11955006",
    "/vega/v2/neon-branch-id": "br-mute-bonus-be23014e",
    "/vega/v2/site-origins": "https://vegasport.vercel.app",
}
SWITCH = "/vega/v2/account-deploy"
TEMPLATE = (ROOT / "infra/aws/account.yaml").read_text()
EVIDENCE = Path(os.environ.get("VEGA_ACCOUNT_DEPLOY_EVIDENCE") or Path(tempfile.gettempdir()) / "vega-account-deploy" / time.strftime("%Y%m%dT%H%M%S"))

FAKE_AWS = r'''
import json, os, re, sys
state_path, log_path = os.environ["FAKE_STATE"], os.environ["FAKE_LOG"]
state = json.load(open(state_path))
argv = sys.argv[1:]
with open(log_path, "a") as log:
    log.write(json.dumps({"tool": "aws", "argv": argv}) + "\n")
words, opts, key = [], {}, None
for token in argv:
    if token.startswith("--"):
        key = token[2:]
        opts[key] = []
    elif key is None:
        words.append(token)
    else:
        opts[key].append(token)
def value(name):
    return (opts.get(name) or [""])[0]
def save():
    json.dump(state, open(state_path, "w"))
def fail(message, code=254):
    print(message, file=sys.stderr)
    sys.exit(code)
service, op = (words + ["", ""])[:2]
query = value("query")
if (service, op) == ("sts", "get-caller-identity"):
    print(state["account"])
elif (service, op) == ("cloudformation", "describe-stacks"):
    name = value("stack-name")
    stack = state["stacks"].get(name)
    if stack is None:
        fail(f"An error occurred (ValidationError) when calling the DescribeStacks operation: Stack with id {name} does not exist")
    if query == "Stacks[0].StackStatus":
        print(stack["status"])
    elif m := re.fullmatch(r"Stacks\[0\]\.Outputs\[\?OutputKey=='(\w+)'\]\.OutputValue", query):
        print(stack.get("outputs", {}).get(m[1], ""))
    elif m := re.fullmatch(r"Stacks\[0\]\.Parameters\[\?ParameterKey=='(\w+)'\]\.ParameterValue", query):
        print(stack.get("parameters", {}).get(m[1], ""))
    else:
        fail("fake aws: unknown query " + query, 99)
elif (service, op) == ("cloudformation", "deploy"):
    name = value("stack-name")
    if name in state.get("fail_deploy", []):
        fail(f"Failed to create/update the stack {name}", 255)
    stack = state["stacks"].setdefault(name, {"status": "CREATE_COMPLETE", "outputs": {}, "parameters": {}})
    for pair in opts.get("parameter-overrides", []):
        k, _, v = pair.partition("=")
        stack["parameters"][k] = v
    if name == "vega-v2-account":
        stack["outputs"]["FrontUrl"] = state["front_url"]
    save()
elif (service, op) == ("ssm", "get-parameter"):
    name = value("name")
    param = state["params"].get(name)
    if param is None:
        fail(f"An error occurred (ParameterNotFound) when calling the GetParameter operation: Parameter {name} not found.")
    if query == "Parameter.Value":
        secure = param["Type"] == "SecureString" and "with-decryption" not in opts
        print("AQICAHhCiphertextOfASecureString==" if secure else param["Value"])
    elif query == "Parameter.Name":
        print(name)
    elif query == "Parameter.Type":
        print(param["Type"])
    elif query == "":
        print(json.dumps({"Parameter": {"Name": name, "Type": param["Type"]}}))
    else:
        fail("fake aws: unknown query " + query, 99)
elif (service, op) == ("ssm", "put-parameter"):
    name, given = value("name"), value("value")
    if name in state["params"] and "overwrite" not in opts:
        fail("An error occurred (ParameterAlreadyExists)")
    if given.startswith("file://"):
        given = open(given[len("file://"):]).read()
    state["params"][name] = {"Type": value("type"), "Value": given}
    save()
elif (service, op) == ("ecr", "describe-images"):
    print("{}")
elif (service, op) == ("ecs", "run-task"):
    print("arn:aws:ecs:us-east-2:%s:task/vega-v2/0123" % state["account"])
elif (service, op) == ("ecs", "wait"):
    pass
elif (service, op) == ("ecs", "describe-tasks"):
    print(state.get("migrate_exit", 0))
elif (service, op) == ("s3", "cp"):
    if not os.path.isfile(words[2]):
        fail("fake aws: no file " + words[2], 1)
else:
    fail("fake aws: unexpected call " + " ".join(argv), 99)
'''

FAKE_TOOL = r'''
import hashlib, json, os, sys
argv = sys.argv[1:]
tool = os.path.basename(sys.argv[0])
with open(os.environ["FAKE_LOG"], "a") as log:
    log.write(json.dumps({"tool": tool, "argv": argv}) + "\n")
if tool == "docker":
    sys.exit(99)
if tool == "python3":
    if argv[:1] != ["infra/aws/package_api.py"]:
        sys.exit(99)
    kind = argv[2] if len(argv) > 2 else "api"
    os.makedirs(argv[1], exist_ok=True)
    path = os.path.join(argv[1], hashlib.sha256(kind.encode()).hexdigest() + ".zip")
    open(path, "w").write(kind)
    print(path)
'''


def base_state():
    """Production as it is before the account: the secrets of the base, the stacks deploy.sh reads."""
    secure = {f"/vega/v2/password-{r}": f"pw{r}" * 6 for r in ("collect", "calc", "read")}
    secure.update({f"/vega/v2/{r}-database-url": f"postgresql://vega_v2_{r}:pw{r}@{ENDPOINT}:5432/vega_v2" for r in ("collect", "calc", "read")})
    secure.update({"/vega/v2/pitchapi-key": "pitch-key", "/vega/v2/ops-key": "o" * 64, "/vega/v2/edge-key": "e" * 64})
    stack = lambda outputs=None, parameters=None: {"status": "UPDATE_COMPLETE", "outputs": outputs or {}, "parameters": parameters or {}}  # noqa: E731
    return {
        "account": ACCOUNT,
        "front_url": FRONT_URL,
        "params": {k: {"Type": "SecureString", "Value": v} for k, v in secure.items()},
        "stacks": {
            "vega-v2-deploy-roles": stack({"DeployRoleArn": f"arn:aws:iam::{ACCOUNT}:role/vega-v2-deploy"}),
            "vega-v2-database": stack({"DatabaseEndpoint": ENDPOINT, "WorkerSecurityGroup": "sg-0worker", "ApiSecurityGroup": "sg-0api"},
                                      {"InstanceClass": "db.t4g.medium"}),
            "vega-v2-worker": stack(parameters={"BackfillDesiredCount": "0"}),
            "vega-v2-live": stack(),
            "vega-v2-waf": stack({"WebAclArn": f"arn:aws:wafv2:us-east-1:{ACCOUNT}:global/webacl/vega-v2-api/abc"}),
            "vega-v2-api": stack({"ApiOrigin": "https://d111111abcdef8.cloudfront.net", "DistributionId": "E2NNDNWK491L8W"}),
            "vega-v2-alerts": stack(),
            "vega-v2-alerts-edge": stack(),
        },
    }


def roles_updated(state):
    state["stacks"]["vega-v2-deploy-roles"]["outputs"]["AccountGrants"] = "2"
    return state


def prepared(state, switch="on"):
    """Everything the owner does by hand (DEPLOYMENT.md, section 3): the roles, the Neon values, then the switch."""
    roles_updated(state)
    for name, value in NEON.items():
        state["params"][name] = {"Type": "String", "Value": value}
    state["params"][SWITCH] = {"Type": "String", "Value": switch}
    return state


def pattern(name):
    """A parameter's AllowedPattern in account.yaml (CloudFormation matches the whole value)."""
    block = re.search(rf"\n  {name}:(.*?)(?=\n  \w+:|\nResources:)", TEMPLATE, re.S).group(0)
    found = re.search(r"AllowedPattern: '([^']*)'", block)
    return found.group(1) if found else None


class Run:
    def __init__(self, done, calls, state):
        self.code, self.out, self.err, self.calls, self.state = done.returncode, done.stdout, done.stderr, calls, state
        self.log = done.stdout + done.stderr

    def aws(self, service, op):
        return [c["argv"] for c in self.calls if c["tool"] == "aws" and c["argv"][:2] == [service, op]]

    def writes(self):
        """What changes something: a stack deployed, a parameter written, an upload, a task, a package built."""
        out = []
        for c in self.calls:
            a = c["argv"]
            if c["tool"] != "aws":
                out.append((c["tool"], " ".join(a)))
            elif a[:2] == ["cloudformation", "deploy"]:
                stack = a[a.index("--stack-name") + 1]
                keys = []
                if "--parameter-overrides" in a:
                    for pair in a[a.index("--parameter-overrides") + 1:]:
                        if pair.startswith("--"):
                            break
                        keys.append(pair if pair.startswith("Account=") else pair.split("=", 1)[0])
                out.append(("deploy", stack, *keys))
            elif a[:2] == ["ssm", "put-parameter"]:
                out.append(("ssm put-parameter", a[a.index("--name") + 1]))
            elif a[:2] == ["s3", "cp"]:
                out.append(("s3 cp", a[-1]))
            elif a[:2] == ["ecs", "run-task"]:
                out.append(("ecs run-task", a[a.index("--task-definition") + 1]))
        return out

    def overrides(self, stack):
        found = [a for a in self.aws("cloudformation", "deploy") if a[a.index("--stack-name") + 1] == stack]
        assert len(found) == 1, f"{stack}: deployed {len(found)} times"
        a = found[0]
        out = {}
        for pair in a[a.index("--parameter-overrides") + 1:]:
            if pair.startswith("--"):
                break
            k, _, v = pair.partition("=")
            out[k] = v
        return out, a


# What a Deploy did before the account (deploy.sh of 12e645e, run the same way): the shape every run keeps while the
# account is off.
TODAY = [
    ("deploy", "vega-v2-database"),
    ("deploy", "vega-v2-worker", "ImageTag", "DesiredCount", "BackfillDesiredCount", "ArchiveSourcesBucket", "OddsApiKeyParameter"),
    ("ecs run-task", "vega-v2-migrate"),
    ("deploy", "vega-v2-worker", "ImageTag", "DesiredCount", "BackfillDesiredCount", "ArchiveSourcesBucket", "OddsApiKeyParameter"),
    ("python3", "infra/aws/package_api.py <tmp>/live-package live"),
    ("s3 cp", f"s3://{RELEASES}/releases/v2-live/{hashlib.sha256(b'live').hexdigest()}.zip"),
    ("deploy", "vega-v2-live", "ImageTag", "ReleaseKey", "ApiKeyExpires", "LiveProvider"),
    ("npm", "ci --prefix backend/api"),
    ("python3", "infra/aws/package_api.py <tmp>/api-package"),
    ("s3 cp", f"s3://{RELEASES}/releases/v2-api/{hashlib.sha256(b'api').hexdigest()}.zip"),
    ("deploy", "vega-v2-waf", "SiteKey"),
    ("deploy", "vega-v2-api", "ReleaseKey", "ReadDatabaseUrl", "OpsKey", "MediaBaseUrl", "ReservedConcurrency", "WebAclArn"),
    ("deploy", "vega-v2-alerts", "AlertEmail", "AlertEmail2", "WatchWorker", "WatchLive"),
    ("deploy", "vega-v2-alerts-edge", "AlertEmail", "AlertEmail2", "DistributionId", "ApiDomain"),
]


@unittest.skipUnless(shutil.which("bash") and shutil.which("openssl"), "requires bash and openssl")
class AccountDeployTest(unittest.TestCase):
    def deploy(self, state, actions=False, script=ROOT / "infra/aws/deploy.sh"):
        tmp = Path(tempfile.mkdtemp(prefix="vega-account-deploy-"))
        self.addCleanup(shutil.rmtree, tmp, True)
        bin_dir = tmp / "bin"
        bin_dir.mkdir()
        for name, source in (("aws", FAKE_AWS), ("npm", FAKE_TOOL), ("python3", FAKE_TOOL), ("docker", FAKE_TOOL)):
            (bin_dir / name).write_text(f"#!{sys.executable}\n{source}")
            (bin_dir / name).chmod(0o755)
        (tmp / "state.json").write_text(json.dumps(state))
        env = {"PATH": f"{bin_dir}:/usr/bin:/bin", "HOME": str(tmp), "FAKE_STATE": str(tmp / "state.json"), "FAKE_LOG": str(tmp / "calls.log"),
               "VEGA_V2_DEPLOY_EXPORT": "1", "IMAGE_TAG": TAG, "RUNNER_TEMP": str(tmp / "runner"),
               "CFN_ROLE": f"arn:aws:iam::{ACCOUNT}:role/vega-v2-cloudformation", "WORKER_DESIRED_COUNT": "1"}
        if actions:
            env["GITHUB_ACTIONS"] = "true"
        done = subprocess.run(["bash", str(script)], cwd=ROOT, env=env, capture_output=True, text=True, timeout=120)
        log = (tmp / "calls.log").read_text() if (tmp / "calls.log").exists() else ""
        calls = [json.loads(line) for line in log.splitlines()]
        for c in calls:
            c["argv"] = [a.replace(str(tmp / "runner"), "<tmp>") for a in c["argv"]]
        after = json.loads((tmp / "state.json").read_text())
        EVIDENCE.mkdir(parents=True, exist_ok=True)
        runs = sorted(EVIDENCE.glob(f"{self.id()}.*.json"))
        (EVIDENCE / f"{self.id()}.{len(runs)}.json").write_text(json.dumps({
            "test": self.id(), "command": f"bash {script} (cwd {ROOT})", "env": {k: v for k, v in env.items() if k != "PATH"},
            "state_given": state, "exit_code": done.returncode, "stdout": done.stdout, "stderr": done.stderr, "calls": calls,
            "state_after": after}, indent=1))
        return Run(done, calls, after)

    def assert_today(self, run, line):
        self.assertEqual(run.code, 0, run.log)
        self.assertEqual(run.writes(), TODAY)
        self.assertTrue(run.out.rstrip().endswith("done"), run.out)
        account_lines = [entry for entry in run.out.splitlines() if entry.startswith("account")]
        self.assertEqual(account_lines, [line])
        self.assertEqual(run.aws("ssm", "put-parameter"), [])

    def assert_refused(self, run, *needles):
        """The preflight refused: nothing was written, the log names what is wrong and how to deploy without the account."""
        self.assertNotEqual(run.code, 0, run.log)
        self.assertEqual(run.writes(), [])
        for needle in needles:
            self.assertIn(needle, run.log)
        self.assertIn(f"set {SWITCH} to off", run.log)

    # --- the switch is not on: today's Deploy -------------------------------------------------------------------------

    def test_w1_nothing_prepared_deploys_as_today_and_says_so(self):
        run = self.deploy(base_state())
        self.assert_today(run, f"account: off (no SSM parameter {SWITCH}): the account API is not deployed (backend/account/DEPLOYMENT.md, section 3)")

    def test_w1_the_roles_updated_alone_change_nothing(self):
        run = self.deploy(roles_updated(base_state()))
        self.assert_today(run, f"account: off (no SSM parameter {SWITCH}): the account API is not deployed (backend/account/DEPLOYMENT.md, section 3)")

    def test_w1_the_neon_values_without_the_switch_change_nothing(self):
        state = prepared(base_state())
        del state["params"][SWITCH]
        run = self.deploy(state)
        self.assert_today(run, f"account: off (no SSM parameter {SWITCH}): the account API is not deployed (backend/account/DEPLOYMENT.md, section 3)")

    def test_w2_the_switch_off_changes_nothing(self):
        run = self.deploy(prepared(base_state(), switch="off"))
        self.assert_today(run, f"account: off ({SWITCH} is off): the account API is not deployed (backend/account/DEPLOYMENT.md, section 3)")

    def test_w3_another_value_of_the_switch_is_refused(self):
        for value in ("On", "true", "on "):
            with self.subTest(value=value):
                run = self.deploy(prepared(base_state(), switch=value))
                self.assert_refused(run, SWITCH, "on or off")

    # --- the switch is on, a prerequisite is missing: refused before anything changes ---------------------------------

    def test_w4_the_roles_not_updated_are_refused(self):
        for grants in (None, "1"):  # never updated; updated on 24 Nov with the grants that lack W14's
            with self.subTest(grants=grants):
                state = prepared(base_state())
                outputs = state["stacks"]["vega-v2-deploy-roles"]["outputs"]
                if grants is None:
                    del outputs["AccountGrants"]
                else:
                    outputs["AccountGrants"] = grants
                self.assert_refused(self.deploy(state), "vega-v2-deploy-roles", "AccountGrants is not 2", "DEPLOYMENT.md")

    def test_w14_the_cloudformation_role_may_create_the_account_security_group(self):
        """EC2 authorizes ec2:CreateSecurityGroup on the group and on the VPC, and sets ec2:Vpc for neither."""
        roles = (ROOT / "infra/aws/deploy-roles.yaml").read_text()
        database = (ROOT / "infra/aws/database.yaml").read_text()
        group = re.search(r"\n  AccountSG:\n(?:    .*\n)+", database).group(0)
        vpc = re.search(r"VpcId: (vpc-[0-9a-f]+)", group).group(1)
        statement = re.search(r"- Sid: SecurityGroupCreate\n(?:(?!\s+- Sid:).*\n)+", roles).group(0)
        self.assertIn("'ec2:CreateSecurityGroup'", statement)
        self.assertNotIn("Condition", statement)
        resources = re.findall(r"!Sub 'arn:\$\{AWS::Partition\}:ec2:\$\{AWS::Region\}:\$\{AWS::AccountId\}:([^']+)'", statement)
        self.assertEqual(sorted(resources), sorted(["security-group/*", f"vpc/{vpc}"]))
        self.assertRegex(roles, r"\n  AccountGrants: \{Value: '2'\}")

    def test_w5_every_missing_or_malformed_value_is_named_in_one_run(self):
        state = prepared(base_state())
        for name in NEON:
            del state["params"][name]
        run = self.deploy(state)
        self.assert_refused(run, *NEON)
        bad = {"/vega/v2/neon-auth-url": "http://ep-steep-boat.neon.tech/neondb/auth", "/vega/v2/site-origins": "https://vegasport.vercel.app/",
               "/vega/v2/neon-project-id": "sweet queen", "/vega/v2/neon-branch-id": "br-" + "x" * 70}
        state = prepared(base_state())
        for name, value in bad.items():
            state["params"][name]["Value"] = value
        self.assert_refused(self.deploy(state), *bad)
        # The same values are refused by account.yaml's own patterns: the preflight checks what CloudFormation would.
        names = {"/vega/v2/neon-auth-url": "NeonAuthUrl", "/vega/v2/site-origins": "SiteOrigins",
                 "/vega/v2/neon-project-id": "NeonProjectId", "/vega/v2/neon-branch-id": "NeonBranchId"}
        for name, value in bad.items():
            self.assertIsNone(re.fullmatch(pattern(names[name]), value), name)
            self.assertIsNotNone(re.fullmatch(pattern(names[name]), NEON[name]), name)
        # A SecureString where a String is expected reads as ciphertext: refused, named.
        state = prepared(base_state())
        state["params"]["/vega/v2/site-origins"]["Type"] = "SecureString"
        self.assert_refused(self.deploy(state), "/vega/v2/site-origins")

    def test_w6_a_malformed_neon_api_key_is_refused(self):
        for value in ("napi key with spaces", "short"):
            with self.subTest(value=value):
                state = prepared(base_state())
                state["params"]["/vega/v2/neon-api-key"] = {"Type": "SecureString", "Value": value}
                run = self.deploy(state)
                self.assert_refused(run, "/vega/v2/neon-api-key")
                self.assertNotIn(value, run.log)

    def test_w7_a_malformed_generated_secret_is_refused(self):
        cases = {"/vega/v2/account-database-url": f"postgresql://vega_v2_account:pw@{ENDPOINT}:5432/vega_v2?sslmode=require",
                 "/vega/v2/pass-key/k1": "A" * 42}
        for name, value in cases.items():
            with self.subTest(name=name):
                state = prepared(base_state())
                state["params"][name] = {"Type": "SecureString", "Value": value}
                run = self.deploy(state)
                self.assert_refused(run, name)
                self.assertNotIn(value, run.log)

    def test_w8_an_account_stack_that_cannot_be_updated_is_refused(self):
        for status in ("ROLLBACK_COMPLETE", "UPDATE_ROLLBACK_FAILED", "UPDATE_IN_PROGRESS", "DELETE_FAILED"):
            with self.subTest(status=status):
                state = prepared(base_state())
                state["stacks"]["vega-v2-account"] = {"status": status, "outputs": {}, "parameters": {}}
                self.assert_refused(self.deploy(state), "vega-v2-account", status)

    # --- everything prepared ---------------------------------------------------------------------------------------------

    def test_w7_w10_w11_everything_prepared_deploys_the_account_in_order(self):
        run = self.deploy(prepared(base_state()))
        self.assertEqual(run.code, 0, run.log)
        self.assertTrue(run.out.rstrip().endswith("done"), run.out)
        writes = run.writes()
        params = run.state["params"]
        # W7: the generated secrets, created by step 2 through files (no value on a command line).
        for name in ("/vega/v2/password-account", "/vega/v2/account-database-url", "/vega/v2/pass-key/k1"):
            self.assertIn(("ssm put-parameter", name), writes)
            self.assertEqual(params[name]["Type"], "SecureString")
        for a in run.aws("ssm", "put-parameter"):
            self.assertTrue(a[a.index("--value") + 1].startswith("file://"), a)
        password = params["/vega/v2/password-account"]["Value"]
        url = params["/vega/v2/account-database-url"]["Value"]
        key = params["/vega/v2/pass-key/k1"]["Value"]
        self.assertRegex(password, r"^[0-9a-f]{48}$")
        self.assertEqual(url, f"postgresql://vega_v2_account:{password}@{ENDPOINT}:5432/vega_v2")
        self.assertRegex(key, r"^[A-Za-z0-9_-]{43}$")
        # W11: Account=true for the shared templates that carry it, on both worker passes.
        account_on = [w for w in writes if "Account=true" in w]
        self.assertEqual([w[1] for w in account_on], ["vega-v2-database", "vega-v2-worker", "vega-v2-worker", "vega-v2-alerts"])
        # W10: the order.
        order = [w[1] if w[0] == "deploy" else w[0] + " " + w[1] for w in writes]
        index = order.index
        self.assertLess(index("vega-v2-database"), index("ssm put-parameter /vega/v2/password-account"))
        self.assertLess(index("ssm put-parameter /vega/v2/account-database-url"), index("vega-v2-worker"))
        self.assertLess(index("vega-v2-worker"), index("ecs run-task vega-v2-migrate"))
        self.assertEqual(order[-1], "vega-v2-account")
        self.assertLess(index("vega-v2-alerts-edge"), index("vega-v2-account"))
        # The packages, built after `npm ci` of backend/account and uploaded under releases/v2-account/.
        front, store = (hashlib.sha256(k.encode()).hexdigest() for k in ("account-front", "account-store"))
        tail = writes[order.index("vega-v2-alerts-edge") + 1:]
        self.assertEqual(tail, [
            ("npm", "ci --prefix backend/account"),
            ("python3", "infra/aws/package_api.py <tmp>/account-package account-front"),
            ("python3", "infra/aws/package_api.py <tmp>/account-package account-store"),
            ("s3 cp", f"s3://{RELEASES}/releases/v2-account/{front}.zip"),
            ("s3 cp", f"s3://{RELEASES}/releases/v2-account/{store}.zip"),
            ("deploy", "vega-v2-account", "FrontReleaseKey", "StoreReleaseKey", "AccountDatabaseUrl", "NeonAuthUrl", "SiteOrigins", "PassKeys",
             "PassKeyCurrent", "NeonApiKey", "NeonProjectId", "NeonBranchId"),
        ])
        given, argv = run.overrides("vega-v2-account")
        self.assertEqual(argv[argv.index("--capabilities") + 1], "CAPABILITY_IAM")
        self.assertEqual(argv[argv.index("--template-file") + 1], "infra/aws/account.yaml")
        self.assertEqual(given, {
            "FrontReleaseKey": f"releases/v2-account/{front}.zip", "StoreReleaseKey": f"releases/v2-account/{store}.zip",
            "AccountDatabaseUrl": url, "NeonAuthUrl": NEON["/vega/v2/neon-auth-url"], "SiteOrigins": NEON["/vega/v2/site-origins"],
            "PassKeys": f"k1:{key}", "PassKeyCurrent": "k1", "NeonApiKey": "", "NeonProjectId": NEON["/vega/v2/neon-project-id"],
            "NeonBranchId": NEON["/vega/v2/neon-branch-id"]})
        # What is passed is what account.yaml accepts.
        for name, value in given.items():
            if pattern(name) and value:
                self.assertIsNotNone(re.fullmatch(pattern(name), value), name)
        # W6: no Neon key, said once; W12: no secret in the log.
        self.assertIn("account: no SSM parameter /vega/v2/neon-api-key: DELETE /account answers 503 DELETION_UNAVAILABLE", run.out)
        for secret in (password, url, key):
            self.assertNotIn(secret, run.log)
        self.assertIn(f"account API: {FRONT_URL}", run.out)
        # A second Deploy: nothing generated again, the same stack parameters.
        again = self.deploy(run.state)
        self.assertEqual(again.code, 0, again.log)
        self.assertEqual(again.aws("ssm", "put-parameter"), [])
        self.assertEqual(again.overrides("vega-v2-account")[0], given)

    def test_w12_the_workflow_masks_every_secret_before_it_is_used(self):
        state = prepared(base_state())
        neon_key = "napi_" + "k" * 60
        state["params"]["/vega/v2/neon-api-key"] = {"Type": "SecureString", "Value": neon_key}
        run = self.deploy(state, actions=True)
        self.assertEqual(run.code, 0, run.log)
        params = run.state["params"]
        secrets = [params["/vega/v2/account-database-url"]["Value"], params["/vega/v2/pass-key/k1"]["Value"], neon_key]
        lines = run.out.splitlines()
        for secret in secrets:
            masks = [i for i, line in enumerate(lines) if line == f"::add-mask::{secret}"]
            self.assertEqual(len(masks), 1, secret[:8])
            self.assertEqual([line for line in lines if secret in line], [f"::add-mask::{secret}"])
        self.assertEqual(run.overrides("vega-v2-account")[0]["NeonApiKey"], neon_key)
        self.assertNotIn("no SSM parameter /vega/v2/neon-api-key", run.out)

    def test_w10_a_failed_migration_stops_before_the_account_stack(self):
        state = prepared(base_state())
        state["migrate_exit"] = 1
        run = self.deploy(state)
        self.assertNotEqual(run.code, 0)
        self.assertNotIn("vega-v2-account", [w[1] for w in run.writes()])
        self.assertEqual(run.writes()[-1], ("ecs run-task", "vega-v2-migrate"))

    def test_w2_off_after_on_keeps_what_exists(self):
        first = self.deploy(prepared(base_state()))
        self.assertEqual(first.code, 0, first.log)
        state = first.state
        state["params"][SWITCH]["Value"] = "off"
        run = self.deploy(state)
        self.assert_today(run, f"account: off ({SWITCH} is off): the account API is not deployed (backend/account/DEPLOYMENT.md, section 3)")
        # No Account override: each stack keeps its previous value (true), so nothing is removed.
        for stack in ("vega-v2-database", "vega-v2-worker", "vega-v2-alerts"):
            self.assertEqual(run.state["stacks"][stack]["parameters"].get("Account"), "true", stack)


if __name__ == "__main__":
    unittest.main()
