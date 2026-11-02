"""Older results retain their original CSV fields and do not overwrite newer seasons."""
import csv
import gzip
import json
from pathlib import Path
import sys
import tempfile
import unittest
import zipfile

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'dashboard/scripts'))
import build_footballcsv_history as legacy

class FootballCSVHistoryTests(unittest.TestCase):
    def test_legacy_results_keep_sources_missing_scores_and_existing_seasons(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);out=root/'out';out.mkdir()
            existing={'id':'2020/2021','path':'raw/openfootball/2020-2021.json.gz','competitions':1,'matches':1,'results':1,'sha256':'original'}
            (out/'index.json').write_text(json.dumps({'source':{'name':'OpenFootball'},'seasons':[existing]}),encoding='utf-8')
            england=root/'england.zip';germany=root/'germany.zip'
            with zipfile.ZipFile(england,'w') as z:
                z.writestr('england/1990s/1992-93/eng.1.csv','Round,Date,Team 1,FT,Team 2\n1,Sat Aug 15 1992,Arsenal FC,0-0,Norwich City FC\n2,Sat Aug 22 1992,Leeds United FC,,Wimbledon FC\n')
            with zipfile.ZipFile(germany,'w') as z:
                z.writestr('germany/1990s/1992-93/de.1.csv','Matchday,Date,Team 1,FT,Team 2\n1,Fri Aug 14 1992,1. FC Köln,1-0,FC Bayern München\n')
            result=legacy.build(out,{'england':england,'deutschland':germany})
            index=json.loads((out/'index.json').read_text(encoding='utf-8'))
            self.assertEqual(result['seasons'],1)
            self.assertEqual((result['matches'],result['results']),(3,2))
            self.assertEqual(index['seasons'][0],existing)
            data=json.loads(gzip.decompress((out/'1992-1993.json.gz').read_bytes()))
            self.assertEqual(len(data['competitions']),2)
            english=next(c for c in data['competitions'] if c['country']=='Angleterre')
            self.assertEqual(english['matches'][0]['date'],'1992-08-15')
            self.assertEqual(english['matches'][0]['score']['ft'],[0,0])
            self.assertNotIn('score',english['matches'][1])
            self.assertEqual(english['matches'][1]['sourceFields']['FT'],'')
            self.assertEqual(len(index['source']['additionalSources']),2)

    def test_unknown_dates_are_rejected_instead_of_guessed(self):
        with self.assertRaises(ValueError): legacy.source_date('unknown date')

class EuropeanCupTests(unittest.TestCase):
    def test_extra_time_and_penalties_are_not_confused_with_regulation(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);out=root/'out';out.mkdir()
            (out/'index.json').write_text(json.dumps({'source':{'name':'OpenFootball'},'seasons':[]}),encoding='utf-8')
            archive=root/'europe.zip'
            with zipfile.ZipFile(archive,'w') as z:
                z.writestr('europe/1957-58/champs.csv','Round,Date,Team 1,FT,HT,Team 2,ET,P,Comments\nFinal,(Wed) 28 May 1958 (W21),Real Madrid,2-2 (*),0-0,AC Milan,3-2 (a.e.t.),,\n')
                z.writestr('europe/1970-71/champs.csv','Round,Date,Team 1,FT,HT,Team 2,ET,P,Comments\nReplay,(Wed) 4 Nov 1970 (W44),Everton,1-1 (*),1-1,Gladbach,1-1 (a.e.t.),4-3 (pen.),\n')
            result=legacy.build(out,{'europe':archive})
            self.assertEqual((result['seasons'],result['matches'],result['results']),(2,2,2))
            final=json.loads(gzip.decompress((out/'1957-1958.json.gz').read_bytes()))['competitions'][0]['matches'][0]
            self.assertEqual(final['date'],'1958-05-28')
            self.assertEqual(final['score']['ft'],[2,2])
            self.assertEqual(final['score']['et'],[3,2])
            penalty=json.loads(gzip.decompress((out/'1970-1971.json.gz').read_bytes()))['competitions'][0]['matches'][0]
            self.assertEqual(penalty['score']['p'],[4,3])
            self.assertEqual(penalty['sourceFields']['P'],'4-3 (pen.)')

class EarlierEnglishResultsTests(unittest.TestCase):
    def test_pre_1955_results_preserve_original_values_and_upstream_license(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);out=root/'out';out.mkdir()
            (out/'index.json').write_text(json.dumps({'source':{'name':'OpenFootball'},'seasons':[]}),encoding='utf-8')
            archive=root/'soccerdata.zip'
            with zipfile.ZipFile(archive,'w') as z:
                z.writestr('cache/1800s/1888-89/eng.1.csv','Date,Team 1,FT,Team 2\nSat Sep 8 1888,Bolton Wanderers,3-6,Derby County\n')
                z.writestr('cache/1990s/1992-93/eng.1.csv','Date,Team 1,FT,Team 2\nSat Aug 15 1992,Arsenal,2-4,Norwich\n')
            result=legacy.build(out,{'soccerdata':archive})
            self.assertEqual((result['seasons'],result['matches']),(1,1))
            index=json.loads((out/'index.json').read_text(encoding='utf-8'))
            self.assertEqual(index['seasons'][0]['id'],'1888/1889')
            self.assertEqual(index['source']['additionalSources'][0]['upstream']['license'],'GPL-2.0-or-later')
            match=json.loads(gzip.decompress((out/'1888-1889.json.gz').read_bytes()))['competitions'][0]['matches'][0]
            self.assertEqual((match['date'],match['score']['ft']),('1888-09-08',[3,6]))
            self.assertEqual(match['sourceFields']['FT'],'3-6')


if __name__=='__main__': unittest.main()
