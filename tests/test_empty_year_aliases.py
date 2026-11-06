"""AWS publisher must retire only proven-empty calendar-year aliases."""
import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"dashboard/scripts"))
from relational_materialize import redundant_year_aliases, canonical_known_scopes

class Result:
    def __init__(self,rows):self.rows=rows
    def fetchall(self):return self.rows

class Database:
    def __init__(self,canonical):self.canonical=canonical
    def execute(self,query,params):
        self.query=query
        self.params=params
        assert "statarena_app.partitions" in query
        assert "AND NOT EXISTS(SELECT 1 FROM statarena.fixtures" not in query
        assert "statarena_app.matches" in query
        assert "statarena_app.fixtures" in query
        return Result(self.canonical)

def season(label,league,count):
    return {"id":label,"chunks":[{"leagueId":league,"meta":{"matchCount":count}}]}

class AliasTests(unittest.TestCase):
    def test_only_proven_empty_year_is_canonicalized(self):
        manifest={"seasons":[season("2026","l_mls",0),
            season("2026/2027","l_mls",495),season("2026","l_real",100),
            season("2026/2027","l_real",0),season("2025/2026","l_fr",306)]}
        db=Database([("2026","l_mls")])
        aliases=redundant_year_aliases(db,manifest)
        self.assertEqual(aliases,{("2026","l_mls"):"2026/2027"})
        self.assertEqual(db.params,(["2026","2026"],["l_mls","l_real"]))
        known=canonical_known_scopes(manifest,aliases)
        self.assertNotIn(("2026","l_mls"),known)
        self.assertIn(("2026/2027","l_mls"),known)
        self.assertIn(("2026","l_real"),known)
    def test_unpaired_calendar_year_is_preserved(self):
        manifest={"seasons":[season("2026","l_calendar",20)]}
        self.assertEqual(redundant_year_aliases(Database([]),manifest),{})
        self.assertEqual(canonical_known_scopes(manifest,{}),{("2026","l_calendar")})
if __name__=="__main__":unittest.main()
