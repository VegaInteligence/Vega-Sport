"""The publisher must never reconstruct obsolete World Cup year buckets."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/"dashboard/scripts"))
from relational_materialize import canonical_source_aliases, canonical_known_scopes


class Source:
    def __init__(self):
        self.calls=[]
    def execute(self, query, params):
        self.calls.append((query,params))
        assert "statarena.fixtures" in query
        return type("Rows",(),{"fetchall":lambda self: [
            ("l_1XLtP0","2026","2025/2026"),
            ("l_1XLtP0","2022","2022/2023"),
        ]})()


class AliasTests(unittest.TestCase):
    def test_native_edition_and_legacy_year_span_map_to_persisted_cohort(self):
        manifest={"seasons":[
            {"id":"2026/2027","chunks":[
                {"leagueId":"l_1XLtP0","competitions":[{"name":"World Cup"}],"meta":{"matchCount":104}},
                {"leagueId":"l_mls","competitions":[{"name":"MLS"}],"meta":{"matchCount":450}},
            ]},
            {"id":"2026","chunks":[
                {"leagueId":"l_1XLtP0","competitions":[{"name":"World Cup"}],"meta":{"matchCount":0}},
            ]},
            {"id":"2025/2026","chunks":[
                {"leagueId":"l_1","competitions":[{"name":"Ligue 1"}],"meta":{"matchCount":306}}
            ]},
        ]}
        aliases=canonical_source_aliases(Source(),manifest)
        self.assertEqual(aliases[("2026","l_1XLtP0")],"2025/2026")
        self.assertEqual(aliases[("2026/2027","l_1XLtP0")],"2025/2026")
        self.assertEqual(aliases[("2022/2023","l_1XLtP0")],"2022/2023")
        known=canonical_known_scopes(manifest,aliases)
        self.assertIn(("2025/2026","l_1XLtP0"),known)
        self.assertNotIn(("2026/2027","l_1XLtP0"),known)
        self.assertNotIn(("2026","l_1XLtP0"),known)
        self.assertIn(("2026/2027","l_mls"),known)

    def test_conflicting_source_editions_are_not_silently_merged(self):
        class Conflict(Source):
            def execute(self,*args):
                return type("Rows",(),{"fetchall":lambda self: [
                    ("l_1XLtP0","2026","2025/2026"),
                    ("l_1XLtP0","2026","2026/2027"),
                ]})()
        with self.assertRaisesRegex(RuntimeError,"Conflicting"):
            canonical_source_aliases(Conflict(),{"seasons":[
                {"id":"2026","chunks":[
                    {"leagueId":"l_1XLtP0","competitions":[{"name":"World Cup"}]}
                ]}
            ]})

if __name__=="__main__":
    unittest.main()
