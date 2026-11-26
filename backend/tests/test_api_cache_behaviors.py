"""The edge cache of the read API and the live reads (infra/aws/api.yaml; FAILURE_MODES_OPTIMISATIONS.md GH137-l, GH145).

Failure modes, and what is expected:
- the route's hour cut to a minute by the default policy (MaxTTL 60) -> a behaviour of its own, its cache policy
  MaxTTL 3600, the route's own s-maxage (GH137-l);
- every other answer that says more than a minute (profiles 300, archives 3600, the asset redirection 86400) cut to a
  minute -> the default policy's MaxTTL is a year: the origin decides (GH145-a);
- /live/config's minute cut to 2 s by LiveCache (MaxTTL 2) -> a behaviour for exactly live/config, before live/*, with
  its own policy (MaxTTL 60, DefaultTTL 2); LiveCache unchanged (MaxTTL 2), so a live match state is never served from
  an expired copy longer than before while the live function fails (GH145-b);
- an answer without freshness kept anyway, an error kept -> MinTTL 0 and DefaultTTL 0 on the API's policies, every
  listed error code at ErrorCachingMinTTL 0 (GH145-a, GH145-c);
- one season served for another (a cache key without the query) or a key split by headers or cookies -> the default
  policy's cache key, line for line (no cookie, no header, every query string, gzip and brotli);
- other routes held an hour, the private or live ones included -> the pattern is the route's path exactly (no wildcard),
  no other behaviour uses the new policy (GH137-l); no behaviour added, removed or moved to another policy (GH145-c);
- the behaviour losing what the default gives (the origin, HTTPS, OPTIONS for CORS, compression, the validators sent to
  the origin, the response headers) -> the default behaviour's settings, but the cache policy;
- a freshness the code says above the ceiling of the behaviour that serves it (silently cut) -> checked on the real
  helpers and answers by backend/api/test/edge-ttl.test.mjs (GH145-d to f), not by a scan of the sources.
"""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TEMPLATE = (ROOT / "infra/aws/api.yaml").read_text()
ROUTE = (ROOT / "backend/api/src/routes/league-history.mjs").read_text()
YEAR = 31536000
# The managed policies (AWS's ids): CachingOptimized on the image copies, CachingDisabled on the status page.
CACHING_OPTIMIZED, CACHING_DISABLED = "658327ea-f89d-4fab-a63d-7e88639e58f6", "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"


def block(name):
    found = re.findall(rf"\n  {name}:\n((?:    .*\n|\n)+?)(?=  \S)", TEMPLATE)
    assert len(found) == 1, f"{name}: expected once, found {len(found)}"
    return found[0]


def settings(text):
    """A behaviour's settings, one per line, as key -> value."""
    pairs = (line.strip().removeprefix("- ").split(": ", 1) for line in text.splitlines() if ": " in line)
    return {key: value for key, value in pairs}


def behaviours():
    distribution = block("Distribution")
    listed = re.search(r"\n        CacheBehaviors:\n((?:          .*\n)+)", distribution).group(1)
    items = [i for i in re.split(r"\n(?=          - )", "\n" + listed) if i.strip()]
    default = re.search(r"\n        DefaultCacheBehavior:\n((?:          .*\n)+)", distribution).group(1)
    return [settings(i) for i in items], settings(default)


def ttls(policy):
    """MinTTL, DefaultTTL and MaxTTL of a cache policy of the template."""
    text = block(policy)
    return tuple(int(re.search(rf"\n        {name}: (\d+)\n", text).group(1)) for name in ("MinTTL", "DefaultTTL", "MaxTTL"))


def key(policy):
    return block(policy).split("ParametersInCacheKeyAndForwardedToOrigin:\n", 1)[1]


class LeagueHistoryEdgeCacheTest(unittest.TestCase):
    def test_its_own_policy_an_hour_at_most(self):
        policy = block("LeagueHistoryCache")
        self.assertIn("Name: vega-v2-api-league-history", policy)
        self.assertEqual(ttls("LeagueHistoryCache"), (0, 0, 3600))
        self.assertEqual(key("LeagueHistoryCache"), key("Cache"))

    def test_one_behaviour_for_exactly_the_route_as_the_default_one(self):
        listed, default = behaviours()
        mine = [b for b in listed if b.get("CachePolicyId") == "!Ref LeagueHistoryCache"]
        self.assertEqual(len(mine), 1, "one behaviour uses the policy")
        self.assertEqual(mine[0]["PathPattern"], "api/league-history")
        self.assertEqual(default["CachePolicyId"], "!Ref Cache")
        expected = {**default, "CachePolicyId": "!Ref LeagueHistoryCache", "PathPattern": "api/league-history"}
        self.assertEqual(mine[0], expected)
        for other in listed:
            self.assertFalse(re.search(r"league-history|^\*|^api/\*", other["PathPattern"]) and other is not mine[0], other)

    def test_the_route_s_freshness_fits_the_policy(self):
        self.assertIn('path === "/api/league-history"', ROUTE)
        found = {int(v) for v in re.findall(r"ttl: (\d+)", ROUTE)}
        self.assertEqual(found, {3600})
        self.assertLessEqual(max(found), ttls("LeagueHistoryCache")[2])


class OriginDecidesTest(unittest.TestCase):
    """GH145: the ceilings no longer cut what the read API says; live match states keep their bound."""

    def test_the_default_policy_lets_the_origin_decide(self):
        default = block("Cache")
        self.assertIn("        Name: vega-v2-api\n", default)
        # An answer without freshness is still kept by no one; a year is the longest the read API's helper may say.
        self.assertEqual(ttls("Cache"), (0, 0, YEAR))

    def test_the_default_cache_key_is_unchanged(self):
        self.assertEqual(
            key("Cache"),
            "          CookiesConfig: {CookieBehavior: none}\n"
            "          HeadersConfig: {HeaderBehavior: none}\n"
            "          QueryStringsConfig: {QueryStringBehavior: all}\n"
            "          EnableAcceptEncodingBrotli: true\n"
            "          EnableAcceptEncodingGzip: true\n",
        )

    def test_live_match_states_keep_their_policy(self):
        live = block("LiveCache")
        self.assertIn("        Name: vega-v2-live\n", live)
        self.assertEqual(ttls("LiveCache"), (0, 2, 2))
        self.assertEqual(
            key("LiveCache"),
            "          CookiesConfig: {CookieBehavior: none}\n"
            "          HeadersConfig: {HeaderBehavior: none}\n"
            "          QueryStringsConfig: {QueryStringBehavior: none}\n"
            "          EnableAcceptEncodingBrotli: true\n"
            "          EnableAcceptEncodingGzip: true\n",
        )

    def test_live_config_has_its_own_minute(self):
        config = block("LiveConfigCache")
        self.assertIn("        Name: vega-v2-live-config\n", config)
        self.assertEqual(ttls("LiveConfigCache"), (0, 2, 60))
        self.assertEqual(key("LiveConfigCache"), key("LiveCache"))

    def test_one_behaviour_for_exactly_live_config_before_live_matches(self):
        listed, _ = behaviours()
        patterns = [b["PathPattern"] for b in listed]
        self.assertIn("live/config", patterns)
        self.assertLess(patterns.index("live/config"), patterns.index("live/*"), "the first matching pattern wins")
        mine = [b for b in listed if b.get("CachePolicyId") == "!Ref LiveConfigCache"]
        self.assertEqual([b["PathPattern"] for b in mine], ["live/config"], "one behaviour uses the policy")
        matches = listed[patterns.index("live/*")]
        self.assertEqual(mine[0], {**matches, "PathPattern": "live/config", "CachePolicyId": "!Ref LiveConfigCache"})

    def test_the_behaviours_and_their_policies_are_unchanged(self):
        listed, default = behaviours()
        self.assertEqual(
            [(b["PathPattern"], b["CachePolicyId"], b["TargetOriginId"]) for b in listed],
            [
                ("data/*", CACHING_OPTIMIZED, "media"),
                ("live/config", "!Ref LiveConfigCache", "live"),
                ("live/*", "!Ref LiveCache", "live"),
                ("api/ops/*", CACHING_DISABLED, "api"),
                ("api/league-history", "!Ref LeagueHistoryCache", "api"),
            ],
        )
        self.assertEqual((default["CachePolicyId"], default["TargetOriginId"]), ("!Ref Cache", "api"))
        self.assertEqual(default["OriginRequestPolicyId"], "!Ref Validators")
        self.assertEqual(TEMPLATE.count("CachePolicyId: !Ref Cache\n"), 1, "the default behaviour alone uses the default policy")
        self.assertEqual(TEMPLATE.count("CachePolicyId: !Ref LiveCache\n"), 1, "live/* alone uses the live policy")
        ops = listed[[b["PathPattern"] for b in listed].index("api/ops/*")]
        self.assertEqual(ops["OriginRequestPolicyId"], "!Ref OpsHeaders")

    def test_errors_are_never_kept(self):
        distribution = block("Distribution")
        codes = re.findall(r"\{ErrorCode: (\d+), ErrorCachingMinTTL: (\d+)\}", distribution)
        self.assertEqual({int(c) for c, _ in codes}, {400, 403, 404, 405, 500, 502, 503, 504})
        self.assertEqual({int(t) for _, t in codes}, {0})


if __name__ == "__main__":
    unittest.main()
