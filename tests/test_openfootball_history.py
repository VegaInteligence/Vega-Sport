"""OpenFootball archives remain results-only, European and lossless."""
import gzip
import json
from pathlib import Path
import sys
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'dashboard/scripts'))
import build_openfootball_history as history


class OpenFootballHistoryTests(unittest.TestCase):
    def test_european_calendar_and_cross_year_seasons_preserve_missing_scores(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            archive = base / 'source.zip'
            match = {'date':'2020-09-12','team1':'A','team2':'B','score':{'ft':[0,3]},'unknown_source_field':None}
            with zipfile.ZipFile(archive, 'w') as source:
                source.writestr('source/2020-21/en.1.json',json.dumps({'name':'Premier League','matches':[match,{'date':'2020-09-13','team1':'C','team2':'D'}]}))
                source.writestr('source/2020/fi.1.json',json.dumps({'name':'Finland','matches':[match]}))
                source.writestr('source/2020-21/mx.1.json',json.dumps({'name':'Mexico','matches':[match]}))
                source.writestr('source/2021-22/en.1.json',json.dumps({'name':'Later','matches':[match]}))
            output = base / 'output'
            index = history.build(archive, output)
            self.assertEqual([s['id'] for s in index['seasons']], ['2020/2021'])
            season = index['seasons'][0]
            self.assertEqual((season['competitions'],season['matches'],season['results']),(2,3,2))
            payload = json.loads(gzip.decompress((output/'2020-2021.json.gz').read_bytes()))
            self.assertEqual({c['sourceSeason'] for c in payload['competitions']},{'2020','2020-21'})
            england = next(c for c in payload['competitions'] if c['code']=='en.1')
            self.assertEqual(england['matches'][0],match)
            self.assertNotIn('score',england['matches'][1])
            self.assertIn('pas de statistiques joueurs',index['source']['coverage'])
            first_hash=season['sha256']
            self.assertEqual(history.build(archive,output)['seasons'][0]['sha256'],first_hash)

if __name__ == '__main__':
    unittest.main()
