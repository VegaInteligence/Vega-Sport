"""Read-only S3 key/size inventory and CloudFront metadata. No object downloads."""
from collections import Counter
import datetime
import json
from pathlib import Path
import subprocess

OUT=Path(__file__).resolve().parents[1] / "evidence"
ACCOUNT='361769570630';BUCKET='statarena-football-333rosky-70db6e5f'
def aws(*a):
    body=subprocess.check_output(['aws','--profile','statarena','--region','us-east-2',*a,'--output','json'],text=True)
    return json.loads(body) if body.strip() else {}
assert aws('sts','get-caller-identity','--query','Account')==ACCOUNT
report={'atUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'command':'python3 docs/architecture/orion-plan-20261104/tools/audit_s3.py','setup':'S3 ListObjectsV2 metadata only with expected bucket owner; existing CloudFront configuration. No object content downloads, source/provider calls or infrastructure/data writes.','bucket':BUCKET,'pages':0,'objects':0,'bytes':0,'groups':{},'migrationObjects':[],'complete':False}
counts=Counter();sizes=Counter();extensions=Counter();extbytes=Counter();token=None
try:
    report['location']=aws('s3api','get-bucket-location','--bucket',BUCKET,'--expected-bucket-owner',ACCOUNT)
    report['versioning']=aws('s3api','get-bucket-versioning','--bucket',BUCKET,'--expected-bucket-owner',ACCOUNT)
    report['publicAccessBlock']=aws('s3api','get-public-access-block','--bucket',BUCKET,'--expected-bucket-owner',ACCOUNT)
    for dist in ['E3IHCBKMHSDYC6','E26GD325YNN0LL']:
        x=aws('cloudfront','get-distribution','--id',dist)['Distribution'];c=x['DistributionConfig']
        report.setdefault('distributions',[]).append({'id':dist,'domain':x['DomainName'],'status':x['Status'],'enabled':c['Enabled'],'origins':[{'id':o['Id'],'domain':o['DomainName'],'path':o.get('OriginPath'),'oac':o.get('OriginAccessControlId'),'customHeaderNames':[h['HeaderName'] for h in o.get('CustomHeaders',{}).get('Items',[])]} for o in c['Origins']['Items']],'defaultBehavior':c['DefaultCacheBehavior'],'cacheBehaviors':c.get('CacheBehaviors')})
    while report['pages']<500:
        args=['s3api','list-objects-v2','--bucket',BUCKET,'--expected-bucket-owner',ACCOUNT,'--max-keys','1000','--no-paginate']
        if token:args.extend(['--continuation-token',token])
        page=aws(*args);report['pages']+=1
        for item in page.get('Contents',[]):
            key=item['Key'];size=item['Size'];parts=key.split('/')
            group='/'.join(parts[:2]) if len(parts)>1 else parts[0]
            counts[group]+=1;sizes[group]+=size;report['objects']+=1;report['bytes']+=size
            lower=key.lower()
            kind='images' if lower.endswith(('.webp','.png','.jpg','.jpeg','.gif','.svg','.avif')) else 'structured-json' if lower.endswith(('.json','.json.gz','.jsonl','.jsonl.gz')) else 'other'
            extensions[kind]+=1;extbytes[kind]+=size
            if key.startswith('_migration/'):
                report['migrationObjects'].append({'key':key,'bytes':size,'modified':item['LastModified']})
        report['groups']={k:{'objects':counts[k],'bytes':sizes[k]} for k in sorted(counts)}
        report['classes']={k:{'objects':extensions[k],'bytes':extbytes[k]} for k in sorted(extensions)}
        report['lastPageAt']=datetime.datetime.now(datetime.timezone.utc).isoformat()
        (OUT/'s3.json').write_text(json.dumps(report,indent=2)+'\n')
        if report['pages']%50==0:print(json.dumps({'pages':report['pages'],'objects':report['objects'],'bytes':report['bytes']}),flush=True)
        if not page.get('IsTruncated'):
            report['complete']=True;break
        token=page['NextContinuationToken']
    if not report['complete']:report['limit']='Reached500pages; counts are partial. No full inventory claim.'
except Exception as e:
    report['error']=type(e).__name__+': '+str(e)[:300]
finally:
    report['finishedUtc']=datetime.datetime.now(datetime.timezone.utc).isoformat()
    (OUT/'s3.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'complete':report['complete'],'objects':report['objects'],'bytes':report['bytes'],'error':report.get('error')}),flush=True)
