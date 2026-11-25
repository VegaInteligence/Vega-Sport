"""Countries refused by the read API (infra/aws/api.yaml, Distribution).

hugo's decision of 25 November 2026: North Korea only, for now.

Failure modes, and what is expected:
- the block missing or dropped by a later edit -> the distribution carries a GeoRestriction;
- the wrong list type (whitelist would refuse every other country) -> RestrictionType blacklist;
- a country added or removed without a decision -> the list is exactly [KP];
- a lower-case or three-letter code that CloudFront refuses -> ISO 3166-1 alpha-2, upper case.
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


class ApiGeoBlockTest(unittest.TestCase):
    def setUp(self):
        self.distribution = block("Distribution")

    def test_the_distribution_refuses_listed_countries(self):
        found = re.search(
            r"\n        Restrictions:\n          GeoRestriction:\n            RestrictionType: (\w+)\n            Locations: \[([^\]]*)\]\n",
            self.distribution,
        )
        self.assertIsNotNone(found, "Restrictions.GeoRestriction missing from the distribution")
        self.assertEqual(found.group(1), "blacklist")
        self.assertEqual([code.strip() for code in found.group(2).split(",")], ["KP"])


if __name__ == "__main__":
    unittest.main()
