"""Count application SQL calls and actual match/stat tuple changes on an identical ordinary source replay."""
from pathlib import Path
from collections import Counter
from datetime import datetime,timezone,timedelta
import json,re,subprocess,sys,types
import psycopg
from psycopg import sql
w=Path(sys.argv[1]).resolve()
out=Path(sys.argv[2])
tag=sys.argv[3]
assert re.fullmatch('[a-z0-9]{2,11}',tag)
sys.path.insert(0,str(w/'backend'))
from vega.sources import open_matchday
from vega.store import connect_local,migrate
here=Path(__file__).resolve().parent
class Count:
    def __init__(self,db):
        self.db=db;self.count=Counter()
    def __getattr__(self,k):return getattr(self.db,k)
    def execute(self,query,*args,**kw):
        cur=self.db.execute(query,*args,**kw)
        text=query if isinstance(query,str) else query.as_string(self.db)
        self.count['sql_calls']+=1
        if 'core.team_match_stats' in text:
            verb=text.strip().split()[0].lower()
            self.count['team_stats_'+verb]+=1
            if verb in ('insert','update','delete'):self.count['team_stats_rows_written']+=cur.rowcount
        return cur
def source_uri(url,as_text=False):
    path=url.removeprefix(open_matchday.RAW);fixtures=w/'backend/tests/fixtures/open_matchday'
    if path=='build_summary.json':return json.loads((fixtures/path).read_bytes())
    folder,file=path.removeprefix('data/').split('/')
    return (fixtures/(folder+'.'+file)).read_text()
def tuple_state(db):
    return [db.execute('SELECT id,revision,xmin::text FROM core.matches ORDER BY id').fetchall(),
        db.execute('SELECT match_id,team_id,period::text,xmin::text FROM core.team_match_stats ORDER BY 1,2,3').fetchall()]
date=datetime(2026,11,18,tzinfo=timezone.utc)
data={}
for k,pin in [('before','599b80497ca7b49d65714f3d54e709c97c0cbe7f'),('after','0580dfd4ba645461d6c372fbd7b1d73eaaa779a0')]:
    path='backend/vega/sources/open_matchday.py'
    src=subprocess.check_output(['git','-C',str(w),'show',pin+':'+path])
    mod=types.ModuleType('vega.sources.omd_'+k);mod.__package__='vega.sources';mod.__file__=str(w/path)
    exec(compile(src,str(w/path),'exec'),mod.__dict__)
    dbname='vega_v2_omd_cost_'+tag+'_'+k
    admin='postgresql://postgres@127.0.0.1:55439'
    with psycopg.connect(admin+'/postgres',autocommit=True) as con:con.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(dbname)))
    with connect_local(admin+'/'+dbname) as db:
        migrate(db)
        with db.transaction():first=mod.run(db,source_uri,'europe',date)
        a=tuple_state(db);wrapped=Count(db)
        calls=[]
        def recorded_source(url,as_text=False):
            calls.append(url.removeprefix(open_matchday.RAW))
            return source_uri(url,as_text)
        with db.transaction():second=mod.run(wrapped,recorded_source,'europe',date+timedelta(days=1))
        b=tuple_state(db)
        assert first==second and a==b and a[0] and a[1]
        data[k]={'application':pin,'source_return':list(second),'source_reads':calls,'physical_matches':len(a[0]),'team_period_rows':len(a[1]),'same_match_and_stats_xmin':a==b,'counts':dict(wrapped.count)}
assert data['before']['source_reads']==data['after']['source_reads'] and data['after']['source_reads']
out.write_text(json.dumps(data,indent=2)+'\n');print(json.dumps(data))
