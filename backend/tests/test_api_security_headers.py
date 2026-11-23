"""The read API's response headers (infra/aws/api.yaml, ViewerHeaders).

Failure modes, and what is expected:
- HTTPS not remembered -> Strict-Transport-Security, two years, includeSubDomains (the
  distribution's host has none of its own), never preload (a cloudfront.net name cannot be);
- a JSON or an image answer opened as a page, or framed by another site -> a policy that
  allows nothing (default-src 'none', frame-ancestors 'none') and X-Frame-Options DENY;
- the address of the page that read the API sent on -> Referrer-Policy no-referrer;
- the security headers overriding the CORS the site depends on -> CorsConfig unchanged:
  any origin, GET/HEAD/OPTIONS, no credentials, the same exposed headers;
- a behavior left without the policy -> the default behavior and live/* use it (data/*, the
  image copies, and api/ops/* are left as they are: see the security headers report).
"""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TEMPLATE = (ROOT / "infra/aws/api.yaml").read_text()


def block(name):
    found = re.findall(rf"\n  {name}:\n((?:    .*\n|\n)+?)(?=  \S)", TEMPLATE)
    assert len(found) == 1, f"{name}: expected once, found {len(found)}"
    return found[0]


class ApiSecurityHeadersTest(unittest.TestCase):
    def setUp(self):
        self.policy = block("ViewerHeaders")
        security = re.search(r"\n        SecurityHeadersConfig:\n((?:          .*\n)+)", self.policy)
        self.assertIsNotNone(security, "SecurityHeadersConfig missing")
        self.security = security.group(1)

    def test_https_is_remembered(self):
        self.assertIn(
            "StrictTransportSecurity: {AccessControlMaxAgeSec: 63072000, IncludeSubdomains: true, Preload: false, Override: true}",
            self.security,
        )

    def test_answers_are_not_pages(self):
        self.assertIn("ContentTypeOptions: {Override: true}", self.security)
        self.assertIn("FrameOptions: {FrameOption: DENY, Override: true}", self.security)
        self.assertIn("ReferrerPolicy: {ReferrerPolicy: no-referrer, Override: true}", self.security)
        csp = re.search(r"ContentSecurityPolicy: \{ContentSecurityPolicy: \"([^\"]+)\", Override: true\}", self.security)
        self.assertIsNotNone(csp, "ContentSecurityPolicy missing")
        directives = dict(
            (part.split()[0], part.split()[1:]) for part in (p.strip() for p in csp.group(1).split(";")) if part
        )
        self.assertEqual(directives["default-src"], ["'none'"])
        self.assertEqual(directives["frame-ancestors"], ["'none'"])
        self.assertNotIn("*", csp.group(1))

    def test_cors_is_unchanged(self):
        self.assertIn(
            """        CorsConfig:
          AccessControlAllowCredentials: false
          AccessControlAllowHeaders: {Items: ['*']}
          AccessControlAllowMethods: {Items: [GET, HEAD, OPTIONS]}
          AccessControlAllowOrigins: {Items: ['*']}
          AccessControlExposeHeaders:
            Items: [ETag, Content-Length, Cache-Control, Age, X-Cache, X-Data-Source, Server-Timing, Retry-After, X-Amzn-ErrorType]
          OriginOverride: true
""",
            self.policy,
        )

    def test_the_reads_carry_the_policy(self):
        distribution = block("Distribution")
        self.assertEqual(distribution.count("ResponseHeadersPolicyId: !Ref ViewerHeaders"), 2)
        live = re.search(r"- PathPattern: live/\*\n((?:            .*\n)+)", distribution).group(1)
        self.assertIn("ResponseHeadersPolicyId: !Ref ViewerHeaders", live)
        default = re.search(r"DefaultCacheBehavior:\n((?:          .*\n)+)", distribution).group(1)
        self.assertIn("ResponseHeadersPolicyId: !Ref ViewerHeaders", default)


if __name__ == "__main__":
    unittest.main()
