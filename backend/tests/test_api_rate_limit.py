"""Per-address request limit of the read API's distribution (VI-35, A.1).

On 20 November 2026 the distribution had no web ACL: one address asking reads the cache
does not hold could take the function's 32 copies, and every other visitor got 429s.
infra/aws/waf.yaml is a web ACL with rate-based rules, counted first for a week (the plan
approved by the owner), then blocking; the site's server is exempt by a secret header.

Failure modes, and what is expected:
- the web ACL declared outside us-east-1, or with the REGIONAL scope -> CloudFront refuses
  it: Scope is CLOUDFRONT, the template asserts us-east-1, deploy.sh deploys vega-v2-waf
  there and nowhere else;
- the default mode blocks instead of counting -> Mode defaults to Count, and the only
  Block action is the one chosen by Mode=Block; deploy.sh never sets Block by itself
  (WAF_MODE does, and a deploy without it keeps the stack's mode);
- a block that the site cannot read -> 429 with Retry-After (longer than the 2 s the
  site's clients wait, so they do not retry into the block), CORS open (a browser hides
  a response without it), no-store, and a JSON body in the API's error shape;
- the exemption lets anyone through: a header without its secret, a short or empty
  secret, a prefix match -> the key is 32 to 128 characters or absent; without it there
  is no exemption at all; with it the header must equal it exactly; the header only ever
  takes requests out of a rule's count, no rule allows anything;
- the association becomes mandatory -> WebAclArn in api.yaml is empty by default and
  the distribution then has no WebACLId, as before;
- a limit under what a normal page asks -> the API limit holds at least 20 cold pages
  of the heaviest page counted in the site (PAGE_API_REQUESTS); its window is 5 minutes,
  which evens out a page's burst; two counting probes bracket it to choose the final one;
- nothing to choose the limit with -> every rule and the web ACL publish CloudWatch
  metrics and keep sampled requests;
- a deploy that stops halfway on a missing permission (infra/aws/README.md) -> the
  CloudFormation role may change the vega-v2-* web ACLs of us-east-1, and the deploy
  role may deploy the vega-v2-waf stack there; nothing wider.
"""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
AWS = ROOT / "infra/aws"
API = (AWS / "api.yaml").read_text()
DEPLOY = (AWS / "deploy.sh").read_text()
ROLES = (AWS / "deploy-roles.yaml").read_text()
CI = (ROOT / ".github/workflows/ci.yml").read_text()

# The heaviest cold page counted in the site's code (a club's profile: its compact read,
# its manifest and status, its fifteen comparison reads, the European pool and one read
# per pool competition, then one /api/assets redirect per crest and portrait in view).
# Requests to /data/ (the image copies, served from the cache, never the function) are
# not counted by the API rule.
PAGE_API_REQUESTS = 75


def waf():
    path = AWS / "waf.yaml"
    assert path.exists(), "infra/aws/waf.yaml is missing"
    return path.read_text()


def one(pattern, text, what):
    found = re.findall(pattern, text, re.S)
    assert len(found) == 1, f"{what}: expected once, found {len(found)}"
    return found[0]


def parameter(text, name):
    return one(rf"\n  {name}:\n((?:    [^\n]*\n)+)", text, f"parameter {name}")


def default(text, name):
    return one(r"Default: '?([^'\n]*)'?\n", parameter(text, name), f"{name} default")


def rules(text):
    body = one(r"\n      Rules:\n(.*?)\n      VisibilityConfig:", text, "web ACL rules")
    return re.split(r"\n        - Name: ", "\n" + body)[1:]


class WebAclPlacementTest(unittest.TestCase):
    def test_cloudfront_scope_in_us_east_1(self):
        t = waf()
        self.assertEqual(one(r"\n      Scope: (\w+)\n", t, "Scope"), "CLOUDFRONT")
        self.assertIn("AWS::WAFv2::WebACL", t)
        self.assertRegex(t, r"Assert: !Equals \[!Ref 'AWS::Region', us-east-1\]")

    def test_deploy_puts_the_stack_in_us_east_1(self):
        line = one(r"\n(.*stack vega-v2-waf waf\.yaml.*)\n", DEPLOY, "waf stack deploy")
        self.assertIn("--region us-east-1", line)


class ModeTest(unittest.TestCase):
    def test_counting_is_the_default(self):
        t = waf()
        self.assertEqual(default(t, "Mode"), "Count")
        self.assertIn("AllowedValues: [Count, Block]", parameter(t, "Mode"))

    def test_only_mode_block_blocks(self):
        t = waf()
        self.assertEqual(one(r"\n  Blocking: ([^\n]*)\n", t, "Blocking condition"), "!Equals [!Ref Mode, Block]")
        for rule in rules(t):
            action = one(r"\n          Action:(.*?)\n          (?:Statement|VisibilityConfig):", rule, "rule action")
            if "Block" in action:
                self.assertRegex(action, r"^ !If\n\s+- Blocking\n\s+- Block:", rule.split("\n")[0])
                self.assertTrue(action.rstrip().endswith("- Count: {}"), rule.split("\n")[0])
        self.assertIn("DefaultAction: {Allow: {}}", t)

    def test_the_deploy_never_chooses_block_itself(self):
        self.assertNotRegex(DEPLOY, r"Mode=Block")
        self.assertRegex(DEPLOY, r'Mode="\$WAF_MODE"')


class BlockResponseTest(unittest.TestCase):
    def test_a_readable_429(self):
        t = waf()
        self.assertIn("ResponseCode: 429", t)
        blocks = re.findall(r"ResponseHeaders:\n((?:\s+- \{Name: [^\n]*\}\n)+)", t)
        self.assertEqual(len(blocks), t.count("ResponseCode: 429"))
        self.assertEqual(len(set(blocks)), 1)
        names = dict(re.findall(r"Name: ([\w-]+), Value: '?([^'}]*)'?\}", blocks[0]))
        self.assertEqual(names.get("Access-Control-Allow-Origin"), "*")
        self.assertIn("Retry-After", names.get("Access-Control-Expose-Headers", ""))
        self.assertEqual(names.get("Cache-Control"), "no-store")
        self.assertIn("Retry-After", names)
        retry = int(default(t, "RetryAfterSeconds"))
        self.assertGreater(retry, 2)  # the site's clients give up beyond 2 s instead of retrying
        self.assertIn("ContentType: APPLICATION_JSON", t)
        self.assertIn('"code":"RATE_LIMITED"', t)


class ExemptionTest(unittest.TestCase):
    def test_the_key_is_long_or_absent(self):
        t = waf()
        for name in ("SiteKey", "PreviousSiteKey"):
            p = parameter(t, name)
            self.assertIn("NoEcho: true", p)
            self.assertIn("AllowedPattern: '([A-Za-z0-9_-]{32,128})?'", p)
            self.assertEqual(default(t, name), "")

    def test_no_key_no_exemption(self):
        t = waf()
        self.assertEqual(one(r"\n  HasSiteKey: ([^\n]*)\n", t, "HasSiteKey"), "!Not [!Equals [!Ref SiteKey, '']]")
        self.assertIn("HasPreviousSiteKey: !And [!Condition HasSiteKey, !Not [!Equals [!Ref PreviousSiteKey, '']]]", t)
        # Every scope of a rule, the only place the key appears, is behind the condition.
        scopes = re.findall(r"ScopeDownStatement: ([^\n]*)\n\s+- ([^\n]*)\n", t)
        self.assertEqual(len(scopes), t.count("RateBasedStatement:"))
        for head, condition in scopes:
            self.assertEqual((head, condition), ("!If", "HasSiteKey  # SiteKeyExempt"))

    def test_exact_match_on_the_header_only(self):
        t = waf()
        matches = re.findall(r"ByteMatchStatement: \{FieldToMatch: \{SingleHeader: \{Name: (\S+)\}\}, PositionalConstraint: (\w+), SearchString: !Ref (\w+)", t)
        self.assertEqual({m[2] for m in matches}, {"PreviousSiteKey", "SiteKey"})
        self.assertEqual(len(re.findall(r"SearchString: !Ref \w*SiteKey", t)), len(matches))
        for header, constraint, _ in matches:
            self.assertEqual(header, "x-vega-edge-key")
            self.assertEqual(constraint, "EXACTLY")

    def test_no_rule_allows(self):
        for rule in rules(waf()):
            self.assertNotRegex(rule, r"\bAllow: \{")


class AssociationTest(unittest.TestCase):
    def test_optional_and_empty_by_default(self):
        p = parameter(API, "WebAclArn")
        self.assertEqual(default(API, "WebAclArn"), "")
        self.assertIn("arn:aws:wafv2:us-east-1:", p)
        self.assertIn("HasWebAcl: !Not [!Equals [!Ref WebAclArn, '']]", API)
        self.assertIn("WebACLId: !If [HasWebAcl, !Ref WebAclArn, !Ref 'AWS::NoValue']", API)

    def test_the_deploy_passes_the_web_acl(self):
        self.assertRegex(DEPLOY, r'WebAclArn="\$web_acl"')
        self.assertIn("WebAclArn", waf().split("\nOutputs:")[1])


class LimitTest(unittest.TestCase):
    def test_the_api_limit_holds_many_pages(self):
        t = waf()
        limit = int(default(t, "ApiLimit"))
        self.assertGreaterEqual(limit, 20 * PAGE_API_REQUESTS)
        self.assertGreaterEqual(int(one(r"MinValue: (\d+)", parameter(t, "ApiLimit"), "ApiLimit min")), 4 * PAGE_API_REQUESTS)
        self.assertGreater(int(default(t, "AllLimit")), limit)

    def test_rate_rules_by_address_over_five_minutes(self):
        t = waf()
        statements = re.findall(r"RateBasedStatement:\n(.*?)\n          VisibilityConfig:", t, re.S)
        self.assertGreaterEqual(len(statements), 4)
        for s in statements:
            self.assertIn("AggregateKeyType: IP", s)  # the viewer's address, not a header it writes
            self.assertIn("EvaluationWindowSec: 300", s)

    def test_probes_bracket_the_limit_and_only_count(self):
        t = waf()
        limit = int(default(t, "ApiLimit"))
        probes = [r for r in rules(t) if r.startswith("vega-v2-api-probe-")]
        values = sorted(int(one(r"Limit: (\d+)", r, "probe limit")) for r in probes)
        self.assertEqual(len(values), 2)
        self.assertLess(values[0], limit)
        self.assertGreater(values[1], limit)
        for r in probes:
            self.assertIn("Action: {Count: {}}", r)

    def test_images_do_not_spend_the_api_limit(self):
        self.assertRegex(waf(), r"SearchString: /data/")


class VisibilityTest(unittest.TestCase):
    def test_metrics_and_samples_everywhere(self):
        t = waf()
        configs = re.findall(r"VisibilityConfig: \{(.*?)\}", t)
        self.assertEqual(len(configs), len(rules(t)) + 1)
        for c in configs:
            self.assertIn("SampledRequestsEnabled: true", c)
            self.assertIn("CloudWatchMetricsEnabled: true", c)
            self.assertRegex(c, r"MetricName: vega-v2-")


class PermissionsTest(unittest.TestCase):
    def test_cloudformation_role_changes_the_vega_web_acls_of_us_east_1(self):
        block = one(r"\n              # BEGIN VI-35 web ACL.*?\n(.*?)\n              # END VI-35 web ACL", ROLES, "CloudFormation role WAF block")
        self.assertIn("wafv2:CreateWebACL", block)
        self.assertIn("wafv2:UpdateWebACL", block)
        self.assertIn("wafv2:DeleteWebACL", block)
        self.assertIn("wafv2:GetWebACL", block)
        self.assertIn(":wafv2:us-east-1:${AWS::AccountId}:global/webacl/vega-v2-*/*", block)
        self.assertNotIn("wafv2:*", block)

    def test_deploy_role_deploys_the_waf_stack_in_us_east_1(self):
        block = one(r"\n              # BEGIN VI-35 waf stack.*?\n(.*?)\n              # END VI-35 waf stack", ROLES, "deploy role WAF block")
        self.assertIn(":cloudformation:us-east-1:${AWS::AccountId}:stack/vega-v2-waf/*", block)

    def test_ci_lints_it_in_its_region(self):
        self.assertIn("cfn-lint --regions us-east-1 -- infra/aws/waf.yaml", CI)


if __name__ == "__main__":
    unittest.main()
