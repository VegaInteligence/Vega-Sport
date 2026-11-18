"""Refetch the two historical winner profiles implicated in the closed VI-18 acceptance."""
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime,timezone
from hashlib import sha256
import json
from pathlib import Path
from urllib.request import Request,urlopen
p=Path(__file__).resolve().parent
def nation(case):
    id,year=case
    url='https://vegasport.vercel.app/api/nations/'+id+'?season=2026%2F2027'
    with urlopen(Request(url,headers={'Accept':'application/json'}),timeout=40) as res:
        raw=res.read()
        result={'status':res.status,'at':datetime.now(timezone.utc).isoformat(),'url':url,'body_sha256':sha256(raw).hexdigest(),
                'etag':res.headers.get('ETag'),'cache_age':res.headers.get('age')}
    obj=json.loads(raw)['data']
    row,= [t for t in obj['tournaments'] if t['year']==year and t['tournament']=='world-cup']
    last=max(row['games'],key=lambda m:m['date'])
    result.update(id=id,team=obj['name'],year=year,stage=row['stage'],games=row['matches'],played_status=dict(Counter(m['status'] for m in row['games'])),
                  final={key:last[key] for key in ('date','round','status','homeScore','awayScore')}|{'home':last['home']['name'],'away':last['away']['name']})
    return result
with ThreadPoolExecutor(max_workers=2) as pool:result=list(pool.map(nation,[('t_2ysHaw',1998),('t_v0001032',1982)]))
(p/'nations-1547.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print([(r['team'],r['stage'],r['final']['status']) for r in result])
