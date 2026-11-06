"""Ingest must persist the right season, not just relabel the UI."""
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/"dashboard/scripts"))
from football_seasons import sporting_season,fixture_sporting_season,tournament_kind
from aws_ingest import matches

class Seasons(unittest.TestCase):
    def test_world_cup_editions(self):
        for year,target in [(2014,"2013/2014"),(2018,"2017/2018"),
                            (2022,"2022/2023"),(2026,"2025/2026"),
                            (2030,"2029/2030")]:
            self.assertEqual(sporting_season(str(year),"l_1XLtP0"),target)
    def test_afcon_editions(self):
        for year,target in [(2019,"2018/2019"),(2021,"2021/2022"),
                            (2023,"2023/2024"),(2025,"2025/2026"),
                            (2027,"2026/2027")]:
            self.assertEqual(sporting_season(str(year),None,"Africa Cup of Nations"),target)
    def test_other_cups(self):
        self.assertEqual(sporting_season("2024",None,"Euro"),"2023/2024")
        self.assertEqual(sporting_season("2020",None,"Euro"),"2020/2021")
        self.assertEqual(sporting_season("2024",None,"Copa América"),"2023/2024")
    def test_calendar_leagues_and_qualifiers(self):
        self.assertEqual(sporting_season("2026",None,"MLS"),"2026/2027")
        self.assertEqual(sporting_season("2025/2026",None,"Ligue 1"),"2025/2026")
        self.assertIsNone(tournament_kind(None,"World Cup Qualifiers"))
    def test_july_crossing_and_double_shift(self):
        for day in ["2026-06-11","2026-07-01","2026-07-19"]:
            self.assertEqual(fixture_sporting_season(
                {"season":"2026","date":day,"league":{"id":"l_1XLtP0"}}),"2025/2026")
        self.assertEqual(fixture_sporting_season(
            {"season":"2025/2026","date":"2026-06-11","league":{"id":"l_1XLtP0"}}),"2025/2026")

class Result:
    def __init__(self,rows):self.rows=rows
    def __iter__(self):return iter(self.rows)
    def fetchall(self):return self.rows

class DB:
    def __init__(self,old=None):self.old=old or {};self.writes=[];self.dirty=[]
    def execute(self,sql,params=None):
        if "SELECT id,season,league_id FROM" in sql:
            return Result([(mid,*self.old[mid]) for mid in params[0] if mid in self.old])
        if "insert into statarena.fixtures" in sql:
            self.writes += params[0].obj
            return Result([(x["id"],x["season"],x["league_id"]) for x in params[0].obj])
        raise AssertionError(sql)
    def cursor(self):return self
    def __enter__(self):return self
    def __exit__(self,*args):return False
    def executemany(self,sql,rows):
        assert "dirty_partitions" in sql
        self.dirty += rows

class Store:
    def __init__(self,old=None):self.db=DB(old);self.jobs=[]
    def enqueue(self,path,params=None,priority=3,**kw):self.jobs.append(path)

class Ingest(unittest.TestCase):
    def test_original_edition_kept_with_canonical_sql_season(self):
        s=Store()
        matches(s,[{"id":"m_123456","season":"2026","date":"2026-07-05",
                   "league":{"id":"l_1XLtP0","name":"World Cup"}}],
                   enqueue_details=False)
        self.assertEqual(s.db.writes[0]["season"],"2025/2026")
        self.assertEqual(s.db.writes[0]["body"]["season"],"2026")
        self.assertEqual(s.db.dirty,[("2025/2026","l_1XLtP0")])
    def test_source_correction_invalidates_both_cohorts(self):
        s=Store({"m_123456":("2026/2027","l_1XLtP0")})
        matches(s,[{"id":"m_123456","season":"2026",
                    "league":{"id":"l_1XLtP0"}}],enqueue_details=False)
        self.assertEqual(set(s.db.dirty),{
            ("2026/2027","l_1XLtP0"),("2025/2026","l_1XLtP0")})
