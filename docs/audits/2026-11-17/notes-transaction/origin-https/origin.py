"""Real signed HTTPS reads over AWS_IAM function URL. Never save credentials or headers sent."""
import concurrent.futures
import datetime
import hashlib
import json
import math
import subprocess
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest
from botocore.credentials import Credentials

out=Path(__file__).resolve().parent
base=out.parents[3]
fixtures=json.loads((base/'delivery/notes-transaction/reader-0200/observations.json').read_bytes())
def aws(*args):
    return json.loads(subprocess.check_output(['aws','--region','us-east-2','--profile','statarena',*args]))
api=aws('lambda','get-function-url-config','--function-name','vega-v2-api','--query','{url:FunctionUrl,auth:AuthType}')
code=aws('lambda','get-function-configuration','--function-name','vega-v2-api','--query','{function:FunctionName,sha:CodeSha256,modified:LastModified}')
assert api['auth']=='AWS_IAM' and urllib.parse.urlsplit(api['url']).hostname.endswith('.lambda-url.us-east-2.on.aws')
assert code['sha']=='rrXidCMW2nHD70WCaIyXWq11mYRQqTjaQufyhcsrcUE='
c=aws('configure','export-credentials','--format','process')
credentials=Credentials(c['AccessKeyId'],c['SecretAccessKey'],c['SessionToken'])
def paths(o):
    r=o['input'];m=r['public_match'];p=r['public_player']
    return ('api/read/performance?'+urllib.parse.urlencode({'season':'2021/2022','league':r['public_competition'],'appearance':m+':'+p}),
            'api/matches/'+m+'/players')
now=lambda:datetime.datetime.now(datetime.timezone.utc).isoformat()
dir=out/'origin-bodies';dir.mkdir(exist_ok=True)
def get(path):
    url=api['url'].rstrip('/')+'/'+path
    req=AWSRequest('GET',url, headers={'Accept':'application/json'})
    SigV4Auth(credentials,'lambda','us-east-2').add_auth(req)
    request=urllib.request.Request(url,headers=dict(req.headers),method='GET')
    try:
        resp=urllib.request.urlopen(request,timeout=35)
    except urllib.error.HTTPError as exc:
        resp=exc
    with resp:
        body=resp.read()
        receipt={'status':resp.status,'date':resp.headers.get('date'),'at':now(),'path':path,
                 'body_sha256':hashlib.sha256(body).hexdigest(),'content_type':resp.headers.get('content-type')}
        if resp.status==200:
            (dir/(receipt['body_sha256']+'.json')).write_bytes(body)
            raw=json.loads(body)
            return receipt,raw.get('data',raw)
        return receipt,None
def main():
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        p=list(dict.fromkeys(p for o in fixtures for p in paths(o))); results=dict(zip(p,pool.map(get,p),strict=True))
    checks=[]
    for o in fixtures:
        a,m=paths(o)
        ack,pc=results[a];mck,mc=results[m]
        appearance=(pc.get('row') or pc) if isinstance(pc,dict) else {}
        players=[r for r in (mc or []) if o['input']['public_player'] in [r.get('player',{}).get(k) for k in ('id','player_id','public_id')]]
        gs=[v['stat']['value'] for row in players for g in row.get('stats',[]) for v in g.get('stats',{}).values() if v.get('key')=='vega_grade']
        assert len(gs)<=1
        per,mg=appearance.get('grade'),gs[0] if gs else None
        def same(a,b):
            return a is None and b is None or a is not None and b is not None and math.isclose(a,b,rel_tol=0,abs_tol=1e-10)
        checks.append({'key':o['key'],'exact_subject':appearance.get('id')==o['key'] and len(players)==1,
            'appearance':per,'match':mg,'appearance_z':appearance.get('gradeZ'),'identified':len(players),
            'status':[ack['status'],mck['status']],'unchanged_at_1e_10':same(per,o['performance_grade']) and same(mg,o['match_grade'])})
    summary={'at':now(),'origin':api,'release':code,'requests':len(results),'response_status':sorted({i[0]['status'] for i in results.values()}),
             'unique_subjects':len(checks),'exact_subjects':sum(x['exact_subject'] for x in checks),
             'same_values_as_0200':sum(x['unchanged_at_1e_10'] for x in checks),
             'match_only':[x['key'] for x in checks if x['match'] is not None and x['appearance'] is None],
             'both_missing':sum(x['match'] is None and x['appearance'] is None for x in checks),
             'both_numeric':sum(x['match'] is not None and x['appearance'] is not None for x in checks)}
    (out/'origin-observations.json').write_text(json.dumps({'summary':summary,'observations':checks,'receipts':[v[0] for v in results.values()]},indent=2)+'\n')
    print(json.dumps(summary,indent=2))
    assert summary['response_status']==[200] and summary['exact_subjects']==27
    

if __name__=='__main__':
    main()
