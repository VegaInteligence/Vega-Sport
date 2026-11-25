"""The edge cache of /api/league-history (infra/aws/api.yaml; GH #145 for this route, FAILURE_MODES_OPTIMISATIONS.md, GH137-l).

Failure modes, and what is expected:
- the route's hour cut to a minute by the default policy (MaxTTL 60) -> a behaviour of its own, its cache policy
  MaxTTL 3600, the route's own s-maxage;
- an answer without freshness kept anyway, an error kept -> MinTTL 0 and DefaultTTL 0, as the default policy;
- one season served for another (a cache key without the query) or a key split by headers or cookies -> the default
  policy's cache key, line for line (no cookie, no header, every query string, gzip and brotli);
- other routes held an hour, the private or live ones included -> the pattern is the route's path exactly (no wildcard),
  no other behaviour uses the new policy, the default policy keeps MaxTTL 60;
- the behaviour losing what the default gives (the origin, HTTPS, OPTIONS for CORS, compression, the validators sent to
  the origin, the response headers) -> the default behaviour's settings, but the cache policy.
"""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TEMPLATE = (ROOT / "infra/aws/api.yaml").read_text()
ROUTE = (ROOT / "backend/api/src/routes/league-history.mjs").read_text()


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


class LeagueHistoryEdgeCacheTest(unittest.TestCase):
    def test_its_own_policy_an_hour_at_most(self):
        policy = block("LeagueHistoryCache")
        self.assertIn("Name: vega-v2-api-league-history", policy)
        for line in ("MinTTL: 0", "DefaultTTL: 0", "MaxTTL: 3600"):
            self.assertIn(f"        {line}\n", policy)
        key = lambda text: text.split("ParametersInCacheKeyAndForwardedToOrigin:\n", 1)[1]
        self.assertEqual(key(policy), key(block("Cache")))

    def test_the_default_policy_is_unchanged(self):
        default = block("Cache")
        for line in ("Name: vega-v2-api", "MinTTL: 0", "DefaultTTL: 0", "MaxTTL: 60"):
            self.assertIn(f"        {line}\n", default)

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
        ttls = {int(v) for v in re.findall(r"ttl: (\d+)", ROUTE)}
        self.assertEqual(ttls, {3600})


if __name__ == "__main__":
    unittest.main()
