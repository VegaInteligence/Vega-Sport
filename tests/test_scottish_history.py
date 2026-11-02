import csv,gzip,hashlib,io,json,sys,tempfile,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'dashboard/scripts'))
import build_scottish_history as builder

class ScottishHistoryTests(unittest.TestCase):
 def test_adds_new_seasons_and_preserves_existing_competitions(self):
  with tempfile.TemporaryDirectory() as directory:
   root=Path(directory);source=root/'source';out=root/'output';source.mkdir();out.mkdir()
   old={'id':'old','name':'Old','country':'Angleterre','matches':[{'date':'1914-09-01','team1':'X','team2':'Y','score':{'ft':[1,0]}}]}
   data={'season':'1914/1915','source':{},'competitions':[old]};body=gzip.compress(json.dumps(data).encode(),mtime=0)
   (out/'1914-1915.json.gz').write_bytes(body)
   (out/'index.json').write_text(json.dumps({'source':{'additionalSources':[]},'seasons':[{'id':'1914/1915'}]}),encoding='utf8')
   fields=['date','home','away','gh','ga','competition','level','full_time'];stream=io.StringIO(newline='');w=csv.DictWriter(stream,fieldnames=fields);w.writeheader();w.writerows([
    {'date':'1914-08-20','home':'A','away':'B','gh':'1','ga':'0','competition':'scotland','level':'national','full_time':'F'},
    {'date':'1916-04-01','home':'C','away':'D','gh':'2','ga':'2','competition':'scotland','level':'national','full_time':'F'}])
   raw=stream.getvalue().encode();z=gzip.compress(raw,mtime=0);(source/'test.csv.gz').write_bytes(z)
   m={'path':'test.csv.gz','sha256Compressed':hashlib.sha256(z).hexdigest(),'sha256Raw':hashlib.sha256(raw).hexdigest(),'name':'source','url':'https://example.org','license':'ODC-BY-1.0','revision':'test','upstreamPath':'data/results/games.parquet'}
   (source/'scotland-manifest.json').write_text(json.dumps(m),encoding='utf8')
   result=builder.build(source,out);self.assertEqual(result['newSeasons'],['1915/1916']);self.assertEqual(result['sourceRows'],2)
   first=json.loads(gzip.decompress((out/'1914-1915.json.gz').read_bytes()));self.assertEqual(next(x for x in first['competitions'] if x['id']=='old'),old)
   second=json.loads(gzip.decompress((out/'1915-1916.json.gz').read_bytes()));self.assertEqual(second['competitions'][0]['matches'][0]['score']['ft'],[2,2])
   index=json.loads((out/'index.json').read_text(encoding='utf8'));before={x['id']:x['sha256'] for x in index['seasons']};builder.build(source,out)
   after=json.loads((out/'index.json').read_text(encoding='utf8'));self.assertEqual(before,{x['id']:x['sha256'] for x in after['seasons']})

if __name__=='__main__':unittest.main()
