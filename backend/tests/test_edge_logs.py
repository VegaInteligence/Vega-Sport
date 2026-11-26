"""The distribution's access logs (FAILURE_MODES_OPTIMISATIONS.md GH149-f to h, written before these tests): the edge
logs stack, the function on the behaviours, the deploy's step and the roles. The function and the report themselves are
run by backend/api/test/edge-logs.test.mjs. Rerun: PYTHONPATH=backend:backend/tests python3 -m unittest -v test_edge_logs
"""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
AWS = ROOT / "infra/aws"
FIELDS = ["timestamp(ms)", "cache-behavior-path-pattern", "viewer-request-log-data", "cs-method", "sc-status", "x-edge-result-type",
          "x-edge-response-result-type", "x-edge-detailed-result-type", "time-taken", "time-to-first-byte", "origin-fbl", "origin-lbl",
          "sc-bytes"]
NEVER = ["c-ip", "x-forwarded-for", "cs-uri-stem", "cs-uri-query", "cs(Cookie)", "cs(User-Agent)", "cs(Referer)", "x-edge-request-id",
         "c-country", "asn", "x-host-header", "cs(Host)", "c-port", "s-ip"]


def text(name):
    path = AWS / name
    return path.read_text() if path.exists() else ""


def resource(body, name):
    found = re.search(rf"\n  {name}:\n((?:(?:    .*)?\n)+)", body + "\n")
    assert found, f"no resource {name}"
    return found.group(1)


class EdgeLogsTemplateTest(unittest.TestCase):
    def setUp(self):
        self.edge = text("edge-logs.yaml")
        self.api = text("api.yaml")
        self.deploy = text("deploy.sh")
        self.roles = text("deploy-roles.yaml")
        self.ci = (ROOT / ".github/workflows/ci.yml").read_text()
        self.assertTrue(self.edge, "infra/aws/edge-logs.yaml is missing")

    def test_GH149_f_the_stack_in_us_east_1_its_group_and_its_fields(self):
        self.assertRegex(self.edge, r"!Equals \[!Ref 'AWS::Region', us-east-1\]")
        group = resource(self.edge, "AccessLog")
        self.assertIn("Type: AWS::Logs::LogGroup", group)
        name = re.search(r"LogGroupName: (\S+)", group).group(1)
        self.assertRegex(name, r"^[\w-]+$")
        self.assertEqual(name, "vega-v2-api-access")
        self.assertIn("RetentionInDays: 14", group)
        source = resource(self.edge, "AccessSource")
        self.assertIn("Type: AWS::Logs::DeliverySource", source)
        self.assertIn("LogType: ACCESS_LOGS", source)
        self.assertIn("ResourceArn: !Sub 'arn:${AWS::Partition}:cloudfront::${AWS::AccountId}:distribution/${DistributionId}'", source)
        destination = resource(self.edge, "AccessDestination")
        self.assertIn("Type: AWS::Logs::DeliveryDestination", destination)
        self.assertIn("OutputFormat: json", destination)
        # The log group's ARN without the «:*» its GetAtt Arn ends with (the delivery API names a group by its plain ARN).
        self.assertIn("DestinationResourceArn: !Sub 'arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:${AccessLog}'", destination)
        delivery = resource(self.edge, "AccessDelivery")
        self.assertIn("Type: AWS::Logs::Delivery", delivery)
        fields = [line.strip()[2:].strip("'") for line in re.search(r"RecordFields:\n((?: {8}- .*\n)+)", delivery).group(1).splitlines()]
        self.assertEqual(fields, FIELDS)
        for field in NEVER:
            self.assertNotIn(f"- {field}\n", self.edge)
            self.assertNotIn(f"- '{field}'\n", self.edge)
        # GH149-i: the four saved queries, each family's times from its own group.
        names = {"CacheQuery": "vega-v2/api-cache-by-family", "LatencyQuery": "vega-v2/api-latency-by-family",
                 "OtherLatencyQuery": "vega-v2/api-latency-other", "MediaLatencyQuery": "vega-v2/api-latency-media"}
        for query, name in names.items():
            block = resource(self.edge, query)
            self.assertIn("Type: AWS::Logs::QueryDefinition", block)
            self.assertIn("LogGroupNames: [!Ref AccessLog]", block)
            self.assertIn(f"Name: {name}", block)
        self.assertEqual(self.edge.count("Type: AWS::Logs::QueryDefinition"), 4)
        self.assertIn('filter behaviour != "data/*"', resource(self.edge, "LatencyQuery"))
        self.assertIn('family != "other"', resource(self.edge, "LatencyQuery"))
        self.assertIn('filter behaviour = "data/*"', resource(self.edge, "MediaLatencyQuery"))
        self.assertNotIn(" by ", resource(self.edge, "MediaLatencyQuery").split("stats", 1)[1], "media: one group")
        self.assertNotIn(" by ", resource(self.edge, "OtherLatencyQuery").split("stats", 1)[1], "other: one group")
        self.assertRegex(self.ci, r"cfn-lint --regions us-east-1 -- infra/aws/edge-logs\.yaml")

    def test_GH149_g_the_function_on_four_behaviours_and_nothing_else_changed(self):
        function = resource(self.api, "EdgeFamily")
        self.assertIn("Type: AWS::CloudFront::Function", function)
        self.assertIn("Runtime: cloudfront-js-2.0", function)
        self.assertIn("AutoPublish: true", function)
        association = "FunctionAssociations: [{EventType: viewer-request, FunctionARN: !GetAtt EdgeFamily.FunctionMetadata.FunctionARN}]"
        distribution = resource(self.api, "Distribution")
        behaviours = re.split(r"\n          - PathPattern: ", distribution.split("DefaultCacheBehavior:")[0])[1:]
        by_pattern = {b.split("\n", 1)[0]: b for b in behaviours}
        # live/config: its own cache policy since GH145 (FAILURE_MODES_OPTIMISATIONS.md), the family function as live/*.
        self.assertEqual(sorted(by_pattern), ["api/league-history", "api/ops/*", "data/*", "live/*", "live/config"])
        for pattern in ("api/league-history", "api/ops/*", "live/*", "live/config"):
            self.assertIn(association, by_pattern[pattern], pattern)
        self.assertNotIn("FunctionAssociations", by_pattern["data/*"])
        self.assertIn(association, distribution.split("DefaultCacheBehavior:")[1])
        # Nothing else of the behaviours moved: their cache and origin request policies, as before.
        self.assertIn("CachePolicyId: !Ref Cache\n          OriginRequestPolicyId: !Ref Validators", distribution)
        self.assertIn("CachePolicyId: !Ref LeagueHistoryCache", by_pattern["api/league-history"])
        self.assertIn("CachePolicyId: 658327ea-f89d-4fab-a63d-7e88639e58f6", by_pattern["data/*"])

    def test_GH149_h_the_deploy_step_and_the_roles(self):
        line = re.search(r"^\s*stack vega-v2-edge-logs edge-logs\.yaml --region us-east-1 [^\n]*$", self.deploy, re.M)
        self.assertIsNotNone(line, "deploy.sh deploys vega-v2-edge-logs in us-east-1")
        self.assertIn('DistributionId="$(output vega-v2-api DistributionId)"', line.group(0))
        self.assertLess(self.deploy.index("stack vega-v2-api api.yaml"), line.start())
        self.assertIn(":cloudformation:us-east-1:${AWS::AccountId}:stack/vega-v2-edge-logs/*", self.roles)
        statements = re.findall(r"- Sid: EdgeLogs\w*\n(?:(?!\s+- Sid:).*\n)+", self.roles)
        self.assertTrue(statements, "the CloudFormation role's EdgeLogs statements")
        block = "".join(statements)
        for action in ("logs:PutDeliverySource", "logs:PutDeliveryDestination", "logs:CreateDelivery", "logs:DeleteDelivery",
                       "logs:PutQueryDefinition", "logs:DeleteQueryDefinition"):
            self.assertIn(action, block)
        self.assertIn(":logs:us-east-1:${AWS::AccountId}:delivery-source:vega-v2-*", block)
        self.assertIn(":logs:us-east-1:${AWS::AccountId}:delivery-destination:vega-v2-*", block)
        self.assertIn(":logs:us-east-1:${AWS::AccountId}:log-group:vega-v2-api-access*", self.roles)
        delivery = re.search(r"- Sid: EdgeLogs\n(?:(?!\s+- Sid:).*\n)+", self.roles).group(0)
        self.assertIn("logs:PutDeliverySource", delivery)
        self.assertNotIn("Resource: '*'", delivery, "the delivery rights on named resources only")


if __name__ == "__main__":
    unittest.main()
