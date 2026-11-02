"""Direct engsoccerdata imports preserve provenance, non-matches and date uncertainty."""
import csv,gzip,hashlib,io,json
from pathlib import Path
import sys,tempfile,unittest

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'dashboard/scripts'))
import build_engsoccerdata_history as builder

class EngSoccerDataHistoryTests(unittest.TestCase):
    def test_uncertain_dates_unplayed_ties_and_extra_time_are_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);source=root/'source';out=root/'out';source.mkdir();out.mkdir()
            (out/'index.json').write_text(json.dumps({'source':{'additionalSources':[]},'seasons':[]}),encoding='utf-8')
            def csv_bytes(fields,rows):
                stream=io.StringIO(newline='');writer=csv.DictWriter(stream,fieldnames=fields);writer.writeheader();writer.writerows(rows);return stream.getvalue().encode()
            common=['Date','Season','home','visitor','FT','division','tier']
            france=csv_bytes(common,[{'Date':'1933-07-01','Season':'1932','home':f'Home {i}','visitor':f'Away {i}','FT':'2-1','division':'1','tier':'1'} for i in range(20)])
            cupfields=['Date','Season','home','visitor','FT','round','aet','hp','vp','nonmatch','notes','neutral']
            cup=csv_bytes(cupfields,[
                {'Date':'1871-11-11','Season':'1871','home':'A','visitor':'B','FT':'2-1','round':'1','aet':'yes','hp':'4','vp':'3','nonmatch':'NA','notes':'NA','neutral':'yes'},
                {'Date':'NA','Season':'1871','home':'C','visitor':'D','FT':'3-0','round':'1','aet':'NA','hp':'NA','vp':'NA','nonmatch':'Walkover','notes':'C progresses','neutral':'NA'},
            ])
            files=[]
            for name,raw in [('france',france),('facup',cup)]:
                body=gzip.compress(raw,mtime=0);filename=name+'.csv.gz';(source/filename).write_bytes(body)
                files.append({'name':name,'path':filename,'sourcePath':'data-raw/'+name+'.csv','sha256Raw':hashlib.sha256(raw).hexdigest(),'sha256Compressed':hashlib.sha256(body).hexdigest()})
            manifest={'name':'engsoccerdata','url':'https://github.com/jalapic/engsoccerdata','revision':'test','license':'GPL-2.0-or-later','usage':'non commercial','files':files}
            (source/'manifest.json').write_text(json.dumps(manifest),encoding='utf-8')
            result=builder.build(source,out)
            self.assertEqual((result['newSeasons'],result['newMatches'],result['unplayed']),(2,22,1))
            france_data=json.loads(gzip.decompress((out/'1932-1933.json.gz').read_bytes()))
            self.assertTrue(all(m['date'] is None and m['dateNote'] for m in france_data['competitions'][0]['matches']))
            self.assertEqual(france_data['competitions'][0]['matches'][0]['sourceFields']['Date'],'1933-07-01')
            cup_data=json.loads(gzip.decompress((out/'1871-1872.json.gz').read_bytes()))['competitions'][0]['matches']
            self.assertEqual(cup_data[0]['score'],{'final':[2,1],'et':[2,1],'p':[4,3]})
            self.assertNotIn('ft',cup_data[0]['score'])
            self.assertEqual(cup_data[1]['status'],'not_played')
            self.assertNotIn('score',cup_data[1])
            index=json.loads((out/'index.json').read_text(encoding='utf-8'))
            cup_entry=next(x for x in index['seasons'] if x['id']=='1871/1872')
            self.assertEqual((cup_entry['matches'],cup_entry['results'],cup_entry['unplayed']),(2,1,1))
            self.assertFalse(builder.scored({'score':{'ft':[None,None]}}))
            before={entry['id']:entry['sha256'] for entry in index['seasons']}
            builder.build(source,out)
            after=json.loads((out/'index.json').read_text(encoding='utf-8'))
            self.assertEqual(before,{entry['id']:entry['sha256'] for entry in after['seasons']})


    def test_enrichment_preserves_existing_competitions(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);source=root/'source';out=root/'out';source.mkdir();out.mkdir()
            old={'id':'existing','name':'Existing','country':'Europe','matches':[{'date':'1932-09-01','team1':'X','team2':'Y','score':{'ft':[0,0]}}]}
            payload={'season':'1932/1933','source':{'name':'Old'},'competitions':[old]}
            body=gzip.compress(json.dumps(payload).encode(),mtime=0);(out/'1932-1933.json.gz').write_bytes(body)
            entry={'id':'1932/1933','path':'raw/openfootball/1932-1933.json.gz','competitions':1,'matches':1,'results':1,'sha256':hashlib.sha256(body).hexdigest()}
            (out/'index.json').write_text(json.dumps({'source':{'additionalSources':[]},'seasons':[entry]}),encoding='utf-8')
            raw=b'Date,Season,home,visitor,FT,division,tier\n1932-09-02,1932,A,B,1-0,1,1\n';compressed=gzip.compress(raw,mtime=0);(source/'france.csv.gz').write_bytes(compressed)
            manifest={'name':'engsoccerdata','url':'https://github.com/jalapic/engsoccerdata','revision':'test','license':'GPL-2.0-or-later','usage':'non commercial','files':[{'name':'france','path':'france.csv.gz','sourcePath':'data-raw/france.csv','sha256Raw':hashlib.sha256(raw).hexdigest(),'sha256Compressed':hashlib.sha256(compressed).hexdigest()}]}
            (source/'manifest.json').write_text(json.dumps(manifest),encoding='utf-8')
            builder.build(source,out)
            result=json.loads(gzip.decompress((out/'1932-1933.json.gz').read_bytes()))
            self.assertEqual(next(c for c in result['competitions'] if c['id']=='existing'),old)
            self.assertEqual(len(result['competitions']),2)


    def test_existing_league_is_not_duplicated_and_missing_league_is_added(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);source=root/'source';out=root/'out';source.mkdir();out.mkdir()
            old={'id':'2010-11/es.1','code':'es.1','name':'La Liga','country':'Espagne','matches':[{'date':'2010-08-01','team1':'A','team2':'B','score':{'ft':[1,0]}}]}
            payload={'season':'2010/2011','source':{'name':'Old'},'competitions':[old]};body=gzip.compress(json.dumps(payload).encode(),mtime=0);(out/'2010-2011.json.gz').write_bytes(body)
            entry={'id':'2010/2011','path':'raw/openfootball/2010-2011.json.gz','competitions':1,'matches':1,'results':1,'sha256':hashlib.sha256(body).hexdigest()}
            (out/'index.json').write_text(json.dumps({'source':{'additionalSources':[]},'seasons':[entry]}),encoding='utf-8')
            raw=b'Date,Season,home,visitor,FT,division,tier\n2010-08-02,2010,C,D,2-1,1,1\n';compressed=gzip.compress(raw,mtime=0);files=[]
            for name in ('spain','france'):
                filename=name+'.csv.gz';(source/filename).write_bytes(compressed);files.append({'name':name,'path':filename,'sourcePath':'data-raw/'+name+'.csv','sha256Raw':hashlib.sha256(raw).hexdigest(),'sha256Compressed':hashlib.sha256(compressed).hexdigest()})
            manifest={'name':'engsoccerdata','url':'https://github.com/jalapic/engsoccerdata','revision':'test','license':'GPL-2.0-or-later','usage':'non commercial','files':files}
            (source/'manifest.json').write_text(json.dumps(manifest),encoding='utf-8')
            result=builder.build(source,out);data=json.loads(gzip.decompress((out/'2010-2011.json.gz').read_bytes()))
            self.assertEqual(result['newMatches'],1)
            self.assertEqual(len(data['competitions']),2)
            self.assertEqual(next(c for c in data['competitions'] if c['id']==old['id']),old)
            self.assertEqual(next(c for c in data['competitions'] if c.get('sourceRepository')==builder.SOURCE)['code'],'france')

if __name__=='__main__':unittest.main()
