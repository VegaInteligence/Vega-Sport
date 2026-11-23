"""Spend has a ceiling, and someone hears about it before it is reached.

Until November 2026 the account had no budget and no cost alert: a loop or an abuse showed
on the next invoice. Some limits existed (32 copies of the read API, a fixed-size base,
log retention); the live read function had none, so it could take what the account's
concurrency leaves (about 968 copies).

Failure modes, and what is expected:
- a notification threshold missing (50, 80 or 100 % of the actual spend, 100 % of the
  forecast) -> budget.yaml holds each one exactly once, as a percentage;
- an address written in the template (it would be in the repository and in every copy
  of it) -> every subscriber is the AlertEmail parameter (or the optional alert topic),
  which has no default, and no e-mail address appears in the file;
- a budget below the current spend (an alert every month, soon ignored) or far above it
  (an alert that comes too late) -> the default lies between the current estimate's
  ceiling ($81, infra/aws/README.md) and twice it;
- a second "AWS services" anomaly monitor, which the account refuses (one per account;
  Cost Explorer may already have created one) -> the stack creates it only when no
  existing monitor's ARN is given;
- the deprecated Threshold of the anomaly subscription, or an IMMEDIATE frequency with an
  e-mail subscriber (IMMEDIATE needs SNS) -> ThresholdExpression on absolute impact,
  daily e-mail;
- an automatic cut-off on by default (it acts on the account without a person) -> the
  budget action exists only when its parameter is set, and it denies one action to one
  role (starting the live ingestor), nothing that serves the site;
- the budget deployed by the workflow, whose role has no billing permission -> deploy.sh
  never deploys it; infra/aws/README.md gives the owner's one-time command;
- the live read function without a limit of its own -> it has a fixed reserved
  concurrency;
- reservations that leave the account less than the 100 units Lambda keeps unreserved
  (the deploy is refused) -> the API's largest allowed value plus the live function's
  fit the account's 1000 minus 100;
- a log group that keeps everything forever, a function without a limit, a repository
  that keeps every image -> each log group has a retention, each function a reserved
  concurrency, each repository a lifecycle policy.
"""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
AWS = ROOT / "infra/aws"
TEMPLATES = {path.name: path.read_text() for path in sorted(AWS.glob("*.yaml"))}
DEPLOY = (AWS / "deploy.sh").read_text()
README = (AWS / "README.md").read_text()

# The account's concurrent executions (raised from 10 to 1000, infra/aws/README.md,
# "The read API's connections"), and what Lambda keeps unreserved for the other functions
# ("You can reserve up to the Unreserved account concurrency value minus 100").
ACCOUNT_CONCURRENCY = 1000
UNRESERVED_MINIMUM = 100
CURRENT_MONTHLY_CEILING = 81


def one(pattern, text, what):
    found = re.findall(pattern, text)
    assert len(found) == 1, f"{what}: expected once, found {len(found)}"
    return found[0]


def resources(text, kind):
    """The body of each resource of a type, as text (two-space resource indentation)."""
    blocks = re.split(r"\n  (?=[A-Za-z0-9]+:\n)", text.split("\nResources:\n", 1)[1].split("\nOutputs:\n", 1)[0])
    return [block for block in blocks if re.search(rf"\n    Type: {re.escape(kind)}\n", "\n" + block)]


class BudgetTemplateTest(unittest.TestCase):
    def setUp(self):
        self.assertIn("budget.yaml", TEMPLATES, "infra/aws/budget.yaml is missing")
        self.text = TEMPLATES["budget.yaml"]

    def test_every_threshold_is_there_once(self):
        found = re.findall(
            r"NotificationType: (ACTUAL|FORECASTED), ComparisonOperator: GREATER_THAN, Threshold: (\d+), ThresholdType: PERCENTAGE",
            self.text)
        self.assertEqual(sorted(found), sorted([("ACTUAL", "50"), ("ACTUAL", "80"), ("ACTUAL", "100"), ("FORECASTED", "100")]))
        self.assertEqual(len(resources(self.text, "AWS::Budgets::Budget")), 1)
        self.assertIn("TimeUnit: MONTHLY", self.text)
        self.assertIn("BudgetType: COST", self.text)

    def test_no_address_in_the_template(self):
        self.assertNotRegex(self.text, r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
        email = one(r"\n  AlertEmail:\n((?:    .*\n)+)", self.text, "AlertEmail parameter")
        self.assertNotIn("Default:", email)
        addresses = re.findall(r"Address: ([^,}\n]+)", self.text)
        self.assertTrue(addresses)
        for address in addresses:
            self.assertIn(address.strip(), ("!Ref AlertEmail", "!Ref AlertTopicArn"))

    def test_the_budget_s_amount_is_near_the_current_spend(self):
        amount = one(r"\n  MonthlyBudget:\n((?:    .*\n)+)", self.text, "MonthlyBudget parameter")
        default = int(one(r"Default: (\d+)", amount, "MonthlyBudget default"))
        self.assertGreater(default, CURRENT_MONTHLY_CEILING)
        self.assertLessEqual(default, 2 * CURRENT_MONTHLY_CEILING)
        self.assertIn("Amount: !Ref MonthlyBudget", self.text)

    def test_one_services_monitor_at_most(self):
        monitors = resources(self.text, "AWS::CE::AnomalyMonitor")
        self.assertEqual(len(monitors), 1)
        self.assertIn("Condition: CreateMonitor", monitors[0])
        self.assertIn("MonitorDimension: SERVICE", monitors[0])
        one(r"CreateMonitor: !Equals \[!Ref ExistingServiceMonitorArn, ''\]", self.text, "CreateMonitor condition")

    def test_the_anomaly_subscription_mails_once_a_day_above_an_absolute_impact(self):
        subscriptions = resources(self.text, "AWS::CE::AnomalySubscription")
        self.assertEqual(len(subscriptions), 1)
        subscription = subscriptions[0]
        self.assertNotRegex(subscription, r"\n      Threshold:")
        self.assertIn("ANOMALY_TOTAL_IMPACT_ABSOLUTE", subscription)
        self.assertIn("GREATER_THAN_OR_EQUAL", subscription)
        self.assertIn("Frequency: DAILY", subscription)
        self.assertIn("!If [CreateMonitor, !Ref ServicesMonitor, !Ref ExistingServiceMonitorArn]", subscription)

    def test_the_cut_off_is_off_unless_asked_and_narrow(self):
        role = one(r"\n  LiveSchedulerRoleName:\n((?:    .*\n)+)", self.text, "LiveSchedulerRoleName parameter")
        self.assertIn("Default: ''", role)
        one(r"CutOff: !Not \[!Equals \[!Ref LiveSchedulerRoleName, ''\]\]", self.text, "CutOff condition")
        for kind in ("AWS::Budgets::BudgetsAction", "AWS::IAM::ManagedPolicy", "AWS::IAM::Role"):
            for block in resources(self.text, kind):
                self.assertIn("Condition: CutOff", block, kind)
        policy = one(r"PolicyDocument:\n((?:          .*\n)+)", resources(self.text, "AWS::IAM::ManagedPolicy")[0], "deny policy")
        self.assertIn("Effect: Deny", policy)
        self.assertNotIn("Effect: Allow", policy)
        self.assertIn("Action: 'ecs:RunTask'", policy)
        self.assertIn("task-definition/vega-v2-live:*", policy)

    def test_the_workflow_never_deploys_it_and_the_owner_has_the_command(self):
        self.assertNotIn("budget.yaml", DEPLOY)
        self.assertNotIn("vega-v2-budget", DEPLOY)
        command = one(r"(aws cloudformation deploy [^\n]*--stack-name vega-v2-budget [^\n]*)", README, "owner's command")
        self.assertIn("--template-file infra/aws/budget.yaml", command)
        self.assertIn("--region us-east-2", command)
        self.assertIn("AlertEmail=", command)


class ConcurrencyTest(unittest.TestCase):
    def test_the_live_read_has_a_limit_of_its_own(self):
        read = one(r"\n  Read:\n((?:    .*\n)+)", TEMPLATES["live.yaml"], "live Read function")
        copies = int(one(r"ReservedConcurrentExecutions: (\d+)\n", read, "live reserved concurrency"))
        self.assertGreaterEqual(copies, 1)
        self.assertLessEqual(copies, 20)

    def test_the_reservations_leave_the_account_its_unreserved_minimum(self):
        api_max = int(one(r"\n  ReservedConcurrency:\n    Type: Number\n    Default: \d+\n    MinValue: \d+\n    MaxValue: (\d+)\n",
                          TEMPLATES["api.yaml"], "API ReservedConcurrency maximum"))
        live = int(one(r"\n  Read:\n(?:    .*\n)+?      ReservedConcurrentExecutions: (\d+)\n", TEMPLATES["live.yaml"], "live reserved"))
        self.assertLessEqual(api_max + live, ACCOUNT_CONCURRENCY - UNRESERVED_MINIMUM)


class EveryTemplateTest(unittest.TestCase):
    def test_every_log_group_has_a_retention(self):
        for name, text in TEMPLATES.items():
            for block in resources(text, "AWS::Logs::LogGroup"):
                self.assertRegex(block, r"RetentionInDays: \d+", name)

    def test_every_function_has_a_reserved_concurrency(self):
        for name, text in TEMPLATES.items():
            for block in resources(text, "AWS::Lambda::Function"):
                self.assertIn("ReservedConcurrentExecutions:", block, name)

    def test_every_repository_expires_its_old_images(self):
        for name, text in TEMPLATES.items():
            for block in resources(text, "AWS::ECR::Repository"):
                self.assertIn('"countType":"imageCountMoreThan"', block, name)


if __name__ == "__main__":
    unittest.main()
