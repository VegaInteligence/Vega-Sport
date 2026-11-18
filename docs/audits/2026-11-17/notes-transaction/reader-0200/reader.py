"""Compare the deployed match and player readers for prespecified real player-match keys."""
import argparse,concurrent.futures,datetime,hashlib,json,subprocess,tempfile,time,urllib.parse
from pathlib import Path
p=Path(__file__).resolve().parent;e=p.parents[2];utc=datetime.timezone.utc
def moment():return datetime.datetime.now(utc)
def table(f):
 d=json.loads(f.read_bytes());return [dict(zip(d['columns'],row,strict=True)) for row in d['rows']]
def get(item):
 path,query=item
 req={'version':'2.0','rawPath':path,'rawQueryString':query,'headers':{'accept':'application/json'},'requestContext':{'http':{'method':'GET'}}}
 with tempfile.NamedTemporaryFile() as f:
  result=subprocess.run(['aws','--region','us-east-2','--profile','statarena','lambda','invoke','--function-name','vega-v2-api','--cli-binary-format','raw-in-base64-out','--payload',json.dumps(req),f.name],check=True,text=True,capture_output=True)
  raw=f.read();o=json.loads(raw);body=json.loads(o['body'])
  return (item,{'utc':moment().isoformat(),'path':path,'query':query,'status':o['statusCode'],'code_version':json.loads(result.stdout).get('ExecutedVersion'),'body_sha256':hashlib.sha256(o['body'].encode()).hexdigest(),'data':body.get('data',body)})
def find_player(body,pid):
 if not isinstance(body,list):return []
 return [r for r in body if isinstance(r.get('player'),dict) and pid in (r['player'].get('id'),r['player'].get('player_id'),r['player'].get('public_id'))]
def urls(row):
 mid,pid,comp=row['public_match'],row['public_player'],row['public_competition']
 return ('/api/read/performance',urllib.parse.urlencode({'season':'2021/2022','league':comp,'appearance':mid+':'+pid})),('/api/matches/'+mid+'/players','')
ap=argparse.ArgumentParser();ap.add_argument('output',type=Path);ap.add_argument('--after',type=datetime.datetime.fromisoformat);ap.add_argument('--only-controls',action='store_true');args=ap.parse_args()
if args.after:
 while (secs:=(args.after-moment()).total_seconds())>0:time.sleep(min(20,secs))
out=args.output.resolve();out.mkdir(exist_ok=False,parents=True)
known=table(e/'db/track5_reader_controls_20261117_verified/cameo-keys.json'); rows=[] if args.only_controls else table(e/'db/t5_recheck_public_keys_nov18_verified/keys.json')
keys={r['public_match']+':'+r['public_player']:{**r,'sample':'23 fixed historical keys'} for r in rows}
for r in known:keys.setdefault(r['public_match']+':'+r['public_player'],{**r,'sample':'published reader control'})
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as workers: responses=dict(workers.map(get,dict.fromkeys(u for k in keys.values() for u in urls(k))))
observations=[]
for identity,row in keys.items():
 per,match=urls(row);p1,p2=responses[per],responses[match];body=p1['data'];player=body.get('row',body) if isinstance(body,dict) else {}
 stats=find_player(p2['data'],row['public_player'])
 if len(stats)>1:raise ValueError(('duplicate appearance',identity))
 groups=stats[0].get('stats',[]) if stats else []
 values=[v['stat']['value'] for g in groups for v in g.get('stats',{}).values() if v.get('key')=='vega_grade'];assert len(values)<=1
 observations.append({'key':identity,'input':row,'performance_http':p1['status'],'match_http':p2['status'],'found_as_requested':player.get('id')==identity,'match_player_rows':len(stats),'performance_grade':player.get('grade'),'performance_z':player.get('gradeZ'),'match_grade':values[0] if values else None,'performance_observed_at':p1['utc'],'match_observed_at':p2['utc']})
for name,val in [('observations',observations),('response-digests',[{k:v for k,v in r.items() if k!='data'} for r in responses.values()])]:
 (out/(name+'.json')).write_text(json.dumps(val,ensure_ascii=False,indent=2)+'\n')
print('observations',len(observations),'both HTTP 200',sum(r['performance_http']==r['match_http']==200 for r in observations),'rows identified',sum(r['found_as_requested'] and r['match_player_rows']==1 for r in observations),'numeric grades',sum(r['performance_grade'] is not None for r in observations),sum(r['match_grade'] is not None for r in observations))
