"""A Deploy end to end: the image before anything stops, migrations while collecting, the image named by its inputs,
the Deploy's own state (FAILURE_MODES_OPTIMISATIONS.md GH157/158, written before these tests).

The real infra/aws/deploy.sh, entered as the Deploy workflow enters it (no export variable: it exports the commit with
`git archive` and runs itself there), on a temporary git repository holding this tree; the real image_identity.py
(BuildKit's context, real Docker) and deploy_state.py; stateful stand-ins of aws and docker (deploy_fakes.py: stacks,
services, ECR, ECS tasks, SSM versions, S3 conditional writes); the migrate task runs the real `python -m vega.migrate`
of the image's own tree on a disposable PostgreSQL 18 (VEGA_V2_DEPLOY_FLOW_TEST_DSN), cloned for each test from a base
migrated with production's tree (e4014803). Evidence: one JSON per Deploy run (the state before and after, the
environment without PATH, the log, every call) in VEGA_DEPLOY_FLOW_EVIDENCE, else <tmp>/vega-deploy-flow/<time>/.
Rerun: PYTHONPATH=backend:backend/tests python3 -m unittest -v test_deploy_flow (DOCKER_CONTEXT=colima on the Mac).
"""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from urllib.parse import urlsplit, urlunsplit

import deploy_fakes
from deploy_repo import ROOT, SOURCE, Repo, git, machine_host
from prerequisites import required

try:
    import psycopg
except ImportError:  # pragma: no cover
    psycopg = None

ACCOUNT = "361769570630"
RELEASES = f"vega-v2-releases-{ACCOUNT}-us-east-2"
PRODUCTION = "e4014803"
ENDPOINT = "vega-football-db-postgres.cabcdefghijk.us-east-2.rds.amazonaws.com"
DSN = os.environ.get("VEGA_V2_DEPLOY_FLOW_TEST_DSN")
DOCKER = shutil.which("docker")
EVIDENCE = Path(os.environ.get("VEGA_DEPLOY_FLOW_EVIDENCE") or Path(tempfile.gettempdir()) / "vega-deploy-flow" / time.strftime("%Y%m%dT%H%M%S"))
# The Deploy's state: one object in the roles stack's bucket, before any other creation (GH157.3).
STATE_BUCKET = f"vega-v2-deploy-state-{ACCOUNT}-us-east-2"
STATE_KEY = "state.json"
# This machine in a workstation run's name, and its short host name alone (another machine's, when this one has an
# identity of its own).
SHORT, HOST = machine_host()


def local(dsn):
    target = urlsplit(dsn or "")
    return target.hostname in ("127.0.0.1", "localhost", "::1") and target.path == "/vega_v2_deploy_flow_test"


def sibling(name):
    return urlunsplit(urlsplit(DSN)._replace(path="/" + name))


def redacted(value):
    """What the evidence keeps of a run: the local base's password is never written (a DSN keeps its other parts)."""
    password = urlsplit(DSN or "").password
    text = json.dumps(value, indent=1, default=str)
    return text.replace(password, "<redacted>") if password else text


def docker_ready():
    return bool(DOCKER) and subprocess.run([DOCKER, "info"], capture_output=True, timeout=60).returncode == 0


READY = psycopg is not None and local(DSN) and docker_ready()


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


class Run:
    def __init__(self, done, calls, state):
        self.code, self.out, self.err, self.calls, self.state = done.returncode, done.stdout, done.stderr, calls, state
        self.log = done.stdout + done.stderr

    def aws(self, service, op):
        return [c["argv"] for c in self.calls if c["tool"] == "aws" and c["argv"][:2] == [service, op]]

    def tasks(self):
        """The migrate tasks the run started: (command, exit)."""
        return [(c["argv"][2:], c.get("exit")) for c in self.calls if c["tool"] == "ecs-task" and c["argv"][0] == "vega-v2-migrate"]

    def index(self, predicate):
        for i, c in enumerate(self.calls):
            if predicate(c):
                return i
        return None

    def worker_changes(self):
        """Every call that changed the worker stack: (index, kind, the parameters it gave)."""
        out = []
        for i, c in enumerate(self.calls):
            a = c["argv"]
            if c["tool"] != "aws" or "--stack-name" not in a or a[a.index("--stack-name") + 1] != "vega-v2-worker":
                continue
            if a[:2] == ["cloudformation", "deploy"]:
                given = {}
                for pair in a[a.index("--parameter-overrides") + 1:]:
                    if pair.startswith("--"):
                        break
                    k, _, v = pair.partition("=")
                    given[k] = v
                out.append((i, "deploy", given))
            elif a[:2] == ["cloudformation", "update-stack"]:
                given = {}
                for pair in a[a.index("--parameters") + 1:]:
                    if pair.startswith("--"):
                        break
                    fields = dict(item.split("=", 1) for item in pair.split(","))
                    if "ParameterValue" in fields:
                        given[fields["ParameterKey"]] = fields["ParameterValue"]
                out.append((i, "update-stack", given))
        return out

    def docker(self, sub):
        return [c for c in self.calls if c["tool"] == "docker" and c["argv"][:1] == [sub]]

    def built(self):
        return [c for c in self.docker("build") if "--target" not in c["argv"]]

    def identity(self):
        m = re.search(r"worker image ([a-f0-9]{64})", self.out)
        return m.group(1) if m else None

    def deploy_state(self):
        obj = self.state["s3"]["buckets"].get(STATE_BUCKET, {}).get(STATE_KEY)
        return json.loads(obj["body"]) if obj else None


@required(READY, "docker with a running daemon, psycopg and VEGA_V2_DEPLOY_FLOW_TEST_DSN (a local vega_v2_deploy_flow_test base)")
class DeployFlowTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp(prefix="vega-deploy-flow-"))
        cls.bin = deploy_fakes.install(cls.tmp / "bin")
        with psycopg.connect(DSN, autocommit=True) as c:
            cls.logins_before = {r for (r,) in c.execute("SELECT rolname FROM pg_roles WHERE rolname LIKE 'vega\\_v2\\_%'").fetchall()}
        # Production's tree (the image in service) and its base: every migration of e4014803 applied.
        cls.production = cls.tmp / "production"
        cls.production.mkdir()
        archive = subprocess.run(["git", "archive", "--format=tar", PRODUCTION, "backend", "infra", "dashboard"], cwd=ROOT, capture_output=True, check=True).stdout
        subprocess.run(["tar", "-xf", "-", "-C", str(cls.production)], input=archive, check=True)
        cls.production_tag = subprocess.run(["git", "rev-parse", PRODUCTION], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
        cls.passwords = {f"/vega/v2/password-{r}": f"{r}PW" + "x" * 30 for r in ("collect", "calc", "read")}
        cls.recreate("vega_v2_deploy_flow_prod")
        env = {"PATH": os.environ.get("PATH", ""), "PYTHONPATH": str(cls.production / "backend"), "V2_MIGRATION_DATABASE_URL": sibling("vega_v2_deploy_flow_prod"),
               **{f"V2_{k.rsplit('-', 1)[1].upper()}_PASSWORD": v for k, v in cls.passwords.items()}}
        done = subprocess.run([sys.executable, "-m", "vega.migrate"], cwd=cls.production / "backend", env=env, capture_output=True, text=True, timeout=600)
        assert done.returncode == 0, done.stderr
        cls.scenarios = 0

    @classmethod
    def tearDownClass(cls):
        with psycopg.connect(sibling("postgres"), autocommit=True) as c:
            for (name,) in c.execute("SELECT datname FROM pg_database WHERE datname LIKE 'vega\\_v2\\_deploy\\_flow\\_s%' OR datname = 'vega_v2_deploy_flow_prod'").fetchall():
                c.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
            for login in sorted({"vega_v2_collect", "vega_v2_calc", "vega_v2_read"} - cls.logins_before):
                c.execute(f'DROP ROLE IF EXISTS "{login}"')
        shutil.rmtree(cls.tmp, ignore_errors=True)

    @staticmethod
    def recreate(name, template=None):
        with psycopg.connect(sibling("postgres"), autocommit=True) as c:
            c.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
            c.execute(f'CREATE DATABASE "{name}"' + (f' TEMPLATE "{template}"' if template else ""))

    # --- the world before a Deploy --------------------------------------------------------------------------------

    def setUp(self):
        type(self).scenarios += 1
        self.db_name = f"vega_v2_deploy_flow_s{self.scenarios:02d}"
        self.recreate(self.db_name, "vega_v2_deploy_flow_prod")
        self.repo = Repo(self.tmp / f"repo-{self.scenarios:02d}")

    def db(self):
        return psycopg.connect(sibling(self.db_name), autocommit=True)

    def applied(self):
        with self.db() as c:
            return {v for (v,) in c.execute("SELECT version FROM ops.schema_migrations").fetchall()}

    def production_state(self):
        """Production as it is before this change: the stacks deploy.sh reads, the worker on the image of e4014803, the
        template of e4014803 (no TemplateDigest), both services running, no Deploy state yet."""
        params = {k: {"Type": "SecureString", "Value": v, "Version": 1} for k, v in self.passwords.items()}
        for role in ("collect", "calc", "read"):
            params[f"/vega/v2/{role}-database-url"] = {"Type": "SecureString", "Version": 1,
                                                       "Value": f"postgresql://vega_v2_{role}:{self.passwords[f'/vega/v2/password-{role}']}@{ENDPOINT}:5432/vega_v2"}
        for name, value in (("/vega/v2/pitchapi-key", "pitch-key"), ("/vega/v2/ops-key", "o" * 64), ("/vega/v2/edge-key", "e" * 64)):
            params[name] = {"Type": "SecureString", "Value": value, "Version": 1}
        old_template = self.production / "infra/aws/worker.yaml"
        keys = deploy_fakes.template_keys(old_template)
        worker_params = {k: "" for k in keys}
        worker_params.update(ImageTag=self.production_tag, DesiredCount="1", BackfillDesiredCount="1", ArchiveSourcesBucket=RELEASES,
                             OddsApiKeyParameter="", Account="false")
        stack = lambda outputs=None, parameters=None: {"status": "UPDATE_COMPLETE", "outputs": outputs or {}, "parameters": parameters or {}}  # noqa: E731
        state = {
            "account": ACCOUNT, "region": "us-east-2", "python": sys.executable, "images_dir": str(self.tmp / f"images-{self.scenarios:02d}"),
            "params": params,
            "stacks": {
                "vega-v2-deploy-roles": stack({"DeployRoleArn": f"arn:aws:iam::{ACCOUNT}:role/vega-v2-deploy", "DeployGrants": "1"}),
                "vega-v2-database": stack({"DatabaseEndpoint": ENDPOINT, "WorkerSecurityGroup": "sg-0worker", "ApiSecurityGroup": "sg-0api"}),
                "vega-v2-worker": {**stack({"RepositoryUri": f"{ACCOUNT}.dkr.ecr.us-east-2.amazonaws.com/vega-v2-worker",
                                            "MigrationTaskDefinition": f"arn:aws:ecs:us-east-2:{ACCOUNT}:task-definition/vega-v2-migrate:1"}, worker_params),
                                   "keys": keys, "template_sha": sha(old_template)},
                "vega-v2-live": stack(),
                "vega-v2-waf": stack({"WebAclArn": f"arn:aws:wafv2:us-east-1:{ACCOUNT}:global/webacl/vega-v2-api/abc"}),
                "vega-v2-api": stack({"ApiOrigin": "https://d111111abcdef8.cloudfront.net", "DistributionId": "E2NNDNWK491L8W"}),
                "vega-v2-alerts": stack(), "vega-v2-alerts-edge": stack(),
            },
            "ecr": {"repository": True, "images": [self.production_tag]},
            "images": {self.production_tag: str(self.production)},
            "s3": {"buckets": {RELEASES: {}, STATE_BUCKET: {}}},
            # Production's migrate task definition: its revision runs production's image.
            "taskdefs": {f"arn:aws:ecs:us-east-2:{ACCOUNT}:task-definition/vega-v2-migrate:1": self.production_tag},
            "migrate": {"dsn": sibling(self.db_name)},
            "faults": {},
        }
        fingerprint = lambda extra: [self.production_tag, ""] + extra + [sha(old_template)]  # noqa: E731
        state["services"] = {
            "worker": {"desired": 1, "revision": 40, "starts": 0, "stops": 0, "replacements": 0, "image": self.production_tag, "timeline": [], "fingerprint": fingerprint([""])},
            "backfill": {"desired": 1, "revision": 30, "starts": 0, "stops": 0, "replacements": 0, "image": self.production_tag, "timeline": [], "fingerprint": fingerprint([])},
        }
        return state

    def deploy(self, state, extra=None, background=False, world=None):
        """One Deploy run. `world`: a state file two runs share (GH157.3), else the run's own copy of `state`."""
        tmp = Path(tempfile.mkdtemp(prefix="run-", dir=self.tmp))
        if world is None:
            (tmp / "state.json").write_text(json.dumps(state))
        env = {"PATH": f"{self.bin}:/usr/bin:/bin:/usr/sbin:/sbin", "HOME": str(tmp), "FAKE_STATE": str(world or tmp / "state.json"),
               "FAKE_LOG": str(tmp / "calls.log"), "FAKE_DOCKER_REAL": DOCKER, "FAKE_PYTHON_REAL": sys.executable, "RUNNER_TEMP": str(tmp / "runner"),
               # As the Deploy workflow sets them (deploy.yml): its worker count's default is keep (GH157-y).
               # VEGA_DEPLOY_FLOW_WORKER_COUNT: the workflow's default before the review (1), to show a test red for its own
               # reason against the product files before it (an older deploy.sh refuses keep).
               "IMAGE_TAG": self.repo.head, "WORKER_DESIRED_COUNT": os.environ.get("VEGA_DEPLOY_FLOW_WORKER_COUNT", "keep"),
               "CFN_ROLE": f"arn:aws:iam::{ACCOUNT}:role/vega-v2-cloudformation",
               "GITHUB_RUN_ID": f"7{self.scenarios:02d}{len(list(self.tmp.glob('run-*'))):03d}", "GITHUB_REPOSITORY": "VegaInteligence/Vega-Sport",
               # Simulated waits are immediate (a stack in progress, a replayed RunTask).
               "CLOSE_PAUSE": "0", "MIGRATE_REPLAY_PAUSE": "0"}
        for key in ("DOCKER_CONTEXT", "DOCKER_HOST"):
            if os.environ.get(key):
                env[key] = os.environ[key]
        # HOME is the run's own: the real Docker keeps its configuration (contexts, the buildx plugin).
        env["DOCKER_CONFIG"] = os.environ.get("DOCKER_CONFIG") or str(Path(os.environ.get("HOME", "/")) / ".docker")
        env.update(extra or {})
        # None removes a variable (a workstation's run has no GITHUB_RUN_ID); FAKE_RUN names the run to the stand-ins.
        env = {k: v for k, v in env.items() if v is not None}
        env.setdefault("FAKE_RUN", env.get("GITHUB_RUN_ID") or f"local-{len(list(self.tmp.glob('run-*')))}")
        command = ["bash", "infra/aws/deploy.sh"]
        if background:
            process = subprocess.Popen(command, cwd=self.repo.path, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, start_new_session=True)
            return process, tmp
        done = subprocess.run(command, cwd=self.repo.path, env=env, capture_output=True, text=True, timeout=900)
        return self.finish(done, tmp, state, env)

    def finish(self, done, tmp, state, env):
        log = (tmp / "calls.log").read_text() if (tmp / "calls.log").exists() else ""
        calls = [json.loads(line) for line in log.splitlines()]
        after = json.loads(Path(env["FAKE_STATE"]).read_text())
        EVIDENCE.mkdir(parents=True, exist_ok=True)
        runs = sorted(EVIDENCE.glob(f"{self.id()}.*.json"))
        (EVIDENCE / f"{self.id()}.{len(runs)}.json").write_text(redacted({
            "test": self.id(), "command": "bash infra/aws/deploy.sh (cwd: a temporary git repository of this tree, commit IMAGE_TAG)",
            "env": {k: v for k, v in env.items() if k != "PATH"}, "state_given": state, "exit_code": done.returncode, "stdout": done.stdout,
            "stderr": done.stderr, "calls": calls, "state_after": after}))
        return Run(done, calls, after)

    def resumed(self, process, tmp, world):
        """A run suspended by `faults.pause`, woken up and waited for (its Run); always called, so that no run is left
        suspended behind a failed assertion."""
        Path(str(world) + ".resume").write_text("")
        out, err = process.communicate(timeout=900)
        return self.finish(subprocess.CompletedProcess(process.args, process.returncode, out, err), tmp, None, {"FAKE_STATE": str(world)})

    @staticmethod
    def change_world(world, change):
        """Changes the shared world as one call of the stand-ins would (under its lock)."""
        with open(str(world) + ".lock", "a") as held:
            fcntl.flock(held, fcntl.LOCK_EX)
            state = json.loads(Path(world).read_text())
            change(state)
            Path(world).write_text(json.dumps(state, indent=1))

    @staticmethod
    def wait_for(log, marker, seconds=300):
        for _ in range(seconds * 10):
            if log.exists() and marker in log.read_text():
                return
            time.sleep(0.1)
        raise AssertionError(f"{marker} never appeared in {log}")

    def deployed(self, state=None, extra=None):
        """A first Deploy of this tree from production (GH157-a's first run): the base state of the other tests."""
        run = self.deploy(state or self.production_state(), extra)
        self.assertEqual(run.code, 0, run.log)
        return run

    def assert_done(self, run):
        self.assertEqual(run.code, 0, run.log)
        self.assertEqual(run.out.rstrip().splitlines()[-1], "done", run.out[-2000:])

    def assert_released(self, run, phase="idle"):
        state = run.deploy_state()
        self.assertIsNotNone(state, "no Deploy state")
        self.assertIsNone(state["owner"], state)
        self.assertEqual(state["phase"], phase, state)

    # --- GH157-a, GH158-f: production, then the same commit ---------------------------------------------------------

    def test_GH157_a_production_then_the_same_commit_again(self):
        run = self.deploy(self.production_state())
        self.assert_done(run)
        image = run.identity()
        self.assertRegex(image or "", r"^[a-f0-9]{64}$", run.out)
        self.assertNotEqual(image, self.repo.head)
        # The image built and pushed before any count of the services changed.
        push = run.index(lambda c: c["tool"] == "docker" and c["argv"][:1] == ["push"])
        changes = run.worker_changes()
        first_stop = next(i for i, kind, given in changes if given.get("DesiredCount") == "0")
        self.assertIsNotNone(push)
        self.assertLess(push, first_stop)
        self.assertEqual(len(run.built()), 1)
        # The template unknown (no TemplateDigest): stopped, the full migrate, one start; 179 applied.
        self.assertEqual(run.tasks(), [([], 0)])
        self.assertIn("179_statement_statistics.sql", self.applied())
        for name in ("worker", "backfill"):
            s = run.state["services"][name]
            self.assertEqual((s["stops"], s["starts"], s["replacements"], s["desired"], s["image"]), (1, 1, 0, 1, image), name)
        worker = run.state["stacks"]["vega-v2-worker"]["parameters"]
        self.assertEqual((worker["ImageTag"], worker["TaskImageTag"], worker["TemplateDigest"], worker["BackfillDesiredCount"]),
                         (image, image, sha(self.repo.path / "infra/aws/worker.yaml"), "1"))
        self.assertRegex(worker["SecretsRevision"], r"^[a-f0-9]{64}$")
        # GH158-f: the live ingestor runs the worker's image, not the commit.
        self.assertEqual(run.state["stacks"]["vega-v2-live"]["parameters"]["ImageTag"], image)
        self.assert_released(run)
        self.assertEqual(run.state.get("resets", []), [], "update-stack reset a parameter it was not given")
        # The same commit again: nothing built, nothing stopped, nothing replaced; the online migrate.
        again = self.deploy(run.state)
        self.assert_done(again)
        self.assertEqual(again.identity(), image)
        self.assertEqual(again.built(), [])
        self.assertEqual(again.docker("push"), [])
        self.assertEqual(again.tasks(), [(["--online"], 0)])
        for name in ("worker", "backfill"):
            s = again.state["services"][name]
            self.assertEqual((s["stops"], s["starts"], s["replacements"]), (1, 1, 0), name)
            self.assertTrue(all(desired == 1 for _, desired, _ in s["timeline"][len(run.state["services"][name]["timeline"]):]), name)
        self.assert_released(again)

    # --- GH157-b: a first install ---------------------------------------------------------------------------------

    def first_install_state(self):
        """Nothing yet: no stack but the roles', no repository, no bucket, no parameter; an empty base."""
        self.recreate(self.db_name)
        state = self.production_state()
        for name in ("vega-v2-database", "vega-v2-worker", "vega-v2-live", "vega-v2-waf", "vega-v2-api", "vega-v2-alerts", "vega-v2-alerts-edge"):
            del state["stacks"][name]
        state["params"] = {}
        state.update(ecr={"repository": False, "images": []}, images={}, s3={"buckets": {STATE_BUCKET: {}}}, services={}, taskdefs={})
        state["created_outputs"] = {
            "vega-v2-database": {"DatabaseEndpoint": ENDPOINT, "WorkerSecurityGroup": "sg-0worker", "ApiSecurityGroup": "sg-0api"},
            "vega-v2-waf": {"WebAclArn": f"arn:aws:wafv2:us-east-1:{ACCOUNT}:global/webacl/vega-v2-api/abc"},
            "vega-v2-api": {"ApiOrigin": "https://d111111abcdef8.cloudfront.net", "DistributionId": "E2NNDNWK491L8W"}}
        return state

    def test_GH157_b_first_install(self):
        state = self.first_install_state()
        run = self.deploy(state, {"PITCHAPI_API_KEY": "pitch-key"})
        self.assert_done(run)
        changes = run.worker_changes()
        self.assertEqual(changes[0][1], "deploy")
        self.assertEqual((changes[0][2]["DesiredCount"], changes[0][2]["BackfillDesiredCount"]), ("0", "0"))
        push = run.index(lambda c: c["tool"] == "docker" and c["argv"][:1] == ["push"])
        self.assertLess(changes[0][0], push, "the repository exists before the push")
        self.assertEqual(run.tasks(), [([], 0)])
        self.assertIn("179_statement_statistics.sql", self.applied())
        worker = run.state["stacks"]["vega-v2-worker"]["parameters"]
        self.assertEqual((worker["DesiredCount"], worker["BackfillDesiredCount"], worker["ImageTag"]), ("1", "0", run.identity()))
        self.assert_released(run)
        self.assertNotIn("/vega/v2/deploy-bootstrap", run.state["params"], "the first install's lock deleted once the state exists")

    # --- GH157-c, d: refusals before anything stops -----------------------------------------------------------------

    def test_GH157_c_refusals_and_expired_sessions_stop_before_anything_stops(self):
        cases = {"DescribeRepositories": {"denied": ["ecr:DescribeRepositories"]}, "DescribeImages": {"denied": ["ecr:DescribeImages"]},
                 "registry token": {"faults": {"login": True}}, "docker login": {"faults": {"docker_login": True}}}
        for name, change in cases.items():
            with self.subTest(name):
                state = self.production_state()
                state.setdefault("denied", []).extend(change.get("denied", []))
                state["faults"].update(change.get("faults", {}))
                run = self.deploy(state)
                self.assertNotEqual(run.code, 0, run.log)
                self.assertNotIn("done", run.out.splitlines())
                self.assertEqual(run.worker_changes(), [], "the worker stack changed")
                self.assertEqual(run.built() if name in ("DescribeRepositories", "DescribeImages") else [], [])
                self.assertEqual(run.docker("push"), [])
                self.assertEqual(run.state["services"]["worker"]["desired"], 1)
                self.assert_released(run)

    def test_GH157_d_the_repository_missing_while_the_stack_exists(self):
        state = self.production_state()
        state["ecr"]["repository"] = False
        run = self.deploy(state)
        self.assertNotEqual(run.code, 0)
        self.assertIn("repository vega-v2-worker", run.log)
        self.assertEqual(run.worker_changes(), [])
        self.assertEqual(run.built(), [])

    # --- GH157-e, f, g: migrations while collecting, or not -----------------------------------------------------------

    def test_GH157_e_a_marked_migration_applies_while_the_worker_runs(self):
        first = self.deployed()
        self.repo.write("backend/sql/180_online_probe.sql", "-- A probe of GH157-e.\n-- vega:online\nCREATE TABLE ops.online_probe (id integer);\n")
        self.repo.commit("a marked migration")
        run = self.deploy(first.state)
        self.assert_done(run)
        self.assertNotEqual(run.identity(), first.identity())
        self.assertEqual(run.tasks(), [(["--online"], 0)])
        self.assertIn("180_online_probe.sql", self.applied())
        # The tasks' image first (the previous template, the services untouched), then one final update.
        kinds = [(kind, given) for _, kind, given in run.worker_changes()]
        self.assertEqual(kinds[0][0], "update-stack")
        self.assertEqual(kinds[0][1], {"TaskImageTag": run.identity()})
        worker = run.state["services"]["worker"]
        before = first.state["services"]["worker"]
        self.assertEqual((worker["stops"], worker["starts"], worker["replacements"]), (before["stops"], before["starts"], before["replacements"] + 1))
        self.assertTrue(all(desired == 1 for _, desired, _ in worker["timeline"][len(before["timeline"]):]))
        self.assertEqual(run.state.get("resets", []), [])

    def test_GH157_f_an_unmarked_migration_stops_the_services_once(self):
        first = self.deployed()
        self.repo.write("backend/sql/180_offline_probe.sql", "-- A probe of GH157-f (not marked).\nCREATE TABLE ops.offline_probe (id integer);\n")
        self.repo.commit("an unmarked migration")
        run = self.deploy(first.state)
        self.assert_done(run)
        self.assertEqual(run.tasks(), [(["--online"], 3), ([], 0)])
        self.assertIn("180_offline_probe.sql", self.applied())
        # The counts saved before the services stopped; the stop by the previous template; the backfill restored.
        saved = run.index(lambda c: c["tool"] == "s3-body" and json.loads(c["body"])["phase"] == "stopped")
        stop = next(i for i, kind, given in run.worker_changes() if given.get("DesiredCount") == "0")
        self.assertEqual(next(kind for i, kind, given in run.worker_changes() if i == stop), "update-stack")
        self.assertIn("deploy: the counts saved (worker 1, backfill 1)", run.out)
        self.assertIsNotNone(saved, "the counts were never saved")
        self.assertLess(saved, stop)
        worker = run.state["stacks"]["vega-v2-worker"]["parameters"]
        self.assertEqual((worker["DesiredCount"], worker["BackfillDesiredCount"]), ("1", "1"))
        for name in ("worker", "backfill"):
            s, b = run.state["services"][name], first.state["services"][name]
            self.assertEqual((s["stops"], s["starts"]), (b["stops"] + 1, b["starts"] + 1), name)
        self.assert_released(run)

    def test_GH157_g_an_older_image_never_runs_on_a_newer_base(self):
        first = self.deployed()
        older = self.repo.head
        self.repo.write("backend/sql/180_online_probe.sql", "-- vega:online\nCREATE TABLE ops.online_probe (id integer);\n")
        self.repo.commit("a marked migration")
        newer = self.deploy(first.state)
        self.assert_done(newer)
        self.repo.checkout(older)
        run = self.deploy(newer.state)
        self.assertNotEqual(run.code, 0)
        self.assertEqual(run.tasks(), [(["--online"], 4)])
        # The task names what the base holds (its log, in CloudWatch); the Deploy says why it stops.
        task = next(c for c in run.calls if c["tool"] == "ecs-task")
        self.assertIn("MIGRATIONS_UNKNOWN", task["output"])
        self.assertIn("180_online_probe.sql", task["output"])
        self.assertIn("the base holds a migration this image does not know", run.log)
        self.assertEqual(run.state["services"]["worker"]["stops"], newer.state["services"]["worker"]["stops"])
        self.assertEqual(run.state["stacks"]["vega-v2-worker"]["parameters"]["ImageTag"], newer.identity())
        self.assert_released(run)

    # --- GH157-h, i: the full migrate fails, then a retry -------------------------------------------------------------

    def test_GH157_h_i_a_failed_full_migrate_keeps_the_services_stopped_until_a_retry_succeeds(self):
        first = self.deployed()
        self.repo.write("backend/sql/180_offline_probe.sql", "CREATE TABLE ops.offline_probe (id integer);\n")
        self.repo.write("backend/sql/181_breaks.sql", "CREATE TABLE ops.half_done (id integer);\nSELECT 1 / 0;\n")
        self.repo.commit("a migration that fails")
        failed = self.deploy(first.state)
        self.assertNotEqual(failed.code, 0)
        self.assertEqual([exit for _, exit in failed.tasks()], [3, 1])
        self.assertIn("180_offline_probe.sql", self.applied())
        self.assertNotIn("181_breaks.sql", self.applied())
        worker = failed.state["services"]["worker"]
        self.assertEqual(worker["desired"], 0, "the services stay stopped")
        self.assertEqual(worker["starts"], first.state["services"]["worker"]["starts"], "no restart of the old image")
        state = failed.deploy_state()
        self.assertEqual((state["owner"], state["phase"], state["unsafe"], state["before"]["worker"], state["before"]["backfill"]),
                         (None, "stopped", True, 1, 1))
        self.assertIn("stay stopped", failed.log)
        # The stack's backfill is 0 now; the retry restores the saved 1 once its migrations succeed.
        self.assertEqual(failed.state["stacks"]["vega-v2-worker"]["parameters"]["BackfillDesiredCount"], "0")
        self.repo.write("backend/sql/181_breaks.sql", "CREATE TABLE ops.half_done (id integer);\n")
        self.repo.commit("the migration corrected")
        retry = self.deploy(failed.state)
        self.assert_done(retry)
        self.assertEqual(retry.tasks(), [([], 0)])
        self.assertIn("181_breaks.sql", self.applied())
        params = retry.state["stacks"]["vega-v2-worker"]["parameters"]
        self.assertEqual((params["DesiredCount"], params["BackfillDesiredCount"], params["ImageTag"]), ("1", "1", retry.identity()))
        self.assert_released(retry)

    def test_GH157_h_a_timed_out_or_silent_full_migrate_is_unsafe(self):
        for fault in ("still running after the waiter's rounds", "no exit code"):
            with self.subTest(fault):
                self.recreate(self.db_name, "vega_v2_deploy_flow_prod")
                first = self.deployed()
                self.repo.write("backend/sql/180_offline_probe.sql", "CREATE TABLE ops.offline_probe (id integer);\n")
                self.repo.commit(f"unmarked ({fault})")
                state = first.state
                extra = {}
                if fault == "no exit code":
                    state["migrate"]["script"] = [3, None]
                else:
                    state["faults"]["migrate_running"] = {"full": 99}
                    extra = {"MIGRATE_WAIT_ROUNDS": "2"}
                run = self.deploy(state, extra)
                self.assertNotEqual(run.code, 0)
                self.assertEqual(run.state["services"]["worker"]["desired"], 0)
                self.assertTrue(run.deploy_state()["unsafe"])
                if extra:
                    self.assertEqual(run.deploy_state()["migrate"]["phase"], "running", "the task kept for the next Deploy")
                self.repo.remove("backend/sql/180_offline_probe.sql")
                self.repo.commit("back")

    # --- GH157-j: known compatible, restored at once ------------------------------------------------------------------

    def test_GH157_j_a_failure_before_the_template_or_image_changed_restores_the_services(self):
        first = self.deployed()
        self.repo.write("backend/sql/180_offline_probe.sql", "CREATE TABLE ops.offline_probe (id integer);\n")
        self.repo.commit("unmarked")
        state = first.state
        state["faults"]["deploy"] = {"vega-v2-worker": "fail"}
        run = self.deploy(state)
        self.assertNotEqual(run.code, 0)
        self.assertNotIn("180_offline_probe.sql", self.applied())
        worker = run.state["services"]["worker"]
        self.assertEqual((worker["desired"], worker["image"]), (1, first.identity()))
        self.assertEqual((worker["stops"], worker["starts"]), (first.state["services"]["worker"]["stops"] + 1, first.state["services"]["worker"]["starts"] + 1))
        self.assertEqual(run.state["stacks"]["vega-v2-worker"]["parameters"]["BackfillDesiredCount"], "1")
        self.assertIn("restoring them", run.log)
        self.assert_released(run)

    # --- GH157-k: the backfill's count ----------------------------------------------------------------------------

    def test_GH157_k_a_backfill_stopped_on_purpose_stays_stopped(self):
        first = self.deployed(extra={"BACKFILL_DESIRED_COUNT": "0"})
        self.assertEqual(first.state["stacks"]["vega-v2-worker"]["parameters"]["BackfillDesiredCount"], "0")
        again = self.deploy(first.state)
        self.assert_done(again)
        self.assertEqual(again.state["stacks"]["vega-v2-worker"]["parameters"]["BackfillDesiredCount"], "0")
        state = self.production_state()
        state["denied"] = ["cloudformation:DescribeStacks:vega-v2-worker"]
        refused = self.deploy(state)
        self.assertNotEqual(refused.code, 0)
        self.assertEqual(refused.worker_changes(), [])
        self.assertIn("vega-v2-worker", refused.log)

    # --- GH157-l, m: the Deploy's state ----------------------------------------------------------------------------

    def held(self, state, owner, age, **fields):
        doc = {"version": 1, "owner": owner, "beat": int(time.time()) - age, "phase": "running", "before": None, "changed": False, "unsafe": False, **fields}
        state["s3"]["buckets"][STATE_BUCKET][STATE_KEY] = {"body": json.dumps(doc), "etag": '"held"'}
        return state

    def test_GH157_l_another_run_holds_the_state(self):
        run = self.deploy(self.held(self.production_state(), "gh-555-1", 300))
        self.assertNotEqual(run.code, 0)
        self.assertIn("another Deploy", run.log)
        self.assertIn("gh-555-1", run.log)
        changed = [c for c in run.calls if c["tool"] == "aws" and c["argv"][:2] in (["cloudformation", "deploy"], ["cloudformation", "update-stack"], ["ssm", "put-parameter"])]
        self.assertEqual(changed, [], "nothing changed")
        self.assertEqual(run.deploy_state()["owner"], "gh-555-1", "the other run's state is kept")

    def test_GH157_l_m_a_killed_run_is_taken_over_and_its_counts_restored(self):
        first = self.deployed()
        state = first.state
        # What a Deploy killed after stopping the services left: the services at 0, the stack at 0, the saved counts.
        for name in ("worker", "backfill"):
            state["services"][name]["desired"] = 0
        state["stacks"]["vega-v2-worker"]["parameters"].update(DesiredCount="0", BackfillDesiredCount="0")
        self.held(state, "gh-666-1", 7200, phase="stopped", before={"worker": 1, "backfill": 1, "image": first.identity()})
        state["github"] = {"666-1": "completed"}
        run = self.deploy(state)
        self.assert_done(run)
        self.assertIn("taking over gh-666-1", run.log)
        params = run.state["stacks"]["vega-v2-worker"]["parameters"]
        self.assertEqual((params["DesiredCount"], params["BackfillDesiredCount"]), ("1", "1"))
        self.assert_released(run)

    def test_GH157_l_a_write_that_finds_the_state_changed_stops(self):
        state = self.production_state()
        state["faults"]["s3_race"] = 1
        run = self.deploy(state)
        self.assertNotEqual(run.code, 0)
        self.assertIn("changed since", run.log)
        self.assertEqual(run.worker_changes(), [])

    def test_GH157_m_sigkill_after_the_stop_then_a_new_deploy(self):
        first = self.deployed()
        self.repo.write("backend/sql/180_offline_probe.sql", "CREATE TABLE ops.offline_probe (id integer);\n")
        self.repo.commit("unmarked")
        state = first.state
        state["faults"]["hang_after_stop"] = 60
        process, tmp = self.deploy(state, background=True)
        log = tmp / "calls.log"
        for _ in range(600):
            if log.exists() and '"hang"' in log.read_text():
                break
            time.sleep(0.2)
        os.killpg(process.pid, signal.SIGKILL)
        process.wait(30)
        process.stdout.close()
        process.stderr.close()
        killed = json.loads((tmp / "state.json").read_text())
        doc = json.loads(killed["s3"]["buckets"][STATE_BUCKET][STATE_KEY]["body"])
        self.assertEqual((doc["phase"], doc["before"]["worker"], doc["before"]["backfill"]), ("stopped", 1, 1))
        self.assertIsNotNone(doc["owner"])
        self.assertEqual(killed["services"]["worker"]["desired"], 0)
        # Two hours later: the run's state is taken over, its counts restored once the migrations succeed.
        doc["beat"] -= 7200
        killed["s3"]["buckets"][STATE_BUCKET][STATE_KEY]["body"] = json.dumps(doc)
        killed["faults"].pop("hang_after_stop")
        # Its GitHub run ended with it (GH157.3: a run is taken over once known finished, never for its age).
        killed["github"] = {doc["owner"][3:]: "completed"}
        run = self.deploy(killed)
        self.assert_done(run)
        self.assertIn("taking over", run.log)
        params = run.state["stacks"]["vega-v2-worker"]["parameters"]
        self.assertEqual((params["DesiredCount"], params["BackfillDesiredCount"]), ("1", "1"))
        self.assertIn("180_offline_probe.sql", self.applied())

    # --- GH157-n: a failure on the online path --------------------------------------------------------------------

    def test_GH157_n_a_failure_on_the_online_path_never_stops_the_services(self):
        first = self.deployed()
        self.repo.write("backend/sql/180_online_breaks.sql", "-- vega:online\nCREATE TABLE ops.online_half (id integer);\nSELECT 1 / 0;\n")
        self.repo.commit("a marked migration that fails")
        run = self.deploy(first.state)
        self.assertNotEqual(run.code, 0)
        self.assertEqual(run.tasks(), [(["--online"], 1)])
        worker = run.state["services"]["worker"]
        self.assertEqual((worker["stops"], worker["desired"]), (first.state["services"]["worker"]["stops"], 1))
        self.assertFalse(run.deploy_state()["unsafe"])
        self.assert_released(run)

    # --- GH157-o, GH157-p: the state taken over while this run is busy --------------------------------------------------

    CHANGES = (["cloudformation", "deploy"], ["cloudformation", "update-stack"], ["ecs", "run-task"], ["ssm", "put-parameter"],
               ["s3", "cp"], ["s3api", "put-object"])

    def changes_after(self, run, index):
        return [c["argv"][:2] for c in run.calls[index + 1:] if c["tool"] == "aws" and c["argv"][:2] in self.CHANGES]

    def test_GH157_o_taken_over_during_the_push_the_run_stops_at_its_next_change(self):
        first = self.deployed()
        self.repo.write("dashboard/frontend/src/services/format.js", (self.repo.path / "dashboard/frontend/src/services/format.js").read_text() + "\n// edit o\n")
        self.repo.commit("a new image")
        state = first.state
        state["faults"]["steal_on_push"] = "gh-999-1"
        run = self.deploy(state)
        self.assertNotEqual(run.code, 0, run.log)
        stolen = run.index(lambda c: c["tool"] == "steal")
        self.assertIsNotNone(stolen, "the state was taken over during the push")
        self.assertEqual(self.changes_after(run, stolen), [], "nothing changed after the takeover")
        self.assertIn("gh-999-1", run.log)
        doc = run.deploy_state()
        self.assertEqual((doc["owner"], doc["phase"]), ("gh-999-1", "running"), "the other run's state, not released")
        self.assertEqual(run.state["services"]["worker"]["desired"], 1)

    def test_GH157_p_taken_over_after_the_stop_then_a_third_deploy_restores(self):
        first = self.deployed()
        self.repo.write("backend/sql/181_offline_probe_p.sql", "CREATE TABLE ops.offline_probe_p (id integer);\n")
        self.repo.commit("unmarked")
        state = first.state
        state["faults"]["steal_after_stop"] = "gh-999-1"
        run = self.deploy(state)
        self.assertNotEqual(run.code, 0, run.log)
        stolen = run.index(lambda c: c["tool"] == "steal")
        self.assertIsNotNone(stolen, "the state was taken over after the stop")
        self.assertEqual(self.changes_after(run, stolen), [], "no candidate template, no migrate, no restore")
        doc = run.deploy_state()
        self.assertEqual((doc["owner"], doc["phase"], doc["before"]["worker"], doc["before"]["backfill"]), ("gh-999-1", "stopped", 1, 1))
        self.assertFalse(doc["changed"] or doc["unsafe"])
        self.assertEqual((run.state["services"]["worker"]["desired"], run.state["services"]["backfill"]["desired"]), (0, 0))
        self.assertNotIn("181_offline_probe_p.sql", self.applied())
        # The second run known dead (its GitHub run completed): a third Deploy takes the state over and restores the counts.
        state = run.state
        state["github"] = {"999-1": "completed"}
        third = self.deploy(state)
        self.assert_done(third)
        self.assertIn("taking over gh-999-1", third.log)
        params = third.state["stacks"]["vega-v2-worker"]["parameters"]
        self.assertEqual((params["DesiredCount"], params["BackfillDesiredCount"]), ("1", "1"))
        self.assertIn("181_offline_probe_p.sql", self.applied())
        self.assert_released(third)

    # --- GH157.3 (reviews of 26 Nov 2026): one authority, takeovers of dead runs only, durable intents, counts ---------

    def changed(self, run):
        """The calls of a run that could change something (a refused one included: it was tried)."""
        return [c["argv"][:2] for c in run.calls if c["tool"] == "aws" and c["argv"][:2] in self.CHANGES + (["ssm", "delete-parameter"],)]

    def state_writes(self, run):
        """The run's writes of the Deploy's state (conditional puts of the state's object)."""
        return [c for c in run.calls if c["tool"] == "aws" and c["argv"][:2] == ["s3api", "put-object"] and STATE_BUCKET in c["argv"]]

    @staticmethod
    def live_deploy(seconds=120, lock_dir="/tmp"):
        """A process holding a workstation run's lock (<lock_dir>/vega-deploy-<token>.lock, as deploy.sh and every command it
        starts do): a run that lives on this machine. The process and the run's token."""
        token = secrets.token_hex(16)
        process = subprocess.Popen([sys.executable, "-c", "import fcntl, sys, time\n"
                                    "f = open(sys.argv[1], 'a')\nfcntl.flock(f, fcntl.LOCK_EX)\nprint('held', flush=True)\n"
                                    "time.sleep(float(sys.argv[2]))\n", f"{lock_dir}/vega-deploy-{token}.lock", str(seconds)],
                                   stdout=subprocess.PIPE, text=True)
        assert process.stdout.readline().strip() == "held"
        return process, token

    def attest(self, world, holder, lock_dir):
        """The owner's `deploy_state.py abandon` of `holder`, from the machine whose lock directory is `lock_dir`."""
        tmp = Path(tempfile.mkdtemp(prefix="attest-", dir=self.tmp))
        env = {"PATH": f"{self.bin}:/usr/bin:/bin:/usr/sbin:/sbin", "HOME": str(tmp), "FAKE_STATE": str(world), "FAKE_LOG": str(tmp / "calls.log"),
               "FAKE_PYTHON_REAL": sys.executable, "DEPLOY_LOCK_DIR": str(lock_dir), "FAKE_RUN": "owner"}
        return subprocess.run([sys.executable, "infra/aws/deploy_state.py", "abandon", "--bucket", STATE_BUCKET, "--holder", holder,
                               "--reason", "test: that machine checked"], cwd=self.repo.path, env=env, capture_output=True, text=True, timeout=60)

    def test_GH157_s_a_missing_bucket_beside_the_worker_is_not_a_first_install(self):
        for case in ("the worker stack exists", "the repository alone exists"):
            with self.subTest(case):
                state = self.production_state()
                del state["s3"]["buckets"][RELEASES]
                if case == "the repository alone exists":
                    del state["stacks"]["vega-v2-worker"]
                run = self.deploy(state)
                self.assertNotEqual(run.code, 0, run.log)
                self.assertIn(f"release bucket {RELEASES} does not exist", run.log)
                self.assertIn("the repository vega-v2-worker" if "repository" in case else "the stack vega-v2-worker", run.log)
                self.assertEqual([c for c in self.changed(run) if c != ["s3api", "put-object"]], [], "nothing changed but the state")

    def test_GH157_t_one_first_install_at_a_time_even_once_its_bucket_exists(self):
        world = self.tmp / f"world-{self.scenarios:02d}.json"
        state = self.first_install_state()
        # A is suspended at its first state write once its worker stack exists (the release bucket with it).
        state["faults"]["pause"] = {"run": "8100", "call": ["s3api", "put-object"], "when_stack": "vega-v2-worker"}
        world.write_text(json.dumps(state))
        a, a_tmp = self.deploy(None, {"PITCHAPI_API_KEY": "pitch-key", "GITHUB_RUN_ID": "8100"}, background=True, world=world)
        try:
            self.wait_for(a_tmp / "calls.log", '"paused"')
            self.assertIn(RELEASES, json.loads(world.read_text())["s3"]["buckets"], "the release bucket exists already")
            b = self.deploy(None, {"PITCHAPI_API_KEY": "pitch-key", "GITHUB_RUN_ID": "8200"}, world=world)
        finally:
            a_run = self.resumed(a, a_tmp, world)
        self.assertNotEqual(b.code, 0, b.log)
        self.assertIn("another Deploy (gh-8100-1) holds the Deploy state", b.log)
        self.assertEqual([c for c in self.changed(b) if c != ["s3api", "put-object"]], [], "B changed nothing")
        self.assert_done(a_run)
        self.assert_released(a_run)

    def test_GH157_u_another_run_is_taken_over_only_once_known_dead(self):
        alive, alive_token = self.live_deploy()
        # A run that ended on this machine: its lock stays, free. A run whose lock is not here: another machine's (of any
        # name and identity), or this one's before a restart or a cleaning of /tmp.
        gone_token, absent_token = secrets.token_hex(16), secrets.token_hex(16)
        gone_lock = Path(f"/tmp/vega-deploy-{gone_token}.lock")
        gone_lock.touch()
        try:
            cases = [("gh-555-1", {"github": {"555-1": "in_progress"}}, False), ("gh-556-1", {"github": {"556-1": "completed"}}, True),
                     ("gh-557-1", {}, False), (f"host:elsewhere:4242:{absent_token}", {}, False),
                     (f"host:{HOST}:{alive.pid}:{alive_token}", {}, False), (f"host:{HOST}:4243:{gone_token}", {}, True),
                     (f"host:{HOST}:4244:{absent_token}", {}, False),
                     # An earlier Deploy's name, without a run token: nothing here can tell whether it lives.
                     (f"host:{HOST}:4245:1764100000", {}, False),
                     ("host:elsewhere:4246:1764100000", {"abandoned": True}, True)]
            if SHORT != HOST:
                # A workstation of this short name that is another machine: its lock is not here.
                cases.append((f"host:{SHORT}:4247:{absent_token}", {}, False))
            for holder, extra, taken in cases:
                with self.subTest(holder=holder, extra=extra):
                    fields = {"abandoned": {"holder": holder, "at": int(time.time()), "reason": "test: its laptop is off", "by": "owner"}} if extra.get("abandoned") else {}
                    state = self.held(self.production_state(), holder, 7200, **fields)
                    state["github"] = extra.get("github", {})
                    run = self.deploy(state)
                    if taken:
                        self.assert_done(run)
                        self.assertIn(f"taking over {holder}", run.log)
                        self.assert_released(run)
                    else:
                        self.assertNotEqual(run.code, 0, run.log)
                        self.assertIn(f"another Deploy ({holder}) holds the Deploy state", run.log)
                        # Only the state's conditional creation was tried (S3 refuses it: the object exists).
                        self.assertEqual([c for c in self.changed(run) if c != ["s3api", "put-object"]], [], "nothing changed")
                        self.assertEqual(run.state["s3"]["buckets"][STATE_BUCKET][STATE_KEY]["etag"], '"held"', "the state not written")
                        self.assertEqual(run.deploy_state()["owner"], holder)
        finally:
            alive.kill()
            alive.wait()
            alive.stdout.close()
            gone_lock.unlink(missing_ok=True)

    def test_GH157_v_a_live_run_is_never_taken_over_a_dead_one_s_operations_are_awaited(self):
        first = self.deployed()
        world = self.tmp / f"world-{self.scenarios:02d}.json"
        state = first.state
        state["faults"]["pause"] = {"run": "laptop-a", "call": ["cloudformation", "deploy"], "stack": "vega-v2-live"}
        world.write_text(json.dumps(state))
        local = {"GITHUB_RUN_ID": None}
        # A, a workstation's run, suspended inside its live stack call; B on the same host.
        a, a_tmp = self.deploy(None, {**local, "FAKE_RUN": "laptop-a"}, background=True, world=world)
        try:
            self.wait_for(a_tmp / "calls.log", '"paused"')
            b = self.deploy(None, {**local, "FAKE_RUN": "laptop-b"}, world=world)
        finally:
            a_run = self.resumed(a, a_tmp, world)
        self.assertNotEqual(b.code, 0, b.log)
        self.assertRegex(b.log, rf"another Deploy \(host:{re.escape(HOST)}:\d+:[0-9a-f]{{32}}\) holds the Deploy state")
        self.assertIn("is alive", b.log)
        # B only tried the state's conditional creation, which S3 refused (the object is A's).
        self.assertEqual([c for c in self.changed(b) if c != ["s3api", "put-object"]], [], "B changed nothing")
        self.assertTrue(all("--if-none-match" in c["argv"] for c in self.state_writes(b)), "no write of B's but that refused creation")
        self.assert_done(a_run)
        # A2 killed while the live stack's update it submitted runs on; a dead first install's creating change set on
        # the account stack (REVIEW_IN_PROGRESS); a manual change set on the read API's stack.
        def dead_run(w):
            w["faults"]["pause"] = {"run": "laptop-a2", "call": ["cloudformation", "deploy"], "stack": "vega-v2-live"}
        self.change_world(world, dead_run)
        Path(str(world) + ".resume").unlink()
        a2, a2_tmp = self.deploy(None, {**local, "FAKE_RUN": "laptop-a2"}, background=True, world=world)
        self.wait_for(a2_tmp / "calls.log", '"paused"')
        os.killpg(a2.pid, signal.SIGKILL)
        a2.wait(30)
        a2.stdout.close()
        a2.stderr.close()
        def left(w):
            w["faults"].pop("pause")
            w["faults"]["in_progress"] = {"vega-v2-live": 2}
            w["stacks"]["vega-v2-account"] = {"status": "REVIEW_IN_PROGRESS", "outputs": {}, "parameters": {}, "region": "us-east-2"}
            w.setdefault("change_sets", {})["us-east-2:vega-v2-api"] = [{"name": "owner-manual-change", "by": "the owner"}]
        self.change_world(world, left)
        b2 = self.deploy(None, {**local, "FAKE_RUN": "laptop-b2"}, world=world)
        self.assert_done(b2)
        self.assertRegex(b2.log, r"taking over host:.*no process of its run lives \(its lock /tmp/vega-deploy-[0-9a-f]{32}\.lock is here and free\)")
        statuses = [c for c in b2.calls if c["tool"] == "cfn-status" and c["argv"] == ["vega-v2-live"]]
        self.assertEqual([c["status"] for c in statuses[:3]], ["UPDATE_IN_PROGRESS", "UPDATE_IN_PROGRESS", "UPDATE_COMPLETE"], "awaited to its end")
        first_change = b2.index(lambda c: c["tool"] == "aws" and c["argv"][:2] in (["cloudformation", "deploy"], ["cloudformation", "update-stack"]))
        self.assertLess(b2.calls.index(statuses[2]), first_change, "before B's first change")
        self.assertEqual(len([c for c in b2.calls if c["tool"] == "cfn-status" and c["argv"] == ["vega-v2-account"]]), 2,
                         "REVIEW_IN_PROGRESS read, not awaited, read again")
        self.assertEqual(b2.state["change_sets"]["us-east-2:vega-v2-api"], [{"name": "owner-manual-change", "by": "the owner"}], "kept")

    def test_GH157_w_a_migrate_task_still_running_is_waited_for_by_the_next_deploy(self):
        first = self.deployed()
        self.repo.write("backend/sql/180_offline_probe.sql", "CREATE TABLE ops.offline_probe (id integer);\n")
        self.repo.commit("unmarked")
        state = first.state
        state["faults"]["migrate_running"] = {"full": 3}
        run = self.deploy(state, {"MIGRATE_WAIT_ROUNDS": "1"})
        self.assertNotEqual(run.code, 0, run.log)
        self.assertIn("still runs after 1 rounds", run.log)
        doc = run.deploy_state()
        self.assertRegex(doc["migrate"]["token"], r"^vm-[0-9]+-[0-9]+$")
        self.assertLessEqual(len(doc["migrate"]["token"]), 36, "ECS's startedBy")
        self.assertTrue(doc["migrate"]["arn"].startswith("arn:aws:ecs:"))
        self.assertRegex(doc["migrate"]["taskdef"], r"task-definition/vega-v2-migrate:\d+$", "the exact revision")
        self.assertEqual((doc["migrate"]["phase"], doc["unsafe"], doc["phase"]), ("running", True, "stopped"))
        self.assertEqual(run.state["services"]["worker"]["desired"], 0)
        first_task = doc["migrate"]["arn"]
        state = run.state
        state["faults"].pop("migrate_running")
        retry = self.deploy(state)
        self.assert_done(retry)
        self.assertIn(f"the migrate task {doc['migrate']['token']} an earlier run asked for", retry.log)
        self.assertIn("it stopped (exit 0)", retry.log)
        self.assertEqual(retry.state.get("overlaps", []), [], "never two migrate tasks at once")
        stopped = retry.index(lambda c: c["tool"] == "ecs-wait" and first_task in c["argv"] and c.get("result") == "stopped")
        own = retry.index(lambda c: c["tool"] == "ecs-task" and c["argv"][0] == "vega-v2-migrate")
        start = retry.index(lambda c: c["tool"] == "aws" and c["argv"][:2] == ["cloudformation", "deploy"] and "DesiredCount=1" in c["argv"])
        self.assertIsNotNone(stopped)
        self.assertLess(stopped, own, "its own migrate after the earlier one stopped")
        self.assertLess(own, start, "the services after the migrations")
        self.assertIsNone(retry.deploy_state()["migrate"])

    def migrate_tasks(self, run):
        return [c for c in run.calls if c["tool"] == "ecs-task" and c["argv"][0] == "vega-v2-migrate"]

    def test_GH157_x_runtask_refused_lost_unknown_missing_and_past_its_window(self):
        first = self.deployed()
        self.repo.write("backend/sql/180_offline_probe.sql", "CREATE TABLE ops.offline_probe (id integer);\n")
        self.repo.commit("unmarked")
        with self.subTest("refused: no task, the intent cleared, the next run migrates"):
            state = json.loads(json.dumps(first.state))
            state["faults"]["runtask"] = ["ok", "refused"]
            refused = self.deploy(state)
            self.assertNotEqual(refused.code, 0)
            self.assertIn("RunTask refused the migrate task (RESOURCE:MEMORY)", refused.log)
            self.assertIsNone(refused.deploy_state()["migrate"])
            self.assertEqual(refused.state["services"]["worker"]["desired"], 0)
            again = self.deploy(refused.state)
            self.assert_done(again)
            self.assertIn("180_offline_probe.sql", self.applied())
        self.recreate(self.db_name, "vega_v2_deploy_flow_prod")
        with self.subTest("answer lost after ECS created it, then an empty first list: the same task, once"):
            first2 = self.deployed()
            # A new unmarked migration, so that the full migrate is asked for (the one first2 applied is done).
            self.repo.write("backend/sql/181_offline_probe_x.sql", "CREATE TABLE ops.offline_probe_x (id integer);\n")
            self.repo.commit("another unmarked migration")
            state = first2.state
            state["faults"]["runtask"] = ["ok", "lost", "lost", "lost"]
            lost = self.deploy(state)
            self.assertNotEqual(lost.code, 0)
            doc = lost.deploy_state()
            self.assertEqual((doc["migrate"]["phase"], doc["migrate"].get("arn")), ("asked", None), lost.log)
            asked = doc["migrate"]["token"]
            self.assertEqual(len([t for t in self.migrate_tasks(lost) if t.get("startedBy") == asked]), 1, "one task created, its answer lost thrice")
            state = lost.state
            state["faults"]["list_lag"] = 1
            state["faults"].pop("runtask", None)
            resumed = self.deploy(state)
            self.assert_done(resumed)
            self.assertIn(f"replayed with the same token ({asked})", resumed.log)
            self.assertEqual([c["arn"] for c in resumed.calls if c["tool"] == "ecs-task-again"], [doc_arn for doc_arn in
                             [a for a, t in lost.state["tasks"].items() if t.get("startedBy") == asked]], "ECS answered the task it had")
            tokens = [t for t in resumed.state["tasks"].values() if t.get("startedBy") == asked]
            self.assertEqual(len(tokens), 1, "never a second task for that token")
            self.assertEqual(resumed.state.get("overlaps", []), [])
            starts = [i for i, c in enumerate(resumed.calls) if c["tool"] == "aws" and c["argv"][:2] == ["cloudformation", "deploy"] and "DesiredCount=1" in c["argv"]]
            again = resumed.index(lambda c: c["tool"] == "ecs-task-again")
            self.assertTrue(starts and again < starts[0], "no service started before the task was resolved")
        self.recreate(self.db_name, "vega_v2_deploy_flow_prod")
        with self.subTest("an ARN that ECS answers MISSING, no task running: outcome unknown, own migrations first"):
            first3 = self.deployed()
            state = first3.state
            arn = f"arn:aws:ecs:us-east-2:{ACCOUNT}:task/vega-v2/0999"
            state.setdefault("tasks", {})[arn] = {"family": "vega-v2-migrate", "image": first3.identity(), "command": [], "exit": None,
                                                 "stopCode": "EssentialContainerExited", "startedBy": "vm-1764000000-1", "clientToken": "vm-1764000000-1",
                                                 "rounds": 0, "lastStatus": "STOPPED", "missing": True}
            doc = {"version": 1, "owner": None, "beat": int(time.time()) - 86400, "phase": "stopped", "unsafe": True, "changed": True,
                   "before": {"worker": 1, "backfill": 1, "image": first3.identity(), "digest": ""},
                   "migrate": {"token": "vm-1764000000-1", "phase": "running", "arn": arn, "taskdef": "x", "command": "full", "asked": int(time.time()) - 86400}}
            for name in ("worker", "backfill"):
                state["services"][name]["desired"] = 0
            state["stacks"]["vega-v2-worker"]["parameters"].update(DesiredCount="0", BackfillDesiredCount="0")
            state["s3"]["buckets"][STATE_BUCKET][STATE_KEY] = {"body": json.dumps(doc), "etag": '"a-day-old"'}
            missing = self.deploy(state)
            self.assert_done(missing)
            self.assertIn("ECS no longer knows it (MISSING", missing.log)
            own = missing.index(lambda c: c["tool"] == "ecs-task" and c["argv"][0] == "vega-v2-migrate")
            start = missing.index(lambda c: c["tool"] == "aws" and c["argv"][:2] == ["cloudformation", "deploy"] and "DesiredCount=1" in c["argv"])
            self.assertLess(own, start, "its own migrations before the services")
        with self.subTest("past the replay window and not found: suspended, then resolved by the owner"):
            state = json.loads(json.dumps(missing.state))
            doc = {"version": 1, "owner": None, "beat": int(time.time()) - 86400, "phase": "running", "unsafe": False, "changed": False, "before": None,
                   "migrate": {"token": "vm-1764000000-2", "phase": "asked", "taskdef": f"arn:aws:ecs:us-east-2:{ACCOUNT}:task-definition/vega-v2-migrate:1",
                               "command": "--online", "asked": int(time.time()) - 7200}}
            state["s3"]["buckets"][STATE_BUCKET][STATE_KEY] = {"body": json.dumps(doc), "etag": '"old-intent"'}
            suspended = self.deploy(state)
            self.assertNotEqual(suspended.code, 0)
            self.assertRegex(suspended.log, r"resolve-migrate --bucket \S+ --token vm-1764000000-2")
            self.assertEqual([c for c in self.changed(suspended) if c != ["s3api", "put-object"]], [], "nothing changed")
            self.assertEqual([t for t in suspended.state.get("tasks", {}).values() if t.get("startedBy") == "vm-1764000000-2"], [], "no replay past the window")
            # The owner checked ECS (no task under that token) and says so.
            bucket = suspended.state["s3"]["buckets"][STATE_BUCKET][STATE_KEY]
            held = json.loads(bucket["body"])
            held["migrate"] = None
            held["resolved"] = {"token": "vm-1764000000-2", "at": int(time.time()), "reason": "test: none under that token", "arn": None}
            bucket["body"] = json.dumps(held)
            resolved = self.deploy(suspended.state)
            self.assert_done(resolved)

    def test_GH157_y_the_counts_a_deploy_saved_or_was_given(self):
        first = self.deployed()
        image = first.identity()
        digest = first.state["stacks"]["vega-v2-worker"]["parameters"]["TemplateDigest"]
        def stopped(worker, backfill):
            state = json.loads(json.dumps(first.state))
            for name in ("worker", "backfill"):
                state["services"][name]["desired"] = 0
            state["stacks"]["vega-v2-worker"]["parameters"].update(DesiredCount="0", BackfillDesiredCount="0")
            doc = {"version": 1, "owner": None, "beat": int(time.time()) - 600, "phase": "stopped",
                   "before": {"worker": worker, "backfill": backfill, "image": image, "digest": digest}, "changed": False, "unsafe": False, "migrate": None}
            state["s3"]["buckets"][STATE_BUCKET][STATE_KEY] = {"body": json.dumps(doc), "etag": '"saved"'}
            return state
        cases = [("saved 0 / 1, kept", stopped(0, 1), {}, ("0", "1")), ("saved 1 / 0, kept", stopped(1, 0), {}, ("1", "0")),
                 ("saved 1 / 1, the worker given 0", stopped(1, 1), {"WORKER_DESIRED_COUNT": "0"}, ("0", "1")),
                 ("saved 0 / 0, the worker given 1", stopped(0, 0), {"WORKER_DESIRED_COUNT": "1"}, ("1", "0"))]
        at_zero = json.loads(json.dumps(first.state))
        at_zero["stacks"]["vega-v2-worker"]["parameters"]["DesiredCount"] = "0"
        at_zero["services"]["worker"]["desired"] = 0
        cases.append(("an existing install's 0, kept", at_zero, {}, ("0", "1")))
        for name, state, extra, expected in cases:
            with self.subTest(name):
                run = self.deploy(state, extra)
                self.assert_done(run)
                params = run.state["stacks"]["vega-v2-worker"]["parameters"]
                self.assertEqual((params["DesiredCount"], params["BackfillDesiredCount"]), expected)
        bad = self.deploy(first.state, {"WORKER_DESIRED_COUNT": "2"})
        self.assertNotEqual(bad.code, 0)
        self.assertIn("WORKER_DESIRED_COUNT is 0, 1 or keep", bad.log)

    def test_GH157_y_u_the_workflow_keeps_by_default_and_may_ask_github(self):
        workflow = (SOURCE / ".github/workflows/deploy.yml").read_text()
        block = re.search(r"\n      worker_desired_count:\n((?:        .*\n)+)", workflow)[1]
        self.assertIn("options: ['keep', '1', '0']", block)
        self.assertIn("default: 'keep'", block)
        self.assertIn("WORKER_DESIRED_COUNT: ${{ inputs.worker_desired_count }}", workflow, "passed as chosen: 0 stays 0")
        self.assertRegex(workflow, r"\npermissions:\n(?:  .*\n)*  actions: read\n", "the run may ask GitHub whether another run ended")
        self.assertIn("GH_TOKEN: ${{ github.token }}", workflow)
        self.assertNotIn("DEPLOY_TAKEOVER", workflow)

    def test_GH157_z_a_first_install_failing_at_its_image_keeps_its_target(self):
        state = self.first_install_state()
        state["faults"]["build_fail"] = True
        failed = self.deploy(state, {"PITCHAPI_API_KEY": "pitch-key"})
        self.assertNotEqual(failed.code, 0, failed.log)
        doc = failed.deploy_state()
        self.assertEqual((doc["phase"], doc["before"]["worker"], doc["before"]["backfill"]), ("stopped", 1, 0), "the target saved")
        target = failed.index(lambda c: c["tool"] == "s3-body" and c["argv"] == [STATE_BUCKET, STATE_KEY]
                              and (json.loads(c["body"]).get("before") or {}).get("worker") == 1)
        created = failed.index(lambda c: c["tool"] == "aws" and c["argv"][:2] == ["cloudformation", "deploy"] and "vega-v2-worker" in c["argv"])
        self.assertIsNotNone(target, "the target written in the state")
        self.assertLess(target, created, "saved before the worker stack is created")
        self.assertEqual(failed.state["stacks"]["vega-v2-worker"]["parameters"]["DesiredCount"], "0")
        state = failed.state
        state["faults"].pop("build_fail")
        retry = self.deploy(state, {"PITCHAPI_API_KEY": "pitch-key"})
        self.assert_done(retry)
        params = retry.state["stacks"]["vega-v2-worker"]["parameters"]
        self.assertEqual((params["DesiredCount"], params["BackfillDesiredCount"]), ("1", "0"))

    def test_GH157_aa_a_candidate_applied_with_its_answer_lost_keeps_the_services_stopped(self):
        first = self.deployed()
        self.repo.write("backend/vega/__init__.py", (self.repo.path / "backend/vega/__init__.py").read_text() + "\n# aa\n")
        self.repo.write("backend/sql/180_offline_probe.sql", "CREATE TABLE ops.offline_probe (id integer);\n")
        self.repo.commit("a new image and an unmarked migration")
        state = first.state
        state["faults"]["deploy"] = {"vega-v2-worker": "applied-lost"}
        lost = self.deploy(state)
        self.assertNotEqual(lost.code, 0, lost.log)
        self.assertIn("applied-lost", [c["tool"] for c in lost.calls])
        worker = lost.state["services"]["worker"]
        self.assertEqual(worker["desired"], 0, "not started on the candidate before its migrations")
        self.assertEqual(lost.state["stacks"]["vega-v2-worker"]["parameters"]["ImageTag"], lost.identity(), "the candidate applied")
        self.assertNotIn("restoring them", lost.log)
        self.assertEqual(self.migrate_tasks(lost)[-1]["argv"][2:], ["--online"], "the full migrate never ran")
        doc = lost.deploy_state()
        self.assertEqual((doc["phase"], doc["changed"], doc["before"]["worker"]), ("stopped", True, 1))
        state = lost.state
        retry = self.deploy(state)
        self.assert_done(retry)
        self.assertIn("180_offline_probe.sql", self.applied())
        own = retry.index(lambda c: c["tool"] == "ecs-task" and c["argv"][0] == "vega-v2-migrate" and c["argv"][2:] == [])
        start = retry.index(lambda c: c["tool"] == "aws" and c["argv"][:2] == ["cloudformation", "deploy"] and "DesiredCount=1" in c["argv"])
        self.assertLess(own, start)

    @staticmethod
    def lock_free(path, seconds=60):
        """Whether a run's lock (its file, held by any process of that run) is free within `seconds`."""
        import fcntl
        for _ in range(seconds * 10):
            if not Path(path).exists():
                return True
            with open(path, "a") as f:
                try:
                    fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    fcntl.flock(f, fcntl.LOCK_UN)
                    return True
                except OSError:
                    pass
            time.sleep(0.1)
        return False

    def test_GH157_ad_a_shell_killed_alone_leaves_its_command_holding_the_run(self):
        first = self.deployed()
        world = self.tmp / f"world-{self.scenarios:02d}.json"
        state = first.state
        state["faults"]["pause"] = {"run": "laptop-c", "call": ["cloudformation", "deploy"], "stack": "vega-v2-live"}
        world.write_text(json.dumps(state))
        local = {"GITHUB_RUN_ID": None}
        a, a_tmp = self.deploy(None, {**local, "FAKE_RUN": "laptop-c"}, background=True, world=world)
        try:
            self.wait_for(a_tmp / "calls.log", '"paused"')
            holder = json.loads(json.loads(world.read_text())["s3"]["buckets"][STATE_BUCKET][STATE_KEY]["body"])["owner"]
            _, _, pid, token = holder.split(":")
            # The run's shell alone: its aws cloudformation deploy (the stand-in, suspended in its call) lives on.
            os.kill(int(pid), signal.SIGKILL)
            time.sleep(0.5)
            b = self.deploy(None, {**local, "FAKE_RUN": "laptop-d"}, world=world)
        finally:
            a_run = self.resumed(a, a_tmp, world)
        self.assertNotEqual(b.code, 0, b.log)
        self.assertIn(f"another Deploy ({holder}) holds the Deploy state", b.log)
        self.assertIn("is alive on this machine", b.log)
        self.assertEqual([c for c in self.changed(b) if c != ["s3api", "put-object"]], [], "B changed nothing")
        # Once the command has ended, the run is dead: taken over.
        self.assertTrue(self.lock_free(f"/tmp/vega-deploy-{token}.lock"), "the command ended")
        c = self.deploy(None, {**local, "FAKE_RUN": "laptop-e"}, world=world)
        self.assert_done(c)
        self.assertIn(f"taking over {holder}", c.log)
        self.assertIn("no process of its run lives (its lock", c.log)
        del a_run

    def test_GH157_ae_a_replay_s_refusal_or_a_recent_missing_settles_nothing(self):
        first = self.deployed()
        self.repo.write("backend/sql/180_offline_probe.sql", "CREATE TABLE ops.offline_probe (id integer);\n")
        self.repo.commit("unmarked")
        with self.subTest("the first answer lost, the replays refused by IAM, the list empty"):
            state = first.state
            state["faults"]["runtask"] = ["ok", "lost", "denied", "denied"]
            denied = self.deploy(state)
            self.assertNotEqual(denied.code, 0, denied.log)
            doc = denied.deploy_state()
            self.assertIsNotNone(doc["migrate"], "the intent stays: a replay's refusal proves nothing of the first request")
            token = doc["migrate"]["token"]
            self.assertEqual(doc["migrate"]["phase"], "asked")
            self.assertEqual(denied.state["services"]["worker"]["desired"], 0)
            # RunTask sent once per invocation of the CLI (counter-review of 06 h 28): its own retries would hide the
            # first request's lost answer behind the refusal of the next; only that call is so bounded.
            calls = [c for c in denied.calls if c["tool"] == "aws"]
            runs = [c for c in calls if c["argv"][:2] == ["ecs", "run-task"]]
            self.assertTrue(runs and all(c.get("max_attempts") == "1" for c in runs), runs)
            self.assertEqual([c["argv"][:2] for c in calls if "max_attempts" in c and c["argv"][:2] != ["ecs", "run-task"]], [])
            self.assertEqual([c for c in denied.calls if c["tool"] == "ecs-cli-retry"], [])
            state = denied.state
            state["faults"]["list_lag"] = 1
            state["faults"]["runtask"] = ["denied"]
            again = self.deploy(state)
            self.assertNotEqual(again.code, 0, again.log)
            self.assertEqual(again.deploy_state()["migrate"]["token"], token, "the same intent, still unknown")
            self.assertEqual(again.state["services"]["worker"]["desired"], 0, "the services stay stopped")
            state = again.state
            state["faults"].pop("runtask", None)
            rights = self.deploy(state)
            self.assert_done(rights)
            self.assertEqual(len([t for t in rights.state["tasks"].values() if t.get("startedBy") == token]), 1, "one task for that intent")
            self.assertEqual(rights.state.get("overlaps", []), [])
            settled = rights.index(lambda c: c["tool"] == "ecs-wait" and c.get("result") == "stopped")
            start = rights.index(lambda c: c["tool"] == "aws" and c["argv"][:2] == ["cloudformation", "deploy"] and "DesiredCount=1" in c["argv"])
            self.assertLess(settled, start)
        self.recreate(self.db_name, "vega_v2_deploy_flow_prod")
        with self.subTest("an ARN DescribeTasks answers MISSING for a while after its asking"):
            fresh = self.deployed()
            self.repo.write("backend/sql/181_offline_probe_ae.sql", "CREATE TABLE ops.offline_probe_ae (id integer);\n")
            self.repo.commit("another unmarked migration")
            state = fresh.state
            state["faults"]["fresh_missing"] = 2
            late = self.deploy(state)
            self.assert_done(late)
            self.assertEqual(len([c for c in late.calls if c["tool"] == "ecs-missing-fresh"]) >= 2, True, "MISSING read, then the task")
            self.assertEqual(late.state.get("overlaps", []), [])
            self.assertIn("181_offline_probe_ae.sql", self.applied())

    def test_GH157_af_a_workstation_without_identity_never_names_a_host(self):
        local = {"GITHUB_RUN_ID": None, "FAKE_RUN": "laptop-f"}
        with self.subTest("a workstation's Deploy on a machine with no identity of its own"):
            state = self.production_state()
            state["faults"]["no_machine_identity"] = True
            run = self.deploy(state, local)
            self.assertNotEqual(run.code, 0, run.log)
            self.assertIn("this machine has no identity of its own", run.log)
            self.assertIn("deploy from GitHub Actions", run.log)
            self.assertEqual(self.changed(run), [], "nothing tried, the state's creation included")
            self.assertNotIn(STATE_KEY, run.state["s3"]["buckets"][STATE_BUCKET])
        gone = subprocess.Popen(["sleep", "0"])
        gone.wait()
        with self.subTest("a GitHub run there, a workstation's run in the state under this machine's short name"):
            state = self.held(self.production_state(), f"host:{SHORT}:{gone.pid}:1764100000", 7200)
            state["faults"]["no_machine_identity"] = True
            run = self.deploy(state)
            self.assertNotEqual(run.code, 0, run.log)
            self.assertIn("which this run cannot check", run.log)
            self.assertEqual([c for c in self.changed(run) if c != ["s3api", "put-object"]], [], "nothing changed")
        with self.subTest("a GitHub run there, the state free"):
            state = self.production_state()
            state["faults"]["no_machine_identity"] = True
            run = self.deploy(state)
            self.assert_done(run)
            self.assert_released(run)

    def test_GH157_ag_two_file_spaces_one_machine_identity(self):
        """Two machines of one name and one identity (a clone), each its own lock directory (DEPLOY_LOCK_DIR): a run's
        lock found here and free proves it dead; held, it lives; absent (on the other machine, or here before a restart),
        nothing is proved: only the owner's attestation lets the next Deploy take over, never above a lock still held."""
        first = self.deployed()
        world = self.tmp / f"world-{self.scenarios:02d}.json"
        one, two = (Path(tempfile.mkdtemp(prefix=f"space-{n}-", dir=self.tmp)) for n in ("one", "two"))
        state = first.state
        state["faults"]["pause"] = {"run": "clone-a", "call": ["cloudformation", "deploy"], "stack": "vega-v2-live"}
        world.write_text(json.dumps(state))
        local = {"GITHUB_RUN_ID": None}
        a, a_tmp = self.deploy(None, {**local, "FAKE_RUN": "clone-a", "DEPLOY_LOCK_DIR": str(one)}, background=True, world=world)
        try:
            self.wait_for(a_tmp / "calls.log", '"paused"')
            holder = json.loads(json.loads(world.read_text())["s3"]["buckets"][STATE_BUCKET][STATE_KEY]["body"])["owner"]
            self.assertRegex(holder, rf"^host:{re.escape(HOST)}:\d+:[0-9a-f]{{32}}$")
            lock = one / f"vega-deploy-{holder.rsplit(':', 1)[1]}.lock"
            self.assertTrue(lock.exists(), "its lock in machine one's directory")
            elsewhere = self.deploy(None, {**local, "FAKE_RUN": "clone-b", "DEPLOY_LOCK_DIR": str(two)}, world=world)
            here = self.deploy(None, {**local, "FAKE_RUN": "clone-c", "DEPLOY_LOCK_DIR": str(one)}, world=world)
            over_held = self.attest(world, holder, one)
        finally:
            os.killpg(a.pid, signal.SIGKILL)  # the whole run on machine one: its shell and its aws
            a.wait(30)
            a.stdout.close()
            a.stderr.close()
        for run in (elsewhere, here):
            self.assertNotEqual(run.code, 0, run.log)
            self.assertEqual([c for c in self.changed(run) if c != ["s3api", "put-object"]], [], "nothing changed")
        self.assertIn(f"another Deploy ({holder}) holds the Deploy state", elsewhere.log)
        self.assertIn("is not in this machine's lock directory", elsewhere.log)
        self.assertIn("nothing here proves it dead", elsewhere.log)
        self.assertIn("is alive on this machine", here.log)
        self.assertNotEqual(over_held.returncode, 0, over_held.stderr)
        self.assertIn(f"its lock {lock} is held", over_held.stderr)
        self.assertNotIn("abandoned", json.loads(json.loads(world.read_text())["s3"]["buckets"][STATE_BUCKET][STATE_KEY]["body"]))
        # A dead: from machine two still nothing proves it; from machine one its lock is free: taken over.
        still = self.deploy(None, {**local, "FAKE_RUN": "clone-b2", "DEPLOY_LOCK_DIR": str(two)}, world=world)
        self.assertNotEqual(still.code, 0, still.log)
        self.assertIn("nothing here proves it dead", still.log)
        taken = self.deploy(None, {**local, "FAKE_RUN": "clone-c2", "DEPLOY_LOCK_DIR": str(one)}, world=world)
        self.assert_done(taken)
        self.assertIn(f"taking over {holder} (no process of its run lives (its lock {lock} is here and free)", taken.log)
        # A run of this machine before a restart (its lock gone with /tmp): the owner's attestation, then taken over.
        restarted = f"host:{HOST}:4248:{secrets.token_hex(16)}"
        self.change_world(world, lambda w: w["s3"]["buckets"][STATE_BUCKET].update({STATE_KEY: {"body": json.dumps(
            {"version": 1, "owner": restarted, "beat": int(time.time()) - 600, "phase": "running", "before": None, "changed": False,
             "unsafe": False, "migrate": None}), "etag": '"held"'}}))
        refused = self.deploy(None, {**local, "FAKE_RUN": "clone-c3", "DEPLOY_LOCK_DIR": str(one)}, world=world)
        self.assertNotEqual(refused.code, 0, refused.log)
        self.assertIn("nothing here proves it dead", refused.log)
        attested = self.attest(world, restarted, one)
        self.assertEqual(attested.returncode, 0, attested.stderr)
        after = self.deploy(None, {**local, "FAKE_RUN": "clone-c4", "DEPLOY_LOCK_DIR": str(one)}, world=world)
        self.assert_done(after)
        self.assertIn(f"taking over {restarted} (the owner attested it dead", after.log)
        # The owner's attestation from machine two over a run that lives on machine one: written (nothing on machine two
        # shows that lock), but it never stands over a lock still held: machine one's Deploy refuses; A2 dead, taken over.
        self.change_world(world, lambda w: w["faults"].update(pause={"run": "clone-a2", "call": ["cloudformation", "deploy"], "stack": "vega-v2-live"}))
        a2, a2_tmp = self.deploy(None, {**local, "FAKE_RUN": "clone-a2", "DEPLOY_LOCK_DIR": str(one)}, background=True, world=world)
        try:
            self.wait_for(a2_tmp / "calls.log", '"paused"')
            holder2 = json.loads(json.loads(world.read_text())["s3"]["buckets"][STATE_BUCKET][STATE_KEY]["body"])["owner"]
            lock2 = one / f"vega-deploy-{holder2.rsplit(':', 1)[1]}.lock"
            attested_elsewhere = self.attest(world, holder2, two)
            over_lock = self.deploy(None, {**local, "FAKE_RUN": "clone-c5", "DEPLOY_LOCK_DIR": str(one)}, world=world)
        finally:
            os.killpg(a2.pid, signal.SIGKILL)
            a2.wait(30)
            a2.stdout.close()
            a2.stderr.close()
        self.assertEqual(attested_elsewhere.returncode, 0, attested_elsewhere.stderr)
        self.assertNotEqual(over_lock.code, 0, over_lock.log)
        self.assertIn(f"its lock {lock2} is held", over_lock.log)
        self.assertIn("the owner's attestation does not stand over it", over_lock.log)
        self.assertEqual([c for c in self.changed(over_lock) if c != ["s3api", "put-object"]], [], "nothing changed")
        self.change_world(world, lambda w: w["faults"].pop("pause"))
        last = self.deploy(None, {**local, "FAKE_RUN": "clone-c6", "DEPLOY_LOCK_DIR": str(one)}, world=world)
        self.assert_done(last)
        self.assertIn(f"taking over {holder2} (no process of its run lives (its lock {lock2} is here and free)", last.log)

    # --- GH158: the image named by its inputs --------------------------------------------------------------------------

    def test_GH158_a_b_a_site_edit_rebuilds_only_when_the_image_copies_the_file(self):
        first = self.deployed()
        self.repo.write("dashboard/frontend/src/components/MatchNav.jsx", (self.repo.path / "dashboard/frontend/src/components/MatchNav.jsx").read_text() + "\n// edit\n")
        self.repo.commit("a component the image does not copy")
        same = self.deploy(first.state)
        self.assert_done(same)
        self.assertEqual(same.identity(), first.identity())
        self.assertEqual((same.built(), same.docker("push")), ([], []))
        self.assertEqual(same.state["services"]["worker"]["replacements"], first.state["services"]["worker"]["replacements"])
        self.repo.write("dashboard/frontend/src/services/format.js", (self.repo.path / "dashboard/frontend/src/services/format.js").read_text() + "\n// edit\n")
        self.repo.commit("a service the image copies")
        changed = self.deploy(same.state)
        self.assert_done(changed)
        self.assertNotEqual(changed.identity(), first.identity())
        self.assertEqual(len(changed.built()), 1)
        self.assertEqual(len(changed.docker("push")), 1)
        self.assertEqual(changed.state["services"]["worker"]["replacements"], first.state["services"]["worker"]["replacements"] + 1)
        self.assertEqual(changed.state["services"]["worker"]["stops"], first.state["services"]["worker"]["stops"])

    def test_GH158_d_same_image_reconciles_counts_and_a_rotated_password(self):
        first = self.deployed()
        stopped = self.deploy(first.state, {"WORKER_DESIRED_COUNT": "0"})
        self.assert_done(stopped)
        w = stopped.state["services"]["worker"]
        self.assertEqual((w["desired"], w["replacements"]), (0, first.state["services"]["worker"]["replacements"]))
        # The workflow's default (keep, GH157-y): the zero asked for stays, nothing started or replaced.
        kept = self.deploy(stopped.state)
        self.assert_done(kept)
        w = kept.state["services"]["worker"]
        self.assertEqual((w["desired"], w["replacements"], w["starts"]), (0, first.state["services"]["worker"]["replacements"], first.state["services"]["worker"]["starts"]))
        # A restart asked for (WORKER_DESIRED_COUNT=1): started once, not replaced.
        started = self.deploy(kept.state, {"WORKER_DESIRED_COUNT": "1"})
        self.assert_done(started)
        w = started.state["services"]["worker"]
        self.assertEqual((w["desired"], w["replacements"], w["starts"]), (1, first.state["services"]["worker"]["replacements"], first.state["services"]["worker"]["starts"] + 1))
        # The collection login's password rotated by the owner: the logins set again, the tasks replaced once.
        state = started.state
        new = "collectROTATED" + "y" * 26
        state["params"]["/vega/v2/password-collect"].update(Value=new, Version=2)
        url = state["params"]["/vega/v2/collect-database-url"]
        url.update(Value=url["Value"].replace(self.passwords["/vega/v2/password-collect"], new), Version=2)
        rotated = self.deploy(state)
        self.assert_done(rotated)
        self.assertEqual(rotated.tasks(), [(["--online"], 0)])
        self.assertEqual(rotated.built(), [])
        self.assertEqual(rotated.state["services"]["worker"]["replacements"], started.state["services"]["worker"]["replacements"] + 1)
        target = urlsplit(sibling(self.db_name))
        with psycopg.connect(urlunsplit(target._replace(netloc=f"vega_v2_collect:{new}@{target.hostname}:{target.port}")), autocommit=True) as c:
            self.assertEqual(c.execute("SELECT current_user").fetchone()[0], "vega_v2_collect")

    def test_GH158_e_a_retry_after_the_push_does_not_build_again(self):
        first = self.deployed()
        self.repo.write("dashboard/frontend/src/services/format.js", (self.repo.path / "dashboard/frontend/src/services/format.js").read_text() + "\n// edit\n")
        self.repo.commit("a new image")
        state = first.state
        state["faults"]["deploy"] = {"vega-v2-api": "fail"}
        failed = self.deploy(state)
        self.assertNotEqual(failed.code, 0)
        self.assertEqual(len(failed.docker("push")), 1)
        failed.state["faults"]["deploy"] = {}
        retry = self.deploy(failed.state)
        self.assert_done(retry)
        self.assertEqual((retry.built(), retry.docker("push")), ([], []))
        self.assertEqual(retry.identity(), failed.identity())


    # --- GH202-e: the checks of step 11b, run for real -------------------------------------------------------------

    def test_GH202_e_the_real_checks_after_a_deploy(self):
        """deploy.sh's steps 11b and 12 run for real (infra/aws/verify-deploy.mjs, then infra/aws/smoke-favourites.mjs, with
        the real Node.js) against one local origin: the release the stand-in package names, the services as the stand-in
        ECS runs them, then the probe on a home that names a player of the week and ten leaders. Step 11b asks
        /api/health alone; every read of /api/read/home-favourites is one the probe printed (three, or four with PR
        #240's visitor's list): never a second favourites read of the Deploy's (FAILURE_MODES_OPTIMISATIONS.md GH202-e)."""
        node = shutil.which("node")
        if not node:
            self.skipTest("node")
        import http.server
        import threading
        import urllib.parse
        release = hashlib.sha256(b"api").hexdigest()
        leaders = [{"playerId": f"p_lead{i:02d}", "teamId": f"t_club{i % 5:02d}"} for i in range(10)]
        club = {row["playerId"]: row["teamId"] for row in leaders}
        week = {"matchId": "m_week01", "date": "2026-11-24"}
        seen = []

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                url = urllib.parse.urlsplit(self.path)
                seen.append(url.path)
                query = urllib.parse.parse_qs(url.query)
                headers = {}
                if url.path == "/api/health":
                    body = {"source": "AWS", "status": "ok", "revision": "7", "release": release}
                elif url.path == "/api/dashboard/manifest":
                    body = {"seasons": [{"id": "2026/2027", "chunks": []}], "defaultSeason": "2026/2027"}
                elif url.path == "/api/read/home":
                    potw = {"playerId": "p_lead00", "teamId": "t_club00", **week}
                    body = {"data": {"potw": potw, "leaders": {"goals": leaders[:6], "assists": leaders[6:]}}, "meta": {"generation": "7"}}
                elif url.path == "/api/read/home-favourites":
                    # As the handler answers: each club followed with strength 1, each other player's club his; each player
                    # in « Vos joueurs » with the week's match.
                    teams = [t for t in query.get("personalTeams", [""])[0].split(",") if t]
                    players = [p for p in query.get("personalPlayers", [""])[0].split(",") if p]
                    favourites = [{"teamId": t, "strength": 1, "reason": "club", "players": [p for p in players if club[p] == t]} for t in teams]
                    favourites += [{"teamId": t, "strength": 2, "reason": "player_club", "players": [p for p in players if club[p] == t]}
                                   for t in sorted({club[p] for p in players} - set(teams))]
                    mine = [{"playerId": p, "teamId": club[p], "next": None, "matches": [week]} for p in players]
                    body = {"data": {"favourites": favourites, "upcoming": [], "yourPlayers": mine, "rules": None,
                                     "period": {"start": "2026-11-23", "end": "2026-11-29", "latest": False}}, "meta": {"generation": "7"}}
                    headers = {"Cache-Control": "private, max-age=0, must-revalidate"}
                else:
                    self.send_response(404)
                    self.end_headers()
                    return
                data = json.dumps(body).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                for k, v in headers.items():
                    self.send_header(k, v)
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def log_message(self, *args):
                pass

        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        origin = f"http://127.0.0.1:{server.server_address[1]}"
        state = self.production_state()
        state["stacks"]["vega-v2-api"]["outputs"]["ApiOrigin"] = origin
        run = self.deploy(state, {"FAKE_NODE_VERIFY_REAL": node, "FAKE_NODE_REAL": node})
        self.assert_done(run)
        lines = run.out.splitlines()
        step = lines.index(next(l for l in lines if l.startswith("== 11b.")))
        self.assertRegex(lines[step + 1], r"^release: 200 ok, [a-f0-9]{12} served \(try 1 of 24\)$")
        self.assertRegex(lines[step + 2], r"^services: vega-v2-worker 1/1 on vega-v2-worker:\d+, vega-v2-backfill 1/1 on vega-v2-backfill:\d+ \(try 1 of 30\)$")
        self.assertEqual(lines[step + 3], "== 12. The home's personal read (a club, a player, both)")
        printed = [l for l in lines[step + 4:] if re.match(r"^favourites (club|player|both|many) 200 ", l)]
        self.assertGreaterEqual(len(printed), 3, run.out)
        self.assertTrue(all(" checked: " in l for l in printed), printed)
        self.assertEqual(seen, ["/api/health", "/api/dashboard/manifest", "/api/read/home", *["/api/read/home-favourites"] * len(printed)])
        self.assertEqual(lines[-1], "done")


if __name__ == "__main__":
    unittest.main()
