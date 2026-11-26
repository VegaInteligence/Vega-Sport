"""What a Deploy does about the account, in each state of the owner's preparation (backend/account/FAILURE_MODES.md
W1 to W12, written before these tests).

The real infra/aws/deploy.sh and infra/aws/ci/secrets.sh run from the repository root, offline: `aws`, `npm`,
`python3`, `docker` and `node` are the stateful stand-ins of deploy_fakes.py on PATH (`node` runs the real probe of step
12 with the real Node.js when a test asks it: FAILURE_MODES_OPTIMISATIONS.md, GH220-s). The stand-in `aws` answers
from a JSON state (SSM parameters, stacks with their outputs, parameters and status, ECR, the Deploy's state in S3),
records every call, and keeps what a call writes. `python3` stands in for infra/aws/package_api.py (the packages are
built for real in CI, job « Read API package ») and runs the other infra scripts for real; the migrate task's exit
codes are scripted here (test_deploy_flow.py runs the real one). A run is judged on the calls it made: the stacks
deployed with their overrides, the parameters written, the uploads, the tasks, and on its log.

Evidence: one JSON file per Deploy run (the state given, the environment, the exit code, the log, every call, the
state after; the secrets in it are the run's own random ones) in VEGA_ACCOUNT_DEPLOY_EVIDENCE, or by default
<tmp>/vega-account-deploy/<run>/. Rerun: PYTHONPATH=backend:backend/tests python3 -m unittest -v test_account_deploy
"""
import hashlib
import http.server
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.parse

import deploy_fakes
from prerequisites import require

ROOT = Path(__file__).resolve().parents[2]
ACCOUNT = "361769570630"
RELEASES = f"vega-v2-releases-{ACCOUNT}-us-east-2"
# The Deploy's state lives in the roles stack's bucket (FAILURE_MODES_OPTIMISATIONS.md GH157.3).
STATE_BUCKET = f"vega-v2-deploy-state-{ACCOUNT}-us-east-2"
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

def base_state():
    """Production as it is before the account: the secrets of the base, the stacks deploy.sh reads."""
    secure = {f"/vega/v2/password-{r}": f"pw{r}" * 6 for r in ("collect", "calc", "read")}
    secure.update({f"/vega/v2/{r}-database-url": f"postgresql://vega_v2_{r}:pw{r}@{ENDPOINT}:5432/vega_v2" for r in ("collect", "calc", "read")})
    secure.update({"/vega/v2/pitchapi-key": "pitch-key", "/vega/v2/ops-key": "o" * 64, "/vega/v2/edge-key": "e" * 64})
    stack = lambda outputs=None, parameters=None: {"status": "UPDATE_COMPLETE", "outputs": outputs or {}, "parameters": parameters or {}}  # noqa: E731
    keys = deploy_fakes.template_keys(ROOT / "infra/aws/worker.yaml")
    worker = {k: "" for k in keys}
    worker.update(ImageTag="ab" * 20, DesiredCount="1", BackfillDesiredCount="0")
    return {
        "account": ACCOUNT,
        "region": "us-east-2",
        "front_url": FRONT_URL,
        "python": sys.executable,
        "images_dir": str(Path(tempfile.gettempdir()) / "vega-account-deploy-images"),
        "params": {k: {"Type": "SecureString", "Value": v} for k, v in secure.items()},
        "ecr": {"repository": True, "images": []},
        "s3": {"buckets": {RELEASES: {}, STATE_BUCKET: {}}},
        "migrate": {"default": 0},
        # The worker stack's migrate task definition (its output MigrationTaskDefinition), by revision.
        "taskdefs": {f"arn:aws:ecs:us-east-2:{ACCOUNT}:task-definition/vega-v2-migrate:1": "ab" * 20},
        "faults": {},
        "stacks": {
            "vega-v2-deploy-roles": stack({"DeployRoleArn": f"arn:aws:iam::{ACCOUNT}:role/vega-v2-deploy", "DeployGrants": "2"}),
            "vega-v2-database": stack({"DatabaseEndpoint": ENDPOINT, "WorkerSecurityGroup": "sg-0worker", "ApiSecurityGroup": "sg-0api"},
                                      {"InstanceClass": "db.t4g.medium"}),
            "vega-v2-worker": {**stack({"MigrationTaskDefinition": f"arn:aws:ecs:us-east-2:{ACCOUNT}:task-definition/vega-v2-migrate:1"}, worker),
                               "keys": keys, "template_sha": "0" * 64},
            "vega-v2-live": stack(),
            "vega-v2-waf": stack({"WebAclArn": f"arn:aws:wafv2:us-east-1:{ACCOUNT}:global/webacl/vega-v2-api/abc"}),
            "vega-v2-api": stack({"ApiOrigin": "https://d111111abcdef8.cloudfront.net", "DistributionId": "E2NNDNWK491L8W"}),
            "vega-v2-alerts": stack(),
            "vega-v2-alerts-edge": stack(),
        },
    }


NODE = shutil.which("node")
# The read API as the probe of step 12 meets it (GH220-s), in the forms of the real handler (the probe is checked
# against the handler itself in backend/api/test/smoke-favourites.test.mjs): the manifest, the home with its player of
# the week, and the personal read naming what it was asked. `scenario`: "well", "home-503" (the home unavailable),
# "no-club" (the personal read without the followed club).
SMOKE = {"season": "2025/2026", "team": "t_aaaaa2", "player": "p_aaaab4", "match": "m_aaaaa4", "date": "2025-09-04"}


def read_api(scenario):
    def answer(path, query):
        if path == "/api/dashboard/manifest":
            return 200, {"seasons": [{"id": SMOKE["season"], "chunks": []}], "defaultSeason": SMOKE["season"]}, {}
        if path == "/api/read/home":
            if scenario == "home-503":
                return 503, {"ok": False, "available": False, "error": {"code": "DATA_UNAVAILABLE", "retry": True}}, {}
            potw = {"playerId": SMOKE["player"], "teamId": SMOKE["team"], "matchId": SMOKE["match"], "date": SMOKE["date"]}
            return 200, {"data": {"potw": potw, "leaders": {"goals": [], "assists": []}}, "meta": {"generation": "7"}}, {}
        if path == "/api/read/home-favourites":
            teams, players = query.get("personalTeams", []), query.get("personalPlayers", [])
            favourites, mine = [], []
            if teams and scenario != "no-club":
                favourites.append({"teamId": teams[0], "strength": 1, "reason": "club", "players": players})
            elif players:
                favourites.append({"teamId": SMOKE["team"], "strength": 2, "reason": "player_club", "players": players})
            if players:
                mine.append({"playerId": players[0], "teamId": SMOKE["team"], "next": None,
                             "matches": [{"matchId": SMOKE["match"], "date": SMOKE["date"]}]})
            data = {"period": {"start": "2025-09-01", "end": "2025-09-07", "latest": False}, "rules": None,
                    "favourites": favourites, "upcoming": [], "yourPlayers": mine}
            return 200, {"data": data, "meta": {"generation": "7"}}, {"Cache-Control": "private, max-age=0, must-revalidate"}
        return 404, {"ok": False, "error": {"code": "RESOURCE_NOT_FOUND", "retry": False}}, {}
    return answer


def serve(test, answer):
    """A local HTTP origin answering `answer(path, query)`, closed after the test; its URL."""
    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            url = urllib.parse.urlsplit(self.path)
            status, body, headers = answer(url.path, urllib.parse.parse_qs(url.query))
            data = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            for name, value in headers.items():
                self.send_header(name, value)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, *args):
            pass
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    test.addCleanup(server.server_close)
    test.addCleanup(server.shutdown)
    return f"http://127.0.0.1:{server.server_address[1]}"


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
            if c["tool"] not in ("aws", "docker", "python3", "node", "npm"):
                continue  # the stand-ins' own records (what a task did, a status read, a wait, a state written), gh's reads
            if c["tool"] == "python3" and a[:1] in (["infra/aws/image_identity.py"], ["infra/aws/deploy_state.py"], ["infra/aws/run_lock.py"]):
                continue  # the Deploy's own computations and its local lock: they change nothing (the state's writes are aws s3api calls)
            if c["tool"] == "docker":
                if a[:1] == ["build"] and "--target" not in a:
                    out.append(("docker build", a[a.index("-t") + 1].rsplit(":", 1)[0]))
                elif a[:1] == ["push"]:
                    out.append(("docker push", a[1].rsplit(":", 1)[0]))
                continue
            if c["tool"] == "node" and a[:1] == ["infra/aws/verify-deploy.mjs"]:
                # GH202: the task definitions' revisions are the stand-in's; checked in test_GH202_e.
                out.append(("node", re.sub(r"@arn:aws:ecs:[^,\s]+", "@<task definition>", " ".join(a))))
                continue
            if c["tool"] != "aws":
                out.append((c["tool"], " ".join(a)))
            elif a[:2] == ["cloudformation", "update-stack"]:
                stack = a[a.index("--stack-name") + 1]
                keys = [pair.split(",")[0].split("=", 1)[1] for pair in a[a.index("--parameters") + 1:] if "ParameterValue=" in pair]
                out.append(("update-stack", stack, *keys))
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
                online = ["--online"] if "--overrides" in a and "--online" in a[a.index("--overrides") + 1] else []
                # By its family: the task definition is the worker stack's exact revision (GH157.3), checked in test_deploy_flow.py.
                family = a[a.index("--task-definition") + 1].rsplit("/", 1)[-1].split(":")[0]
                out.append(("ecs run-task", family, *online))
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


# What a Deploy does while the account is off, from production as it is (no Deploy state, the worker stack's template not
# known: FAILURE_MODES_OPTIMISATIONS.md GH157): the image built and pushed before anything stops; the counts saved, then
# both services stopped by the previous template; the candidate's template and image at 0; the migrations; the services
# started; then the rest as before (the edge logs since GH149). A second run of the same commit is online
# (test_deploy_flow.py).
WORKER = ("ImageTag", "TaskImageTag", "DesiredCount", "BackfillDesiredCount", "ArchiveSourcesBucket", "OddsApiKeyParameter", "SecretsRevision",
          "TemplateDigest")
TODAY = [
    ("deploy", "vega-v2-database"),
    ("docker build", f"{ACCOUNT}.dkr.ecr.us-east-2.amazonaws.com/vega-v2-worker"),
    ("docker push", f"{ACCOUNT}.dkr.ecr.us-east-2.amazonaws.com/vega-v2-worker"),
    ("update-stack", "vega-v2-worker", "DesiredCount", "BackfillDesiredCount"),
    ("deploy", "vega-v2-worker", *WORKER),
    ("ecs run-task", "vega-v2-migrate"),
    ("deploy", "vega-v2-worker", *WORKER),
    ("python3", "infra/aws/package_api.py <tmp>/live-package live"),
    ("s3 cp", f"s3://{RELEASES}/releases/v2-live/{hashlib.sha256(b'live').hexdigest()}.zip"),
    ("deploy", "vega-v2-live", "ImageTag", "ReleaseKey", "ApiKeyExpires", "LiveProvider"),
    ("npm", "ci --prefix backend/api"),
    ("python3", "infra/aws/package_api.py <tmp>/api-package"),
    ("s3 cp", f"s3://{RELEASES}/releases/v2-api/{hashlib.sha256(b'api').hexdigest()}.zip"),
    ("deploy", "vega-v2-waf", "SiteKey"),
    ("deploy", "vega-v2-api", "ReleaseKey", "ReadDatabaseUrl", "OpsKey", "MediaBaseUrl", "ReservedConcurrency", "WebAclArn"),
    ("deploy", "vega-v2-edge-logs", "DistributionId"),
    ("deploy", "vega-v2-alerts", "AlertEmail", "AlertEmail2", "WatchWorker", "WatchBackfill", "WatchLive"),
    ("deploy", "vega-v2-alerts-edge", "AlertEmail", "AlertEmail2", "DistributionId", "ApiDomain"),
    # GH202: the deployment as served (the release /api/health names, the services), before step 12.
    ("node", f"infra/aws/verify-deploy.mjs https://d111111abcdef8.cloudfront.net --release {hashlib.sha256(b'api').hexdigest()} "
             "--services vega-v2-worker=1@<task definition>,vega-v2-backfill=0@<task definition>"),
    ("node", f"infra/aws/smoke-public-reads.mjs --release {hashlib.sha256(b'api').hexdigest()}"),
    # FAILURE_MODES_OPTIMISATIONS.md, GH220-s: the check of the home's personal read, through the distribution, last.
    ("node", "infra/aws/smoke-favourites.mjs https://d111111abcdef8.cloudfront.net"),
]

# A second Deploy of the same commit: online (GH157): the tasks' image by the previous template, the online migrate,
# one final update that changes nothing of the services; no build, no stop.
TODAY_AGAIN = [
    ("deploy", "vega-v2-database"),
    ("update-stack", "vega-v2-worker", "TaskImageTag"),
    ("ecs run-task", "vega-v2-migrate", "--online"),
    ("deploy", "vega-v2-worker", *WORKER),
    *TODAY[TODAY.index(("python3", "infra/aws/package_api.py <tmp>/live-package live")):],
]

@unittest.skipUnless(shutil.which("bash") and shutil.which("openssl"), "requires bash and openssl")
class AccountDeployTest(unittest.TestCase):
    def deploy(self, state, actions=False, script=ROOT / "infra/aws/deploy.sh", extra=None):
        tmp = Path(tempfile.mkdtemp(prefix="vega-account-deploy-"))
        self.addCleanup(shutil.rmtree, tmp, True)
        bin_dir = deploy_fakes.install(tmp / "bin")
        state = {**state, "images_dir": str(tmp / "images")}
        (tmp / "state.json").write_text(json.dumps(state))
        env = {"PATH": f"{bin_dir}:/usr/bin:/bin", "HOME": str(tmp), "FAKE_STATE": str(tmp / "state.json"), "FAKE_LOG": str(tmp / "calls.log"),
               "FAKE_PYTHON_REAL": sys.executable, "VEGA_V2_DEPLOY_EXPORT": "1", "IMAGE_TAG": TAG, "RUNNER_TEMP": str(tmp / "runner"),
               "CFN_ROLE": f"arn:aws:iam::{ACCOUNT}:role/vega-v2-cloudformation", "WORKER_DESIRED_COUNT": "1"}
        if actions:
            env["GITHUB_ACTIONS"] = "true"
        env.update(extra or {})
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

    def assert_today(self, run, line, today=TODAY):
        self.assertEqual(run.code, 0, run.log)
        self.assertEqual(run.writes(), today)
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

    def test_w6_the_neon_api_key_is_16_to_512_printable_bytes(self):
        """The preflight's own rule for the Neon key (account.yaml has no pattern for it, NoEcho): 16 to 512 bytes, each a
        printable ASCII character but the space, under LC_ALL=C; checked as a length and a class, which macOS's bash 3.2
        compiles (its regular expressions repeat at most 255 times: {16,512} does not compile there, review of 07 h 09)."""
        for value, accepted in (("k" * 16, True), ("k" * 512, True), ("napi_" + "K9~!" * 70, True),
                                ("k" * 15, False), ("k" * 513, False), ("\u00e9" * 8, False)):
            with self.subTest(bytes=len(value.encode()), accepted=accepted):
                state = prepared(base_state())
                state["params"]["/vega/v2/neon-api-key"] = {"Type": "SecureString", "Value": value}
                run = self.deploy(state)
                if accepted:
                    self.assertEqual(run.code, 0, run.log)
                    self.assertEqual(run.overrides("vega-v2-account")[0]["NeonApiKey"], value)
                else:
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
        # The account is the last stack; the check of the home's personal read (GH220-s) follows it.
        self.assertEqual(order[-4], "vega-v2-account")
        self.assertEqual(order[-1], "node infra/aws/smoke-favourites.mjs https://d111111abcdef8.cloudfront.net")
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
            # GH202 then GH220-s: the deployment as served, then the home's personal read, after the last stack.
            *TODAY[-3:],
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

    # --- the check of the home's personal read after a Deploy (FAILURE_MODES_OPTIMISATIONS.md, GH220.3, GH220-s) -------

    def test_GH220_s_the_last_step_checks_the_home_s_personal_read_through_the_distribution(self):
        run = self.deploy(base_state())
        self.assertEqual(run.code, 0, run.log)
        probes = [c["argv"] for c in run.calls if c["tool"] == "node" and c["argv"][:1] == ["infra/aws/smoke-favourites.mjs"]]
        self.assertEqual(probes, [["infra/aws/smoke-favourites.mjs", "https://d111111abcdef8.cloudfront.net"]])
        self.assertEqual(run.writes()[-1], ("node", "infra/aws/smoke-favourites.mjs https://d111111abcdef8.cloudfront.net"))
        self.assertEqual(run.out.splitlines()[-2:], ["== 12. The home's personal read (a club, a player, both)", "done"])

    def test_GH220_s_the_operator_s_pair_reaches_the_probe(self):
        run = self.deploy(base_state(), extra={"SMOKE_TEAM": "t_aaaaa1", "SMOKE_PLAYER": "p_aaaab1"})
        self.assertEqual(run.code, 0, run.log)
        self.assertEqual([c["argv"] for c in run.calls if c["tool"] == "node" and c["argv"][:1] == ["infra/aws/smoke-favourites.mjs"]], [[
            "infra/aws/smoke-favourites.mjs", "https://d111111abcdef8.cloudfront.net", "--team", "t_aaaaa1", "--player", "p_aaaab1"]])

    def test_GH220_s_the_real_probe_ends_the_deploy(self):
        """deploy.sh's last step run for real (Node.js, infra/aws/smoke-favourites.mjs) against a local read API: well
        answered, `done`; the home unavailable, or the followed club missing: the run stops there (exit 1, no `done`),
        every stack above deployed."""
        require(self, NODE, "node, to run the probe of step 12 (GH220-s)")
        checks = [
            "favourites: following the player of the week of 2025/2026 and the team of his match",
            r"favourites club 200 \d+ ms db \? ms favourites=1 upcoming=0 yourPlayers=0 checked: the club \(strength 1\)",
            r"favourites player 200 \d+ ms db \? ms favourites=1 upcoming=0 yourPlayers=1 checked: a favourite naming the player, his match of the week",
            r"favourites both 200 \d+ ms db \? ms favourites=1 upcoming=0 yourPlayers=1 checked: the club \(strength 1\), a favourite naming the player, his match of the week",
            # The stand-in home names no leader: the visitor's list (GH220.4) is the pick alone.
            r"favourites many not checked \(the home names no other player\)",
        ]
        for scenario, failure in (("well", None), ("home-503", "favourites: FAILED the home of 2025/2026: status 503 DATA_UNAVAILABLE"),
                                  ("no-club", r"favourites club 200 .* FAILED: the club is not among the favourites with strength 1")):
            with self.subTest(scenario):
                origin = serve(self, read_api(scenario))
                state = base_state()
                state["stacks"]["vega-v2-api"]["outputs"]["ApiOrigin"] = origin
                run = self.deploy(state, extra={"FAKE_NODE_REAL": NODE})
                self.assertEqual(run.writes()[:-3], TODAY[:-3], "every stack above the check deployed")
                self.assertTrue(run.writes()[-3][1].startswith(f"infra/aws/verify-deploy.mjs {origin} "), "GH202's checks, before step 12")
                self.assertEqual(run.writes()[-2], TODAY[-2])
                self.assertEqual(run.writes()[-1], ("node", f"infra/aws/smoke-favourites.mjs {origin}"))
                lines = run.out.splitlines()
                step = lines.index("== 12. The home's personal read (a club, a player, both)")
                if failure is None:
                    self.assertEqual(run.code, 0, run.log)
                    self.assertEqual(len(lines), step + 7, run.out)
                    for line, check in zip(lines[step + 1:], checks):
                        self.assertRegex(line, f"^{check}$")
                    self.assertEqual(lines[-1], "done")
                else:
                    self.assertEqual(run.code, 1, run.log)
                    self.assertRegex(run.out, f"(?m)^{failure}$")
                    self.assertNotIn("done", lines)
                for secret in (SMOKE["team"], SMOKE["player"], SMOKE["match"]):
                    self.assertNotIn(secret, run.log)

    # --- the deployment as served (FAILURE_MODES_OPTIMISATIONS.md, GH202-e) ----------------------------------------------

    def test_GH202_e_the_checks_run_before_step_12_and_a_failure_ends_without_done(self):
        run = self.deploy(base_state())
        self.assertEqual(run.code, 0, run.log)
        checks = [c["argv"] for c in run.calls if c["tool"] == "node" and c["argv"][:1] == ["infra/aws/verify-deploy.mjs"]]
        self.assertEqual(len(checks), 1)
        argv = checks[0]
        outputs = run.state["stacks"]["vega-v2-worker"]["outputs"]
        self.assertEqual(argv[argv.index("--services") + 1],
                         f"vega-v2-worker=1@{outputs['WorkerTaskDefinition']},vega-v2-backfill=0@{outputs['BackfillTaskDefinition']}")
        self.assertRegex(outputs["WorkerTaskDefinition"], r"^arn:aws:ecs:us-east-2:\d{12}:task-definition/vega-v2-worker:\d+$")
        lines = run.out.splitlines()
        self.assertLess(lines.index(next(l for l in lines if l.startswith("== 11b."))), lines.index("== 12. The home's personal read (a club, a player, both)"))
        failed = self.deploy(base_state(), extra={"FAKE_NODE_FAIL": "infra/aws/verify-deploy.mjs"})
        self.assertEqual(failed.code, 1, failed.log)
        self.assertNotIn("done", failed.out.splitlines())
        self.assertEqual(failed.writes()[-1], ("node", "infra/aws/smoke-favourites.mjs https://d111111abcdef8.cloudfront.net"), "step 12 still ran")
        self.assertIn("FAILED the checks of step 11b", failed.log)
        # No list of step 11b's own (the visitor's list is the probe's, PR #240): an earlier draft's settings reach nothing.
        mixed = self.deploy(base_state(), extra={"SMOKE_MIX_TEAMS": "t_aaaaa1,t_aaaaa2", "SMOKE_MIX_PLAYERS": "p_aaaab1"})
        self.assertEqual(mixed.code, 0, mixed.log)
        argv = next(c["argv"] for c in mixed.calls if c["tool"] == "node" and c["argv"][:1] == ["infra/aws/verify-deploy.mjs"])
        self.assertEqual(argv[:-1], checks[0][:-1])
        self.assertFalse({"--mix", "--teams", "--players"} & set(argv), argv)
        self.assertEqual([c["argv"] for c in mixed.calls if c["tool"] == "node" and c["argv"][:1] == ["infra/aws/smoke-favourites.mjs"]],
                         [["infra/aws/smoke-favourites.mjs", "https://d111111abcdef8.cloudfront.net"]])

    def test_GH257_the_origin_check_and_favourites_run_even_if_one_fails(self):
        run = self.deploy(base_state(), extra={"FAKE_NODE_FAIL": "infra/aws/smoke-public-reads.mjs"})
        self.assertEqual(run.writes(), TODAY)
        self.assertEqual(run.code, 1, run.log)
        self.assertIn("FAILED the checks of step 11c", run.log)
        self.assertNotIn("done", run.out.splitlines())

    def test_GH257_the_old_deploy_role_stops_before_any_change(self):
        state = base_state()
        state["stacks"]["vega-v2-deploy-roles"]["outputs"]["DeployGrants"] = "1"
        run = self.deploy(state)
        self.assertNotEqual(run.code, 0, run.log)
        self.assertEqual(run.writes(), [])
        self.assertIn("DeployGrants is not 2", run.log)

    def test_w10_a_failed_migration_stops_before_the_account_stack(self):
        state = prepared(base_state())
        state["migrate"] = {"default": 1}
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
        self.assert_today(run, f"account: off ({SWITCH} is off): the account API is not deployed (backend/account/DEPLOYMENT.md, section 3)", TODAY_AGAIN)
        # No Account override: each stack keeps its previous value (true), so nothing is removed.
        for stack in ("vega-v2-database", "vega-v2-worker", "vega-v2-alerts"):
            self.assertEqual(run.state["stacks"][stack]["parameters"].get("Account"), "true", stack)


if __name__ == "__main__":
    unittest.main()
