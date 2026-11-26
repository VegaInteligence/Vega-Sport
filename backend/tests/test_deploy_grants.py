"""The Deploy's grants, call by call (FAILURE_MODES_OPTIMISATIONS.md GH157-q, GH157-r, written before this test).

GH157-q: every AWS call the Deploy makes itself (deploy.sh, the scripts it runs) is in CALLS with its IAM actions and
resources, and the GitHub role vega-v2-deploy (infra/aws/deploy-roles.yaml) grants each. A call found in the scripts
and missing from CALLS fails: a new call needs its grant checked here.

GH157-r: the CloudFormation role vega-v2-cloudformation may do to the two buckets of worker.yaml (and the media
bucket's policy, api.yaml) what AWS's resource handlers document (CloudFormation's registry schemas, vendored in
fixtures/cfn-handlers.json with their source and digests): the whole read handler, create and update of the
properties the templates set, delete; on those two buckets only, no wildcard action.

GH204-e: the same role may create, read, update and delete the alert stacks' dashboard, alarms (both regions),
insight rule and EventBridge rules as their handlers document, each on its own ARN.

The templates are read as text (no YAML library in the suites' requirements), as test_alerts.py reads them. Not
verifiable here: AWS's own evaluation of these policies.
"""
from fnmatch import fnmatchcase
import json
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[2]
AWS = ROOT / "infra/aws"
ROLES = (AWS / "deploy-roles.yaml").read_text()
ACCOUNT = "361769570630"
REGION = "us-east-2"
RELEASES = f"vega-v2-releases-{ACCOUNT}-{REGION}"
STATE_BUCKET = f"vega-v2-deploy-state-{ACCOUNT}-{REGION}"
MEDIA = f"vega-v2-media-{ACCOUNT}-{REGION}"
HANDLERS = json.loads((Path(__file__).parent / "fixtures/cfn-handlers.json").read_text())


# --- the roles' statements, read from the template ------------------------------------------------------------------

def expand(item):
    """One Resource item as the role's stack resolves it (deployed in us-east-2, its ReleaseBucket's default)."""
    item = item.strip()
    if item.startswith("!GetAtt "):
        name = item.split()[1].split(".")[0]
        role = re.search(rf"\n  {name}:\n    Type: AWS::IAM::Role\n    Properties:\n      RoleName: (\S+)", ROLES)[1]
        return f"arn:aws:iam::{ACCOUNT}:role/{role}"
    item = re.sub(r"^!Sub\s+", "", item).strip("'\"")
    for key, value in (("AWS::Partition", "aws"), ("AWS::Region", REGION), ("AWS::AccountId", ACCOUNT), ("ReleaseBucket", RELEASES)):
        item = item.replace("${" + key + "}", value)
    return item


def resource_block(name):
    """The template's text of one resource, up to the next resource."""
    start = ROLES.index(f"\n  {name}:\n")
    following = re.search(r"\n  [A-Za-z]+:\n    Type: ", ROLES[start + 1:])
    return ROLES[start: start + 1 + following.start()] if following else ROLES[start:]


def policy_statements(block):
    """Every `- Sid:` statement of a block, whatever its depth: [{sid, actions, resources, condition}]."""
    lines, found, i = block.split("\n"), [], 0
    while i < len(lines):
        head = re.match(r"^( +)- Sid: (\S+)\s*$", lines[i])
        i += 1
        if not head:
            continue
        indent, body = len(head[1]), []
        while i < len(lines) and (not lines[i].strip() or lines[i].lstrip().startswith("#") or len(lines[i]) - len(lines[i].lstrip()) > indent):
            if lines[i].strip() and not lines[i].lstrip().startswith("#"):
                body.append(lines[i])
            i += 1
        text, pad = "\n" + "\n".join(body), " " * (indent + 2)
        action = re.search(rf"\n{pad}Action: (\[[^\]]*\]|[^\n]+)", text)[1]
        actions = re.findall(r"'([^']+)'", action) if action.startswith("[") else [action.strip().strip("'\"")]
        inline = re.search(rf"\n{pad}Resource: ([^\n]+)", text)
        if inline:
            resources = [expand(inline[1])]
        else:
            listed = re.search(rf"\n{pad}Resource:\n((?:{pad}  - [^\n]+\n?)+)", text + "\n")
            resources = [expand(line.strip()[2:]) for line in listed[1].strip("\n").split("\n")]
        condition = re.search(rf"\n{pad}Condition: ([^\n]+)", text)
        found.append({"sid": head[2], "actions": actions, "resources": resources, "condition": condition[1] if condition else ""})
    return found


def statements(role):
    """A role's statements: its inline policies' and those of the managed policies of this template it takes."""
    block = resource_block(role)
    found = policy_statements(block)
    attached = re.search(r"\n      ManagedPolicyArns: \[([^\]]*)\]", block)
    for name in re.findall(r"!Ref (\w+)", attached[1] if attached else ""):
        managed = resource_block(name)
        assert "Type: AWS::IAM::ManagedPolicy" in managed, name
        found += policy_statements(managed)
    assert found, f"no statement read for {role}"
    return found


def granted(policy, action, resource):
    """The statements of `policy` that allow `action` on `resource` (IAM's wildcards; actions case-insensitive)."""
    return [s["sid"] for s in policy
            if any(fnmatchcase(action.lower(), a.lower()) for a in s["actions"]) and any(fnmatchcase(resource, r) for r in s["resources"])]


# --- GH157-q: every direct call of the Deploy -------------------------------------------------------------------------

def stack_arn(name, region=REGION):
    return f"arn:aws:cloudformation:{region}:{ACCOUNT}:stack/{name}/0aa0a000-0000-0000-0000-000000000000"


def parameter(name, region=REGION):
    return f"arn:aws:ssm:{region}:{ACCOUNT}:parameter{name}"


CFN_ROLE = f"arn:aws:iam::{ACCOUNT}:role/vega-v2-cloudformation"
REPOSITORY = f"arn:aws:ecr:{REGION}:{ACCOUNT}:repository/vega-v2-worker"
STACKS_HERE = ["vega-v2-database", "vega-v2-worker", "vega-v2-live", "vega-v2-api", "vega-v2-alerts", "vega-v2-account"]
STACKS_EAST = ["vega-v2-waf", "vega-v2-edge-logs", "vega-v2-alerts-edge"]
# `aws cloudformation deploy` (awscli's deployer): DescribeStacks, CreateChangeSet, DescribeChangeSet's waiter,
# ExecuteChangeSet, DescribeStacks' waiter; its --role-arn hands the stack to the CloudFormation role.
DEPLOY_ACTIONS = ["cloudformation:DescribeStacks", "cloudformation:CreateChangeSet", "cloudformation:DescribeChangeSet",
                  "cloudformation:ExecuteChangeSet"]
SECRETS = ["/vega/v2/password-collect", "/vega/v2/collect-database-url", "/vega/v2/pitchapi-key", "/vega/v2/ops-key",
           "/vega/v2/edge-key", "/vega/v2/read-database-url", "/vega/v2/odds-api-key", "/vega/v2/alert-email",
           "/vega/v2/account-deploy", "/vega/v2/account-database-url", "/vega/v2/pass-key/k1", "/vega/v2/neon-api-key"]

EVERY_STACK = [stack_arn(n) for n in STACKS_HERE] + [stack_arn(n, "us-east-1") for n in STACKS_EAST]
STATE_OBJECT = f"arn:aws:s3:::{STATE_BUCKET}/state.json"

# (service, operation) as the scripts write it → [(actions, resources)], each pair to be granted.
CALLS = {
    ("sts", "get-caller-identity"): [],  # no grant needed
    # Each stack's status before the first change (an operation a dead run left, GH157.3), and the outputs read.
    ("cloudformation", "describe-stacks"): [(["cloudformation:DescribeStacks"], EVERY_STACK + [stack_arn("vega-v2-deploy-roles")])],
    ("cloudformation", "deploy"): [(DEPLOY_ACTIONS, EVERY_STACK), (["iam:PassRole"], [CFN_ROLE])],
    ("cloudformation", "update-stack"): [(["cloudformation:UpdateStack"], [stack_arn("vega-v2-worker")]), (["iam:PassRole"], [CFN_ROLE])],
    ("cloudformation", "wait"): [(["cloudformation:DescribeStacks"], [stack_arn("vega-v2-worker")])],
    ("ecr", "describe-repositories"): [(["ecr:DescribeRepositories"], [REPOSITORY])],
    ("ecr", "describe-images"): [(["ecr:DescribeImages"], [REPOSITORY])],
    ("ecr", "get-login-password"): [(["ecr:GetAuthorizationToken"], ["*"])],
    ("docker", "push"): [(["ecr:BatchCheckLayerAvailability", "ecr:InitiateLayerUpload", "ecr:UploadLayerPart",
                           "ecr:CompleteLayerUpload", "ecr:PutImage"], [REPOSITORY])],
    ("ecs", "run-task"): [(["ecs:RunTask"], [f"arn:aws:ecs:{REGION}:{ACCOUNT}:task-definition/vega-v2-migrate:12",
                                             f"arn:aws:ecs:{REGION}:{ACCOUNT}:task-definition/vega-v2-archives:3"]),
                          (["iam:PassRole"], [f"arn:aws:iam::{ACCOUNT}:role/vega-v2-worker-TaskRole-ABC",
                                              f"arn:aws:iam::{ACCOUNT}:role/vega-v2-worker-ExecutionRole-ABC"])],
    ("ecs", "wait"): [(["ecs:DescribeTasks"], [f"arn:aws:ecs:{REGION}:{ACCOUNT}:task/vega-v2/0123456789abcdef"])],
    ("ecs", "describe-tasks"): [(["ecs:DescribeTasks"], [f"arn:aws:ecs:{REGION}:{ACCOUNT}:task/vega-v2/0123456789abcdef"])],
    ("ecs", "describe-services"): [(["ecs:DescribeServices"], [f"arn:aws:ecs:{REGION}:{ACCOUNT}:service/vega-v2/vega-v2-worker"])],
    # A migrate task by its token, or any still running before this run's own (GH157.3): ListTasks on the cluster.
    ("ecs", "list-tasks"): [(["ecs:ListTasks"], ["*"])],
    ("ssm", "get-parameter"): [(["ssm:GetParameter"], [parameter(n) for n in SECRETS])],
    ("ssm", "put-parameter"): [(["ssm:PutParameter"], [parameter(n) for n in SECRETS[:5]])],
    # The release bucket's existence, before any change (GH157-s): ListBucket on it alone.
    ("s3api", "head-bucket"): [(["s3:ListBucket"], [f"arn:aws:s3:::{RELEASES}"])],
    ("s3", "cp"): [(["s3:PutObject"], [f"arn:aws:s3:::{RELEASES}/releases/v2-{kind}/{'0' * 64}.zip" for kind in ("api", "live", "account")])],
    # The Deploy's state: the roles stack's bucket, its one object (GH157.3).
    ("s3api", "put-object"): [(["s3:PutObject"], [STATE_OBJECT])],
    ("s3api", "get-object"): [(["s3:GetObject"], [STATE_OBJECT])],
}
# The SecureStrings' key, through SSM in the Deploy's region (kms:ViaService).
KMS = [(["kms:Decrypt", "kms:Encrypt", "kms:GenerateDataKey"], ["arn:aws:kms:us-east-2:361769570630:key/0000"])]

SCRIPTS = {"deploy.sh": AWS / "deploy.sh", "ci/secrets.sh": AWS / "ci/secrets.sh", "deploy_state.py": AWS / "deploy_state.py",
           "verify-deploy.mjs": AWS / "verify-deploy.mjs"}


def shell_code(line):
    """A shell line without the words of its double-quoted strings (a message's « aws ssm … » is no call), the code of a
    $( … ) inside one kept (a call it makes is one)."""
    out, quoted, depth, i = [], False, 0, 0
    while i < len(line):
        c = line[i]
        if depth:
            out.append(c)
            depth += {"(": 1, ")": -1}.get(c, 0)
        elif c == "\\":
            i += 1
        elif c == '"':
            quoted = not quoted
        elif quoted and line.startswith("$(", i):
            out.append("$(")
            depth, i = 1, i + 1
        elif not quoted:
            out.append(c)
        i += 1
    return "".join(out)


def calls_in_scripts():
    """(service, operation) of every AWS call the scripts make, where each is."""
    found = {}
    for label, path in SCRIPTS.items():
        for number, line in enumerate(path.read_text().splitlines(), 1):
            if line.lstrip().startswith(("#", "//")):
                continue
            code = shell_code(line)
            pairs = []
            if path.suffix == ".sh":
                pairs += re.findall(r"(?<![\w-])(?:aws|call)\s+(?:--region\s+\S+\s+)?([a-z0-9]+)\s+([a-z][a-z0-9-]*)", code)
                pairs += [("docker", "push")] if re.search(r"(?<![\w-])docker\s+push\b", code) else []
            elif path.suffix == ".py":
                pairs += re.findall(r'\baws\(\s*"([a-z0-9]+)",\s*"([a-z0-9-]+)"', line)
            else:
                pairs += re.findall(r'"aws",\s*\[\s*"([a-z0-9]+)",\s*"([a-z0-9-]+)"', line)
            for pair in pairs:
                found.setdefault(tuple(pair), []).append(f"{label}:{number}")
    return found


class DeployRoleTest(unittest.TestCase):
    def test_GH157_q_every_direct_call_is_in_the_table(self):
        found = calls_in_scripts()
        self.assertIn(("ecr", "describe-repositories"), found, "the scan sees deploy.sh's calls")
        missing = {pair: where for pair, where in found.items() if pair not in CALLS}
        self.assertEqual(missing, {}, "calls the table does not know: add each with its actions and resources")

    def test_GH157_q_the_github_role_grants_each_call(self):
        policy = statements("DeployRole")
        refused = []
        for pair, grants in CALLS.items():
            for actions, resources in grants:
                for action in actions:
                    for resource in resources:
                        if not granted(policy, action, resource):
                            refused.append(f"{' '.join(pair)}: {action} on {resource}")
        for actions, resources in KMS:
            for action in actions:
                if not [s for s in policy if action in s["actions"] and "ssm.${AWS::Region}.amazonaws.com" in s["condition"]]:
                    refused.append(f"{action} through SSM")
        self.assertEqual(refused, [])

    def test_GH157_q_the_us_east_1_calls_name_their_region(self):
        """A stack or a parameter of us-east-1 is granted there, not only in the role's own region."""
        policy = statements("DeployRole")
        for name in STACKS_EAST:
            self.assertTrue(granted(policy, "cloudformation:CreateChangeSet", stack_arn(name, "us-east-1")), name)
            self.assertFalse(granted(policy, "cloudformation:CreateChangeSet", stack_arn("vega-v2-other", "us-east-1")), "only those stacks")


# --- GH157-r: the CloudFormation role and the two buckets -------------------------------------------------------------

# The actions of each property the templates set, in AWS's create and update handlers (checked against the fixture).
PROPERTY_ACTIONS = {
    "BucketName": ["s3:CreateBucket"],
    "PublicAccessBlockConfiguration": ["s3:PutBucketPublicAccessBlock"],
    "OwnershipControls": ["s3:PutBucketOwnershipControls"],
    "BucketEncryption": ["s3:PutEncryptionConfiguration"],
    "Tags": ["s3:PutBucketTagging", "s3:TagResource"],
}
# The create handler's own checks of the bucket, whatever its properties; update's removal of a tag.
HANDLER_CHECKS = ["s3:GetBucketAcl", "s3:ListBucket"]
UPDATE_ONLY = ["s3:UntagResource"]


def buckets():
    """worker.yaml's buckets: {logical id: (bucket name, [property keys])}."""
    text = (AWS / "worker.yaml").read_text()
    found = {}
    for logical, body in re.findall(r"\n  (\w+):\n    Type: AWS::S3::Bucket\n((?:    .*\n|\s*\n)+?)(?=  \w+:\n|  #)", text):
        props = re.findall(r"^      (\w+):", body.split("    Properties:\n", 1)[1], re.M)
        name = re.search(r"BucketName: !Sub '([^']+)'", body)[1].replace("${AWS::AccountId}", ACCOUNT).replace("${AWS::Region}", REGION)
        found[logical] = (name, props)
    return found


class CloudFormationRoleTest(unittest.TestCase):
    def test_GH157_r_the_fixture_is_aws_s_and_the_properties_map_to_its_actions(self):
        self.assertRegex(HANDLERS["zip_sha256"], r"^[a-f0-9]{64}$")
        handler = HANDLERS["types"]["AWS::S3::Bucket"]["handlers"]
        self.assertIn("s3:GetLifecycleConfiguration", handler["read"], "the read handler as AWS documents it")
        for prop, actions in PROPERTY_ACTIONS.items():
            for action in actions:
                self.assertIn(action, handler["create"], prop)
                self.assertIn(action, handler["update"] + ["s3:CreateBucket"], prop)
        for action in HANDLER_CHECKS:
            self.assertIn(action, handler["create"])
        found = buckets()
        self.assertEqual(sorted(name for name, _ in found.values()), sorted([MEDIA, RELEASES]))
        for logical, (_, props) in found.items():
            self.assertEqual(sorted(set(props) - set(PROPERTY_ACTIONS)), [], f"{logical}: a property without its actions here")

    def test_GH157_r_the_role_creates_reads_updates_and_deletes_the_two_buckets(self):
        policy = statements("CloudFormationRole")
        handler = HANDLERS["types"]["AWS::S3::Bucket"]["handlers"]
        refused = []
        for logical, (name, props) in buckets().items():
            needed = set(handler["read"]) | set(handler["delete"]) | set(HANDLER_CHECKS) | set(UPDATE_ONLY)
            for prop in props:
                needed |= set(PROPERTY_ACTIONS[prop])
            for action in sorted(needed):
                if not granted(policy, action, f"arn:aws:s3:::{name}"):
                    refused.append(f"{logical}: {action}")
        policy_handler = HANDLERS["types"]["AWS::S3::BucketPolicy"]["handlers"]
        for step in ("create", "read", "update", "delete"):
            for action in policy_handler[step]:
                if not granted(policy, action, f"arn:aws:s3:::{MEDIA}"):
                    refused.append(f"media bucket policy ({step}): {action}")
        self.assertEqual(refused, [])

    def test_GH157_r_the_buckets_statement_names_its_actions_on_those_two_buckets(self):
        statement = next(s for s in statements("CloudFormationRole") if s["sid"] == "Buckets")
        self.assertEqual([a for a in statement["actions"] if "*" in a], [], "no wildcard action")
        self.assertEqual(sorted(statement["resources"]), sorted([f"arn:aws:s3:::{MEDIA}", f"arn:aws:s3:::{RELEASES}"]))
        policy = statements("CloudFormationRole")
        self.assertEqual(granted(policy, "s3:CreateBucket", "arn:aws:s3:::another-bucket"), [], "no other bucket")


class StateGrantsTest(unittest.TestCase):
    def test_GH157_q_the_state_s_bucket_is_the_roles_stack_s_and_its_object_the_deploy_role_s_only_grant(self):
        bucket = resource_block("DeployStateBucket")
        self.assertIn("Type: AWS::S3::Bucket", bucket)
        self.assertIn("BucketName: !Sub 'vega-v2-deploy-state-${AWS::AccountId}-${AWS::Region}'", bucket)
        for part in ("BlockPublicAcls: true", "BucketOwnerEnforced", "SSEAlgorithm: AES256", "Status: Enabled", "DeletionPolicy: Retain"):
            self.assertIn(part, bucket, part)
        policy = statements("DeployRole")
        self.assertTrue(granted(policy, "s3:PutObject", STATE_OBJECT) and granted(policy, "s3:GetObject", STATE_OBJECT))
        for action in ("s3:PutObject", "s3:GetObject", "s3:DeleteObject", "s3:ListBucket"):
            self.assertFalse(granted(policy, action, f"arn:aws:s3:::{STATE_BUCKET}/other.json"), action)
            self.assertFalse(granted(policy, action, f"arn:aws:s3:::{STATE_BUCKET}"), action)
        self.assertFalse(granted(policy, "s3:PutObject", f"arn:aws:s3:::{RELEASES}/deploy/state.json"), "the former place")

    def test_GH157_q_no_fence_no_bootstrap_lock(self):
        for name in ("database", "worker", "live", "waf", "api", "edge-logs", "alerts", "alerts-edge", "account"):
            self.assertNotIn("DeployFence", (AWS / f"{name}.yaml").read_text(), name)
        roles = ROLES
        self.assertNotIn("deploy-fence", roles)
        self.assertNotIn("deploy-bootstrap", roles)

    def test_GH157_q_list_tasks_is_limited_to_the_cluster(self):
        statement = next(s for s in statements("DeployRole") if "ecs:ListTasks" in s["actions"])
        self.assertIn("cluster/vega-v2", statement["condition"])


# --- GH157-ab: the README's manual CloudFormation commands, before the first Deploy as after ----------------------------

def template_parameters(name):
    """A template's parameters: {name: (type, has a default)}."""
    text = (AWS / name).read_text()
    section = text.split("\nParameters:\n", 1)[1]
    section = re.split(r"\n(?:Conditions|Resources|Rules|Mappings|Metadata|Outputs):\n", section, maxsplit=1)[0]
    found, key, body = {}, None, []
    for line in section.split("\n") + ["  END:"]:
        head = re.match(r"^  (\w+):(.*)$", line)
        if head:
            if key:
                text = "\n" + "\n".join(body)
                kind = re.search(r"(?:\n    |[{,]\s*)Type: ([^\s,}]+)", text)
                found[key] = (kind[1] if kind else "", re.search(r"(?:\n    |[{,]\s*)Default:", text) is not None)
            key, body = head[1], [head[2]]
        else:
            body.append(line)
    return found


def manual_commands():
    """The README's aws cloudformation commands, each as one line (its continuation lines joined)."""
    readme = (AWS / "README.md").read_text().replace("\\\n", " ")
    return re.findall(r"aws cloudformation (?:deploy|update-stack) [^\n]+", readme)


class ManualEntriesTest(unittest.TestCase):
    def test_GH157_ab_each_documented_command_gives_what_its_template_needs(self):
        commands = manual_commands()
        self.assertGreaterEqual(len(commands), 6, commands)
        for command in commands:
            stack = re.search(r"--stack-name (\S+)", command)[1]
            if stack in ("vega-v2-deploy-roles", "vega-v2-budget"):
                continue  # the owner's stacks, not the Deploy's
            template = {"vega-v2-database": "database.yaml", "vega-v2-waf": "waf.yaml", "vega-v2-api": "api.yaml"}[stack]
            params = template_parameters(template)
            self.assertEqual([k for k, (kind, _) in params.items() if kind.startswith("AWS::SSM::Parameter")], [], f"{template}: an SSM parameter")
            if " deploy " in f" {command} ":
                given = set(re.findall(r"(\w+)=", command.split("--parameter-overrides", 1)[1])) if "--parameter-overrides" in command else set()
                if stack == "vega-v2-database":
                    # The base's first sizing, before the first Deploy: every parameter without a default is given.
                    self.assertEqual(sorted(k for k, (_, default) in params.items() if not default and k not in given), [], command)
                self.assertEqual(sorted(given - set(params)), [], f"{command}: a parameter its template lacks")
            else:
                named = set(re.findall(r"ParameterKey=(\w+)", command))
                self.assertEqual(sorted(set(params) - named), [], f"{command}: a parameter left to its default")


# --- GH204-e: the alert stacks' resources, as their handlers document them ------------------------------------------

def alert_resources():
    """(type, ARN) of each resource of the alert stacks the role must manage, by the names the templates give."""
    found = []
    for template, region in (("alerts.yaml", REGION), ("alerts-edge.yaml", "us-east-1")):
        text = (AWS / template).read_text()
        for kind, field, arn in (("AWS::CloudWatch::Alarm", "AlarmName", "arn:aws:cloudwatch:{region}:{account}:alarm:{name}"),
                                 ("AWS::CloudWatch::Dashboard", "DashboardName", "arn:aws:cloudwatch::{account}:dashboard/{name}"),
                                 ("AWS::CloudWatch::InsightRule", "RuleName", "arn:aws:cloudwatch:{region}:{account}:insight-rule/{name}"),
                                 ("AWS::Events::Rule", "Name", "arn:aws:events:{region}:{account}:rule/{name}")):
            # A resource's block ends at the next line indented less than its properties (a resource, a comment, Outputs).
            for body in re.findall(rf"\n    Type: {re.escape(kind)}\n((?:    .*\n|\s*\n)+?)(?=(?:  )?\S|\Z)", text):
                name = re.search(rf"\n      {field}: ([\w-]+)", "\n" + body)
                assert name, f"{template}: a {kind} without its {field}"
                found.append((kind, arn.format(region=region, account=ACCOUNT, name=name[1]), body))
    return found


class AlertResourcesTest(unittest.TestCase):
    def test_GH204_e_the_role_manages_each_alert_resource_as_its_handler_does(self):
        policy = statements("CloudFormationRole")
        found = alert_resources()
        kinds = {kind for kind, _, _ in found}
        self.assertEqual(kinds, {"AWS::CloudWatch::Alarm", "AWS::CloudWatch::Dashboard", "AWS::CloudWatch::InsightRule", "AWS::Events::Rule"})
        self.assertIn(f"arn:aws:cloudwatch::{ACCOUNT}:dashboard/vega-v2", [arn for _, arn, _ in found])
        refused = []
        for kind, arn, body in found:
            handlers = HANDLERS["types"][kind]["handlers"]
            for step in ("create", "read", "update", "delete"):
                for action in handlers[step]:
                    # A rule's handler passes a role only to a target that has one.
                    if action == "iam:PassRole":
                        self.assertNotIn("RoleArn", body, f"{arn}: a target with a role needs iam:PassRole here")
                        continue
                    if not granted(policy, action, arn) and not granted(policy, action, "*"):
                        refused.append(f"{arn} ({step}): {action}")
        self.assertEqual(sorted(set(refused)), [])

    def test_GH204_e_the_dashboard_s_tags_on_its_own_arn_only(self):
        policy = statements("CloudFormationRole")
        for action in ("cloudwatch:TagResource", "cloudwatch:UntagResource", "cloudwatch:ListTagsForResource"):
            sids = granted(policy, action, f"arn:aws:cloudwatch::{ACCOUNT}:dashboard/vega-v2")
            self.assertTrue(sids, action)
            self.assertFalse(granted(policy, action, f"arn:aws:cloudwatch::{ACCOUNT}:dashboard/someone-else"), f"{action}: that dashboard only")


if __name__ == "__main__":
    unittest.main()
