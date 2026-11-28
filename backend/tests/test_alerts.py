"""Someone is told when the service fails (alerts.yaml, alerts-edge.yaml).

Incident of 20 November 2026 (VI-33): the API refused every read (`read failed 53300`, a
503 DATA_UNAVAILABLE on every route) and no one was told: the three database alarms of
database.yaml notified no one, and nothing watched the function, the distribution or the
worker.

Failure modes, and what is expected:
- an alarm that notifies no one -> every alarm of every template sends ALARM and OK to the
  stack's own topic `vega-v2-alerts`;
- an alarm on a CloudFront or Route 53 metric outside us-east-1 (those metrics exist only
  there, and an alarm notifies only a topic of its own region) -> they live in
  alerts-edge.yaml, which deploy.sh deploys with --region us-east-1, with its own topic;
  alerts.yaml stays in the deploy's region and holds none of them;
- a threshold that no longer follows the numbers it was derived from -> the saturation
  alarm is 90 % of the copies (api.yaml ReservedConcurrency), the slow-answer alarm 80 % of
  the function's timeout, the database connections alarm the logins' limits plus the
  owner's margin (vega/migrate.py; the account's login once the account is on), below what
  the instance gives (about 400);
- a function, log group, cluster, service or instance renamed in its own template -> the
  alarms name what api.yaml, worker.yaml, live.yaml and database.yaml create;
- a filter pattern that no longer recognises the line the code writes -> the lines are
  produced by the real handler (backend/api/src/handler.mjs, a reader that fails as the
  base does), wrapped as Lambda's text format writes them, and matched with the
  documented semantics of the patterns used (a quoted term is a substring; %regex% with
  only the documented characters, no parentheses, \\xhh for the others). A statement
  timeout (57014) is not a refused connection; a 404 is not a 5xx;
- the alert address in the repository -> it is a NoEcho parameter, empty by default, read
  by deploy.sh from SSM /vega/v2/alert-email; without it the deploy goes on and says so;
- one person told, asleep or away (23 November 2026: two people run the service) -> the
  parameter may hold two addresses separated by a comma; deploy.sh gives each its own
  NoEcho parameter and each topic a subscription per address; a third address is not
  dropped in silence: the deploy says so and goes on;
- an alarm that sounds at night on three requests -> every alarm says how it treats
  missing data, the distribution's error rate counts only periods of at least 100
  requests, and the only alarms that treat missing data as breaching are the ones whose
  silence is the failure (the probe, the worker);
- a permission the CloudFormation role lacks (the live stack, 10 November 2026:
  UPDATE_ROLLBACK_FAILED) -> deploy-roles.yaml grants the topic, the subscription, the
  alarms in both regions, the metric filters, the health check and the edge stack;
- the edge template never linted for its region -> ci.yml lints it with --regions us-east-1.
"""
import json
import math
import re
import shutil
import subprocess
import unittest
from pathlib import Path

from vega import migrate

from prerequisites import required

ROOT = Path(__file__).resolve().parents[2]
AWS = ROOT / "infra/aws"
ALERTS = AWS / "alerts.yaml"
EDGE = AWS / "alerts-edge.yaml"
API = (AWS / "api.yaml").read_text()
DEPLOY = (AWS / "deploy.sh").read_text()
ROLES = (AWS / "deploy-roles.yaml").read_text()
CI = (ROOT / ".github/workflows/ci.yml").read_text()
NODE = shutil.which("node")
# What the instance class in use gives (db.t4g.medium: LEAST(memory/9531392, 5000), about 400).
INSTANCE_CONNECTIONS = 400


def text(path):
    return path.read_text() if path.exists() else ""


def one(pattern, body, what):
    found = re.findall(pattern, body, re.S | re.M)
    assert len(found) == 1, f"{what}: expected once, found {len(found)}"
    return found[0]


def resources(body):
    """Top-level resources of a template: name -> (type, its indented block)."""
    out = {}
    section = body.split("\nResources:\n", 1)[-1].split("\nOutputs:\n", 1)[0] + "\n" if "\nResources:\n" in body else ""
    for m in re.finditer(r"^  (\w+):\n((?:(?:    .*)?\n)+)", section, re.M):
        kind = re.search(r"^    Type: (\S+)", m.group(2), re.M)
        if kind:
            out[m.group(1)] = (kind.group(1), m.group(2))
    return out


def alarms(body):
    return {name: block for name, (kind, block) in resources(body).items() if kind == "AWS::CloudWatch::Alarm"}


def prop(block, key):
    m = re.search(rf"^\s+{key}: (.*)$", block, re.M)
    return m.group(1).strip().strip("'") if m else None


def alarm_named(body, name):
    found = [b for b in alarms(body).values() if prop(b, "AlarmName") == name]
    assert len(found) == 1, f"alarm {name}: expected once, found {len(found)}"
    return found[0]


def templates():
    return {p.name: p.read_text() for p in sorted(AWS.glob("*.yaml"))}


# --- CloudWatch Logs filter patterns, as documented (FilterAndPatternSyntax) ----------
REGEX_ALLOWED = re.compile(r"^[A-Za-z0-9:_#=@/;,\-^$?\[\]{}|\\*+.]*$")


def cw_matches(pattern, message):
    """The two kinds of pattern the alerts use: one %regex%, or quoted terms (all must occur)."""
    pattern = pattern.strip()
    if pattern.startswith("%") and pattern.endswith("%"):
        body = pattern[1:-1]
        assert REGEX_ALLOWED.match(body), f"character outside the documented regex set in {body!r}"
        assert "(" not in body and ")" not in body, "parentheses are not supported"
        return re.search(body, message) is not None  # \xhh is also Python's spelling
    terms = re.findall(r'"([^"]*)"|(\S+)', pattern)
    return all((quoted or bare) in message for quoted, bare in terms)


def lambda_text_line(level, message):
    """How the Node runtime writes console output with the function's default (Text) log format."""
    return f"2026-11-20T21:04:05.123Z\t6f1c9b0e-1d2a-4a51-9c33-0d6a2b7e9f10\t{level}\t{message}"


# The request lines go through infra/aws/api-index.mjs's `log` (RAW: a JSON line of its own, written to stdout without
# the runtime's text prefix, GH204); the errors through console.error (ERROR: the Text format's prefix).
REAL_LINES = r"""
import { createHandler } from "./backend/api/src/handler.mjs";
const out = [];
const capture = (level) => (...args) => out.push([level, args.map(String).join(" ")]);
console.error = capture("ERROR");
const failing = (code) => async () => { const e = new Error("refused"); e.code = code; throw e; };
for (const code of ["53300", "57P03", "ECONNREFUSED", "57014"]) {
  const handle = createHandler({ read: failing(code), log: capture("RAW") });
  await handle(new Request("https://statarena.invalid/api/health"));
}
const slow = createHandler({ read: failing("57014"), log: capture("RAW") });
await slow(new Request("https://statarena.invalid/api/read/home-favourites?season=2025/2026&leagues=all&personalPlayers=p_aaaab1"));
const ok = createHandler({ read: async () => [{ revision: "1", ready: true }], log: capture("RAW") });
await ok(new Request("https://statarena.invalid/api/health"));
await ok(new Request("https://statarena.invalid/api/nothing-here"));
const empty = createHandler({ read: async () => [], log: capture("RAW") });
await empty(new Request("https://statarena.invalid/api/matches/m_aaaaa1/summary"));
process.stdout.write(JSON.stringify(out));
"""


@required(
    NODE is not None and (ROOT / "backend/api/node_modules/pg").is_dir(),
    "requires node and backend/api/node_modules to produce the read API's log lines",
)
class FilterPatternTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        run = subprocess.run([NODE, "--input-type=module", "-e", REAL_LINES], cwd=ROOT, capture_output=True, text=True, timeout=60)
        assert run.returncode == 0, run.stderr
        cls.lines = [message if level == "RAW" else lambda_text_line(level, message) for level, message in json.loads(run.stdout)]
        filters = {name: block for name, (kind, block) in resources(text(ALERTS)).items() if kind == "AWS::Logs::MetricFilter"}
        cls.patterns = {re.search(r"MetricName: (\w+)", b).group(1): prop(b, "FilterPattern") for b in filters.values()}
        rule = [b for kind, b in resources(text(ALERTS)).values() if kind == "AWS::CloudWatch::InsightRule"]
        cls.rule = json.loads(re.search(r"RuleBody: '(.*)'", rule[0]).group(1).replace("''", "'")) if rule else None

    def lines_with(self, needle):
        found = [line for line in self.lines if needle in line]
        self.assertTrue(found, f"the handler wrote no line with {needle!r}: {self.lines}")
        return found

    def test_a_refused_connection_is_counted(self):
        pattern = self.patterns.get("DatabaseRefused")
        self.assertIsNotNone(pattern, "no DatabaseRefused metric filter")
        for code in ("53300", "57P03", "ECONNREFUSED"):
            for line in self.lines_with(f"read failed {code} "):
                self.assertTrue(cw_matches(pattern, line), f"{pattern} misses {line!r}")

    def test_a_slow_statement_and_the_request_lines_are_not_refusals(self):
        pattern = self.patterns["DatabaseRefused"]
        for line in self.lines_with("read failed 57014 ") + self.lines_with('"request":"read"'):
            self.assertFalse(cw_matches(pattern, line), f"{pattern} counts {line!r}")

    def test_a_5xx_answer_is_counted_and_nothing_else(self):
        pattern = self.patterns.get("Responses5xx")
        self.assertIsNotNone(pattern, "no Responses5xx metric filter")
        five = self.lines_with('"status":503')
        self.assertEqual(len(five), 5, "one 503 line per failed read")
        for line in five:
            self.assertTrue(cw_matches(pattern, line), f"{pattern} misses {line!r}")
        for line in self.lines_with('"status":200') + self.lines_with('"status":404') + self.lines_with("read failed"):
            self.assertFalse(cw_matches(pattern, line), f"{pattern} counts {line!r}")


    # --- GH204-b: the request line, a JSON line of its own, with its route ------------------------------------------------

    def test_GH204_b_each_request_line_is_json_with_its_route(self):
        requests = [json.loads(line) for line in self.lines if line.startswith('{"request":"read"')]
        self.assertEqual(len(requests), 8)
        self.assertEqual({r["route"] for r in requests}, {"health", "read.home-favourites", "other", "matches.id.summary"})
        self.assertEqual([r["route"] for r in requests if r["path"] == "/api/nothing-here"], ["other"])
        index = (ROOT / "infra/aws/api-index.mjs").read_text()
        self.assertRegex(index, r"log: \(line\) => process\.stdout\.write\(line \+ \"\\n\"\)")

    def test_GH204_b_the_rule_counts_the_5xx_answers_by_route(self):
        self.assertIsNotNone(self.rule, "no Contributor Insights rule in alerts.yaml")
        self.assertEqual(self.rule["LogFormat"], "JSON")
        self.assertEqual(self.rule["LogGroupNames"], ["/aws/lambda/vega-v2-api"])
        self.assertEqual(self.rule["Contribution"]["Keys"], ["$.route"])
        filters = self.rule["Contribution"]["Filters"]
        self.assertEqual(filters, [{"Match": "$.request", "In": ["read"]}, {"Match": "$.status", "GreaterThan": 499}])
        self.assertEqual(self.rule["AggregateOn"], "Count")

        def matches(record):
            return all((record.get(f["Match"][2:]) in f["In"]) if "In" in f else (isinstance(record.get(f["Match"][2:]), (int, float))
                                                                                  and record[f["Match"][2:]] > f["GreaterThan"]) for f in filters)
        counted = [json.loads(line) for line in self.lines if line.startswith("{") and matches(json.loads(line))]
        self.assertEqual(sorted(r["route"] for r in counted), ["health"] * 4 + ["read.home-favourites"])


class AlertsTest(unittest.TestCase):
    def setUp(self):
        self.alerts, self.edge = text(ALERTS), text(EDGE)
        self.assertTrue(self.alerts, "infra/aws/alerts.yaml is missing")
        self.assertTrue(self.edge, "infra/aws/alerts-edge.yaml is missing")

    def test_every_alarm_notifies_its_topic_of_alarm_and_ok(self):
        for name, body in templates().items():
            for alarm, block in alarms(body).items():
                with self.subTest(template=name, alarm=alarm):
                    self.assertEqual(prop(block, "AlarmActions"), "[!Ref Topic]")
                    self.assertEqual(prop(block, "OKActions"), "[!Ref Topic]")
                    self.assertIn("AWS::SNS::Topic", [kind for kind, _ in resources(body).values()])
        for body in (self.alerts, self.edge):
            topic = resources(body)["Topic"][1]
            self.assertEqual(prop(topic, "TopicName"), "vega-v2-alerts")
        self.assertRegex(self.alerts, r"Export: \{Name: vega-v2-alerts-topic\}")

    def test_alarm_names_are_ours_and_unique(self):
        names = [prop(b, "AlarmName") for body in templates().values() for b in alarms(body).values()]
        self.assertTrue(all(n and n.startswith("vega-v2-") for n in names), names)
        self.assertEqual(len(names), len(set(names)), names)

    def test_edge_metrics_live_in_us_east_1_only(self):
        for name, body in templates().items():
            if name != EDGE.name:
                self.assertNotRegex(body, r"Namespace: AWS/(CloudFront|Route53)", name)
                self.assertNotIn("AWS::Route53::HealthCheck", body, name)
        self.assertRegex(self.edge, r"Namespace: AWS/CloudFront")
        self.assertRegex(self.edge, r"Namespace: AWS/Route53")
        self.assertRegex(self.edge, r"\{Name: Region, Value: Global\}")
        one(r"^\s*stack vega-v2-alerts-edge alerts-edge\.yaml --region us-east-1 ", DEPLOY, "edge stack deployed in us-east-1")
        line = one(r"^\s*(stack vega-v2-alerts alerts\.yaml [^\n]*)$", DEPLOY, "alerts stack deployed")
        self.assertNotIn("--region", line)

    def test_the_probe_reads_the_base_through_the_distribution(self):
        check = [b for kind, b in resources(self.edge).values() if kind == "AWS::Route53::HealthCheck"]
        self.assertEqual(len(check), 1)
        self.assertEqual(prop(check[0], "ResourcePath"), "/api/health")
        self.assertRegex(check[0], r"\n        Type: HTTPS\n")
        # /api/health reads api.publication and api.editions: a base that refuses is a 503.
        system = (ROOT / "backend/api/src/routes/system.mjs").read_text()
        self.assertRegex(system, r'path === "/api/health"\) \{\n\s+validateParams\(params, \[\]\);\n\s+const \[r\] = await read\(')
        probe = alarm_named(self.edge, "vega-v2-api-unreachable")
        self.assertEqual(prop(probe, "TreatMissingData"), "breaching")

    def test_thresholds_follow_the_numbers_they_come_from(self):
        copies = int(one(r"\n  ReservedConcurrency:\n    Type: Number\n    Default: (\d+)\n", API, "ReservedConcurrency default"))
        timeout = int(one(r"^      Timeout: (\d+)$", API, "function timeout"))
        self.assertEqual(float(prop(alarm_named(self.alerts, "vega-v2-api-copies"), "Threshold")), math.ceil(0.9 * copies))
        self.assertEqual(float(prop(alarm_named(self.alerts, "vega-v2-api-slow"), "Threshold")), 0.8 * timeout * 1000)
        logins = sum(migrate.CONNECTION_LIMITS.values())
        owner_margin = int(one(r"owner's margin: (\d+)", self.alerts, "owner's margin"))
        # The account's login counts once the account is switched on (Account=true, backend/account/FAILURE_MODES.md W11),
        # the PannaData loader's once /vega/v2/panna-deploy is on (Panna=true, backend/panna/FAILURE_MODES.md GH278-ah).
        threshold = prop(alarm_named(self.alerts, "vega-v2-db-connections"), "Threshold")
        both, account, panna, neither = (float(n) for n in re.fullmatch(
            r"!If \[Account, !If \[Panna, (\d+), (\d+)\], !If \[Panna, (\d+), (\d+)\]\]", threshold).groups())
        self.assertEqual(both, logins + owner_margin)
        self.assertEqual(account, logins - migrate.CONNECTION_LIMITS["panna"] + owner_margin)
        self.assertEqual(panna, logins - migrate.CONNECTION_LIMITS["account"] + owner_margin)
        self.assertEqual(neither, logins - migrate.CONNECTION_LIMITS["account"] - migrate.CONNECTION_LIMITS["panna"] + owner_margin)
        self.assertLess(both, INSTANCE_CONNECTIONS * 0.5)

    def test_alarms_name_what_the_other_stacks_create(self):
        function = one(r"^      FunctionName: (\S+)$", API, "API function name")
        log_group = one(r"^      LogGroupName: (\S+)$", API, "API log group")
        worker = text(AWS / "worker.yaml")
        live = text(AWS / "live.yaml")
        database = text(AWS / "database.yaml")
        dims = re.findall(r"\{Name: (\w+), Value: ([^}]+)\}", self.alerts)
        for key, value in dims:
            expected = {
                "FunctionName": {function, one(r"^      FunctionName: (vega-v2-live-read)$", live, "live read function")},
                "ClusterName": {one(r"^      ClusterName: (\S+)$", worker, "cluster")},
                "ServiceName": {one(r"^      ServiceName: (vega-v2-worker)$", worker, "worker service"),
                                one(r"^      ServiceName: (vega-v2-backfill)$", worker, "backfill service")},
                "DBInstanceIdentifier": {one(r"^      DBInstanceIdentifier: (\S+)$", database, "instance")},
                # GH204: the EventBridge rules of alerts.yaml itself.
                "RuleName": set(re.findall(r"^      Name: (vega-v2-[a-z-]+-stops)$", self.alerts, re.M)),
            }[key]
            self.assertIn(value, expected, key)
        filters = [b for kind, b in resources(self.alerts).values() if kind == "AWS::Logs::MetricFilter"]
        self.assertEqual(len(filters), 2)
        for block in filters:
            self.assertEqual(prop(block, "LogGroupName"), log_group)
        self.assertIn("{Name: FunctionName, Value: " + function + "}", self.alerts)

    def test_the_address_stays_out_of_the_repository(self):
        for body in (self.alerts, self.edge):
            self.assertNotRegex(body, r"[\w.+-]+@[\w-]+\.[\w.]+")
            for name in ("AlertEmail", "AlertEmail2"):
                param = one(rf"\n  {name}:\n((?:    .*\n)+)", body, f"{name} parameter")
                self.assertIn("NoEcho: true", param)
                self.assertIn("Default: ''", param)
        read = one(r"^(alert_emails=\$\(aws [^\n]*)$", DEPLOY, "the addresses read")
        self.assertIn("/vega/v2/alert-email", read)
        self.assertTrue(read.rstrip().endswith("|| true)"), "a missing parameter must not stop the deploy")
        self.assertRegex(DEPLOY, r"no SSM parameter /vega/v2/alert-email")
        self.assertEqual(len(re.findall(r'AlertEmail="\$alert_email" AlertEmail2="\$alert_email2"', DEPLOY)), 2)

    def test_each_address_has_its_subscription_on_each_topic(self):
        for body in (self.alerts, self.edge):
            first = one(r"\n  AlertEmail:\n((?:    .*\n)+)", body, "AlertEmail parameter")
            second = one(r"\n  AlertEmail2:\n((?:    .*\n)+)", body, "AlertEmail2 parameter")
            self.assertEqual(prop(first, "AllowedPattern"), prop(second, "AllowedPattern"))
            sub = [b for kind, b in resources(body).values() if kind == "AWS::SNS::Subscription"]
            self.assertEqual(
                sorted((prop(b, "Condition"), prop(b, "Endpoint"), prop(b, "Protocol")) for b in sub),
                [("HasEmail", "!Ref AlertEmail", "email"), ("HasEmail2", "!Ref AlertEmail2", "email")])
            self.assertIn("HasEmail2: !Not [!Equals [!Ref AlertEmail2, '']]", body)

    @required(shutil.which("bash"), "bash")
    def test_the_deploy_gives_each_address_its_parameter(self):
        fragment = one(r"(\n# --- Alerts \(alerts\.yaml.*?# --- end of alerts ---\n)", DEPLOY, "alerts step of deploy.sh")

        def run(value, actions=""):
            script = (
                "set -euo pipefail\n"
                'aws() { printf "%s\\n" "$FAKE_VALUE"; }\n'
                'stack() { echo "stack $*"; }\n'
                # Each step writes the Deploy's state again first (GH157); its own tests are test_deploy_flow's.
                "hold_state() { :; }\n"
                "output() { echo E2NNDNWK491L8W; }\n"
                "COUNT=1; BACKFILL=1; media=https://d111111abcdef8.cloudfront.net\n" + fragment)
            env = {"PATH": "/usr/bin:/bin", "FAKE_VALUE": value}
            if actions:
                env["GITHUB_ACTIONS"] = actions
            done = subprocess.run(["bash", "-c", script], capture_output=True, text=True, env=env, timeout=30)
            self.assertEqual(done.returncode, 0, done.stderr)
            return done.stdout

        def overrides(out):
            lines = [line for line in out.splitlines() if line.startswith("stack ")]
            self.assertEqual(len(lines), 2, out)
            return [(re.search(r'AlertEmail=(\S*)', line).group(1), re.search(r'AlertEmail2=(\S*)', line).group(1)) for line in lines]

        self.assertEqual(overrides(run("a@example.org")), [("a@example.org", "")] * 2)
        self.assertEqual(overrides(run("a@example.org,b@example.net")), [("a@example.org", "b@example.net")] * 2)
        self.assertEqual(overrides(run(" a@example.org , b@example.net ")), [("a@example.org", "b@example.net")] * 2)
        self.assertEqual(overrides(run("a@example.org,")), [("a@example.org", "")] * 2)
        out = run("None")
        self.assertEqual(overrides(out), [("", "")] * 2)
        self.assertIn("no SSM parameter /vega/v2/alert-email", out)
        out = run("a@example.org,b@example.net,c@example.com")
        self.assertEqual(overrides(out), [("a@example.org", "b@example.net")] * 2)
        self.assertRegex(out, r"alerts: /vega/v2/alert-email holds more than two addresses")
        self.assertNotIn("c@example.com", out)
        self.assertIn("::add-mask::a@example.org", run("a@example.org", actions="true"))
        masked = run("a@example.org,b@example.net", actions="true")
        self.assertIn("::add-mask::a@example.org", masked)
        self.assertIn("::add-mask::b@example.net", masked)

    def test_no_alarm_sounds_on_a_handful_of_requests(self):
        for body in (self.alerts, self.edge):
            for alarm, block in alarms(body).items():
                with self.subTest(alarm=alarm):
                    self.assertIn(prop(block, "TreatMissingData"), {"notBreaching", "breaching"})
                    if prop(block, "TreatMissingData") == "breaching":
                        self.assertIn(prop(block, "AlarmName"), {"vega-v2-api-unreachable", "vega-v2-worker-down", "vega-v2-backfill-down"})
        rate = alarm_named(self.edge, "vega-v2-api-edge-5xx")
        self.assertRegex(rate, r"Expression: 'IF\(requests >= 100, rate, 0\)'")
        for name in ("vega-v2-api-errors", "vega-v2-api-throttles", "vega-v2-api-5xx", "vega-v2-api-db-refused"):
            self.assertGreaterEqual(float(prop(alarm_named(self.alerts, name), "Threshold")), 5, name)

    def test_the_cloudformation_role_may_create_all_of_it(self):
        block = one(r"(\n              # --- Alerts \(alerts\.yaml.*?# --- end of alerts\n)", ROLES, "alerts block of the CloudFormation role")
        for needle in ("sns:CreateTopic", "sns:Subscribe", "sns:Unsubscribe", "sns:GetSubscriptionAttributes", "sns:ListSubscriptionsByTopic",
                       ":sns:${AWS::Region}:${AWS::AccountId}:vega-v2-alerts*", ":sns:us-east-1:${AWS::AccountId}:vega-v2-alerts*",
                       "cloudwatch:PutMetricAlarm", ":cloudwatch:us-east-1:${AWS::AccountId}:alarm:vega-v2-*",
                       "route53:CreateHealthCheck", "route53:DeleteHealthCheck", "route53:ChangeTagsForResource"):
            self.assertIn(needle, block)
        self.assertIn(":cloudformation:us-east-1:${AWS::AccountId}:stack/vega-v2-alerts-edge/*", ROLES)

    def test_the_role_may_read_change_and_end_a_subscription(self):
        # 23 November 2026, first deploy of the roles: `aws iam simulate-principal-policy` denied
        # the three actions on the topic's ARN, on a subscription's ARN and on `*`. IAM knows no
        # subscription resource: a statement scoped to the topic never applies to them, and the
        # stack would stop on EmailSubscription. They are granted on `*`, and nothing else is.
        block = one(r"(\n              # --- Alerts \(alerts\.yaml.*?# --- end of alerts\n)", ROLES, "alerts block of the CloudFormation role")
        statement = one(r"(              - Sid: AlertSubscriptions\n(?:                [^\n]*\n)+)", block, "AlertSubscriptions statement")
        actions = sorted(re.findall(r"'(sns:\w+)'", statement))
        self.assertEqual(actions, ["sns:GetSubscriptionAttributes", "sns:SetSubscriptionAttributes", "sns:Unsubscribe"])
        self.assertRegex(statement, r"\n                Resource: '\*'\n")

    def test_ci_lints_the_edge_template_for_its_region(self):
        self.assertRegex(CI, r"cfn-lint --regions us-east-1 -- infra/aws/alerts-edge\.yaml")


class AlarmsOfGH204Test(unittest.TestCase):
    """GH204-a, c, d (FAILURE_MODES_OPTIMISATIONS.md, written before this test)."""

    def setUp(self):
        self.alerts = text(ALERTS)
        self.deploy = DEPLOY
        self.roles = ROLES

    def test_GH204_a_the_p95_alarm(self):
        alarm = alarm_named(self.alerts, "vega-v2-api-p95")
        self.assertIn("{Name: FunctionName, Value: vega-v2-api}", alarm)
        self.assertEqual((prop(alarm, "MetricName"), prop(alarm, "ExtendedStatistic"), prop(alarm, "Period"), prop(alarm, "EvaluationPeriods"),
                          prop(alarm, "DatapointsToAlarm"), prop(alarm, "Threshold"), prop(alarm, "TreatMissingData")),
                         ("Duration", "p95", "300", "6", "6", "3000", "notBreaching"))

    def test_GH204_a_the_route_alarm_reads_the_rule(self):
        rule = [(name, b) for name, (kind, b) in resources(self.alerts).items() if kind == "AWS::CloudWatch::InsightRule"]
        self.assertEqual(len(rule), 1)
        self.assertIn("RuleName: vega-v2-api-route-5xx", rule[0][1])
        self.assertIn("RuleState: ENABLED", rule[0][1])
        alarm = alarm_named(self.alerts, "vega-v2-api-route-5xx")
        self.assertIn("Expression: \"INSIGHT_RULE_METRIC('vega-v2-api-route-5xx', 'MaxContributorValue')\"", alarm)
        self.assertEqual((prop(alarm, "EvaluationPeriods"), prop(alarm, "DatapointsToAlarm"), prop(alarm, "Threshold"), prop(alarm, "TreatMissingData")),
                         ("3", "3", "2", "notBreaching"))
        self.assertRegex(alarm, r"Period: 300")

    def test_GH204_a_abnormal_stops_counted_per_service_while_it_is_meant_to_run(self):
        for service, condition in (("worker", "Worker"), ("backfill", "Backfill")):
            with self.subTest(service=service):
                rules = [b for kind, b in resources(self.alerts).values() if kind == "AWS::Events::Rule" and f"Name: vega-v2-{service}-stops" in b]
                self.assertEqual(len(rules), 1)
                rule = rules[0]
                self.assertEqual(prop(rule, "Condition"), condition)
                pattern = json.loads(re.search(r"EventPattern: '(.*)'", rule).group(1))
                self.assertEqual(pattern["source"], ["aws.ecs"])
                self.assertEqual(pattern["detail-type"], ["ECS Task State Change"])
                self.assertEqual(pattern["detail"]["group"], [f"service:vega-v2-{service}"])
                self.assertEqual(pattern["detail"]["lastStatus"], ["STOPPED"])
                self.assertEqual(sorted(pattern["detail"]["stopCode"]), ["EssentialContainerExited", "TaskFailedToStart"])
                self.assertNotIn("Targets", rule)
                alarm = alarm_named(self.alerts, f"vega-v2-{service}-restarts")
                self.assertEqual(prop(alarm, "Condition"), condition)
                self.assertEqual((prop(alarm, "Namespace"), prop(alarm, "MetricName"), prop(alarm, "Statistic"), prop(alarm, "Period"),
                                  prop(alarm, "Threshold"), prop(alarm, "TreatMissingData")),
                                 ("AWS/Events", "MatchedEvents", "Sum", "1800", "3", "notBreaching"))
                self.assertIn(f"{{Name: RuleName, Value: vega-v2-{service}-stops}}", alarm)

    def test_GH204_a_the_backfill_meant_to_run(self):
        alarm = alarm_named(self.alerts, "vega-v2-backfill-down")
        self.assertEqual(prop(alarm, "Condition"), "Backfill")
        self.assertIn("{Name: ServiceName, Value: vega-v2-backfill}", alarm)
        self.assertEqual(prop(alarm, "TreatMissingData"), "breaching")
        self.assertIn("WatchBackfill:", self.alerts)
        self.assertIn("Backfill: !Equals [!Ref WatchBackfill, 'true']", self.alerts)

    def test_GH204_a_the_dashboard(self):
        dashboards = [b for kind, b in resources(self.alerts).values() if kind == "AWS::CloudWatch::Dashboard"]
        self.assertEqual(len(dashboards), 1)
        body = dashboards[0]
        self.assertIn("DashboardName: vega-v2", body)
        for needle in ("AWS/Lambda", "Duration", "p95", "Vega/Api", "Responses5xx", "vega-v2-api-route-5xx", "AWS/ECS", "vega-v2-backfill",
                       "AWS/Events", "AWS/RDS", "AWS/CloudFront", "us-east-1", "alarms", "stats pct(ms, 95) by route"):
            self.assertIn(needle, body, needle)

    def test_GH204_c_the_deploy_watches_the_backfill_as_it_sets_it(self):
        self.assertIn('watch_backfill=true; [ "$BACKFILL" = 0 ] && watch_backfill=false', self.deploy)
        line = one(r"^(stack vega-v2-alerts alerts\.yaml [^\n]*)$", self.deploy, "alerts stack deployed")
        self.assertIn('WatchBackfill="$watch_backfill"', line)

    def test_GH204_d_the_cloudformation_role_may_create_them(self):
        block = one(r"(\n              # --- Alerts \(alerts\.yaml.*?# --- end of alerts\n)", self.roles, "alerts block of the CloudFormation role")
        # The dashboard's own ARN, not a pattern (GH204-e).
        for needle in ("cloudwatch:PutDashboard", ":dashboard/vega-v2'", "cloudwatch:PutInsightRule", ":insight-rule/vega-v2-*",
                       "events:PutRule", ":rule/vega-v2-*"):
            self.assertIn(needle, block)
        grants = one(r"^  DeployGrants: \{Value: '(\d+)'\}$", self.roles, "the deployed grants version")
        self.assertIn(f'[ "$(output vega-v2-deploy-roles DeployGrants)" = {grants} ]', self.deploy)


if __name__ == "__main__":
    unittest.main()
